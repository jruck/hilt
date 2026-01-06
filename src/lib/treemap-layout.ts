/**
 * Treemap Layout Algorithm
 *
 * Implements squarified treemap for optimal rectangle aspect ratios.
 * Based on Bruls, Huizing, and van Wijk's "Squarified Treemaps" algorithm.
 */

import { TreeNode, Session } from "./types";
import { calculateHeatScore } from "./heat-score";

export interface TreemapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  node: TreeNode;
  renderLevel: 1 | 2 | 3 | 4;
}

export interface TreemapConfig {
  width: number;
  height: number;
  padding: number;   // Gap between rectangles
  minWidth: number;  // Minimum rectangle width
  minHeight: number; // Minimum rectangle height
}

export const DEFAULT_TREEMAP_CONFIG: Partial<TreemapConfig> = {
  padding: 8,
  minWidth: 60,
  minHeight: 40,
};

/**
 * Layout items as treemap rectangles using squarified algorithm.
 *
 * @param items - TreeNodes to layout (should be siblings)
 * @param config - Layout configuration
 * @returns Array of positioned rectangles
 */
export function layoutTreemap(
  items: TreeNode[],
  config: TreemapConfig
): TreemapRect[] {
  if (items.length === 0) return [];

  const { width, height, padding } = config;

  // Filter out items that would be too small
  const validItems = items.filter(
    (item) => item.metrics.heatScore > 0 || item.metrics.totalSessions > 0
  );

  if (validItems.length === 0) return [];

  // Calculate total heat for proportional sizing
  // Use a minimum heat to ensure all items get some space
  const totalHeat = validItems.reduce(
    (sum, item) => sum + Math.max(item.metrics.heatScore, 0.1),
    0
  );

  // Convert heat scores to areas
  const totalArea = width * height;
  const itemsWithArea = validItems.map((item) => ({
    node: item,
    area: (Math.max(item.metrics.heatScore, 0.1) / totalHeat) * totalArea,
  }));

  // Sort by area descending (required for squarified algorithm)
  itemsWithArea.sort((a, b) => b.area - a.area);

  // Run squarified layout
  const rects = squarify(
    itemsWithArea,
    { x: 0, y: 0, width, height },
    padding
  );

  // Add render levels based on size
  return rects.map((rect) => ({
    ...rect,
    renderLevel: getRenderLevel(rect.width, rect.height),
  }));
}

/**
 * Squarified treemap algorithm.
 * Recursively subdivides the container to create well-proportioned rectangles.
 */
function squarify(
  items: Array<{ node: TreeNode; area: number }>,
  container: { x: number; y: number; width: number; height: number },
  padding: number
): Omit<TreemapRect, "renderLevel">[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    // Single item fills the container (with padding)
    return [
      {
        x: container.x + padding / 2,
        y: container.y + padding / 2,
        width: Math.max(0, container.width - padding),
        height: Math.max(0, container.height - padding),
        node: items[0].node,
      },
    ];
  }

  // Determine layout direction (lay out along shorter side)
  const isHorizontal = container.width >= container.height;
  const sideLength = isHorizontal ? container.height : container.width;

  // Find the optimal row of items
  const { row, remaining } = findOptimalRow(items, sideLength);

  // Calculate the width/height of this row
  const rowArea = row.reduce((sum, item) => sum + item.area, 0);
  const rowSize = rowArea / sideLength;

  // Layout the row
  const rowRects: Omit<TreemapRect, "renderLevel">[] = [];
  let offset = 0;

  for (const item of row) {
    const itemSize = item.area / rowSize;

    if (isHorizontal) {
      rowRects.push({
        x: container.x + padding / 2,
        y: container.y + offset + padding / 2,
        width: Math.max(0, rowSize - padding),
        height: Math.max(0, itemSize - padding),
        node: item.node,
      });
    } else {
      rowRects.push({
        x: container.x + offset + padding / 2,
        y: container.y + padding / 2,
        width: Math.max(0, itemSize - padding),
        height: Math.max(0, rowSize - padding),
        node: item.node,
      });
    }

    offset += itemSize;
  }

  // Recursively layout remaining items in the remaining space
  if (remaining.length > 0) {
    const remainingContainer = isHorizontal
      ? {
          x: container.x + rowSize,
          y: container.y,
          width: container.width - rowSize,
          height: container.height,
        }
      : {
          x: container.x,
          y: container.y + rowSize,
          width: container.width,
          height: container.height - rowSize,
        };

    const remainingRects = squarify(remaining, remainingContainer, padding);
    return [...rowRects, ...remainingRects];
  }

  return rowRects;
}

