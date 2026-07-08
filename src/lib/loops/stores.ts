/**
 * Response stores — feedback records, verdict records, and the briefing's surfacing state
 * (scope §6). Verdicts and surfacing state are file-backed under a loop's home:
 *
 *   <home>/verdicts/records.jsonl   — append-only, one VerdictRecord per line
 *   <home>/state/surfacing.json     — SurfacingState (briefing loop only)
 *
 * FEEDBACK is thread-backed (v3 unit C2): the four feedback functions keep their
 * FeedbackRecord signatures but adapt over the thread store (DATA_DIR/threads/ — see
 * src/lib/threads/). The old `<home>/feedback/records.jsonl` files are migration history
 * (scripts/threads-migrate.ts); nothing reads or writes them anymore. `home` still selects
 * WHICH loop's feedback is read: `<base>/meta/loops/<domain>` resolves to the domain's loop
 * ids via the registry (domain ≠ loop id — e.g. domain "briefings" ↔ loop "briefing").
 *
 * Append-only + stamp-in-place-by-rewrite is fine at this scale (tens of records/week). All
 * readers tolerate a missing file (empty store). Writes are atomic (temp + rename).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { atomicWriteFile } from "../library/utils";
import { LoopContractError } from "./artifacts";
import {
  commentTargetToFeedback,
  feedbackTargetToComment,
  threadToFeedbackRecords,
} from "../threads/feedback-bridge";
import {
  appendToThread,
  createThread,
  listThreads,
  markProcessed,
  openThreadForTarget,
} from "../threads/store";
import type { Thread } from "../threads/types";
import { parseRegistry } from "./registry";
import type { FeedbackRecord, FeedbackTarget, LoopsRegistry, SurfacingState, VerdictRecord } from "./types";

function verdictPath(home: string): string {
  return path.join(home, "verdicts", "records.jsonl");
}

function surfacingPath(home: string): string {
  return path.join(home, "state", "surfacing.json");
}

function appendJsonl(filePath: string, record: unknown): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const prefix = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
  atomicWriteFile(filePath, `${prefix}${JSON.stringify(record)}\n`);
}

function readJsonl<T>(filePath: string, storeName: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LoopContractError([`${storeName} malformed JSONL line ${index + 1}: ${message}`]);
      }
    });
}

function writeJsonl(filePath: string, records: unknown[]): void {
  const content = records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  atomicWriteFile(filePath, content);
}

/**
 * The registry that names `home`'s loop: sibling `<base>/meta/loops/registry.yml` first (vault
 * homes), then the vault by env (shadow homes — the sandbox carries no registry copy). Any
 * unreadable candidate falls through; null = no registry reachable.
 */
