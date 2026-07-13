import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Ledger, LedgerEntry } from "../src/lib/loops/meeting-ledger";
import { MeetingLedgerStore } from "../src/lib/loops/meeting-ledger-store";

const TOTAL = Number(process.env.MEETING_LEDGER_SCALE_ROWS || 40_000);
const ACTIVE = Math.min(TOTAL, Number(process.env.MEETING_LEDGER_SCALE_ACTIVE_ROWS || 1_200));
const LIMIT_MS = Number(process.env.MEETING_LEDGER_SCALE_LIMIT_MS || 2_000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-ledger-scale-"));
const dbPath = path.join(root, "meeting-ledger.sqlite");

function dateFor(index: number): string {
  const date = new Date(Date.UTC(2020, 0, 1));
  date.setUTCDate(date.getUTCDate() + Math.floor(index / 35));
  return date.toISOString().slice(0, 10);
}

function makeEntry(index: number): LedgerEntry {
  const active = index >= TOTAL - ACTIVE;
  const date = active ? `2026-07-${String(1 + (index % 12)).padStart(2, "0")}` : dateFor(index);
  const id = `ma-${date}-${String(index + 1).padStart(5, "0")}`;
  const openedAt = `${date}T12:00:00.000Z`;
  const resolved = !active && index % 5 !== 0;
  const pending = !resolved && index % 97 === 0;
  const accepted = !resolved && !pending && index % 131 === 0;
  return {
    id,
    action: `${index % 211 === 0 ? "Reconcile location billing migration" : "Follow up on customer delivery"} ${index}`,
    owner: index % 4 === 0 ? "justin" : index % 4 === 1 ? "unclear" : `other:person-${index % 20}`,
    context: `Project ${index % 73} discussed a concrete dependency and next handoff for record ${index}.`,
    citations: [{ source: `meetings/${date}/Scale meeting ${index % 500}.md`, date, anchor: `Evidence ${index}` }],
    confidence: 0.88,
    source: "extractor",
    status: resolved ? "resolved" : "open",
    opened_at: openedAt,
    opened_from: `meetings/${date}/Scale meeting ${index % 500}.md`,
    status_history: resolved
      ? [{ at: openedAt, from: null, to: "open" }, { at: `${date}T18:00:00.000Z`, from: "open", to: "resolved" }]
      : [{ at: openedAt, from: null, to: "open" }],
    sightings: active && index % 3 === 0 ? [{ at: `2026-07-12T10:${String(index % 60).padStart(2, "0")}:00.000Z`, meeting: `meetings/2026-07-12/Follow-up ${index % 50}.md` }] : [],
    ...(pending ? { task_id: `t-${date.replaceAll("-", "")}-${String(index + 1).padStart(5, "0")}`, first_escalated_at: openedAt } : {}),
    ...(accepted ? { task_id: `t-${date.replaceAll("-", "")}-${String(index + 50_000).padStart(5, "0")}`, verdict: { verdict: "approve", at: openedAt } } : {}),
  };
}

function timed<T>(name: string, fn: () => T): { name: string; ms: number; value: T } {
  const started = performance.now();
  const value = fn();
  return { name, ms: performance.now() - started, value };
}

const store = new MeetingLedgerStore(dbPath);
try {
  const entries: Record<string, LedgerEntry> = {};
  for (let index = 0; index < TOTAL; index += 1) {
    const entry = makeEntry(index);
    entries[entry.id] = entry;
  }
  const ledger: Ledger = { version: 1, entries };
  const seedStarted = performance.now();
  store.importLegacy({ ledger, importedAt: "2026-07-12T12:00:00.000Z", sourceFingerprint: `scale-${TOTAL}-${ACTIVE}` });
  const seedMs = performance.now() - seedStarted;
  const page = timed("first_page", () => store.list({ limit: 50 }));
  const second = timed("second_page", () => store.list({ limit: 50, cursor: page.value.next_cursor! }));
  const search = timed("fts_search", () => store.list({ query: "location billing migration", limit: 50 }));
  const context = timed("identity_context", () => store.identityContext({
    now: "2026-07-12T12:00:00.000Z",
    observations: ["Reconcile location billing migration for project 42"],
    tokenBudget: 40_000,
  }));
  const timings = [page, second, search, context].map(({ name, ms }) => ({ name, ms: Math.round(ms * 10) / 10, ok: ms < LIMIT_MS }));
  const result = {
    ok: timings.every((value) => value.ok) && store.quickCheck() === "ok",
    rows: TOTAL,
    active_window_rows: ACTIVE,
    seed_ms: Math.round(seedMs),
    timings,
    context: {
      required: context.value.required.length,
      older_matches: context.value.older_matches.length,
      estimated_tokens: context.value.estimated_tokens,
      chunks: context.value.chunks.length,
      complete_recent_window: context.value.complete_recent_window,
    },
    database_bytes: fs.statSync(dbPath).size,
    quick_check: store.quickCheck(),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  store.close();
  if (process.env.KEEP_E2E !== "1") fs.rmSync(root, { recursive: true, force: true });
  else console.error(`[meeting-ledger-scale] retained ${root}`);
}
