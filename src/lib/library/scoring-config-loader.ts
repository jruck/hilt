import fs from "fs";
import path from "path";
import { DEFAULT_SCORING_CONFIG, type LibraryScoringConfig } from "./scoring-config";

/**
 * Server-only loader for the vault's versioned scoring config (`meta/library-scoring.json`).
 * Kept separate from scoring-config.ts so client components can import the defaults/types without
 * dragging fs into the browser bundle. mtime-cached; a missing or malformed file silently yields
 * the defaults (the eval must never fail because config is absent).
 */

export function scoringConfigPath(vaultPath: string): string {
  return path.join(vaultPath, "meta", "library-scoring.json");
}

interface CacheEntry {
  mtimeMs: number;
  config: LibraryScoringConfig;
}

const cache = new Map<string, CacheEntry>();

/** Per-leaf validation: one wrong-typed nested value in the user-editable config must fall back to
 *  the default for that key, never NaN-poison every worth score or crash a route. */
function finiteLeaves<T extends Record<string, number>>(defaults: T, overrides: unknown): T {
  const result = { ...defaults };
  if (overrides && typeof overrides === "object") {
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const value = (overrides as Record<string, unknown>)[key as string];
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value as T[keyof T];
    }
  }
  return result;
}

function mergeConfig(overrides: Partial<LibraryScoringConfig>): LibraryScoringConfig {
  const d = DEFAULT_SCORING_CONFIG;
  const requestedVersion = typeof overrides.version === "string" ? overrides.version : d.version;
  return {
    // s1/s2 files predate the hybrid constants. Preserve their compatible numeric leaves below,
    // but identify the effective runtime algorithm honestly as s3.
    version: /^s3(?:\.|$)/.test(requestedVersion) ? requestedVersion : d.version,
    to_archive_worth: typeof overrides.to_archive_worth === "number" && Number.isFinite(overrides.to_archive_worth) ? overrides.to_archive_worth : d.to_archive_worth,
    relevance: finiteLeaves(d.relevance, overrides.relevance),
    signal_weights: finiteLeaves(d.signal_weights, overrides.signal_weights),
    hybrid: finiteLeaves(d.hybrid, overrides.hybrid),
    for_you: finiteLeaves(d.for_you, overrides.for_you),
  };
}

export function loadScoringConfig(vaultPath: string): LibraryScoringConfig {
  const filePath = scoringConfigPath(vaultPath);
  try {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.config;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<LibraryScoringConfig>;
    const config = mergeConfig(parsed && typeof parsed === "object" ? parsed : {});
    cache.set(filePath, { mtimeMs, config });
    return config;
  } catch {
    return DEFAULT_SCORING_CONFIG;
  }
}
