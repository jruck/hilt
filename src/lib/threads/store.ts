/**
 * Thread store — one JSON file per thread under `DATA_DIR/threads/` (app state, NEVER the
 * vault). Atomic temp+rename on every write; every read normalizes so schema drift or a
 * hand-corrupted file degrades to missing instead of crashing a list (chat-store contract:
 * reads degrade, mutations throw). Thread ids are UUIDs, validated before every path.join
 * (traversal guard, same discipline as the chat store).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { atomicWriteFile } from "../library/utils";
import type { CommentTarget, Thread, ThreadMessage, ThreadSummary } from "./types";
import { targetKey } from "./target-key";

export { targetKey } from "./target-key";

/** Same DATA_DIR resolution as the library/chat stores — live server sets DATA_DIR (~/.hilt/data). */
export function threadsDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "threads");
}

const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && THREAD_ID_RE.test(value);
}

export function isValidThreadId(id: string): boolean {
  return isUuid(id);
}

function threadPath(id: string): string {
  if (!isValidThreadId(id)) throw new Error(`invalid thread id: ${JSON.stringify(id).slice(0, 80)}`);
  return path.join(threadsDir(), `${id}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Malformed targets → null: a thread without a valid anchor is unreadable, not coercible. */
export function normalizeTarget(value: unknown): CommentTarget | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "task":
      return nonEmpty(value.id) ? { kind: "task", id: value.id } : null;
    case "loop-item":
      return nonEmpty(value.loop) && nonEmpty(value.itemId)
        ? {
            kind: "loop-item",
            loop: value.loop,
            itemId: value.itemId,
            ...(nonEmpty(value.artifactDate) ? { artifactDate: value.artifactDate } : {}),
          }
        : null;
    case "briefing":
      return nonEmpty(value.date) ? { kind: "briefing", date: value.date } : null;
    case "briefing-section":
      return nonEmpty(value.date) && nonEmpty(value.section)
        ? { kind: "briefing-section", date: value.date, section: value.section }
        : null;
    case "briefing-anchor": {
      if (!isRecord(value.anchor) || !nonEmpty(value.anchor.text)) return null;
      const anchor = {
        ...(nonEmpty(value.anchor.section) ? { section: value.anchor.section } : {}),
        ...(nonEmpty(value.anchor.citation) ? { citation: value.anchor.citation } : {}),
        text: value.anchor.text,
      };
      return { kind: "briefing-anchor", ...(nonEmpty(value.date) ? { date: value.date } : {}), anchor };
    }
    case "library":
      return nonEmpty(value.id) ? { kind: "library", id: value.id } : null;
    case "meeting":
      return nonEmpty(value.rel) ? { kind: "meeting", rel: value.rel } : null;
    default:
      return null;
  }
}

function normalizeMessage(value: unknown): ThreadMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== "string") return null;
  return {
    id: nonEmpty(value.id) ? value.id : crypto.randomUUID(),
    author: nonEmpty(value.author) ? value.author : "justin",
    text: value.text,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    ...(nonEmpty(value.edited_at) ? { edited_at: value.edited_at } : {}),
  };
}

function normalizeStamp(value: unknown): { at: string; run_at: string } | undefined {
  if (!isRecord(value) || !nonEmpty(value.at) || !nonEmpty(value.run_at)) return undefined;
  return { at: value.at, run_at: value.run_at };
}

function normalizeDevItem(value: unknown): Thread["dev_item"] | undefined {
  if (!isRecord(value) || !nonEmpty(value.diagnosed_at)) return undefined;
  return { diagnosed_at: value.diagnosed_at };
}

function normalizeResolution(value: unknown): Thread["resolution"] | undefined {
  if (!isRecord(value) || !nonEmpty(value.action) || !nonEmpty(value.at) || !nonEmpty(value.by)) return undefined;
  return {
    action: value.action,
    at: value.at,
    ...(nonEmpty(value.run_at) ? { run_at: value.run_at } : {}),
    by: value.by,
  };
}

function normalizeUuidList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (!isUuid(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids.length > 0 ? ids : undefined;
}

/**
 * Coerce bad/missing fields to defaults — never throw. Returns null (degrade to missing) only
 * when the thread is unusable: invalid target or zero recoverable messages.
 */
export function normalizeThread(value: unknown, fallbackId: string): Thread | null {
  const record = isRecord(value) ? value : {};
  const target = normalizeTarget(record.target);
  if (!target) return null;
  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeMessage).filter((m): m is ThreadMessage => m !== null)
    : [];
  if (messages.length === 0) return null;
  const createdAt = nonEmpty(record.created_at) ? record.created_at : messages[0].created_at;
  const processed = normalizeStamp(record.processed);
  const devItem = normalizeDevItem(record.dev_item);
  const resolution = normalizeResolution(record.resolution);
  const chatIds = normalizeUuidList(record.chat_ids);
  return {
    id: nonEmpty(record.id) && isValidThreadId(record.id) ? record.id : fallbackId,
    target,
    status: record.status === "resolved" || (processed && !devItem) ? "resolved" : "open",
    created_at: createdAt,
    updated_at: nonEmpty(record.updated_at) ? record.updated_at : createdAt,
    messages,
    ...(chatIds ? { chat_ids: chatIds } : {}),
    ...(devItem ? { dev_item: devItem } : {}),
    ...(processed ? { processed } : {}),
    ...(resolution ? { resolution } : {}),
    ...(nonEmpty(record.source_ref) ? { source_ref: record.source_ref } : {}),
  };
}

/** Normalize + write. Throws when the thread would not round-trip (invalid target/no messages). */
export function saveThread(thread: Thread): Thread {
  const normalized = normalizeThread(thread, thread.id);
  if (!normalized) throw new Error("thread must have a valid target and at least one message");
  atomicWriteFile(threadPath(normalized.id), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

/** Missing, invalid-id, or unparseable/unusable file → null (reads degrade to missing — loudly). */
export function readThread(id: string): Thread | null {
  if (!isValidThreadId(id)) return null;
  const filePath = threadPath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeThread(JSON.parse(fs.readFileSync(filePath, "utf-8")), id);
  } catch (err) {
    console.warn(`[threads] treating unparseable thread as missing ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** All threads, updated_at desc. Corrupt files are skipped — the list must always render. */
export function listThreads(): Thread[] {
  const dir = threadsDir();
  if (!fs.existsSync(dir)) return [];
  const threads: Thread[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const id = name.slice(0, -".json".length);
    if (!isValidThreadId(id)) continue; // leftover temp files etc.
    const thread = readThread(id);
    if (thread) threads.push(thread);
  }
  return threads.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Threads anchored to the same object (targetKey identity), oldest first. */
export function threadsForTarget(target: CommentTarget): Thread[] {
  const key = targetKey(target);
  return listThreads()
    .filter((thread) => targetKey(thread.target) === key)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * The open thread a new comment on this target APPENDS to (most recently updated wins).
 * Resolved targets return null — the next comment starts a fresh thread.
 */
export function openThreadForTarget(target: CommentTarget): Thread | null {
  const open = threadsForTarget(target).filter((thread) => thread.status === "open");
  if (open.length === 0) return null;
  return open.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export interface NewMessage {
  author: string;
  text: string;
  id?: string;
  created_at?: string;
}

function buildMessage(message: NewMessage): ThreadMessage {
  return {
    id: nonEmpty(message.id) ? message.id : crypto.randomUUID(),
    author: nonEmpty(message.author) ? message.author : "justin",
    text: message.text,
    created_at: nonEmpty(message.created_at) ? message.created_at : new Date().toISOString(),
  };
}

export function createThread(
  target: CommentTarget,
  message: NewMessage,
  opts: { source_ref?: string } = {},
): Thread {
  const first = buildMessage(message);
  return saveThread({
    id: crypto.randomUUID(),
    target,
    status: "open",
    created_at: first.created_at,
    updated_at: first.created_at,
    messages: [first],
    ...(opts.source_ref ? { source_ref: opts.source_ref } : {}),
  });
}

export function appendToThread(id: string, message: NewMessage): Thread {
  const thread = readThread(id);
  if (!thread) throw new Error(`thread not found: ${id}`);
  const next = buildMessage(message);
  thread.messages.push(next);
  thread.updated_at = next.created_at;
  return saveThread(thread);
}

export function editMessage(threadId: string, messageId: string, text: string): Thread {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  const thread = readThread(threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  const message = thread.messages.find((m) => m.id === messageId);
  if (!message) throw new Error("Message not found");
  message.text = trimmed;
  message.edited_at = new Date().toISOString();
  thread.updated_at = message.edited_at;
  return saveThread(thread);
}

/** Remove one message. Deleting the last message deletes the thread file → returns null. */
export function deleteMessage(threadId: string, messageId: string): Thread | null {
  const thread = readThread(threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  const remaining = thread.messages.filter((m) => m.id !== messageId);
  if (remaining.length === thread.messages.length) return thread;
  if (remaining.length === 0) {
    fs.rmSync(threadPath(threadId), { force: true });
    return null;
  }
  thread.messages = remaining;
  thread.updated_at = new Date().toISOString();
  return saveThread(thread);
}

export function resolveThread(
  id: string,
  resolution: { action: string; by: string; run_at?: string },
): Thread {
  const thread = readThread(id);
  if (!thread) throw new Error(`thread not found: ${id}`);
  const at = new Date().toISOString();
  thread.status = "resolved";
  thread.resolution = {
    action: resolution.action,
    at,
    ...(resolution.run_at ? { run_at: resolution.run_at } : {}),
    by: resolution.by,
  };
  thread.updated_at = at;
  return saveThread(thread);
}

/** Loop-consumption stamp. Also resolves unless this is a diagnosed dev item. */
export function markProcessed(id: string, stamp: { at: string; run_at: string }): Thread {
  const thread = readThread(id);
  if (!thread) throw new Error(`thread not found: ${id}`);
  thread.processed = stamp;
  // Dev-item threads leave the loop guidance set but stay OPEN for Justin's dev pass.
  if (!thread.dev_item) thread.status = "resolved";
  thread.updated_at = stamp.at;
  return saveThread(thread);
}

export function markDevItem(id: string, stamp: { diagnosed_at: string }): Thread {
  const thread = readThread(id);
  if (!thread) throw new Error(`thread not found: ${id}`);
  thread.dev_item = stamp;
  thread.updated_at = stamp.diagnosed_at;
  return saveThread(thread);
}

export function appendChatId(threadId: string, chatId: string): Thread {
  if (!isUuid(chatId)) throw new Error(`invalid chat id: ${JSON.stringify(chatId).slice(0, 80)}`);
  const thread = readThread(threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  const chatIds = thread.chat_ids ?? [];
  thread.chat_ids = chatIds.includes(chatId) ? chatIds : [...chatIds, chatId];
  thread.updated_at = new Date().toISOString();
  return saveThread(thread);
}

export function toThreadSummary(thread: Thread): ThreadSummary {
  const last = thread.messages[thread.messages.length - 1];
  const snippet = last ? last.text.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return {
    id: thread.id,
    target: thread.target,
    status: thread.status,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    message_count: thread.messages.length,
    last_message_snippet: snippet || null,
    ...(thread.chat_ids ? { chat_ids: thread.chat_ids } : {}),
    ...(thread.dev_item ? { dev_item: thread.dev_item } : {}),
    ...(thread.processed ? { processed: thread.processed } : {}),
    ...(thread.resolution ? { resolution: thread.resolution } : {}),
    ...(thread.source_ref ? { source_ref: thread.source_ref } : {}),
  };
}
