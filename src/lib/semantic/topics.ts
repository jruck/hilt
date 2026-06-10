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
  updateTopicLabel,
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

/** Partition a level-DESC-sorted list into consecutive same-level groups (deepest first). */
function groupByLevel<T extends { node: { level: number } }>(sorted: T[]): T[][] {
  const groups: T[][] = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0].node.level === t.node.level) last.push(t);
    else groups.push([t]);
  }
  return groups;
}

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

  // Leaf = a prepared topic no other prepared topic parents (the clustering units; lineage
  // is diffed over these, not the parent themes whose membership is the union of children).
  const parentedClusterIds = new Set(prepared.map((t) => t.node.parentId).filter((p): p is string => Boolean(p)));
  const isLeaf = (t: PreparedTopic): boolean => !parentedClusterIds.has(t.node.clusterId);

  // --- Label (injected LLM seam, two-phase) -------------------------------------
  // Phase 1: LEAVES from member excerpts (the clustering units carry the actual content).
  // Phase 2: PARENTS from their children's resolved labels+summaries, deepest level first —
  // a 1,148-item root labeled from 8 raw excerpts was unanswerable; from its child themes
  // it's a synthesis question. A cluster the labeler skips falls back to a synthetic label
  // so a topic is never unnamed; the client batches + retries internally (per-batch fail-soft).
  const labelByCluster = new Map<string, { clusterId: string; label: string; summary: string }>();
  const leafInputs: TopicLabelInput[] = prepared.filter(isLeaf).map((t) => ({
    clusterId: t.node.clusterId,
    sampleTexts: t.node.memberIds
      .map((cid) => chunkText.get(cid))
      .filter((s): s is string => Boolean(s))
      .slice(0, 8),
  }));
  try {
    for (const l of await opts.client.labelTopics(leafInputs)) labelByCluster.set(l.clusterId, l);
  } catch {
    /* fail-soft: synthetic labels below */
  }

  const parents = prepared.filter((t) => !isLeaf(t)).sort((a, b) => b.node.level - a.node.level);
  for (const levelGroup of groupByLevel(parents)) {
    const inputs: TopicLabelInput[] = levelGroup.map((p) => ({
      clusterId: p.node.clusterId,
      sampleTexts: prepared
        .filter((c) => c.node.parentId === p.node.clusterId)
        .map((c) => {
          const lab = labelByCluster.get(c.node.clusterId);
          return lab ? `${lab.label}${lab.summary ? ` — ${lab.summary}` : ""}` : "";
        })
        .filter(Boolean)
        .slice(0, 8),
    }));
    try {
      for (const l of await opts.client.labelTopics(inputs)) labelByCluster.set(l.clusterId, l);
    } catch {
      /* fail-soft */
    }
  }

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

// ---------------------------------------------------------------------------
// Label-only repair (no re-cluster)
// ---------------------------------------------------------------------------

/** The synthetic fallback form (`Theme ${clusterId}`, clusterId = "L0-8"/"L1-114"…). */
const PLACEHOLDER_LABEL = /^Theme L\d+-\d+$/;

export interface RelabelOptions {
  client: SemanticLlmClient;
  db?: Database.Database;
  /** Relabel every topic, not just placeholder-labeled ones. */
  all?: boolean;
}

export interface RelabelResult {
  topicsTotal: number;
  targeted: number;
  relabeled: number;
  placeholdersRemaining: number;
}

interface TopicLabelRow {
  id: string;
  parent_id: string | null;
  level: number;
  label: string;
  summary: string | null;
}

/**
 * Re-run JUST the labeling pass over the existing taxonomy — no re-cluster, no membership
 * or lineage churn. The repair path for a refit whose labeling failed (every topic left a
 * "Theme L0-N" placeholder): leaves are relabeled from their top member items' head chunks,
 * then parents (deepest level first) from their children's resolved labels+summaries —
 * mirroring the refit's two-phase labeling. Default targets only placeholder labels;
 * `all: true` re-derives every name. Bumps `last_refit_at` when anything changed so the
 * graph overlay's watermark advances and the new names flow into System → Graph.
 */
