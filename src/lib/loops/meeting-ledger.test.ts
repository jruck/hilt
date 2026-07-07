/**
 * Behavioral spec for A7 dismissed-immunity: a DISMISSED commitment must stay dismissed —
 * the extractor sees recently-dismissed entries for identity resolution (restatements resolve
 * to the dismissed id as sightings), and the ledger-apply backstop folds exact-text
 * restatements the extractor missed. Sightings never change status, so a dropped entry can
 * never reopen, re-escalate, or re-mint through this path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ledger, LedgerEntry } from "./meeting-ledger";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DISMISSED_IMMUNITY_DAYS,
  readLedger,
  writeLedger,
  dismissedLedgerDigest,
  normalizeActionText,
  openEntries,
  recentlyDismissedByAction,
  recentlyDismissedEntries,
} from "./meeting-ledger";
import { buildExtractorTask, EXTRACTOR_SYSTEM } from "./meeting-extractor-prompt";

const NOW = "2026-07-07T09:00:00.000Z";

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "ma-2026-07-01-001",
    action: "Send Sarah the pricing sheet",
    owner: "justin",
    citations: [{ source: "meetings/2026-07-01/floyds.md", date: "2026-07-01" }],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-01T19:30:00.000Z",
    opened_from: "meetings/2026-07-01/floyds.md",
    status_history: [{ at: "2026-07-01T19:30:00.000Z", from: null, to: "open" }],
    sightings: [],
    ...overrides,
  };
}

/** A dismiss-verdict drop: verdict recorded + dropped transition at `droppedAt`. */
function dismissed(id: string, action: string, droppedAt: string): LedgerEntry {
  return entry({
    id,
    action,
    status: "dropped",
    verdict: { verdict: "dismiss", at: droppedAt },
    status_history: [
      { at: "2026-07-01T19:30:00.000Z", from: null, to: "open" },
      { at: droppedAt, from: "open", to: "dropped", evidence: "dismissed by verdict" },
    ],
  });
}

function ledgerOf(...entries: LedgerEntry[]): Ledger {
  return { version: 1, entries: Object.fromEntries(entries.map((e) => [e.id, e])) };
}

// ── recentlyDismissedEntries ──────────────────────────────────────────────────────────────────

test("recentlyDismissedEntries: dismiss-verdict drops inside the window, nothing else", () => {
  const fresh = dismissed("ma-2026-07-02-001", "Send Sarah the pricing sheet", "2026-07-03T10:00:00.000Z");
  const stale = dismissed("ma-2026-05-01-001", "Old declined thing", "2026-06-01T10:00:00.000Z"); // 36d ago
  // Closure drop: dropped via extractor evidence, NO dismiss verdict — not immune.
  const closureDrop = entry({
    id: "ma-2026-07-02-002",
    action: "Abandoned in the meeting itself",
    status: "dropped",
    status_history: [
      { at: "2026-07-01T19:30:00.000Z", from: null, to: "open" },
      { at: "2026-07-03T10:00:00.000Z", from: "open", to: "dropped", evidence: "we're not doing that" },
    ],
  });
  const stillOpen = entry({ id: "ma-2026-07-02-003", action: "Open work" });
  // Approved-then-dismissed lookalike: dismiss verdict but entry currently OPEN (revise flow
  // cleared it) — not dropped, so not in the dismissed digest.
  const openWithDismissNote = entry({
    id: "ma-2026-07-02-004",
    action: "Reopened by revise",
    verdict: { verdict: "dismiss", at: "2026-07-03T10:00:00.000Z" },
  });

  const ledger = ledgerOf(fresh, stale, closureDrop, stillOpen, openWithDismissNote);
  const got = recentlyDismissedEntries(ledger, NOW);
  assert.deepEqual(got.map((e) => e.id), ["ma-2026-07-02-001"]);
  // Window boundary: exactly DISMISSED_IMMUNITY_DAYS old still counts.
  const boundaryAt = new Date(Date.parse(NOW) - DISMISSED_IMMUNITY_DAYS * 86_400_000).toISOString();
  const boundary = dismissed("ma-2026-06-07-001", "Boundary case", boundaryAt);
  assert.equal(recentlyDismissedEntries(ledgerOf(boundary), NOW).length, 1);
});

test("dismissed entries are NOT open: they can never re-escalate through openEntries", () => {
  const d = dismissed("ma-2026-07-02-001", "Declined", "2026-07-03T10:00:00.000Z");
  assert.deepEqual(openEntries(ledgerOf(d)), []);
});

// ── digest + prompt section ───────────────────────────────────────────────────────────────────

test("dismissedLedgerDigest: compact id · owner · action lines; empty string when none", () => {
  const d1 = dismissed("ma-2026-07-02-001", "Send Sarah the pricing sheet", "2026-07-03T10:00:00.000Z");
  const digest = dismissedLedgerDigest(ledgerOf(d1), NOW);
  assert.equal(digest, "ma-2026-07-02-001 · justin · Send Sarah the pricing sheet");
  assert.equal(dismissedLedgerDigest(ledgerOf(entry({})), NOW), "");
});

