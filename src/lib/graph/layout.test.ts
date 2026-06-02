import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { LAYOUT_VERSION } from "./config";
import {
  closeGraphDbForTests,
  getAllNodePositions,
  getDirtyNodeIds,
  getGraphDb,
  getMeta,
  getNodePosition,
  recomputeDegrees,
  setMetaMany,
  upsertEdges,
  upsertNodePosition,
  upsertNodes,
} from "./db";
import {
  closeLayoutEngineForTests,
  getLayoutEngine,
  getLayoutState,
  requestFullLayout,
  requestIncrementalRelayout,
  requestWarmStartLayout,
  seededPlacement,
  warmStartDecision,
} from "./layout";
import type { GraphEdge, GraphNode } from "./types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const envKeys = [
  "DATA_DIR",
  "HILT_GRAPH_DB_PATH",
  "HILT_GRAPH_ENABLED",
  "HILT_GRAPH_LAYOUT_ITERATIONS",
  "HILT_GRAPH_LAYOUT_WARM_ITERATIONS",
  "HILT_GRAPH_LAYOUT_INCREMENTAL_ITERATIONS",
  "HILT_GRAPH_LAYOUT_CHUNK_SIZE",
  "HILT_GRAPH_LAYOUT_DISABLED",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  closeGraphDbForTests();
  closeLayoutEngineForTests();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function withTempGraph(run: (db: ReturnType<typeof getGraphDb>) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-graph-layout-test-"));
  closeGraphDbForTests();
  closeLayoutEngineForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_GRAPH_DB_PATH = join(dir, "graph.sqlite");
  // Small, fast, deterministic iteration counts for the test fixtures.
  process.env.HILT_GRAPH_LAYOUT_ITERATIONS = "120";
  process.env.HILT_GRAPH_LAYOUT_WARM_ITERATIONS = "20";
  process.env.HILT_GRAPH_LAYOUT_INCREMENTAL_ITERATIONS = "40";
  process.env.HILT_GRAPH_LAYOUT_CHUNK_SIZE = "16";
  const db = getGraphDb();
  const finish = () => {
    closeGraphDbForTests();
    closeLayoutEngineForTests();
    rmSync(dir, { recursive: true, force: true });
  };
  let result: Promise<void> | void;
  try {
    result = run(db);
  } catch (err) {
    finish();
    throw err;
  }
  if (result instanceof Promise) {
    return result.then(finish, (err) => {
      finish();
      throw err;
    });
  }
  finish();
  return undefined;
}

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return { id, type: "note", label: id, refPath: `/vault/${id}.md`, degree: 0, colorKey: "note", attrs: {}, ...over };
}

function edge(source: string, target: string): GraphEdge {
  return { id: `${source}|${target}`, source, target, kind: "wikilink", weight: 1, attrs: {} };
}

/** A small connected fixture: a hub with several spokes plus a chain. */
function seedFixtureGraph(db: ReturnType<typeof getGraphDb>, n = 24): { nodeIds: string[] } {
  const nodes: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  const edges: Array<{ edge: GraphEdge; sourceFile: string | null }> = [];
  const nodeIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `note:n${i}`;
    nodeIds.push(id);
    nodes.push({ node: node(id), sourceFile: `/vault/n${i}.md` });
  }
  // Hub: n0 connects to the first third.
  for (let i = 1; i < Math.ceil(n / 3); i++) edges.push({ edge: edge("note:n0", `note:n${i}`), sourceFile: `/vault/n${i}.md` });
  // Chain: link the rest sequentially.
  for (let i = 1; i < n; i++) edges.push({ edge: edge(`note:n${i - 1}`, `note:n${i}`), sourceFile: `/vault/n${i}.md` });
  upsertNodes(nodes, db);
  upsertEdges(edges, db);
  recomputeDegrees(db);
  return { nodeIds };
}

