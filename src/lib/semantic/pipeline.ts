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

/** Embedding model id stamped on every vector row (overridable for a backfill rehearsal). */
export const SEMANTIC_EMBEDDING_MODEL = process.env.SEMANTIC_EMBEDDING_MODEL || "gemini-embedding-001";
