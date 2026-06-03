import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  closeGraphDbForTests,
  getGraphDb,
  getNodeById,
  getEdgesForNode,
  getNodePosition,
  graphMeta,
  upsertNodePosition,
  upsertNodes,
} from "./db";
import {
  closeSemanticDbForTests,
  getSemanticDb,
  insertLineage,
  setMeta as setSemanticMeta,
  upsertChunk,
  upsertEntity,
  upsertItem,
  upsertItemEntity,
  upsertItemTopic,
  upsertTopic,
} from "@/lib/semantic/db";
import { l2normalize } from "@/lib/semantic/vector";
import { buildSemanticOverlay, refreshSemanticOverlayIfStale, removeSemanticOverlay } from "./semantic-overlay";
import { entityNodeId, topicNodeId } from "./build";
import type { GraphNode } from "./types";

const envKeys = [
  "DATA_DIR",
  "HILT_GRAPH_DB_PATH",
  "HILT_SEMANTIC_DB_PATH",
  "SEMANTIC_VEC_DISABLED",
  "HILT_GRAPH_SEMANTIC",
  "SEMANTIC_GRAPH_COOCCUR_MIN_ITEMS",
  "SEMANTIC_GRAPH_SIMILARITY_MIN",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

afterEach(() => {
  closeGraphDbForTests();
  closeSemanticDbForTests();
  for (const k of envKeys) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Seed both a graph db (vault nodes) and a semantic db (topics/entities/items) over temp dirs. */
function withSeededDbs(
  run: (ctx: { graphDb: ReturnType<typeof getGraphDb>; semanticDb: ReturnType<typeof getSemanticDb> }) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-overlay-test-"));
  closeGraphDbForTests();
  closeSemanticDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_GRAPH_DB_PATH = join(dir, "graph.sqlite");
  process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1"; // deterministic BLOB cosine path
  try {
    run({ graphDb: getGraphDb(), semanticDb: getSemanticDb() });
  } finally {
    closeGraphDbForTests();
    closeSemanticDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

function vaultNode(id: string, type: GraphNode["type"], absPath: string | null): { node: GraphNode; sourceFile: string | null } {
  return {
    node: { id, type, label: id, refPath: absPath, degree: 0, colorKey: type, attrs: {} },
    sourceFile: absPath,
  };
}

/** A deterministic unit vector seeded from a small int (so cosine ordering is predictable). */
function seedVec(dim: number, vals: number[]): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = vals[i % vals.length] + (i === 0 ? 0.001 * i : 0);
  return l2normalize(v);
}

/**
 * Seed: three vault items (a person, a note, a reference) + one item OUTSIDE the graph
 * (a libraries/ ref the graph excludes). Two leaf topics under a root; two entities co-
 * occurring across the person + note. Chunks give the person and note near-identical
 * vectors (so they're `similar`) and the reference a far one.
 */
function seedSemanticCorpus(semanticDb: ReturnType<typeof getSemanticDb>, dim = 8): void {
  const items: Array<{ id: string; kind: string; path: string; title: string }> = [
    { id: "person:ada", kind: "person", path: "/vault/people/ada.md", title: "Ada" },
    { id: "note:n1", kind: "note", path: "/vault/thoughts/agents.md", title: "Agents" },
    { id: "ref:r1", kind: "reference", path: "/vault/references/r1.md", title: "On Hiring" },
    { id: "ref:external", kind: "reference", path: "/vault/libraries/ext/r.md", title: "External" }, // not in graph
  ];
  for (const it of items) {
    upsertItem({ itemId: it.id, scope: it.kind === "reference" ? "library" : "vault", kind: it.kind, sourcePath: it.path, sourceFile: it.path, title: it.title, contentHash: it.id, chunkCount: 1 }, semanticDb);
  }
  // Chunks: ada & note share a near-identical vector; ref + external are far.
  const near = seedVec(dim, [1, 1, 0, 0]);
  const far = seedVec(dim, [0, 0, 1, 1]);
  upsertChunk({ id: "person:ada:0", itemId: "person:ada", ordinal: 0, text: "ada agents", embedding: near.slice(), embeddingModel: "fake" }, semanticDb);
  upsertChunk({ id: "note:n1:0", itemId: "note:n1", ordinal: 0, text: "agents arch", embedding: near.slice(), embeddingModel: "fake" }, semanticDb);
  upsertChunk({ id: "ref:r1:0", itemId: "ref:r1", ordinal: 0, text: "hiring", embedding: far.slice(), embeddingModel: "fake" }, semanticDb);
  upsertChunk({ id: "ref:external:0", itemId: "ref:external", ordinal: 0, text: "external", embedding: near.slice(), embeddingModel: "fake" }, semanticDb);

  // Topics: one root, two leaves.
  upsertTopic({ id: "T-root", level: 0, label: "Everything", itemCount: 3 }, semanticDb);
  upsertTopic({ id: "T-agents", parentId: "T-root", level: 1, label: "Agents", itemCount: 2, trendScore: 0.9 }, semanticDb);
  upsertTopic({ id: "T-hiring", parentId: "T-root", level: 1, label: "Hiring", itemCount: 1 }, semanticDb);
  upsertItemTopic("person:ada", "T-agents", 0.9, "refit", semanticDb);
  upsertItemTopic("note:n1", "T-agents", 0.8, "refit", semanticDb);
  upsertItemTopic("ref:r1", "T-hiring", 0.7, "refit", semanticDb);
  // A below-floor membership that must NOT mint an edge (score 0.3 < 0.5 default).
  upsertItemTopic("ref:r1", "T-agents", 0.3, "refit", semanticDb);
  // An item_topic for the excluded external ref — its endpoint isn't a graph node ⇒ dropped.
  upsertItemTopic("ref:external", "T-agents", 0.9, "refit", semanticDb);

  // Entities: two ideas co-occurring across ada + note (count 2 ⇒ co_occurrence edge).
  upsertEntity({ id: "E-arch", type: "idea", canonicalName: "agent architecture" }, semanticDb);
  upsertEntity({ id: "E-tools", type: "idea", canonicalName: "tool use" }, semanticDb);
  upsertEntity({ id: "E-recruit", type: "idea", canonicalName: "recruiting" }, semanticDb);
  upsertItemEntity("person:ada", "E-arch", 0.9, semanticDb);
  upsertItemEntity("person:ada", "E-tools", 0.8, semanticDb);
  upsertItemEntity("note:n1", "E-arch", 0.85, semanticDb);
  upsertItemEntity("note:n1", "E-tools", 0.6, semanticDb);
  upsertItemEntity("ref:r1", "E-recruit", 0.9, semanticDb);
  // A below-floor mention that must NOT mint an edge (0.1 < 0.3 default).
  upsertItemEntity("ref:r1", "E-arch", 0.1, semanticDb);

  // Lineage birth so the watermark is non-empty and the drill-down has history.
  insertLineage({ op: "create", newTopicId: "T-agents" }, semanticDb);
  setSemanticMeta("built_at", new Date().toISOString(), semanticDb);
  setSemanticMeta("active_version", "v0.1", semanticDb);
}

function seedVaultNodes(graphDb: ReturnType<typeof getGraphDb>): void {
  upsertNodes(
    [
      vaultNode("person:ada", "person", "/vault/people/ada.md"),
      vaultNode("note:n1", "note", "/vault/thoughts/agents.md"),
      vaultNode("ref:r1", "reference", "/vault/references/r1.md"),
      // NOTE: ref:external is intentionally NOT a graph node.
    ],
    graphDb,
  );
}

describe("semantic overlay", () => {
  test("buildSemanticOverlay upserts topic/entity nodes + edge families; pre-filters dangling", () => {
    withSeededDbs(({ graphDb, semanticDb }) => {
      seedVaultNodes(graphDb);
      seedSemanticCorpus(semanticDb);

      const result = buildSemanticOverlay({ db: graphDb, semanticDb });
      assert.equal(result.topicNodes, 3, "3 topic nodes (root + 2 leaves)");
      assert.equal(result.entityNodes, 3, "3 entity nodes");

      // Topic/entity nodes exist with the right colorKey + attrs.
      const agentsTopic = getNodeById(topicNodeId("T-agents"), graphDb);
      assert.ok(agentsTopic, "agents topic node exists");
      assert.equal(agentsTopic!.type, "topic");
      assert.equal(agentsTopic!.colorKey, "topic");
      assert.equal(agentsTopic!.attrs.level, 1);
      assert.equal(agentsTopic!.attrs.parentId, "T-root");
      assert.equal(agentsTopic!.attrs.trending, true);
      const archEntity = getNodeById(entityNodeId("E-arch"), graphDb);
      assert.ok(archEntity, "arch entity node exists");
      assert.equal(archEntity!.type, "entity");
      assert.equal(archEntity!.attrs.entityType, "idea");

      // item_topic edges: above-floor only, owning item's source_file set.
      const adaEdges = getEdgesForNode("person:ada", graphDb);
      const adaTopicEdge = adaEdges.find((e) => e.kind === "item_topic" && e.target === topicNodeId("T-agents"));
      assert.ok(adaTopicEdge, "person→T-agents item_topic edge");
      assert.equal(adaTopicEdge!.weight, 0.9);
      // The below-floor ref:r1→T-agents (0.3) edge must be absent.
      const r1Edges = getEdgesForNode("ref:r1", graphDb);
      assert.ok(!r1Edges.some((e) => e.kind === "item_topic" && e.target === topicNodeId("T-agents")), "below-floor item_topic dropped");
      assert.ok(r1Edges.some((e) => e.kind === "item_topic" && e.target === topicNodeId("T-hiring")), "above-floor item_topic kept");

      // topic_parent edges: child→parent.
      const parentEdges = getEdgesForNode(topicNodeId("T-agents"), graphDb).filter((e) => e.kind === "topic_parent");
      assert.equal(parentEdges.length, 1, "T-agents has one topic_parent edge");
      assert.equal(parentEdges[0].target, topicNodeId("T-root"), "directed child→parent");

      // item_entity edges (above salience floor) + below-floor dropped.
      const adaEntEdges = adaEdges.filter((e) => e.kind === "item_entity");
      assert.equal(adaEntEdges.length, 2, "ada mentions 2 entities above floor");
      assert.ok(!r1Edges.some((e) => e.kind === "item_entity" && e.target === entityNodeId("E-arch")), "below-floor item_entity dropped");

      // co_occurrence: E-arch ↔ E-tools share 2 items (ada, note).
      const coEdges = getEdgesForNode(entityNodeId("E-arch"), graphDb).filter((e) => e.kind === "co_occurrence");
      assert.equal(coEdges.length, 1, "one co_occurrence edge for E-arch");
      assert.equal(coEdges[0].attrs.count, 2, "co_occurrence count is 2");

      // similar: person:ada ↔ note:n1 (near vectors). ref:external must NOT appear (not a graph node).
      const simEdges = getEdgesForNode("person:ada", graphDb).filter((e) => e.kind === "similar");
      assert.ok(simEdges.some((e) => e.target === "note:n1" || e.source === "note:n1"), "ada↔note similar edge");
      assert.ok(!simEdges.some((e) => e.target === "ref:external" || e.source === "ref:external"), "external (non-graph) similar dropped");

      // No edge anywhere references the excluded external item (pre-filter correctness).
      const allEdges = graphDb.prepare("SELECT * FROM graph_edges").all() as Array<{ source_id: string; target_id: string }>;
      assert.ok(!allEdges.some((e) => e.source_id === "ref:external" || e.target_id === "ref:external"), "no dangling-by-construction edge to ref:external");

      // /meta reports the overlay counts + built marker.
      const meta = graphMeta(true, graphDb);
      assert.equal(meta.topicNodeCount, 3);
      assert.equal(meta.entityNodeCount, 3);
      assert.equal(meta.semanticBuilt, true);
    });
  });

  test("removeSemanticOverlay strips every topic/entity node + semantic edge; clears the marker", () => {
    withSeededDbs(({ graphDb, semanticDb }) => {
      seedVaultNodes(graphDb);
      seedSemanticCorpus(semanticDb);
      buildSemanticOverlay({ db: graphDb, semanticDb });

      removeSemanticOverlay(graphDb);

      const overlayNodes = graphDb.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE type IN ('topic','entity')").get() as { c: number };
      assert.equal(overlayNodes.c, 0, "no topic/entity nodes remain");
      const semEdges = graphDb
        .prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE kind IN ('item_topic','topic_parent','item_entity','co_occurrence','similar')")
        .get() as { c: number };
      assert.equal(semEdges.c, 0, "no semantic edges remain");
      // The original vault nodes survive untouched.
      assert.ok(getNodeById("person:ada", graphDb), "vault person node survives");
      const meta = graphMeta(true, graphDb);
      assert.equal(meta.semanticBuilt, false, "semantic_built cleared");
      assert.equal(meta.topicNodeCount, 0);
    });
  });

  test("empty semantic.sqlite ⇒ overlay is a no-op that clears + marks not-built", () => {
    withSeededDbs(({ graphDb, semanticDb }) => {
      seedVaultNodes(graphDb);
      // No semantic corpus seeded ⇒ watermark empty.
      const result = buildSemanticOverlay({ db: graphDb, semanticDb });
      assert.deepEqual(result, { topicNodes: 0, entityNodes: 0, edges: 0 });
      assert.equal(graphMeta(true, graphDb).semanticBuilt, false);
    });
  });

  test("refreshSemanticOverlayIfStale skips when the watermark is unchanged", () => {
    withSeededDbs(({ graphDb, semanticDb }) => {
      process.env.HILT_GRAPH_SEMANTIC = "true";
      seedVaultNodes(graphDb);
      seedSemanticCorpus(semanticDb);

      assert.equal(refreshSemanticOverlayIfStale({ db: graphDb, semanticDb }), true, "first refresh builds");
      assert.equal(refreshSemanticOverlayIfStale({ db: graphDb, semanticDb }), false, "second refresh is a no-op (watermark unchanged)");

      // Advance the watermark (a re-fit) ⇒ refresh runs again.
      setSemanticMeta("last_refit_at", new Date(Date.now() + 1000).toISOString(), semanticDb);
      assert.equal(refreshSemanticOverlayIfStale({ db: graphDb, semanticDb }), true, "refresh runs after the watermark advances");
    });
  });

  test("lineage-aware warm start copies a merged/split topic's position to the new node id", () => {
    withSeededDbs(({ graphDb, semanticDb }) => {
      seedVaultNodes(graphDb);
      seedSemanticCorpus(semanticDb);
      // Pretend an OLD topic node had a persisted position; lineage maps old→new (T-agents).
      upsertNodePosition({ id: topicNodeId("T-agents-old"), x: 42, y: -17, dirty: false }, graphDb);
      insertLineage({ op: "split", oldTopicId: "T-agents-old", newTopicId: "T-agents" }, semanticDb);
      // Bump the watermark so the seed's earlier build doesn't matter; build fresh.
      buildSemanticOverlay({ db: graphDb, semanticDb });

      const newPos = getNodePosition(topicNodeId("T-agents"), graphDb);
      assert.ok(newPos, "the new topic node inherited a position");
      assert.equal(newPos!.x, 42, "x copied from the ancestor");
      assert.equal(newPos!.y, -17, "y copied from the ancestor");
      assert.equal(newPos!.dirty, 1, "warm-started position is dirty so the relax nudges it");
    });
  });
});
