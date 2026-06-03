/**
 * Topic orchestrator (P2.2, spec §C.1) — the global re-fit that turns embeddings into the
 * emergent, hierarchical, evolving topic taxonomy. The GraphRAG-spine/BERTopic-body shape:
 *
 *   gather chunk embeddings → runClustering (injected sidecar seam, R6) → warm-start id
 *   inheritance from prior centroids → labelTopics (injected LLM seam, R7) → persist
 *   topics/item_topics → diff prior↔new membership into topic_lineage.
 *
 * Everything is injected: `runClustering` (real `uv` sidecar / fake in tests) and the
 * `SemanticLlmClient.labelTopics` labeler (real Gemini-or-Claude / fake in tests). So the
 * whole orchestrator runs offline in CI with deterministic fakes, and the heavy path only
 * fires in the scheduled CLI. If clustering ABSTAINS (uv missing / unparseable → null) the
 * re-fit is a graceful no-op (incremental assignment still slots new items): topics stay
 * as they were, nothing is dropped.
 *
 * Determinism: topic ids are minted from the SORTED member-item set (hashId), so identical
 * membership reproduces identical ids and a stable topic naturally carries its id across
 * re-fits; warm-start additionally lets a topic whose centroid matches a prior topic adopt
 * that prior id even when membership shifted, so the taxonomy doesn't thrash.
 */

import type Database from "better-sqlite3";
import { hashId } from "@/lib/library/utils";
import { semanticLineageCos } from "./config";
import {
  clearTopics,
  getAllItemTopics,
  getLeafTopicCentroids,
  getSemanticDb,
  getTopicCentroids,
  insertLineage,
  recomputeTopicItemCounts,
  setMeta,
  upsertItemTopic,
  upsertTopic,
  type TopicCentroid,
} from "./db";
import type { SemanticLlmClient, TopicLabelInput } from "./gemini";
import { diffLineage, membershipFromRows, type LineageEvent, type Membership } from "./lineage";
import { SEMANTIC_EMBEDDING_MODEL } from "./pipeline";
import type { ClusterInput, ClusterNode, RunClustering } from "./cluster";
import { runClusteringSidecar } from "./cluster";
import { blobToFloat32, cosineSimilarity, l2normalize } from "./vector";

export interface RefitOptions {
  client: SemanticLlmClient;
  /** Injected clustering seam; defaults to the real `uv` sidecar (ruling R6). */
  runClustering?: RunClustering;
  db?: Database.Database;
  clusterParams?: ClusterInput["params"];
}

export interface RefitResult {
  /** False ⇒ clustering abstained (sidecar/uv missing or unparseable) — taxonomy unchanged. */
  ran: boolean;
  topics: number;
  rootTopics: number;
  leafTopics: number;
  itemsAssigned: number;
  outliers: number;
  lineage: Record<LineageEvent["op"], number>;
}

interface ChunkVec {
  chunkId: string;
  itemId: string;
  vec: Float32Array;
  text: string;
}

/** Read every embedded chunk (the clustering corpus) at the current version. */
function gatherChunks(db: Database.Database): ChunkVec[] {
  const rows = db
    .prepare("SELECT id, item_id, text, embedding_blob FROM chunks WHERE embedding_blob IS NOT NULL ORDER BY id")
    .all() as Array<{ id: string; item_id: string; text: string; embedding_blob: Buffer }>;
  return rows.map((r) => ({ chunkId: r.id, itemId: r.item_id, text: r.text, vec: blobToFloat32(r.embedding_blob) }));
}

/** Mint a deterministic topic id from its sorted member-item set (stable across re-fits). */
function topicIdForMembers(itemIds: Iterable<string>): string {
  const sorted = [...new Set(itemIds)].sort();
  return `topic:${hashId(sorted.join("|"))}`;
}

/** Keep only the membership entries whose topic id is in `keep`. */
function filterMembership(m: Membership, keep: Set<string>): Membership {
  const out: Membership = new Map();
  for (const [topicId, items] of m) if (keep.has(topicId)) out.set(topicId, items);
  return out;
}

