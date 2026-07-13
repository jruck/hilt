import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { appendLibraryEvents } from "@/lib/library/events";
import {
  appendToThread,
  createThread,
  listThreads,
  normalizeTarget,
  openThreadForTarget,
  threadsForTarget,
  toThreadSummary,
} from "@/lib/threads/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * GET /api/threads → { threads: ThreadSummary[] } (all threads, updated_at desc).
 * GET /api/threads?target=<json-encoded CommentTarget> → { threads: Thread[] } (full
 * transcripts for one anchor, oldest first).
 */
export async function GET(request: NextRequest) {
  try {
    const targetParam = request.nextUrl.searchParams.get("target");
    if (targetParam !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(targetParam);
      } catch {
        return NextResponse.json({ error: "target must be JSON-encoded" }, { status: 400 });
      }
      const target = normalizeTarget(parsed);
      if (!target) return NextResponse.json({ error: "Invalid comment target" }, { status: 400 });
      return NextResponse.json({ threads: threadsForTarget(target) });
    }
    return NextResponse.json({ threads: listThreads().map(toThreadSummary) });
  } catch (error) {
    console.error("[threads] list failed:", error);
    return NextResponse.json({ error: "Failed to list threads", detail: errorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/threads { target, text, author? } — append to the target's reusable conversation
 * (200). Only an explicitly closed latest conversation causes a fresh thread (201).
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const target = normalizeTarget(record.target);
    if (!target) return NextResponse.json({ error: "Invalid comment target" }, { status: 400 });
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
    const author = typeof record.author === "string" && record.author.trim()
      ? record.author.trim()
      : "justin";

    const open = openThreadForTarget(target);
    const thread = open
      ? appendToThread(open.id, { author, text })
      : createThread(target, { author, text });

    // The library feedback route emitted feedback_left on every comment; the event survives the
    // router migration for comments arriving through the thread API.
    if (target.kind === "library") {
      try {
        appendLibraryEvents(await getVaultPath(), [{ type: "feedback_left", artifact_id: target.id }]);
      } catch (error) {
        console.warn("[threads] feedback_left event emit failed:", error);
      }
    }

    return NextResponse.json({ thread }, { status: open ? 200 : 201 });
  } catch (error) {
    console.error("[threads] post failed:", error);
    return NextResponse.json({ error: "Failed to post comment", detail: errorMessage(error) }, { status: 500 });
  }
}
