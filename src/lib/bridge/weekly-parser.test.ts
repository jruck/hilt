import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addTask, parseWeeklyFile, updateNotes } from "./weekly-parser";

const frontmatter = `---
type: weekly-list
week: 2026-05-25
---

# Week of 2026-05-25`;

describe("weekly parser section order", () => {
  it("parses notes before tasks without swallowing the task section", () => {
    const content = `${frontmatter}

## Notes
Remember this first.

## Tasks
- [ ] First task
\tDetail line
`;

    const parsed = parseWeeklyFile(content, "2026-05-25.md");

    assert.deepEqual(parsed.sectionOrder, ["notes", "tasks"]);
    assert.equal(parsed.notes, "Remember this first.");
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].title, "First task");
    assert.deepEqual(parsed.tasks[0].details.filter((line) => line.trim()), ["Detail line"]);
  });

  it("preserves notes-before-tasks order when rebuilding task content", () => {
    const content = `${frontmatter}

## Notes
Start here.

## Tasks
- [ ] Existing task
`;

    const updated = addTask(content, "New task");

    assert.ok(updated.indexOf("## Notes") < updated.indexOf("## Tasks"));
    const parsed = parseWeeklyFile(updated, "2026-05-25.md");
    assert.equal(parsed.notes, "Start here.");
    assert.deepEqual(parsed.tasks.map((task) => task.title), ["New task", "Existing task"]);
  });

  it("preserves legacy tasks-before-notes order when editing old files", () => {
    const content = `${frontmatter}

## Tasks
- [ ] Existing task

## Notes
Old note.
`;

    const updated = updateNotes(content, "Updated old note.");

    assert.ok(updated.indexOf("## Tasks") < updated.indexOf("## Notes"));
    const parsed = parseWeeklyFile(updated, "2026-05-25.md");
    assert.equal(parsed.notes, "Updated old note.");
    assert.equal(parsed.tasks[0].title, "Existing task");
  });
});
