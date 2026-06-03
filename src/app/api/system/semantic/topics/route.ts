import { NextRequest, NextResponse } from "next/server";
import { isSemanticEnabled } from "@/lib/semantic/config";
import { listTopics, recentTopics } from "@/lib/semantic/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/system/semantic/topics — topic exploration (the locked "first query").
 * Thin wrapper over query.ts; the JSON matches the CLI `--json` shape (a TopicSummary[]).
 * 404 when the semantic layer is off (the whole subsystem is inert without the flag).
 *
 *   ?recent=1        → recency/trending order
 *   ?parent=<id>     → the children of a parent topic (broad→specific drill-down)
 */
export async function GET(request: NextRequest) {
  if (!isSemanticEnabled()) {
    return NextResponse.json({ error: "Semantic layer disabled" }, { status: 404 });
  }
  const search = request.nextUrl.searchParams;
  const recent = search.get("recent") === "1";
  const parent = search.get("parent");
  const topics = recent
    ? recentTopics()
    : listTopics({ parentId: parent && parent.length > 0 ? parent : undefined });
  return NextResponse.json(topics);
}
