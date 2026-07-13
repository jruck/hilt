import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Ledger, LedgerEntry } from "./meeting-ledger";
import {
  backupMeetingLedger,
  exportLegacyMeetingState,
  readLegacyMeetingState,
  restoreMeetingLedgerBackup,
  writeReadableMeetingLedgerExport,
} from "./meeting-ledger-maintenance";
import { openMeetingLedgerRuntime } from "./meeting-ledger-runtime";
import {
  acquireMeetingLedgerLock,
  MEETING_LEDGER_SCHEMA_VERSION,
  MeetingLedgerStore,
  meetingLedgerDbPath,
  meetingLedgerRoot,
  writeMeetingLedgerStorageMarker,
} from "./meeting-ledger-store";

function temp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-ledger-"));
}

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const date = id.slice(3, 13);
  const opened = `${date}T12:00:00.000Z`;
  return {
    id,
    action: `Action for ${id}`,
    owner: "justin",
    citations: [{ source: `meetings/${date}/Meeting.md`, date, anchor: `Quote ${id}` }],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: opened,
    opened_from: `meetings/${date}/Meeting.md`,
    status_history: [{ at: opened, from: null, to: "open" }],
    sightings: [],
    ...overrides,
  };
}

test("legacy import round-trips every ledger field, summaries, and processed meetings", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const first = entry("ma-2026-07-01-001", {
    due: "2026-07-10",
    context: "Context survives normalization.",
    first_escalated_at: "2026-07-02T12:00:00.000Z",
    task_id: "t-20260702-001",
    verdict: { verdict: "approve", at: "2026-07-02T13:00:00.000Z", note: "Keep it" },
    sightings: [{ at: "2026-07-03T12:00:00.000Z", meeting: "meetings/2026-07-03/Follow-up.md", quote: "Still doing it" }],
    status_history: [
      { at: "2026-07-01T12:00:00.000Z", from: null, to: "open" },
      { at: "2026-07-03T12:00:00.000Z", from: "open", to: "carried", evidence: "Explicit carry" },
    ],
    status: "carried",
  });
  const second = entry("ma-2026-07-02-002", { owner: "unclear" });
  const ledger: Ledger = { version: 1, entries: { [first.id]: first, [second.id]: second } };
  const input = {
    ledger,
    summaries: { "meetings/2026-07-01/Meeting.md": { date: "2026-07-01", summary: "A summary" } },
    processed: { "meetings/2026-07-01/Meeting.md": "2026-07-01T14:00:00.000Z" },
    importedAt: "2026-07-12T12:00:00.000Z",
    sourceFingerprint: "fixture-one",
  };
  assert.deepEqual(store.importLegacy(input), { imported: true, entries: 2 });
  assert.deepEqual(store.importLegacy(input), { imported: false, entries: 2 });
  assert.deepEqual(store.readAll(), ledger);
  assert.deepEqual(store.meetingSummaries().map(({ updated_at: _updated, ...value }) => value), [
    { meeting: "meetings/2026-07-01/Meeting.md", date: "2026-07-01", summary: "A summary" },
  ]);
  assert.equal(store.meetingSummaries("2026-07-02").length, 0);
  assert.equal(store.meetingSummaries(undefined, "2026-07-01").length, 1);
  assert.equal(store.meetingSummary("meetings/2026-07-01/Meeting.md")?.summary, "A summary");
  assert.equal(store.meetingSummary("meetings/2026-07-01/Missing.md"), null);
  assert.deepEqual(store.processedMeetings(), input.processed);
  assert.equal(store.quickCheck(), "ok");
  assert.equal(store.integrityCheck(), "ok");
  assert.equal(store.counts().event_sequence, 1);
  store.close();
});