const EMPTY_LINEAGE = (): Record<LineageEvent["op"], number> => ({ carry: 0, split: 0, merge: 0, birth: 0, death: 0 });

/**
 * Run a full global topic re-fit. Returns `ran:false` (no-op) when clustering abstains or
 * the corpus is empty. Otherwise rebuilds the topic set for the current SEMANTIC_VERSION
 * and records lineage against the prior membership.
 */
export async function runTopicRefit(opts: RefitOptions): Promise<RefitResult> {
  const db = opts.db ?? getSemanticDb();
  const cluster = opts.runClustering ?? runClusteringSidecar;
  const lineageCos = semanticLineageCos();

  const chunks = gatherChunks(db);
  const result: RefitResult = {
    ran: false,
    topics: 0,
    rootTopics: 0,
    leafTopics: 0,
    itemsAssigned: 0,
    outliers: 0,
    lineage: EMPTY_LINEAGE(),
  };
  if (chunks.length === 0) return result;

  // Snapshot the prior LEAF membership + centroids BEFORE we clear (lineage + warm-start
  // inputs). Lineage is a leaf-level concern: a parent contains its children's items, so
  // diffing parents would spuriously read as split/merge — we diff only the clustering units.
  const priorLeafIds = new Set(
    (db.prepare("SELECT id FROM topics t WHERE NOT EXISTS (SELECT 1 FROM topics c WHERE c.parent_id = t.id)").all() as Array<{ id: string }>).map((r) => r.id),
  );
  const priorMembership = filterMembership(membershipFromRows(getAllItemTopics(db)), priorLeafIds);
  const priorCentroids = getTopicCentroids(db);

  // --- Cluster (injected seam) -------------------------------------------------
  const clustered = await cluster({
    vectors: chunks.map((c) => Array.from(c.vec)),
    ids: chunks.map((c) => c.chunkId),
    params: opts.clusterParams,
    warmStart: { centroids: priorCentroids.map((c) => ({ topicId: c.id, centroid: Array.from(c.vec) })) },
  });
  if (!clustered || clustered.hierarchy.length === 0) return result; // abstain ⇒ taxonomy unchanged

  const chunkToItem = new Map(chunks.map((c) => [c.chunkId, c.itemId]));
  const chunkText = new Map(chunks.map((c) => [c.chunkId, c.text]));
  const probByChunk = new Map(clustered.assignments.map((a) => [a.id, a.probability]));

  // --- Assemble persistable topics from the hierarchy --------------------------
  // Each cluster node → a topic. Roll its chunk members up to items (item in topic T if any
  // of its chunks landed in T; score = max chunk probability). Centroid from the sidecar
  // (original embedding space) is the incremental-assignment anchor.
  interface PreparedTopic {
    node: ClusterNode;
    itemScores: Map<string, number>; // itemId → max chunk probability
    centroid: Float32Array | null;
    id: string; // assigned after warm-start
  }

  const prepared: PreparedTopic[] = [];
  for (const node of clustered.hierarchy) {
    const itemScores = new Map<string, number>();
    for (const chunkId of node.memberIds) {
      const itemId = chunkToItem.get(chunkId);
      if (!itemId) continue;
      const prob = probByChunk.get(chunkId) ?? 0;
      const prev = itemScores.get(itemId);
      if (prev === undefined || prob > prev) itemScores.set(itemId, prob);
    }
    const centroid = node.centroid.length > 0 ? l2normalize(Float32Array.from(node.centroid)) : null;
    prepared.push({ node, itemScores, centroid, id: "" });
  }

  // --- Warm-start id inheritance ----------------------------------------------
  // First mint each topic's deterministic membership-based id. Then, for any topic whose
  // centroid matches a (still-unclaimed) prior topic's centroid within the lineage floor,
  // ADOPT the prior id so a topic that drifted but is recognizably the same keeps identity.
  const claimedPrior = new Set<string>();
  for (const t of prepared) t.id = topicIdForMembers(t.itemScores.keys());

  // Greedy best-match warm-start, processed in deterministic (sorted minted-id) order.
  const byMintedId = [...prepared].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const t of byMintedId) {
    if (!t.centroid || priorCentroids.length === 0) continue;
    let best: { id: string; score: number } | null = null;
    for (const pc of priorCentroids) {
      if (claimedPrior.has(pc.id)) continue;
      const score = cosineSimilarity(t.centroid, pc.vec);
      if (score >= lineageCos && (!best || score > best.score)) best = { id: pc.id, score };
    }
    if (best) {
      claimedPrior.add(best.id);
      t.id = best.id;
    }
  }

  // Map sidecar cluster_id → assigned topic id, so parent links resolve to topic ids.
  const clusterToTopic = new Map(prepared.map((t) => [t.node.clusterId, t.id]));

  // --- Label (injected LLM seam) ----------------------------------------------
  // One labeling call over every cluster; a cluster the labeler skips falls back to a
  // synthetic label so a topic is never unnamed.
  const labelInputs: TopicLabelInput[] = prepared.map((t) => ({
    clusterId: t.node.clusterId,
    sampleTexts: t.node.memberIds
      .map((cid) => chunkText.get(cid))
      .filter((s): s is string => Boolean(s))
      .slice(0, 8),
  }));
  let labels: Awaited<ReturnType<SemanticLlmClient["labelTopics"]>> = [];
  try {
    labels = await opts.client.labelTopics(labelInputs);
  } catch {
    labels = []; // fail-soft: synthetic labels below
  }
  const labelByCluster = new Map(labels.map((l) => [l.clusterId, l]));

  // Leaf = a prepared topic no other prepared topic parents (the clustering units; lineage
  // is diffed over these, not the parent themes whose membership is the union of children).
  const parentedClusterIds = new Set(prepared.map((t) => t.node.parentId).filter((p): p is string => Boolean(p)));
  const isLeaf = (t: PreparedTopic): boolean => !parentedClusterIds.has(t.node.clusterId);

  // --- Persist (one transaction) ----------------------------------------------
  const newMembershipRows: Array<{ item_id: string; topic_id: string }> = [];
  const newLeafRows: Array<{ item_id: string; topic_id: string }> = [];
  db.transaction(() => {
    clearTopics(db); // a re-fit rebuilds the taxonomy from scratch at the current version
    for (const t of prepared) {
      const lab = labelByCluster.get(t.node.clusterId);
      const label = lab?.label || `Theme ${t.node.clusterId}`;
      const parentId = t.node.parentId ? clusterToTopic.get(t.node.parentId) ?? null : null;
      upsertTopic(
        {
          id: t.id,
          parentId,
          level: t.node.level,
          label,
          summary: lab?.summary || null,
          itemCount: t.itemScores.size,
          centroid: t.centroid,
          embeddingModel: t.centroid ? SEMANTIC_EMBEDDING_MODEL : null,
          trendScore: null,
        },
        db,
      );
      for (const [itemId, score] of t.itemScores) {
        upsertItemTopic(itemId, t.id, score, "refit", db);
        newMembershipRows.push({ item_id: itemId, topic_id: t.id });
        if (isLeaf(t)) newLeafRows.push({ item_id: itemId, topic_id: t.id });
      }
    }
    recomputeTopicItemCounts(db);

    // --- Lineage diff (pure set math over LEAF membership) --------------------
    const events = diffLineage(priorMembership, membershipFromRows(newLeafRows));
    for (const e of events) {
      insertLineage({ oldTopicId: e.oldTopicId, newTopicId: e.newTopicId, op: e.op, score: e.score }, db);
      result.lineage[e.op] += 1;
    }

    setMeta("last_refit_at", new Date().toISOString(), db);
  })();

  result.ran = true;
  result.topics = prepared.length;
  result.rootTopics = prepared.filter((t) => t.node.level === 0).length;
  result.leafTopics = prepared.filter((t) => !prepared.some((o) => o.node.parentId === t.node.clusterId)).length;
  result.itemsAssigned = new Set(newMembershipRows.map((r) => r.item_id)).size;
  result.outliers = clustered.outliers.length;
  return result;
}

/** Leaf-topic centroids (childless topics) — the targets for incremental assignment (§C.4). */
export function leafCentroids(db = getSemanticDb()): TopicCentroid[] {
  return getLeafTopicCentroids(db);
}
