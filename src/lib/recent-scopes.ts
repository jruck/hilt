/**
 * Recent scopes tracking via localStorage
 */

export interface RecentScope {
  path: string;
  lastVisited: string;  // ISO timestamp
  visitCount: number;
}

const STORAGE_KEY = "claude-kanban-recent-scopes";
const MAX_ENTRIES = 10;

/**
 * Get recent scopes from localStorage, sorted by lastVisited (most recent first)
 */
export function getRecentScopes(): RecentScope[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const scopes: RecentScope[] = JSON.parse(stored);
    // Sort by lastVisited descending
    return scopes.sort((a, b) =>
      new Date(b.lastVisited).getTime() - new Date(a.lastVisited).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Record a visit to a scope path
 */
export function recordScopeVisit(path: string): void {
  if (typeof window === "undefined") return;

  try {
    const scopes = getRecentScopes();
    const now = new Date().toISOString();

    // Find existing entry
    const existingIndex = scopes.findIndex(s => s.path === path);

    if (existingIndex !== -1) {
      // Update existing entry
      scopes[existingIndex].lastVisited = now;
      scopes[existingIndex].visitCount += 1;
    } else {
      // Add new entry
      scopes.push({
        path,
        lastVisited: now,
        visitCount: 1,
      });
    }

    // Sort by lastVisited and trim to max entries
    scopes.sort((a, b) =>
      new Date(b.lastVisited).getTime() - new Date(a.lastVisited).getTime()
    );

    const trimmed = scopes.slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Get popular scopes (sorted by visit count)
 */
export function getPopularScopes(): RecentScope[] {
  const scopes = getRecentScopes();
  return [...scopes].sort((a, b) => b.visitCount - a.visitCount);
}

/**
 * Clear all recent scopes
 */
export function clearRecentScopes(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
