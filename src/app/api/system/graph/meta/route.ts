import { NextResponse } from "next/server";
import { isGraphEnabled } from "@/lib/graph/config";
import { graphMeta } from "@/lib/graph/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/system/graph/meta — counts, layout version/state, first-run progress
 * (layoutPhase/nodesPlaced/totalNodes), dirty/stale/lastError, and device budgets.
 * The client calls this first (cheap), drives its first-run state machine and
 * scope/limit choice, then fetches the binary. 404 when the flag is off.
 */
export async function GET() {
  if (!isGraphEnabled()) {
    return NextResponse.json({ error: "Graph disabled" }, { status: 404 });
  }
  return NextResponse.json(graphMeta(true));
}
