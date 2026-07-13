/**
 * On-demand feedback-thread processor contract:
 * - one Claude CLI turn per invocation over only the pending human messages;
 * - turns reuse one normal chat session, including trace and file-touch metadata;
 * - failed turns leave the pending messages unhandled so they can be retried;
 * - a final-line PROPOSAL marker mints a proposal task with origin.thread;
 * - every success records an outcome but leaves the conversation open.
 */
import crypto from "crypto";
import path from "path";
import { getVaultPath } from "../bridge/vault";
import { buildFirstTurnPrompt } from "../chat/context";
import { runClaude, type ChatToolCall, type RunClaudeOptions, type RunClaudeResult } from "../chat/run-claude";
import { appendMessage, createChat, readChat, updateChat } from "../chat/store";
import { deterministicTitle, type ChatContextRef, type ChatStreamEvent, type ChatTraceEvent } from "../chat/types";
import { createProposalIn, proposalsDir } from "../tasks/store";
import { commentTargetToFeedback } from "./feedback-bridge";
import {
  appendChatId,
  appendToThread,
  markDevItem,
  markMessagesHandled,
  pendingThreadMessages,
  readThread,
  recordThreadOutcome,
} from "./store";
import type { CommentTarget, Thread, ThreadMessage } from "./types";

export const PROCESSOR_INSTRUCTIONS =
  "You are the processor for this feedback thread inside Hilt. Act within your tools (Read/Edit/Write/Grep/Glob/LS — no Bash). " +
  "If the request is immediately actionable in vault files, do it with minimal surgical edits. " +
  "If the feedback is about Hilt's OWN SOFTWARE BEHAVIOR (app UI, briefing rendering, views, loops-as-code — a bug report or feature request about the product, not vault content), do NOT edit ANY files — not vault, not code. Investigate read-only: the Hilt source lives at /Users/jruck/work/engineering/me/hilt and you may Read/Grep/Glob it. Then end your reply with a final line 'DEVITEM: <one-line diagnosis>'. " +
  "If it is BIGGER than a local edit (and not a dev item), do NOT attempt it — instead end your reply with a line 'PROPOSAL: <imperative task title>'. " +
  "Never imply that vague feedback will influence future behavior unless you actually changed a file or minted a proposal; an answer-only turn is a valid outcome and must say that no further action was taken. " +
  "Always end with a concise reply to Justin.";

export type ProcessorRunner = (options: RunClaudeOptions) => Promise<RunClaudeResult>;

export interface ProcessThreadResult {
  ok: boolean;
  threadId: string;
  chatId: string | null;
  action?: "answered" | "changed" | "proposal-minted" | "dev-item";
  proposalTaskId?: string;
  reply?: string;
  error?: string;
}

const FILE_TOUCHING_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

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

