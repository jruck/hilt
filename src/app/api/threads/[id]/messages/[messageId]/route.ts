import { NextRequest, NextResponse } from "next/server";
import { deleteMessage, isValidThreadId, readThread } from "@/lib/threads/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/threads/[id]/messages/[messageId] — remove one message. Deleting the last
 * message deletes the thread. Returns { ok, thread, threadDeleted }.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const { id, messageId } = await params;
    if (!isValidThreadId(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
    if (!readThread(id)) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    const thread = deleteMessage(id, messageId);
    return NextResponse.json({ ok: true, thread, threadDeleted: thread === null });
  } catch (error) {
    console.error("[threads] delete message failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to delete message", detail }, { status: 500 });
  }
}
