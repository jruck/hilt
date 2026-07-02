/**
 * The meeting-action LEDGER — state, not a report (scope §9.1). Lives at
 * meta/loops/meetings/state/ledger.json; the loop's daily artifact derives from it.
 *
 * Identity is the hard problem: the same commitment restated across meetings must stay ONE entry.
 * Resolution happens in-the-loop — the extractor is shown the current OPEN ledger and must either
 * match an existing id or mint a new one. The ledger itself is a dumb, auditable store:
 * single JSON map + full status history per entry, atomic rewrite, per-loop git commits give the
 * audit trail.
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
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(home), "utf-8")) as Ledger;
  } catch {
    return { version: 1, entries: {} };
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

/**
 * The compact open-ledger digest fed to the extractor for identity resolution — id, action, owner,
 * age. Kept terse: this rides in every extraction prompt.
 */
export function openLedgerDigest(ledger: Ledger, nowIso: string): string {
  const open = openEntries(ledger);
  if (!open.length) return "(ledger empty — every commitment you extract is NEW)";
  return open
    .map((e) => `${e.id} · ${e.owner} · ${e.action.slice(0, 120)} · opened ${e.opened_at.slice(0, 10)} (${entryAgeDays(e, nowIso)}d)`)
    .join("\n");
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
