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
  joinMeetingNextSteps,
  meetingVaultRelPath,
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
