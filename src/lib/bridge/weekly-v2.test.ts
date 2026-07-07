/**
 * Weekly list v2 read-side + view helpers (v3 unit A3): parser surfaces listFormat/taskPath
 * (delegating line parsing to the A1 primitive), hydration overlays task-file truth with
 * per-line degradation, and the surgical line-replacement helper behind the write-through
 * mirror. The v1 golden byte locks live in weekly-goldens.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { addTask, parseWeeklyFile, updateTask } from "./weekly-parser";
import { hydrateWeeklyTasks, removeWeeklyLines, replaceWeeklyLine, taskIdFromTaskPath } from "./weekly-v2-view";
import { listFormatFromFrontmatter } from "@/lib/tasks/weekly-v2";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "weekly-v2");
const LIST = fs.readFileSync(path.join(FIXTURE_DIR, "2026-07-06.md"), "utf-8");

describe("parseWeeklyFile — v2 lists", () => {
  const parsed = parseWeeklyFile(LIST, "2026-07-06.md");

  it("surfaces listFormat 2 from frontmatter and 1 as the default", () => {
    assert.equal(parsed.listFormat, 2);
    const v1 = parseWeeklyFile("---\ntype: weekly-list\nweek: 2026-05-25\n---\n\n## Tasks\n- [ ] A\n", "x.md");
    assert.equal(v1.listFormat, 1);
    assert.equal(v1.tasks[0].taskPath, null);
  });

  it("extracts taskPath as the LAST link target and keeps projectPaths EMPTY", () => {
    const [ship, audit, ghost, plain, grouped] = parsed.tasks;
    assert.equal(parsed.tasks.length, 5);
    assert.equal(ship.title, "Ship the A3 write-through");
    assert.equal(ship.taskPath, "tasks/t-20260706-001.md");
    assert.equal(ship.dueDate, "2026-07-10");
    assert.deepEqual(ship.projectPaths, []); // title-link overload is dead in v2
    assert.equal(ship.projectPath, null);
    assert.equal(audit.done, true);
    assert.equal(audit.taskPath, "tasks/t-20260706-002.md");
    assert.equal(ghost.taskPath, "tasks/t-20260706-003.md");
    assert.equal(plain.title, "Plain line with no task link");
    assert.equal(plain.taskPath, null);
    assert.equal(grouped.group, "Later");
    assert.deepEqual(grouped.details.filter((l) => l.trim()), [
      "Detail line carried on the list (structural indent).",
    ]);
  });
});

describe("hydrateWeeklyTasks — file is truth, per-line degradation", () => {
  const parsed = parseWeeklyFile(LIST, "2026-07-06.md");
  const hydrated = hydrateWeeklyTasks(FIXTURE_DIR, parsed.tasks);

  it("overlays title/done/due/projects from the task file", () => {
    const ship = hydrated[0];
    assert.equal(ship.missing, false);
    assert.equal(ship.title, "Ship the A3 write-through");
    assert.equal(ship.done, false);
    assert.equal(ship.dueDate, "2026-07-10");
    assert.deepEqual(ship.projectPaths, ["projects/hilt"]);
    assert.equal(ship.projectPath, "projects/hilt");
    assert.equal(hydrated[1].done, true); // status: done → checked
    assert.equal(hydrated[4].done, false); // in-progress → unchecked
  });

  it("degrades a missing task file to the raw line + missing: true, never dropping it", () => {
    const ghost = hydrated[2];
    assert.equal(ghost.missing, true);
    assert.equal(ghost.title, "Ghost line whose task file is missing");
    assert.equal(hydrated.length, parsed.tasks.length);
  });

  it("degrades a linkless line to missing: true with its own title", () => {
    assert.equal(hydrated[3].missing, true);
    assert.equal(hydrated[3].title, "Plain line with no task link");
  });

  it("file title wins over a stale line title", () => {
    const stale = LIST.replace("[Ship the A3 write-through]", "[Old stale title]");
    const tasks = hydrateWeeklyTasks(FIXTURE_DIR, parseWeeklyFile(stale, "2026-07-06.md").tasks);
    assert.equal(tasks[0].title, "Ship the A3 write-through");
  });
});

describe("taskIdFromTaskPath", () => {
  it("resolves canonical store paths and rejects everything else", () => {
    assert.equal(taskIdFromTaskPath("tasks/t-20260706-001.md"), "t-20260706-001");
    assert.equal(taskIdFromTaskPath(null), null);
    assert.equal(taskIdFromTaskPath(undefined), null);
    assert.equal(taskIdFromTaskPath("projects/hilt"), null);
    assert.equal(taskIdFromTaskPath("tasks/evil.md"), null); // not a minted id
    assert.equal(taskIdFromTaskPath("tasks/../tasks/t-20260706-001.md"), "t-20260706-001"); // normalizes
    assert.equal(taskIdFromTaskPath("../tasks/t-20260706-001.md"), null); // escapes the vault
    assert.equal(taskIdFromTaskPath("/abs/tasks/t-20260706-001.md"), null);
    assert.equal(taskIdFromTaskPath("tasks/.proposals/t-20260706-001.md"), null); // proposals are not list-linkable
  });
});

describe("replaceWeeklyLine — surgical mirror", () => {
  const expected = "- [ ] [Ship the A3 write-through](tasks/t-20260706-001.md) [due:: 2026-07-10]";

  it("replaces exactly the one line at startLine, leaving every other byte untouched", () => {
    const parsed = parseWeeklyFile(LIST, "2026-07-06.md");
    const task = parsed.tasks[0];
    const replaced = replaceWeeklyLine(LIST, task.startLine, task.rawLines[0], "- [x] REPLACED");
    assert.ok(replaced);
    const before = LIST.split("\n");
    const after = replaced!.split("\n");
    assert.equal(after.length, before.length);
    const diffs = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null);
    assert.deepEqual(diffs, [task.startLine! - 1]);
    assert.equal(after[task.startLine! - 1], "- [x] REPLACED");
  });

  it("falls back to a unique whole-line search when startLine is stale", () => {
    const replaced = replaceWeeklyLine(LIST, 99, expected, "- [x] FOUND");
    assert.ok(replaced && replaced.includes("- [x] FOUND"));
  });

  it("returns null (mirror failure, not corruption) when the line cannot be located", () => {
    assert.equal(replaceWeeklyLine(LIST, 99, "- [ ] never existed", "- [x] nope"), null);
    const ambiguous = "- [ ] dup\n- [ ] dup\n";
    assert.equal(replaceWeeklyLine(ambiguous, 99, "- [ ] dup", "- [x] dup"), null);
  });
});

describe("v1 serializers refuse v2 lists (corruption guard)", () => {
  it("updateTask and addTask throw on list_format: 2 content", () => {
    assert.throws(() => updateTask(LIST, "task-0", { done: true }), /list_format: 2/);
    assert.throws(() => addTask(LIST, "New task"), /list_format: 2/);
  });
});

describe("hydration against a broken vault", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-weekly-v2-"));
    fs.cpSync(FIXTURE_DIR, tmp, { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("an unparseable task file degrades that line only", () => {
    fs.writeFileSync(path.join(tmp, "tasks", "t-20260706-001.md"), "not: [valid frontmatter", "utf-8");
    const parsed = parseWeeklyFile(LIST, "2026-07-06.md");
    const hydrated = hydrateWeeklyTasks(tmp, parsed.tasks);
    assert.equal(hydrated[0].missing, true);
    assert.equal(hydrated[0].title, "Ship the A3 write-through"); // raw line's own title
    assert.equal(hydrated[1].missing, false); // neighbors unaffected
  });
});

describe("v2 marker robustness + line removal", () => {
  it("quoted list_format keys v2 (the bridge fm parser keeps YAML quote chars)", () => {
    assert.equal(listFormatFromFrontmatter({ list_format: '"2"' }), 2);
    assert.equal(listFormatFromFrontmatter({ list_format: "'2'" }), 2);
    assert.equal(listFormatFromFrontmatter({ list_format: 2 }), 2);
    assert.equal(listFormatFromFrontmatter({ list_format: '"1"' }), 1);
    assert.equal(listFormatFromFrontmatter({}), 1);
  });

  it("removeWeeklyLines removes the task line plus consecutive sub-lines", () => {
    const content = "## Tasks\n- [ ] [A](tasks/t-20260706-001.md)\n  - hand note\n- [ ] [B](tasks/t-20260706-002.md)\n";
    const out = removeWeeklyLines(content, 2, ["- [ ] [A](tasks/t-20260706-001.md)", "  - hand note"]);
    assert.equal(out, "## Tasks\n- [ ] [B](tasks/t-20260706-002.md)\n");
  });

  it("removeWeeklyLines returns null when the line cannot be located unambiguously", () => {
    const dup = "- [ ] [A](tasks/t-20260706-001.md)\n- [ ] [A](tasks/t-20260706-001.md)\n";
    assert.equal(removeWeeklyLines(dup, 9, ["- [ ] [A](tasks/t-20260706-001.md)"]), null);
    assert.equal(removeWeeklyLines("nothing here\n", 1, ["- [ ] [gone](tasks/t-20260706-009.md)"]), null);
  });
});
