/**
 * Semantic overlay producer (Phase 2 — System → Graph integration).
 *
 * Layers topic + entity nodes and five semantic edge kinds onto the EXISTING
 * `graph_nodes`/`graph_edges` tables (not a parallel table — Graph §2), modeled exactly
 * on `buildTagLayer()`/`removeTagLayer()`. It is a pure derived view: deleting
 * `graph.sqlite` + `semantic.sqlite` and rebuilding reproduces it (Critical Constraint #2).
 *
 * Read contract (ruling R3): the overlay reads `semantic.sqlite` ONLY through the bulk
 * `query.ts` variants (`listAllTopics`/`listAllItemTopics`/`listAllEntities`/…), never
 * hand-rolled SELECTs. It then upserts into `graph.sqlite` via the same `upsertNodes`/
 * `upsertEdges` API every other producer uses.
 *
 * Reversibility: `removeSemanticOverlay()` strips every `topic`/`entity` node and every
 * semantic edge kind, recomputes degrees, and clears the `semantic_built` marker — so the
 * flag-off lifecycle is identical to the tag layer's.
 *
 * Endpoint resolution: a semantic item's id IS its graph node id (ruling R1), so an
 * `item_topic`/`item_entity` edge's item endpoint is the item id directly. The overlay
 * pre-filters EVERY edge endpoint against the live `graph_nodes` id set (Graph §2), so it
 * never mints a dangling-by-construction edge (e.g. a `libraries/` ref the graph excludes).
 */

import type Database from "better-sqlite3";
import {
  graphSemanticOverlayEnabled,
  semanticGraphCooccurMinItems,
  semanticGraphEntityMinMentions,
  semanticGraphEntityMinSalience,
  semanticGraphEntityTopK,
  semanticGraphSimilarityMin,
  semanticGraphSimilarTopM,
  semanticGraphTopicMinScore,
  semanticGraphTopicTopK,
} from "./config";
import {
  getAllNodePositions,
  getGraphDb,
  recomputeDegrees,
  setMetaMany,
  upsertEdges,
  upsertNodePosition,
  upsertNodes,
} from "./db";
import { edgeId, entityNodeId, topicNodeId } from "./build";
import type { GraphEdge, GraphNode } from "./types";
import { getSemanticDb } from "@/lib/semantic/db";
import { SEMANTIC_VERSION } from "@/lib/semantic/pipeline";
import {
  listAllEntities,
  listAllItemEntities,
  listAllItems,
  listAllItemSimilarities,
  listAllItemTopics,
  listAllLineage,
  listAllTopics,
  listEntityCoOccurrences,
  semanticWatermark,
  type ItemTopicEdge,
  type TopicNodeRow,
} from "@/lib/semantic/query";

/** The semantic node types + edge kinds this overlay owns (cleared wholesale on remove). */
const SEMANTIC_NODE_TYPES = ["topic", "entity"] as const;
const SEMANTIC_EDGE_KINDS = [
  "item_topic",
  "topic_parent",
  "item_entity",
  "co_occurrence",
  "similar",
] as const;

export interface SemanticOverlayResult {
  topicNodes: number;
  entityNodes: number;
  edges: number;
}

export interface BuildSemanticOverlayOptions {
  /** Graph db (defaults to the singleton). */
  db?: Database.Database;
  /** Semantic db (defaults to the singleton; read-only here). */
  semanticDb?: Database.Database;
}

/**
 * Rebuild the entire semantic overlay from `semantic.sqlite`. Clears the prior overlay
 * rows first (same as the tag layer's `DELETE … WHERE type='tag'` opener), then upserts
 * topic/entity nodes + the five edge families in ONE transaction ending with
 * `recomputeDegrees` and the `semantic_built`/watermark markers. A full graph rebuild
 * repaints the whole overlay; an incremental reconcile calls this when the watermark moved.
 *
 * No-op (clears + marks `semantic_built=0`) when the semantic layer hasn't built yet, so a
 * flag-on graph with an empty `semantic.sqlite` is inert rather than minting empty rows.
 */
