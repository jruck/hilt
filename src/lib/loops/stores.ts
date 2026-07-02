/**
 * Response stores — feedback records, verdict records, and the briefing's surfacing state
 * (scope §6). Simple file-backed stores under a loop's home:
 *
 *   <home>/feedback/records.jsonl   — append-only, one FeedbackRecord per line
 *   <home>/verdicts/records.jsonl   — append-only, one VerdictRecord per line
 *   <home>/state/surfacing.json     — SurfacingState (briefing loop only)
 *
 * Append-only + stamp-in-place-by-rewrite is fine at this scale (tens of records/week). All
 * readers tolerate a missing file (empty store). Writes are atomic (temp + rename).
 */
import fs from "fs";
import path from "path";
import { atomicWriteFile } from "../library/utils";
import { LoopContractError } from "./artifacts";
import type { FeedbackRecord, SurfacingState, VerdictRecord } from "./types";

function feedbackPath(home: string): string {
  return path.join(home, "feedback", "records.jsonl");
}

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

/** Append a feedback record to <home>/feedback/records.jsonl (mkdir -p as needed). */
export function appendFeedback(home: string, record: FeedbackRecord): void {
  appendJsonl(feedbackPath(home), record);
}

/** All feedback records, oldest first. Missing file → []. Malformed lines throw (fail-loud). */
export function readFeedback(home: string): FeedbackRecord[] {
  return readJsonl<FeedbackRecord>(feedbackPath(home), "feedback");
}

/** Feedback not yet consumed by a health pass (no `processed` stamp). */
export function readUnprocessedFeedback(home: string): FeedbackRecord[] {
  return readFeedback(home).filter((record) => !record.processed);
}

/** Stamp the given feedback ids as processed (rewrites the file atomically). Unknown ids ignored. */
export function markFeedbackProcessed(home: string, ids: string[], stamp: { at: string; run_at: string }): void {
  const idSet = new Set(ids);
  let changed = false;
  const records = readFeedback(home).map((record) => {
    if (!idSet.has(record.id)) return record;
    changed = true;
    return { ...record, processed: stamp };
  });
  if (changed) writeJsonl(feedbackPath(home), records);
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
