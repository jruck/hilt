/**
 * /api/chat/sessions/[id] — one chat session.
 *
 * GET → full session (transcript included).
 * PATCH → { archivedAt?, unreadCount?, title? } — archive/unarchive, mark read/unread,
 *         rename. Transcript and identity fields are not patchable here; turns go through
 *         POST /api/chat/message.
 *
 * The id arrives via URL — isValidChatId gates it before any path is built (traversal guard).
 */
import { NextRequest, NextResponse } from "next/server";
import { isValidChatId, readChat, updateChat, type ChatPatch } from "@/lib/chat/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) {
      return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
    }
    const session = readChat(id);
    if (!session) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (error) {
    console.error("[chat] read failed:", error);
    return NextResponse.json({ error: "Failed to read chat session" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) {
      return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
    }
    if (!readChat(id)) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

    const patch: ChatPatch = {};
    if ("archivedAt" in record) {
      if (record.archivedAt !== null && (typeof record.archivedAt !== "number" || !Number.isFinite(record.archivedAt))) {
        return NextResponse.json({ error: "archivedAt must be a number or null" }, { status: 400 });
      }
      patch.archivedAt = record.archivedAt as number | null;
    }
    if ("unreadCount" in record) {
      if (typeof record.unreadCount !== "number" || !Number.isFinite(record.unreadCount) || record.unreadCount < 0) {
        return NextResponse.json({ error: "unreadCount must be a non-negative number" }, { status: 400 });
      }
      patch.unreadCount = Math.floor(record.unreadCount);
    }
    if ("title" in record) {
      if (typeof record.title !== "string" || !record.title.trim()) {
        return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
      }
      patch.title = record.title.trim();
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no patchable fields (archivedAt, unreadCount, title)" }, { status: 400 });
    }

    return NextResponse.json(updateChat(id, patch));
  } catch (error) {
    console.error("[chat] patch failed:", error);
    return NextResponse.json({ error: "Failed to update chat session" }, { status: 500 });
  }
}
