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
import { PHYSICS_DEFAULTS, type GraphRenderer, type LabelScreenPos, type NodeMeta, type PhysicsTuning, type RendererOptions } from "./renderer";
import type { GraphBudget } from "./device-budget";

/** Cosmos's own values, restored whenever a sim mode ends (hygiene — sims only run in modes). */
const DEFAULT_PHYSICS = { simulationDecay: 5000, simulationFriction: 0.85, simulationGravity: 0.25 } as const;

/** Non-neighbor dim level while a node is hovered/selected (the hover tween's target). */
const GREYOUT_OPACITY = 0.1;

function toSimConfig(t: PhysicsTuning, opts: { live?: boolean; fast?: boolean } = {}) {
  return {
    simulationGravity: t.gravity,
    simulationRepulsion: t.repulsion,
    simulationLinkSpring: t.linkSpring,
    simulationLinkDistance: t.linkDistance,
    simulationFriction: opts.fast ? Math.max(0.5, t.friction - 0.05) : t.friction,
    simulationDecay: opts.live ? 1e9 : opts.fast ? Math.max(300, t.decay * 0.5) : t.decay,
  };
}

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
  private tuning: PhysicsTuning = { ...PHYSICS_DEFAULTS };
  private hoverTweenRaf: number | null = null;
  /** Current pointGreyoutOpacity (1 = no dim). Tween source so rapid hover never restarts. */
  private greyoutCurrent = 1;
  private reflowTailTimer: ReturnType<typeof setTimeout> | null = null;
  private reflowTrackTimer: ReturnType<typeof setInterval> | null = null;
  /** Last links buffer — re-pushed around enableSimulation flips (materializes spring buffers). */
  private lastLinks: Float32Array | null = null;

  /** Flip enableSimulation and re-push positions+links so force buffers exist under the new flag. */
  private setSimulationEnabled(on: boolean, extraConfig: Record<string, unknown> = {}): void {
    if (!this.graph) return;
    const current = Float32Array.from(this.graph.getPointPositions());
    this.graph.setConfig({ enableSimulation: on, ...extraConfig });
    if (current.length > 0) this.graph.setPointPositions(current, true);
    if (this.lastLinks) this.graph.setLinks(this.lastLinks);
    this.graph.render();
  }

  mount(container: HTMLDivElement, opts: RendererOptions): void {
    this.container = container;
    this.budget = opts.budget;
    this.graph = new Graph(container, {
      backgroundColor: opts.backgroundColor,
      // Pin the coordinate space to the WebGL max (4096). cosmos was silently clamping
      // to this anyway ("spaceSize reduced to 4096"); we instead scale server positions
      // to fill it (setData), so the layout spreads evenly with no squish.
      spaceSize: 4096,
      // Simulation DISABLED at rest — enableSimulation:true at construction silently
      // breaks cosmos 2.6.4's GPU hover picking (cursor never flips, onClick gets no
      // index; bisected empirically in-browser). Sim modes flip this flag ON at entry and
      // OFF at exit, re-pushing BOTH positions and links around each flip: the re-push is
      // what materializes the lazily-created force/velocity buffers under the new flag
      // (re-pushing only positions leaves the link springs absent — a sim that "runs"
      // with nothing pushing, the original reflow bug).
      enableSimulation: false,
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
      pointGreyoutOpacity: GREYOUT_OPACITY,
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
    this.lastLinks = links;
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
      // Ease back up from WHEREVER the dim currently is, then unselect at full opacity.
      // (Skimming across small dots fires hover/out rapidly; tweening from current — not
      // from a fixed start — is what keeps that from flickering.)
      // No render() here either (see tweenGreyout) — a hover-out render would wipe the
      // NEXT node's just-established hover when skimming between dots.
      this.tweenGreyout(1, 120, () => {
        this.graph?.unselectPoints();
      });
      return;
    }
    const neighbors = this.adjacency.get(index) ?? [];
    this.graph.selectPointsByIndices([index, ...neighbors]);
    // Ease the dim-down so the highlight reads as a transition, not a hard cut. From the
    // CURRENT level: moving between nodes while already dimmed stays dimmed (no restart).
    this.tweenGreyout(GREYOUT_OPACITY, 140);
  }

  /**
   * Tween pointGreyoutOpacity from its current value to `target` (ease-out).
   *
   * CRITICAL: never call `graph.render()` here. In cosmos 2.6.4, render() runs the
   * orchestrator update() which unconditionally CLEARS `store.hoveredPoint` — a per-frame
   * render in the hover path wipes the hover the GPU pick just found, the pick re-finds
   * it, mouseover refires, and the loop oscillates: visible dim-flicker AND ~coin-flip
   * dead clicks (cosmos reports a click as "the hovered point"; mid-wipe that's
   * undefined = background click). The continuous frame loop picks the config change up
   * on its own — setConfig alone is enough.
   */
  private tweenGreyout(target: number, durationMs: number, onDone?: () => void): void {
    if (!this.graph) return;
    if (this.hoverTweenRaf != null) {
      cancelAnimationFrame(this.hoverTweenRaf);
      this.hoverTweenRaf = null;
    }
    const from = this.greyoutCurrent;
    if (Math.abs(from - target) < 0.01) {
      this.greyoutCurrent = target;
      this.graph.setConfig({ pointGreyoutOpacity: target });
      onDone?.();
      return;
    }
    const startedAt = performance.now();
    const step = (now: number): void => {
      this.hoverTweenRaf = null;
      if (!this.graph) return;
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - t) * (1 - t); // ease-out
      this.greyoutCurrent = from + (target - from) * eased;
      this.graph.setConfig({ pointGreyoutOpacity: this.greyoutCurrent });
      if (t < 1) this.hoverTweenRaf = requestAnimationFrame(step);
      else onDone?.();
    };
    this.hoverTweenRaf = requestAnimationFrame(step);
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
  reflow(onSettle?: () => void, opts: { fast?: boolean } = {}): void {
    if (!this.graph || this.simMode !== "off") return;
    this.simMode = "reflow";
    this.reflowOnSettle = onSettle ?? null;
    // Settle profile from the user's tuning dials; `fast` (the auto-reflow on filter
    // changes) halves the settle time and damps slightly harder. The flag flip + re-push
    // materializes the force buffers (picking stays off only while simulating).
    this.setSimulationEnabled(true, toSimConfig(this.tuning, { fast: opts.fast }));
    this.graph.start(opts.fast ? 0.35 : 0.5);
    // Two-stage stop at the dial's settle time (halved for fast): at ~85% in, damping
    // ramps hard (a brief ease-out tail — a dead cut read as harsh, the natural decay
    // tail as aimless drift); shortly after, pause for good. Camera tracking ALSO stops
    // at the tail so the final approach is visually still — overlapping fits during the
    // cloud's spring overshoot read as zoom "pulsing" (observed in browser testing).
    const duration = Math.max(600, Math.min(6000, opts.fast ? this.tuning.decay * 0.5 : this.tuning.decay));
    this.reflowTailTimer = setTimeout(() => {
      if (this.simMode !== "reflow" || !this.graph) return;
      this.graph.setConfig({ simulationFriction: 0.55 });
      if (this.reflowTrackTimer) {
        clearInterval(this.reflowTrackTimer);
        this.reflowTrackTimer = null;
      }
    }, duration * 0.85);
    this.reflowTimer = setTimeout(() => this.finishReflow(), duration + 220);
    // Camera TRACKS the motion: long-duration fits retargeted on a slower cadence blend
    // into a continuous follow (each new fit redirects the in-flight animation).
    this.reflowTrackTimer = setInterval(() => {
      if (this.simMode === "reflow" && this.graph) this.graph.fitView(700);
    }, 600);
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
      this.setSimulationEnabled(true, toSimConfig(this.tuning, { live: true }));
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
      this.setSimulationEnabled(false, DEFAULT_PHYSICS);
      this.graph.render();
      this.viewChangeCb?.();
    }
  }

  isLiveSimulation(): boolean {
    return this.simMode === "live";
  }

  /**
   * Apply the Physics dials. Takes effect on the next reflow/live start — and immediately
   * when live is running (re-energized with a small alpha so the change is visible now,
   * which is what makes live mode the tuning playground).
   */
  setPhysicsTuning(tuning: PhysicsTuning): void {
    this.tuning = { ...tuning };
    if (this.simMode === "live" && this.graph) {
      this.graph.setConfig(toSimConfig(this.tuning, { live: true }));
      this.graph.start(0.25);
    }
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
    if (this.reflowTailTimer) {
      clearTimeout(this.reflowTailTimer);
      this.reflowTailTimer = null;
    }
    if (this.reflowTrackTimer) {
      clearInterval(this.reflowTrackTimer);
      this.reflowTrackTimer = null;
    }
    const cb = this.reflowOnSettle;
    this.reflowOnSettle = null;
    if (this.graph) {
      this.graph.pause();
      // Back to render-only: restores hover/click picking (broken while the flag is on).
      this.setSimulationEnabled(false, DEFAULT_PHYSICS);
      // Final crisp frame on the settled result (fast — it's a touch-up after the
      // mid-motion fit, not the whole journey).
      this.graph.fitView(350);
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
    if (this.reflowTailTimer) {
      clearTimeout(this.reflowTailTimer);
      this.reflowTailTimer = null;
    }
    if (this.reflowTrackTimer) {
      clearInterval(this.reflowTrackTimer);
      this.reflowTrackTimer = null;
    }
    if (this.liveFitTimer) {
      clearTimeout(this.liveFitTimer);
      this.liveFitTimer = null;
    }
    if (this.hoverTweenRaf != null) {
      cancelAnimationFrame(this.hoverTweenRaf);
      this.hoverTweenRaf = null;
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