export function buildSemanticOverlay(opts: BuildSemanticOverlayOptions = {}): SemanticOverlayResult {
  const db = opts.db ?? getGraphDb();
  const semanticDb = opts.semanticDb ?? getSemanticDb();

  const watermark = semanticWatermark(semanticDb);
  if (!watermark) {
    // Nothing built on the semantic side — strip any stale overlay and mark not-built.
    removeSemanticOverlay(db);
    return { topicNodes: 0, entityNodes: 0, edges: 0 };
  }

  // ---- Read the whole-corpus projections via query.ts (R3) ----
  const topics = listAllTopics(semanticDb);
  const itemTopics = listAllItemTopics(semanticDb);
  const entities = listAllEntities(semanticDb);
  const itemEntities = listAllItemEntities(semanticDb);
  const items = listAllItems(semanticDb);
  const coMinItems = semanticGraphCooccurMinItems();
  const cooccurrences = listEntityCoOccurrences(coMinItems, semanticDb);
  const similarities = listAllItemSimilarities(
    { minCosine: semanticGraphSimilarityMin(), topM: semanticGraphSimilarTopM() },
    semanticDb,
  );
  const lineage = listAllLineage(semanticDb);

  // ---- Live graph_nodes id set (pre-filter — never mint dangling-by-construction) ----
  const liveNodeIds = new Set(
    (db.prepare("SELECT id FROM graph_nodes WHERE type NOT IN ('topic','entity')").all() as Array<{ id: string }>).map(
      (r) => r.id,
    ),
  );
  // The item id IS the graph node id (R1). Map it to the owning abs path for edge source_file.
  const itemSourceFile = new Map(items.map((it) => [it.itemId, it.sourceFile]));

  const topicNodeEntries: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  const entityNodeEntries: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  const edgeEntries: Array<{ edge: GraphEdge; sourceFile: string | null }> = [];

  // ---- Topic nodes + topic_parent edges ----
  const topicById = new Map<string, TopicNodeRow>(topics.map((t) => [t.id, t]));
  // recentCount: members assigned by the latest incremental pass (cheap "trending" hint).
  const recentByTopic = countRecentByTopic(itemTopics);
  for (const t of topics) {
    const nodeId = topicNodeId(t.id);
    topicNodeEntries.push({
      node: {
        id: nodeId,
        type: "topic",
        label: t.label,
        refPath: null,
        degree: 0,
        colorKey: "topic",
        attrs: {
          topicId: t.id,
          level: t.level,
          parentId: t.parentId,
          memberCount: t.itemCount,
          summary: t.summary,
          trending: (t.trendScore ?? 0) > 0,
          recentCount: recentByTopic.get(t.id) ?? 0,
        },
      },
      sourceFile: null,
    });
  }
  // topic_parent: child → parent, weight 2 (structural; keep tight in layout). Both ends must exist.
  for (const t of topics) {
    if (!t.parentId || !topicById.has(t.parentId)) continue;
    const child = topicNodeId(t.id);
    const parent = topicNodeId(t.parentId);
    edgeEntries.push({
      edge: { id: edgeId(child, parent, "topic_parent"), source: child, target: parent, kind: "topic_parent", weight: 2, attrs: {} },
      sourceFile: null,
    });
  }

  // ---- item_topic edges (top-K LEAF topics per item above the score floor) ----
  // Leaf-only: an item's membership in a PARENT theme is derivable (item → leaf →
  // topic_parent → parent), so item→parent edges are pure redundancy — and they're what
  // inflated the mega-root's degree to corpus scale (a 1,148-member root collected an
  // edge per member, pinning it at MAX size and owning the label layer). With leaf-only
  // membership a parent's degree reflects its CHILD COUNT (structure), not its transitive
  // item mass — the de-emphasis half of the root-granularity ruling (see CHANGELOG).
  const parentTopicIds = new Set(topics.map((t) => t.parentId).filter((p): p is string => Boolean(p)));
  const leafItemTopics = itemTopics.filter((e) => !parentTopicIds.has(e.topicId));
  const topicMinScore = semanticGraphTopicMinScore();
  const topicTopK = semanticGraphTopicTopK();
  const builtTopicNodeIds = new Set(topicNodeEntries.map((e) => e.node.id));
  for (const [itemId, edges] of groupTopK(leafItemTopics, (e) => e.itemId, (e) => e.score, topicMinScore, topicTopK)) {
    if (!liveNodeIds.has(itemId)) continue; // item endpoint must be a real graph node
    const src = itemSourceFile.get(itemId) ?? null;
    for (const e of edges) {
      const topicNode = topicNodeId(e.topicId);
      if (!builtTopicNodeIds.has(topicNode)) continue;
      edgeEntries.push({
        edge: { id: edgeId(itemId, topicNode, "item_topic"), source: itemId, target: topicNode, kind: "item_topic", weight: e.score, attrs: { score: e.score } },
        // Owning item's abs path so deleteEdgesBySourceFile wipes it on re-digest (Graph §2/R9).
        sourceFile: src,
      });
    }
  }

  // ---- Entity nodes (mention floor: single-mention noise stays queryable, unplotted) ----
  // Gated entities also lose their item_entity/co_occurrence edges via the
  // builtEntityNodeIds endpoint check below — no dangling edges by construction.
  const entityMinMentions = semanticGraphEntityMinMentions();
  for (const e of entities) {
    if (e.mentionCount < entityMinMentions) continue;
    const nodeId = entityNodeId(e.id);
    entityNodeEntries.push({
      node: {
        id: nodeId,
        type: "entity",
        label: e.canonicalName,
        refPath: null,
        degree: 0,
        colorKey: "entity",
        attrs: { entityId: e.id, entityType: e.type, aliases: e.aliases, salienceTotal: e.salienceTotal, mentionCount: e.mentionCount },
      },
      sourceFile: null,
    });
  }
  const builtEntityNodeIds = new Set(entityNodeEntries.map((e) => e.node.id));

  // ---- item_entity edges (top-K entities per item above the salience floor) ----
  const entityMinSalience = semanticGraphEntityMinSalience();
  const entityTopK = semanticGraphEntityTopK();
  for (const [itemId, edges] of groupTopK(itemEntities, (e) => e.itemId, (e) => e.salience, entityMinSalience, entityTopK)) {
    if (!liveNodeIds.has(itemId)) continue;
    const src = itemSourceFile.get(itemId) ?? null;
    for (const e of edges) {
      const entNode = entityNodeId(e.entityId);
      if (!builtEntityNodeIds.has(entNode)) continue;
      edgeEntries.push({
        edge: { id: edgeId(itemId, entNode, "item_entity"), source: itemId, target: entNode, kind: "item_entity", weight: e.salience, attrs: { salience: e.salience } },
        sourceFile: src,
      });
    }
  }

  // ---- co_occurrence edges (entity ↔ entity, sentinel source_file) ----
  for (const c of cooccurrences) {
    const a = entityNodeId(c.entityA);
    const b = entityNodeId(c.entityB);
    if (!builtEntityNodeIds.has(a) || !builtEntityNodeIds.has(b)) continue;
    edgeEntries.push({
      edge: { id: edgeId(a, b, "co_occurrence"), source: a, target: b, kind: "co_occurrence", weight: c.count, attrs: { count: c.count } },
      sourceFile: null,
    });
  }

  // ---- similar edges (item ↔ item KNN, sentinel source_file) ----
  for (const s of similarities) {
    if (!liveNodeIds.has(s.itemA) || !liveNodeIds.has(s.itemB)) continue;
    const [a, b] = s.itemA < s.itemB ? [s.itemA, s.itemB] : [s.itemB, s.itemA];
    edgeEntries.push({
      edge: { id: edgeId(a, b, "similar"), source: a, target: b, kind: "similar", weight: s.cosine, attrs: { cosine: s.cosine } },
      // Sentinel null: similar edges aren't owned by a single re-digested file.
      sourceFile: null,
    });
  }

  // ---- Lineage-aware position warm-start (copy ancestor topic node positions) ----
  warmStartTopicPositions(db, lineage, topicById);

  db.transaction(() => {
    clearSemanticRows(db);
    upsertNodes([...topicNodeEntries, ...entityNodeEntries], db);
    upsertEdges(edgeEntries, db);
    recomputeDegrees(db);
    setMetaMany({ semantic_built: "1", semantic_version: SEMANTIC_VERSION, semantic_watermark: watermark }, db);
  })();

  return { topicNodes: topicNodeEntries.length, entityNodes: entityNodeEntries.length, edges: edgeEntries.length };
}

