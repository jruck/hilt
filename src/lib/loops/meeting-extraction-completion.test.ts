import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyMeetingExtractionCompletion } from "./meeting-extraction-completion";
import type { LedgerEntry } from "./meeting-ledger";
import { MeetingLedgerStore } from "./meeting-ledger-store";
import { mintProposalFromLedgerEntry, resolveProposalSink } from "./proposal-mint";

function makeEntry(meeting: string, owner = "justin"): LedgerEntry {
  return {
    id: "ma-2026-07-13-001",
    action: "Confirm the restart-safe extraction path",
    owner,
    context: "The meeting ended while Hilt was rebuilding.",
    citations: [{ source: meeting, date: "2026-07-13", anchor: "Make sure this comes back after a restart." }],
    confidence: 0.94,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-13T12:00:00.000Z",
    opened_from: meeting,
    status_history: [{ at: "2026-07-13T12:00:00.000Z", from: null, to: "open" }],
    sightings: [],
  };
}

test("completion requires processed state plus a reciprocal proposal for first-touch work", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-completion-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const meeting = "meetings/2026-07-13/Restart recovery.md";
  const entry = makeEntry(meeting);
  store.applyMeeting({
    meeting,
    processedAt: "2026-07-13T12:05:00.000Z",
    entries: [entry],
    summary: { date: "2026-07-13", summary: "Agreed to make extraction recover from restarts." },
  });
  const incomplete = verifyMeetingExtractionCompletion(store, vault, meeting);
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.issues.join("\n"), /not escalated/);
  assert.match(incomplete.issues.join("\n"), /no task id/);

  entry.first_escalated_at = "2026-07-13T12:06:00.000Z";
  const sink = resolveProposalSink({ registryProposalSink: "vault", vaultPath: vault, loopHome: path.join(root, "loop") });
  const task = mintProposalFromLedgerEntry(entry, {
    sink,
    loopId: "meeting-actions",
    vaultPath: vault,
    now: "2026-07-13T12:06:00.000Z",
    idDate: "2026-07-13",
  });
  assert.ok(task);
  store.putEntry(entry, { type: "proposal-escalated", at: "2026-07-13T12:06:00.000Z", meeting });
  const complete = verifyMeetingExtractionCompletion(store, vault, meeting);
  assert.equal(complete.ok, true, complete.issues.join("\n"));
  assert.deepEqual(complete.task_ids, [task!.id]);
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("other-owner observations complete without a proposal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-completion-other-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  const store = new MeetingLedgerStore(path.join(root, "ledger.sqlite"));
  const meeting = "meetings/2026-07-13/Team follow-up.md";
  store.applyMeeting({
    meeting,
    processedAt: "2026-07-13T13:00:00.000Z",
    entries: [makeEntry(meeting, "other:jason")],
  });
  const result = verifyMeetingExtractionCompletion(store, vault, meeting);
  assert.equal(result.ok, true, result.issues.join("\n"));
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});
