/**
 * Semantic topical-fit for the L3 library eval — the embedding-backed upgrade to the
 * token-overlap `contextFit` (reference-library-roadmap "Step 6: topical relevance").
 *
 * The eval's relevance term wants "does this bear on what I'm working on right now?".
 * Token overlap only catches shared words; this catches shared MEANING via the Phase-2
 * embeddings already sitting in semantic.sqlite. Both sides of the cosine are PRECOMPUTED
 * (the artifact's own chunk centroid vs. the active-context items' centroids), so the eval
 * stays cheap-on-read — local sqlite + dot products, never a model call (R: eval is dynamic
 * and free; see library-eval.ts).
 *
 * Coverage: SAVED references and CANDIDATES are both embedded (scope='library' — candidates
 * via `collectCandidateItems`, picked up by the runner/backfill), so both get a real semantic
 * fit. An item not yet embedded (a candidate ingested moments ago, before the runner's next
 * reconcile) has no centroid — `scoreArtifactSemantic` returns null and the caller keeps the
 * token-overlap score. The whole path is inert unless HILT_SEMANTIC_ENABLED is on, the db
 * is built, and HILT_LIBRARY_SEMANTIC isn't force-disabled; any error degrades to null.
 *
 * Integration (see recommendations.ts): for an embedded item the semantic fit REPLACES the
 * token-overlap fit rather than blending. Measured on the real vault, token-overlap sums
 * across ~80 active-context signals UNCAPPED (mean ~1.37, saturating the eval's 0.3 cap for
 * nearly everyone) — it differentiates nothing. The cosine fit here (mean ~0.20, a real
 * 0→0.45 gradient) is the signal that actually separates on-topic from off. Token-overlap
 * survives only as the fallback for non-embedded candidates, where it's the best available.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getSemanticDbPath, isSemanticEnabled, boundedFloat, boundedInt } from "@/lib/semantic/config";
import { blobToFloat32, cosineSimilarity } from "@/lib/semantic/vector";
import type { LibraryArtifactDetail } from "./types";

/** Consumer kill-switch (mirrors HILT_GRAPH_SEMANTIC). Default: active when semantic is enabled. */
export function librarySemanticEnabled(): boolean {
  if (process.env.HILT_LIBRARY_SEMANTIC === "false") return false;
  return isSemanticEnabled();
}

/**
 * Cosine floor below which a context match contributes nothing. gemini-embedding-001 is
 * ANISOTROPIC: cosines are compressed into a high narrow band, so the floor is NOT "where
 * related begins" in the abstract — it's the corpus BACKGROUND level. Measured on the real
 * vault (scripts/library-semantic-calibrate.ts): any saved-ref↔context pair medians ~0.71
 * (the noise floor), the nearest-context cosine medians ~0.81 / p90 ~0.86. So anchor the
 * floor just above background (~0.78) and let the residual (0.78→0.88) carry the signal.
 * Re-run the calibrate probe if the corpus or embedding model changes.
 */
function semanticRelevanceFloor(): number {
  return boundedFloat(process.env.LIBRARY_SEMANTIC_FLOOR, 0.78, 0, 1);
}
/** Maps the narrow above-floor residual onto the eval's 0..0.45 fit scale (anisotropy stretch). */
function semanticRelevanceScale(): number {
  return boundedFloat(process.env.LIBRARY_SEMANTIC_SCALE, 1.0, 0, 4);
}
/** Ceiling on the fit (mirrors the token path's per-signal 0.45 cap; eval re-caps at 0.3). */
function semanticRelevanceCap(): number {
  return boundedFloat(process.env.LIBRARY_SEMANTIC_CAP, 0.45, 0, 1);
}
/**
 * How many top context matches sum into the fit. In this compressed regime summing many
 * near-identical cosines just re-saturates, so default to the single NEAREST anchor (the
 * cleanest discriminator) with a steep diminish on any extras.
 */
function semanticRelevanceTopK(): number {
  return boundedInt(process.env.LIBRARY_SEMANTIC_TOPK, 2, 1, 32);
}
/** Weight applied to the 2nd..Kth contributions (the nearest anchor keeps full weight). */
function semanticRelevanceTailWeight(): number {
  return boundedFloat(process.env.LIBRARY_SEMANTIC_TAIL_WEIGHT, 0.35, 0, 1);
}
/** How many most-recent saved refs join the context set (mirrors recentSaveSignals' 20). */
function semanticRecentSaves(): number {
  return boundedInt(process.env.LIBRARY_SEMANTIC_RECENT_SAVES, 20, 0, 200);
}