test("entry batches are transactional and task ids are globally unique", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const good = entry("ma-2026-07-01-001", { task_id: "t-20260701-001" });
  const invalid = entry("ma-2026-07-01-002", { action: "" });
  assert.throws(() => store.putEntries([good, invalid], { type: "fixture", at: "2026-07-12T12:00:00.000Z" }), /action is empty/);
  assert.equal(store.counts().total, 0);
  store.putEntry(good, { type: "opened", at: "2026-07-12T12:00:00.000Z" });
  assert.throws(() => store.putEntry(
    entry("ma-2026-07-01-003", { task_id: good.task_id }),
    { type: "opened", at: "2026-07-12T12:01:00.000Z" },
  ), /UNIQUE constraint failed/);
  assert.equal(store.counts().total, 1);
  assert.equal(Number(store.db.pragma("user_version", { simple: true })), MEETING_LEDGER_SCHEMA_VERSION);
  store.close();
});

test("status chains, immutable before/after events, and latched write blocks are enforced", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const value = entry("ma-2026-07-01-001");
  store.putEntry(value, { type: "opened", at: "2026-07-12T12:00:00.000Z" });
  value.action = "Updated action";
  store.putEntry(value, { type: "revised", at: "2026-07-12T12:01:00.000Z" });
  const event = store.eventsForEntry(value.id)[0];
  assert.equal((event.payload.before as { action: string }).action, `Action for ${value.id}`);
  assert.equal((event.payload.after as { action: string }).action, "Updated action");
  const disconnected = entry("ma-2026-07-01-002", {
    status_history: [{ at: "2026-07-01T12:00:00.000Z", from: "open", to: "resolved" }],
    status: "resolved",
  });
  assert.throws(() => store.putEntry(disconnected, { type: "invalid", at: "2026-07-12T12:02:00.000Z" }), /disconnected status history/);
  store.blockWrites("fixture backup failure");
  assert.throws(() => store.putEntry(entry("ma-2026-07-01-003"), { type: "blocked", at: "2026-07-12T12:03:00.000Z" }), /writes are blocked/);
  store.clearWriteBlock();
  store.putEntry(entry("ma-2026-07-01-003"), { type: "recovered", at: "2026-07-12T12:04:00.000Z" });
  store.beginExtractionRun({ id: "run-1", startedAt: "2026-07-12T12:05:00.000Z" });
  store.finishExtractionRun({ id: "run-1", finishedAt: "2026-07-12T12:06:00.000Z", status: "succeeded", attempted: 1, succeeded: 1, contextTokens: 120 });
  assert.deepEqual(store.db.prepare("SELECT status, attempted, succeeded, context_tokens FROM extraction_runs WHERE id='run-1'").get(), {
    status: "succeeded", attempted: 1, succeeded: 1, context_tokens: 120,
  });
  store.close();
});

