/**
 * Force-layout precompute (Phase 0). Runs ngraph.forcelayout (Barnes-Hut,
 * O(n log n)) entirely on the host and persists finished coordinates to
 * `node_positions`; the client never simulates (it loads buffers, renders once,
 * freezes). See docs/plans/system-graph-implementation-plan.md "Layout Precompute".
 *
 * Execution model (decided): a CHUNKED MAIN-LOOP, not a worker_thread. There is
 * no `worker_threads` precedent in the codebase and the real graph is ~2.5k
 * connected nodes, so we run `step()` in small cooperative batches via
 * `setImmediate`, yielding to the event loop between chunks so HTTP/WS/watchers
 * never block. A real worker is a Phase 3 optimization gated behind a bootstrap
 * spike.
 *
 * Determinism (seeded, epsilon-tolerant — NOT byte-identical across machines):
 *  - Stable initial placement from a deterministic hash of each node id (no RNG).
 *  - Fixed physics params + fixed iteration count (never wall-clock).
 *  - Two full layouts in the SAME process on the SAME fixture match within a
 *    tight epsilon; warm-start asserts topological stability, not exact floats.
 *
 * Single-flight: one pass at a time. A full pass supersedes any queued
 * incremental request. A watchdog-style guard records `last_error` and resets a
 * crashed run to `stale` so `/meta` self-heals.
 *
 * Flag-inert: this module has no importers on any flag-off code path; the runner
 * / API route (later stages) call it only when `isGraphEnabled()`.
 */

import type Database from "better-sqlite3";
import createGraph from "ngraph.graph";
import type { Graph, Node as NgraphNode } from "ngraph.graph";
import createLayout from "ngraph.forcelayout";
import type { Layout as NgraphLayout } from "ngraph.forcelayout";
import { hashId } from "@/lib/library/utils";
import {
  LAYOUT_VERSION,
  graphLayoutChunkSize,
  graphLayoutIncrementalIterations,
  graphLayoutIterations,
  graphLayoutPhysics,
  graphLayoutWarmIterations,
  isGraphLayoutDisabled,
} from "./config";
import {
  getAllEdges,
  getAllNodePositions,
  getAllNodes,
  getDirtyNodeIds,
  getGraphDb,
  getMeta,
  setMetaMany,
} from "./db";
import type { GraphEdge, GraphNode, GraphLayoutState } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LayoutRunStatus = "idle" | "running" | "frozen" | "stale";

export interface LayoutStateView {
  status: LayoutRunStatus;
  layoutVersion: number;
  /** Wall-clock ms of the last completed pass (telemetry only, never a control input). */
  lastRunMs: number | null;
  /** node_positions rows still flagged dirty. */
  dirtyCount: number;
}

export interface LayoutRunResult {
  /** False when single-flight rejected the request (a pass is already running). */
  ran: boolean;
  blocked: boolean;
  nodesPlaced: number;
  /** Rows actually written this pass (full = all; incremental = dirty region only). */
  rowsWritten: number;
  durationMs: number;
  layoutVersion: number;
  disabled: boolean;
}

interface LayoutOptions {
  db?: Database.Database;
  /** Bypass the cooperative-yield chunking and run synchronously (tests / determinism). */
  sync?: boolean;
}

// ---------------------------------------------------------------------------
// Singleton engine (mirrors getGraphDb's path-keyed singleton intent)
// ---------------------------------------------------------------------------

class LayoutEngine {
  private running = false;
  private lastRunMs: number | null = null;

  isRunning(): boolean {
    return this.running;
  }

  setLastRunMs(ms: number): void {
    this.lastRunMs = ms;
  }

  getLastRunMs(): number | null {
    return this.lastRunMs;
  }

  acquire(): boolean {
    if (this.running) return false;
    this.running = true;
    return true;
  }

  release(): void {
    this.running = false;
  }
}

let engine: LayoutEngine | undefined;

export function getLayoutEngine(): LayoutEngine {
  if (!engine) engine = new LayoutEngine();
  return engine;
}

/** Reset the singleton (tests). */
export function closeLayoutEngineForTests(): void {
  engine = undefined;
}

// ---------------------------------------------------------------------------
// Deterministic seeded initial placement
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad
const SEED_RADIUS = 400;

/**
 * Map a node id to a stable initial (x,y) via a deterministic hash → seeded disc.
 * Same id always yields the same start (no RNG), so a cold solve is reproducible
 * within-process. Uses the shared `hashId` (hex) folded into two unit values.
 */
