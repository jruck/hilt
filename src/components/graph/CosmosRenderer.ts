/**
 * CosmosRenderer — the ONLY file importing `@cosmos.gl/graph` (WebGL2 baseline).
 *
 * Owns a single cosmos.gl `Graph`, uploads precomputed server coordinates straight
 * into GPU buffers, and FREEZES at rest: `render()` then `pause()` (the real freeze
 * idiom — there is no enableSimulation flag that magically does this for an already
 * laid-out graph). Idle is pure GPU render (~60fps, ~0 CPU).
 *
 * cosmos.gl version is pinned at 2.6.4 (package.json). Re-verify method names on
 * upgrade — the package is in flux. Verified against 2.6.4 dist/index.d.ts:
 *   - constructor(div, config)
 *   - setPointPositions(Float32Array, dontRescale), setLinks(Float32Array),
 *     setPointColors(Float32Array rgba), setPointSizes(Float32Array)
 *   - render(alpha?), pause(), isSimulationRunning (getter)
 *   - zoomToPointByIndex(index, duration, scale)
 *   - getAdjacentIndices(index), selectPointsByIndices(indices), unselectPoints()
 *   - config: enableSimulation, onClick(index, pos, event), onPointMouseOver/Out,
 *     onZoom, pixelRatio, backgroundColor, focusedPointIndex.
 *
 * Index-vs-ID gotcha: onClick/hover return the point ARRAY INDEX, never a node id.
 * GraphView maps index -> { id, type, label } via the parallel meta[] array.
 */

import { Graph } from "@cosmos.gl/graph";
import type { GraphRenderer, LabelScreenPos, NodeMeta, RendererOptions } from "./renderer";
import type { GraphBudget } from "./device-budget";

/**
 * Simulation profiles. Cosmos defaults (decay 5000, friction 0.85, gravity 0.25) are tuned
 * for cold layouts; our sims start from an already-structured seed, so:
 *  - REFLOW: short decay + stronger damping → snaps to equilibrium in ~2-3s and stops dead
 *    (the default's long tail reads as aimless orbiting); low gravity keeps the result
 *    spread out instead of contracting centerward.
 *  - LIVE: decay ~infinity (never settles by design) at the same low gravity.
 *  - DEFAULT: cosmos's own values, restored whenever a mode ends.
 */
const REFLOW_PHYSICS = { simulationDecay: 1800, simulationFriction: 0.75, simulationGravity: 0.1 } as const;
const LIVE_PHYSICS = { simulationDecay: 1e9, simulationFriction: 0.85, simulationGravity: 0.1 } as const;
const DEFAULT_PHYSICS = { simulationDecay: 5000, simulationFriction: 0.85, simulationGravity: 0.25 } as const;

export class CosmosRenderer implements GraphRenderer {
  private graph: Graph | null = null;
  private container: HTMLDivElement | null = null;
  private adjacency: Map<number, number[]> = new Map();
  private nodeCount = 0;
  private hasFit = false;
  private clickCb: ((index: number | null, modifier: boolean) => void) | null = null;
  private hoverCb: ((index: number | null) => void) | null = null;
  private zoomCb: ((zoom: number) => void) | null = null;
  private viewChangeCb: (() => void) | null = null;
  private budget: GraphBudget | null = null;
  private zoomDebounce: ReturnType<typeof setTimeout> | null = null;
  private simMode: "off" | "reflow" | "live" = "off";
  private reflowOnSettle: (() => void) | null = null;
  private reflowTimer: ReturnType<typeof setTimeout> | null = null;
  private liveFitTimer: ReturnType<typeof setTimeout> | null = null;

