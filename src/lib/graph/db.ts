import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  getGraphDbPath,
  graphDefaultHops,
  graphHubFanoutCap,
  graphMaxNodesDesktop,
  graphMaxNodesMobile,
  LAYOUT_VERSION,
} from "./config";
import type {
  GraphEdge,
  GraphLayoutState,
  GraphMeta,
  GraphNode,
} from "./types";

/**
 * Derived graph index (`graph.sqlite` under DATA_DIR). Mirrors the calendar db
 * conventions: better-sqlite3, WAL + synchronous=NORMAL, a process singleton keyed
 * on the resolved path, IF NOT EXISTS schema with pragmas first, upserts that list
 * EVERY mutable column (partial upserts leave stale values), and a shared
 * type-matching `parseJson` for JSON columns.
 *
 * This is a pure derived cache (Critical Constraint #2). It never writes the vault
 * or transcript stores; deleting the file and rebuilding reproduces the same graph.
 */

interface NodeRow {
  id: string;
  type: string;
  label: string;
  ref_path: string | null;
  degree: number;
  color_key: string | null;
  source_file: string | null;
  attrs_json: string | null;
  updated_at: string;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  weight: number;
  source_file: string | null;
  attrs_json: string | null;
  updated_at: string;
}

/** Position row. `dirty=1` means the row needs (re)layout; `z` is NULL in 2D v1. */
export interface NodePositionRow {
  id: string;
  x: number;
  y: number;
  z: number | null;
  dirty: number;
  layout_version: number;
  updated_at: number;
}

let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;

export function getGraphDb(): Database.Database {
  const dbPath = getGraphDbPath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  ensureGraphSchema(cachedDb);
  return cachedDb;
}

/** Reset BOTH the cached db and path (calendar/granola/map gotcha) so tests rebind. */
export function closeGraphDbForTests(): void {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
}

export function ensureGraphSchema(db = getGraphDb()): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      label       TEXT NOT NULL,
      ref_path    TEXT,
      degree      INTEGER NOT NULL DEFAULT 0,
      color_key   TEXT,
      source_file TEXT,
      attrs_json  TEXT,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_type    ON graph_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_ref     ON graph_nodes(ref_path);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_srcfile ON graph_nodes(source_file);

    CREATE TABLE IF NOT EXISTS graph_edges (
      id          TEXT PRIMARY KEY,
      source_id   TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      kind        TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1,
      source_file TEXT,
      attrs_json  TEXT,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source  ON graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target  ON graph_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_kind    ON graph_edges(kind);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_srcfile ON graph_edges(source_file);

    CREATE TABLE IF NOT EXISTS node_positions (
      id             TEXT PRIMARY KEY,
      x              REAL NOT NULL,
      y              REAL NOT NULL,
      z              REAL,
      dirty          INTEGER NOT NULL DEFAULT 1,
      layout_version INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_node_positions_dirty   ON node_positions(dirty);
    CREATE INDEX IF NOT EXISTS idx_node_positions_version ON node_positions(layout_version);

    CREATE TABLE IF NOT EXISTS graph_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Node upserts / queries
// ---------------------------------------------------------------------------

export function upsertNode(node: GraphNode, sourceFile: string | null, db = getGraphDb()): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO graph_nodes (id, type, label, ref_path, degree, color_key, source_file, attrs_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      label = excluded.label,
      ref_path = excluded.ref_path,
      degree = excluded.degree,
      color_key = excluded.color_key,
      source_file = excluded.source_file,
      attrs_json = excluded.attrs_json,
      updated_at = excluded.updated_at
  `).run(
    node.id,
    node.type,
    node.label,
    node.refPath,
    node.degree,
    node.colorKey,
    sourceFile,
    JSON.stringify(node.attrs ?? {}),
    now,
  );
}

/** Batch upsert nodes in a single transaction (multi-row writes wrap in db.transaction). */
export function upsertNodes(entries: Array<{ node: GraphNode; sourceFile: string | null }>, db = getGraphDb()): void {
  db.transaction(() => {
    for (const { node, sourceFile } of entries) upsertNode(node, sourceFile, db);
  })();
}

export function getNodeById(id: string, db = getGraphDb()): GraphNode | null {
  const row = db.prepare("SELECT * FROM graph_nodes WHERE id = ?").get(id) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

export function getNodeByRefPath(refPath: string, db = getGraphDb()): GraphNode | null {
  const row = db.prepare("SELECT * FROM graph_nodes WHERE ref_path = ? LIMIT 1").get(refPath) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

/**
 * Batch-fetch nodes by id (inspector neighbor join). Chunks the IN(...) list so a
 * high-degree hub never blows SQLite's variable limit. Returns a Map keyed by id;
 * missing ids are simply absent (a dangling edge endpoint should never throw).
 */
export function getNodesByIds(ids: string[], db = getGraphDb()): Map<string, GraphNode> {
  const out = new Map<string, GraphNode>();
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const placeholders = slice.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM graph_nodes WHERE id IN (${placeholders})`).all(...slice) as NodeRow[];
    for (const row of rows) out.set(row.id, rowToNode(row));
  }
  return out;
}

