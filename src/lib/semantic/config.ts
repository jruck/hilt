/**
 * Semantic layer config — paths + flags, mirroring src/lib/graph/config.ts.
 *
 * The semantic knowledge layer (Phase 2) is a pure derived cache at
 * DATA_DIR/semantic.sqlite. Fully inert unless HILT_SEMANTIC_ENABLED=true.
 * See docs/plans/semantic-layer-phase2-spec.md (env names per ruling R8).
 */

import * as path from "path";

export function getSemanticDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getSemanticDbPath(): string {
  return process.env.HILT_SEMANTIC_DB_PATH || path.join(getSemanticDataDir(), "semantic.sqlite");
}

/** Feature flag — the whole subsystem (runner, routes, CLI build) is inert unless set. */
export function isSemanticEnabled(): boolean {
  return process.env.HILT_SEMANTIC_ENABLED === "true";
}

/** Offline/no-op kill switch. `SEMANTIC_OFFLINE` is an accepted alias (ruling R8). */
export function isSemanticDisabled(): boolean {
  return truthy(process.env.SEMANTIC_DISABLED) || truthy(process.env.SEMANTIC_OFFLINE);
}

/**
 * Force the BLOB + in-process cosine fallback even if the sqlite-vec extension could
 * load. The BLOB column is canonical, so this never requires a re-embed (ruling R5).
 */
export function isSemanticVecDisabled(): boolean {
  return truthy(process.env.SEMANTIC_VEC_DISABLED);
}

/** Stored embedding dimensionality (gemini-embedding-001 Matryoshka-truncated). */
export function semanticDim(): number {
  return boundedInt(process.env.SEMANTIC_DIM, 1536, 64, 3072);
}

/** Cosine floor for embedding-ANN to PROPOSE a merge pair to the judge (spec §B.4). */
export function semanticBlockSim(): number {
  return boundedFloat(process.env.SEMANTIC_BLOCK_SIM, 0.82, 0, 1);
}

/** Cosine ceiling above which near-identical names auto-merge without an LLM call. */
export function semanticAutoMergeSim(): number {
  return boundedFloat(process.env.SEMANTIC_AUTO_MERGE_SIM, 0.95, 0, 1);
}

/** Cosine floor to BIND a person/project entity to an existing graph node (spec §B.6). */
export function semanticBindSim(): number {
  return boundedFloat(process.env.SEMANTIC_BIND_SIM, 0.88, 0, 1);
}

// --- Topic layer (P2.2, spec §C) ---------------------------------------------

/**
 * Cosine floor for incremental nearest-topic assignment (§C.4): a new item joins a
 * leaf topic only when its similarity to the centroid clears this; below ⇒ outlier.
 */
export function semanticAssignCos(): number {
  return boundedFloat(process.env.SEMANTIC_ASSIGN_COS, 0.55, 0, 1);
}

/** Cosine pre-gate above which two sibling topics are PROPOSED to the merge judge (§C.2). */
export function semanticMergeCos(): number {
  return boundedFloat(process.env.SEMANTIC_MERGE_COS, 0.85, 0, 1);
}

/**
 * Centroid-cosine floor for warm-start lineage matching (§C.5): a new cluster whose
 * centroid matches a prior topic this closely INHERITS that topic's id (stable identity).
 */
export function semanticLineageCos(): number {
  return boundedFloat(process.env.SEMANTIC_LINEAGE_COS, 0.7, 0, 1);
}

/** Deterministic clustering seed handed to the sidecar (UMAP `random_state`). */
export function semanticClusterSeed(): number {
  return boundedInt(process.env.SEMANTIC_CLUSTER_SEED, 42, 0, 2_147_483_647);
}

/** Minimum new/outlier items since the last re-fit before the signal-gated refit runs (§C.5). */
export function semanticRefitMinNew(): number {
  return boundedInt(process.env.SEMANTIC_REFIT_MIN_NEW, 10, 0, 1_000_000);
}

/** Sidecar wall-clock timeout in ms (mirrors LIBRARY_REWEAVE_TIMEOUT_MS). */
export function semanticRefitTimeoutMs(): number {
  return boundedInt(process.env.SEMANTIC_REFIT_TIMEOUT_MS, 120_000, 1_000, 1_800_000);
}

/**
 * Backfill concurrency — how many items' embed/extract network calls are in flight at
 * once. The per-item DB writes stay safe (better-sqlite3 is synchronous; JS serializes
 * them), so this only overlaps network waits. The bottleneck is sequential Flash
 * extraction, so this is the difference between a ~hours and a ~30-60min full cold-start.
 */
export function semanticConcurrency(): number {
  return boundedInt(process.env.SEMANTIC_CONCURRENCY, 8, 1, 32);
}

/** Offline kill switch for the topic LABELER (mirrors LIBRARY_CONNECTIONS_DISABLED=1). */
export function isSemanticLabelDisabled(): boolean {
  return truthy(process.env.SEMANTIC_LABEL_DISABLED);
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

/** Clamp an env int to [min,max] with a fallback (mirrors graph/config.ts). */
export function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Clamp an env float to [min,max] with a fallback. */
export function boundedFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
