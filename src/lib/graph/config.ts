import path from "path";

/**
 * Knowledge graph (System → Graph) configuration.
 *
 * Single feature-flag predicate for the entire graph feature. Mirrors the
 * `isLocalAppsEnabled()` precedent (src/lib/local-apps/settings.ts). With the
 * flag OFF (the default) the Graph sub-mode, its API routes, watcher wiring,
 * and the graph SQLite cache are all inert.
 */
export function isGraphEnabled(): boolean {
  return process.env.HILT_GRAPH_ENABLED === "true";
}

/** Derived-cache data dir. Matches the calendar/granola convention. */
export function getGraphDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

/** SQLite path for the derived graph index. */
export function getGraphDbPath(): string {
  return process.env.HILT_GRAPH_DB_PATH || path.join(getGraphDataDir(), "graph.sqlite");
}

/** Marker file written after a build/layout pass, watched by ws-server. */
export function getGraphMarkerPath(): string {
  return path.join(getGraphDataDir(), "graph-build-event.json");
}

/**
 * Opt-in: include the nested `libraries/<sub>` sub-vaults in the global graph.
 * OFF by default — the three sub-vaults (everpro, priceless-misc, ventures) hold
 * ~2,235 mostly-isolated leaf files that would balloon the graph (Node-inclusion
 * policy). When opt-in, the builder models each sub-vault as a single
 * `library_cluster` node rather than walking its raw leaves.
 */
export function graphIncludeLibraries(): boolean {
  return process.env.HILT_GRAPH_INCLUDE_LIBRARIES === "true";
}

/** Bump to invalidate ALL cached node positions. */
export const LAYOUT_VERSION = 1;

/** Bump on any binary wire-format change (distinct from LAYOUT_VERSION). */
export const TRANSPORT_FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// Device budgets (HILT_GRAPH_MAX_NODES_*, HILT_GRAPH_DEFAULT_HOPS). The server
// enforces these ceilings regardless of what the client asks for: never ship the
// global buffer to a phone. Bounded ints mirror the calendar boundedInt precedent.
// ---------------------------------------------------------------------------

/** Hard mobile node cap (local payload). Plan default 1500. Server enforces it. */
export function graphMaxNodesMobile(): number {
  return boundedInt(process.env.HILT_GRAPH_MAX_NODES_MOBILE, 1500, 50, 20000);
}

/** Soft desktop ceiling (above it the server still ships but flags it). Plan default 20000. */
export function graphMaxNodesDesktop(): number {
  return boundedInt(process.env.HILT_GRAPH_MAX_NODES_DESKTOP, 20000, 1000, 500000);
}

/** Default BFS depth for a local-scope query (clamped 1..3 at the route). Plan default 2. */
export function graphDefaultHops(): number {
  return boundedInt(process.env.HILT_GRAPH_DEFAULT_HOPS, 2, 1, 3);
}

/**
 * Cap per-node hub fan-out in local selection (e.g. at most K meeting-edges off a
 * person super-hub) so a local set stays connected to the anchor instead of being
 * swamped by one person's 1000+ meeting edges. Plan-derived default 50.
 */
export function graphHubFanoutCap(): number {
  return boundedInt(process.env.HILT_GRAPH_HUB_FANOUT_CAP, 50, 1, 100000);
}

/** Allow the on-demand tag layer at all (default payload still omits tags regardless). */
export function isGraphTagsEnabled(): boolean {
  return process.env.HILT_GRAPH_TAGS === "true";
}

// ---------------------------------------------------------------------------
// Layout tuning (HILT_GRAPH_LAYOUT_*). Bounded ints mirror the calendar
// boundedInt precedent: non-numeric/empty falls back; in-range clamps.
// ---------------------------------------------------------------------------

/** Fixed full-pass iteration count (never wall-clock). Plan default 300. */
export function graphLayoutIterations(): number {
  return boundedInt(process.env.HILT_GRAPH_LAYOUT_ITERATIONS, 300, 1, 100000);
}

/** Warm-start iterations after a boot/version-valid restart (~10-20% of full). Default 40. */
export function graphLayoutWarmIterations(): number {
  return boundedInt(process.env.HILT_GRAPH_LAYOUT_WARM_ITERATIONS, 40, 1, 100000);
}

/** Iterations for a scoped incremental relayout of the dirty region. Default 60. */
export function graphLayoutIncrementalIterations(): number {
  return boundedInt(process.env.HILT_GRAPH_LAYOUT_INCREMENTAL_ITERATIONS, 60, 1, 100000);
}

/** Debounce window (ms) for coalescing incremental relayout requests. Default 500. */
export function graphLayoutDebounceMs(): number {
  return boundedInt(process.env.HILT_GRAPH_LAYOUT_DEBOUNCE_MS, 500, 0, 60000);
}

/**
 * Iterations processed per cooperative chunk before yielding to the event loop
 * (chunked main-loop, no worker_threads in v1). Default 30 (plan: 20-40).
 */
export function graphLayoutChunkSize(): number {
  return boundedInt(process.env.HILT_GRAPH_LAYOUT_CHUNK_SIZE, 30, 1, 10000);
}

/** Escape hatch: serve hash-placement positions only, never run the simulator. */
export function isGraphLayoutDisabled(): boolean {
  return process.env.HILT_GRAPH_LAYOUT_DISABLED === "true";
}

/**
 * Fixed Barnes-Hut physics settings (deterministic — no wall-clock, no RNG).
 * Reproducible given the seeded hash-placement initial coordinates.
 */
export function graphLayoutPhysics(): {
  timeStep: number;
  gravity: number;
  theta: number;
  springLength: number;
  springCoefficient: number;
  dragCoefficient: number;
  dimensions: number;
} {
  return {
    timeStep: 0.5,
    gravity: -12,
    theta: 0.8,
    springLength: 30,
    springCoefficient: 0.0008,
    dragCoefficient: 0.02,
    dimensions: 2,
  };
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
