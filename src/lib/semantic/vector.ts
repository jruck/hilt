/**
 * Vector helpers — the BLOB-canonical embedding substrate (ruling R5).
 *
 * Embeddings are stored as little-endian Float32 BLOBs (the canonical source of
 * truth). When the sqlite-vec accelerator isn't loaded, KNN is an in-process cosine
 * scan over those BLOBs (cheap at Hilt's low-thousands scale). When it IS loaded,
 * the vec0 tables are a derived index rebuilt from these same BLOBs — so the two
 * never diverge and toggling vec never requires a re-embed.
 */

/** Encode a vector to a little-endian Float32 BLOB for storage. */
export function float32ToBlob(vec: Float32Array): Buffer {
  // Copy so the BLOB never aliases a larger backing ArrayBuffer.
  return Buffer.from(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength));
}

/** Decode a stored BLOB back to a Float32Array (view over a copied buffer). */
export function blobToFloat32(buf: Buffer): Float32Array {
  // Buffer may be a slice of a pooled allocation; copy to a tight ArrayBuffer.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

/** L2-normalize in place-safe (returns a new array). Zero vectors pass through. */
export function l2normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return vec.slice();
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** Cosine similarity in [-1,1]. Mismatched lengths or a zero vector → 0. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface VectorCandidate {
  id: string;
  vec: Float32Array;
}

export interface KnnHit {
  id: string;
  score: number; // cosine similarity, higher = closer
}

/**
 * In-process cosine KNN: rank `candidates` by similarity to `query`, return top-k.
 * Deterministic tie-break by id so results are stable across runs. `excludeId`
 * drops a self-match (e.g. the query item's own chunk).
 */
export function knnCosine(
  query: Float32Array,
  candidates: VectorCandidate[],
  k: number,
  excludeId?: string,
): KnnHit[] {
  const hits: KnnHit[] = [];
  for (const c of candidates) {
    if (excludeId !== undefined && c.id === excludeId) continue;
    hits.push({ id: c.id, score: cosineSimilarity(query, c.vec) });
  }
  hits.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return hits.slice(0, Math.max(0, k));
}