test("durable extraction jobs dedupe, lease exclusively, recover expiry, retry, and complete", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const meeting = "meetings/2026-07-13/Restart recovery.md";
  const queued = store.enqueueExtractionJob({
    meetingPath: meeting,
    source: "trigger",
    queuedAt: "2026-07-13T12:00:00.000Z",
    granolaId: "granola-1",
    settledAt: "2026-07-13T11:58:00.000Z",
  });
  assert.equal(queued?.status, "queued");
  assert.equal(store.enqueueExtractionJob({
    meetingPath: meeting,
    source: "trigger",
    queuedAt: "2026-07-13T12:01:00.000Z",
  })?.queued_at, "2026-07-13T12:00:00.000Z", "repeat observations must not rewrite queue identity");

  const first = store.claimExtractionJobs({ owner: "worker-a", now: "2026-07-13T12:02:00.000Z", leaseMs: 90_000 });
  assert.deepEqual(first.map((job) => job.meeting_path), [meeting]);
  assert.equal(first[0].attempt_count, 1);
  assert.deepEqual(store.claimExtractionJobs({ owner: "worker-b", now: "2026-07-13T12:03:00.000Z", leaseMs: 90_000 }), []);
  assert.equal(store.renewExtractionJobLeases({
    meetingPaths: [meeting], owner: "worker-a", now: "2026-07-13T12:03:10.000Z", leaseMs: 90_000,
  }), 1);
  assert.deepEqual(store.claimExtractionJobs({ owner: "worker-b", now: "2026-07-13T12:04:00.000Z", leaseMs: 90_000 }), []);

  const recovered = store.claimExtractionJobs({ owner: "worker-b", now: "2026-07-13T12:05:00.000Z", leaseMs: 90_000 });
  assert.equal(recovered[0].attempt_count, 2);
  assert.equal(recovered[0].lease_owner, "worker-b");
  assert.equal(store.retryExtractionJob({
    meetingPath: meeting,
    owner: "worker-b",
    failedAt: "2026-07-13T12:05:10.000Z",
    nextRetryAt: "2026-07-13T12:05:40.000Z",
    error: "worker restarted before verification",
    maxAttempts: 5,
  }), "retry_wait");
  assert.deepEqual(store.claimExtractionJobs({ owner: "worker-c", now: "2026-07-13T12:05:30.000Z", leaseMs: 90_000 }), []);
  const third = store.claimExtractionJobs({ owner: "worker-c", now: "2026-07-13T12:05:40.000Z", leaseMs: 90_000 });
  assert.equal(third[0].attempt_count, 3);
  assert.equal(store.completeExtractionJob({
    meetingPath: meeting,
    owner: "worker-c",
    completedAt: "2026-07-13T12:06:00.000Z",
    runId: "run-1",
  }), true);
  assert.equal(store.getExtractionJob(meeting)?.status, "complete");
  assert.equal(store.extractionQueueHealth().depth, 0);
  assert.ok(store.latestEvent("meeting-extraction-job-completed"));
  store.close();
});

test("schema v2 upgrades forward to the durable extraction queue", () => {
  const root = temp();
  const dbPath = path.join(root, "ledger.sqlite");
  const first = new MeetingLedgerStore(dbPath);
  first.db.exec("DROP TABLE meeting_extraction_jobs");
  first.db.pragma("user_version = 2");
  first.close();
  const upgraded = new MeetingLedgerStore(dbPath);
  assert.equal(Number(upgraded.db.pragma("user_version", { simple: true })), MEETING_LEDGER_SCHEMA_VERSION);
  assert.equal(upgraded.extractionQueueHealth().depth, 0);
  upgraded.close();
});

test("an extraction job becomes terminal after its final allowed attempt", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const meeting = "meetings/2026-07-13/Terminal failure.md";
  store.enqueueExtractionJob({
    meetingPath: meeting,
    source: "nightly",
    queuedAt: "2026-07-13T12:00:00.000Z",
  });
  store.claimExtractionJobs({ owner: "worker-a", now: "2026-07-13T12:01:00.000Z", leaseMs: 90_000 });
  assert.equal(store.retryExtractionJob({
    meetingPath: meeting,
    owner: "worker-a",
    failedAt: "2026-07-13T12:01:10.000Z",
    nextRetryAt: "2026-07-13T12:01:40.000Z",
    error: "canonical verification failed",
    maxAttempts: 1,
  }), "failed");
  assert.equal(store.getExtractionJob(meeting)?.status, "failed");
  assert.equal(store.extractionQueueHealth().failed, 1);
  assert.equal(store.extractionQueueHealth().depth, 0);
  assert.ok(store.latestEvent("meeting-extraction-job-failed"));
  store.close();
});

test("cross-process migration lock serializes writers and recovers after release", async () => {
  const root = temp();
  process.env.DATA_DIR = path.join(root, "data");
  const vault = path.join(root, "vault");
  const first = await acquireMeetingLedgerLock({ vaultPath: vault, label: "first", timeoutMs: 100 });
  await assert.rejects(
    acquireMeetingLedgerLock({ vaultPath: vault, label: "second", timeoutMs: 30, pollMs: 5 }),
    /timed out waiting/,
  );
  first.release();
  const third = await acquireMeetingLedgerLock({ vaultPath: vault, label: "third", timeoutMs: 100 });
  third.release();
  delete process.env.DATA_DIR;
});