/**
 * Find the optimal row of items that minimizes worst aspect ratio.
 */
function findOptimalRow(
  items: Array<{ node: TreeNode; area: number }>,
  sideLength: number
): {
  row: Array<{ node: TreeNode; area: number }>;
  remaining: Array<{ node: TreeNode; area: number }>;
} {
  if (items.length === 0) {
    return { row: [], remaining: [] };
  }

  if (items.length === 1) {
    return { row: items, remaining: [] };
  }

  let row: Array<{ node: TreeNode; area: number }> = [];
  let bestRatio = Infinity;

  for (let i = 0; i < items.length; i++) {
    const candidate = items.slice(0, i + 1);
    const ratio = worstAspectRatio(candidate, sideLength);

    if (ratio <= bestRatio) {
      bestRatio = ratio;
      row = candidate;
    } else {
      // Ratio got worse, stop here
      break;
    }
  }

  return {
    row,
    remaining: items.slice(row.length),
  };
}

/**
 * Calculate the worst aspect ratio for a row of items.
 * Aspect ratio = max(w/h, h/w), ideal is 1.0 (square).
 */
function worstAspectRatio(
  items: Array<{ node: TreeNode; area: number }>,
  sideLength: number
): number {
  if (items.length === 0 || sideLength === 0) return Infinity;

  const totalArea = items.reduce((sum, item) => sum + item.area, 0);
  const rowWidth = totalArea / sideLength;

  let worst = 0;

  for (const item of items) {
    const itemHeight = item.area / rowWidth;
    const ratio = Math.max(rowWidth / itemHeight, itemHeight / rowWidth);
    if (ratio > worst) {
      worst = ratio;
    }
  }

  return worst;
}

/**
 * Determine render detail level based on rectangle dimensions.
 *
 * Level 1 (Large): Full detail - name, path, session thumbnails, full metrics
 * Level 2 (Medium): Condensed - name, session pills, metrics
 * Level 3 (Small): Summary - name, compact counts
 * Level 4 (Tiny): Minimal - truncated name, dot indicator
 */
export function getRenderLevel(width: number, height: number): 1 | 2 | 3 | 4 {
  const area = width * height;

  // Level 1: Need space for header + session grid + footer
  if (area >= 35000 && width >= 180 && height >= 140) return 1;

  // Level 2: Need space for name + pills + counts
  if (area >= 12000 && width >= 100 && height >= 80) return 2;

  // Level 3: Need space for name + compact counts
  if (area >= 4000 && width >= 70 && height >= 50) return 3;

  // Level 4: Minimal
  return 4;
}

/**
 * Prepare layout items from a tree node.
 * Combines child folders and direct sessions into a flat list for layout.
 */
export function prepareLayoutItems(tree: TreeNode): TreeNode[] {
  const items: TreeNode[] = [];

  // Add child folders
  items.push(...tree.children);

  // Add direct sessions as individual pseudo-nodes
  for (const session of tree.sessions) {
    items.push(createSessionNode(session, tree));
  }

  return items;
}

/**
 * Create a pseudo-TreeNode for a single session.
 * This allows sessions to be laid out alongside folders in the treemap.
 */
function createSessionNode(session: Session, parent: TreeNode): TreeNode {
  const lastActivity = new Date(session.lastActivity).getTime();

  const metrics = {
    totalSessions: 1,
    directSessions: 1,
    activeCount: session.status === "active" ? 1 : 0,
    inboxCount: session.status === "inbox" ? 1 : 0,
    recentCount: session.status === "recent" ? 1 : 0,
    runningCount: session.isRunning ? 1 : 0,
    lastActivity,
  };

  return {
    path: `${parent.path}/__session__${session.id}`,
    name: session.title || session.slug || "Session",
    depth: parent.depth + 1,
    sessions: [session],
    children: [],
    metrics: {
      ...metrics,
      heatScore: calculateHeatScore(metrics),
    },
  };
}

/**
 * Check if a TreeNode represents a single session (pseudo-node).
 */
export function isSessionNode(node: TreeNode): boolean {
  return node.path.includes("/__session__");
}

/**
 * Extract session ID from a session pseudo-node path.
 */
export function getSessionIdFromNode(node: TreeNode): string | null {
  const match = node.path.match(/__session__(.+)$/);
  return match ? match[1] : null;
}
