/**
 * Recent scopes tracking via server-side API
 * Persists to data/preferences.json instead of localStorage
 */

export interface RecentScope {
  path: string;
  lastVisited: string;  // ISO timestamp
  visitCount: number;
}

// Cache for synchronous access
let cachedScopes: RecentScope[] = [];
let cacheInitialized = false;

/**
 * Initialize cache from server (call on app load)
 */
export async function initRecentScopes(): Promise<void> {
  if (cacheInitialized) return;

  try {
    const res = await fetch("/api/preferences?key=recentScopes");
    const paths: string[] = await res.json();

    // Convert simple path array to RecentScope objects
    cachedScopes = paths.map((path, index) => ({
      path,
      lastVisited: new Date().toISOString(),
      visitCount: paths.length - index, // Higher count for earlier items
    }));
    cacheInitialized = true;
  } catch {
    // Silently fail if API is unavailable
  }
}

/**
 * Get recent scopes (returns cached data for sync access)
 * Call initRecentScopes() first for fresh data
 */
export function getRecentScopes(): RecentScope[] {
  return cachedScopes;
}

/**
 * Record a visit to a scope path
 */
export function recordScopeVisit(path: string): void {
  if (typeof window === "undefined") return;

  // Update local cache immediately
  const now = new Date().toISOString();
  const existingIndex = cachedScopes.findIndex(s => s.path === path);

  if (existingIndex !== -1) {
    // Update existing entry
    cachedScopes[existingIndex].lastVisited = now;
    cachedScopes[existingIndex].visitCount += 1;
    // Move to front
    const [removed] = cachedScopes.splice(existingIndex, 1);
    cachedScopes.unshift(removed);
  } else {
    // Add new entry at front
    cachedScopes.unshift({
      path,
      lastVisited: now,
      visitCount: 1,
    });
  }

  // Trim to 10 entries
  cachedScopes = cachedScopes.slice(0, 10);

  // Persist to server (fire and forget)
  fetch("/api/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "addRecentScope", scope: path }),
  }).catch(() => {
    // Silently fail if API is unavailable
  });
}

/**
 * Get popular scopes (sorted by visit count)
 */
export function getPopularScopes(): RecentScope[] {
  return [...cachedScopes].sort((a, b) => b.visitCount - a.visitCount);
}

/**
 * Clear all recent scopes
 */
export function clearRecentScopes(): void {
  cachedScopes = [];
  // Note: Add API endpoint for this if needed
}