/**
 * Read every node (layout pass / encoder input). Excludes `tag` nodes by default —
 * the tag layer is opt-in (Decision 4) and the force layout never lays out tag hubs.
 */
export function getAllNodes(db = getGraphDb(), includeTags = false): GraphNode[] {
  const sql = includeTags
    ? "SELECT * FROM graph_nodes ORDER BY id"
    : "SELECT * FROM graph_nodes WHERE type != 'tag' ORDER BY id";
  return (db.prepare(sql).all() as NodeRow[]).map(rowToNode);
}

/** Read every edge (layout spring input / encoder). Excludes `tag` edges by default. */
export function getAllEdges(db = getGraphDb(), includeTags = false): GraphEdge[] {
  const sql = includeTags
    ? "SELECT * FROM graph_edges ORDER BY id"
    : "SELECT * FROM graph_edges WHERE kind != 'tag' ORDER BY id";
  return (db.prepare(sql).all() as EdgeRow[]).map(rowToEdge);
}

/** Delete every node owned by a vault file (incremental delete key). */
export function deleteNodesBySourceFile(sourceFile: string, db = getGraphDb()): void {
  db.prepare("DELETE FROM graph_nodes WHERE source_file = ?").run(sourceFile);
}

// ---------------------------------------------------------------------------
// Edge upserts / queries
// ---------------------------------------------------------------------------

export function upsertEdge(edge: GraphEdge, sourceFile: string | null, db = getGraphDb()): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO graph_edges (id, source_id, target_id, kind, weight, source_file, attrs_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      target_id = excluded.target_id,
      kind = excluded.kind,
      weight = excluded.weight,
      source_file = excluded.source_file,
      attrs_json = excluded.attrs_json,
      updated_at = excluded.updated_at
  `).run(
    edge.id,
    edge.source,
    edge.target,
    edge.kind,
    edge.weight,
    sourceFile,
    JSON.stringify(edge.attrs ?? {}),
    now,
  );
}

/** Batch upsert edges in a single transaction. */
export function upsertEdges(entries: Array<{ edge: GraphEdge; sourceFile: string | null }>, db = getGraphDb()): void {
  db.transaction(() => {
    for (const { edge, sourceFile } of entries) upsertEdge(edge, sourceFile, db);
  })();
}

/** Drop a file's outbound edges before re-extracting (incremental re-extract side). */
export function deleteEdgesBySourceFile(sourceFile: string, db = getGraphDb()): void {
  db.prepare("DELETE FROM graph_edges WHERE source_file = ?").run(sourceFile);
}

/** Remove edges that dangle after a node delete (no surviving endpoint). */
export function deleteDanglingEdges(db = getGraphDb()): void {
  db.exec(`
    DELETE FROM graph_edges
    WHERE source_id NOT IN (SELECT id FROM graph_nodes)
       OR target_id NOT IN (SELECT id FROM graph_nodes)
  `);
}

/**
 * Recompute degree as COUNT(*) over graph_edges per endpoint. Drives node-size LOD
 * and the degree-0 filter; run after each build/incremental pass.
 */
export function recomputeDegrees(db = getGraphDb()): void {
  db.transaction(() => {
    db.exec("UPDATE graph_nodes SET degree = 0");
    db.exec(`
      UPDATE graph_nodes SET degree = (
        SELECT COUNT(*) FROM graph_edges
        WHERE graph_edges.source_id = graph_nodes.id
           OR graph_edges.target_id = graph_nodes.id
      )
    `);
  })();
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/**
 * Upsert a node position. The "unaffected rows unchanged" guarantee in the layout
 * pipeline relies on NOT rewriting rows whose coordinates did not change.
 */
export function upsertNodePosition(
  pos: { id: string; x: number; y: number; z?: number | null; dirty?: boolean; layoutVersion?: number },
  db = getGraphDb(),
): void {
  db.prepare(`
    INSERT INTO node_positions (id, x, y, z, dirty, layout_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      x = excluded.x,
      y = excluded.y,
      z = excluded.z,
      dirty = excluded.dirty,
      layout_version = excluded.layout_version,
      updated_at = excluded.updated_at
  `).run(
    pos.id,
    pos.x,
    pos.y,
    pos.z ?? null,
    pos.dirty === false ? 0 : 1,
    pos.layoutVersion ?? LAYOUT_VERSION,
    Date.now(),
  );
}

export function getNodePosition(id: string, db = getGraphDb()): NodePositionRow | null {
  const row = db.prepare("SELECT * FROM node_positions WHERE id = ?").get(id) as NodePositionRow | undefined;
  return row ?? null;
}

/** All persisted positions, keyed by node id (warm-start seed lookup). */
export function getAllNodePositions(db = getGraphDb()): Map<string, NodePositionRow> {
  const rows = db.prepare("SELECT * FROM node_positions").all() as NodePositionRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Node ids currently flagged dirty (the incremental relayout seed set). */
export function getDirtyNodeIds(db = getGraphDb()): string[] {
  const rows = db.prepare("SELECT id FROM node_positions WHERE dirty = 1").all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Delete position rows whose node no longer exists (orphan cleanup). */
export function deleteOrphanPositions(db = getGraphDb()): void {
  db.exec("DELETE FROM node_positions WHERE id NOT IN (SELECT id FROM graph_nodes)");
}

// ---------------------------------------------------------------------------
// graph_meta key/value store
// ---------------------------------------------------------------------------

export function setMeta(key: string, value: string, db = getGraphDb()): void {
  db.prepare(`
    INSERT INTO graph_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

/** Set several meta keys in a single transaction. */
export function setMetaMany(entries: Record<string, string>, db = getGraphDb()): void {
  db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) setMeta(key, value, db);
  })();
}

