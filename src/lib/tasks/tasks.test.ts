/**
 * Behavioral spec for the task-object core lib (v3 unit A1): round-trip byte fidelity,
 * the status machine, approve=rename / dismiss=unlink / revise-in-place semantics,
 * id minting across both dirs, weekly-v2 line helpers, and hydrate degradation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskFile, TaskStatus } from "./types";
import { TASK_STATUSES } from "./types";
import { parseTaskFile, serializeTaskFile } from "./task-file";
import { mintTaskId } from "./ids";
import { applyStatusTransition, canTransition, TASK_TRANSITIONS } from "./status";
import {
  createTask,
  listTasks,
  proposalPath,
  readTask,
  taskPath,
  tasksDir,
  transitionTask,
  updateTask,
  writeTask,
} from "./store";
import {
  approveProposal,
  dismissProposal,
  listProposals,
  readProposal,
  reviseProposal,
} from "./proposals";
import {
  listFormatFromFrontmatter,
  mirrorCheckbox,
  parseWeeklyV2Line,
  renderWeeklyV2Line,
} from "./weekly-v2";
import { hydrateWeeklyV2Line, hydrateWeeklyV2Lines } from "./hydrate";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-tasks-"));
}

const FULL_TASK: TaskFile = {
  id: "t-20260707-001",
  title: "Send Sarah the pricing sheet: v2 (don't forget the addendum)",
  status: "proposed",
  due: "2026-07-10",
  projects: ["projects/floyds.md", "projects/pricing.md"],
  origin: {
    loop: "meeting-actions",
    meeting: "meetings/2026-07-05/floyds.md",
    item_id: "ma-2026-07-05-002",
  },
  created_at: "2026-07-07T09:00:00.000Z",
  provenance: {
    quote: "I'll get you pricing before Thursday — promise",
    source: "meetings/2026-07-05/floyds.md",
  },
  extra: {
    custom_key: "keep me",
    review: { nested: true, tags: ["a", "b"] },
  },
  // Odd body markdown: irregular spacing, mixed bullets, indented block, trailing section
  body: [
    "Context collected   up front — weird   spacing preserved.",
    "",
    "* star bullet",
    "  - nested dash",
    "",
    "      indented code-ish block",
    "",
    "## Links",
    "",
    "- [pricing sheet](https://example.com/x?a=1&b=2)",
    "",
  ].join("\n"),
};

// ── Round-trip byte fidelity ──────────────────────────────────────────────────────────────────

test("parse(serialize(x)) === x for a maximal task (unknown keys + odd body)", () => {
  const text = serializeTaskFile(FULL_TASK);
  assert.deepEqual(parseTaskFile(text), FULL_TASK);
});

test("serialize(parse(text)) === text for files we wrote (byte fidelity)", () => {
  const text = serializeTaskFile(FULL_TASK);
  assert.equal(serializeTaskFile(parseTaskFile(text)), text);
  // stability: a second pass is byte-identical too
  const again = serializeTaskFile(parseTaskFile(serializeTaskFile(parseTaskFile(text))));
  assert.equal(again, text);
});

test("minimal task round-trips (no optional keys)", () => {
  const minimal: TaskFile = {
    id: "t-20260707-002",
    title: "Tiny",
    status: "accepted-me",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "Just a body.\n",
  };
  const text = serializeTaskFile(minimal);
  assert.deepEqual(parseTaskFile(text), minimal);
  assert.equal(serializeTaskFile(parseTaskFile(text)), text);
});

test("unknown frontmatter keys from a hand-written file survive parse → serialize", () => {
  const handWritten = [
    "---",
    "id: t-20260707-003",
    "title: Hand-written",
    "status: proposed",
    "created_at: '2026-07-07T09:00:00.000Z'",
    "somebody_elses_key: still here",
    "priority: 3",
    "---",
    "Body stays put.",
    "",
  ].join("\n");
  const task = parseTaskFile(handWritten);
  assert.equal(task.extra?.somebody_elses_key, "still here");
  assert.equal(task.extra?.priority, 3);
  const out = serializeTaskFile(task);
  assert.ok(out.includes("somebody_elses_key: still here"));
  assert.ok(out.includes("priority: 3"));
  assert.ok(out.includes("Body stays put.\n"));
});

test("parse rejects files without task identity", () => {
  assert.throws(() => parseTaskFile("---\ntitle: no id\nstatus: done\ncreated_at: x\n---\nbody\n"), /missing frontmatter id/);
  assert.throws(() => parseTaskFile("---\nid: t-1\ntitle: bad\nstatus: nonsense\ncreated_at: x\n---\n"), /invalid status/);
});

// ── Status machine ────────────────────────────────────────────────────────────────────────────

test("legal transition chain appends history lines in order under ## History", () => {
  let task: TaskFile = {
    id: "t-20260707-004",
    title: "Lifecycle",
    status: "proposed",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "Some context.\n",
  };
  task = applyStatusTransition(task, "accepted-me", "briefing verdict", "2026-07-07T10:00:00.000Z");
  task = applyStatusTransition(task, "in-progress", "checkbox", "2026-07-07T11:00:00.000Z");
  task = applyStatusTransition(task, "done", "checkbox", "2026-07-07T12:00:00.000Z");
  task = applyStatusTransition(task, "in-progress", "checkbox uncheck", "2026-07-07T13:00:00.000Z");
  assert.equal(task.status, "in-progress");
  const historyIdx = task.body.indexOf("## History");
  assert.ok(historyIdx > 0);
  assert.ok(task.body.startsWith("Some context.\n"));
  const lines = task.body.slice(historyIdx).split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(lines, [
    "- 2026-07-07T10:00:00.000Z status: proposed → accepted-me (via briefing verdict)",
    "- 2026-07-07T11:00:00.000Z status: accepted-me → in-progress (via checkbox)",
    "- 2026-07-07T12:00:00.000Z status: in-progress → done (via checkbox)",
    "- 2026-07-07T13:00:00.000Z status: done → in-progress (via checkbox uncheck)",
  ]);
});

test("history lands inside an existing ## History section, not after later sections", () => {
  const task: TaskFile = {
    id: "t-20260707-005",
    title: "History placement",
    status: "accepted-me",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "Intro.\n\n## History\n\n- 2026-07-06T09:00:00.000Z status: proposed → accepted-me (via verdict)\n\n## Notes\n\nKeep me last.\n",
  };
  const updated = applyStatusTransition(task, "done", "checkbox", "2026-07-07T10:00:00.000Z");
  const historyIdx = updated.body.indexOf("## History");
  const newLineIdx = updated.body.indexOf("status: accepted-me → done");
  const notesIdx = updated.body.indexOf("## Notes");
  assert.ok(historyIdx < newLineIdx && newLineIdx < notesIdx);
  assert.ok(updated.body.endsWith("Keep me last.\n"));
});

test("illegal transitions throw and leave the task untouched", () => {
  const proposed: TaskFile = {
    id: "t-20260707-006",
    title: "Illegal",
    status: "proposed",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "",
  };
  assert.throws(() => applyStatusTransition(proposed, "done", "x"), /illegal task status transition/);
  assert.throws(() => applyStatusTransition(proposed, "in-progress", "x"), /illegal/);
  assert.throws(() => applyStatusTransition({ ...proposed, status: "dropped" }, "in-progress", "x"), /illegal/);
  assert.throws(() => applyStatusTransition({ ...proposed, status: "done" }, "accepted-me", "x"), /illegal/);
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.body, "");
  assert.equal(canTransition("done", "in-progress"), true);
  assert.equal(canTransition("dropped", "done"), false);
});

// ── Store CRUD ────────────────────────────────────────────────────────────────────────────────

test("createTask writes accepted tasks to tasks/ and proposals to tasks/.proposals/", () => {
  const dir = tmpdir();
  const accepted = createTask(dir, { title: "Accepted", created_at: "2026-07-07T09:00:00.000Z" });
  const proposal = createTask(dir, {
    title: "Proposed",
    status: "proposed",
    created_at: "2026-07-07T09:05:00.000Z",
    provenance: { quote: "do the thing", source: "meetings/2026-07-07/standup.md" },
  });
  assert.ok(fs.existsSync(taskPath(dir, accepted.id)));
  assert.ok(fs.existsSync(proposalPath(dir, proposal.id)));
  assert.equal(readTask(dir, accepted.id)?.title, "Accepted");
  // proposals are invisible to the accepted-task store
  assert.equal(readTask(dir, proposal.id), null);
  assert.deepEqual(listTasks(dir).map((t) => t.id), [accepted.id]);
  assert.deepEqual(listProposals(dir).map((t) => t.id), [proposal.id]);
});

test("updateTask patches fields, clears via undefined, and round-trips through disk", () => {
  const dir = tmpdir();
  const task = createTask(dir, {
    title: "Patch me",
    due: "2026-07-11",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "Original body.\n",
  });
  const updated = updateTask(dir, task.id, { title: "Patched", due: undefined, body: "New body." });
  assert.equal(updated.title, "Patched");
  assert.equal(updated.due, undefined);
  assert.ok(!("due" in updated));
  const reread = readTask(dir, task.id);
  assert.deepEqual(reread, updated);
  assert.equal(reread?.body, "New body.\n");
  assert.throws(() => updateTask(dir, "t-19990101-001", { title: "nope" }), /task not found/);
});

test("writeTask + readTask are byte-stable on disk", () => {
  const dir = tmpdir();
  writeTask(dir, FULL_TASK);
  const first = fs.readFileSync(taskPath(dir, FULL_TASK.id), "utf-8");
  writeTask(dir, readTask(dir, FULL_TASK.id)!);
  const second = fs.readFileSync(taskPath(dir, FULL_TASK.id), "utf-8");
  assert.equal(second, first);
});

// ── Id minting ────────────────────────────────────────────────────────────────────────────────

test("mintTaskId collision-checks across BOTH tasks/ and tasks/.proposals/", () => {
  const dir = tmpdir();
  assert.equal(mintTaskId(dir, "2026-07-07"), "t-20260707-001");
  createTask(dir, { title: "One", created_at: "2026-07-07T08:00:00.000Z" });
  createTask(dir, { title: "Two", status: "proposed", created_at: "2026-07-07T08:01:00.000Z" });
  // 001 taken in tasks/, 002 taken in .proposals/ → next is 003
  assert.equal(mintTaskId(dir, "2026-07-07"), "t-20260707-003");
  // different date starts its own sequence
  assert.equal(mintTaskId(dir, "2026-07-08"), "t-20260708-001");
  assert.equal(mintTaskId(dir, new Date("2026-07-09T12:00:00Z")), "t-20260709-001");
});

// ── Proposal lifecycle ────────────────────────────────────────────────────────────────────────

test("approveProposal = status transition + rename into tasks/ (id stable, history appended)", () => {
  const dir = tmpdir();
  const proposal = createTask(dir, {
    title: "Approve me",
    status: "proposed",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "Evidence and context.\n",
  });
  const approved = approveProposal(dir, proposal.id, {
    status: "accepted-me",
    via: "briefing verdict",
    at: "2026-07-07T10:00:00.000Z",
  });
  assert.equal(approved.id, proposal.id);
  assert.equal(approved.status, "accepted-me");
  assert.ok(!fs.existsSync(proposalPath(dir, proposal.id)));
  assert.ok(fs.existsSync(taskPath(dir, proposal.id)));
  const onDisk = readTask(dir, proposal.id)!;
  assert.deepEqual(onDisk, approved);
  assert.ok(onDisk.body.includes("## History"));
  assert.ok(onDisk.body.includes("- 2026-07-07T10:00:00.000Z status: proposed → accepted-me (via briefing verdict)"));
});

test("approveProposal supports accepted-agent and rejects missing/duplicate ids", () => {
  const dir = tmpdir();
  const proposal = createTask(dir, { title: "Agent work", status: "proposed", created_at: "2026-07-07T09:00:00.000Z" });
  const approved = approveProposal(dir, proposal.id, { status: "accepted-agent", via: "verdict" });
  assert.equal(approved.status, "accepted-agent");
  assert.throws(() => approveProposal(dir, proposal.id, { status: "accepted-me", via: "verdict" }), /proposal not found/);
  // a colliding file already in tasks/ blocks the rename
  const second = createTask(dir, { title: "Collide", status: "proposed", created_at: "2026-07-07T09:10:00.000Z" });
  fs.copyFileSync(proposalPath(dir, second.id), taskPath(dir, second.id));
  assert.throws(() => approveProposal(dir, second.id, { status: "accepted-me", via: "verdict" }), /already exists/);
});

test("dismissProposal = unlink; second dismiss reports already gone", () => {
  const dir = tmpdir();
  const proposal = createTask(dir, { title: "Dismiss me", status: "proposed", created_at: "2026-07-07T09:00:00.000Z" });
  assert.equal(dismissProposal(dir, proposal.id), true);
  assert.ok(!fs.existsSync(proposalPath(dir, proposal.id)));
  assert.ok(!fs.existsSync(taskPath(dir, proposal.id)));
  assert.equal(dismissProposal(dir, proposal.id), false);
});

test("reviseProposal appends the note and the file stays proposed, in .proposals/", () => {
  const dir = tmpdir();
  const proposal = createTask(dir, {
    title: "Revise me",
    status: "proposed",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "Original context.\n",
  });
  const revised = reviseProposal(dir, proposal.id, "Actually this is two tasks — split it.");
  assert.equal(revised.status, "proposed");
  assert.ok(revised.body.startsWith("Original context.\n"));
  assert.ok(revised.body.endsWith("Actually this is two tasks — split it.\n"));
  assert.ok(fs.existsSync(proposalPath(dir, proposal.id)));
  assert.ok(!fs.existsSync(taskPath(dir, proposal.id)));
  assert.deepEqual(readProposal(dir, proposal.id), revised);
});

// ── Weekly v2 line helpers ────────────────────────────────────────────────────────────────────

test("listFormatFromFrontmatter reads the version marker", () => {
  assert.equal(listFormatFromFrontmatter({ list_format: "2" }), 2);
  assert.equal(listFormatFromFrontmatter({ list_format: 2 }), 2);
  assert.equal(listFormatFromFrontmatter({ week: "2026-07-06" }), 1);
  assert.equal(listFormatFromFrontmatter({ list_format: "1" }), 1);
});

test("parseWeeklyV2Line extracts checked state, title, taskPath, due", () => {
  const line = parseWeeklyV2Line("- [x] [Ship the deck](tasks/t-20260707-001.md) [due:: 2026-07-10]");
  assert.deepEqual(line, {
    raw: "- [x] [Ship the deck](tasks/t-20260707-001.md) [due:: 2026-07-10]",
    checked: true,
    title: "Ship the deck",
    taskPath: "tasks/t-20260707-001.md",
    due: "2026-07-10",
  });
  const bare = parseWeeklyV2Line("- [ ] No link yet");
  assert.deepEqual(bare, { raw: "- [ ] No link yet", checked: false, title: "No link yet", taskPath: null, due: null });
  assert.equal(parseWeeklyV2Line("### Group heading"), null);
  assert.equal(parseWeeklyV2Line("  indented detail"), null);
});

test("renderWeeklyV2Line ↔ parseWeeklyV2Line round-trip", () => {
  const task: TaskFile = {
    id: "t-20260707-007",
    title: "Round trip",
    status: "done",
    due: "2026-07-12",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "",
  };
  const rendered = renderWeeklyV2Line(task, "tasks/t-20260707-007.md");
  assert.equal(rendered, "- [x] [Round trip](tasks/t-20260707-007.md) [due:: 2026-07-12]");
  const parsed = parseWeeklyV2Line(rendered)!;
  assert.equal(parsed.checked, true);
  assert.equal(parsed.title, task.title);
  assert.equal(parsed.taskPath, "tasks/t-20260707-007.md");
  assert.equal(parsed.due, task.due);
  // non-done statuses render unchecked
  const open = renderWeeklyV2Line({ ...task, status: "in-progress", due: undefined }, "tasks/t-20260707-007.md");
  assert.equal(open, "- [ ] [Round trip](tasks/t-20260707-007.md)");
});

test("mirrorCheckbox flips only the checkbox", () => {
  const line = "- [ ] [Ship it](tasks/t-20260707-001.md) [due:: 2026-07-10]";
  assert.equal(mirrorCheckbox(line, true), "- [x] [Ship it](tasks/t-20260707-001.md) [due:: 2026-07-10]");
  assert.equal(mirrorCheckbox(mirrorCheckbox(line, true), false), line);
});

// ── Hydration degradation ─────────────────────────────────────────────────────────────────────

test("hydrateWeeklyV2Line loads the task file for a good line", () => {
  const dir = tmpdir();
  const task = createTask(dir, { title: "Hydrate me", created_at: "2026-07-07T09:00:00.000Z" });
  const line = parseWeeklyV2Line(`- [ ] [Hydrate me](tasks/${task.id}.md)`)!;
  const hydrated = hydrateWeeklyV2Line(dir, line);
  assert.equal(hydrated.missing, false);
  assert.deepEqual(hydrated.task, task);
  assert.equal(hydrated.line, line);
});

test("hydrate degrades per line: missing/corrupt/link-less files never throw, never drop", () => {
  const dir = tmpdir();
  // missing file
  const missingLine = parseWeeklyV2Line("- [ ] [Gone](tasks/t-19990101-001.md)")!;
  const missing = hydrateWeeklyV2Line(dir, missingLine);
  assert.deepEqual(missing, { line: missingLine, missing: true });
  // corrupt file (not a task file at all)
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "t-20260707-001.md"), "not a task file", "utf-8");
  const corruptLine = parseWeeklyV2Line("- [x] [Corrupt](tasks/t-20260707-001.md)")!;
  const corrupt = hydrateWeeklyV2Line(dir, corruptLine);
  assert.equal(corrupt.missing, true);
  assert.equal(corrupt.line.raw, corruptLine.raw);
  // line with no link
  const bare = hydrateWeeklyV2Line(dir, parseWeeklyV2Line("- [ ] Just text")!);
  assert.equal(bare.missing, true);
  assert.equal(bare.line.title, "Just text");
});

// ── Hardening regressions (adversarial review) ────────────────────────────────────────────────

test("body starting with --- (markdown hr) round-trips byte-exact through create/read", () => {
  const dir = tmpdir();
  const body = "---\n\nNotes below a horizontal rule the agent wrote.\n";
  const task = createTask(dir, { title: "HR body", created_at: "2026-07-07T09:00:00.000Z", body });
  const text = fs.readFileSync(taskPath(dir, task.id), "utf-8");
  assert.equal(serializeTaskFile(parseTaskFile(text)), text);
  const back = readTask(dir, task.id)!;
  assert.equal(back.body, body);
  assert.equal(back.extra, undefined);
  // pure serialize path too: deep-equal + byte idempotence
  const hr: TaskFile = { ...back, body: "---\nnot frontmatter\n---\n" };
  assert.deepEqual(parseTaskFile(serializeTaskFile(hr)), hr);
  assert.equal(serializeTaskFile(parseTaskFile(serializeTaskFile(hr))), serializeTaskFile(hr));
});

test("approveProposal preserves an hr-leading proposal body (dest written before src removed)", () => {
  const dir = tmpdir();
  const proposal = createTask(dir, {
    title: "HR proposal",
    status: "proposed",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "---\n\nEvidence below an hr.\n",
  });
  const approved = approveProposal(dir, proposal.id, {
    status: "accepted-me",
    via: "verdict",
    at: "2026-07-07T10:00:00.000Z",
  });
  assert.ok(!fs.existsSync(proposalPath(dir, proposal.id)));
  const onDisk = readTask(dir, proposal.id)!;
  assert.deepEqual(onDisk, approved);
  assert.ok(onDisk.body.startsWith("---\n\nEvidence below an hr."));
  assert.ok(onDisk.body.includes("## History"));
});

test("post-crash duplicate (dest exists, src still proposed): approve throws, both files intact", () => {
  const dir = tmpdir();
  const proposal = createTask(dir, { title: "Dup", status: "proposed", created_at: "2026-07-07T09:00:00.000Z", body: "PROPOSAL\n" });
  // simulate a crash between dest-write and src-unlink under the NEW order
  fs.copyFileSync(proposalPath(dir, proposal.id), taskPath(dir, proposal.id));
  assert.throws(() => approveProposal(dir, proposal.id, { status: "accepted-me", via: "retry" }), /already exists/);
  assert.ok(fs.existsSync(proposalPath(dir, proposal.id)));
  assert.equal(readProposal(dir, proposal.id)?.body, "PROPOSAL\n");
});

test("createTask never clobbers an existing file at the would-be id", () => {
  const dir = tmpdir();
  const planted = path.join(tasksDir(dir), "t-20260707-001.md");
  fs.mkdirSync(tasksDir(dir), { recursive: true });
  fs.writeFileSync(planted, "PRECIOUS — not even a task file\n", "utf-8");
  const task = createTask(dir, { title: "Next id please", created_at: "2026-07-07T09:00:00.000Z" });
  assert.equal(task.id, "t-20260707-002");
  assert.equal(fs.readFileSync(planted, "utf-8"), "PRECIOUS — not even a task file\n");
});

test("createTask re-mints on EEXIST (cross-process mint race)", () => {
  const dir = tmpdir();
  const realWrite = fs.writeFileSync;
  let raced = false;
  // Simulate the other process landing the same id between mint and write: the first write
  // to t-…-001.md finds the winner's file already there (exclusive `wx` must EEXIST, not clobber).
  fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    if (!raced && String(args[0]).endsWith(`${path.sep}t-20260707-001.md`)) {
      raced = true;
      realWrite(
        args[0],
        "---\nid: t-20260707-001\ntitle: winner\nstatus: accepted-me\ncreated_at: '2026-07-07T08:59:00.000Z'\n---\ntheirs\n",
        "utf-8",
      );
    }
    return realWrite(...args);
  }) as typeof fs.writeFileSync;
  try {
    const task = createTask(dir, { title: "loser retries", created_at: "2026-07-07T09:00:00.000Z" });
    assert.equal(raced, true);
    assert.equal(task.id, "t-20260707-002");
  } finally {
    fs.writeFileSync = realWrite;
  }
  assert.equal(readTask(dir, "t-20260707-001")?.title, "winner");
  assert.equal(readTask(dir, "t-20260707-002")?.title, "loser retries");
});

test("createTask rejects empty titles and non-birth statuses", () => {
  const dir = tmpdir();
  assert.throws(() => createTask(dir, { title: "" }), /title must be a non-empty string/);
  assert.throws(() => createTask(dir, { title: "   \n " }), /title must be a non-empty string/);
  assert.throws(() => createTask(dir, { title: "ok", status: "done" as never }), /cannot be created with status "done"/);
  assert.throws(() => createTask(dir, { title: "ok", status: "dropped" as never }), /cannot be created with status/);
  assert.throws(() => createTask(dir, { title: "ok", status: "in-progress" as never }), /cannot be created with status/);
  // nothing was written by any of the rejected calls
  assert.equal(fs.existsSync(tasksDir(dir)), false);
});

test("repeat parses of identical text share no objects (gray-matter cache aliasing)", () => {
  const text = serializeTaskFile(FULL_TASK);
  const a = parseTaskFile(text);
  a.origin!.loop = "MUTATED";
  a.provenance!.quote = "MUTATED";
  (a.extra!.review as Record<string, unknown>).nested = "MUTATED";
  const b = parseTaskFile(text);
  assert.deepEqual(b, FULL_TASK);
});

test("transitionTask: read → transition (history line) → write, throws on missing/illegal", () => {
  const dir = tmpdir();
  const task = createTask(dir, { title: "Move me", created_at: "2026-07-07T09:00:00.000Z", body: "ctx\n" });
  const done = transitionTask(dir, task.id, "done", "checkbox", "2026-07-07T10:00:00.000Z");
  assert.equal(done.status, "done");
  assert.ok(done.body.includes("- 2026-07-07T10:00:00.000Z status: accepted-me → done (via checkbox)"));
  assert.deepEqual(readTask(dir, task.id), done);
  assert.throws(() => transitionTask(dir, "t-19990101-001", "done", "x"), /task not found/);
  assert.throws(() => transitionTask(dir, task.id, "accepted-me", "x"), /illegal/);
});

test("full 6×6 transition matrix: every pair legal-or-throws, table pinned", () => {
  // Deliberately duplicated expectation — a mutation to TASK_TRANSITIONS must fail here.
  const LEGAL: Record<TaskStatus, readonly TaskStatus[]> = {
    proposed: ["accepted-me", "accepted-agent", "dropped"],
    "accepted-me": ["in-progress", "done", "dropped"],
    "accepted-agent": ["in-progress", "done", "dropped"],
    "in-progress": ["done", "dropped"],
    done: ["in-progress"],
    dropped: [],
  };
  assert.deepEqual(TASK_TRANSITIONS, LEGAL);
  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      const legal = LEGAL[from].includes(to);
      assert.equal(canTransition(from, to), legal, `canTransition(${from}, ${to})`);
      const task: TaskFile = { id: "t-1", title: "m", status: from, created_at: "c", body: "" };
      if (legal) {
        assert.equal(applyStatusTransition(task, to, "x").status, to, `${from} → ${to}`);
      } else {
        assert.throws(() => applyStatusTransition(task, to, "x"), /illegal/, `${from} → ${to}`);
      }
    }
  }
});

test("parse rejects missing title and missing created_at", () => {
  assert.throws(() => parseTaskFile("---\nid: t-1\nstatus: done\ncreated_at: x\n---\nb\n"), /missing frontmatter title/);
  assert.throws(() => parseTaskFile("---\nid: t-1\ntitle: t\nstatus: done\n---\nb\n"), /missing frontmatter created_at/);
});

test("foreign edits: unquoted yaml dates coerce to strings, scalar projects coerces to array", () => {
  const hand = [
    "---",
    "id: t-20260707-050",
    "title: hand edited",
    "status: accepted-me",
    "due: 2026-07-04",
    "projects: projects/solo.md",
    "created_at: 2026-06-29",
    "---",
    "b",
    "",
  ].join("\n");
  const task = parseTaskFile(hand);
  assert.equal(task.due, "2026-07-04");
  assert.equal(task.created_at, "2026-06-29T00:00:00.000Z");
  assert.deepEqual(task.projects, ["projects/solo.md"]);
  // and the coerced values survive a rewrite cycle
  assert.deepEqual(parseTaskFile(serializeTaskFile(task)), task);
});

test("history placement is byte-exact (existing section and fresh section)", () => {
  const old = "- 2026-07-06T09:00:00.000Z status: proposed → accepted-me (via verdict)";
  const task: TaskFile = {
    id: "t-1",
    title: "t",
    status: "accepted-me",
    created_at: "2026-07-07T09:00:00.000Z",
    body: `Intro.\n\n## History\n\n${old}\n\n## Notes\n\nKeep me last.\n`,
  };
  const updated = applyStatusTransition(task, "done", "checkbox", "2026-07-07T10:00:00.000Z");
  assert.equal(
    updated.body,
    `Intro.\n\n## History\n\n${old}\n- 2026-07-07T10:00:00.000Z status: accepted-me → done (via checkbox)\n\n## Notes\n\nKeep me last.\n`,
  );
  const fresh = applyStatusTransition({ ...task, body: "Ctx.\n" }, "done", "checkbox", "2026-07-07T10:00:00.000Z");
  assert.equal(fresh.body, "Ctx.\n\n## History\n\n- 2026-07-07T10:00:00.000Z status: accepted-me → done (via checkbox)\n");
});

test("extra key colliding with a known key: known key wins, extra's copy is dropped", () => {
  const task: TaskFile = {
    id: "t-1",
    title: "Real title",
    status: "done",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "b\n",
    extra: { title: "evil override", custom: "kept" },
  };
  const text = serializeTaskFile(task);
  assert.equal(text.match(/^title:/gm)?.length, 1);
  const back = parseTaskFile(text);
  assert.equal(back.title, "Real title");
  assert.deepEqual(back.extra, { custom: "kept" });
});

test("readTaskDir warns and skips corrupt + mismatched-id files, ignores dot-files", () => {
  const dir = tmpdir();
  const good = createTask(dir, { title: "Good", created_at: "2026-07-07T09:00:00.000Z" });
  fs.writeFileSync(path.join(tasksDir(dir), "t-20260707-099.md"), "not a task file at all", "utf-8");
  fs.writeFileSync(path.join(tasksDir(dir), "t-20260707-050.md"), serializeTaskFile({ ...good, id: "t-20260707-777" }), "utf-8");
  fs.writeFileSync(path.join(tasksDir(dir), ".hidden.md"), "junk", "utf-8");
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "));
  try {
    assert.deepEqual(listTasks(dir).map((t) => t.id), [good.id]);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warns.length, 2);
  assert.ok(warns.some((w) => w.includes("t-20260707-099.md") && w.includes("unparseable")));
  assert.ok(warns.some((w) => w.includes("t-20260707-050.md") && w.includes("does not match filename")));
});

test("weekly v2 hostile titles survive render → parse (taskPath from the LAST link)", () => {
  const p = "tasks/t-20260707-001.md";
  const mk = (title: string): TaskFile => ({
    id: "t-20260707-001",
    title,
    status: "accepted-me",
    created_at: "2026-07-07T09:00:00.000Z",
    body: "b\n",
  });
  const cases: [string, string][] = [
    ["Weird ](hack) title", "Weird ](hack) title"],
    ["Fix [urgent] thing", "Fix [urgent] thing"],
    ["See [x](y) for details", "See [x](y) for details"],
    ["Ship [due:: 2026-01-01] cleanup", "Ship  cleanup"], // literal due badge stripped at render
    ["line1\r\nline2", "line1 line2"], // newlines collapse to one space
    ["", "t-20260707-001"], // empty title falls back to the id so the link survives
  ];
  for (const [title, expected] of cases) {
    const line = renderWeeklyV2Line(mk(title), p);
    const parsed = parseWeeklyV2Line(line);
    assert.ok(parsed, `not recognized as a task line: ${JSON.stringify(line)}`);
    assert.equal(parsed.taskPath, p, `taskPath mangled for ${JSON.stringify(title)}: ${JSON.stringify(line)}`);
    assert.equal(parsed.title, expected, `title mangled for ${JSON.stringify(title)}: ${JSON.stringify(line)}`);
    assert.equal(parsed.due, null, `phantom due for ${JSON.stringify(title)}`);
  }
});

test("uppercase [X] counts as checked; mirrorCheckbox normalizes it", () => {
  const parsed = parseWeeklyV2Line("- [X] [T](tasks/t-20260707-001.md)");
  assert.equal(parsed?.checked, true);
  assert.equal(parsed?.taskPath, "tasks/t-20260707-001.md");
  assert.equal(mirrorCheckbox("- [X] [T](tasks/t-20260707-001.md)", false), "- [ ] [T](tasks/t-20260707-001.md)");
});

test("hydrate rejects absolute and .. task paths as missing (vault-relative only)", () => {
  const dir = tmpdir();
  const task = createTask(dir, { title: "Inside", created_at: "2026-07-07T09:00:00.000Z" });
  // absolute path to a file that EXISTS — still refused
  const abs: ReturnType<typeof parseWeeklyV2Line> = {
    raw: `- [ ] [T](${taskPath(dir, task.id)})`,
    checked: false,
    title: "T",
    taskPath: taskPath(dir, task.id),
    due: null,
  };
  assert.deepEqual(hydrateWeeklyV2Line(dir, abs!), { line: abs, missing: true });
  // traversal that would resolve back INTO the vault — still refused
  const traverse = parseWeeklyV2Line(`- [ ] [T](../${path.basename(dir)}/tasks/${task.id}.md)`)!;
  assert.deepEqual(hydrateWeeklyV2Line(dir, traverse), { line: traverse, missing: true });
});

test("hydrateWeeklyV2Lines: N lines in → N out, order preserved", () => {
  const dir = tmpdir();
  const t1 = createTask(dir, { title: "A", created_at: "2026-07-07T09:00:00.000Z" });
  const t2 = createTask(dir, { title: "B", created_at: "2026-07-07T09:01:00.000Z" });
  const lines = [
    parseWeeklyV2Line(`- [ ] [A](tasks/${t1.id}.md)`)!,
    parseWeeklyV2Line("- [ ] [Gone](tasks/t-19990101-001.md)")!,
    parseWeeklyV2Line(`- [x] [B](tasks/${t2.id}.md)`)!,
    parseWeeklyV2Line("- [ ] no link at all")!,
  ];
  const out = hydrateWeeklyV2Lines(dir, lines);
  assert.equal(out.length, lines.length);
  assert.deepEqual(out.map((h) => h.line.raw), lines.map((l) => l.raw));
  assert.deepEqual(out.map((h) => h.missing), [false, true, false, true]);
  assert.equal(out[0].task?.id, t1.id);
  assert.equal(out[2].task?.id, t2.id);
});

test("taskPath/proposalPath reject non-canonical ids (path-traversal guard)", () => {
  const dir = tmpdir();
  for (const evil of ["../../evil", "t-20260707-001/../x", "..", "t-abc", "t-20260707-1", ""]) {
    assert.throws(() => taskPath(dir, evil), /invalid task id/);
    assert.throws(() => proposalPath(dir, evil), /invalid task id/);
  }
  // the canonical shape still passes, including widened sequences
  assert.ok(taskPath(dir, "t-20260707-001").endsWith("t-20260707-001.md"));
  assert.ok(taskPath(dir, "t-20260707-1234").endsWith("t-20260707-1234.md"));
});