  mount(container: HTMLDivElement, opts: RendererOptions): void {
    this.container = container;
    this.budget = opts.budget;
    this.graph = new Graph(container, {
      backgroundColor: opts.backgroundColor,
      // Pin the coordinate space to the WebGL max (4096). cosmos was silently clamping
      // to this anyway ("spaceSize reduced to 4096"); we instead scale server positions
      // to fill it (setData), so the layout spreads evenly with no squish.
      spaceSize: 4096,
      // Simulation ENABLED at construction but never started: cosmos only initializes
      // its force programs when this is true at init (a runtime setConfig flip creates
      // velocity buffers but no forces — the original reflow bug: a sim that "ran" with
      // nothing pushing). Verified in 2.6.4 source: only start()/unpause() ever set
      // isSimulationRunning, so enabling here causes no movement; setData's trailing
      // pause() is belt-and-suspenders. Reflow/Live are the explicit opt-ins.
      enableSimulation: true,
      onSimulationTick: () => {
        // Labels must track the moving points while a reflow/live sim runs.
        this.viewChangeCb?.();
      },
      onSimulationEnd: () => this.handleSimulationEnd(),
      enableDrag: false,
      pixelRatio: opts.budget.pixelRatio,
      // Constant on-screen node size regardless of zoom. Without this a fit-to-view
      // 2.5k-node global graph collapses into faint sub-pixel dots; keeping points at
      // their degree-scaled screen size is the difference between "washed out" and legible.
      scalePointsOnZoom: false,
      // Visible-but-subtle edges. cosmos default link color is too faint to read the
      // structure on the warm light canvas; resolved theme-aware by GraphView.
      linkColor: opts.linkColor,
      linkWidth: 1.1,
      // Hover ring + focus ring read on either theme.
      renderHoveredPointRing: true,
      hoveredPointCursor: "pointer",
      // Greyout non-neighbors on hover rather than hiding them.
      pointGreyoutOpacity: 0.1,
      onClick: (index, _pos, event) => {
        this.clickCb?.(index ?? null, !!(event && (event.metaKey || event.ctrlKey)));
      },
      onPointMouseOver: (index) => {
        this.hoverCb?.(index);
      },
      onPointMouseOut: () => {
        this.hoverCb?.(null);
      },
      onZoom: () => {
        // Undebounced: the label overlay must track the canvas during pan/zoom.
        this.viewChangeCb?.();
        if (!this.zoomCb || !this.graph) return;
        if (this.zoomDebounce) clearTimeout(this.zoomDebounce);
        this.zoomDebounce = setTimeout(() => {
          if (this.graph) this.zoomCb?.(this.graph.getZoomLevel());
        }, 120);
      },
    } as ConstructorParameters<typeof Graph>[1]);
  }

  setData(
    positions: Float32Array,
    links: Float32Array,
    colors: Float32Array,
    sizes: Float32Array,
    meta: NodeMeta[],
  ): void {
    if (!this.graph) return;
    // A data swap supersedes any in-flight reflow; live mode is paused by the trailing
    // pause() below and re-asserted by the caller's data effect (setLiveSimulation(true)).
    if (this.simMode === "reflow") this.finishReflow();
    if (this.simMode === "live") this.simMode = "off";
    this.nodeCount = meta.length;
    this.adjacency = buildAdjacency(links, this.nodeCount);
    // Scale server coords uniformly to fill the 4096 space (with padding) so the layout
    // spreads evenly instead of clustering in a corner / getting clamped. Aspect-preserving.
    this.graph.setPointPositions(scaleToSpace(positions, 4096, 96), true);
    this.graph.setLinks(links);
    this.graph.setPointColors(colors);
    this.graph.setPointSizes(sizes);
    this.graph.render();
    // Frame the whole graph on first load so it fills the viewport instead of sitting
    // as a tiny central cluster. Only once per mount — later refetches (scope/refresh)
    // must not yank the user's pan/zoom.
    if (!this.hasFit) {
      this.graph.fitView(0);
      this.hasFit = true;
    }
    this.graph.render();
    this.graph.pause();
  }

  setColors(colors: Float32Array): void {
    if (!this.graph) return;
    this.graph.setPointColors(colors);
    this.graph.render();
  }

  setPositions(positions: Float32Array, refit = false): void {
    if (!this.graph) return;
    // Same uniform scale into the 4096 space as setData, so a layout swap stays framed.
    this.graph.setPointPositions(scaleToSpace(positions, 4096, 96), true);
    if (refit) this.graph.fitView(500);
    this.graph.render();
  }