test("a corrupt database fails loud instead of being replaced", () => {
  const root = temp();
  const dbPath = path.join(root, "ledger.sqlite");
  fs.writeFileSync(dbPath, "not a sqlite database", "utf-8");
  assert.throws(() => new MeetingLedgerStore(dbPath), /not a database|file is not a database/i);
  assert.equal(fs.readFileSync(dbPath, "utf-8"), "not a sqlite database");
});

test("a newer unsupported schema version fails loud", async () => {
  const root = temp();
  const dbPath = path.join(root, "future.sqlite");
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbPath);
  db.pragma(`user_version = ${MEETING_LEDGER_SCHEMA_VERSION + 1}`);
  db.close();
  assert.throws(() => new MeetingLedgerStore(dbPath), /newer than supported/);
});

test("a SQLite storage marker with no canonical database refuses blank initialization", () => {
  const root = temp();
  const vault = path.join(root, "vault");
  const priorDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = path.join(root, "data");
  try {
    writeMeetingLedgerStorageMarker(vault, {
      version: 1,
      mode: "sqlite",
      migrated_at: "2026-07-12T12:00:00.000Z",
      legacy_home: path.join(root, "legacy"),
    });
    const dbPath = meetingLedgerDbPath(vault);
    assert.equal(fs.existsSync(dbPath), false);
    assert.throws(
      () => openMeetingLedgerRuntime({ vaultPath: vault, legacyHome: path.join(root, "legacy") }),
      /canonical meeting ledger is missing/,
    );
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    if (priorDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = priorDataDir;
  }
});

test("context selection includes the complete recent window, mandatory old work, recent dismissals, and older FTS matches", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const recent = entry("ma-2026-07-10-001", { action: "Prepare the launch scorecard" });
  const oldPending = entry("ma-2026-01-01-001", { task_id: "t-20260101-001", first_escalated_at: "2026-01-01T13:00:00.000Z" });
  const oldAccepted = entry("ma-2026-01-02-001", {
    task_id: "t-20260102-001",
    verdict: { verdict: "approve", at: "2026-01-03T12:00:00.000Z" },
  });
  const recentDismissed = entry("ma-2026-06-30-001", {
    status: "dropped",
    verdict: { verdict: "dismiss", at: "2026-07-01T12:00:00.000Z" },
    status_history: [
      { at: "2026-06-30T12:00:00.000Z", from: null, to: "open" },
      { at: "2026-07-01T12:00:00.000Z", from: "open", to: "dropped" },
    ],
  });
  const olderMatch = entry("ma-2025-01-01-001", {
    action: "Reconcile the legacy location billing migration",
    status: "resolved",
    status_history: [
      { at: "2025-01-01T12:00:00.000Z", from: null, to: "open" },
      { at: "2025-02-01T12:00:00.000Z", from: "open", to: "resolved" },
    ],
  });
  store.putEntries([recent, oldPending, oldAccepted, recentDismissed, olderMatch], {
    type: "fixture",
    at: "2026-07-12T12:00:00.000Z",
  });
  const context = store.identityContext({
    now: "2026-07-12T12:00:00.000Z",
    observations: ["Reconcile location billing migration"],
    tokenBudget: 50,
  });
  assert.deepEqual(new Set(context.required.map((value) => value.id)), new Set([
    recent.id, oldPending.id, oldAccepted.id, recentDismissed.id,
  ]));
  assert.deepEqual(context.older_matches.map((value) => value.id), [olderMatch.id]);
  assert.equal(context.complete_recent_window, true);
  assert.ok(context.chunks.length > 1, "small budget must chunk rather than truncate");
  assert.equal(context.chunks.flat().length, 5);
  store.close();
});

