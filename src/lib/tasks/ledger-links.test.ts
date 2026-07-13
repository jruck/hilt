import test from "node:test";
import assert from "node:assert/strict";
import type { LedgerEntry } from "@/lib/loops/meeting-ledger";
import type { TaskFile } from "./types";
import { auditMeetingLedgerTaskLinks } from "./ledger-links";

function entry(id: string, taskId?: string): LedgerEntry {
  return {
    id,
    action: `Action ${id}`,
    owner: "justin",
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-01T10:00:00.000Z",
    opened_from: "meetings/2026-07-01/Example.md",
    citations: [],
    sightings: [],
    status_history: [],
    ...(taskId ? { task_id: taskId } : {}),
  };
}

function task(id: string, ledgerId?: string): TaskFile {
  return {
    id,
    title: `Task ${id}`,
    status: "accepted-me",
    created_at: "2026-07-01T10:00:00.000Z",
    body: "",
    ...(ledgerId ? { origin: { loop: "meeting-actions", item_id: ledgerId } } : {}),
  };
}

test("ledger task links accept reciprocal IDs regardless of editable task title", () => {
  const linked = task("t-20260701-001", "ma-1");
  linked.title = "A completely rewritten task title";
  assert.deepEqual(auditMeetingLedgerTaskLinks([entry("ma-1", linked.id)], [linked]), []);
});

test("ledger task links report mismatched, orphaned, and duplicate origins", () => {
  const issues = auditMeetingLedgerTaskLinks(
    [entry("ma-1", "t-20260701-001")],
    [
      task("t-20260701-001", "ma-other"),
      task("t-20260701-002", "ma-orphan"),
      task("t-20260701-003", "ma-orphan"),
    ],
  );
  assert.deepEqual(issues, [
    { kind: "task-origin-mismatch", ledger_id: "ma-1", task_ids: ["t-20260701-001"], expected_task_id: "t-20260701-001" },
    { kind: "duplicate-task-origin", ledger_id: "ma-orphan", task_ids: ["t-20260701-002", "t-20260701-003"] },
    { kind: "orphan-task-origin", ledger_id: "ma-orphan", task_ids: ["t-20260701-002", "t-20260701-003"] },
    { kind: "orphan-task-origin", ledger_id: "ma-other", task_ids: ["t-20260701-001"] },
  ]);
});

test("dismissed ledger records may retain task IDs after proposal deletion", () => {
  const dismissed = entry("ma-1", "t-20260701-001");
  dismissed.status = "dropped";
  dismissed.verdict = { verdict: "dismiss", at: "2026-07-02T10:00:00.000Z" };
  assert.deepEqual(auditMeetingLedgerTaskLinks([dismissed], []), []);
});
