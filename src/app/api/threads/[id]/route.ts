import { NextRequest, NextResponse } from "next/server";
import { editMessage, isValidThreadId, readThread, resolveThread } from "@/lib/threads/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/threads/[id]
 *   { resolveAction, by? }  → resolve the thread (status "resolved" + resolution record)
 *   { messageId, text }     → edit one message (stamps edited_at)
 * Returns { thread }.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidThreadId(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
    if (!readThread(id)) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

    const body: unknown = await request.json().catch(() => ({}));
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

    const resolveAction = typeof record.resolveAction === "string" ? record.resolveAction.trim() : "";
    if (resolveAction) {
      const by = typeof record.by === "string" && record.by.trim() ? record.by.trim() : "justin";
      return NextResponse.json({ thread: resolveThread(id, { action: resolveAction, by }) });
    }

    const messageId = typeof record.messageId === "string" ? record.messageId : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (messageId) {
      if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
      try {
        return NextResponse.json({ thread: editMessage(id, messageId, text) });
      } catch (error) {
        if (error instanceof Error && error.message === "Message not found") {
          return NextResponse.json({ error: "Message not found" }, { status: 404 });
        }
        throw error;
      }
    }

    return NextResponse.json({ error: "Provide resolveAction or messageId + text" }, { status: 400 });
  } catch (error) {
    console.error("[threads] patch failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to update thread", detail }, { status: 500 });
  }
}