/**
 * Strip the entire semantic overlay (every topic/entity node + every semantic edge kind),
 * recompute degrees, and clear the `semantic_built` marker. Cheap and non-invalidating,
 * exactly like `removeTagLayer()` — the flag-off / disable path.
 */
export function removeSemanticOverlay(db = getGraphDb()): void {
  db.transaction(() => {
    clearSemanticRows(db);
    recomputeDegrees(db);
    setMetaMany({ semantic_built: "0", semantic_watermark: "" }, db);
  })();
}

/** Refresh the overlay only when the semantic watermark advanced past the graph's record. */
export function refreshSemanticOverlayIfStale(opts: BuildSemanticOverlayOptions = {}): boolean {
  if (!graphSemanticOverlayEnabled()) return false;
  const db = opts.db ?? getGraphDb();
  const semanticDb = opts.semanticDb ?? getSemanticDb();
  const current = semanticWatermark(semanticDb);
  const recorded = (db.prepare("SELECT value FROM graph_meta WHERE key = 'semantic_watermark'").get() as { value: string } | undefined)?.value ?? "";
  if (current === recorded) return false;
  buildSemanticOverlay({ db, semanticDb });
  return true;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** DELETE every overlay node + every semantic edge kind (the shared clear used by build/remove). */
function clearSemanticRows(db: Database.Database): void {
  const typeList = SEMANTIC_NODE_TYPES.map((t) => `'${t}'`).join(",");
  const kindList = SEMANTIC_EDGE_KINDS.map((k) => `'${k}'`).join(",");
  db.exec(`DELETE FROM graph_edges WHERE kind IN (${kindList}); DELETE FROM graph_nodes WHERE type IN (${typeList});`);
}

/**
 * Group rows by a key, keep only those whose score clears `floor`, and cap each group to
 * its top-`k` by score (descending; stable by the secondary key already imposed by the
 * SQL ORDER BY). Used for both item_topic (top-K topics) and item_entity (top-K entities).
 */
function groupTopK<T>(
  rows: T[],
  keyOf: (r: T) => string,
  scoreOf: (r: T) => number,
  floor: number,
  k: number,
): Map<string, T[]> {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    if (scoreOf(r) < floor) continue;
    const key = keyOf(r);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  for (const [key, list] of byKey) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a));
    if (list.length > k) byKey.set(key, list.slice(0, k));
  }
  return byKey;
}