/** Active-context weighting by kind — mirrors the token path's ContextSignal weights. */
const CONTEXT_WEIGHT: Record<string, number> = {
  project: 1.25,
  north_star: 1.0,
  area: 1.0,
  person: 0.35,
  reference: 0.45, // recent saves
};

interface ContextCentroid {
  label: string;
  kind: string;
  weight: number;
  vec: Float32Array;
  /** Abs path, so an artifact never matches its own recent-save context entry. */
  sourceFile: string;
}

export interface SemanticContext {
  /** false ⇒ caller uses token-overlap only (flag off, db absent/empty, or load failed). */
  available: boolean;
  /** Centroid for a scored artifact, keyed by absolute source_file (saved refs only). */
  artifactBySourceFile: Map<string, Float32Array>;
  contexts: ContextCentroid[];
}

const EMPTY: SemanticContext = { available: false, artifactBySourceFile: new Map(), contexts: [] };

interface ChunkRow {
  item_id: string;
  kind: string;
  scope: string;
  source_file: string;
  title: string | null;
  embedding_blob: Buffer;
}

/** Mean of unit vectors, re-normalized — a stable item centroid from its chunk embeddings. */
function centroid(vecs: Float32Array[]): Float32Array | null {
  if (vecs.length === 0) return null;
  const dim = vecs[0].length;
  const acc = new Float32Array(dim);
  for (const v of vecs) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) acc[i] += v[i];
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += acc[i] * acc[i];
  norm = Math.sqrt(norm);
  if (norm === 0 || !Number.isFinite(norm)) return null;
  for (let i = 0; i < dim; i++) acc[i] /= norm;
  return acc;
}

/**
 * Load the precomputed centroids the eval needs: every saved-ref centroid (the artifacts
 * being scored) and the active-context centroids (projects, north star, people, recent
 * saves). One bulk query over the chunk BLOBs, grouped to item centroids in JS — the
 * 1,278 meeting transcripts and generic notes are excluded from the SQL (not context).
 *
 * Fully fallback-safe: returns `EMPTY` (available:false) on flag-off, missing/empty db, or
 * any read error, so the caller silently keeps the token-overlap score.
 */
// Per-process context cache (Library v2, Phase E-lite): loading every chunk BLOB out of
// semantic.sqlite and grouping to centroids is the most expensive step of every eval pass, and the
// inputs only change when the db is rewritten (backfill/refit) or the recent-saves window shifts.
// Keyed by db mtime + the recent-saved ids; the dbOverride (test) path bypasses the cache.
let contextCache: { key: string; context: SemanticContext } | null = null;

function semanticContextCacheKey(vaultPath: string, artifacts: LibraryArtifactDetail[]): string | null {
  try {
    const dbPath = getSemanticDbPath();
    const stat = fs.statSync(dbPath);
    const recentIds = artifacts.filter((a) => a.lifecycle_status === "saved").slice(0, semanticRecentSaves()).map((a) => a.id).join(",");
    return `${dbPath}:${stat.mtimeMs}:${stat.size}:${vaultPath}:${recentIds}`;
  } catch {
    return null;
  }
}