function registryForHome(home: string): LoopsRegistry | null {
  const vaultGuess = process.env.BRIDGE_VAULT_PATH
    || process.env.HILT_WORKING_FOLDER
    || path.join(os.homedir(), "work/bridge");
  const candidates = [
    path.join(path.dirname(home), "registry.yml"),
    path.join(vaultGuess, "meta", "loops", "registry.yml"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return parseRegistry(fs.readFileSync(candidate, "utf-8"));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Loop ids whose feedback belongs to `home` (`<base>/meta/loops/<domain>`). Registry-resolved —
 * a domain may host several loop ids; without any reachable registry the domain itself is the
 * best guess, with the one known-permanent alias pinned (domain "briefings" ↔ loop "briefing").
 */
export function loopIdsForHome(home: string): string[] {
  const domain = path.basename(home);
  const registry = registryForHome(home);
  if (registry) {
    const ids = registry.loops.filter((loop) => loop.domain === domain).map((loop) => loop.id);
    if (ids.length > 0) return ids;
  }
  return domain === "briefings" ? ["briefing"] : [domain];
}

function feedbackThreadsForHome(home: string): Array<{ thread: Thread; target: FeedbackTarget }> {
  const loopIds = new Set(loopIdsForHome(home));
  const matches: Array<{ thread: Thread; target: FeedbackTarget }> = [];
  for (const thread of listThreads()) {
    const target = commentTargetToFeedback(thread.target);
    if (target && loopIds.has(target.loop)) matches.push({ thread, target });
  }
  return matches;
}

/**
 * Append one feedback record — thread-backed: an open thread on the record's target gains the
 * comment; otherwise a fresh thread starts. The message id IS the record id, so processed
 * stamping by record id keeps working. `home` no longer places the write (the target's loop
 * id does) but stays in the signature for the route/script call sites.
 */
export function appendFeedback(home: string, record: FeedbackRecord): void {
  void home;
  const target = feedbackTargetToComment(record.target, {
    fallbackDate: (record.created_at || "").slice(0, 10),
  });
  const message = { id: record.id, author: record.author, text: record.text, created_at: record.created_at };
  const open = openThreadForTarget(target);
  const thread = open ? appendToThread(open.id, message) : createThread(target, message, { source_ref: record.id });
  if (record.processed) markProcessed(thread.id, record.processed);
}

/** All feedback records for this home's loop, oldest first — FeedbackRecord-shaped (one per
 *  human thread message; agent consumption notes are excluded). No threads → []. */
export function readFeedback(home: string): FeedbackRecord[] {
  const records: FeedbackRecord[] = [];
  for (const { thread } of feedbackThreadsForHome(home)) {
    records.push(...threadToFeedbackRecords(thread));
  }
  return records.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Feedback not yet consumed by a health pass (no `processed` stamp). */
export function readUnprocessedFeedback(home: string): FeedbackRecord[] {
  return readFeedback(home).filter((record) => !record.processed);
}

/** Stamp the threads carrying the given record ids as processed (message id = record id;
 *  source_ref covers migrated records). Unknown ids ignored. Thread-granular: every message
 *  in a stamped thread reads back processed. */
export function markFeedbackProcessed(home: string, ids: string[], stamp: { at: string; run_at: string }): void {
  const idSet = new Set(ids);
  for (const { thread } of feedbackThreadsForHome(home)) {
    if (thread.processed) continue;
    const hit = thread.messages.some((message) => idSet.has(message.id))
      || (thread.source_ref !== undefined && idSet.has(thread.source_ref));
    if (hit) markProcessed(thread.id, stamp);
  }
}

/** Append a verdict record to <home>/verdicts/records.jsonl. */
export function appendVerdict(home: string, record: VerdictRecord): void {
  appendJsonl(verdictPath(home), record);
}

/** All verdict records, oldest first. Missing file → []. */
export function readVerdicts(home: string): VerdictRecord[] {
  return readJsonl<VerdictRecord>(verdictPath(home), "verdict");
}

/** Verdicts the loop has not yet acted on (no `acted` stamp). */
export function readUnactedVerdicts(home: string): VerdictRecord[] {
  return readVerdicts(home).filter((record) => !record.acted);
}

/** Stamp verdict ids as acted (rewrites atomically). Unknown ids ignored. */
export function markVerdictsActed(home: string, ids: string[], stamp: { at: string; run_at: string }): void {
  const idSet = new Set(ids);
  let changed = false;
  const records = readVerdicts(home).map((record) => {
    if (!idSet.has(record.id)) return record;
    changed = true;
    return { ...record, acted: stamp };
  });
  if (changed) writeJsonl(verdictPath(home), records);
}

/** Read the surfacing state at <home>/state/surfacing.json. Missing file → {}. */
export function readSurfacingState(home: string): SurfacingState {
  const filePath = surfacingPath(home);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SurfacingState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LoopContractError([`surfacing state malformed JSON: ${message}`]);
  }
}

/** Write the surfacing state atomically. */
export function writeSurfacingState(home: string, state: SurfacingState): void {
  atomicWriteFile(surfacingPath(home), `${JSON.stringify(state, null, 2)}\n`);
}