export async function relabelTopics(opts: RelabelOptions): Promise<RelabelResult> {
  const db = opts.db ?? getSemanticDb();
  const topics = db
    .prepare("SELECT id, parent_id, level, label, summary FROM topics ORDER BY level DESC, id")
    .all() as TopicLabelRow[];
  const result: RelabelResult = {
    topicsTotal: topics.length,
    targeted: 0,
    relabeled: 0,
    placeholdersRemaining: 0,
  };
  if (topics.length === 0) return result;

  const isTarget = (t: TopicLabelRow): boolean => opts.all === true || PLACEHOLDER_LABEL.test(t.label);
  const hasChildren = new Set(topics.map((t) => t.parent_id).filter((p): p is string => Boolean(p)));
  const labelById = new Map(topics.map((t) => [t.id, { label: t.label, summary: t.summary ?? "" }]));

  // SHORT alias ids for the label calls. Topic ids are `topic:<16-hex>`; asking the model
  // to echo 48 such hashes per call lost ~40% of them to echo mangling on the first real
  // run (the UPDATE then hit nothing). The model only ever sees `c<N>`; we map back here.
  const aliasOf = new Map<string, string>();
  const topicOfAlias = new Map<string, string>();
  topics.forEach((t, i) => {
    const alias = `c${i}`;
    aliasOf.set(t.id, alias);
    topicOfAlias.set(alias, t.id);
  });

  // Leaf excerpts: the head chunk (ordinal 0 carries the title) of the top member items.
  const memberChunks = db.prepare(
    `SELECT c.text AS text FROM item_topics it
     JOIN chunks c ON c.item_id = it.item_id AND c.ordinal = 0
     WHERE it.topic_id = ? ORDER BY it.score DESC, it.item_id LIMIT 8`,
  );

  const apply = (labels: Awaited<ReturnType<SemanticLlmClient["labelTopics"]>>): void => {
    for (const l of labels) {
      if (!l.label) continue;
      const topicId = topicOfAlias.get(l.clusterId) ?? l.clusterId; // alias or (tests) raw id
      if (!labelById.has(topicId)) continue; // unmappable echo — don't count it
      updateTopicLabel(topicId, l.label, l.summary || null, db);
      labelById.set(topicId, { label: l.label, summary: l.summary });
      result.relabeled += 1;
    }
  };

  // Phase 1: leaf targets from member excerpts.
  const leafTargets = topics.filter((t) => isTarget(t) && !hasChildren.has(t.id));
  result.targeted += leafTargets.length;
  const leafInputs: TopicLabelInput[] = leafTargets.map((t) => ({
    clusterId: aliasOf.get(t.id)!,
    sampleTexts: (memberChunks.all(t.id) as Array<{ text: string }>).map((r) => r.text),
  }));
  try {
    apply(await opts.client.labelTopics(leafInputs));
  } catch {
    /* fail-soft — placeholders stay until the next repair */
  }

  // Phase 2: parent targets from their children's (now-updated) labels, deepest first.
  const parentTargets = topics.filter((t) => isTarget(t) && hasChildren.has(t.id));
  result.targeted += parentTargets.length;
  for (const group of groupByLevel(parentTargets.map((t) => ({ node: { level: t.level }, row: t })))) {
    const inputs: TopicLabelInput[] = group.map(({ row }) => ({
      clusterId: aliasOf.get(row.id)!,
      sampleTexts: topics
        .filter((c) => c.parent_id === row.id)
        .map((c) => {
          const lab = labelById.get(c.id);
          return lab ? `${lab.label}${lab.summary ? ` — ${lab.summary}` : ""}` : "";
        })
        .filter(Boolean)
        .slice(0, 8),
    }));
    try {
      apply(await opts.client.labelTopics(inputs));
    } catch {
      /* fail-soft */
    }
  }

  result.placeholdersRemaining = (
    db.prepare("SELECT label FROM topics").all() as Array<{ label: string }>
  ).filter((r) => PLACEHOLDER_LABEL.test(r.label)).length;

  if (result.relabeled > 0) setMeta("last_refit_at", new Date().toISOString(), db);
  return result;
}
