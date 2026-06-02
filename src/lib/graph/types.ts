/**
 * Knowledge graph (System → Graph) domain types.
 *
 * Renderer-agnostic durable core (Phase 0). The graph is a derived cache over
 * the vault: markdown remains the source of truth (Critical Constraint #2).
 *
 * IMPORTANT — Index-vs-ID gotcha (bake in everywhere): cosmos.gl `onPointClick`
 * returns the point-array INDEX, not a node id, and `setLinks`/`setPointPositions`
 * consume `Float32Array`. The encoder assigns a deterministic index per node; the
 * sidecar `nodes[]` is the index -> GraphNode (hence index -> id/refPath) map the
 * renderer uses for click-through and hover.
 */

/** Node kinds. `tag` is OFF by default (Decision 4) — only `buildTagLayer()` mints them. */
export type GraphNodeType =
  | "note"
  | "reference"
  | "candidate"
  | "person"
  | "project"
  | "north_star"
  | "library_cluster"
  | "tag";

/** Edge kinds. `tag` edges are OFF by default (Decision 4). */
export type GraphEdgeKind =
  | "wikilink"
  | "connection"
  | "connected_project"
  | "meeting"
  | "tag";

/** Single source of truth for scope literals (validated by the API route + deep-link grammar). */
export type GraphScope = "global" | "local";

/** Layout pipeline lifecycle states (stored in `graph_meta.layout_state`). */
export type GraphLayoutState = "idle" | "building" | "running" | "frozen" | "stale";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Absolute vault path, person slug, or null for synthetic nodes (tag/library_cluster). */
  refPath: string | null;
  degree: number;
  colorKey: string | null;
  attrs: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  /** Node ids (not array indices). */
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
  attrs: Record<string, unknown>;
}

export interface GraphMeta {
  enabled: boolean;
  nodeCount: number;
  edgeCount: number;
  /** Reported (for the on-demand tag layer); never shipped in the default payload. */
  tagNodeCount: number;
  builtAt: string | null;
  layoutVersion: number;
  layoutState: GraphLayoutState;
  /** Coarse first-run progress fields (null until a build is in flight). */
  layoutPhase: string | null;
  nodesPlaced: number | null;
  totalNodes: number | null;
  dirty: boolean;
  stale: boolean;
  lastError: string | null;
  truncated?: boolean;
  budgets: {
    mobileMaxNodes: number;
    desktopMaxNodes: number;
    defaultHops: number;
    defaultScope: { desktop: "global"; mobile: "local" };
  };
}

/**
 * Decoded in-memory payload shape (NOT the wire layout — see encode.ts / Binary
 * Transport for the canonical wire format). `positions` and `links` carry array
 * INDICES, index-aligned to `nodes[]`.
 */
export interface GraphPayload {
  /** [x0,y0, x1,y1, ...] index-aligned to nodes[]. */
  positions: Float32Array;
  /** [src0,tgt0, ...] node-array INDICES (Float32 — consumed by cosmos.gl setLinks). */
  links: Float32Array;
  /** Enum index per node. */
  colorKeys: Uint8Array;
  /** Sidecar; index i <-> positions[2i..2i+1]. */
  nodes: GraphNode[];
  truncated: boolean;
}

export class GraphFormatError extends Error {}
