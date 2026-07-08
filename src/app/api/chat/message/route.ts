/**
 * POST /api/chat/message — one user turn: spawn `claude -p` (resuming via the stored CLI
 * session id), stream NDJSON events (session → trace/message → complete|error), and persist
 * server-side AS THE RUN PROGRESSES (plan decision 4: the server writes the transcript; the
 * client only renders — a panel close mid-stream loses nothing).
 *
 * Body: { chatId?: string; context?: ChatContextRef; prompt: string }
 * - chatId absent → first turn: buildFirstTurnPrompt(context) + createChat; the CLI prompt
 *   is context block + user prompt, but the STORED user message is the prompt alone.
 * - Abort (client stop) → child SIGTERM; partial transcript persisted; NO error event.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { getVaultPath } from "@/lib/bridge/vault";
import { buildFirstTurnPrompt } from "@/lib/chat/context";
import { runClaude, type ChatToolCall } from "@/lib/chat/run-claude";
import {
  appendMessage,
  createChat,
  isValidChatId,
  normalizeContext,
  readChat,
  updateChat,
} from "@/lib/chat/store";
import { deterministicTitle } from "@/lib/chat/types";
import type { ChatSession, ChatStreamEvent, ChatTraceEvent } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatEmit = (event: ChatStreamEvent) => void;

function traceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeTraceEvent(args: {
  id?: string;
  type: ChatTraceEvent["type"];
  status: ChatTraceEvent["status"];
  label: string;
  detail?: string | null;
  toolName?: string | null;
  input?: Record<string, unknown> | null;
  outputSummary?: string | null;
}): ChatTraceEvent {
  return {
    id: args.id ?? traceId(args.type),
    type: args.type,
    status: args.status,
    label: args.label,
    detail: args.detail ?? null,
    toolName: args.toolName ?? null,
    input: args.input ?? null,
    outputSummary: args.outputSummary ?? null,
    timestamp: Date.now(),
    durationMs: null,
  };
}

/**
 * NDJSON ReadableStream response (Loft createAIEditStream). Emits are no-ops once the
 * client disconnects — persistence continues server-side regardless.
 */
function createChatStream(work: (emit: ChatEmit) => Promise<void>): NextResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const emit: ChatEmit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true; // client aborted mid-stream
        }
      };
      void work(emit)
        .catch((error) => {
          emit({ type: "error", error: error instanceof Error ? error.message : "Chat turn failed." });
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

/** Edit/Write paths become vault-relative for filesTouched; outside-vault stays absolute. */
function toVaultRelative(filePath: string, vaultRoot: string): string {
  const root = path.resolve(vaultRoot);
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  if (resolved.startsWith(root + path.sep)) {
    return resolved.slice(root.length + 1).split(path.sep).join("/");
  }
  return resolved;
}

const FILE_TOUCHING_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt must be a non-empty string" }, { status: 400 });
  }

  let session: ChatSession;
  let cliPrompt = prompt;
  try {
    if (typeof record.chatId === "string" && record.chatId) {
      if (!isValidChatId(record.chatId)) {
        return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
      }
      const existing = readChat(record.chatId);
      if (!existing) {
        return NextResponse.json({ error: "Chat not found" }, { status: 404 });
      }
      session = existing;
    } else {
      const context = normalizeContext(record.context);
      const built = await buildFirstTurnPrompt(context);
      session = createChat(context, built.contextLabel);
      cliPrompt = `${built.prompt}\n\n${prompt}`;
    }
  } catch (error) {
    console.error("[chat] failed to prepare turn:", error);
    return NextResponse.json({ error: "Failed to prepare chat turn" }, { status: 500 });
  }

  const chatId = session.id;
  const resumeId = session.claudeSessionId;
  const isFirstTurn = session.messages.length === 0;
  const vaultRoot = await getVaultPath();

  return createChatStream(async (emit) => {
    emit({ type: "session", chatId });

    appendMessage(chatId, {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt, // context block never enters the transcript
      timestamp: Date.now(),
    });
    updateChat(chatId, {
      status: "sending",
      ...(isFirstTurn ? { title: deterministicTitle(prompt) } : {}),
    });

    const traces: ChatTraceEvent[] = [];
    const filesTouched: string[] = [];
    const seenFiles = new Set<string>();

    const onToolUse = (toolCall: ChatToolCall) => {
      const trace = makeTraceEvent({
        id: toolCall.id ? `claude-tool-${toolCall.id}` : undefined,
        type: "tool_call",
        status: "complete",
        label: `Used ${toolCall.name}`,
        toolName: toolCall.name,
        input: toolCall.input,
      });
      traces.push(trace);
      emit({ type: "trace", trace });
      if (toolCall.filePath && FILE_TOUCHING_TOOLS.has(toolCall.name)) {
        const rel = toVaultRelative(toolCall.filePath, vaultRoot);
        if (!seenFiles.has(rel)) {
          seenFiles.add(rel);
          filesTouched.push(rel);
        }
      }
    };
    const onText = (text: string) => emit({ type: "message", content: text });

    let result = await runClaude({
      claudeSessionId: resumeId,
      prompt: cliPrompt,
      cwd: vaultRoot,
      signal: request.signal,
      onText,
      onToolUse,
    });

    // Retry-without-resume: the CLI's own session file can be pruned/expired — a dead
    // resume exits non-zero with no text. One fresh run, flagged with a warning trace.
    if (result.code !== 0 && !result.collectedText && resumeId && !request.signal.aborted) {
      const warning = makeTraceEvent({
        type: "warning",
        status: "warning",
        label: "Claude session resume failed — started fresh",
        detail: "Retrying without the previous session id.",
      });
      traces.push(warning);
      emit({ type: "trace", trace: warning });
      result = await runClaude({
        claudeSessionId: null,
        prompt: cliPrompt,
        cwd: vaultRoot,
        signal: request.signal,
        onText,
        onToolUse,
      });
    }

    const aborted = request.signal.aborted;
    const failed = result.code !== 0 && !result.collectedText;

    // Empty-output success still yields a visible assistant message, never a blank bubble.
    let content = result.collectedText;
    if (!aborted && !failed && !content) content = "Claude returned no text.";

    if (content || traces.length > 0) {
      appendMessage(chatId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        timestamp: Date.now(),
        ...(traces.length > 0 ? { trace: traces } : {}),
        ...(filesTouched.length > 0 ? { filesTouched } : {}),
      });
    }

    const claudeSessionId = result.claudeSessionId ?? resumeId;
    const current = readChat(chatId);
    updateChat(chatId, {
      status: "idle",
      claudeSessionId,
      // Unread bumps on turn completion; the open panel PATCHes it back to 0. A user-
      // initiated stop is not a completion.
      ...(aborted ? {} : { unreadCount: (current?.unreadCount ?? 0) + 1 }),
    });

    if (aborted) return; // partial transcript persisted; no error event on user stop
    if (failed) {
      const tail = result.stderr.trim().slice(-500);
      emit({ type: "error", error: tail || `Claude exited with code ${result.code}` });
      return;
    }
    emit({ type: "complete", claudeSessionId });
  });
}

