/**
 * One-shot migration core (v3 unit C2): lift the two legacy comment stores into threads.
 *
 * - Loops feedback: every `<loopHome>/feedback/records.jsonl` → ONE THREAD PER RECORD.
 *   Processed records arrive resolved, carrying the processed stamp plus one agent:<loop>
 *   consumption message. Source jsonl files are LEFT IN PLACE (history).
 * - Library feedback: every `DATA_DIR/library-feedback/<vaultKey>.json` → one thread per
 *   comment against { kind: "library", id: artifactId }.
 *
 * Idempotency: `source_ref` (and live-path message ids) carry the original record/comment id;
 * a record whose id already exists in the thread store is skipped, so re-runs are no-ops.
 * Dry-run is the default — callers pass { write: true } to apply.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { FeedbackRecord } from "../loops/types";
import type { LibraryComment } from "../library/types";
import { feedbackTargetToComment } from "./feedback-bridge";
import { listThreads, saveThread } from "./store";
import type { Thread } from "./types";

export interface MigrationSourceReport {
  source: string;
  total: number;
  migrated: number;
  skipped: number;
  malformed: number;
}

/** Every id the thread store already knows: source_refs + message ids (live-path records). */
export function existingSourceIds(): Set<string> {
  const ids = new Set<string>();
  for (const thread of listThreads()) {
    if (thread.source_ref) ids.add(thread.source_ref);
    for (const message of thread.messages) ids.add(message.id);
  }
  return ids;
}

/** `<base>/meta/loops/<domain>/feedback/records.jsonl` for every domain under base. */
export function discoverFeedbackJsonl(bases: string[]): string[] {
  const files: string[] = [];
  for (const base of bases) {
    const loopsDir = path.join(base, "meta", "loops");
    if (!fs.existsSync(loopsDir)) continue;
    for (const entry of fs.readdirSync(loopsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(loopsDir, entry.name, "feedback", "records.jsonl");
      if (fs.existsSync(candidate)) files.push(candidate);
    }
  }
  return files;
}

export function discoverLibraryStores(dataDir: string): string[] {
  const dir = path.join(dataDir, "library-feedback");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .map((name) => path.join(dir, name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFeedbackLine(line: string): FeedbackRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.id !== "string" || typeof parsed.text !== "string") return null;
    if (!isRecord(parsed.target) || typeof parsed.target.loop !== "string") return null;
    return parsed as unknown as FeedbackRecord;
  } catch {
    return null;
  }
}

export function feedbackRecordToThread(record: FeedbackRecord): Thread {
  const target = feedbackTargetToComment(record.target, {
    fallbackDate: (record.created_at || "").slice(0, 10),
  });
  const thread: Thread = {
    id: crypto.randomUUID(),
    target,
    status: record.processed ? "resolved" : "open",
    created_at: record.created_at,
    updated_at: record.processed ? record.processed.at : record.created_at,
    messages: [{
      id: record.id,
      author: record.author,
      text: record.text,
      created_at: record.created_at,
    }],
    ...(record.processed ? { processed: record.processed } : {}),
    source_ref: record.id,
  };
  if (record.processed) {
    thread.messages.push({
      id: crypto.randomUUID(),
      author: `agent:${record.target.loop}`,
      text: `Consumed by the ${record.target.loop} loop run ${record.processed.run_at}`,
      created_at: record.processed.at,
    });
  }
  return thread;
}

export function migrateFeedbackJsonl(
  filePath: string,
  existing: Set<string>,
  opts: { write: boolean },
): MigrationSourceReport {
  const report: MigrationSourceReport = { source: filePath, total: 0, migrated: 0, skipped: 0, malformed: 0 };
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    report.total += 1;
    const record = parseFeedbackLine(line);
    if (!record) {
      report.malformed += 1;
      console.warn(`[threads-migrate] malformed jsonl line skipped in ${filePath}`);
      continue;
    }
    if (existing.has(record.id)) {
      report.skipped += 1;
      continue;
    }
    if (opts.write) saveThread(feedbackRecordToThread(record));
    existing.add(record.id);
    report.migrated += 1;
  }
  return report;
}

export function libraryCommentToThread(artifactId: string, comment: LibraryComment): Thread {
  const processed = comment.processed_at
    ? { at: comment.processed_at, run_at: comment.processed_at }
    : undefined;
  return {
    id: crypto.randomUUID(),
    target: { kind: "library", id: artifactId },
    status: processed ? "resolved" : "open",
    created_at: comment.created_at,
    updated_at: comment.processed_at || comment.updated_at || comment.created_at,
    messages: [{
      id: comment.id,
      author: "justin",
      text: comment.text,
      created_at: comment.created_at,
      ...(comment.updated_at ? { edited_at: comment.updated_at } : {}),
    }],
    ...(processed ? { processed } : {}),
    source_ref: comment.id,
  };
}

export function migrateLibraryFeedbackStore(
  filePath: string,
  existing: Set<string>,
  opts: { write: boolean },
): MigrationSourceReport {
  const report: MigrationSourceReport = { source: filePath, total: 0, migrated: 0, skipped: 0, malformed: 0 };
  let store: unknown;
  try {
    store = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    report.malformed += 1;
    console.warn(`[threads-migrate] unparseable library-feedback store skipped: ${filePath}`);
    return report;
  }
  if (!isRecord(store)) return report;
  for (const [artifactId, comments] of Object.entries(store)) {
    if (!Array.isArray(comments)) continue;
    for (const raw of comments) {
      report.total += 1;
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.text !== "string" || typeof raw.created_at !== "string") {
        report.malformed += 1;
        continue;
      }
      const comment = raw as unknown as LibraryComment;
      if (existing.has(comment.id)) {
        report.skipped += 1;
        continue;
      }
      if (opts.write) saveThread(libraryCommentToThread(artifactId, comment));
      existing.add(comment.id);
      report.migrated += 1;
    }
  }
  return report;
}