function positionsArray(db: ReturnType<typeof getGraphDb>, ids: string[]): number[] {
  const map = getAllNodePositions(db);
  const out: number[] = [];
  for (const id of ids) {
    const p = map.get(id);
    out.push(p ? p.x : NaN, p ? p.y : NaN);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("graph layout", () => {
  test("seeded placement is deterministic per id and independent of insertion order", () => {
    const a1 = seededPlacement("note:abc");
    const a2 = seededPlacement("note:abc");
    assert.deepEqual(a1, a2);
    const b = seededPlacement("note:def");
    assert.notDeepEqual(a1, b, "different ids should not collide to the same point");
    assert.ok(Number.isFinite(a1.x) && Number.isFinite(a1.y));
  });

  test("full layout places every node and freezes (same-process determinism within epsilon)", async () => {
    await withTempGraph(async (db) => {
      const { nodeIds } = seedFixtureGraph(db);

      const r1 = await requestFullLayout("test-1", { db, sync: true });
      assert.equal(r1.ran, true);
      assert.equal(r1.blocked, false);
      assert.equal(r1.nodesPlaced, nodeIds.length);
      assert.equal(getMeta("layout_state", db), "frozen");
      assert.equal(getMeta("layout_phase", db), "frozen");
      assert.notEqual(getMeta("built_at", db), null);
      // Every node has a clean position at the current layout_version.
      assert.equal(getDirtyNodeIds(db).length, 0);
      for (const id of nodeIds) {
        const p = getNodePosition(id, db);
        assert.ok(p, `missing position for ${id}`);
        assert.equal(p!.layout_version, LAYOUT_VERSION);
        assert.equal(p!.dirty, 0);
        assert.ok(Number.isFinite(p!.x) && Number.isFinite(p!.y));
      }
      const first = positionsArray(db, nodeIds);

      // Second COLD full pass on the SAME index from the SAME seeded placement →
      // within a tight epsilon. (Clearing positions forces a cold solve, not a
      // warm-start from the prior result — guarantee (b) is seed-determinism.)
      db.exec("DELETE FROM node_positions");
      const r2 = await requestFullLayout("test-2", { db, sync: true });
      assert.equal(r2.ran, true);
      const second = positionsArray(db, nodeIds);
      for (let i = 0; i < first.length; i++) {
        assert.ok(
          Math.abs(first[i] - second[i]) < 1e-3,
          `coord ${i} drifted: ${first[i]} vs ${second[i]}`,
        );
      }
    });
  });

  test("single-flight: a second pass is blocked while one is running", async () => {
    await withTempGraph(async (db) => {
      seedFixtureGraph(db, 8);
      const eng = getLayoutEngine();
      // Simulate an in-flight pass holding the lock.
      assert.equal(eng.acquire(), true);
      const blocked = await requestFullLayout("while-running", { db, sync: true });
      assert.equal(blocked.ran, false);
      assert.equal(blocked.blocked, true);
      eng.release();
      // After release, a real pass runs.
      const ok = await requestFullLayout("after-release", { db, sync: true });
      assert.equal(ok.ran, true);
    });
  });

  test("incremental relayout touches only the dirty region; unaffected rows keep updated_at", async () => {
    await withTempGraph(async (db) => {
      const { nodeIds } = seedFixtureGraph(db, 30);
      await requestFullLayout("cold", { db, sync: true });

      // Snapshot updated_at for every row.
      const before = getAllNodePositions(db);
      const beforeUpdated = new Map([...before].map(([id, r]) => [id, r.updated_at]));

      // Dirty a single far-from-hub node (tail of the chain) + mark its row dirty.
      const changed = "note:n29";
      upsertNodePosition({ id: changed, x: before.get(changed)!.x, y: before.get(changed)!.y, dirty: true }, db);

      // Ensure clock advances so updated_at would differ if rewritten.
      const start = Date.now();
      while (Date.now() === start) {
        /* spin briefly for a distinct ms */
      }

      const res = await requestIncrementalRelayout([changed], { db, sync: true });
      assert.equal(res.ran, true);
      assert.equal(getMeta("layout_state", db), "frozen");
      assert.equal(getMeta("layout_phase", db), "frozen");
      assert.equal(getDirtyNodeIds(db).length, 0, "dirty cleared after relayout");

      // The dirty region (changed + its 1-hop neighbor n28) was rewritten.
      const after = getAllNodePositions(db);
      assert.notEqual(after.get(changed)!.updated_at, beforeUpdated.get(changed));
      assert.notEqual(after.get("note:n28")!.updated_at, beforeUpdated.get("note:n28"));

      // A node well outside the dirty region (the hub n0) was NOT rewritten.
      assert.equal(after.get("note:n0")!.updated_at, beforeUpdated.get("note:n0"));
      assert.equal(after.get("note:n0")!.x, before.get("note:n0")!.x);
      assert.equal(after.get("note:n0")!.y, before.get("note:n0")!.y);

      // rowsWritten reflects only the touched region, not the whole graph.
      assert.ok(res.rowsWritten < nodeIds.length);
      assert.ok(res.rowsWritten >= 1);
    });
  });

  test("warm-start: frozen + clean + current version => no layout needed; dirty/version-bump => needed", async () => {
    await withTempGraph(async (db) => {
      seedFixtureGraph(db, 12);
      // No positions yet.
      assert.equal(warmStartDecision(db).needsLayout, true);
      assert.equal(warmStartDecision(db).reason, "no-positions");

      await requestFullLayout("cold", { db, sync: true });
      // Now frozen + clean.
      assert.equal(warmStartDecision(db).needsLayout, false);

      // Dirty a row → needs layout.
      const ids = getDirtyNodeIds(db);
      assert.equal(ids.length, 0);
      const any = getAllNodePositions(db).keys().next().value as string;
      upsertNodePosition({ id: any, x: 0, y: 0, dirty: true }, db);
      assert.equal(warmStartDecision(db).needsLayout, true);
      assert.equal(warmStartDecision(db).reason, "dirty");

      // A warm-start pass re-freezes and clears dirty.
      const r = await requestWarmStartLayout({ db, sync: true });
      assert.equal(r.ran, true);
      assert.equal(getMeta("layout_state", db), "frozen");
      assert.equal(getDirtyNodeIds(db).length, 0);
    });
  });

  test("warm-start preserves topological stability across two passes (bounded displacement)", async () => {
    await withTempGraph(async (db) => {
      const { nodeIds } = seedFixtureGraph(db, 24);
      await requestFullLayout("cold", { db, sync: true });
      const before = positionsArray(db, nodeIds);

      // Re-running warm-start from persisted positions should not teleport nodes.
      await requestWarmStartLayout({ db, sync: true });
      const after = positionsArray(db, nodeIds);

      // Compute the layout's extent to scale the displacement bound.
      let maxAbs = 1;
      for (const v of before) maxAbs = Math.max(maxAbs, Math.abs(v));
      for (let i = 0; i < before.length; i += 2) {
        const dx = after[i] - before[i];
        const dy = after[i + 1] - before[i + 1];
        const disp = Math.hypot(dx, dy);
        assert.ok(disp < maxAbs * 0.5, `node ${i / 2} displaced ${disp} (extent ${maxAbs})`);
      }
    });
  });

  test("HILT_GRAPH_LAYOUT_DISABLED short-circuits to hash placement (no simulation)", async () => {
    await withTempGraph(async (db) => {
      process.env.HILT_GRAPH_LAYOUT_DISABLED = "true";
      const { nodeIds } = seedFixtureGraph(db, 10);
      const r = await requestFullLayout("disabled", { db, sync: true });
      assert.equal(r.disabled, true);
      assert.equal(r.nodesPlaced, nodeIds.length);
      assert.equal(getMeta("layout_state", db), "frozen");
      // Positions equal the seeded hash placement exactly.
      for (const id of nodeIds) {
        const p = getNodePosition(id, db)!;
        const seed = seededPlacement(id);
        assert.equal(p.x, seed.x);
        assert.equal(p.y, seed.y);
        assert.equal(p.dirty, 0);
      }
    });
  });

  test("getLayoutState reports frozen after a pass and surfaces a crashed running state as stale", async () => {
    await withTempGraph(async (db) => {
      seedFixtureGraph(db, 6);
      await requestFullLayout("cold", { db, sync: true });
      const view = getLayoutState(db);
      assert.equal(view.status, "frozen");
      assert.equal(view.layoutVersion, LAYOUT_VERSION);
      assert.equal(view.dirtyCount, 0);

      // Simulate a crashed pass: stored "running" but nothing in-flight.
      setMetaMany({ layout_state: "running" }, db);
      closeLayoutEngineForTests(); // no in-flight engine
      const crashed = getLayoutState(db);
      assert.equal(crashed.status, "stale", "stored running with no in-flight pass self-heals to stale");
    });
  });
});
