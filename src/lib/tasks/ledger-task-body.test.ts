import { test } from "node:test";
import assert from "node:assert/strict";
import type { LedgerEntry } from "../loops/meeting-ledger";
import type { TaskFile } from "./types";
import { stripLegacyGeneratedMeetingTaskNotes } from "./ledger-task-body";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "ma-2026-07-08-003",
    action: "Confirm billing path",
    owner: "justin",
    due: "week of 2026-07-14",
    context: "The billing discussion left one integration question open.",
    citations: [],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-08T18:37:26.074Z",
    opened_from: "meetings/2026-07-08/billing.md",
    status_history: [{ at: "2026-07-08T18:37:26.074Z", from: null, to: "open" }],
    sightings: [],
    ...overrides,
  };
}

function task(body: string): TaskFile {
  return {
    id: "t-20260708-003",
    title: "Confirm billing path",
    status: "accepted-me",
    origin: { loop: "meeting-actions", item_id: "ma-2026-07-08-003" },
    created_at: "2026-07-08T18:37:26.074Z",
    body,
  };
}

test("removes exact legacy meeting context and stated due while preserving History", () => {
  const result = stripLegacyGeneratedMeetingTaskNotes(
    task("The billing discussion left one integration question open.\n\nDue (as stated): week of 2026-07-14\n\n## History\n\n- accepted\n"),
    entry(),
  );
  assert.equal(result.changed, true);
  assert.equal(result.task.body, "## History\n\n- accepted\n");
});

test("removes a generated prefix but preserves later user-authored notes", () => {
  const result = stripLegacyGeneratedMeetingTaskNotes(
    task("The billing discussion left one integration question open.\n\nDue (as stated): week of 2026-07-14\n\nCall Michelle before Tuesday.\n"),
    entry(),
  );
  assert.equal(result.task.body, "Call Michelle before Tuesday.\n");
});

test("leaves nonmatching notes untouched", () => {
  const original = task("My own notes about the billing call.\n");
  const result = stripLegacyGeneratedMeetingTaskNotes(original, entry());
  assert.equal(result.changed, false);
  assert.equal(result.task, original);
});

test("does nothing when the ledger has no legacy-generated notes", () => {
  const original = task("## History\n\n- accepted\n");
  const result = stripLegacyGeneratedMeetingTaskNotes(
    original,
    entry({ context: undefined, due: "2026-07-14" }),
  );
  assert.equal(result.changed, false);
  assert.equal(result.task, original);
});
