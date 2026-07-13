import { NextRequest, NextResponse } from "next/server";
import { processThread } from "@/lib/threads/processor";
import { isValidThreadId, pendingThreadMessages, readThread } from "@/lib/threads/store";
import type { ChatStreamEvent } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ThreadProcessEmit = (event: ChatStreamEvent) => void;

/**
 * POST /api/threads/[id]/process runs one pending volley and streams the same
 * session/trace/message/complete/error NDJSON shapes as POST /api/chat/message. The turn reuses
 * the thread's attached chat session and success does not close the conversation.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidThreadId(id)) {
    return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  }

  const thread = readThread(id);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (thread.status === "resolved") {
    return NextResponse.json({ error: "Conversation is closed" }, { status: 409 });
  }
  if (pendingThreadMessages(thread).length === 0) {
    return NextResponse.json({ error: "No pending comments to process" }, { status: 409 });
  }

  return createThreadProcessStream(async (emit) => {
    const result = await processThread(id, { emit, signal: request.signal });
    if (!result.ok && (result.error === "not-found" || result.error === "already-resolved" || result.error === "nothing-pending")) {
      emit({ type: "error", error: result.error });
    }
  });
}

/** NDJSON ReadableStream response. Emits are no-ops once the client disconnects. */
function createThreadProcessStream(work: (emit: ThreadProcessEmit) => Promise<void>): NextResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const emit: ThreadProcessEmit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      void work(emit)
        .catch((error) => {
          emit({ type: "error", error: error instanceof Error ? error.message : "Thread processing failed." });
        })
        .finally(() => {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by client abort
          }
        });
    },
  });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
