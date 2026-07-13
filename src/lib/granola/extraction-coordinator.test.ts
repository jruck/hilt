import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { LedgerEntry } from "../loops/meeting-ledger";
import { MeetingLedgerStore } from "../loops/meeting-ledger-store";
import { mintProposalFromLedgerEntry, resolveProposalSink } from "../loops/proposal-mint";
import { proposalsDir, readTaskDir } from "../tasks/store";
import { MeetingExtractionCoordinator } from "./extraction-coordinator";

function entry(meeting: string, owner = "other:jason"): LedgerEntry {
  return {
    id: "ma-2026-07-13-001",
    action: "Verify restart recovery",
    owner,
    citations: [{ source: meeting, date: "2026-07-13", anchor: "Verify it after the restart." }],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-13T12:00:00.000Z",
    opened_from: meeting,
    status_history: [{ at: "2026-07-13T12:00:00.000Z", from: null, to: "open" }],
    sightings: [],
  };
}

test("restart recovery verifies an orphaned worker's committed output instead of rerunning it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-extraction-restart-"));
  const vault = path.join(root, "vault");
  const dbPath = path.join(root, "ledger.sqlite");
  fs.mkdirSync(vault, { recursive: true });
  const meeting = "meetings/2026-07-13/Recovered.md";
  const seed = new MeetingLedgerStore(dbPath);
  seed.enqueueExtractionJob({ meetingPath: meeting, source: "trigger", queuedAt: "2026-07-13T12:00:00.000Z" });
  seed.claimExtractionJobs({ owner: "dead-worker", now: "2026-07-13T12:00:01.000Z", leaseMs: 10_000 });
  seed.applyMeeting({ meeting, processedAt: "2026-07-13T12:00:05.000Z", entries: [entry(meeting)] });
  seed.close();

  let runs = 0;
  const coordinator = new MeetingExtractionCoordinator({
    vaultPath: vault,
    openStore: () => new MeetingLedgerStore(dbPath),
    owner: "replacement-worker",
    now: () => new Date("2026-07-13T12:00:20.000Z"),
    leaseMs: 10_000,
    runBatch: async () => {
      runs += 1;
      return { code: 0, tail: "unexpected", timedOut: false, elapsedMs: 1 };
    },
  });
  await coordinator.drainNow();
  const check = new MeetingLedgerStore(dbPath);
  assert.equal(runs, 0);
  assert.equal(check.getExtractionJob(meeting)?.status, "complete");
  assert.equal(check.getExtractionJob(meeting)?.attempt_count, 2, "expired lease is reclaimed before verification");
  check.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("file-first crash retries once, reconciles the same proposal id, and creates no duplicate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-extraction-file-first-"));
  const vault = path.join(root, "vault");
  const dbPath = path.join(root, "ledger.sqlite");
  fs.mkdirSync(vault, { recursive: true });
  const meeting = "meetings/2026-07-13/File first.md";
  const seed = new MeetingLedgerStore(dbPath);
  seed.enqueueExtractionJob({ meetingPath: meeting, source: "trigger", queuedAt: "2026-07-13T12:00:00.000Z" });
  seed.close();
  const sink = resolveProposalSink({ registryProposalSink: "vault", vaultPath: vault, loopHome: path.join(root, "loop") });
  let now = new Date("2026-07-13T12:00:01.000Z");
  let runs = 0;
  const coordinator = new MeetingExtractionCoordinator({
    vaultPath: vault,
    openStore: () => new MeetingLedgerStore(dbPath),
    owner: "worker",
    now: () => now,
    leaseMs: 10_000,
    retryBaseMs: 1_000,
    retryMaxMs: 1_000,
    maxAttempts: 5,
    runBatch: async () => {
      runs += 1;
      const store = new MeetingLedgerStore(dbPath);
      try {
        if (runs === 1) {
          const value = entry(meeting, "justin");
          value.first_escalated_at = now.toISOString();
          store.applyMeeting({ meeting, processedAt: now.toISOString(), entries: [value] });
          mintProposalFromLedgerEntry(value, { sink, loopId: "meeting-actions", vaultPath: vault, now: now.toISOString(), idDate: "2026-07-13" });
          // Crash window: the file exists, but the mutated task_id never reached SQLite.
          return { code: 137, tail: "killed after proposal write", timedOut: false, elapsedMs: 1 };
        }
        const value = store.getEntry("ma-2026-07-13-001")!;
        const recovered = mintProposalFromLedgerEntry(value, { sink, loopId: "meeting-actions", vaultPath: vault, now: now.toISOString(), idDate: "2026-07-13" });
        assert.ok(recovered);
        store.putEntry(value, { type: "proposal-escalated", at: now.toISOString(), meeting });
        return { code: 0, tail: "reconciled", timedOut: false, elapsedMs: 1 };
      } finally {
        store.close();
      }
    },
  });

  await coordinator.drainNow();
  let check = new MeetingLedgerStore(dbPath);
  assert.equal(check.getExtractionJob(meeting)?.status, "retry_wait");
  check.close();
  now = new Date("2026-07-13T12:00:03.000Z");
  await coordinator.drainNow();
  check = new MeetingLedgerStore(dbPath);
  assert.equal(check.getExtractionJob(meeting)?.status, "complete");
  assert.equal(check.getEntry("ma-2026-07-13-001")?.task_id, "t-20260713-001");
  check.close();
  assert.deepEqual(readTaskDir(proposalsDir(vault)).map((task) => task.id), ["t-20260713-001"]);
  assert.equal(runs, 2);
  fs.rmSync(root, { recursive: true, force: true });
});