export function seededPlacement(id: string): { x: number; y: number } {
  const h = hashId(id, 16); // 16 hex chars
  // Two independent 32-bit-ish lanes from the hex digest.
  const a = parseInt(h.slice(0, 8), 16) >>> 0;
  const b = parseInt(h.slice(8, 16), 16) >>> 0;
  // Golden-angle spiral keeps the seed cloud well-spread (avoids a clumped origin).
  const angle = (a / 0xffffffff) * TAU + (b % 997) * GOLDEN_ANGLE;
  const radius = SEED_RADIUS * Math.sqrt(b / 0xffffffff);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

// ---------------------------------------------------------------------------
// ngraph construction
// ---------------------------------------------------------------------------

interface BuiltGraph {
  graph: Graph;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function buildNgraph(nodes: GraphNode[], edges: GraphEdge[]): BuiltGraph {
  const graph = createGraph();
  const present = new Set(nodes.map((n) => n.id));
  for (const n of nodes) graph.addNode(n.id);
  for (const e of edges) {
    // Skip edges whose endpoint isn't in the laid-out set (e.g. tag edges already
    // filtered out by getAllNodes/getAllEdges, or a dangling target).
    if (!present.has(e.source) || !present.has(e.target)) continue;
    graph.addLink(e.source, e.target, { weight: e.weight });
  }
  return { graph, nodes, edges };
}

/**
 * Seed positions: warm-start from persisted (x,y) when present at the current
 * layout_version; otherwise hash placement. New nodes that have at least one
 * already-placed neighbor start at the neighbor centroid so they relax in rather
 * than fly from the origin.
 */
function seedPositions(
  built: BuiltGraph,
  layout: NgraphLayout<Graph>,
  persisted: Map<string, { x: number; y: number; layout_version: number }>,
): void {
  const placed = new Map<string, { x: number; y: number }>();
  const newNodes: GraphNode[] = [];

  for (const node of built.nodes) {
    const prior = persisted.get(node.id);
    if (prior && prior.layout_version === LAYOUT_VERSION && Number.isFinite(prior.x) && Number.isFinite(prior.y)) {
      layout.setNodePosition(node.id, prior.x, prior.y);
      placed.set(node.id, { x: prior.x, y: prior.y });
    } else {
      newNodes.push(node);
    }
  }

  // New nodes: centroid of already-placed neighbors, else hash placement.
  for (const node of newNodes) {
    const ngNode = built.graph.getNode(node.id);
    let sx = 0;
    let sy = 0;
    let count = 0;
    if (ngNode?.links) {
      for (const link of ngNode.links) {
        const otherId = link.fromId === node.id ? link.toId : link.fromId;
        const p = placed.get(String(otherId));
        if (p) {
          sx += p.x;
          sy += p.y;
          count += 1;
        }
      }
    }
    const pos = count > 0 ? { x: sx / count, y: sy / count } : seededPlacement(node.id);
    layout.setNodePosition(node.id, pos.x, pos.y);
    placed.set(node.id, pos);
  }
}

function makeLayout(graph: Graph): NgraphLayout<Graph> {
  const p = graphLayoutPhysics();
  return createLayout(graph, {
    timeStep: p.timeStep,
    gravity: p.gravity,
    theta: p.theta,
    springLength: p.springLength,
    springCoefficient: p.springCoefficient,
    dragCoefficient: p.dragCoefficient,
    dimensions: p.dimensions,
  });
}

// ---------------------------------------------------------------------------
// Persistence (one transaction at run end)
// ---------------------------------------------------------------------------

interface PositionWrite {
  id: string;
  x: number;
  y: number;
}

/**
 * Persist the given positions in ONE transaction, marking them clean. Orphan rows
 * (id no longer in graph_nodes) are deleted in the same transaction. Rows NOT in
 * `writes` are left untouched — the "unaffected rows unchanged" guarantee
 * (testable via `updated_at`) for incremental relayout.
 */
function persistPositions(db: Database.Database, writes: PositionWrite[]): void {
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO node_positions (id, x, y, z, dirty, layout_version, updated_at)
    VALUES (?, ?, ?, NULL, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      x = excluded.x,
      y = excluded.y,
      z = excluded.z,
      dirty = 0,
      layout_version = excluded.layout_version,
      updated_at = excluded.updated_at
  `);
  db.transaction(() => {
    for (const w of writes) {
      upsert.run(w.id, w.x, w.y, LAYOUT_VERSION, now);
    }
    db.exec("DELETE FROM node_positions WHERE id NOT IN (SELECT id FROM graph_nodes)");
  })();
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

function setLayoutState(db: Database.Database, state: GraphLayoutState, extra: Record<string, string> = {}): void {
  setMetaMany({ layout_state: state, layout_version: String(LAYOUT_VERSION), ...extra }, db);
}

function currentLayoutState(db: Database.Database): GraphLayoutState {
  const raw = getMeta("layout_state", db);
  const valid: GraphLayoutState[] = ["idle", "building", "running", "frozen", "stale"];
  return raw && valid.includes(raw as GraphLayoutState) ? (raw as GraphLayoutState) : "idle";
}

// ---------------------------------------------------------------------------
// Chunked stepping (cooperative yield)
// ---------------------------------------------------------------------------

async function runSteps(
  layout: NgraphLayout<Graph>,
  iterations: number,
  chunkSize: number,
  sync: boolean,
  onProgress?: (done: number) => void,
): Promise<void> {
  let done = 0;
  while (done < iterations) {
    const batch = Math.min(chunkSize, iterations - done);
    for (let i = 0; i < batch; i++) layout.step();
    done += batch;
    onProgress?.(done);
    if (!sync && done < iterations) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

// ---------------------------------------------------------------------------
// Full layout
// ---------------------------------------------------------------------------

/**
 * Cold start / LAYOUT_VERSION bump / `/rebuild`. Lays out the entire (tag-free)
 * graph from seeded placement with warm-start, runs a fixed iteration count in
 * cooperative chunks, persists every node's position in one transaction, and
 * freezes. Single-flight: returns `{ ran:false, blocked:true }` if a pass is
 * already running.
 */
export async function requestFullLayout(reason: string, opts: LayoutOptions = {}): Promise<LayoutRunResult> {
  const db = opts.db ?? getGraphDb();
  const eng = getLayoutEngine();
  if (!eng.acquire()) {
    return blockedResult();
  }
  const startedAt = Date.now();
  try {
    const nodes = getAllNodes(db);
    const edges = getAllEdges(db);

    if (isGraphLayoutDisabled()) {
      const writes = nodes.map((n) => ({ id: n.id, ...seededPlacement(n.id) }));
      persistPositions(db, writes);
      setLayoutState(db, "frozen", {
        layout_phase: `disabled:${reason}`,
        nodes_placed: String(writes.length),
        total_nodes: String(nodes.length),
        built_at: getMeta("built_at", db) ?? new Date().toISOString(),
        last_error: "",
      });
      const durationMs = Date.now() - startedAt;
      eng.setLastRunMs(durationMs);
      return { ran: true, blocked: false, nodesPlaced: writes.length, rowsWritten: writes.length, durationMs, layoutVersion: LAYOUT_VERSION, disabled: true };
    }

    setLayoutState(db, "running", {
      layout_phase: `full:${reason}`,
      total_nodes: String(nodes.length),
      nodes_placed: "0",
      last_error: "",
    });

    const built = buildNgraph(nodes, edges);
    const layout = makeLayout(built.graph);
    seedPositions(built, layout, readPersisted(db));

    const iterations = graphLayoutIterations();
    const chunkSize = graphLayoutChunkSize();
    await runSteps(layout, iterations, chunkSize, opts.sync === true, (doneIters) => {
      // Coarse first-run progress: iteration fraction (nodes are all placed up front).
      const frac = iterations > 0 ? doneIters / iterations : 1;
      setMetaMany(
        { nodes_placed: String(Math.round(frac * nodes.length)) },
        db,
      );
    });

    const writes: PositionWrite[] = built.nodes.map((n) => {
      const v = layout.getNodePosition(n.id);
      return { id: n.id, x: v.x, y: v.y };
    });
    persistPositions(db, writes);
    layout.dispose();

    const durationMs = Date.now() - startedAt;
    eng.setLastRunMs(durationMs);
    setLayoutState(db, "frozen", {
      layout_phase: "frozen",
      nodes_placed: String(writes.length),
      total_nodes: String(nodes.length),
      built_at: new Date().toISOString(),
      last_error: "",
    });
    return { ran: true, blocked: false, nodesPlaced: writes.length, rowsWritten: writes.length, durationMs, layoutVersion: LAYOUT_VERSION, disabled: false };
  } catch (err) {
    // Watchdog self-heal: leave a recoverable stale state with last_error.
    setLayoutState(db, "stale", { last_error: errString(err) });
    throw err;
  } finally {
    eng.release();
  }
}

// ---------------------------------------------------------------------------
// Incremental relayout
// ---------------------------------------------------------------------------

/**
 * Scoped relayout of the dirty region (the changed nodes + their 1-hop
 * neighborhood). All OTHER nodes are pinned to their persisted positions so the
 * mental map doesn't shuffle. Only touched `node_positions` rows are rewritten;
 * unaffected rows keep their `updated_at`. Returns to `frozen`.
 *
 * `changedNodeIds` is the explicit seed set from the runner; when empty it falls
 * back to whatever rows are currently flagged dirty. A node with no persisted
 * position yet (brand new) is included and seeded via centroid/hash.
 */
export async function requestIncrementalRelayout(
  changedNodeIds: string[],
  opts: LayoutOptions = {},
): Promise<LayoutRunResult> {
  const db = opts.db ?? getGraphDb();
  const eng = getLayoutEngine();
  if (!eng.acquire()) {
    return blockedResult();
  }
  const startedAt = Date.now();
  try {
    const nodes = getAllNodes(db);
    const edges = getAllEdges(db);
    const persisted = readPersisted(db);

    // Seed set: explicit changed ids ∪ currently-dirty rows, intersected with live nodes.
    const liveIds = new Set(nodes.map((n) => n.id));
    const seedIds = new Set<string>();
    for (const id of changedNodeIds) if (liveIds.has(id)) seedIds.add(id);
    if (seedIds.size === 0) {
      for (const id of getDirtyNodeIds(db)) if (liveIds.has(id)) seedIds.add(id);
    }

    // No work? Nothing dirty: just (re)freeze without touching rows.
    if (seedIds.size === 0) {
      setLayoutState(db, "frozen", { layout_phase: "frozen", last_error: "" });
      const durationMs = Date.now() - startedAt;
      eng.setLastRunMs(durationMs);
      return { ran: true, blocked: false, nodesPlaced: 0, rowsWritten: 0, durationMs, layoutVersion: LAYOUT_VERSION, disabled: false };
    }

    const built = buildNgraph(nodes, edges);

    // Dirty region = seeds + 1-hop neighbors. These move; everyone else is pinned.
    const region = new Set<string>(seedIds);
    for (const id of seedIds) {
      const ngNode = built.graph.getNode(id);
      if (ngNode?.links) {
        for (const link of ngNode.links) {
          region.add(String(link.fromId === id ? link.toId : link.fromId));
        }
      }
    }

    if (isGraphLayoutDisabled()) {
      // Escape hatch: place the dirty region by hash, leave the rest untouched.
      const writes: PositionWrite[] = [...region].map((id) => ({ id, ...seededPlacement(id) }));
      persistPositions(db, writes);
      setLayoutState(db, "frozen", { layout_phase: "frozen", last_error: "" });
      const durationMs = Date.now() - startedAt;
      eng.setLastRunMs(durationMs);
      return { ran: true, blocked: false, nodesPlaced: writes.length, rowsWritten: writes.length, durationMs, layoutVersion: LAYOUT_VERSION, disabled: true };
    }

    setLayoutState(db, "running", { layout_phase: "incremental", last_error: "" });

    const layout = makeLayout(built.graph);
    seedPositions(built, layout, persisted);

    // Pin everything outside the dirty region to its current position.
    built.graph.forEachNode((ngNode: NgraphNode) => {
      if (!region.has(String(ngNode.id))) layout.pinNode(ngNode, true);
    });

    const iterations = graphLayoutIncrementalIterations();
    const chunkSize = graphLayoutChunkSize();
    await runSteps(layout, iterations, chunkSize, opts.sync === true);

    // Only the dirty region's rows are rewritten (preserves untouched updated_at).
    const writes: PositionWrite[] = [...region].map((id) => {
      const v = layout.getNodePosition(id);
      return { id, x: v.x, y: v.y };
    });
    persistPositions(db, writes);
    layout.dispose();

    const durationMs = Date.now() - startedAt;
    eng.setLastRunMs(durationMs);
    setLayoutState(db, "frozen", { layout_phase: "frozen", last_error: "" });
    return { ran: true, blocked: false, nodesPlaced: writes.length, rowsWritten: writes.length, durationMs, layoutVersion: LAYOUT_VERSION, disabled: false };
  } catch (err) {
    setLayoutState(db, "stale", { last_error: errString(err) });
    throw err;
  } finally {
    eng.release();
  }
}

// ---------------------------------------------------------------------------
// Warm-start boot helper
// ---------------------------------------------------------------------------

/**
 * Boot decision (plan "Persistence & warm-start"): if positions exist at the
 * current layout_version and the index is not dirty, the layout is already frozen
 * and zero work is needed. Otherwise a warm-start full pass (WARM_ITERATIONS) is
 * appropriate to absorb drift. Returns the decision without running anything so
 * the runner owns scheduling.
 */
export function warmStartDecision(db = getGraphDb()): { needsLayout: boolean; reason: string } {
  const positions = getAllNodePositions(db);
  if (positions.size === 0) return { needsLayout: true, reason: "no-positions" };
  for (const row of positions.values()) {
    if (row.layout_version !== LAYOUT_VERSION) return { needsLayout: true, reason: "layout-version-bump" };
  }
  if (getDirtyNodeIds(db).length > 0) return { needsLayout: true, reason: "dirty" };
  if (currentLayoutState(db) === "stale") return { needsLayout: true, reason: "stale" };
  return { needsLayout: false, reason: "frozen" };
}

/**
 * Warm-start full pass: same as a full layout but with the reduced
 * WARM_ITERATIONS count (positions are already close to settled). Used on boot
 * when warmStartDecision().needsLayout is true and the cause is drift, not a
 * cold/empty index.
 */
export async function requestWarmStartLayout(opts: LayoutOptions = {}): Promise<LayoutRunResult> {
  const db = opts.db ?? getGraphDb();
  const eng = getLayoutEngine();
  if (!eng.acquire()) return blockedResult();
  const startedAt = Date.now();
  try {
    const nodes = getAllNodes(db);
    const edges = getAllEdges(db);
    setLayoutState(db, "running", {
      layout_phase: "warm-start",
      total_nodes: String(nodes.length),
      nodes_placed: "0",
      last_error: "",
    });
    const built = buildNgraph(nodes, edges);
    const layout = makeLayout(built.graph);
    seedPositions(built, layout, readPersisted(db));
    await runSteps(layout, graphLayoutWarmIterations(), graphLayoutChunkSize(), opts.sync === true);
    const writes: PositionWrite[] = built.nodes.map((n) => {
      const v = layout.getNodePosition(n.id);
      return { id: n.id, x: v.x, y: v.y };
    });
    persistPositions(db, writes);
    layout.dispose();
    const durationMs = Date.now() - startedAt;
    eng.setLastRunMs(durationMs);
    setLayoutState(db, "frozen", {
      layout_phase: "frozen",
      nodes_placed: String(writes.length),
      total_nodes: String(nodes.length),
      built_at: getMeta("built_at", db) ?? new Date().toISOString(),
      last_error: "",
    });
    return { ran: true, blocked: false, nodesPlaced: writes.length, rowsWritten: writes.length, durationMs, layoutVersion: LAYOUT_VERSION, disabled: false };
  } catch (err) {
    setLayoutState(db, "stale", { last_error: errString(err) });
    throw err;
  } finally {
    eng.release();
  }
}

// ---------------------------------------------------------------------------
// State view
// ---------------------------------------------------------------------------

export function getLayoutState(db = getGraphDb()): LayoutStateView {
  const eng = getLayoutEngine();
  const stored = currentLayoutState(db);
  const status: LayoutRunStatus = eng.isRunning()
    ? "running"
    : stored === "running" || stored === "building"
      ? // A "running"/"building" stored state with no in-flight pass means a crash:
        // surface it as stale so /meta self-heals (the watchdog contract).
        "stale"
      : stored === "frozen"
        ? "frozen"
        : stored === "stale"
          ? "stale"
          : "idle";
  return {
    status,
    layoutVersion: LAYOUT_VERSION,
    lastRunMs: eng.getLastRunMs(),
    dirtyCount: getDirtyNodeIds(db).length,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readPersisted(db: Database.Database): Map<string, { x: number; y: number; layout_version: number }> {
  const rows = getAllNodePositions(db);
  const out = new Map<string, { x: number; y: number; layout_version: number }>();
  for (const [id, r] of rows) out.set(id, { x: r.x, y: r.y, layout_version: r.layout_version });
  return out;
}

function blockedResult(): LayoutRunResult {
  return { ran: false, blocked: true, nodesPlaced: 0, rowsWritten: 0, durationMs: 0, layoutVersion: LAYOUT_VERSION, disabled: false };
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
