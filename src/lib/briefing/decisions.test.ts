import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import assert from "node:assert/strict";
import { createTask } from "../tasks/store";
import {
  buildBriefingDecisionQueue,
  collectBriefingDecisionQueue,
  composeBriefingDecisions,
  decisionContextEchoesTaskTitle,
  renderBriefingDecisionPromptData,
  renderBriefingDecisionSection,
  sanitizeBriefingGatherForDecisions,
} from "./decisions";

function proposal(input: {
  id: string;
  title: string;
  meeting: string;
  createdAt: string;
  due?: string;
}) {
  return {
    id: input.id,
    title: input.title,
    status: "proposed",
    created_at: input.createdAt,
    ...(input.due ? { due: input.due } : {}),
    origin: { loop: "meeting-actions", meeting: input.meeting },
    body: "",
  } as const;
}

test("decision queue keeps bounded proposals, canonical sorting, and stored meeting summaries", () => {
  const first = "meetings/2026-07-09/First-2026-07-09 @ 12-00-00.md";
  const second = "meetings/2026-07-10/Second-2026-07-10 @ 12-00-00.md";
  const proposals = [
    proposal({ id: "t-20260710-001", title: "Later item", meeting: second, createdAt: "2026-07-10T12:00:00Z", due: "2026-07-20" }),
    proposal({ id: "t-20260709-001", title: "Urgent item", meeting: first, createdAt: "2026-07-09T12:00:00Z", due: "2026-07-10" }),
    proposal({ id: "t-20260712-001", title: "Future item", meeting: "meetings/2026-07-12/Future.md", createdAt: "2026-07-12T12:00:00Z" }),
    { ...proposal({ id: "t-20260709-002", title: "Other loop", meeting: first, createdAt: "2026-07-09T12:00:00Z" }), origin: { loop: "other", meeting: first } },
  ];
  const queue = buildBriefingDecisionQueue({
    proposals: proposals as never,
    asOf: "2026-07-11",
    meetingSummaries: new Map([[first, "The team narrowed the launch choice and left one owner decision open."]]),
  });

  assert.deepEqual(queue.task_ids, ["t-20260709-001", "t-20260710-001"]);
  assert.equal(queue.groups[0].title, "First");
  assert.equal(queue.groups[0].summary, "The team narrowed the launch choice and left one owner decision open.");
});

test("fallback rendering uses meeting context without duplicating task titles or a body count", () => {
  const meeting = "meetings/2026-07-10/Launch.md";
  const queue = buildBriefingDecisionQueue({
    proposals: [proposal({ id: "t-20260710-001", title: "Choose the launch scope", meeting, createdAt: "2026-07-10T12:00:00Z" })] as never,
    asOf: "2026-07-11",
    meetingSummaries: new Map([[meeting, "The launch path is agreed except for the scope decision that now blocks sequencing."]]),
  });
  const rendered = renderBriefingDecisionSection(queue);

  assert.match(rendered, /The launch path is agreed except for the scope decision/);
  assert.doesNotMatch(rendered, /Choose the launch scope/);
  assert.doesNotMatch(rendered, /decisions? across/i);
  assert.equal(rendered.match(/t-20260710-001/g)?.length, 1);
});

test("task-title echo detection suppresses copied fallback prose but allows genuine meeting context", () => {
  const title = "Package feedback for Derek on the drill-through branch before it can ship";
  assert.equal(decisionContextEchoesTaskTitle("Sprint sequencing is settled; package feedback for Derek on the drill-through branch.", title), true);
  assert.equal(decisionContextEchoesTaskTitle("The review settled the release sequence but left a communication risk unresolved.", title), false);

  const meeting = "meetings/2026-07-10/Launch.md";
  const queue = buildBriefingDecisionQueue({
    proposals: [proposal({ id: "t-20260710-001", title, meeting, createdAt: "2026-07-10T12:00:00Z" })] as never,
    asOf: "2026-07-11",
    meetingSummaries: new Map([[meeting, "The team must package feedback for Derek on the drill-through branch before it can ship."]]),
  });
  const rendered = renderBriefingDecisionSection(queue);
  assert.match(rendered, /meetings\/2026-07-10\/Launch\.md/);
  assert.doesNotMatch(rendered, /package feedback for Derek/i);
});

