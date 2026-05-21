import { createReadStream, existsSync } from "fs";
import { basename } from "path";
import { createInterface } from "readline";
import { getIndexedSessionById, getMapDb } from "./local-index-db";
import type {
  LocalSession,
  LocalSessionDetail,
  LocalSessionHistoryEntry,
  LocalSessionHistoryKind,
  LocalSessionHistoryRole,
} from "./local-types";

const DEFAULT_MAX_ENTRIES = 120;
const MAX_ENTRIES = 240;
const MAX_TEXT_LENGTH = 4000;

export type JsonlRow = { row: Record<string, unknown>; lineNo: number };

function toMs(value: unknown): number | undefined {
  if (typeof value === "number") return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function truncateText(text: string): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_TEXT_LENGTH) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, MAX_TEXT_LENGTH).trimEnd()}\n...[truncated]`, truncated: true };
}

function compactJson(value: unknown): string | undefined {
  try {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return undefined;
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function textFromCodexContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;

  const parts = value
    .map((part) => {
      const item = asObject(part);
      if (!item) return typeof part === "string" ? part : undefined;
      if (typeof item.text === "string") return item.text;
      if (typeof item.output_text === "string") return item.output_text;
      if (typeof item.input_text === "string") return item.input_text;
      return undefined;
    })
    .filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function textFromClaudeContent(value: unknown): { text?: string; toolEntries: Array<{ kind: LocalSessionHistoryKind; label: string; text: string }> } {
  if (typeof value === "string") return { text: value, toolEntries: [] };
  if (!Array.isArray(value)) return { toolEntries: [] };

  const messageParts: string[] = [];
  const toolEntries: Array<{ kind: LocalSessionHistoryKind; label: string; text: string }> = [];

  for (const part of value) {
    const item = asObject(part);
    if (!item) continue;
    if (item.type === "text" && typeof item.text === "string") {
      messageParts.push(item.text);
    } else if (item.type === "tool_use") {
      const name = typeof item.name === "string" ? item.name : "tool";
      const input = compactJson(item.input);
      toolEntries.push({
        kind: "tool-call",
        label: name,
        text: input ? `${name} ${input}` : name,
      });
    } else if (item.type === "tool_result") {
      const content = compactJson(item.content);
      if (content) {
        toolEntries.push({
          kind: "tool-result",
          label: "tool result",
          text: content,
        });
      }
    }
  }

  return {
    text: messageParts.length > 0 ? messageParts.join("\n\n") : undefined,
    toolEntries,
  };
}

function makeEntry(input: {
  role: LocalSessionHistoryRole;
  kind: LocalSessionHistoryKind;
  text: string;
  timestamp?: number;
  label?: string;
  sourceLine?: number;
}): LocalSessionHistoryEntry | undefined {
  const { text, truncated } = truncateText(input.text);
  if (!text) return undefined;
  return {
    id: `${input.sourceLine ?? "entry"}:${input.role}:${input.kind}:${input.label ?? ""}`,
    ...input,
    text,
    truncated,
  };
}

function pushUnique(entries: LocalSessionHistoryEntry[], seen: Set<string>, entry: LocalSessionHistoryEntry | undefined) {
  if (!entry) return;
  const key = `${entry.timestamp ?? ""}:${entry.role}:${entry.kind}:${entry.text.slice(0, 300)}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push(entry);
}

function capEntries(entries: LocalSessionHistoryEntry[], maxEntries: number): LocalSessionHistoryEntry[] {
  if (entries.length <= maxEntries) return entries;

  const headCount = Math.min(8, Math.max(2, Math.floor(maxEntries / 5)));
  const tailCount = Math.max(1, maxEntries - headCount - 1);
  const omitted = entries.length - headCount - tailCount;
  return [
    ...entries.slice(0, headCount),
    {
      id: "omitted-history",
      role: "event",
      kind: "event",
      text: `${omitted} earlier history entries omitted from this preview.`,
      label: "preview limit",
    },
    ...entries.slice(entries.length - tailCount),
  ];
}

async function parseJsonl(path: string, onRow: (row: Record<string, unknown>, lineNo: number) => void) {
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const line of reader) {
    lineNo += 1;
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      onRow(row, lineNo);
    } catch {
      // Ignore malformed JSONL rows; the source stores are append-only logs.
    }
  }
}

