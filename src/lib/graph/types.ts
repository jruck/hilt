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

/**
 * Node kinds. `tag` is OFF by default (Decision 4) — only `buildTagLayer()` mints
 * them. `topic`/`entity` are the Phase-2 semantic overlay (OFF unless
 * `graphSemanticOverlayEnabled()`) — only `buildSemanticOverlay()` mints them.
 */
export type GraphNodeType =
  | "note"
  | "reference"
  | "candidate"
  | "person"
  | "project"
  | "north_star"
  | "library_cluster"
  | "tag"
  | "topic" // semantic overlay — emergent cluster (semantic.sqlite `topics`)
  | "entity"; // semantic overlay — resolved entity (semantic.sqlite `entities`)

/**
 * Edge kinds. `tag` edges are OFF by default (Decision 4). The five semantic-overlay
 * kinds are OFF unless `graphSemanticOverlayEnabled()`; `similar`/`co_occurrence` are
 * further off-by-default in GLOBAL scope (on via `&semanticEdges=1`; local includes them).
 */
export type GraphEdgeKind =
  | "wikilink"
  | "connection"
  | "connected_project"
  | "meeting"
  | "tag"
  | "item_topic" // item belongs to topic (item_topics.score)
  | "topic_parent" // topic hierarchy (topics.parent_id), directed child→parent
  | "item_entity" // item mentions entity (item_entities.salience)
  | "co_occurrence" // entity↔entity co-mention (shared-item count)
  | "similar"; // item↔item KNN embedding similarity (kept distinct from co_occurrence)

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
  /** Reported semantic-overlay counts (0 unless the overlay is built). Gate the legend on these. */
  topicNodeCount: number;
  entityNodeCount: number;
  /** True once `buildSemanticOverlay()` has populated the overlay rows at least once. */
  semanticBuilt: boolean;
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
