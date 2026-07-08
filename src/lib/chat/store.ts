/**
 * Chat session store — one JSON file per chat under `DATA_DIR/chat-sessions/` (app state,
 * NEVER the vault). Atomic temp+rename on every write; every read normalizes fields so
 * schema drift or a hand-corrupted file degrades instead of crashing the list (Loft
 * agentSessionStore techniques). Contract mirrors the tasks store: reads degrade to
 * missing, mutations throw.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { atomicWriteFile } from "../library/utils";
import type {
  ChatContextRef,
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  ChatTraceEvent,
} from "./types";

/** Same DATA_DIR resolution as the library stores — live server sets DATA_DIR (~/.hilt/data). */
export function chatSessionsDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "chat-sessions");
}

// Ids are minted as UUIDs but arrive back via URL params — validate before any path.join
// (path-traversal guard, same discipline as isValidTaskId).
const CHAT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidChatId(id: string): boolean {
  return typeof id === "string" && CHAT_ID_RE.test(id);
}

function chatPath(id: string): string {
  if (!isValidChatId(id)) throw new Error(`invalid chat id: ${JSON.stringify(id).slice(0, 80)}`);
  return path.join(chatSessionsDir(), `${id}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Any malformed ref collapses to `{kind:"none"}` — a chat must stay openable regardless. */
export function normalizeContext(value: unknown): ChatContextRef {
  if (!isRecord(value)) return { kind: "none" };
  switch (value.kind) {
    case "library":
      return typeof value.id === "string" && value.id ? { kind: "library", id: value.id } : { kind: "none" };
    case "doc":
      return typeof value.path === "string" && value.path ? { kind: "doc", path: value.path } : { kind: "none" };
    case "person":
      return typeof value.slug === "string" && value.slug ? { kind: "person", slug: value.slug } : { kind: "none" };
    case "task":
      return typeof value.id === "string" && value.id ? { kind: "task", id: value.id } : { kind: "none" };
    case "meeting":
      return typeof value.path === "string" && value.path ? { kind: "meeting", path: value.path } : { kind: "none" };
    case "loop-item":
      return typeof value.loop === "string" && value.loop && typeof value.itemId === "string" && value.itemId
        ? { kind: "loop-item", loop: value.loop, itemId: value.itemId }
        : { kind: "none" };
    case "briefing-line":
      return typeof value.date === "string" && value.date && typeof value.anchor === "string" && value.anchor
        ? { kind: "briefing-line", date: value.date, anchor: value.anchor }
        : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

function normalizeTrace(value: unknown): ChatTraceEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.label !== "string") return null;
  const type = value.type === "step" || value.type === "tool_call" || value.type === "tool_result" || value.type === "warning"
    ? value.type
    : "step";
  const status = value.status === "running" || value.status === "complete" || value.status === "warning" || value.status === "error"
    ? value.status
    : "complete";
  return {
    id: typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
    type,
    status,
    label: value.label,
    detail: typeof value.detail === "string" ? value.detail : null,
    toolName: typeof value.toolName === "string" ? value.toolName : null,
    input: isRecord(value.input) ? value.input : null,
    outputSummary: typeof value.outputSummary === "string" ? value.outputSummary : null,
    timestamp: typeof value.timestamp === "number" && Number.isFinite(value.timestamp) ? value.timestamp : 0,
    durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : null,
  };
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (value.role !== "user" && value.role !== "assistant") return null;
  const message: ChatMessage = {
    id: typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
    role: value.role,
    content: typeof value.content === "string" ? value.content : "",
    timestamp: typeof value.timestamp === "number" && Number.isFinite(value.timestamp) ? value.timestamp : 0,
  };
  if (Array.isArray(value.trace)) {
    const trace = value.trace.map(normalizeTrace).filter((t): t is ChatTraceEvent => t !== null);
    if (trace.length > 0) message.trace = trace;
  }
  if (Array.isArray(value.filesTouched)) {
    const files = value.filesTouched.filter((f): f is string => typeof f === "string" && f.length > 0);
    if (files.length > 0) message.filesTouched = files;
  }
  return message;
}

/** Coerce bad/missing fields to defaults — never throw on old or hand-edited files. */
export function normalizeChatSession(value: unknown, fallbackId: string): ChatSession {
  const record = isRecord(value) ? value : {};
  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : 0;
  return {
    id: typeof record.id === "string" && isValidChatId(record.id) ? record.id : fallbackId,
    context: normalizeContext(record.context),
    contextLabel: typeof record.contextLabel === "string" ? record.contextLabel : "",
    title: typeof record.title === "string" && record.title.trim() ? record.title : "New chat",
    claudeSessionId: typeof record.claudeSessionId === "string" && record.claudeSessionId ? record.claudeSessionId : null,
    messages: Array.isArray(record.messages)
      ? record.messages.map(normalizeMessage).filter((m): m is ChatMessage => m !== null)
      : [],
    status: record.status === "sending" ? "sending" : "idle",
    archivedAt: typeof record.archivedAt === "number" && Number.isFinite(record.archivedAt) ? record.archivedAt : null,
    unreadCount: typeof record.unreadCount === "number" && Number.isFinite(record.unreadCount)
      ? Math.max(0, Math.floor(record.unreadCount))
      : 0,
    createdAt,
    updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt,
  };
}

function writeChat(session: ChatSession): void {
  atomicWriteFile(chatPath(session.id), `${JSON.stringify(session, null, 2)}\n`);
}

export function createChat(context: ChatContextRef, contextLabel: string): ChatSession {
  const now = Date.now();
  const session: ChatSession = {
    id: crypto.randomUUID(),
    context: normalizeContext(context),
    contextLabel,
    title: "New chat",
    claudeSessionId: null,
    messages: [],
    status: "idle",
    archivedAt: null,
    unreadCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  writeChat(session);
  return session;
}

/** Missing, invalid-id, or unparseable file → null (reads degrade to missing — but loudly). */
export function readChat(id: string): ChatSession | null {
  if (!isValidChatId(id)) return null;
  const filePath = chatPath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeChatSession(JSON.parse(fs.readFileSync(filePath, "utf-8")), id);
  } catch (err) {
    console.warn(`[chat] treating unparseable session as missing ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** All sessions, updatedAt desc. Corrupt files are skipped — the list must always render. */
export function listChats(): ChatSession[] {
  const dir = chatSessionsDir();
  if (!fs.existsSync(dir)) return [];
  const sessions: ChatSession[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const id = name.slice(0, -".json".length);
    if (!isValidChatId(id)) continue; // leftover temp files etc.
    const session = readChat(id);
    if (session) sessions.push(session);
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function appendMessage(id: string, message: ChatMessage): ChatSession {
  const session = readChat(id);
  if (!session) throw new Error(`chat not found: ${id}`);
  session.messages.push(message);
  session.updatedAt = Date.now();
  writeChat(session);
  return session;
}

/** Identity, birth, and transcript are not patchable — messages only grow via appendMessage. */
export type ChatPatch = Partial<Omit<ChatSession, "id" | "createdAt" | "messages">>;

export function updateChat(id: string, patch: ChatPatch): ChatSession {
  const session = readChat(id);
  if (!session) throw new Error(`chat not found: ${id}`);
  // Re-normalize post-merge so a sloppy patch can't violate store invariants on disk.
  const updated = normalizeChatSession(
    { ...session, ...patch, id: session.id, createdAt: session.createdAt, messages: session.messages },
    session.id,
  );
  updated.updatedAt = Date.now();
  writeChat(updated);
  return updated;
}

export function toChatSummary(session: ChatSession): ChatSessionSummary {
  const last = session.messages[session.messages.length - 1];
  const snippet = last ? last.content.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return {
    id: session.id,
    context: session.context,
    contextLabel: session.contextLabel,
    title: session.title,
    status: session.status,
    archivedAt: session.archivedAt,
    unreadCount: session.unreadCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessageSnippet: snippet || null,
  };
}
