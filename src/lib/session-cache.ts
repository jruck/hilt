/**
 * Server-side caching for planned slugs
 */

interface PlannedSlugsCacheEntry {
  slugs: Set<string>;
  timestamp: number;
}

const PLANNED_SLUGS_CACHE_TTL_MS = 30_000; // 30 seconds

let plannedSlugsCache: PlannedSlugsCacheEntry | null = null;

export function getCachedPlannedSlugs(): Set<string> | null {
  if (!plannedSlugsCache) return null;
  if (Date.now() - plannedSlugsCache.timestamp > PLANNED_SLUGS_CACHE_TTL_MS) {
    plannedSlugsCache = null;
    return null;
  }
  return plannedSlugsCache.slugs;
}

export function setCachedPlannedSlugs(slugs: Set<string>): void {
  plannedSlugsCache = {
    slugs,
    timestamp: Date.now(),
  };
}

export function invalidatePlannedSlugsCache(): void {
  plannedSlugsCache = null;
}
