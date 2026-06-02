import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  closeGraphDbForTests,
  getGraphDb,
  selectGlobalGraph,
  selectLocalGraph,
  upsertEdges,
  upsertNodePosition,
  upsertNodes,
  type GraphSelection,
  type NodePositionRow,
} from "./db";
import {
  decodeGraphBinary,
  encodeFromParts,
  encodeGraphBinary,
  FLAG_INCLUDES_TAGS,
  FLAG_IS_LOCAL,
  FLAG_TRUNCATED,
  folderGroupOf,
  GRAPH_MAGIC,
  NODE_TYPE_ORDER,
} from "./encode";
import { TRANSPORT_FORMAT_VERSION } from "./config";
import { GraphFormatError, type GraphEdge, type GraphNode } from "./types";

// ---------------------------------------------------------------------------
// Harness (mirrors db.test.ts / layout.test.ts)
// ---------------------------------------------------------------------------

const envKeys = ["DATA_DIR", "HILT_GRAPH_DB_PATH"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  closeGraphDbForTests();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function withTempGraph(run: (db: ReturnType<typeof getGraphDb>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-graph-encode-test-"));
  closeGraphDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_GRAPH_DB_PATH = join(dir, "graph.sqlite");
  try {
    run(getGraphDb());
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

function makeEdge(source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: `${source}|${target}`,
    source,
    target,
    kind: "wikilink",
    weight: 1,
    attrs: {},
    ...over,
  };
}

function positionMap(entries: Array<[string, number, number]>): Map<string, NodePositionRow> {
  return new Map(
    entries.map(([id, x, y]) => [
      id,
      { id, x, y, z: null, dirty: 0, layout_version: 1, updated_at: 0 },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Encode / decode round-trip
// ---------------------------------------------------------------------------

describe("graph encode/decode", () => {
  test("round-trips structurally equal; EDGES decode as Float32Array", () => {
    const nodes = [
      makeNode("a", { type: "note", colorKey: "note", label: "Alpha" }),
      makeNode("b", { type: "person", colorKey: "person", label: "Bravo" }),
      makeNode("c", { type: "project", colorKey: "area:foo", label: "Charlie" }),
    ];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const selection: GraphSelection = { nodes, edges, truncated: false };
    const positions = positionMap([
      ["a", 1.5, -2.5],
      ["b", 3, 4],
      ["c", -10, 20],
    ]);

    const buffer = encodeFromParts(nodes, edges, positions, {
      isLocal: false,
      includesTags: false,
      truncated: false,
    });
    const decoded = decodeGraphBinary(buffer);

    assert.equal(decoded.version, TRANSPORT_FORMAT_VERSION);
    assert.equal(decoded.nodeCount, 3);
    assert.equal(decoded.edgeCount, 2);

    // Positions index-aligned to nodes[] (a=0, b=1, c=2).
    assert.ok(decoded.positions instanceof Float32Array);
    assert.equal(decoded.positions.length, 6);
    assert.ok(Math.abs(decoded.positions[0] - 1.5) < 1e-5); // a.x
    assert.ok(Math.abs(decoded.positions[1] + 2.5) < 1e-5); // a.y
    assert.ok(Math.abs(decoded.positions[4] + 10) < 1e-5); // c.x

    // EDGES is Float32Array of point ARRAY INDICES.
    assert.ok(decoded.links instanceof Float32Array, "links must be Float32Array");
    assert.deepEqual(Array.from(decoded.links), [0, 1, 1, 2]);

    // Sidecar index-aligned; types interned to ordinals; refPaths absent.
    assert.deepEqual(decoded.sidecar.ids, ["a", "b", "c"]);
    assert.deepEqual(decoded.sidecar.labels, ["Alpha", "Bravo", "Charlie"]);
    assert.deepEqual(decoded.sidecar.types, [
      NODE_TYPE_ORDER.indexOf("note"),
      NODE_TYPE_ORDER.indexOf("person"),
      NODE_TYPE_ORDER.indexOf("project"),
    ]);
    assert.ok(!("refPaths" in decoded.sidecar), "refPaths must NOT be in the bulk sidecar");

    // colorKeys index into the colorKeyTable.
    assert.ok(decoded.colorKeys instanceof Uint8Array);
    assert.equal(decoded.colorKeys.length, 3);
    assert.equal(decoded.sidecar.colorKeyTable[decoded.colorKeys[0]], "note");
    assert.equal(decoded.sidecar.colorKeyTable[decoded.colorKeys[2]], "area:foo");

    // Suppress unused warning while keeping the selection-shaped fixture explicit.
    assert.equal(selection.nodes.length, 3);
  });

  test("header carries magic + TRANSPORT_FORMAT_VERSION; bad magic/version throws GraphFormatError", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const buffer = encodeFromParts(nodes, [makeEdge("a", "b")], positionMap([["a", 0, 0], ["b", 1, 1]]), {
      isLocal: false,
      includesTags: false,
      truncated: false,
    });
    const u32 = new Uint32Array(buffer, 0, 8);
    assert.equal(u32[0], GRAPH_MAGIC);
    assert.equal(u32[1], TRANSPORT_FORMAT_VERSION);

    // Corrupt the magic.
    const badMagic = buffer.slice(0);
    new Uint32Array(badMagic, 0, 1)[0] = 0xdeadbeef;
    assert.throws(() => decodeGraphBinary(badMagic), GraphFormatError);

    // Corrupt the version.
    const badVersion = buffer.slice(0);
    new Uint32Array(badVersion, 4, 1)[0] = TRANSPORT_FORMAT_VERSION + 99;
    assert.throws(() => decodeGraphBinary(badVersion), GraphFormatError);

    // Truncated buffer.
    assert.throws(() => decodeGraphBinary(new ArrayBuffer(8)), GraphFormatError);
  });

  test("non-finite / missing positions are sanitized to 0 (never ship NaN/Infinity)", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    // 'a' has NaN, 'b' missing entirely, 'c' valid.
    const positions = new Map<string, NodePositionRow>([
      ["a", { id: "a", x: NaN, y: Infinity, z: null, dirty: 0, layout_version: 1, updated_at: 0 }],
      ["c", { id: "c", x: 5, y: 6, z: null, dirty: 0, layout_version: 1, updated_at: 0 }],
    ]);
    const buffer = encodeFromParts(nodes, [], positions, { isLocal: false, includesTags: false, truncated: false });
    const decoded = decodeGraphBinary(buffer);
    for (const v of decoded.positions) {
      assert.ok(Number.isFinite(v), "no NaN/Infinity in positions");
    }
    assert.equal(decoded.positions[0], 0); // a.x sanitized
    assert.equal(decoded.positions[2], 0); // b.x defaulted
    assert.equal(decoded.positions[4], 5); // c.x preserved
  });

  test("flags round-trip; edges with a missing endpoint are dropped", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    // Edge 'b->ghost' references a node not in the selection — must be dropped.
    const edges = [makeEdge("a", "b"), makeEdge("b", "ghost")];
    const buffer = encodeFromParts(nodes, edges, positionMap([["a", 0, 0], ["b", 1, 1]]), {
      isLocal: true,
      includesTags: true,
      truncated: true,
    });
    const decoded = decodeGraphBinary(buffer);
    assert.equal(decoded.edgeCount, 1);
    assert.deepEqual(Array.from(decoded.links), [0, 1]);
    assert.ok(decoded.isLocal);
    assert.ok(decoded.includesTags);
    assert.ok(decoded.truncated);

    const flagBits = new Uint32Array(buffer, 0, 8)[4];
    assert.ok((flagBits & FLAG_IS_LOCAL) !== 0);
    assert.ok((flagBits & FLAG_INCLUDES_TAGS) !== 0);
    assert.ok((flagBits & FLAG_TRUNCATED) !== 0);
  });

  test("empty selection encodes/decodes to zero-length payload", () => {
    const buffer = encodeFromParts([], [], new Map(), { isLocal: false, includesTags: false, truncated: false });
    const decoded = decodeGraphBinary(buffer);
    assert.equal(decoded.nodeCount, 0);
    assert.equal(decoded.edgeCount, 0);
    assert.equal(decoded.positions.length, 0);
    assert.equal(decoded.links.length, 0);
    assert.deepEqual(decoded.sidecar.ids, []);
  });
});

// ---------------------------------------------------------------------------
// Selection helpers (the encoder's input policy)
// ---------------------------------------------------------------------------

describe("folder grouping", () => {
  test("folderGroupOf maps to top-level vault folder / people / type fallback", () => {
    const root = "/vault";
    assert.equal(folderGroupOf(makeNode("a", { refPath: "/vault/meetings/2026/m.md" }), root), "meetings");
    assert.equal(folderGroupOf(makeNode("b", { refPath: "/vault/projects/x/index.md" }), root), "projects");
    assert.equal(folderGroupOf(makeNode("c", { type: "person", refPath: "jane-doe" }), root), "people");
    assert.equal(folderGroupOf(makeNode("d", { type: "reference", refPath: "/vault/references/r.md" }), root), "references");
    // Path outside the vault root → parent-dir basename fallback.
    assert.equal(folderGroupOf(makeNode("e", { refPath: "/elsewhere/topic/n.md" }), root), "topic");
    // No vault root → type fallback for a synthetic-ish node with no usable path.
    assert.equal(folderGroupOf(makeNode("f", { type: "tag", refPath: null }), undefined), "tag");
  });

  test("sidecar ships interned folders + folderTable indexed per node", () => {
    const nodes = [
      makeNode("a", { refPath: "/vault/meetings/m1.md" }),
      makeNode("b", { refPath: "/vault/meetings/m2.md" }),
      makeNode("c", { type: "project", refPath: "/vault/projects/p.md" }),
    ];
    const buffer = encodeFromParts(nodes, [], positionMap([["a", 0, 0], ["b", 1, 1], ["c", 2, 2]]), {
      isLocal: false,
      includesTags: false,
      truncated: false,
      vaultRoot: "/vault",
    });
    const decoded = decodeGraphBinary(buffer);
    const { folders, folderTable } = decoded.sidecar;
    assert.ok(folders && folderTable, "sidecar carries folders + folderTable");
    // Two meetings share one interned slot; the project gets its own.
    assert.equal(folderTable!.length, 2);
    assert.equal(folderTable![folders![0]], "meetings");
    assert.equal(folders![0], folders![1]);
    assert.equal(folderTable![folders![2]], "projects");
  });
});

describe("graph selection", () => {
  test("selectGlobalGraph hides degree-0 leaves by default, includeIsolated shows them", () => {
    withTempGraph((db) => {
      upsertNodes(
        [
          { node: makeNode("a", { degree: 2 }), sourceFile: "/a.md" },
          { node: makeNode("b", { degree: 1 }), sourceFile: "/b.md" },
          { node: makeNode("iso", { degree: 0 }), sourceFile: "/iso.md" },
        ],
        db,
      );
      upsertEdges([{ edge: makeEdge("a", "b"), sourceFile: "/a.md" }], db);

      const def = selectGlobalGraph({ db });
      assert.deepEqual(
        def.nodes.map((n) => n.id).sort(),
        ["a", "b"],
        "degree-0 'iso' excluded by default",
      );
      assert.equal(def.edges.length, 1);

      const withIso = selectGlobalGraph({ db, includeIsolated: true });
      assert.ok(withIso.nodes.some((n) => n.id === "iso"));
    });
  });

  test("selectGlobalGraph filters tags by type and limit keeps the highest-degree core", () => {
    withTempGraph((db) => {
      upsertNodes(
        [
          { node: makeNode("hub", { degree: 5 }), sourceFile: "/hub.md" },
          { node: makeNode("mid", { degree: 2 }), sourceFile: "/mid.md" },
          { node: makeNode("low", { degree: 1 }), sourceFile: "/low.md" },
          { node: makeNode("t1", { type: "tag", degree: 3, colorKey: "tag" }), sourceFile: null },
        ],
        db,
      );
      upsertEdges(
        [
          { edge: makeEdge("hub", "mid"), sourceFile: "/hub.md" },
          { edge: makeEdge("hub", "low"), sourceFile: "/hub.md" },
        ],
        db,
      );

      const noTags = selectGlobalGraph({ db });
      assert.ok(!noTags.nodes.some((n) => n.type === "tag"), "tags filtered by type");

      const capped = selectGlobalGraph({ db, limit: 2 });
      assert.equal(capped.nodes.length, 2);
      assert.ok(capped.truncated);
      assert.ok(capped.nodes.some((n) => n.id === "hub"), "highest-degree node kept under limit");
    });
  });

  test("selectLocalGraph BFS keeps the set connected to the anchor and caps hub fan-out", () => {
    withTempGraph((db) => {
      // person hub fans out to 8 meeting notes; a 'far' node is 2 hops out.
      const nodes: Array<{ node: GraphNode; sourceFile: string | null }> = [
        { node: makeNode("person:p", { type: "person", degree: 9 }), sourceFile: null },
      ];
      const edges: Array<{ edge: GraphEdge; sourceFile: string | null }> = [];
      for (let i = 0; i < 8; i++) {
        nodes.push({ node: makeNode(`m${i}`, { degree: i === 0 ? 2 : 1 }), sourceFile: `/m${i}.md` });
        edges.push({ edge: makeEdge("person:p", `m${i}`, { kind: "meeting" }), sourceFile: `/m${i}.md` });
      }
      nodes.push({ node: makeNode("far", { degree: 1 }), sourceFile: "/far.md" });
      edges.push({ edge: makeEdge("m0", "far"), sourceFile: "/m0.md" });
      upsertNodes(nodes, db);
      upsertEdges(edges, db);

      // Hub fan-out cap of 3 should keep only 3 of the 8 1-hop meetings.
      const local = selectLocalGraph({ nodeId: "person:p", hops: 2, hubFanoutCap: 3, db });
      assert.ok(local.nodes.some((n) => n.id === "person:p"), "anchor present");
      assert.ok(local.truncatedRings?.oneHop, "1-hop ring flagged truncated by the fan-out cap");
      // Every kept edge has both endpoints in the kept set (connected to anchor).
      const ids = new Set(local.nodes.map((n) => n.id));
      for (const e of local.edges) {
        assert.ok(ids.has(e.source) && ids.has(e.target));
      }

      // Unresolvable anchor → empty selection (route degrades to highest-degree fallback).
      const missing = selectLocalGraph({ nodeId: "nope", db });
      assert.equal(missing.nodes.length, 0);
    });
  });

  test("encodeGraphBinary reads persisted positions from the DB", () => {
    withTempGraph((db) => {
      upsertNodes(
        [
          { node: makeNode("a", { degree: 1 }), sourceFile: "/a.md" },
          { node: makeNode("b", { degree: 1 }), sourceFile: "/b.md" },
        ],
        db,
      );
      upsertEdges([{ edge: makeEdge("a", "b"), sourceFile: "/a.md" }], db);
      upsertNodePosition({ id: "a", x: 11, y: 22, dirty: false }, db);
      upsertNodePosition({ id: "b", x: 33, y: 44, dirty: false }, db);

      const selection = selectGlobalGraph({ db });
      const buffer = encodeGraphBinary(selection, { isLocal: false, includesTags: false });
      const decoded = decodeGraphBinary(buffer);
      // a,b sorted by id → index 0,1.
      assert.equal(decoded.positions[0], 11);
      assert.equal(decoded.positions[1], 22);
      assert.equal(decoded.positions[2], 33);
      assert.equal(decoded.positions[3], 44);
    });
  });
});