test("dismissedLedgerDigest: a dismiss note becomes the declined reason (≤100 chars)", () => {
  // The gate-B comment primitive lets any verdict carry a note; a dismiss reason rides the
  // digest so the extractor learns WHY it was declined.
  const withNote = dismissed("ma-2026-07-02-001", "Send Sarah the pricing sheet", "2026-07-03T10:00:00.000Z");
  withNote.verdict = { verdict: "dismiss", at: "2026-07-03T10:00:00.000Z", note: "Sarah left the account" };
  assert.equal(
    dismissedLedgerDigest(ledgerOf(withNote), NOW),
    "ma-2026-07-02-001 · justin · Send Sarah the pricing sheet — declined: Sarah left the account",
  );

  // Long reasons truncate to 100 chars; whitespace-only notes render as no reason at all.
  const longNote = "x".repeat(140);
  const truncated = dismissed("ma-2026-07-02-002", "Another ask", "2026-07-03T10:00:00.000Z");
  truncated.verdict = { verdict: "dismiss", at: "2026-07-03T10:00:00.000Z", note: longNote };
  const line = dismissedLedgerDigest(ledgerOf(truncated), NOW);
  assert.ok(line.endsWith(`declined: ${"x".repeat(100)}`));
  assert.ok(!line.includes("x".repeat(101)));

  const blankNote = dismissed("ma-2026-07-02-003", "Blank-note ask", "2026-07-03T10:00:00.000Z");
  blankNote.verdict = { verdict: "dismiss", at: "2026-07-03T10:00:00.000Z", note: "   " };
  assert.equal(
    dismissedLedgerDigest(ledgerOf(blankNote), NOW),
    "ma-2026-07-02-003 · justin · Blank-note ask",
  );
});

test("ledger verdict note round-trips through write + read", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-ledger-note-"));
  const noted = dismissed("ma-2026-07-02-001", "Send Sarah the pricing sheet", "2026-07-03T10:00:00.000Z");
  noted.verdict = { verdict: "dismiss", at: "2026-07-03T10:00:00.000Z", note: "Sarah left the account" };
  writeLedger(home, ledgerOf(noted));
  const reread = readLedger(home);
  assert.deepEqual(reread.entries["ma-2026-07-02-001"].verdict, {
    verdict: "dismiss",
    at: "2026-07-03T10:00:00.000Z",
    note: "Sarah left the account",
  });
  // And the digest built from the REREAD ledger still carries the reason.
  assert.ok(dismissedLedgerDigest(reread, NOW).includes("— declined: Sarah left the account"));
});

test("buildExtractorTask: RECENTLY DISMISSED section present with digest, absent without", () => {
  const base = {
    meetingPath: "meetings/2026-07-07/sync.md",
    noteContent: "note",
    transcriptContent: "transcript",
    openLedgerDigest: "(ledger empty — every commitment you extract is NEW)",
    catchPhraseSpans: [],
  };
  const withDismissed = buildExtractorTask({
    ...base,
    dismissedLedgerDigest: "ma-2026-07-02-001 · justin · Send Sarah the pricing sheet",
  });
  assert.ok(withDismissed.includes("=== RECENTLY DISMISSED"));
  assert.ok(withDismissed.includes("ma-2026-07-02-001 · justin · Send Sarah the pricing sheet"));
  // Section order: open ledger first, dismissed second, then the note.
  assert.ok(withDismissed.indexOf("CURRENT OPEN LEDGER") < withDismissed.indexOf("RECENTLY DISMISSED"));
  assert.ok(withDismissed.indexOf("RECENTLY DISMISSED") < withDismissed.indexOf("=== MEETING NOTE ==="));

  const without = buildExtractorTask(base);
  assert.ok(!without.includes("RECENTLY DISMISSED"));
});

test("EXTRACTOR_SYSTEM carries the dismissed-immunity rule", () => {
  assert.ok(/DISMISSED entries:/.test(EXTRACTOR_SYSTEM));
  assert.ok(/SIGHTING/.test(EXTRACTOR_SYSTEM));
  assert.ok(/Dismissal is durable/.test(EXTRACTOR_SYSTEM));
});

// ── apply-time backstop index ─────────────────────────────────────────────────────────────────

test("recentlyDismissedByAction: normalized exact-text index over the dismissed set", () => {
  const d = dismissed("ma-2026-07-02-001", "Send Sarah the pricing sheet", "2026-07-03T10:00:00.000Z");
  const map = recentlyDismissedByAction(ledgerOf(d, entry({ id: "ma-2026-07-02-009", action: "Open work" })), NOW);
  assert.equal(map.size, 1);
  // Case/whitespace variations of the same literal restatement hit; different wording misses.
  assert.equal(map.get(normalizeActionText("send  sarah the Pricing sheet "))?.id, "ma-2026-07-02-001");
  assert.equal(map.get(normalizeActionText("Send Sarah the pricing document")), undefined);
});

test("readLedger: missing file → empty ledger; CORRUPT file → throws (never a silent wipe)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-ledger-"));
  assert.deepEqual(readLedger(home), { version: 1, entries: {} });
  fs.mkdirSync(path.join(home, "state"), { recursive: true });
  fs.writeFileSync(path.join(home, "state", "ledger.json"), '{"version":1,"entries":{"trunc', "utf-8");
  assert.throws(() => readLedger(home), /ledger unreadable/);
});
