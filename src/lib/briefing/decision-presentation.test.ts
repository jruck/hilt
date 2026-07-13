import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDecisionMeetingGroups,
  decisionDismissedHistory,
  decisionPendingProposals,
  isBriefingActive,
  isDecisionQueueSummary,
} from "./decision-presentation";
import type { TaskFile } from "../tasks/types";

function proposal(id: string, meeting: string, due?: string): TaskFile {
  return {
    id,
    title: `Decision ${id}`,
    status: "proposed",
    origin: { loop: "meeting-actions", meeting, item_id: `ma-${id}` },
    created_at: "2026-07-11T08:00:00.000Z",
    ...(due ? { due } : {}),
    body: "",
  };
}

test("daily and weekend active windows are exact", () => {
  assert.equal(isBriefingActive({ kind: "daily", date: "2026-07-11" }, "2026-07-11"), true);
  assert.equal(isBriefingActive({ kind: "daily", date: "2026-07-10" }, "2026-07-11"), false);
  assert.equal(isBriefingActive({ kind: "weekend", date: "2026-07-11", dateRange: { start: "2026-07-11", end: "2026-07-12" } }, "2026-07-12"), true);
  assert.equal(isBriefingActive({ kind: "weekend", date: "2026-07-04", dateRange: { start: "2026-07-04", end: "2026-07-05" } }, "2026-07-11"), false);
});

test("historical decisions retain stamped membership while the active briefing appends", () => {
  const first = proposal("t-20260711-001", "meetings/2026-07-10/One.md");
  const added = proposal("t-20260711-002", "meetings/2026-07-10/One.md");
  const proposals = [first, added];
  assert.deepEqual(decisionPendingProposals(proposals, new Set([first.id]), false).map((task) => task.id), [first.id]);
  assert.deepEqual(decisionPendingProposals(proposals, new Set([first.id]), true).map((task) => task.id), [first.id, added.id]);
});

test("active decisions expose complete meeting dismissal history while historical membership stays frozen", () => {
  const stamped = { id: "ma-1", task_id: "t-20260711-001" };
  const earlier = { id: "ma-2", task_id: "t-20260711-002" };
  const preTaskHistory = { id: "ma-3" };
  const history = [stamped, earlier, preTaskHistory];
  assert.deepEqual(decisionDismissedHistory(history, new Set([stamped.task_id]), true), history);
  assert.deepEqual(decisionDismissedHistory(history, new Set([stamped.task_id]), false), [stamped]);
});

test("only active briefings append newly represented meeting groups", () => {
  const featured = proposal("t-20260711-001", "meetings/2026-07-10/One.md");
  const added = proposal("t-20260711-002", "meetings/2026-07-11/Two.md", "2026-07-12");
  assert.deepEqual(activeDecisionMeetingGroups([featured, added], new Set([featured.origin!.meeting!]), false), []);
  assert.deepEqual(activeDecisionMeetingGroups([featured, added], new Set([featured.origin!.meeting!]), true).map((group) => group.meeting), [added.origin!.meeting]);
});

test("generated queue summary is recognized without matching arbitrary editorial prose", () => {
  assert.equal(isDecisionQueueSummary("_17 decisions across 9 meetings_"), true);
  assert.equal(isDecisionQueueSummary("Decisions awaiting you need attention"), false);
});