test("cursor pagination and surface filters remain stable", () => {
  const root = temp();
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const values = [
    entry("ma-2026-07-10-001", { action: "Alpha scorecard", task_id: "t-20260710-001" }),
    entry("ma-2026-07-09-001", { action: "Beta follow-up", owner: "unclear" }),
    entry("ma-2026-07-08-001", {
      action: "Gamma decline",
      status: "dropped",
      verdict: { verdict: "dismiss", at: "2026-07-09T12:00:00.000Z" },
      status_history: [
        { at: "2026-07-08T12:00:00.000Z", from: null, to: "open" },
        { at: "2026-07-09T12:00:00.000Z", from: "open", to: "dropped" },
      ],
    }),
  ];
  store.putEntries(values, { type: "fixture", at: "2026-07-12T12:00:00.000Z" });
  const first = store.list({ limit: 2 });
  const second = store.list({ limit: 2, cursor: first.next_cursor! });
  assert.deepEqual([...first.items, ...second.items].map((value) => value.id), values.map((value) => value.id));
  assert.deepEqual(store.list({ surface: "latent" }).items.map((value) => value.id), [values[1].id]);
  assert.equal(store.list().facets.surface.latent, 1);
  assert.deepEqual(store.list({ surface: "dismissed" }).items.map((value) => value.id), [values[2].id]);
  assert.deepEqual(store.list({ query: "scorecard" }).items.map((value) => value.id), [values[0].id]);
  assert.deepEqual(store.list({ query: "no-result-sentinel" }).items, []);
  store.close();
});

test("backup, readable export, legacy export, and restore preserve an intact database", async () => {
  const root = temp();
  process.env.DATA_DIR = path.join(root, "data");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  const dbPath = path.join(root, "ledger.sqlite");
  const store = new MeetingLedgerStore(dbPath);
  store.putEntry(entry("ma-2026-07-10-001"), { type: "opened", at: "2026-07-12T12:00:00.000Z" });
  store.enqueueExtractionJob({ meetingPath: "meetings/2026-07-12/Queued.md", source: "trigger", queuedAt: "2026-07-12T12:00:00.000Z" });
  const readable = JSON.parse(fs.readFileSync(writeReadableMeetingLedgerExport(store, vault), "utf-8")) as {
    extraction_jobs: Array<{ meeting_path: string }>;
    extraction_queue: { depth: number };
  };
  assert.deepEqual(readable.extraction_jobs.map((job) => job.meeting_path), ["meetings/2026-07-12/Queued.md"]);
  assert.equal(readable.extraction_queue.depth, 1);
  const backup = await backupMeetingLedger(store, vault, new Date("2026-07-12T12:00:00.000Z"));
  assert.equal(backup.quick_check, "ok");
  for (let month = 0; month < 16; month += 1) {
    await backupMeetingLedger(store, vault, new Date(Date.UTC(2025, month, 1, 12)));
  }
  const backupNames = fs.readdirSync(path.join(meetingLedgerRoot(vault), "backups"));
  assert.equal(backupNames.filter((name) => name.startsWith("daily-")).length, 14);
  assert.equal(backupNames.filter((name) => name.startsWith("monthly-")).length, 12);
  const legacyHome = path.join(root, "legacy");
  exportLegacyMeetingState(store, legacyHome);
  assert.equal(Object.keys(readLegacyMeetingState(legacyHome).ledger.entries).length, 1);
  store.close();
  const restored = path.join(root, "restored.sqlite");
  restoreMeetingLedgerBackup({ backupPath: backup.latest, targetPath: restored });
  const reread = new MeetingLedgerStore(restored);
  assert.equal(reread.counts().total, 1);
  assert.equal(reread.integrityCheck(), "ok");
  reread.close();
  delete process.env.DATA_DIR;
});
