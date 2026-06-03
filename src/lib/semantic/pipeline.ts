/**
 * Semantic pipeline versioning — mirrors src/lib/library/pipeline.ts PIPELINE_VERSION.
 *
 * Every derived row in semantic.sqlite is stamped with `SEMANTIC_VERSION`. A model or
 * prompt change is a BACKFILL (re-derive rows WHERE semantic_version != current), never
 * a migration — and a decimal test-lane can coexist with the blessed integer baseline
 * until blessed. Three sub-passes version independently (ruling R2); the headline
 * SEMANTIC_VERSION is what's stamped + queried by default.
 *
 * Convention (from the Library precedent): integer = published-at-scale (full backfill);
 * decimal = test iteration reviewed on a sample lane.
 */

export const SEMANTIC_COMPONENTS = {
  /** embedding model + chunking rules */
  embedding: "v0.1",
  /** entity-extraction prompt + output schema */
  extraction: "v0.1",
  /** clustering params + topic-labeling prompt */
  taxonomy: "v0.1",
} as const;

/** Headline version stamped on every derived row. */
export const SEMANTIC_VERSION = "v0.1";

/**
 * Cache-file format version — ORTHOGONAL to `SEMANTIC_VERSION`, the exact analog of
 * graph's `LAYOUT_VERSION` (src/lib/graph/config.ts) vs `TRANSPORT_FORMAT_VERSION`.
 *
 * `SEMANTIC_VERSION` is a MODEL/PROMPT version — bumping it is a backfill (new-version
 * rows are written alongside the old until blessed). `SEMANTIC_DB_FORMAT_VERSION` is a
 * SCHEMA/WIRE version — bumping it means the on-disk shape changed (a sqlite-vec layout
 * change, a column rename, a blob encoding change) such that old rows are no longer
 * readable, so the whole cache file must be invalidated and rebuilt from the vault.
 *
 * Stored in `semantic_meta.db_format_version`; `getSemanticDb()` drops every derived
 * table when the stamped value lags this constant, then re-stamps it. Because the db is
 * a pure derived cache (Critical Constraint #2), discarding it is always safe — the cold
 * start rebuilds it. Bump this ONLY on a non-backward-compatible schema change.
 */
export const SEMANTIC_DB_FORMAT_VERSION = 1;

/** Parse a `vN`/`vN.M` version string; null when malformed (mirrors the Library scheme). */
export function parseSemanticVersion(v: string): { major: number; minor: number } | null {
  const m = /^v(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] !== undefined ? Number(m[2]) : 0 };
}

/** True for an integer (published-at-scale) version like `v1`/`v2`; false for a decimal test lane. */
export function isPublishedVersion(v: string): boolean {
  const parsed = parseSemanticVersion(v);
  return parsed !== null && parsed.minor === 0 && /^v\d+$/.test(v.trim());
}

/** Embedding model id stamped on every vector row (overridable for a backfill rehearsal). */
export const SEMANTIC_EMBEDDING_MODEL = process.env.SEMANTIC_EMBEDDING_MODEL || "gemini-embedding-001";

/** Per-item entity-extraction model (Gemini Flash). Read at call time so tests can override. */
export function semanticExtractModel(): string {
  return process.env.SEMANTIC_EXTRACT_MODEL || "gemini-flash-latest";
}

/**
 * Low-frequency global topic-labeling model (the stronger taxonomy pass). A `claude:`
 * prefix dispatches to the Claude CLI (the model after the colon, or default when bare);
 * anything else is a Gemini model id. Read at call time so tests can override (ruling R7).
 */
export function semanticTaxonomyModel(): string {
  return process.env.SEMANTIC_TAXONOMY_MODEL || "gemini-pro-latest";
}