export function extractCodexHistoryEntries(rows: JsonlRow[]): LocalSessionHistoryEntry[] {
  const entries: LocalSessionHistoryEntry[] = [];
  const seen = new Set<string>();

  for (const { row, lineNo } of rows) {
    const timestamp = toMs(row.timestamp);
    const payload = asObject(row.payload);
    if (!payload) continue;

    if (row.type === "event_msg" && payload.type === "user_message") {
      const text = typeof payload.message === "string"
        ? payload.message
          : typeof payload.text === "string"
            ? payload.text
            : textFromCodexContent(payload.text_elements);
      pushUnique(entries, seen, makeEntry({ role: "user", kind: "message", text: text ?? "", timestamp, sourceLine: lineNo }));
      continue;
    }

    if (row.type === "event_msg" && payload.type === "agent_message") {
      pushUnique(entries, seen, makeEntry({ role: "assistant", kind: "message", text: typeof payload.message === "string" ? payload.message : "", timestamp, sourceLine: lineNo }));
      continue;
    }

    if (row.type !== "response_item") continue;

    if (payload.type === "message") {
      const role = payload.role === "user" || payload.role === "assistant" ? payload.role : undefined;
      const text = textFromCodexContent(payload.content);
      if (role && text) {
        pushUnique(entries, seen, makeEntry({ role, kind: "message", text, timestamp, sourceLine: lineNo }));
      }
    } else if (payload.type === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const args = compactJson(payload.arguments);
      pushUnique(entries, seen, makeEntry({
        role: "tool",
        kind: "tool-call",
        label: name,
        text: args ? `${name} ${args}` : name,
        timestamp,
        sourceLine: lineNo,
      }));
    } else if (payload.type === "function_call_output") {
      const output = compactJson(payload.output);
      pushUnique(entries, seen, makeEntry({
        role: "tool",
        kind: "tool-result",
        label: "tool output",
        text: output ?? "",
        timestamp,
        sourceLine: lineNo,
      }));
    }
  }

  return entries;
}

async function readCodexHistory(path: string): Promise<LocalSessionHistoryEntry[]> {
  const rows: JsonlRow[] = [];
  await parseJsonl(path, (row, lineNo) => rows.push({ row, lineNo }));
  return extractCodexHistoryEntries(rows);
}

export function extractClaudeProjectHistoryEntries(rows: JsonlRow[]): LocalSessionHistoryEntry[] {
  const entries: LocalSessionHistoryEntry[] = [];
  const seen = new Set<string>();

  for (const { row, lineNo } of rows) {
    const timestamp = toMs(row.timestamp);

    if (row.type === "user" || row.type === "assistant") {
      const message = asObject(row.message);
      const role = message?.role === "assistant" ? "assistant" : "user";
      const { text, toolEntries } = textFromClaudeContent(message?.content);
      pushUnique(entries, seen, makeEntry({ role, kind: "message", text: text ?? "", timestamp, sourceLine: lineNo }));
      for (const toolEntry of toolEntries) {
        pushUnique(entries, seen, makeEntry({
          role: "tool",
          kind: toolEntry.kind,
          label: toolEntry.label,
          text: toolEntry.text,
          timestamp,
          sourceLine: lineNo,
        }));
      }
      continue;
    }

    if (row.type === "ai-title" || row.type === "custom-title") {
      const title = typeof row.aiTitle === "string"
        ? row.aiTitle
        : typeof row.title === "string"
          ? row.title
          : typeof row.customTitle === "string"
            ? row.customTitle
            : undefined;
      pushUnique(entries, seen, makeEntry({ role: "event", kind: "event", label: "title", text: title ?? "", timestamp, sourceLine: lineNo }));
    }
  }

  return entries;
}

async function readClaudeProjectHistory(path: string): Promise<LocalSessionHistoryEntry[]> {
  const rows: JsonlRow[] = [];
  await parseJsonl(path, (row, lineNo) => rows.push({ row, lineNo }));
  return extractClaudeProjectHistoryEntries(rows);
}

function emptyDetail(session: LocalSession, message: string, maxEntries: number): LocalSessionDetail {
  return {
    session: publicDetailSession(session),
    canReadHistory: false,
    message,
    entries: [],
    stats: {
      entriesRead: 0,
      entriesReturned: 0,
      omittedEntries: 0,
      maxEntries,
      truncatedEntries: 0,
    },
  };
}

function publicDetailSession(session: LocalSession): LocalSession {
  return {
    ...session,
    sourcePath: undefined,
  };
}

export async function readLocalSessionDetail(sessionId: string, maxEntries = DEFAULT_MAX_ENTRIES): Promise<LocalSessionDetail | undefined> {
  const boundedMaxEntries = Math.min(Math.max(maxEntries, 20), MAX_ENTRIES);
  const session = getIndexedSessionById(getMapDb(), sessionId);
  if (!session) return undefined;

  if (!session.sourcePath) {
    return emptyDetail(session, "This session has metadata only; no source history path was discovered.", boundedMaxEntries);
  }

  if (!existsSync(session.sourcePath)) {
    return emptyDetail(session, "The source history file is missing.", boundedMaxEntries);
  }

  const filename = basename(session.sourcePath);
  let entries: LocalSessionHistoryEntry[];
  if (session.provider === "codex" && filename.endsWith(".jsonl")) {
    entries = await readCodexHistory(session.sourcePath);
  } else if (session.provider === "claude" && session.harness === "project-jsonl" && filename.endsWith(".jsonl")) {
    entries = await readClaudeProjectHistory(session.sourcePath);
  } else {
    return emptyDetail(session, "This source exposes metadata, but not a readable chat history file yet.", boundedMaxEntries);
  }

  const cappedEntries = capEntries(entries, boundedMaxEntries);
  return {
    session: publicDetailSession(session),
    sourcePath: undefined,
    canReadHistory: true,
    message: entries.length === 0 ? "No readable message history was found in this source file." : undefined,
    entries: cappedEntries,
    stats: {
      entriesRead: entries.length,
      entriesReturned: cappedEntries.length,
      omittedEntries: Math.max(0, entries.length - cappedEntries.length),
      maxEntries: boundedMaxEntries,
      truncatedEntries: cappedEntries.filter((entry) => entry.truncated).length,
    },
  };
}