test("model prompt data supplies meeting context and exact ids without leaking task titles", () => {
  const meeting = "meetings/2026-07-10/Launch.md";
  const queue = buildBriefingDecisionQueue({
    proposals: [proposal({ id: "t-20260710-001", title: "Sensitive title that belongs to the TaskCard", meeting, createdAt: "2026-07-10T12:00:00Z" })] as never,
    asOf: "2026-07-11",
    meetingSummaries: new Map([[meeting, "The team converged on the plan but left one sequencing decision open."]]),
  });
  const promptData = renderBriefingDecisionPromptData(queue);

  assert.match(promptData, /The team converged on the plan/);
  assert.match(promptData, /meetings\/2026-07-10\/Launch\.md/);
  assert.match(promptData, /t-20260710-001/);
  assert.doesNotMatch(promptData, /Sensitive title/);
});

test("gather sanitization removes prior queues and proposal-card escalations but keeps meeting context", () => {
  const gathered = `=== LOOP ARTIFACTS ===
## loop:meeting-actions (phase: shadow) — 2026-07-11.md
## Recent meetings
- Backlog refinement: Sprint sequencing was settled.
## Escalations
- **Package feedback for Derek on the drill-through branch** → task \`t-20260709-007\`
  - *meetings/2026-07-09/Backlog.md, 2026-07-09*
- **A taskless risk signal** — capacity is slipping
  - *meetings/2026-07-09/Standup.md, 2026-07-09*
## Ledger deltas
- Meetings processed: 3
- Open entries: 338
## Loop health
- Status: ok
## PRIOR BRIEFING
## ⏭ Next steps
- Old task prose
  - \`t-20260708-003\`
## 💼 Work & product
- Broad work context remains.
`;
  const sanitized = sanitizeBriefingGatherForDecisions(gathered);
  assert.match(sanitized, /Backlog refinement: Sprint sequencing was settled/);
  assert.match(sanitized, /A taskless risk signal/);
  assert.match(sanitized, /## Loop health/);
  assert.match(sanitized, /Broad work context remains/);
  assert.doesNotMatch(sanitized, /Open entries: 338/);
  assert.doesNotMatch(sanitized, /Package feedback for Derek|Old task prose|t-20260709-007|t-20260708-003/);
});

test("composer preserves model-authored context and ordering while stamping canonical ids", () => {
  const alpha = "meetings/2026-07-09/Alpha.md";
  const beta = "meetings/2026-07-10/Beta.md";
  const queue = buildBriefingDecisionQueue({
    proposals: [
      proposal({ id: "t-20260709-001", title: "Alpha task", meeting: alpha, createdAt: "2026-07-09T12:00:00Z" }),
      proposal({ id: "t-20260710-001", title: "Beta task", meeting: beta, createdAt: "2026-07-10T12:00:00Z" }),
    ] as never,
    asOf: "2026-07-11",
  });
  const output = composeBriefingDecisions(`# Morning Briefing — Friday

## 🧠 Don't drop this
- Deadline.

## ⏭ Next steps
- Alpha's planning conversation established the decision boundary; the remaining choice changes Monday's work.
  - *${alpha}, 2026-07-09*
  - \`t-20260709-001\`
- Beta is newer, but the open call is less consequential and belongs after Alpha today.
  - *${beta}, 2026-07-10*
  - \`t-20260710-001\`

## 💼 Work & product
- Shipped.
`, "daily", queue);

  assert.match(output, /Alpha's planning conversation established the decision boundary/);
  assert.match(output, /Beta is newer, but the open call is less consequential/);
  assert.ok(output.indexOf("Alpha's planning") < output.indexOf("Beta is newer"));
  assert.equal(output.match(/t-20260709-001/g)?.length, 1);
  assert.equal(output.match(/t-20260710-001/g)?.length, 1);
  assert.ok(output.indexOf("## ⏭ Decisions awaiting you") < output.indexOf("## 💼 Work & product"));
});

test("composer appends omitted groups with stored meeting context", () => {
  const featured = "meetings/2026-07-09/Featured.md";
  const omitted = "meetings/2026-07-10/Omitted.md";
  const queue = buildBriefingDecisionQueue({
    proposals: [
      proposal({ id: "t-20260709-001", title: "Featured task", meeting: featured, createdAt: "2026-07-09T12:00:00Z" }),
      proposal({ id: "t-20260710-001", title: "Omitted task title must not leak", meeting: omitted, createdAt: "2026-07-10T12:00:00Z" }),
    ] as never,
    asOf: "2026-07-11",
    meetingSummaries: new Map([[omitted, "A late meeting created a second unresolved choice that was not in the editorial draft."]]),
  });
  const output = composeBriefingDecisions(`# Morning Briefing — Friday

## ⏭ Decisions awaiting you
- The featured meeting left a decision that controls the release sequence.
  - *${featured}, 2026-07-09*
  - \`t-20260709-001\`

## 💼 Work & product
- Work.
`, "daily", queue);

  assert.match(output, /The featured meeting left a decision/);
  assert.match(output, /A late meeting created a second unresolved choice/);
  assert.doesNotMatch(output, /Omitted task title must not leak/);
  assert.ok(output.indexOf("The featured meeting") < output.indexOf("A late meeting"));
});

test("fallback without a stored summary renders only meeting identity and canonical ids", () => {
  const meeting = "meetings/2026-07-10/Launch.md";
  const queue = buildBriefingDecisionQueue({
    proposals: [proposal({ id: "t-20260710-001", title: "A very specific task title", meeting, createdAt: "2026-07-10T12:00:00Z" })] as never,
    asOf: "2026-07-11",
  });
  const rendered = renderBriefingDecisionSection(queue);

  assert.match(rendered, /meetings\/2026-07-10\/Launch\.md/);
  assert.match(rendered, /t-20260710-001/);
  assert.doesNotMatch(rendered, /A very specific task title/);
});

test("composer removes a legacy pending-verdict tail embedded in Work", () => {
  const queue = buildBriefingDecisionQueue({
    proposals: [proposal({ id: "t-20260710-001", title: "Choose the launch scope", meeting: "meetings/2026-07-10/Launch.md", createdAt: "2026-07-10T12:00:00Z" })] as never,
    asOf: "2026-07-11",
  });
  const output = composeBriefingDecisions(`# Weekend Briefing

## 💼 Work & product

- **Hilt** shipped broad briefing improvements.

**Pending verdicts — clear Monday:**

- **Legacy meeting** — choose scope
  - \`t-20260710-001\`

## 📚 Library & knowledge

- Read this.
`, "weekend", queue);
  assert.ok(!output.includes("Pending verdicts"));
  assert.ok(!output.includes("Legacy meeting"));
  assert.equal(output.match(/t-20260710-001/g)?.length, 1);
  assert.ok(output.includes("**Hilt** shipped broad briefing improvements"));
  assert.ok(output.includes("## 📚 Library & knowledge"));
});

test("empty queue removes a model-authored queue without adding a replacement", () => {
  const output = composeBriefingDecisions("# Morning Briefing — Friday\n\n## ⏭ Next steps\n- stale\n\n## 💼 Work & product\n- work\n", "daily", buildBriefingDecisionQueue({ proposals: [], asOf: "2026-07-11" }));
  assert.ok(!output.includes("⏭"));
  assert.ok(output.includes("## 💼 Work & product"));
});

test("collector reads canonical proposals and meeting-actions summary state", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-decision-queue-"));
  try {
    fs.mkdirSync(path.join(vault, "meta", "loops", "meetings", "state"), { recursive: true });
    fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), `loops:
  - id: meeting-actions
    domain: meetings
    cadence: daily
    enabled: true
    phase: live
`, "utf-8");
    fs.writeFileSync(path.join(vault, "meta", "loops", "meetings", "state", "meeting-summaries.json"), JSON.stringify({
      "meetings/2026-07-10/Scope.md": { date: "2026-07-10", summary: "The review aligned on the direction and left scope ownership unresolved." },
    }), "utf-8");
    createTask(vault, { title: "Review scope", status: "proposed", created_at: "2026-07-10T12:00:00Z", origin: { loop: "meeting-actions", meeting: "meetings/2026-07-10/Scope.md", item_id: "ma-1" } });
    createTask(vault, { title: "Future", status: "proposed", created_at: "2026-07-12T12:00:00Z", origin: { loop: "meeting-actions", meeting: "meetings/2026-07-12/Future.md", item_id: "ma-2" } });
    const queue = collectBriefingDecisionQueue(vault, "2026-07-11");
    assert.equal(queue.task_ids.length, 1);
    assert.equal(queue.groups[0].meeting, "meetings/2026-07-10/Scope.md");
    assert.equal(queue.groups[0].summary, "The review aligned on the direction and left scope ownership unresolved.");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
