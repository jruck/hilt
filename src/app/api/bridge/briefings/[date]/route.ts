import { NextRequest, NextResponse } from "next/server";
import { getBriefing, markBriefingRead } from "@/lib/bridge/briefing-parser";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params;
    const briefing = await getBriefing(date);
    if (!briefing) {
      return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
    }
    return NextResponse.json(briefing);
  } catch (err) {
    console.error("[bridge/briefings] Error:", err);
    return NextResponse.json({ error: "Failed to get briefing" }, { status: 500 });
  }
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params;
    const ok = await markBriefingRead(date);
    if (!ok) {
      return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bridge/briefings] Error:", err);
    return NextResponse.json({ error: "Failed to mark briefing read" }, { status: 500 });
  }
}