/** Edit/Write paths become vault-relative for filesTouched; outside-vault stays absolute. */
function toVaultRelative(filePath: string, vaultRoot: string): string {
  const root = path.resolve(vaultRoot);
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  if (resolved.startsWith(root + path.sep)) {
    return resolved.slice(root.length + 1).split(path.sep).join("/");
  }
  return resolved;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function contextLabelForThread(thread: Thread): string {
  const message = thread.messages.find((m) => m.author === "justin" || m.author === "claude-sim") ?? thread.messages[0];
  return `Thread: ${oneLine(message?.text ?? "").slice(0, 60).trim()}`;
}

function messageLine(message: ThreadMessage): string {
  return `- [${message.author}] ${oneLine(message.text)}`;
}

function describeTarget(target: CommentTarget): string {
  switch (target.kind) {
    case "task":
      return `task ${target.id}`;
    case "library":
      return `library ${target.id}`;
    case "meeting":
      return `meeting ${target.rel}`;
    case "loop-item":
      return `loop-item ${target.loop}/${target.itemId}`;
    case "briefing":
      return `briefing ${target.date}`;
    case "briefing-section":
      return `briefing-section ${target.date} § ${target.section}`;
    case "briefing-anchor": {
      const parts = [
        "briefing-anchor",
        target.date,
        target.anchor.section ? `§ ${target.anchor.section}` : null,
        `"${target.anchor.text}"`,
      ].filter((part): part is string => Boolean(part));
      return parts.join(" ");
    }
  }
}

function failureDetail(result: RunClaudeResult): string {
  const tail = result.stderr.trim().slice(-500);
  return tail || `Claude exited with code ${result.code}`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Thread anchor -> chat context ref, where a C1 builder kind exists; others degrade to none. */
export function threadContextRef(target: CommentTarget): ChatContextRef {
  switch (target.kind) {
    case "task":
      return { kind: "task", id: target.id };
    case "library":
      return { kind: "library", id: target.id };
    case "meeting":
      return { kind: "meeting", path: target.rel };
    case "loop-item":
      return { kind: "loop-item", loop: target.loop, itemId: target.itemId };
    case "briefing-anchor":
      return target.date ? { kind: "briefing-line", date: target.date, anchor: target.anchor.text } : { kind: "none" };
    case "briefing":
    case "briefing-section":
      return { kind: "none" };
  }
}

/** Marker on the reply's last non-empty line. */
function parseFinalLineMarker(text: string, keyword: string): { value: string; stripped: string } | null {
  const lines = text.split(/\r?\n/);
  let markerIndex = lines.length - 1;
  while (markerIndex >= 0 && lines[markerIndex].trim() === "") markerIndex--;
  if (markerIndex < 0) return null;

  const prefix = `${keyword}: `;
  if (!lines[markerIndex].startsWith(prefix)) return null;
  const value = lines[markerIndex].slice(prefix.length).trim();
  if (value.length === 0) return null;
  return {
    value,
    stripped: lines.slice(0, markerIndex).join("\n").trimEnd(),
  };
}

/** PROPOSAL marker on the reply's last non-empty line. */
export function parseProposalMarker(text: string): { title: string; stripped: string } | null {
  const marker = parseFinalLineMarker(text, "PROPOSAL");
  return marker ? { title: marker.value, stripped: marker.stripped } : null;
}

/** DEVITEM marker on the reply's last non-empty line. */
export function parseDevItemMarker(text: string): { diagnosis: string; stripped: string } | null {
  const marker = parseFinalLineMarker(text, "DEVITEM");
  return marker ? { diagnosis: marker.value, stripped: marker.stripped } : null;
}

/** agent:<loop> when the target maps to a loop; otherwise the generic processor identity. */
export function deriveProcessorAuthor(target: CommentTarget): string {
  const feedback = commentTargetToFeedback(target);
  return feedback ? `agent:${feedback.loop}` : "agent:processor";
}

export async function processThread(threadId: string, opts: {
  emit?: (event: ChatStreamEvent) => void;
  runner?: ProcessorRunner;
  signal?: AbortSignal;
  vaultRoot?: string;
}): Promise<ProcessThreadResult> {
  const emit = opts.emit ?? (() => {});
  const runner = opts.runner ?? runClaude;
  const thread = readThread(threadId);
  if (!thread) return { ok: false, threadId, chatId: null, error: "not-found" };
  if (thread.status === "resolved") return { ok: false, threadId, chatId: null, error: "already-resolved" };
  const pendingMessages = pendingThreadMessages(thread);
  if (pendingMessages.length === 0) return { ok: false, threadId, chatId: null, error: "nothing-pending" };

  const vaultRoot = opts.vaultRoot ?? await getVaultPath();
  const contextRef = threadContextRef(thread.target);
  const contextLabel = contextLabelForThread(thread);
  const existingSession = [...(thread.chat_ids ?? [])]
    .reverse()
    .map((id) => readChat(id))
    .find((candidate) => candidate !== null) ?? null;
  const session = existingSession ?? createChat(contextRef, contextLabel);
  const chatId = session.id;
  emit({ type: "session", chatId });
  if (!existingSession) appendChatId(threadId, chatId);

  const lines = pendingMessages.map(messageLine);
  const userContent = pendingMessages.map((message) => message.text.trim()).join("\n\n");
  const firstTurn = session.messages.length === 0 || !session.claudeSessionId;

  appendMessage(chatId, {
    id: crypto.randomUUID(),
    role: "user",
    content: userContent,
    timestamp: Date.now(),
  });
  updateChat(chatId, {
    ...(session.messages.length === 0 ? { title: deterministicTitle(userContent) } : {}),
    status: "sending",
    archivedAt: null,
  });

  const preamble = [
    "You are processing a feedback thread Justin left inside Hilt.",
    `Thread target: ${describeTarget(thread.target)}`,
    "Thread messages:",
    ...lines,
  ].join("\n");
  const prompt = firstTurn
    ? [(await buildFirstTurnPrompt(contextRef)).prompt, "", preamble, "", PROCESSOR_INSTRUCTIONS].join("\n")
    : [preamble, "", PROCESSOR_INSTRUCTIONS].join("\n");

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
  const onText = (content: string) => emit({ type: "message", content });

  let result: RunClaudeResult;
  try {
    result = await runner({
      claudeSessionId: firstTurn ? null : session.claudeSessionId,
      prompt,
      cwd: vaultRoot,
      signal: opts.signal,
      onText,
      onToolUse,
    });
  } catch (error) {
    const detail = errorDetail(error).slice(-500);
    if (traces.length > 0) {
      appendMessage(chatId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        trace: traces,
        ...(filesTouched.length > 0 ? { filesTouched } : {}),
      });
    }
    updateChat(chatId, { status: "idle" });
    emit({ type: "error", error: detail });
    return { ok: false, threadId, chatId, error: detail };
  }

  // A cancelled run (drawer close/stop, batch Cancel, client disconnect) SIGTERMs the child,
  // which resolves with a non-zero/null code but may have already collected partial text. Never
  // let that partial text ride the success path — it would mark the volley handled with a
  // truncated reply. Leave the thread untouched (retryable) and close out the chat session.
  if (opts.signal?.aborted) {
    if (traces.length > 0 || result.collectedText) {
      appendMessage(chatId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.collectedText,
        timestamp: Date.now(),
        ...(traces.length > 0 ? { trace: traces } : {}),
        ...(filesTouched.length > 0 ? { filesTouched } : {}),
      });
    }
    updateChat(chatId, { status: "idle" });
    emit({ type: "error", error: "cancelled" });
    return { ok: false, threadId, chatId, error: "cancelled" };
  }

  if (result.code !== 0 && !result.collectedText) {
    const detail = failureDetail(result);
    if (traces.length > 0) {
      appendMessage(chatId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        trace: traces,
        ...(filesTouched.length > 0 ? { filesTouched } : {}),
      });
    }
    updateChat(chatId, { status: "idle" });
    emit({ type: "error", error: detail });
    return { ok: false, threadId, chatId, error: detail };
  }

  let reply = result.collectedText || "Claude returned no text.";
  let action: ProcessThreadResult["action"] = filesTouched.length > 0 ? "changed" : "answered";
  let proposalTaskId: string | undefined;
  const devItemMarker = parseDevItemMarker(reply);

  if (devItemMarker) {
    reply = devItemMarker.stripped
      ? `${devItemMarker.stripped}\n\nDiagnosis: ${devItemMarker.diagnosis}`
      : `Diagnosis: ${devItemMarker.diagnosis}`;
    action = "dev-item";
    const trace = makeTraceEvent({
      type: "step",
      status: "complete",
      label: "Dev item diagnosed",
      detail: devItemMarker.diagnosis,
    });
    traces.push(trace);
    emit({ type: "trace", trace });

    appendMessage(chatId, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: reply,
      timestamp: Date.now(),
      ...(traces.length > 0 ? { trace: traces } : {}),
      ...(filesTouched.length > 0 ? { filesTouched } : {}),
    });
    const current = readChat(chatId);
    updateChat(chatId, {
      status: "idle",
      claudeSessionId: result.claudeSessionId,
      unreadCount: (current?.unreadCount ?? 0) + 1,
    });

    const author = deriveProcessorAuthor(thread.target);
    appendToThread(threadId, { author, text: reply });
    const diagnosedAt = new Date().toISOString();
    markDevItem(threadId, { diagnosed_at: diagnosedAt });
    const outcome = recordThreadOutcome(threadId, {
      kind: "dev-item",
      summary: devItemMarker.diagnosis,
      at: diagnosedAt,
      by: author,
      message_ids: pendingMessages.map((message) => message.id),
      chat_id: chatId,
    });
    markMessagesHandled(threadId, pendingMessages.map((message) => message.id), {
      at: diagnosedAt,
      by: author,
      outcome_id: outcome.id,
    });
    emit({ type: "complete", claudeSessionId: result.claudeSessionId });

    return { ok: true, threadId, chatId, action, reply };
  }

  const marker = parseProposalMarker(reply);

  if (marker) {
    try {
      const sourceMessage = thread.messages.find((message) => message.author === "justin") ?? thread.messages[0];
      const task = createProposalIn(
        proposalsDir(vaultRoot),
        {
          title: marker.title,
          origin: { thread: threadId },
          ...(marker.stripped ? { body: marker.stripped } : {}),
          ...(sourceMessage?.text ? {
            provenance: {
              quote: oneLine(sourceMessage.text).slice(0, 600),
              source: `thread:${threadId}`,
            },
          } : {}),
        },
        { collisionBaseDir: vaultRoot },
      );
      reply = `${marker.stripped}\n\nMinted proposal ${task.id}.`;
      action = "proposal-minted";
      proposalTaskId = task.id;
    } catch (error) {
      const trace = makeTraceEvent({
        type: "warning",
        status: "warning",
        label: "Proposal mint failed",
        detail: errorDetail(error),
      });
      traces.push(trace);
      emit({ type: "trace", trace });
    }
  }

  appendMessage(chatId, {
    id: crypto.randomUUID(),
    role: "assistant",
    content: reply,
    timestamp: Date.now(),
    ...(traces.length > 0 ? { trace: traces } : {}),
    ...(filesTouched.length > 0 ? { filesTouched } : {}),
  });
  const current = readChat(chatId);
  updateChat(chatId, {
    status: "idle",
    claudeSessionId: result.claudeSessionId,
    unreadCount: (current?.unreadCount ?? 0) + 1,
  });

  const author = deriveProcessorAuthor(thread.target);
  appendToThread(threadId, { author, text: reply });
  const completedAt = new Date().toISOString();
  const outcome = recordThreadOutcome(threadId, {
    kind: action === "proposal-minted" ? "proposal" : action,
    summary: oneLine(reply).slice(0, 240),
    at: completedAt,
    by: author,
    message_ids: pendingMessages.map((message) => message.id),
    chat_id: chatId,
    ...(filesTouched.length > 0 ? { files_touched: filesTouched } : {}),
    ...(proposalTaskId ? { proposal_task_id: proposalTaskId } : {}),
  });
  markMessagesHandled(threadId, pendingMessages.map((message) => message.id), {
    at: completedAt,
    by: author,
    outcome_id: outcome.id,
  });
  emit({ type: "complete", claudeSessionId: result.claudeSessionId });

  return { ok: true, threadId, chatId, action, ...(proposalTaskId ? { proposalTaskId } : {}), reply };
}
