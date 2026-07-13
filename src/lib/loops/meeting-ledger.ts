/**
 * Meeting-ledger domain types and legacy JSON compatibility helpers.
 *
 * Runtime operational state lives in the per-vault MeetingLedgerStore after cutover. These pure
 * entry transforms remain shared by SQLite, migration/rollback, tests, and readable exports.
 */
import fs from "fs";
import path from "path";
import { atomicWriteFile } from "../library/utils";
import type { Citation } from "./types";

export type LedgerStatus = "open" | "carried" | "resolved" | "dropped";

export interface LedgerEntry {
  id: string;
  action: string;
  owner: string; // justin | other:<name> | unclear | agent:<name> (future)
  due?: string;
  /** 1-2 sentences of the SURROUNDING DISCUSSION from extraction (what was being talked about,
   * why the commitment arose). This remains canonical meeting-action context and is joined into
   * task detail live; it is not copied into the task's editable notes. Forward-only: entries
   * predating the field (and thin transcripts) simply lack it. */
  context?: string;
  citations: Citation[];
  /** Extraction confidence 0..1; catch-phrase captures are 0.95+. */
  confidence: number;
  source: "extractor" | "catch_phrase";
  status: LedgerStatus;
  opened_at: string; // ISO
  /** Meeting that first opened it (vault-relative). */
  opened_from: string;
  /** Verdict state (v1: everything is verdict-gated before it counts as accepted). */
  verdict?: { verdict: string; at: string; note?: string };
  /** Stamped the first time this entry escalates to the panel: once an ask has entered Justin's
   * queue it STAYS there until decided — a pending decision must not expire because a long
   * weekend pushed its meeting outside the recency window (caught 2026-07-06). */
  first_escalated_at?: string;
  /** The proposal task file minted from this entry at escalation time (v3 unit A6). The stamp IS
   * the idempotency guard: an entry with task_id NEVER re-mints — even after the file is gone
   * (dismiss deletes the file deliberately; the ledger remembers). */
  task_id?: string;
  status_history: Array<{ at: string; from: LedgerStatus | null; to: LedgerStatus; evidence?: string }>;
  /** Additional sightings (restatements) — the identity test's receipts. */
  sightings: Array<{ at: string; meeting: string; quote?: string }>;
}