  setLinkColor(color: string): void {
    if (!this.graph) return;
    this.graph.setConfig({ linkColor: color });
    this.graph.render();
  }

  applyBudget(budget: GraphBudget): void {
    this.budget = budget;
    if (!this.graph) return;
    this.graph.setConfig({ pixelRatio: budget.pixelRatio });
  }

  focusNode(index: number, scale = 8): void {
    if (!this.graph) return;
    if (index < 0 || index >= this.nodeCount) return;
    this.graph.zoomToPointByIndex(index, 700, scale);
  }

  highlightNeighbors(index: number | null): void {
    if (!this.graph) return;
    // Gotcha: passing [] greys out ALL points. To clear, call unselectPoints().
    if (index == null) {
      this.graph.unselectPoints();
      return;
    }
    const neighbors = this.adjacency.get(index) ?? [];
    this.graph.selectPointsByIndices([index, ...neighbors]);
  }

  onPointClick(cb: (index: number | null, modifier: boolean) => void): void {
    this.clickCb = cb;
  }

  onPointHover(cb: (index: number | null) => void): void {
    this.hoverCb = cb;
  }

  onZoomChange(cb: (zoom: number) => void): void {
    this.zoomCb = cb;
  }

  onViewChange(cb: () => void): void {
    this.viewChangeCb = cb;
  }

  trackLabels(indices: number[]): void {
    this.graph?.trackPointPositionsByIndices(indices);
  }

  getLabelScreenPositions(): LabelScreenPos[] {
    if (!this.graph) return [];
    const tracked = this.graph.getTrackedPointPositionsMap();
    const out: LabelScreenPos[] = [];
    tracked.forEach((space, index) => {
      const screen = this.graph!.spaceToScreenPosition([space[0], space[1]]);
      out.push({ index, x: screen[0], y: screen[1], radius: this.graph!.getPointRadiusByIndex(index) ?? 0 });
    });
    return out;
  }

  freeze(): void {
    if (!this.graph) return;
    // render() once, then pause() — the real freeze idiom (cosmos.gl 2.6.4).
    this.graph.render();
    this.graph.pause();
  }

  /**
   * Reflow: one-shot GPU settle over the current (possibly filtered) data, seeded from
   * current positions. The simulation pipeline exists from construction (enableSimulation
   * true at init — forces don't materialize on a runtime flip); `start(alpha)` injects
   * energy, the default decay (5000) bleeds it off in a few seconds, `onSimulationEnd`
   * freezes; a hard timeout backstops a sim that never converges. No-op while live mode
   * or another reflow is running.
   */
  reflow(onSettle?: () => void): void {
    if (!this.graph || this.simMode !== "off") return;
    this.simMode = "reflow";
    this.reflowOnSettle = onSettle ?? null;
    // Fast-settle profile: a short decay + stronger velocity damping make the layout snap
    // to equilibrium in ~2-3s and STOP DEAD (the slow default tail reads as aimless
    // orbiting — the cloud carries residual angular momentum nothing damps). Lower gravity
    // than cosmos's default keeps the result spread out instead of contracting centerward
    // (the server layout's equilibrium is wider; matching it avoids the shrink-then-empty
    // -space effect). Defaults are restored when the mode ends.
    this.graph.setConfig(REFLOW_PHYSICS);
    this.graph.start(0.5);
    this.reflowTimer = setTimeout(() => this.finishReflow(), 8000);
  }

  isReflowing(): boolean {
    return this.simMode === "reflow";
  }

