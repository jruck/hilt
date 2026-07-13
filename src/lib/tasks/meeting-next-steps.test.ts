/**
 * Behavioral spec for the meeting "Next steps" join (v3 unit B2): path derivation,
 * origin.meeting joins, ask-citation matching, minted-ask dedupe, and TaskCard shaping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TaskFile } from "./types";
import {
  askMatchesMeeting,
  askToTaskFile,
  filterMeetingDismissed,
  joinMeetingNextSteps,
  meetingVaultRelPath,
  mergeDismissed,
  type DismissedRecord,
  type MeetingAsk,
} from "./meeting-next-steps";

const REL = "meetings/2026-07-06/Design review-2026-07-06 10:00.md";
const VAULT = "/Users/justin/vault";

function makeTask(overrides: Partial<TaskFile>): TaskFile {
  return {
    id: "t-1",
    title: "A task",
    status: "accepted-me",
    created_at: "2026-07-06T10:00:00.000Z",
    body: "",
    ...overrides,
  };
}

function makeAsk(overrides: Partial<MeetingAsk>): MeetingAsk {
  return {
    id: "ma-2026-07-06-001",
    loop: "meeting-actions",
    kind: "action",
    title: "Send the deck",
    citations: [{ source: REL, date: "2026-07-06", anchor: "I'll send the deck" }],
    ...overrides,
  };
}

// ── meetingVaultRelPath ───────────────────────────────────────────────────────────────────────

test("meetingVaultRelPath strips the vault prefix exactly", () => {
  assert.equal(meetingVaultRelPath(`${VAULT}/${REL}`, VAULT), REL);
  assert.equal(meetingVaultRelPath(`${VAULT}/${REL}`, `${VAULT}/`), REL);
});

test("meetingVaultRelPath falls back to the last meetings/ segment", () => {
  assert.equal(meetingVaultRelPath(`/some/other/root/${REL}`, VAULT), REL);
  assert.equal(meetingVaultRelPath(`/some/other/root/${REL}`, undefined), REL);
  // A vault path itself containing "meetings/" must not confuse the fallback.
  assert.equal(meetingVaultRelPath(`/Users/x/meetings/vault/${REL}`, undefined), REL);
});

test("meetingVaultRelPath returns null for missing/unresolvable paths", () => {
  assert.equal(meetingVaultRelPath(undefined, VAULT), null);
  assert.equal(meetingVaultRelPath(null, VAULT), null);
  assert.equal(meetingVaultRelPath("/not/a/meeting/file.md", VAULT), null);
});

// ── askMatchesMeeting ─────────────────────────────────────────────────────────────────────────

test("askMatchesMeeting matches exact sources and sources with locator suffixes", () => {
  assert.equal(askMatchesMeeting(makeAsk({}), REL), true);
  assert.equal(askMatchesMeeting(makeAsk({ citations: [{ source: `${REL} L42` }] }), REL), true);
  assert.equal(askMatchesMeeting(makeAsk({ citations: [{ source: "meetings/2026-07-05/Other.md" }] }), REL), false);
  assert.equal(askMatchesMeeting(makeAsk({ citations: [] }), REL), false);
});

// ── joinMeetingNextSteps ──────────────────────────────────────────────────────────────────────

test("join buckets proposals, unminted asks, and landed tasks for THIS meeting only", () => {
  const proposalHere = makeTask({ id: "p-1", status: "proposed", origin: { loop: "meeting-actions", meeting: REL, item_id: "ma-1" } });
  const proposalElsewhere = makeTask({ id: "p-2", status: "proposed", origin: { loop: "meeting-actions", meeting: "meetings/2026-07-05/Other.md", item_id: "ma-2" } });
  const taskHere = makeTask({ id: "t-1", status: "done", origin: { meeting: REL } });
  const taskNoOrigin = makeTask({ id: "t-2", status: "done" });
  const askHere = makeAsk({ id: "ma-3" });
  const askElsewhere = makeAsk({ id: "ma-4", citations: [{ source: "meetings/2026-07-05/Other.md" }] });

  const result = joinMeetingNextSteps({
    meetingRelPath: REL,
    tasks: [taskHere, taskNoOrigin],
    proposals: [proposalHere, proposalElsewhere],
    escalations: [askHere, askElsewhere],
  });

  assert.deepEqual(result.proposals.map((t) => t.id), ["p-1"]);
  assert.deepEqual(result.unmintedAsks.map((a) => a.id), ["ma-3"]);
  assert.deepEqual(result.tasks.map((t) => t.id), ["t-1"]);
  assert.equal(result.total, 3);
});

test("join dedupes ledger asks already minted as proposals OR accepted tasks", () => {
  const proposal = makeTask({ id: "p-1", status: "proposed", origin: { loop: "meeting-actions", meeting: REL, item_id: "ma-1" } });
  const accepted = makeTask({ id: "t-1", status: "accepted-me", origin: { loop: "meeting-actions", meeting: REL, item_id: "ma-2" } });
  const askMintedAsProposal = makeAsk({ id: "ma-1" });
  const askMintedAsTask = makeAsk({ id: "ma-2" });
  const askUnminted = makeAsk({ id: "ma-3" });

  const result = joinMeetingNextSteps({
    meetingRelPath: REL,
    tasks: [accepted],
    proposals: [proposal],
    escalations: [askMintedAsProposal, askMintedAsTask, askUnminted],
  });

  assert.deepEqual(result.unmintedAsks.map((a) => a.id), ["ma-3"]);
  assert.equal(result.total, 3); // p-1 + t-1 + ma-3
});

test("dedupe key is loop-scoped — the same item_id from another loop still renders", () => {
  const proposal = makeTask({ id: "p-1", status: "proposed", origin: { loop: "other-loop", meeting: REL, item_id: "ma-1" } });
  const ask = makeAsk({ id: "ma-1", loop: "meeting-actions" });

  const result = joinMeetingNextSteps({
    meetingRelPath: REL,
    tasks: [],
    proposals: [proposal],
    escalations: [ask],
  });

  assert.deepEqual(result.unmintedAsks.map((a) => a.id), ["ma-1"]);
});

test("join excludes insights, dropped tasks, and proposed files in the tasks lane", () => {
  const droppedTask = makeTask({ id: "t-1", status: "dropped", origin: { meeting: REL } });
  const agingInsight = makeAsk({ id: "ma-1-aging", kind: "insight" });

  const result = joinMeetingNextSteps({
    meetingRelPath: REL,
    tasks: [droppedTask],
    proposals: [],
    escalations: [agingInsight],
  });

  assert.equal(result.total, 0);
});

test("join with a null meeting path yields nothing (inline notes, unresolvable paths)", () => {
  const result = joinMeetingNextSteps({
    meetingRelPath: null,
    tasks: [makeTask({ origin: { meeting: REL } })],
    proposals: [],
    escalations: [makeAsk({})],
  });
  assert.equal(result.total, 0);
});

test("join drops verdict=dismiss asks from the unminted lane; other verdicts keep their cards", () => {
  const dismissed = makeAsk({ id: "ma-1", verdict: "dismiss" });
  const approved = makeAsk({ id: "ma-2", verdict: "approve" });
  const assigned = makeAsk({ id: "ma-3", verdict: "assign_to_me" });
  const undecided = makeAsk({ id: "ma-4" });

  const result = joinMeetingNextSteps({
    meetingRelPath: REL,
    tasks: [],
    proposals: [],
    escalations: [dismissed, approved, assigned, undecided],
  });

  assert.deepEqual(result.unmintedAsks.map((a) => a.id), ["ma-2", "ma-3", "ma-4"]);
});

// ── filterMeetingDismissed ────────────────────────────────────────────────────────────────────

test("filterMeetingDismissed keeps only records opened FROM this meeting (exact join key)", () => {
  const here = { id: "ma-1", opened_from: REL };
  const elsewhere = { id: "ma-2", opened_from: "meetings/2026-07-05/Other.md" };
  // Exact equality, not containment — a locator-suffixed path is NOT this meeting's key.
  const suffixed = { id: "ma-3", opened_from: `${REL} L42` };

  assert.deepEqual(
    filterMeetingDismissed([here, elsewhere, suffixed], REL).map((x) => x.id),
    ["ma-1"],
  );
});

test("filterMeetingDismissed yields nothing for a null meeting path", () => {
  assert.deepEqual(filterMeetingDismissed([{ id: "ma-1", opened_from: REL }], null), []);
});

// ── mergeDismissed ────────────────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DismissedRecord>): DismissedRecord {
  return {
    id: "ma-2026-07-06-001",
    action: "Send the deck",
    dismissed_at: "2026-07-06T12:00:00.000Z",
    opened_from: REL,
    ...overrides,
  };
}

test("mergeDismissed: limbo-only — a fresh dismiss verdict shows before the ledger stamps it", () => {
  const limbo = makeAsk({ id: "ma-9", title: "Ping legal", verdict: "dismiss" });
  const merged = mergeDismissed([], [limbo], REL);
  assert.deepEqual(merged, [{ id: "ma-9", action: "Ping legal" }]);
  assert.equal(merged[0].dismissed_at, undefined);
});

test("mergeDismissed: ledger-only — records pass through with their timestamps", () => {
  const merged = mergeDismissed([makeRecord({ task_id: "t-20260706-001", note: "Not this week" })], [], REL);
  assert.deepEqual(merged, [
    {
      id: "ma-2026-07-06-001",
      action: "Send the deck",
      dismissed_at: "2026-07-06T12:00:00.000Z",
      task_id: "t-20260706-001",
      note: "Not this week",
    },
  ]);
});

test("mergeDismissed carries a limbo dismissal's recoverable task identity", () => {
  const limbo = makeAsk({ id: "ma-9", title: "Ping legal", task_id: "t-20260706-009", verdict: "dismiss" });
  assert.deepEqual(mergeDismissed([], [limbo], REL), [{
    id: "ma-9",
    action: "Ping legal",
    task_id: "t-20260706-009",
  }]);
});

test("mergeDismissed: both — dedupe by ledger id, the ledger record (real timestamp) wins", () => {
  const record = makeRecord({ id: "ma-1" });
  const sameAskStillInFeed = makeAsk({ id: "ma-1", verdict: "dismiss" });
  const freshLimbo = makeAsk({ id: "ma-2", title: "New dismissal", verdict: "dismiss" });

  const merged = mergeDismissed([record], [sameAskStillInFeed, freshLimbo], REL);
  // Limbo first (dismissed just now; the ledger list is newest-first), no duplicate ma-1.
  assert.deepEqual(merged.map((item) => item.id), ["ma-2", "ma-1"]);
  assert.equal(merged.find((item) => item.id === "ma-1")?.dismissed_at, record.dismissed_at);
});

test("mergeDismissed scopes both sides to the meeting; different meetings are filtered", () => {
  const recordElsewhere = makeRecord({ id: "ma-1", opened_from: "meetings/2026-07-05/Other.md" });
  const limboElsewhere = makeAsk({
    id: "ma-2",
    verdict: "dismiss",
    citations: [{ source: "meetings/2026-07-05/Other.md" }],
  });
  const limboHere = makeAsk({ id: "ma-3", verdict: "dismiss" });

  assert.deepEqual(
    mergeDismissed([recordElsewhere], [limboElsewhere, limboHere], REL).map((item) => item.id),
    ["ma-3"],
  );
});

test("mergeDismissed unscoped (no meetingRel) merges everything; null meetingRel yields nothing", () => {
  const record = makeRecord({ id: "ma-1", opened_from: "meetings/2026-07-05/Other.md" });
  const limbo = makeAsk({ id: "ma-2", verdict: "dismiss" });
  assert.deepEqual(mergeDismissed([record], [limbo]).map((item) => item.id), ["ma-2", "ma-1"]);
  assert.deepEqual(mergeDismissed([record], [limbo], null), []);
});

test("mergeDismissed ignores non-dismiss verdicts, undecided asks, and insights", () => {
  const merged = mergeDismissed(
    [],
    [
      makeAsk({ id: "ma-1", verdict: "approve" }),
      makeAsk({ id: "ma-2" }),
      makeAsk({ id: "ma-3", kind: "insight", verdict: "dismiss" }),
    ],
    REL,
  );
  assert.deepEqual(merged, []);
});

test("mergeDismissed strips the owner prefix from limbo titles (ledger actions never had it)", () => {
  const limbo = makeAsk({ id: "ma-1", title: "[unclear] Chase the invoice", verdict: "dismiss" });
  assert.equal(mergeDismissed([], [limbo], REL)[0].action, "Chase the invoice");
});

// ── askToTaskFile ─────────────────────────────────────────────────────────────────────────────

test("askToTaskFile shapes a ledger ask as a proposed TaskFile with provenance", () => {
  const shaped = askToTaskFile(makeAsk({}), REL);
  assert.equal(shaped.status, "proposed");
  assert.equal(shaped.title, "Send the deck");
  assert.equal(shaped.origin?.loop, "meeting-actions");
  assert.equal(shaped.origin?.item_id, "ma-2026-07-06-001");
  assert.equal(shaped.origin?.meeting, REL);
  assert.deepEqual(shaped.provenance, { quote: "I'll send the deck", source: REL });
});

test("askToTaskFile omits provenance when the citation has no anchor", () => {
  const shaped = askToTaskFile(makeAsk({ citations: [{ source: REL }] }), REL);
  assert.equal(shaped.provenance, undefined);
});