export function buildSemanticContext(
  vaultPath: string,
  artifacts: LibraryArtifactDetail[],
  dbOverride?: Database.Database,
): SemanticContext {
  if (!librarySemanticEnabled() && !dbOverride) return EMPTY;
  const cacheKey = dbOverride ? null : semanticContextCacheKey(vaultPath, artifacts);
  if (cacheKey && contextCache?.key === cacheKey) return contextCache.context;
  let db = dbOverride;
  try {
    if (!db) {
      const dbPath = getSemanticDbPath();
      if (!fs.existsSync(dbPath)) return EMPTY; // never CREATE an empty db from the eval path
      // Read-only connection; WAL lets us read a committed snapshot while a backfill writes.
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    }

    const rows = db
      .prepare(
        `SELECT c.item_id AS item_id, si.kind AS kind, si.scope AS scope,
                si.source_file AS source_file, si.title AS title, c.embedding_blob AS embedding_blob
         FROM chunks c JOIN semantic_items si ON si.item_id = c.item_id
         WHERE c.embedding_blob IS NOT NULL
           AND (si.scope = 'library' OR si.kind IN ('project','person','area','north_star'))`,
      )
      .all() as ChunkRow[];
    if (rows.length === 0) return EMPTY;

    // Group chunk vectors by item, carrying the item's metadata.
    const byItem = new Map<string, { kind: string; scope: string; sourceFile: string; title: string | null; vecs: Float32Array[] }>();
    for (const r of rows) {
      let g = byItem.get(r.item_id);
      if (!g) {
        g = { kind: r.kind, scope: r.scope, sourceFile: r.source_file, title: r.title, vecs: [] };
        byItem.set(r.item_id, g);
      }
      g.vecs.push(blobToFloat32(r.embedding_blob));
    }

    const artifactBySourceFile = new Map<string, Float32Array>();
    const projectPersonContexts: ContextCentroid[] = [];
    const savedRefCentroidByFile = new Map<string, Float32Array>();
    for (const g of byItem.values()) {
      const c = centroid(g.vecs);
      if (!c) continue;
      if (g.scope === "library") {
        artifactBySourceFile.set(g.sourceFile, c);
        savedRefCentroidByFile.set(g.sourceFile, c);
      } else if (CONTEXT_WEIGHT[g.kind] !== undefined) {
        projectPersonContexts.push({
          label: g.title || g.kind,
          kind: g.kind,
          weight: CONTEXT_WEIGHT[g.kind],
          vec: c,
          sourceFile: g.sourceFile,
        });
      }
    }

    // Recent saved refs join the context set (mirrors recentSaveSignals): the most-recent
    // `semanticRecentSaves()` saved artifacts, resolved to their precomputed centroids.
    const recentSaved = artifacts
      .filter((a) => a.lifecycle_status === "saved")
      .slice(0, semanticRecentSaves());
    const recentContexts: ContextCentroid[] = [];
    for (const a of recentSaved) {
      const abs = path.resolve(vaultPath, a.path);
      const vec = savedRefCentroidByFile.get(abs);
      if (vec) recentContexts.push({ label: a.title, kind: "reference", weight: CONTEXT_WEIGHT.reference, vec, sourceFile: abs });
    }

    const contexts = [...projectPersonContexts, ...recentContexts];
    if (contexts.length === 0) return EMPTY;
    const context: SemanticContext = { available: true, artifactBySourceFile, contexts };
    if (cacheKey) contextCache = { key: cacheKey, context };
    return context;
  } catch {
    return EMPTY;
  } finally {
    // Only close a db we opened ourselves (never the injected one or the singleton).
    if (db && !dbOverride) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export interface SemanticFit {
  score: number;
  label: string | null;
}

/**
 * Topical fit of one artifact against the active context, from precomputed embeddings.
 * Returns null when the artifact has no centroid (anything not yet embedded — e.g. a
 * candidate ingested since the runner's last reconcile) so the caller keeps the
 * token-overlap score. Self-matches (the artifact's own recent-save context entry) are
 * skipped.
 *
 * Fit = sum of the top-K weighted, floored cosine contributions, scaled and capped — shaped
 * like the token path's `scoreAgainstSignals` so MAX-blending the two is apples-to-apples.
 */
export function scoreArtifactSemantic(
  vaultPath: string,
  artifact: LibraryArtifactDetail,
  ctx: SemanticContext,
): SemanticFit | null {
  if (!ctx.available) return null;
  const abs = path.resolve(vaultPath, artifact.path);
  const vec = ctx.artifactBySourceFile.get(abs);
  if (!vec) return null;

  const floor = semanticRelevanceFloor();
  const scale = semanticRelevanceScale();
  const denom = Math.max(1e-6, 1 - floor);

  const contributions: Array<{ label: string; value: number }> = [];
  for (const c of ctx.contexts) {
    if (c.sourceFile === abs) continue; // never match self
    const sim = cosineSimilarity(vec, c.vec);
    if (sim <= floor) continue;
    const value = ((sim - floor) / denom) * c.weight * scale;
    if (value > 0) contributions.push({ label: c.label, value });
  }
  if (contributions.length === 0) return { score: 0, label: null };

  contributions.sort((a, b) => b.value - a.value);
  const top = contributions.slice(0, semanticRelevanceTopK());
  // Nearest anchor at full weight; any extras steeply diminished (compressed-cosine regime).
  const tail = semanticRelevanceTailWeight();
  const summed = top.reduce((s, c, i) => s + (i === 0 ? c.value : c.value * tail), 0);
  const score = Number(Math.min(semanticRelevanceCap(), summed).toFixed(3));
  return { score, label: top[0].label };
}
