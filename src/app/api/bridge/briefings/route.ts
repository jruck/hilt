import { NextResponse } from "next/server";
import { listBriefings } from "@/lib/bridge/briefing-parser";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") ?? "30", 10);
    const result = await listBriefings(limit);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bridge/briefings] Error:", err);
    return NextResponse.json({ error: "Failed to list briefings" }, { status: 500 });
  }
}
