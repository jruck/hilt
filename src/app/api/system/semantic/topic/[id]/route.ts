import { NextRequest, NextResponse } from "next/server";
import { isSemanticEnabled } from "@/lib/semantic/config";
import { getTopic } from "@/lib/semantic/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/system/semantic/topic/:id — a topic with its child topics, top member items,
 * and lineage history (the in-API version of the CLI `topic <id>` drill-down). Thin
 * wrapper over query.ts; the JSON matches the CLI `--json` shape (a TopicDetail). 404 when
 * the flag is off; 404 when the topic id is unknown (mirrors the CLI's "no topic" exit).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSemanticEnabled()) {
    return NextResponse.json({ error: "Semantic layer disabled" }, { status: 404 });
  }
  const { id } = await params;
  const detail = getTopic(decodeURIComponent(id));
  if (!detail) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