export function getMeta(key: string, db = getGraphDb()): string | null {
  const row = db.prepare("SELECT value FROM graph_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

const LAYOUT_STATES: readonly GraphLayoutState[] = ["idle", "building", "running", "frozen", "stale"];

function asLayoutState(value: string | null): GraphLayoutState {
  return value && (LAYOUT_STATES as readonly string[]).includes(value) ? (value as GraphLayoutState) : "idle";
}

function metaInt(key: string, db: Database.Database): number | null {
  const raw = getMeta(key, db);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Assemble the GraphMeta surface from `graph_meta` plus live counts. Budget
 * defaults match the plan's pinned values; the layout stage will swap in the
 * config bounded getters (graphMaxNodesMobile/Desktop) without changing this shape.
 */
export function graphMeta(enabled: boolean, db = getGraphDb()): GraphMeta {
  const nodeCount = Number((db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE type != 'tag'").get() as { c: number }).c);
  const edgeCount = Number((db.prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE kind != 'tag'").get() as { c: number }).c);
  const tagNodeCount = Number((db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE type = 'tag'").get() as { c: number }).c);
  const dirtyCount = Number((db.prepare("SELECT COUNT(*) AS c FROM node_positions WHERE dirty = 1").get() as { c: number }).c);
  const layoutState = asLayoutState(getMeta("layout_state", db));
  const lastError = getMeta("last_error", db);
  return {
    enabled,
    nodeCount,
    edgeCount,
    tagNodeCount,
    builtAt: getMeta("built_at", db),
    layoutVersion: metaInt("layout_version", db) ?? LAYOUT_VERSION,
    layoutState,
    layoutPhase: getMeta("layout_phase", db),
    nodesPlaced: metaInt("nodes_placed", db),
    totalNodes: metaInt("total_nodes", db),
    dirty: dirtyCount > 0,
    stale: layoutState === "stale",
    lastError: lastError && lastError.length > 0 ? lastError : null,
    budgets: {
      mobileMaxNodes: graphMaxNodesMobile(),
      desktopMaxNodes: graphMaxNodesDesktop(),
      defaultHops: graphDefaultHops(),
      defaultScope: { desktop: "global", mobile: "local" },
    },
  };
}

// ---------------------------------------------------------------------------
// Row mappers + helpers
// ---------------------------------------------------------------------------

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    type: row.type as GraphNode["type"],
    label: row.label,
    refPath: row.ref_path,
    degree: row.degree,
    colorKey: row.color_key,
    attrs: parseJson<Record<string, unknown>>(row.attrs_json, {}),
  };
}

export function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    source: row.source_id,
    target: row.target_id,
    kind: row.kind as GraphEdge["kind"],
    weight: row.weight,
    attrs: parseJson<Record<string, unknown>>(row.attrs_json, {}),
  };
}

/** Shared type-matching JSON parse ({} for object attrs, [] for arrays). */
export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Selection (the encoder's input — these define the SELECT policy referenced by
// the Binary Transport plan). Both return a connected node set + the edges whose
// endpoints both survived. `tag` rows are filtered by `type`/`kind` unless
// `includeTags`, so a stale `tags_built=1` never leaks tags into a default payload.
// ---------------------------------------------------------------------------

export interface GraphSelection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True if a device/limit ceiling dropped nodes from the natural result. */
  truncated: boolean;
  /** Per-policy detail for the UI "expand" affordance (local ring truncation, etc). */
  truncatedRings?: { oneHop: boolean; twoHopPlus: boolean };
}

interface SelectGlobalOptions {
  limit?: number;
  includeTags?: boolean;
  includeIsolated?: boolean;
  /**
   * Minimum (global) degree to keep. Overrides `includeIsolated` when set. The UI's
   * "hide leaves" toggle passes 2 to drop the degree-1 fringe that clutters the
   * global hairball; default (undefined) keeps the current degree>0 behavior.
   */
  minDegree?: number;
  db?: Database.Database;
}

/**
 * Global selection: every node (minus tags by default), filtered by degree. By
 * default degree-0 leaves are dropped (`includeIsolated` keeps them); `minDegree`
 * raises the floor (e.g. 2 hides single-link leaves). `limit > 0` keeps the
 * highest-degree nodes (the knowledge core); the result is the induced edge
 * subgraph over the kept set.
 */
export function selectGlobalGraph(opts: SelectGlobalOptions = {}): GraphSelection {
  const db = opts.db ?? getGraphDb();
  const includeTags = opts.includeTags ?? false;
  const includeIsolated = opts.includeIsolated ?? false;
  const limit = opts.limit && opts.limit > 0 ? Math.trunc(opts.limit) : 0;
  // Effective degree floor: explicit minDegree wins; else 0 when isolated allowed, 1 otherwise.
  const degreeFloor = Math.max(0, Math.trunc(opts.minDegree ?? (includeIsolated ? 0 : 1)));

  const where: string[] = [];
  if (!includeTags) where.push("type != 'tag'");
  if (degreeFloor > 0) where.push(`degree >= ${degreeFloor}`);
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Order by degree DESC so a limit keeps the core; tie-break by id for determinism.
  const allRows = db
    .prepare(`SELECT * FROM graph_nodes ${whereClause} ORDER BY degree DESC, id ASC`)
    .all() as NodeRow[];

  let truncated = false;
  let kept = allRows;
  if (limit > 0 && allRows.length > limit) {
    kept = allRows.slice(0, limit);
    truncated = true;
  }

  // Re-sort kept by id so the encoder's index assignment is stable across runs.
  const nodes = kept.map(rowToNode).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = inducedEdges(db, new Set(nodes.map((n) => n.id)), includeTags);
  return { nodes, edges, truncated };
}

interface SelectLocalOptions {
  nodeId: string;
  hops?: number;
  limit?: number;
  includeTags?: boolean;
  hubFanoutCap?: number;
  db?: Database.Database;
}

/**
 * Local selection: BFS from the anchor by ring. ALWAYS keep all 1-hop neighbors;
 * fill 2-hop (and beyond) by ASCENDING target degree until the cap (shed giant
 * hubs first, keep the tight neighborhood). Cap hub fan-out per node so one
 * person super-hub's 1000+ meeting edges can't swamp the set. `truncatedRings`
 * tells the UI which ring was clipped so "expand" stays connected to the anchor.
 */
export function selectLocalGraph(opts: SelectLocalOptions): GraphSelection {
  const db = opts.db ?? getGraphDb();
  const includeTags = opts.includeTags ?? false;
  const hops = Math.max(1, Math.min(3, Math.trunc(opts.hops ?? graphDefaultHops())));
  const limit = opts.limit && opts.limit > 0 ? Math.trunc(opts.limit) : 0;
  const fanoutCap = opts.hubFanoutCap ?? graphHubFanoutCap();

  const anchor = getNodeById(opts.nodeId, db);
  if (!anchor || (!includeTags && anchor.type === "tag")) {
    return { nodes: [], edges: [], truncated: false, truncatedRings: { oneHop: false, twoHopPlus: false } };
  }

  const degreeOf = (id: string): number => {
    const row = db.prepare("SELECT degree FROM graph_nodes WHERE id = ?").get(id) as { degree: number } | undefined;
    return row?.degree ?? 0;
  };

  const kept = new Set<string>([anchor.id]);
  let truncatedOneHop = false;
  let truncatedTwoHopPlus = false;
  let frontier: string[] = [anchor.id];

  for (let ring = 1; ring <= hops; ring++) {
    const nextFrontier = new Set<string>();
    for (const fromId of frontier) {
      // Neighbors of fromId via undirected edges, capping hub fan-out per node.
      let neighbors = neighborIds(db, fromId, includeTags);
      if (neighbors.length > fanoutCap) {
        // Keep the lowest-degree neighbors (drop giant hubs first), deterministic by id.
        neighbors = [...neighbors]
          .sort((a, b) => degreeOf(a) - degreeOf(b) || (a < b ? -1 : 1))
          .slice(0, fanoutCap);
        if (ring === 1) truncatedOneHop = true;
        else truncatedTwoHopPlus = true;
      }
      for (const nb of neighbors) {
        if (!kept.has(nb)) nextFrontier.add(nb);
      }
    }

    // Order this ring's candidates: ring 1 keeps everything; ring 2+ ascending degree.
    let candidates = [...nextFrontier];
    if (ring > 1) {
      candidates = candidates.sort((a, b) => degreeOf(a) - degreeOf(b) || (a < b ? -1 : 1));
    }

    const addedThisRing: string[] = [];
    for (const id of candidates) {
      if (limit > 0 && kept.size >= limit) {
        if (ring === 1) truncatedOneHop = true;
        else truncatedTwoHopPlus = true;
        break;
      }
      kept.add(id);
      addedThisRing.push(id);
    }
    frontier = addedThisRing;
    if (frontier.length === 0) break;
  }

  const idSet = kept;
  const rows = [...idSet]
    .map((id) => db.prepare("SELECT * FROM graph_nodes WHERE id = ?").get(id) as NodeRow | undefined)
    .filter((r): r is NodeRow => Boolean(r));
  const nodes = rows.map(rowToNode).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = inducedEdges(db, idSet, includeTags);
  return {
    nodes,
    edges,
    truncated: truncatedOneHop || truncatedTwoHopPlus,
    truncatedRings: { oneHop: truncatedOneHop, twoHopPlus: truncatedTwoHopPlus },
  };
}

/** Distinct undirected neighbor ids of a node (tag edges filtered unless includeTags). */
function neighborIds(db: Database.Database, id: string, includeTags: boolean): string[] {
  const tagFilter = includeTags ? "" : " AND kind != 'tag'";
  const rows = db
    .prepare(
      `SELECT target_id AS nb FROM graph_edges WHERE source_id = ?${tagFilter}
       UNION
       SELECT source_id AS nb FROM graph_edges WHERE target_id = ?${tagFilter}`,
    )
    .all(id, id) as Array<{ nb: string }>;
  return rows.map((r) => r.nb).filter((nb) => nb !== id);
}

/** Edges whose BOTH endpoints are in the kept set (induced subgraph). */
function inducedEdges(db: Database.Database, ids: Set<string>, includeTags: boolean): GraphEdge[] {
  if (ids.size === 0) return [];
  const tagFilter = includeTags ? "" : " WHERE kind != 'tag'";
  const all = db.prepare(`SELECT * FROM graph_edges${tagFilter} ORDER BY id`).all() as EdgeRow[];
  return all.filter((e) => ids.has(e.source_id) && ids.has(e.target_id)).map(rowToEdge);
}

/** Immediate edges touching a node (inspector / `/node/:id`). Tags included if asked. */
export function getEdgesForNode(id: string, db = getGraphDb(), includeTags = true): GraphEdge[] {
  const tagFilter = includeTags ? "" : " AND kind != 'tag'";
  const rows = db
    .prepare(`SELECT * FROM graph_edges WHERE (source_id = ? OR target_id = ?)${tagFilter} ORDER BY id`)
    .all(id, id) as EdgeRow[];
  return rows.map(rowToEdge);
}

/**
 * Highest-degree node id (mobile cold-open anchor fallback when no recent scope
 * resolves). Returns null on an empty graph.
 */
export function getHighestDegreeNodeId(db = getGraphDb(), includeTags = false): string | null {
  const tagFilter = includeTags ? "" : "WHERE type != 'tag'";
  const row = db
    .prepare(`SELECT id FROM graph_nodes ${tagFilter} ORDER BY degree DESC, id ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}