  /**
   * Live simulation toggle: continuous physics (decay pushed effectively to infinity so
   * the energy never bleeds off) until toggled off. Session-scoped by design — a standing
   * GPU load shouldn't survive a reload. Idempotent on repeated `true` (used by the data
   * effect to re-assert liveness after a setData pause).
   */
  setLiveSimulation(on: boolean): void {
    if (!this.graph) return;
    if (on) {
      if (this.simMode === "reflow") this.finishReflow();
      const alreadyLive = this.simMode === "live";
      this.simMode = "live";
      this.graph.setConfig(LIVE_PHYSICS);
      this.graph.start(0.3); // gentler than reflow — ambient motion, not an explosion
      // One re-frame after the initial collapse, then the camera is the user's again
      // (continuous fitting would fight pan/zoom).
      if (!alreadyLive) {
        if (this.liveFitTimer) clearTimeout(this.liveFitTimer);
        this.liveFitTimer = setTimeout(() => {
          if (this.simMode === "live" && this.graph) this.graph.fitView(600);
        }, 1800);
      }
    } else {
      if (this.simMode !== "live") return;
      this.simMode = "off";
      if (this.liveFitTimer) {
        clearTimeout(this.liveFitTimer);
        this.liveFitTimer = null;
      }
      this.graph.pause();
      this.graph.setConfig(DEFAULT_PHYSICS);
      this.graph.render();
      this.viewChangeCb?.();
    }
  }

  isLiveSimulation(): boolean {
    return this.simMode === "live";
  }

  /** cosmos onSimulationEnd — natural decay end (reflow settled) or an explicit stop(). */
  private handleSimulationEnd(): void {
    if (this.simMode === "reflow") this.finishReflow();
    else if (this.simMode === "live" && this.graph) this.graph.start(0.4); // never let live die
  }

  private finishReflow(): void {
    if (this.simMode !== "reflow") return;
    this.simMode = "off";
    if (this.reflowTimer) {
      clearTimeout(this.reflowTimer);
      this.reflowTimer = null;
    }
    const cb = this.reflowOnSettle;
    this.reflowOnSettle = null;
    if (this.graph) {
      this.graph.pause();
      this.graph.setConfig(DEFAULT_PHYSICS);
      // Auto-frame the settled result — the relaxed equilibrium is usually more compact
      // than the canonical layout, and a small blob in a big empty viewport reads broken.
      this.graph.fitView(600);
      this.graph.render();
    }
    this.viewChangeCb?.(); // final label snap
    cb?.();
  }

  resize(): void {
    // cosmos.gl handles canvas resize via ResizeObserver internally; we only need
    // to nudge a re-render. NEVER manually set canvas pixel dimensions on iOS.
    if (!this.graph) return;
    this.graph.render();
  }

  destroy(): void {
    if (this.zoomDebounce) {
      clearTimeout(this.zoomDebounce);
      this.zoomDebounce = null;
    }
    if (this.reflowTimer) {
      clearTimeout(this.reflowTimer);
      this.reflowTimer = null;
    }
    if (this.liveFitTimer) {
      clearTimeout(this.liveFitTimer);
      this.liveFitTimer = null;
    }
    this.simMode = "off";
    this.reflowOnSettle = null;
    if (this.graph) {
      this.graph.destroy();
      this.graph = null;
    }
    this.container = null;
    this.adjacency = new Map();
    this.nodeCount = 0;
    this.hasFit = false;
  }

  isSimulationRunning(): boolean {
    return this.graph?.isSimulationRunning ?? false;
  }

  getZoom(): number {
    return this.graph?.getZoomLevel() ?? 1;
  }
}

/**
 * Uniformly scale a position buffer ([x0,y0,x1,y1,...]) to fill a `size`×`size` box with
 * `pad` margin, preserving aspect ratio and centering. Returns a new Float32Array.
 */
function scaleToSpace(positions: Float32Array, size: number, pad: number): Float32Array {
  if (positions.length < 2) return positions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i], y = positions[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const target = size - pad * 2;
  const scale = Math.min(target / spanX, target / spanY);
  // Center the (scaled) bbox within the box.
  const offX = pad + (target - spanX * scale) / 2;
  const offY = pad + (target - spanY * scale) / 2;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 2) {
    out[i] = offX + (positions[i] - minX) * scale;
    out[i + 1] = offY + (positions[i + 1] - minY) * scale;
  }
  return out;
}

/** Build adjacency (index -> neighbor indices) once from the links buffer. */
function buildAdjacency(links: Float32Array, nodeCount: number): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (let i = 0; i < links.length; i += 2) {
    const s = links[i];
    const t = links[i + 1];
    if (s < 0 || s >= nodeCount || t < 0 || t >= nodeCount) continue;
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }
  return adj;
}
