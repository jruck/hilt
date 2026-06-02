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
