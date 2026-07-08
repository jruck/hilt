import { NextRequest, NextResponse } from "next/server";
import { processThread, type ProcessThreadResult } from "@/lib/threads/processor";
import { listThreads } from "@/lib/threads/store";
import type { ChatStreamEvent } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BatchThreadStartEvent = { type: "thread-start"; threadId: string; index: number; total: number };
type BatchThreadCompleteEvent = {
  type: "thread-complete";
  threadId: string;
  ok: boolean;
  action?: ProcessThreadResult["action"];
  proposalTaskId?: string;
};
type BatchThreadResult = {
  threadId: string;
  ok: boolean;
  action?: ProcessThreadResult["action"];
  proposalTaskId?: string;
  error?: string;
};
type BatchSummaryEvent = {
  type: "summary";
  attempted: number;
  processed: number;
  minted: number;
  failed: number;
  threads: BatchThreadResult[];
};
type BatchStreamEvent = ChatStreamEvent | BatchThreadStartEvent | BatchThreadCompleteEvent | BatchSummaryEvent;
type BatchEmit = (event: BatchStreamEvent) => void;

const BATCH_LIMIT = 10;

/**
 * POST /api/threads/process-all runs the on-demand feedback-thread processor over the oldest open unreplied threads, streaming the same session/trace/message/complete/error NDJSON event shapes as POST /api/chat/message plus batch start/complete/summary events so clients can render progress; each backing Claude turn persists as a normal chat session, which is intentional.
 */
export async function POST(request: NextRequest) {
  const body = await readOptionalJson(request);
  if (body.error) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  const record = typeof body.value === "object" && body.value !== null && !Array.isArray(body.value)
    ? (body.value as Record<string, unknown>)
    : {};
  if (record.status !== undefined && record.status !== "open") {
    return NextResponse.json({ error: "status must be \"open\"" }, { status: 400 });
  }

  const candidates = listThreads()
    .filter((thread) => thread.status === "open")
    .filter((thread) => !thread.messages.some((message) => message.author.startsWith("agent:")))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, BATCH_LIMIT);

  return createBatchStream(async (emit) => {
    const total = candidates.length;
    const threads: BatchThreadResult[] = [];

    for (let i = 0; i < candidates.length; i++) {
      if (request.signal.aborted) break;

      const thread = candidates[i];
      emit({ type: "thread-start", threadId: thread.id, index: i + 1, total });
      const result = await processThread(thread.id, { emit, signal: request.signal });

      const threadResult: BatchThreadResult = {
        threadId: thread.id,
        ok: result.ok,
        ...(result.action ? { action: result.action } : {}),
        ...(result.proposalTaskId ? { proposalTaskId: result.proposalTaskId } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
      threads.push(threadResult);

      const completeEvent: BatchThreadCompleteEvent = {
        type: "thread-complete",
        threadId: thread.id,
        ok: result.ok,
        ...(result.action ? { action: result.action } : {}),
        ...(result.proposalTaskId ? { proposalTaskId: result.proposalTaskId } : {}),
      };
      emit(completeEvent);
    }

    emit({
      type: "summary",
      attempted: threads.length,
      processed: threads.filter((thread) => thread.ok).length,
      minted: threads.filter((thread) => thread.action === "proposal-minted").length,
      failed: threads.filter((thread) => !thread.ok).length,
      threads,
    });
  });
}

async function readOptionalJson(request: NextRequest): Promise<{ value: unknown; error?: undefined } | { value?: undefined; error: string }> {
  try {
    const text = await request.text();
    return { value: text.trim() ? JSON.parse(text) : {} };
  } catch {
    return { error: "Invalid JSON body" };
  }
}

/** NDJSON ReadableStream response. Emits are no-ops once the client disconnects. */
function createBatchStream(work: (emit: BatchEmit) => Promise<void>): NextResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const emit: BatchEmit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      void work(emit)
        .catch((error) => {
          emit({ type: "error", error: error instanceof Error ? error.message : "Thread batch processing failed." });
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
