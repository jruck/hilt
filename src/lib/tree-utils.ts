/**
 * Tree Utilities
 *
 * Builds hierarchical tree structure from flat session list.
 * Used for the Tree View treemap visualization.
 */

import { Session, TreeNode, TreeMetrics } from "./types";
import { calculateHeatScore, normalizeHeatScores } from "./heat-score";

/**
 * Build a tree structure from a flat list of sessions.
 *
 * @param sessions - All sessions under scope (should be prefix-matched already)
 * @param scopePath - Current scope root path (empty string for root)
 * @returns TreeNode representing the scope root with children populated
 */
export function buildTree(sessions: Session[], scopePath: string): TreeNode {
  const normalizedScope = normalizePath(scopePath);

  // Group sessions by their exact projectPath
  const sessionsByPath = groupSessionsByPath(sessions);

  // Extract all unique folder paths
  const allPaths = extractFolderPaths(sessions, normalizedScope);

  // Build the root node
  const root: TreeNode = {
    path: normalizedScope,
    name: getDisplayName(normalizedScope),
    depth: 0,
    sessions: sessionsByPath.get(normalizedScope) || [],
    children: [],
    metrics: createEmptyMetrics(),
  };

  // Build intermediate folder nodes and organize into tree
  const nodeMap = new Map<string, TreeNode>();
  nodeMap.set(normalizedScope, root);

  // Sort paths by depth so parents are created before children
  const sortedPaths = allPaths.sort(
    (a, b) => getPathDepth(a) - getPathDepth(b)
  );

  for (const path of sortedPaths) {
    if (path === normalizedScope) continue;

    const node: TreeNode = {
      path,
      name: getDisplayName(path),
      depth: getRelativeDepth(path, normalizedScope),
      sessions: sessionsByPath.get(path) || [],
      children: [],
      metrics: createEmptyMetrics(),
    };

    nodeMap.set(path, node);

    // Find parent and attach
    const parentPath = getParentPath(path, normalizedScope);
    const parent = nodeMap.get(parentPath);
    if (parent) {
      parent.children.push(node);
    }
  }

  // Calculate metrics bottom-up (post-order traversal)
  calculateNodeMetrics(root);

  // Sort children by heat score and normalize
  sortAndNormalizeTree(root);

  return root;
}

/**
 * Group sessions by their exact projectPath.
 */
function groupSessionsByPath(sessions: Session[]): Map<string, Session[]> {
  const map = new Map<string, Session[]>();

  for (const session of sessions) {
    const path = normalizePath(session.projectPath);
    const existing = map.get(path) || [];
    existing.push(session);
    map.set(path, existing);
  }

  return map;
}

/**
 * Extract all unique folder paths from sessions that are under the scope.
 * Also includes intermediate paths (folders with no direct sessions but have children).
 */
export function extractFolderPaths(
  sessions: Session[],
  scopePath: string
): string[] {
  const paths = new Set<string>();
  const normalizedScope = normalizePath(scopePath);

  for (const session of sessions) {
    const sessionPath = normalizePath(session.projectPath);

    // Add the session's direct path
    paths.add(sessionPath);

    // Add all intermediate paths between scope and session
    let current = sessionPath;
    while (current !== normalizedScope && current.length > normalizedScope.length) {
      const parent = getParentPathRaw(current);
      if (parent.length >= normalizedScope.length) {
        paths.add(parent);
      }
      current = parent;
    }
  }

  // Always include the scope itself
  paths.add(normalizedScope);

  return Array.from(paths);
}

/**
 * Calculate metrics for a node recursively (bottom-up).
 * Children must be calculated first.
 */
function calculateNodeMetrics(node: TreeNode): TreeMetrics {
  // Start with direct sessions
  let totalSessions = node.sessions.length;
  let activeCount = 0;
  let inboxCount = 0;
  let recentCount = 0;
  let runningCount = 0;
  let lastActivity = 0;

  // Count direct session metrics
  for (const session of node.sessions) {
    if (session.status === "active") activeCount++;
    if (session.status === "inbox") inboxCount++;
    if (session.status === "recent") recentCount++;
    if (session.isRunning) runningCount++;

    const activityTime = new Date(session.lastActivity).getTime();
    if (activityTime > lastActivity) {
      lastActivity = activityTime;
    }
  }

  const directSessions = node.sessions.length;

  // Recursively add children metrics
  for (const child of node.children) {
    const childMetrics = calculateNodeMetrics(child);
    totalSessions += childMetrics.totalSessions;
    activeCount += childMetrics.activeCount;
    inboxCount += childMetrics.inboxCount;
    recentCount += childMetrics.recentCount;
    runningCount += childMetrics.runningCount;
    if (childMetrics.lastActivity > lastActivity) {
      lastActivity = childMetrics.lastActivity;
    }
  }

  // Calculate heat score
  const metricsWithoutHeat = {
    totalSessions,
    directSessions,
    activeCount,
    inboxCount,
    recentCount,
    runningCount,
    lastActivity: lastActivity || Date.now(), // Default to now if no activity
  };

  const heatScore = calculateHeatScore(metricsWithoutHeat);

  node.metrics = {
    ...metricsWithoutHeat,
    heatScore,
  };

  return node.metrics;
}

