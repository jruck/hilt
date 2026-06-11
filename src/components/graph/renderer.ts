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

/**
 * User-tunable simulation physics (the legend's Physics dials). Feeds BOTH reflow and
 * live mode; live always overrides decay to ~infinity (never settling is its defining
 * trait), and the fast auto-reflow halves the settle time. Defaults are tuned for
 * re-settling an already-structured seed, not a cold layout: short decay + strong
 * damping (stop dead, no orbiting tail), low gravity (spread, don't contract centerward).
 */
export interface PhysicsTuning {
  gravity: number;
  repulsion: number;
  linkSpring: number;
  linkDistance: number;
  friction: number;
  /** Settle time for reflow (cosmos simulationDecay). Live ignores this. */
  decay: number;
}

/**
 * Scale note (learned by WATCHING it fail): the render space is 4096 units wide and the
 * canonical layout fills it. Early values used linkDistance 8–28 — i.e. every one of the
 * ~18K springs demanded its endpoints sit ~10 units apart in a 4096-unit world, so the
 * whole connected mass collapsed into a knot regardless of gravity/repulsion, and the
 * presets looked identical. Distances here are sized to the SPACE, not to cosmos's
 * toy-example defaults.
 */
export const PHYSICS_DEFAULTS: PhysicsTuning = {
  gravity: 0.08,
  repulsion: 1.2,
  linkSpring: 0.8,
  linkDistance: 80,
  friction: 0.8,
  decay: 1800,
};

/**
 * Physics presets — the named points on the circle↔organic axis the dials span.
 *
 * Circle is the Obsidian-style disc, and the disc is NOT "no gravity" (a first attempt
 * set gravity 0 and got a spread organic blob): the circular boundary IS the equilibrium
 * between a center pull (container) and strong repulsion (pressure) — weakly-connected
 * nodes get pushed to an even rim, clusters float inside, and ANY visible subset re-forms
 * a disc under the same rule. Organic drops the pressure and stiffens springs so the
 * connected mass huddles unevenly. The character persists across filters/reflows —
 * layout LOGIC, visible SET, and live-recalc are independent controls.
 */
export const PHYSICS_PRESETS: Array<{ name: string; tuning: PhysicsTuning }> = [
  // Disc values found by ITERATING IN THE BROWSER (g3-iter series): cosmos gravity is a
  // LINEAR spring to center (force ∝ distance), so anything above ~0.05 crushes a wide
  // disc into a blob in seconds, while weak repulsion can't re-inflate one (fast collapse,
  // slow expansion — the blob trap). Near-zero gravity + max pressure + gentle springs
  // from a wide seed = an evenly-inflated rim with cluster texture inside.
  { name: "Circle", tuning: { gravity: 0.02, repulsion: 3, linkSpring: 0.15, linkDistance: 100, friction: 0.85, decay: 2200 } },
  { name: "Balanced", tuning: { ...PHYSICS_DEFAULTS } },
  { name: "Organic", tuning: { gravity: 0.18, repulsion: 0.7, linkSpring: 1.2, linkDistance: 40, friction: 0.82, decay: 1800 } },
];

/** The out-of-the-box character (user preference: the disc). */
export const PHYSICS_INITIAL: PhysicsTuning = { ...PHYSICS_PRESETS[0].tuning };

/**
 * Bump when the meaning/scale of the dials changes — persisted tunings from an older
 * scale would silently reproduce the old failure mode (the v1 blob).
 */
export const PHYSICS_SCHEMA_VERSION = 2;

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
  /**
   * Run the GPU force simulation over the CURRENT data, seeded from current positions
   * (the "reflow visible" action). Explicit and ephemeral: settles (or hits the safety
   * timeout), freezes, and restores render-only config. `onSettle` fires once at rest.
   * No-op while already reflowing.
   */
  reflow(onSettle?: () => void, opts?: { fast?: boolean }): void;
  /** True while a reflow simulation is in flight. */
  isReflowing(): boolean;
  /** Apply the Physics dials (next sim start; immediately when live is running). */
  setPhysicsTuning(tuning: PhysicsTuning): void;
  /**
   * Continuous physics toggle (the legend's "Live" switch). On = the sim runs until
   * toggled off (decay pushed to ~infinity); off = freeze in place. Session-scoped.
   * Idempotent on repeated `true` so callers can re-assert liveness after a data swap.
   */
  setLiveSimulation(on: boolean): void;
  isLiveSimulation(): boolean;
  /** Viewport/projection only — NEVER mutate canvas pixel dims on iOS. */
  resize(): void;
  /** Frees the GPU context (failing to do so is an iOS jetsam accelerant). */
  destroy(): void;
  /** Test/diagnostic surface. */
  isSimulationRunning(): boolean;
  getZoom(): number;
}