/** Count how many of a topic's memberships were assigned incrementally (recent activity). */
function countRecentByTopic(itemTopics: ItemTopicEdge[]): Map<string, number> {
  // ItemTopicEdge doesn't carry assigned_by; recentCount falls back to total membership here
  // (the topic node's `memberCount` already carries the same figure). Kept as a hook for a
  // future assigned_by projection without changing the node attrs shape.
  const out = new Map<string, number>();
  for (const it of itemTopics) out.set(it.topicId, (out.get(it.topicId) ?? 0) + 1);
  return out;
}

/**
 * For each lineage hop (old → new) involving a still-living topic, copy the OLD topic
 * node's persisted position to the NEW topic node id (dirty: true) so a re-fit warm-starts
 * the moved topic from its ancestor's location instead of snapping to (0,0). Entity ids are
 * stable post-resolution, so entity nodes warm-start cleanly with no lineage step (Graph §5).
 */
function warmStartTopicPositions(
  db: Database.Database,
  lineage: Array<{ oldTopicId: string | null; newTopicId: string | null }>,
  livingTopics: Map<string, unknown>,
): void {
  if (lineage.length === 0) return;
  const positions = getAllNodePositions(db);
  for (const hop of lineage) {
    if (!hop.oldTopicId || !hop.newTopicId) continue;
    if (hop.oldTopicId === hop.newTopicId) continue;
    if (!livingTopics.has(hop.newTopicId)) continue; // only warm-start a topic that still exists
    const oldPos = positions.get(topicNodeId(hop.oldTopicId));
    if (!oldPos) continue;
    const newNodeId = topicNodeId(hop.newTopicId);
    if (positions.has(newNodeId)) continue; // already has a position — don't clobber
    upsertNodePosition({ id: newNodeId, x: oldPos.x, y: oldPos.y, z: oldPos.z, dirty: true }, db);
  }
}
