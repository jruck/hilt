/**
 * Heat Score Calculation
 *
 * Computes activity-based scores for sizing treemap rectangles.
 * Higher scores = more "heat" = larger rectangles.
 */

import { TreeMetrics, TreeNode } from "./types";

export interface HeatConfig {
  recencyWeight: number;        // Weight for recency score (default: 0.6)
  volumeWeight: number;         // Weight for volume score (default: 0.3)
  runningBonus: number;         // Bonus per running session (default: 0.5)
  recencyHalfLifeHours: number; // Half-life for decay (default: 24)
}

export const DEFAULT_HEAT_CONFIG: HeatConfig = {
  recencyWeight: 0.6,
  volumeWeight: 0.3,
  runningBonus: 0.5,
  recencyHalfLifeHours: 24,
};

/**
 * Calculate heat score for a node based on its metrics.
 *
 * Formula:
 *   heat = (recencyScore × recencyWeight) + (volumeScore × volumeWeight) + runningBonus
 *
 * Where:
 *   - recencyScore = e^(-hoursSinceActivity / halfLife) → 1.0 for just now, 0.5 after 24h
 *   - volumeScore = log10(totalSessions + 1) → logarithmic to prevent domination
 *   - runningBonus = runningCount × bonus → immediate activity boost
 */
export function calculateHeatScore(
  metrics: Omit<TreeMetrics, "heatScore" | "normalizedHeat">,
  config: HeatConfig = DEFAULT_HEAT_CONFIG
): number {
  const now = Date.now();
  const hoursSinceActivity = Math.max(
    0,
    (now - metrics.lastActivity) / (1000 * 60 * 60)
  );

  // Exponential decay based on recency
  // At t=0: score=1.0, at t=halfLife: score=0.5, at t=2*halfLife: score=0.25
  const recencyScore = Math.exp(
    (-hoursSinceActivity * Math.LN2) / config.recencyHalfLifeHours
  );

  // Log-scale volume to prevent large projects from dominating
  // 1 session → 0.3, 10 sessions → 1.0, 100 sessions → 2.0
  const volumeScore = Math.log10(metrics.totalSessions + 1);

  // Bonus for actively running sessions (immediate attention needed)
  const runningBonus = metrics.runningCount * config.runningBonus;

  return (
    recencyScore * config.recencyWeight +
    volumeScore * config.volumeWeight +
    runningBonus
  );
}

/**
 * Normalize heat scores across a set of sibling nodes to 0-1 range.
 * Used for color mapping (cold → warm → hot).
 */
export function normalizeHeatScores(nodes: TreeNode[]): TreeNode[] {
  if (nodes.length === 0) return nodes;

  const scores = nodes.map((n) => n.metrics.heatScore);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min || 1; // Avoid division by zero

  return nodes.map((node) => ({
    ...node,
    metrics: {
      ...node.metrics,
      normalizedHeat: (node.metrics.heatScore - min) / range,
    },
  }));
}

/**
 * Get a color based on normalized heat score.
 * Cold (blue) → Warm (yellow) → Hot (orange/red)
 */
export function getHeatColor(normalizedHeat: number): string {
  if (normalizedHeat < 0.3) return "#3b82f6"; // blue-500 (cold)
  if (normalizedHeat < 0.6) return "#eab308"; // yellow-500 (warm)
  if (normalizedHeat < 0.8) return "#f97316"; // orange-500 (hot)
  return "#ef4444"; // red-500 (very hot)
}

/**
 * Get Tailwind color class based on normalized heat.
 */
export function getHeatColorClass(normalizedHeat: number): string {
  if (normalizedHeat < 0.3) return "text-blue-400";
  if (normalizedHeat < 0.6) return "text-yellow-400";
  if (normalizedHeat < 0.8) return "text-orange-400";
  return "text-red-400";
}
