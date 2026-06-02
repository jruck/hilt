import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { LAYOUT_VERSION } from "./config";
import {
  closeGraphDbForTests,
  deleteDanglingEdges,
  deleteEdgesBySourceFile,
  deleteNodesBySourceFile,
  deleteOrphanPositions,
  getGraphDb,
  getMeta,
  getNodeById,
  getNodeByRefPath,
  getNodePosition,
  getNodesByIds,
  graphMeta,
  recomputeDegrees,
  selectGlobalGraph,
  setMetaMany,
  upsertEdge,
  upsertNode,
  upsertNodePosition,
} from "./db";
import type { GraphEdge, GraphNode } from "./types";

const envKeys = [
  "DATA_DIR",
  "HILT_GRAPH_DB_PATH",
  "HILT_GRAPH_MAX_NODES_MOBILE",
  "HILT_GRAPH_MAX_NODES_DESKTOP",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  closeGraphDbForTests();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function withTempGraph(run: () => void) {
  const dir = mkdtempSync(join(tmpdir(), "hilt-graph-test-"));
  closeGraphDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_GRAPH_DB_PATH = join(dir, "graph.sqlite");
  try {
    run();
  } finally {
    closeGraphDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "note",
    label: id,
    refPath: `/vault/${id}.md`,
    degree: 0,
    colorKey: "note",
    attrs: {},
    ...over,
  };
}

function makeEdge(id: string, source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id,
    source,
    target,
    kind: "wikilink",
    weight: 1,
    attrs: {},
    ...over,
  };
}

