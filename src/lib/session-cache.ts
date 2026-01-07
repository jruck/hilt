/**
 * Server-side caching for session data
 *
 * This module provides in-memory caching for expensive file parsing operations.
 * The cache lives in the Node.js process and survives across API requests.
 */

import { SessionMetadata } from "./types";

interface SessionCacheEntry {
  sessions: SessionMetadata[];
  timestamp: number;
}

interface StatusCacheEntry {
  data: Map<string, SessionStatusData>;
  fileMtime: number;
}

interface SessionStatusData {
  status: string;
  sortOrder?: number;
  starred?: boolean;
  lastKnownMtime?: number;
}

interface PlannedSlugsCacheEntry {
  slugs: Set<string>;
  timestamp: number;
}

// Cache TTLs
const SESSION_CACHE_TTL_MS = 10_000; // 10 seconds
const PLANNED_SLUGS_CACHE_TTL_MS = 30_000; // 30 seconds

// Module-level caches (survive across requests in same Node.js process)
let sessionCache: SessionCacheEntry | null = null;
let statusCache: StatusCacheEntry | null = null;
let plannedSlugsCache: PlannedSlugsCacheEntry | null = null;

// Session cache
export function getCachedSessions(): SessionMetadata[] | null {
  if (!sessionCache) return null;
  if (Date.now() - sessionCache.timestamp > SESSION_CACHE_TTL_MS) {
    sessionCache = null;
    return null;
  }
  return sessionCache.sessions;
}

export function setCachedSessions(sessions: SessionMetadata[]): void {
  sessionCache = {
    sessions,
    timestamp: Date.now(),
  };
}

export function invalidateSessionCache(): void {
  sessionCache = null;
}

// Status file cache
export function getCachedStatus(currentMtime: number): Map<string, SessionStatusData> | null {
  if (!statusCache) return null;
  // Return cache only if file hasn't changed
  if (statusCache.fileMtime !== currentMtime) {
    statusCache = null;
    return null;
  }
  return statusCache.data;
}

export function setCachedStatus(data: Map<string, SessionStatusData>, fileMtime: number): void {
  statusCache = {
    data,
    fileMtime,
  };
}

export function invalidateStatusCache(): void {
  statusCache = null;
}

// Planned slugs cache
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

// Invalidate all caches (useful for testing or forced refresh)
export function invalidateAllCaches(): void {
  sessionCache = null;
  statusCache = null;
  plannedSlugsCache = null;
}
