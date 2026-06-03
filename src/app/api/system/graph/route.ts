import { NextRequest, NextResponse } from "next/server";
import {
  graphDefaultHops,
  graphMaxNodesMobile,
  graphSemanticOverlayEnabled,
  isGraphEnabled,
  isGraphTagsEnabled,
  LAYOUT_VERSION,
} from "@/lib/graph/config";
import {
  getAllEdges,
  getAllNodes,
  getHighestDegreeNodeId,
  getNodeById,
  selectLocalGraph,
  type GraphSelection,
  type NodePositionRow,
} from "@/lib/graph/db";
import { resolveVaultRoot } from "@/lib/graph/build";
import { contractMeetings, degreeMap, layoutSmallGraph } from "@/lib/graph/contract";
import { encodeFromParts, encodeGraphBinary, graphPayloadHeaders } from "@/lib/graph/encode";
import type { GraphScope } from "@/lib/graph/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/system/graph — the binary payload (nodes + edges + positions).
 *
 * Flow:
 *  1. isGraphEnabled() guard (404 when off — feature is completely inert).
 *  2. scope=local: BFS neighborhood around an anchor, positions from the persisted
 *     full-graph layout (encodeGraphBinary reads node_positions).
 *  3. scope=global: CONTRACT meeting nodes into derived people↔project / co-attendee
 *     edges (contract.ts), then lay out the small reduced graph fresh per request
 *     (deterministic) — so the view is "corpuses interacting", not 1,100 meeting
 *     dots herded into a folder ring.
 *  4. `minDegree` drops low-degree survivors; `fmt=json` returns a debug view.
 */
export async function GET(request: NextRequest) {
  if (!isGraphEnabled()) {
    return NextResponse.json({ error: "Graph disabled" }, { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const scope: GraphScope = search.get("scope") === "local" ? "local" : "global";
  const fmt = search.get("fmt") === "json" ? "json" : "bin";
  const includeTags = isGraphTagsEnabled() && search.get("includeTags") === "1";
  const includeIsolated = search.get("includeIsolated") === "1";
  const hops = clampInt(search.get("hops"), graphDefaultHops(), 1, 3);
  const vaultRoot = resolveVaultRoot();

  // Semantic overlay gating (Graph §3/§6):
  //  - flag OFF ⇒ topic/entity nodes + ALL five semantic edge kinds are excluded
  //    everywhere (defends a stale `semantic_built=1` from leaking, like `type != 'tag'`).
  //  - flag ON, GLOBAL ⇒ `similar`/`co_occurrence` are off unless `&semanticEdges=1`
  //    (sparse hubs stay, the dense fuzzy web is opt-in to keep the per-request layout cheap).
  //  - flag ON, LOCAL ⇒ everything included (the ring/fan-out caps already bound them).
  const overlayOn = graphSemanticOverlayEnabled();
  const wantSemanticEdges = search.get("semanticEdges") === "1";
  const globalExcludeKinds: string[] = !overlayOn
    ? ["item_topic", "topic_parent", "item_entity", "co_occurrence", "similar"]
    : wantSemanticEdges
      ? []
      : ["similar", "co_occurrence"];

  let selection: GraphSelection;
  let isLocal = false;
  // Custom positions for the global contracted graph (laid out fresh, not from the DB).
  let positionsById: Map<string, NodePositionRow> | null = null;

  if (scope === "local") {
    isLocal = true;
    const requested = clampInt(search.get("limit"), 0, 0, Number.MAX_SAFE_INTEGER);
    const cap = graphMaxNodesMobile();
    const limit = requested > 0 ? Math.min(requested, cap) : cap;

    const rawNode = search.get("node");
    let anchorId = rawNode ? safeDecode(rawNode) : null;
    if (!anchorId || !getNodeById(anchorId)) {
      anchorId = getHighestDegreeNodeId(undefined, includeTags);
    }
    selection = anchorId
      ? selectLocalGraph({ nodeId: anchorId, hops, limit, includeTags })
      : { nodes: [], edges: [], truncated: false };
    // With the overlay flag off, strip any stale semantic rows from the local set too
    // (defensive — the producer should have removed them, but a stale db can't leak).
    if (!overlayOn) selection = stripSemanticRows(selection);
  } else {
    // Global: contract meetings → a small graph of people / projects / references /
    // (non-meeting) notes, laid out fresh. minDegree drops the low-degree fringe.
    const minDegree = clampInt(search.get("minDegree"), includeIsolated ? 0 : 1, 0, 50);
    let nodes = getAllNodes(undefined, includeTags);
    if (!overlayOn) nodes = nodes.filter((n) => n.type !== "topic" && n.type !== "entity");
    const contracted = contractMeetings(nodes, getAllEdges(undefined, includeTags, globalExcludeKinds), vaultRoot);
    const deg = degreeMap(contracted.nodes, contracted.edges);
    const keptNodes = minDegree > 0
      ? contracted.nodes.filter((n) => (deg.get(n.id) ?? 0) >= minDegree)
      : contracted.nodes;
    const keptIds = new Set(keptNodes.map((n) => n.id));
    const keptEdges = contracted.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
    // Stable id order for deterministic index assignment (matches the selection convention).
    keptNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    selection = { nodes: keptNodes, edges: keptEdges, truncated: false };

    const positions = layoutSmallGraph(keptNodes, keptEdges);
    positionsById = new Map();
    for (const [id, p] of positions) {
      positionsById.set(id, { id, x: p.x, y: p.y, z: null, dirty: 0, layout_version: LAYOUT_VERSION, updated_at: 0 });
    }
  }

  const buffer = positionsById
    ? encodeFromParts(selection.nodes, selection.edges, positionsById, { isLocal, includesTags: includeTags, truncated: selection.truncated, vaultRoot })
    : encodeGraphBinary(selection, { isLocal, includesTags: includeTags, vaultRoot });

  if (fmt === "json") {
    return NextResponse.json({
      scope,
      nodeCount: selection.nodes.length,
      edgeCount: selection.edges.length,
      truncated: selection.truncated,
      truncatedRings: selection.truncatedRings ?? null,
      byteLength: buffer.byteLength,
      nodes: selection.nodes,
      edges: selection.edges,
    });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: graphPayloadHeaders({
      nodeCount: selection.nodes.length,
      edgeCount: selection.edges.length,
      truncated: selection.truncated,
    }),
  });
}

/** Drop semantic overlay nodes/edges from a selection (the flag-off defensive filter). */
const SEMANTIC_EDGE_KINDS = new Set(["item_topic", "topic_parent", "item_entity", "co_occurrence", "similar"]);
function stripSemanticRows(selection: GraphSelection): GraphSelection {
  const nodes = selection.nodes.filter((n) => n.type !== "topic" && n.type !== "entity");
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = selection.edges.filter(
    (e) => !SEMANTIC_EDGE_KINDS.has(e.kind) && keptIds.has(e.source) && keptIds.has(e.target),
  );
  return { ...selection, nodes, edges };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
