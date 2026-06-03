/**
 * Incremental nearest-topic assignment (P2.2, spec §C.4) — pure TS, no Python.
 *
 * On ingest a new item is embedded (Layer A) and slotted into the nearest EXISTING leaf
 * topics by cosine to their cached centroids. This is the cheap online path that runs in
 * the GraphRunner-style incremental loop; it NEVER creates a topic — an item that clears
 * no centroid's floor is an OUTLIER, the seed signal that a new theme may be forming, which
 * the next global re-fit (topics.ts) folds in. Topic creation only happens in the re-fit.
 *
 * Centroids and item vectors are L2-normalized upstream, so cosine == dot; we use the
 * shared cosineSimilarity for safety on any non-normalized input.
 */

import { semanticAssignCos } from "./config";
import type { TopicCentroid } from "./db";
import { cosineSimilarity } from "./vector";

export interface AssignHit {
  topicId: string;
  score: number;
}

export interface AssignResult {
  /** Top-k leaf topics the item joins (above the floor), strongest first. Empty ⇒ outlier. */
  topics: AssignHit[];
  /** True when nothing cleared the floor — the item is recorded as an outlier (no topic). */
  outlier: boolean;
}

export interface AssignOptions {
  /** Cosine floor; default semanticAssignCos(). */
  floor?: number;
  /** Max topics to assign (top-k). Default 3. */
  k?: number;
}

/**
 * Assign one item embedding to the nearest leaf topics. `itemVec` is the item's
 * representative vector (e.g. its strongest chunk, or a mean) and `centroids` are the leaf
 * topics' centroids (getLeafTopicCentroids). Deterministic: ties break by topic id.
 */
export function assignToTopics(itemVec: Float32Array, centroids: TopicCentroid[], opts: AssignOptions = {}): AssignResult {
  const floor = opts.floor ?? semanticAssignCos();
  const k = opts.k ?? 3;
  const hits: AssignHit[] = [];
  for (const c of centroids) {
    const score = cosineSimilarity(itemVec, c.vec);
    if (score >= floor) hits.push({ topicId: c.id, score });
  }
  hits.sort((a, b) => b.score - a.score || (a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0));
  const top = hits.slice(0, Math.max(0, k));
  return { topics: top, outlier: top.length === 0 };
}

/**
 * Roll several chunk vectors up to a single item-level assignment by MAX cosine per topic
 * (the same max-rollup the query layer uses): an item joins a topic if ANY of its chunks
 * is close to that topic's centroid, scored by the closest chunk.
 */
export function assignItemChunks(chunkVecs: Float32Array[], centroids: TopicCentroid[], opts: AssignOptions = {}): AssignResult {
  const floor = opts.floor ?? semanticAssignCos();
  const k = opts.k ?? 3;
  const best = new Map<string, number>();
  for (const vec of chunkVecs) {
    for (const c of centroids) {
      const score = cosineSimilarity(vec, c.vec);
      const prev = best.get(c.id);
      if (prev === undefined || score > prev) best.set(c.id, score);
    }
  }
  const hits: AssignHit[] = [...best.entries()]
    .filter(([, score]) => score >= floor)
    .map(([topicId, score]) => ({ topicId, score }));
  hits.sort((a, b) => b.score - a.score || (a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0));
  const top = hits.slice(0, Math.max(0, k));
  return { topics: top, outlier: top.length === 0 };
}
