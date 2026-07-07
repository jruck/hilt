/**
 * Behavioral spec for task-body sectioning (the file-addressable task pane): the History
 * section splits out read-only and rejoins losslessly for PUT { body }; bodies without a
 * History section pass through untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyEntries, joinTaskBody, splitTaskBody } from "./task-body";
import { applyStatusTransition } from "./status";
import type { TaskFile } from "./types";

test("splitTaskBody: body without History passes through, history null", () => {
  const body = "Do the thing.\n\nSome notes.\n";
  const { content, history } = splitTaskBody(body);
  assert.equal(content, body);
  assert.equal(history, null);
  assert.equal(joinTaskBody(content, history), "Do the thing.\n\nSome notes.\n");
});

test("splitTaskBody: History tail splits out; join round-trips the file", () => {
  const body = "Context paragraph.\n\n## History\n\n- 2026-07-01T10:00:00Z status: proposed → accepted-me (via verdict)\n";
  const { content, history } = splitTaskBody(body);
  assert.equal(content, "Context paragraph.");
  assert.equal(history, "## History\n\n- 2026-07-01T10:00:00Z status: proposed → accepted-me (via verdict)");
  assert.equal(joinTaskBody(content, history), body);
});

test("splitTaskBody: edited content rejoins with the untouched History section", () => {
  const body = "Old notes.\n\n## History\n\n- 2026-07-01T10:00:00Z status: accepted-me → done (via weekly checkbox)\n";
  const { history } = splitTaskBody(body);
  const rejoined = joinTaskBody("New notes.\n\nMore detail.", history);
  assert.equal(rejoined, "New notes.\n\nMore detail.\n\n## History\n\n- 2026-07-01T10:00:00Z status: accepted-me → done (via weekly checkbox)\n");
});

test("splitTaskBody: mid-body History keeps later sections in the editable content", () => {
  const body = "Intro.\n\n## History\n\n- 2026-07-01T10:00:00Z status: proposed → accepted-me (via verdict)\n\n## Plan\n\nStep one.\n";
  const { content, history } = splitTaskBody(body);
  assert.equal(content, "Intro.\n\n## Plan\n\nStep one.\n");
  assert.equal(history, "## History\n\n- 2026-07-01T10:00:00Z status: proposed → accepted-me (via verdict)");
  // Join normalizes History to the tail — content preserved exactly.
  assert.equal(joinTaskBody(content, history), "Intro.\n\n## Plan\n\nStep one.\n\n## History\n\n- 2026-07-01T10:00:00Z status: proposed → accepted-me (via verdict)\n");
});

test("splitTaskBody: History-only body yields empty content", () => {
  const body = "## History\n\n- 2026-07-01T10:00:00Z status: proposed → dropped (via dismiss)\n";
  const { content, history } = splitTaskBody(body);
  assert.equal(content, "");
  assert.equal(joinTaskBody(content, history), body);
});

test("joinTaskBody: empty content, no history → empty body", () => {
  assert.equal(joinTaskBody("", null), "");
});

test("splitTaskBody agrees with applyStatusTransition's History format", () => {
  // The pane must parse what the status machine actually writes — not a hand-rolled fixture.
  const task: TaskFile = {
    id: "t-20260701-001",
    title: "Ship it",
    status: "accepted-me",
    created_at: "2026-07-01T09:00:00Z",
    body: "Work notes.\n",
  };
  const transitioned = applyStatusTransition(task, "done", "weekly checkbox", "2026-07-02T12:00:00Z");
  const { content, history } = splitTaskBody(transitioned.body);
  assert.equal(content, "Work notes.");
  assert.deepEqual(historyEntries(history), [
    "2026-07-02T12:00:00Z status: accepted-me → done (via weekly checkbox)",
  ]);
  assert.equal(joinTaskBody(content, history), transitioned.body);
});

test("historyEntries: null history → empty list", () => {
  assert.deepEqual(historyEntries(null), []);
});
