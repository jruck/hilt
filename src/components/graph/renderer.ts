/**
 * Renderer-agnostic interface so a WebGPU engine (Phase 3) can swap in over the
 * same binary buffers without touching encode.ts or the API. The WebGL2 baseline
 * is CosmosRenderer (the only file importing @cosmos.gl/graph).
 *
 * NOTE on `mount`: cosmos.gl 2.6.4 attaches to a container <div> (it creates and
 * owns the <canvas> internally), not a bare <canvas> as an earlier plan sketch
 * assumed. The interface therefore takes the container element. A future
 * WebGPURenderer can manage its own canvas inside the same container.
 */

import type { GraphBudget } from "./device-budget";

export interface NodeMeta {
  id: string;
  /** GraphNodeType ordinal (NODE_TYPE_ORDER on the server). */
  typeOrdinal: number;
  label: string;
}

/** Screen-space position of a tracked (labeled) point, in CSS px within the container. */
export interface LabelScreenPos {
  index: number;
  x: number;
  y: number;
  /** Point radius in CSS px, for offsetting the label above the node. */
  radius: number;
}

export interface RendererOptions {
  budget: GraphBudget;
  /** Resolve a CSS background color for the canvas (theme-aware). */
  backgroundColor: string;
  /** Theme-aware edge color (rgba string); subtle but readable on the canvas. */
  linkColor: string;
}

export interface GraphRenderer {
  /** Attach to the container; create the GPU context. */
  mount(container: HTMLDivElement, opts: RendererOptions): void;
  /** Upload finished server coordinates + links + colors + sizes, then freeze. */
  setData(
    positions: Float32Array,
    links: Float32Array,
    colors: Float32Array,
    sizes: Float32Array,
    meta: NodeMeta[],
  ): void;
  applyBudget(budget: GraphBudget): void;
  /** Re-resolve colors for the current data (e.g. on theme change). */
  setColors(colors: Float32Array): void;
  /** Swap node positions in place (e.g. folder-cluster layout toggle). `refit` re-frames. */
  setPositions(positions: Float32Array, refit?: boolean): void;
  /** Update the theme-aware edge color (e.g. on theme change). */
  setLinkColor(color: string): void;
  /** Deep-link focus: center + zoom on a node by point index. */
  focusNode(index: number, scale?: number): void;
  /** Hover: highlight a node's neighbors. `null` clears (never pass []). */
  highlightNeighbors(index: number | null): void;
  /** Click-through: cb receives the point ARRAY INDEX (never a node id). */
  onPointClick(cb: (index: number | null, modifier: boolean) => void): void;
  /** Optional hover callback (index or null on mouse-out). */
  onPointHover(cb: (index: number | null) => void): void;
  /** Debounced zoom callback driving label LOD. */
  onZoomChange(cb: (zoom: number) => void): void;
  /** Undebounced view-change (pan/zoom) callback — drives the HTML label overlay. */
  onViewChange(cb: () => void): void;
  /** Track a subset of points (by index) whose screen positions feed the label overlay. */
  trackLabels(indices: number[]): void;
  /** Current screen-space positions of the tracked points (CSS px within the container). */
  getLabelScreenPositions(): LabelScreenPos[];
  /** render() then pause(); idle is pure GPU render. */
  freeze(): void;
  /** Viewport/projection only — NEVER mutate canvas pixel dims on iOS. */
  resize(): void;
  /** Frees the GPU context (failing to do so is an iOS jetsam accelerant). */
  destroy(): void;
  /** Test/diagnostic surface. */
  isSimulationRunning(): boolean;
  getZoom(): number;
}
