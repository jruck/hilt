import { NextResponse } from "next/server";
import { isGraphEnabled } from "@/lib/graph/config";
import { getEdgesForNode, getNodeById, getNodesByIds } from "@/lib/graph/db";
import type { GraphEdgeKind, GraphNodeType } from "@/lib/graph/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One inspector row: the OTHER endpoint of an edge + how it connects. */
interface Connection {
  id: string;
  type: GraphNodeType;
  label: string;
  refPath: string | null;
  kind: GraphEdgeKind;
  weight: number;
  /** "out" = this node links the neighbor; "in" = the neighbor links this node. */
  direction: "out" | "in";
}

/**
 * GET /api/system/graph/node/:id — single node + its connections (the inspector).
 * JSON only (never binary). Joins each immediate edge to the neighbor's
 * label/type/refPath so the inspector renders a clickable, grouped connection list
 * without N round-trips. Includes the node's own `refPath` (the lazy-resolved
 * navigation target dropped from the bulk sidecar). 404 for an unknown id → the
 * client treats this as a stale-focus case (graceful fallback), never a crash.
 * 404 when the flag is off.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isGraphEnabled()) {
    return NextResponse.json({ error: "Graph disabled" }, { status: 404 });
  }

  const { id } = await params;
  const nodeId = safeDecode(id);
  const node = getNodeById(nodeId);
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const edges = getEdgesForNode(nodeId);
  const neighborIds = Array.from(
    new Set(edges.map((e) => (e.source === nodeId ? e.target : e.source)).filter((nid) => nid !== nodeId)),
  );
  const neighbors = getNodesByIds(neighborIds);

  const connections: Connection[] = [];
  for (const edge of edges) {
    const neighborId = edge.source === nodeId ? edge.target : edge.source;
    if (neighborId === nodeId) continue; // skip self-loops
    const neighbor = neighbors.get(neighborId);
    if (!neighbor) continue; // dangling endpoint — never surface a broken row
    connections.push({
      id: neighbor.id,
      type: neighbor.type,
      label: neighbor.label,
      refPath: neighbor.refPath,
      kind: edge.kind,
      weight: edge.weight,
      direction: edge.source === nodeId ? "out" : "in",
    });
  }
  // Most-weighted, then alphabetical — deterministic and useful ordering within a group.
  connections.sort((a, b) => b.weight - a.weight || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  return NextResponse.json({ node, connections });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
