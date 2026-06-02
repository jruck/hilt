import { NextRequest, NextResponse } from "next/server";
import { isGraphEnabled } from "@/lib/graph/config";
import { buildFullGraph } from "@/lib/graph/build";
import { getGraphDb, graphMeta } from "@/lib/graph/db";
import { getLayoutState, requestFullLayout } from "@/lib/graph/layout";
import { touchGraphChanged } from "@/lib/graph/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/system/graph/rebuild — operational, monitor-first (Constraint #4):
 * a manual full rebuild + relayout. Single-flight: 409 { blocked: true } if a
 * layout/rebuild pass is already running. A full rebuild supersedes the
 * incremental queue (dirty marks are re-derived from the full build). Never
 * deletes vault content (the graph is a derived cache under DATA_DIR). 404 off.
 *
 * Request:  { fullLayout?: boolean; bumpLayoutVersion?: boolean }
 * Response: { ok, nodeCount, edgeCount, layoutVersion, durationMs, blocked }
 */
export async function POST(request: NextRequest) {
  if (!isGraphEnabled()) {
    return NextResponse.json({ error: "Graph disabled" }, { status: 404 });
  }

  // Reject up front if a pass is already in flight (single-flight contract).
  if (getLayoutState().status === "running") {
    return NextResponse.json({ ok: false, blocked: true }, { status: 409 });
  }

  let body: { fullLayout?: boolean; bumpLayoutVersion?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const startedAt = Date.now();
  const db = getGraphDb();
  const result = buildFullGraph();

  // Default to running the layout pass unless explicitly disabled by the caller.
  if (body.fullLayout !== false) {
    const layout = await requestFullLayout("rebuild", { db });
    if (layout.blocked) {
      // A concurrent pass slipped in between the check and the call.
      return NextResponse.json({ ok: false, blocked: true }, { status: 409 });
    }
  }

  // Notify the WS layer (decoupled marker write — ws-server watches the file and
  // broadcasts `graph` `changed`). A manual rebuild always rebuilds the whole index.
  touchGraphChanged({ kind: "full" });

  const meta = graphMeta(true, db);
  return NextResponse.json({
    ok: true,
    blocked: false,
    nodeCount: result.nodeCount,
    edgeCount: result.edgeCount,
    layoutVersion: meta.layoutVersion,
    durationMs: Date.now() - startedAt,
  });
}
