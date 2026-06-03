/**
 * Deterministic fake SemanticLlmClient for offline tests (ruling R5/R6/R7).
 *
 * `embed()` returns hash-seeded unit vectors: same text → same vector, different text
 * → different vector — enough to exercise KNN ordering, dedupe, and clustering seams
 * without a live API. `extractEntities`/`labelTopics` replay fixtures (or a stable
 * stub). Call counts let tests assert "0 embed calls on an unchanged second pass."
 */

import { semanticDim } from "./config";
import type { ExtractedEntity, SemanticLlmClient, TopicLabel, TopicLabelInput } from "./gemini";
import { l2normalize } from "./vector";

export interface FakeClientOptions {
  dim?: number;
  /** text → entities to return from extractEntities. */
  extractFixtures?: Record<string, ExtractedEntity[]>;
  /** clusterId → label to return from labelTopics. */
  labelFixtures?: Record<string, TopicLabel>;
}

export interface FakeSemanticClient extends SemanticLlmClient {
  calls: { embed: number; embedTexts: number; extract: number; label: number };
}

export function createFakeSemanticClient(opts: FakeClientOptions = {}): FakeSemanticClient {
  const dim = opts.dim ?? semanticDim();
  const calls = { embed: 0, embedTexts: 0, extract: 0, label: 0 };

  const fakeVec = (text: string): Float32Array => {
    const rng = mulberry32(hash32(text));
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) v[i] = rng() * 2 - 1;
    return l2normalize(v);
  };

  return {
    calls,
    async embed(texts: string[]): Promise<Float32Array[]> {
      calls.embed += 1;
      calls.embedTexts += texts.length;
      return texts.map(fakeVec);
    },
    async extractEntities(text: string): Promise<ExtractedEntity[]> {
      calls.extract += 1;
      return opts.extractFixtures?.[text] ?? [];
    },
    async labelTopics(inputs: TopicLabelInput[]): Promise<TopicLabel[]> {
      calls.label += 1;
      return inputs.map(
        (i) => opts.labelFixtures?.[i.clusterId] ?? { clusterId: i.clusterId, label: `topic-${i.clusterId}`, summary: "" },
      );
    },
  };
}

/** FNV-1a 32-bit string hash (matches graph-style.ts hashString). */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 seeded PRNG — deterministic, no global RNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