describe("graph db schema + upserts", () => {
  test("ensures all four tables with WAL", () => {
    withTempGraph(() => {
      const db = getGraphDb();
      assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((row) => row.name);
      for (const expected of ["graph_nodes", "graph_edges", "node_positions", "graph_meta"]) {
        assert.ok(tables.includes(expected), `missing table ${expected}`);
      }
    });
  });

  test("node upsert round-trips and updates every mutable column", () => {
    withTempGraph(() => {
      upsertNode(makeNode("note:a", { refPath: "/vault/a.md", attrs: { area: "infra" } }), "/vault/a.md");
      const first = getNodeById("note:a");
      assert.ok(first);
      assert.equal(first.refPath, "/vault/a.md");
      assert.deepEqual(first.attrs, { area: "infra" });

      // Conflicting upsert must overwrite label/refPath/colorKey/attrs (no stale values).
      upsertNode(
        makeNode("note:a", { label: "renamed", refPath: "/vault/a2.md", colorKey: "person", attrs: { area: "growth" } }),
        "/vault/a2.md",
      );
      const second = getNodeById("note:a");
      assert.ok(second);
      assert.equal(second.label, "renamed");
      assert.equal(second.refPath, "/vault/a2.md");
      assert.equal(second.colorKey, "person");
      assert.deepEqual(second.attrs, { area: "growth" });

      assert.equal(getNodeByRefPath("/vault/a2.md")?.id, "note:a");
    });
  });

  test("edge upsert dedupes by id and stores attrs", () => {
    withTempGraph(() => {
      const db = getGraphDb();
      upsertNode(makeNode("note:a"), "/vault/a.md");
      upsertNode(makeNode("note:b"), "/vault/b.md");
      upsertEdge(makeEdge("e1", "note:a", "note:b", { attrs: { display: "B" } }), "/vault/a.md");
      upsertEdge(makeEdge("e1", "note:a", "note:b", { weight: 2, attrs: { display: "B2" } }), "/vault/a.md");
      const count = Number((db.prepare("SELECT COUNT(*) AS c FROM graph_edges").get() as { c: number }).c);
      assert.equal(count, 1);
      const row = db.prepare("SELECT weight, attrs_json FROM graph_edges WHERE id = 'e1'").get() as { weight: number; attrs_json: string };
      assert.equal(row.weight, 2);
      assert.deepEqual(JSON.parse(row.attrs_json), { display: "B2" });
    });
  });

  test("recomputeDegrees counts both endpoints", () => {
    withTempGraph(() => {
      upsertNode(makeNode("note:a"), "/vault/a.md");
      upsertNode(makeNode("note:b"), "/vault/b.md");
      upsertNode(makeNode("note:c"), "/vault/c.md");
      upsertEdge(makeEdge("e1", "note:a", "note:b"), "/vault/a.md");
      upsertEdge(makeEdge("e2", "note:a", "note:c"), "/vault/a.md");
      recomputeDegrees();
      assert.equal(getNodeById("note:a")?.degree, 2);
      assert.equal(getNodeById("note:b")?.degree, 1);
      assert.equal(getNodeById("note:c")?.degree, 1);
    });
  });

  test("incremental delete by source_file removes node + dangling edges", () => {
    withTempGraph(() => {
      const db = getGraphDb();
      upsertNode(makeNode("note:a"), "/vault/a.md");
      upsertNode(makeNode("note:b"), "/vault/b.md");
      upsertEdge(makeEdge("e1", "note:a", "note:b"), "/vault/a.md");

      deleteEdgesBySourceFile("/vault/a.md");
      deleteNodesBySourceFile("/vault/a.md");
      deleteDanglingEdges();

      assert.equal(getNodeById("note:a"), null);
      assert.equal(getNodeById("note:b")?.id, "note:b");
      assert.equal(Number((db.prepare("SELECT COUNT(*) AS c FROM graph_edges").get() as { c: number }).c), 0);
    });
  });

  test("position upsert preserves layout_version and orphan cleanup", () => {
    withTempGraph(() => {
      upsertNode(makeNode("note:a"), "/vault/a.md");
      upsertNodePosition({ id: "note:a", x: 1.5, y: -2.5 });
      const dirty = getNodePosition("note:a");
      assert.ok(dirty);
      assert.equal(dirty.x, 1.5);
      assert.equal(dirty.dirty, 1);
      assert.equal(dirty.z, null);
      assert.equal(dirty.layout_version, LAYOUT_VERSION);

      upsertNodePosition({ id: "note:a", x: 3, y: 4, dirty: false });
      const frozen = getNodePosition("note:a");
      assert.equal(frozen?.dirty, 0);
      assert.equal(frozen?.x, 3);

      // Position for a node that no longer exists is cleaned up.
      upsertNodePosition({ id: "note:gone", x: 0, y: 0 });
      deleteOrphanPositions();
      assert.equal(getNodePosition("note:gone"), null);
      assert.equal(getNodePosition("note:a")?.id, "note:a");
    });
  });

  test("graphMeta reports counts, excludes tags, and respects bounded budgets", () => {
    withTempGraph(() => {
      process.env.HILT_GRAPH_MAX_NODES_MOBILE = "300";
      process.env.HILT_GRAPH_MAX_NODES_DESKTOP = "999999999"; // clamped to max 500000
      upsertNode(makeNode("note:a"), "/vault/a.md");
      upsertNode(makeNode("note:b"), "/vault/b.md");
      upsertNode(makeNode("tag:infra", { type: "tag", refPath: null }), null);
      upsertEdge(makeEdge("e1", "note:a", "note:b"), "/vault/a.md");
      upsertEdge(makeEdge("e2", "note:a", "tag:infra", { kind: "tag" }), null);
      setMetaMany({ layout_state: "frozen", built_at: "2026-05-30T00:00:00.000Z", total_nodes: "2", nodes_placed: "2" });

      const meta = graphMeta(true);
      assert.equal(meta.enabled, true);
      assert.equal(meta.nodeCount, 2); // tag node excluded
      assert.equal(meta.edgeCount, 1); // tag edge excluded
      assert.equal(meta.tagNodeCount, 1);
      assert.equal(meta.layoutState, "frozen");
      assert.equal(meta.stale, false);
      assert.equal(meta.builtAt, "2026-05-30T00:00:00.000Z");
      assert.equal(meta.totalNodes, 2);
      assert.equal(meta.budgets.mobileMaxNodes, 300);
      assert.equal(meta.budgets.desktopMaxNodes, 500000);
      assert.equal(meta.budgets.defaultScope.desktop, "global");
      assert.equal(meta.budgets.defaultScope.mobile, "local");
    });
  });

  test("dirty positions surface in meta.dirty", () => {
    withTempGraph(() => {
      upsertNode(makeNode("note:a"), "/vault/a.md");
      upsertNodePosition({ id: "note:a", x: 0, y: 0, dirty: true });
      assert.equal(graphMeta(true).dirty, true);
      upsertNodePosition({ id: "note:a", x: 0, y: 0, dirty: false });
      assert.equal(graphMeta(true).dirty, false);
    });
  });

  test("closeGraphDbForTests resets path so a new temp dir rebinds", () => {
    withTempGraph(() => {
      upsertNode(makeNode("note:a"), "/vault/a.md");
      assert.equal(getMeta("nonexistent"), null);
    });
    // After the first temp dir is torn down, a fresh one must start empty.
    withTempGraph(() => {
      assert.equal(getNodeById("note:a"), null);
    });
  });

  test("getNodesByIds batch-fetches, skips missing, keys by id", () => {
    withTempGraph(() => {
      upsertNode(makeNode("note:a", { label: "Alpha" }), "/vault/a.md");
      upsertNode(makeNode("note:b", { label: "Beta" }), "/vault/b.md");
      const map = getNodesByIds(["note:a", "note:b", "note:missing"]);
      assert.equal(map.size, 2);
      assert.equal(map.get("note:a")?.label, "Alpha");
      assert.equal(map.get("note:b")?.label, "Beta");
      assert.equal(map.get("note:missing"), undefined);
      assert.deepEqual(getNodesByIds([]).size, 0);
    });
  });

  test("selectGlobalGraph minDegree hides the single-link fringe", () => {
    withTempGraph(() => {
      // hub(3) — mid(2) chain plus two degree-1 leaves hanging off the hub.
      upsertNode(makeNode("note:hub"), "/vault/hub.md");
      upsertNode(makeNode("note:mid"), "/vault/mid.md");
      upsertNode(makeNode("note:leaf1"), "/vault/leaf1.md");
      upsertNode(makeNode("note:leaf2"), "/vault/leaf2.md");
      upsertNode(makeNode("note:isolated"), "/vault/isolated.md"); // degree 0
      upsertEdge(makeEdge("e1", "note:hub", "note:mid"), "/vault/hub.md");
      upsertEdge(makeEdge("e2", "note:hub", "note:leaf1"), "/vault/hub.md");
      upsertEdge(makeEdge("e3", "note:hub", "note:leaf2"), "/vault/hub.md");
      upsertEdge(makeEdge("e4", "note:mid", "note:hub2pad"), "/vault/mid.md"); // dangling-ish pad
      recomputeDegrees();

      // Default: degree-0 isolated dropped, leaves kept.
      const all = selectGlobalGraph();
      const allIds = all.nodes.map((n) => n.id).sort();
      assert.ok(allIds.includes("note:leaf1"));
      assert.ok(!allIds.includes("note:isolated"), "degree-0 node excluded by default");

      // minDegree 2: single-link leaves drop out; hub + mid (degree>=2) remain.
      const pruned = selectGlobalGraph({ minDegree: 2 });
      const prunedIds = pruned.nodes.map((n) => n.id).sort();
      assert.ok(prunedIds.includes("note:hub"));
      assert.ok(prunedIds.includes("note:mid"));
      assert.ok(!prunedIds.includes("note:leaf1"), "degree-1 leaf hidden at minDegree 2");
      assert.ok(!prunedIds.includes("note:leaf2"), "degree-1 leaf hidden at minDegree 2");
    });
  });
});