/**
 * Sort children by heat score (descending) and normalize heat values.
 */
function sortAndNormalizeTree(node: TreeNode): void {
  if (node.children.length === 0) return;

  // Recursively process children first
  for (const child of node.children) {
    sortAndNormalizeTree(child);
  }

  // Sort by heat (highest first)
  node.children.sort((a, b) => b.metrics.heatScore - a.metrics.heatScore);

  // Normalize heat scores among siblings
  node.children = normalizeHeatScores(node.children);
}

/**
 * Create empty metrics object.
 */
function createEmptyMetrics(): TreeMetrics {
  return {
    totalSessions: 0,
    directSessions: 0,
    activeCount: 0,
    inboxCount: 0,
    recentCount: 0,
    runningCount: 0,
    lastActivity: 0,
    heatScore: 0,
  };
}

// ============ Path Utilities ============

/**
 * Normalize a path (handle empty, trailing slashes, etc.)
 */
function normalizePath(path: string): string {
  if (!path || path === "/") return "";
  // Remove trailing slash
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Get display name from path (last segment or "All Projects" for root)
 */
function getDisplayName(path: string): string {
  if (!path) return "All Projects";
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] || "All Projects";
}

/**
 * Get the depth of a path (number of segments)
 */
function getPathDepth(path: string): number {
  if (!path) return 0;
  return path.split("/").filter(Boolean).length;
}

/**
 * Get relative depth from scope
 */
function getRelativeDepth(path: string, scopePath: string): number {
  return getPathDepth(path) - getPathDepth(scopePath);
}

/**
 * Get parent path (raw, without scope consideration)
 */
function getParentPathRaw(path: string): string {
  if (!path) return "";
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.length > 0 ? "/" + segments.join("/") : "";
}

/**
 * Get parent path, but stop at scope boundary
 */
function getParentPath(path: string, scopePath: string): string {
  const parent = getParentPathRaw(path);
  // If parent would be above scope, return scope
  if (parent.length < scopePath.length) {
    return scopePath;
  }
  return parent;
}

// ============ Query Utilities ============

/**
 * Get all sessions from a tree recursively.
 */
export function getAllSessions(node: TreeNode): Session[] {
  let sessions = [...node.sessions];
  for (const child of node.children) {
    sessions = sessions.concat(getAllSessions(child));
  }
  return sessions;
}

/**
 * Get sessions to display, prioritized by running > active > inbox > recent.
 * Deduplicates sessions by id to prevent React key conflicts.
 */
export function getDisplaySessions(node: TreeNode, max: number): Session[] {
  const all = getAllSessions(node);

  // Deduplicate sessions by id
  const seen = new Set<string>();
  const unique = all.filter((session) => {
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    return true;
  });

  return unique
    .sort((a, b) => {
      // Running sessions first
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;

      // Then by status priority
      const statusOrder: Record<string, number> = {
        active: 0,
        inbox: 1,
        recent: 2,
      };
      if (a.status !== b.status) {
        return statusOrder[a.status] - statusOrder[b.status];
      }

      // Then by recency
      return (
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      );
    })
    .slice(0, max);
}

/**
 * Find a node by path in the tree.
 */
export function findNode(root: TreeNode, path: string): TreeNode | null {
  const normalizedPath = normalizePath(path);

  if (root.path === normalizedPath) return root;

  for (const child of root.children) {
    const found = findNode(child, normalizedPath);
    if (found) return found;
  }

  return null;
}

/**
 * Check if sessions should roll up from path into scope.
 */
export function isUnderScope(sessionPath: string, scopePath: string): boolean {
  if (!scopePath) return true; // Root scope includes everything

  const normalizedSession = normalizePath(sessionPath);
  const normalizedScope = normalizePath(scopePath);

  return (
    normalizedSession === normalizedScope ||
    normalizedSession.startsWith(normalizedScope + "/")
  );
}
