/**
 * Human-facing labels for node types and edge kinds — the single source the legend,
 * inspector, and any future hover surface share so the graph's vocabulary stays
 * consistent. Dot classes mirror the cosmos.gl palette (graph-style.ts) at the
 * Tailwind-token level for CSS chips (the WebGL buffer is normalized separately).
 *
 * `NODE_TYPE_BY_ORDINAL` is index-aligned to NODE_TYPE_ORDER (encode.ts) — the
 * sidecar ships ordinals, so the inspector maps ordinal -> type here.
 */

import type { GraphEdgeKind, GraphNodeType } from "@/lib/graph/types";

/** Ordinal -> type, aligned to NODE_TYPE_ORDER on the server (append-only). */
export const NODE_TYPE_BY_ORDINAL: GraphNodeType[] = [
  "note",
  "reference",
  "candidate",
  "person",
  "project",
  "north_star",
  "library_cluster",
  "tag",
];

export const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  note: "Note",
  reference: "Reference",
  candidate: "Candidate",
  person: "Person",
  project: "Project",
  north_star: "North Star",
  library_cluster: "Cluster",
  tag: "Tag",
};

/** Tailwind background tokens mirroring the WebGL palette (graph-style.ts TYPE_HUE). */
export const NODE_TYPE_DOT: Record<GraphNodeType, string> = {
  note: "bg-slate-400",
  reference: "bg-blue-500",
  candidate: "bg-amber-500",
  person: "bg-emerald-500",
  project: "bg-violet-500",
  north_star: "bg-rose-500",
  library_cluster: "bg-teal-500",
  tag: "bg-slate-500",
};

export function nodeTypeLabel(ordinal: number): string {
  return NODE_TYPE_LABEL[NODE_TYPE_BY_ORDINAL[ordinal] ?? "note"];
}

export function nodeTypeDot(ordinal: number): string {
  return NODE_TYPE_DOT[NODE_TYPE_BY_ORDINAL[ordinal] ?? "note"];
}

/** Short header shown above each connection group in the inspector / edge legend. */
export const EDGE_KIND_LABEL: Record<GraphEdgeKind, string> = {
  wikilink: "Wiki links",
  connection: "Related",
  connected_project: "Projects",
  meeting: "Meetings",
  tag: "Tags",
};

/** One-line "what this connection means" copy for the legend popover. */
export const EDGE_KIND_DESCRIPTION: Record<GraphEdgeKind, string> = {
  wikilink: "[[wikilink]] between notes",
  connection: "References the library judge tied together",
  connected_project: "A reference supporting a project",
  meeting: "People & projects linked via shared meetings",
  tag: "A shared #tag",
};

/** Stable display order for connection groups (most structural first). */
export const EDGE_KIND_ORDER: GraphEdgeKind[] = [
  "wikilink",
  "connection",
  "connected_project",
  "meeting",
  "tag",
];