export interface Ledger {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

export function ledgerPath(home: string): string {
  return path.join(home, "state", "ledger.json");
}

export function readLedger(home: string): Ledger {
  const filePath = ledgerPath(home);
  // Missing = first run, start empty. CORRUPT must fail LOUD: swallowing a parse error here
  // returned an empty ledger that the run then unconditionally persisted — one torn write
  // silently wiped every dismiss verdict, task_id idempotency stamp, and first_escalated_at
  // (adversarial finding, 2026-07-07). A crash is recoverable; a persisted wipe is not.
  if (!fs.existsSync(filePath)) return { version: 1, entries: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Ledger;
  } catch (err) {
    throw new Error(
      `ledger unreadable at ${filePath} — refusing to continue (an empty-ledger fallback would persist as a wipe): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeLedger(home: string, ledger: Ledger): void {
  atomicWriteFile(ledgerPath(home), `${JSON.stringify(ledger, null, 1)}\n`);
}

export function openEntries(ledger: Ledger): LedgerEntry[] {
  return Object.values(ledger.entries).filter((e) => e.status === "open" || e.status === "carried");
}

/** Age in whole days from opened_at to `now` (ISO). */
export function entryAgeDays(entry: LedgerEntry, nowIso: string): number {
  return Math.floor((Date.parse(nowIso) - Date.parse(entry.opened_at)) / 86_400_000);
}

export function mintEntryId(date: string, seq: number): string {
  return `ma-${date}-${String(seq).padStart(3, "0")}`;
}

export function nextSeq(ledger: Ledger, date: string): number {
  const prefix = `ma-${date}-`;
  const used = Object.keys(ledger.entries)
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isFinite);
  return (used.length ? Math.max(...used) : 0) + 1;
}

export function transition(entry: LedgerEntry, to: LedgerStatus, at: string, evidence?: string): void {
  entry.status_history.push({ at, from: entry.status, to, ...(evidence ? { evidence } : {}) });
  entry.status = to;
}

/** Reopen a deliberately dismissed entry without erasing its audit history. The original
 * task_id stays attached so the recovery path can recreate the same proposal identity. */
export function restoreDismissedEntry(entry: LedgerEntry, at: string): boolean {
  if (entry.status !== "dropped" || entry.verdict?.verdict !== "dismiss") return false;
  transition(entry, "open", at, "restored after dismissal");
  delete entry.verdict;
  return true;
}

/**
 * The compact open-ledger digest fed to the extractor for identity resolution — id, action, owner,
 * age. Kept terse: this rides in every extraction prompt.
 */
export function openLedgerDigest(ledger: Ledger, nowIso: string): string {
  const open = openEntries(ledger);
  if (!open.length) return "(ledger empty — every commitment you extract is NEW)";
  return open
    .map((e) => `${e.id} · ${e.owner} · ${digestText(e.action, 120)} · opened ${e.opened_at.slice(0, 10)} (${entryAgeDays(e, nowIso)}d)`)
    .join("\n");
}

/** How long a dismissal stays in the extractor's "recently dismissed" digest (v3 unit A7).
 * Matches the meeting backfill window: a restatement can only come from a meeting the loop
 * still parses, so 30 days of immunity covers every meeting that can re-surface the ask. */
export const DISMISSED_IMMUNITY_DAYS = 30;

/**
 * Entries dropped via a DISMISS VERDICT within the last `windowDays` (v3 unit A7:
 * dismissed-immunity). Dismissal must be durable: the extractor sees only the OPEN ledger for
 * identity resolution, so a meeting restating a dismissed commitment would otherwise mint a
 * brand-new entry — and a brand-new proposal for something Justin already declined. Closure
 * drops (extractor-evidenced "we're not doing that") are NOT included: those carry no verdict
 * and re-extraction of them is an identity question, not a decision override.
 */
export function recentlyDismissedEntries(ledger: Ledger, nowIso: string, windowDays = DISMISSED_IMMUNITY_DAYS): LedgerEntry[] {
  return Object.values(ledger.entries).filter((e) => {
    if (e.status !== "dropped" || e.verdict?.verdict !== "dismiss") return false;
    // The drop transition's timestamp is when the dismissal landed (transition() appends it).
    const dropped = [...e.status_history].reverse().find((h) => h.to === "dropped");
    if (!dropped) return false;
    return (Date.parse(nowIso) - Date.parse(dropped.at)) / 86_400_000 <= windowDays;
  });
}

/**
 * The compact recently-dismissed digest for the extractor prompt (id, owner, action) — the
 * companion to openLedgerDigest. Empty string when nothing is recently dismissed, so the
 * prompt builder can omit the section entirely.
 *
 * When the dismiss verdict carried a NOTE (any verdict can, since the gate-B comment
 * primitive), the line carries the reason — "— declined: <note>" — so the extractor learns
 * WHY, not just that it was declined (better identity resolution AND better future proposals).
 */
/** Prompt-safe truncation: flattens newlines (one line per digest entry is the format) and
 * never splits a surrogate pair (a lone surrogate in the prompt is malformed UTF-16). */
function digestText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  let cut = flat.slice(0, max);
  if (cut && !cut.isWellFormed()) cut = cut.slice(0, -1);
  return cut;
}

export function dismissedLedgerDigest(ledger: Ledger, nowIso: string): string {
  return recentlyDismissedEntries(ledger, nowIso)
    .map((e) => {
      const note = e.verdict?.note?.trim();
      const reason = note ? ` — declined: ${digestText(note, 100)}` : "";
      return `${e.id} · ${e.owner} · ${digestText(e.action, 120)}${reason}`;
    })
    .join("\n");
}

/** Cap for stored extractor context — a runaway-model guard, NOT an editorial limit (the
 * prompt's guidance is purpose-based: as much as the verdict needs, per Justin 2026-07-08).
 * Generous enough for a real paragraph or two; only pathological output ever hits it. */
export const CONTEXT_MAX_CHARS = 1500;

/** Normalize extractor-emitted `context` (the surrounding discussion the verdict needs):
 * flatten whitespace, trim, cap, surrogate-safe. Non-string/empty → null — missing or invalid
 * context is never an error; the field just stays absent. */
export function cleanExtractedContext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return digestText(raw, CONTEXT_MAX_CHARS) || null;
}

/** Fill `entry.context` from a new extraction ONLY when the entry has none — context is
 * forward-only enrichment (a later sighting's richer extraction may fill a gap), and prose
 * already on the entry is never overwritten. */
export function fillContextIfEmpty(entry: LedgerEntry, raw: unknown): void {
  if (entry.context) return;
  const context = cleanExtractedContext(raw);
  if (context) entry.context = context;
}

/** Whitespace/case-insensitive action-text normalization — the exact-match key for the
 * ledger-apply dismissed backstop (deterministic only; fuzzy matching is the extractor's job). */
export function normalizeActionText(action: string): string {
  return action.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Normalized action text → recently-dismissed entry: the belt-and-suspenders index the
 * ledger-apply pass uses to fold an extractor-emitted "new" commitment that exactly restates
 * a dismissed one into a SIGHTING instead of minting (prompt rule enforcement at apply time). */
export function recentlyDismissedByAction(ledger: Ledger, nowIso: string): Map<string, LedgerEntry> {
  const map = new Map<string, LedgerEntry>();
  for (const e of recentlyDismissedEntries(ledger, nowIso)) map.set(normalizeActionText(e.action), e);
  return map;
}

/**
 * Deterministic "Action item:" pre-scan over a transcript (interview decision: the phrase IS the
 * trigger, ANYONE saying it). Excludes tracker-artifact contexts (the CES huddle's standing
 * "action items tracker" agenda item — R-meet: 8% base rate concentrated there) and section
 * headers. Returns the surrounding spans as high-confidence candidates for the extractor.
 */
export function catchPhraseSpans(transcript: string): string[] {
  const spans: string[] = [];
  const re = /action items?\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript))) {
    const start = Math.max(0, m.index - 150);
    const end = Math.min(transcript.length, m.index + 350);
    const span = transcript.slice(start, end).replace(/\s+/g, " ").trim();
    // Exclusions: the tracker as an agenda artifact, and markdown headers naming the tracker.
    if (/action items?\s+tracker/i.test(span)) continue;
    if (/#+\s*action items?/i.test(transcript.slice(Math.max(0, m.index - 4), m.index + 20))) continue;
    spans.push(span);
  }
  return spans;
}
