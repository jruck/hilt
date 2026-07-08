/**
 * GET /api/chat/sessions — chat session summaries, updatedAt desc. Full transcripts stay
 * behind /api/chat/sessions/[id]; this list must render even when individual session files
 * are corrupt (the store skips them).
 */
import { NextResponse } from "next/server";
import { listChats, toChatSummary } from "@/lib/chat/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ sessions: listChats().map(toChatSummary) });
  } catch (error) {
    console.error("[chat] list failed:", error);
    return NextResponse.json({ error: "Failed to list chat sessions" }, { status: 500 });
  }
}
