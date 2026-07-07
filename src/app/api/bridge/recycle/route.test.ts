/**
 * Recycle → v2 minting behavioral spec (v3 unit A5), via direct handler invocation
 * (precedent: src/app/api/bridge/tasks/[id]/route.test.ts). The vault module is mocked onto a
 * temp dir; DATA_DIR is pointed at a second temp dir so the pre-write snapshot is observable.
 *
 * The contract under test — carried-task fidelity is sacred (the first v2 recycle converts the
 * daily driver): the new week gets `list_format: 2` right after `week:`; every carried v1 task
 * becomes a task file (title/due/projects/body, accepted-me, origin.list) + a rendered v2 line;
 * group structure survives; unresolvable content carries VERBATIM; the outgoing file is
 * byte-untouched except the accomplishments write; lists/now/ is snapshotted before any write.
 *
 * Fixtures: `recycle-v2/2026-07-13.md` is a byte-exact copy of the REAL live weekly list
 * (provenance: ~/work/bridge/lists/now/2026-07-13.md, copied 2026-07-07);
 * `recycle-v2/hostile.md` is hand-authored hostility (unicode, mid-title [due::], tab nesting,
 * a stray non-checkbox line between tasks, a whitespace-only title).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  baseDir: "",
  failNextWriteOf: "",
}));

vi.mock("@/lib/bridge/vault", () => ({
  getVaultPath: async () => state.baseDir,
  listVaultDir: async (rel: string) => {
    const full = path.join(state.baseDir, rel);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full).filter((f) => !f.startsWith("."));
  },
  readVaultFile: async (rel: string) => fs.readFileSync(path.join(state.baseDir, rel), "utf-8"),
  writeVaultFileAtomic: async (rel: string, content: string) => {
    if (state.failNextWriteOf && rel.endsWith(state.failNextWriteOf)) {
      state.failNextWriteOf = "";
      throw new Error("simulated write failure");
    }
    const full = path.join(state.baseDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    return full;
  },
}));

import { POST } from "./route";
import { parseWeeklyFile, updateAccomplishments } from "@/lib/bridge/weekly-parser";
import { parseTaskFile } from "@/lib/tasks/task-file";
import type { BridgeTask } from "@/lib/types";

const FIXTURE_DIR = path.join(
  __dirname, "..", "..", "..", "..", "lib", "bridge", "__fixtures__", "recycle-v2",
);
const V2_FIXTURE_DIR = path.join(
  __dirname, "..", "..", "..", "..", "lib", "bridge", "__fixtures__", "weekly-v2",
);
const REAL_WEEK = "2026-07-13.md";
const NEW_WEEK = "2026-07-20";

let dataDir = "";
const savedDataDir = process.env.DATA_DIR;

function seedList(fixturePath: string, asName = REAL_WEEK): string {
  fs.mkdirSync(path.join(state.baseDir, "lists", "now"), { recursive: true });
  const content = fs.readFileSync(fixturePath, "utf-8");
  fs.writeFileSync(path.join(state.baseDir, "lists", "now", asName), content, "utf-8");
  return content;
}

function recycle(body: unknown) {
  return POST(
    new Request("http://localhost/api/bridge/recycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

function newListContent(): string {
  return fs.readFileSync(path.join(state.baseDir, "lists", "now", `${NEW_WEEK}.md`), "utf-8");
}

function outgoingContent(name = REAL_WEEK): string {
  return fs.readFileSync(path.join(state.baseDir, "lists", "now", name), "utf-8");
}

function taskFileAt(taskPath: string) {
  return parseTaskFile(fs.readFileSync(path.join(state.baseDir, taskPath), "utf-8"));
}

function taskFiles(): string[] {
  const dir = path.join(state.baseDir, "tasks");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
}

/** Same trailing-blank trim the carry conversion applies when building bodies. */
function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  return lines.slice(0, end);
}

function expectedBody(src: BridgeTask): string {
  const body = trimTrailingBlanks(src.details).join("\n");
  return body.length > 0 ? `${body}\n` : "\n";
}

beforeEach(() => {
  state.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-recycle-v2-vault-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-recycle-v2-data-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  fs.rmSync(state.baseDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

describe("POST /api/bridge/recycle — v2 mint from the REAL live week (fixture copy)", () => {
  it("carries every incomplete task into a task file + v2 line with full fidelity", async () => {
    const original = seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    const parsed = parseWeeklyFile(original, REAL_WEEK);
    const carried = parsed.tasks.filter((t) => !t.done);
    expect(carried.length).toBeGreaterThan(10); // the real week is substantial

    const res = await recycle({ carry: carried.map((t) => t.id), newWeek: NEW_WEEK });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.filename).toBe(`${NEW_WEEK}.md`);
    expect(json.listFormat).toBe(2);
    expect(json.tasksCreated).toBe(carried.length);
    expect(json.tasksRelinked).toBe(0);
    expect(json.verbatimLines).toBe(0); // the real week converts cleanly

    // list_format: 2 sits IMMEDIATELY after the week: line, post-interpolation.
    const newLines = newListContent().split("\n");
    const weekIdx = newLines.findIndex((l) => l.startsWith("week:"));
    expect(newLines[weekIdx]).toBe(`week: ${NEW_WEEK}`);
    expect(newLines[weekIdx + 1]).toBe("list_format: 2");

    // Line-by-line: every carried task has a task file whose data matches the v1 line's.
    const newParsed = parseWeeklyFile(newListContent(), `${NEW_WEEK}.md`);
    expect(newParsed.listFormat).toBe(2);
    expect(newParsed.tasks).toHaveLength(carried.length);
    for (let i = 0; i < carried.length; i++) {
      const src = carried[i];
      const line = newParsed.tasks[i];
      expect(line.taskPath).toMatch(/^tasks\/t-\d{8}-\d{3}\.md$/);
      expect(line.done).toBe(false); // carried tasks restart unchecked (v1 parity)
      const file = taskFileAt(line.taskPath!);
      expect(file.title).toBe(src.title);
      expect(file.status).toBe("accepted-me");
      expect(file.due).toBe(src.dueDate ?? undefined);
      if (src.projectPaths.length > 0) expect(file.projects).toEqual(src.projectPaths);
      else expect(file.projects).toBeUndefined();
      expect(file.body).toBe(expectedBody(src));
      expect(file.origin).toEqual({ list: `lists/now/${REAL_WEEK}` });
    }

    // Group headings preserved in order (real week: two groups, in this order).
    const content = newListContent();
    const writingIdx = content.indexOf("### Writing & Thought Leadership");
    const agentIdx = content.indexOf("### Agent Infrastructure");
    expect(writingIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeGreaterThan(writingIdx);
    const firstWritingTask = carried.find((t) => t.group === "Writing & Thought Leadership")!;
    expect(content.indexOf(firstWritingTask.title)).toBeGreaterThan(writingIdx);

    // Exactly one task file per carried task; done tasks minted NOTHING.
    expect(taskFiles()).toHaveLength(carried.length);
    const doneTitles = parsed.tasks.filter((t) => t.done).map((t) => t.title);
    for (const name of taskFiles()) {
      const file = taskFileAt(`tasks/${name}`);
      expect(doneTitles).not.toContain(file.title);
    }

    // Outgoing file byte-identical (no accomplishments were sent).
    expect(outgoingContent()).toBe(original);
  });

  it("writes ONLY the accomplishments change to the outgoing file (exact v1 writer bytes)", async () => {
    const original = seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    const parsed = parseWeeklyFile(original, REAL_WEEK);
    const carry = parsed.tasks.filter((t) => !t.done).map((t) => t.id);

    const res = await recycle({ carry, newWeek: NEW_WEEK, accomplishments: "Shipped the v2 recycle." });
    expect(res.status).toBe(200);
    // Byte-verify: the outgoing file equals exactly what the pre-existing accomplishments
    // writer produces on the original bytes — the recycle added no other outgoing change.
    expect(outgoingContent()).toBe(updateAccomplishments(original, "Shipped the v2 recycle."));
  });

  it("snapshots lists/now/ to $DATA_DIR/backups/<date>-recycle-v2/ BEFORE any write", async () => {
    const original = seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    const parsed = parseWeeklyFile(original, REAL_WEEK);
    const res = await recycle({
      carry: parsed.tasks.filter((t) => !t.done).map((t) => t.id),
      newWeek: NEW_WEEK,
      accomplishments: "Mutates the outgoing file.",
    });
    expect(res.status).toBe(200);

    const stamp = new Date().toISOString().slice(0, 10);
    const snapshot = path.join(dataDir, "backups", `${stamp}-recycle-v2`, REAL_WEEK);
    // The snapshot holds the PRE-recycle bytes even though accomplishments mutated the file.
    expect(fs.readFileSync(snapshot, "utf-8")).toBe(original);
    expect(outgoingContent()).not.toBe(original);
  });
});

describe("POST /api/bridge/recycle — hostile fixture", () => {
  it("converts what it can, carries the rest VERBATIM, never drops a line", async () => {
    const original = seedList(path.join(FIXTURE_DIR, "hostile.md"));
    const parsed = parseWeeklyFile(original, REAL_WEEK);
    const carried = parsed.tasks.filter((t) => !t.done);
    const res = await recycle({ carry: carried.map((t) => t.id), newWeek: NEW_WEEK });
    expect(res.status).toBe(200);
    const json = await res.json();

    const content = newListContent();

    // Unicode task: exact title + body in the task file.
    const unicode = carried.find((t) => t.title.includes("ünïcode"))!;
    const newParsed = parseWeeklyFile(content, `${NEW_WEEK}.md`);
    const unicodeLine = newParsed.tasks.find((t) => t.title === unicode.title)!;
    expect(unicodeLine).toBeDefined();
    const unicodeFile = taskFileAt(unicodeLine.taskPath!);
    expect(unicodeFile.title).toBe("Café naïve — ünïcode ✨ task 🚀");
    expect(unicodeFile.body).toBe("- detail with émoji ✅ and 中文字符\n");

    // Mid-title [due::] extracted to frontmatter; tab nesting preserved (one indent stripped).
    const midDue = carried.find((t) => t.dueDate === "2026-07-15")!;
    const midDueLine = newParsed.tasks.find((t) => t.title === midDue.title)!;
    const midDueFile = taskFileAt(midDueLine.taskPath!);
    expect(midDueFile.due).toBe("2026-07-15");
    expect(midDueFile.title).toBe(midDue.title);
    expect(midDueFile.body).toBe(
      "first detail\n\tsecond detail nested with tab\n\t\tthird deeper still\n",
    );

    // Stray non-checkbox line between tasks: carried verbatim.
    expect(content).toContain("stray prose line between tasks, not a checkbox");

    // Whitespace-only title cannot mint a task file → whole block carried verbatim, unreformatted.
    expect(content).toContain("- [ ]  \n\tdetails under a whitespace-title task");
    expect(json.verbatimLines).toBe(3); // stray line + the two whitespace-title block lines

    // Done task does not carry and mints nothing.
    expect(content).not.toContain("Done task that stays behind");
    for (const name of taskFiles()) {
      expect(taskFileAt(`tasks/${name}`).title).not.toBe("Done task that stays behind");
    }

    // Title links become frontmatter projects; the v2 line links ONLY to the task file.
    const linked = carried.find((t) => t.projectPaths.length > 0)!;
    const linkedLine = newParsed.tasks.find((t) => t.title === linked.title)!;
    const linkedFile = taskFileAt(linkedLine.taskPath!);
    expect(linkedFile.projects).toEqual(["projects/alpha", "projects/beta"]);
    expect(linkedFile.due).toBe("2026-07-20");
    expect(content).toContain(
      `- [ ] [${linked.title}](${linkedLine.taskPath}) [due:: 2026-07-20]`,
    );
    expect(content).not.toContain("(projects/alpha)");

    // Group heading preserved before its task.
    const groupIdx = content.indexOf("### Group One");
    expect(groupIdx).toBeGreaterThan(-1);
    expect(content.indexOf("Grouped hostile task")).toBeGreaterThan(groupIdx);
    const grouped = newParsed.tasks.find((t) => t.title === "Grouped hostile task")!;
    expect(taskFileAt(grouped.taskPath!).body).toBe("grouped detail\n");
  });
});

describe("POST /api/bridge/recycle — v2 → v2 (identity preserved)", () => {
  function seedV2Vault(): string {
    const content = seedList(path.join(V2_FIXTURE_DIR, "2026-07-06.md"));
    fs.cpSync(path.join(V2_FIXTURE_DIR, "tasks"), path.join(state.baseDir, "tasks"), {
      recursive: true,
    });
    return content;
  }

  it("relinks existing task files instead of re-minting; missing files carry verbatim", async () => {
    const original = seedV2Vault();
    const before = taskFiles(); // t-…-001, 002, 004
    // carry: task-0 (linked, exists) task-2 (ghost) task-3 (linkless) task-4 (grouped, sub-bullet)
    const res = await recycle({ carry: ["task-0", "task-2", "task-3", "task-4"], newWeek: NEW_WEEK });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tasksRelinked).toBe(2); // task-0 + task-4 keep their files
    expect(json.tasksCreated).toBe(1); // only the linkless line mints a new file

    const content = newListContent();
    // Relinked line re-rendered from the SAME file — no new identity.
    expect(content).toContain(
      "- [ ] [Ship the A3 write-through](tasks/t-20260706-001.md) [due:: 2026-07-10]",
    );
    // Ghost line (file missing) carried verbatim.
    expect(content).toContain(
      "- [ ] [Ghost line whose task file is missing](tasks/t-20260706-003.md)",
    );
    // Grouped relink under its heading, hand-added sub-bullet riding along verbatim.
    const groupIdx = content.indexOf("### Later");
    expect(groupIdx).toBeGreaterThan(-1);
    expect(content.indexOf("Grouped task in progress")).toBeGreaterThan(groupIdx);
    expect(content).toContain("\tDetail line carried on the list (structural indent).");
    // Linkless line minted a real task file.
    const after = taskFiles();
    expect(after.length).toBe(before.length + 1);
    const minted = after.find((f) => !before.includes(f))!;
    expect(taskFileAt(`tasks/${minted}`).title).toBe("Plain line with no task link");
    // Outgoing v2 file byte-untouched.
    expect(outgoingContent()).toBe(original);
  });
});

describe("POST /api/bridge/recycle — template anchors are not trusted", () => {
  it("appends the Tasks section when the template has no ## Tasks anchor", async () => {
    seedList(path.join(FIXTURE_DIR, "hostile.md"));
    fs.mkdirSync(path.join(state.baseDir, "meta", "templates"), { recursive: true });
    fs.writeFileSync(
      path.join(state.baseDir, "meta", "templates", "weekly-list.md"),
      "---\ntype: weekly-list\nweek: {{date:YYYY-MM-DD}}\n---\n\n# Week of {{date:YYYY-MM-DD}}\n",
      "utf-8",
    );
    const parsed = parseWeeklyFile(outgoingContent(), REAL_WEEK);
    const res = await recycle({
      carry: parsed.tasks.filter((t) => !t.done).map((t) => t.id),
      newWeek: NEW_WEEK,
    });
    expect(res.status).toBe(200);
    const content = newListContent();
    const lines = content.split("\n");
    const weekIdx = lines.findIndex((l) => l.startsWith("week:"));
    expect(lines[weekIdx + 1]).toBe("list_format: 2");
    expect(content).toContain("## Tasks\n");
    const newParsed = parseWeeklyFile(content, `${NEW_WEEK}.md`);
    expect(newParsed.listFormat).toBe(2);
    expect(newParsed.tasks.length).toBeGreaterThan(0);
  });
});

describe("POST /api/bridge/recycle — unlisted-orphan sweep (carryUnlisted)", () => {
  function seedV2Vault(): string {
    const content = seedList(path.join(V2_FIXTURE_DIR, "2026-07-06.md"));
    fs.cpSync(path.join(V2_FIXTURE_DIR, "tasks"), path.join(state.baseDir, "tasks"), {
      recursive: true,
    });
    return content;
  }

  /** Hand-write one task file (orphans are files FIRST — no weekly line anywhere). */
  function writeOrphan(id: string, title: string, status: string, dir = "tasks"): void {
    const full = path.join(state.baseDir, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(
      path.join(full, `${id}.md`),
      `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\ncreated_at: '2026-07-01T09:00:00.000Z'\n---\norphan body\n`,
      "utf-8",
    );
  }

  function linkCount(content: string, id: string): number {
    return (content.match(new RegExp(`\\]\\(tasks/${id}\\.md\\)`, "g")) ?? []).length;
  }

  it("carries orphans: me/in-progress after the task block, agent into Ready for agents", async () => {
    seedV2Vault();
    writeOrphan("t-20260701-101", "Orphan me task", "accepted-me");
    writeOrphan("t-20260701-102", "Orphan agent task", "accepted-agent");
    writeOrphan("t-20260701-103", "Orphan in-progress task", "in-progress");
    const before = taskFiles();

    const res = await recycle({
      carry: ["task-0"],
      newWeek: NEW_WEEK,
      carryUnlisted: ["t-20260701-101", "t-20260701-102", "t-20260701-103"],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(3);
    expect(json.skippedUnlisted).toEqual([]);
    expect(json.tasksCreated).toBe(0); // orphan carry is a RELINK — nothing minted
    expect(taskFiles().sort()).toEqual(before.sort());

    const content = newListContent();
    // me/in-progress lines land in ## Tasks, AFTER the carried block; unchecked (not done).
    expect(content).toContain("- [ ] [Orphan me task](tasks/t-20260701-101.md)");
    expect(content).toContain("- [ ] [Orphan in-progress task](tasks/t-20260701-103.md)");
    const carriedIdx = content.indexOf("](tasks/t-20260706-001.md)");
    expect(carriedIdx).toBeGreaterThan(-1);
    expect(content.indexOf("Orphan me task")).toBeGreaterThan(carriedIdx);
    // agent orphan lands under a created "Ready for agents" section.
    const agentHeadingIdx = content.indexOf("### Ready for agents");
    expect(agentHeadingIdx).toBeGreaterThan(content.indexOf("Orphan me task"));
    expect(content.indexOf("[Orphan agent task](tasks/t-20260701-102.md)")).toBeGreaterThan(
      agentHeadingIdx,
    );
    // Everything stays inside the Tasks region (no later ## section in this template, but the
    // lines must be parseable as tasks of the new list).
    const newParsed = parseWeeklyFile(content, `${NEW_WEEK}.md`);
    const titles = newParsed.tasks.map((t) => t.title);
    expect(titles).toContain("Orphan me task");
    expect(titles).toContain("Orphan agent task");
    expect(titles).toContain("Orphan in-progress task");
  });

  it("me-orphans land TOP-LEVEL, never inside the trailing carried group (worst case: Ready for agents)", async () => {
    seedV2Vault();
    // Carry the GROUPED fixture task (### Later) so the carried block ends inside a group.
    writeOrphan("t-20260701-104", "Orphan me task", "accepted-me");
    const res = await recycle({
      carry: ["task-4"], // the "Grouped task in progress" under ### Later
      newWeek: NEW_WEEK,
      carryUnlisted: ["t-20260701-104"],
    });
    expect(res.status).toBe(200);
    const parsed = parseWeeklyFile(newListContent(), `${NEW_WEEK}.md`);
    const orphan = parsed.tasks.find((task) => task.taskPath === "tasks/t-20260701-104.md");
    expect(orphan).toBeTruthy();
    expect(orphan!.group ?? null).toBeNull(); // top-level, not absorbed into "Later"
  });

  it("excludes orphans not named in carryUnlisted (and defaults to none when absent)", async () => {
    seedV2Vault();
    writeOrphan("t-20260701-101", "Orphan me task", "accepted-me");
    writeOrphan("t-20260701-102", "Orphan agent task", "accepted-agent");

    const res = await recycle({
      carry: ["task-0"],
      newWeek: NEW_WEEK,
      carryUnlisted: ["t-20260701-101"], // 102 deliberately unchecked
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(1);
    const content = newListContent();
    expect(content).toContain("](tasks/t-20260701-101.md)");
    expect(content).not.toContain("t-20260701-102");
    expect(content).not.toContain("### Ready for agents");
  });

  it("no carryUnlisted param → no orphan lines, zero counts (v2 and v1 outgoing unchanged)", async () => {
    seedV2Vault();
    writeOrphan("t-20260701-101", "Orphan me task", "accepted-me");
    const res = await recycle({ carry: ["task-0"], newWeek: NEW_WEEK });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(0);
    expect(json.skippedUnlisted).toEqual([]);
    expect(newListContent()).not.toContain("t-20260701-101");
  });

  it("skips + reports dropped/done/proposed/missing ids without failing the recycle", async () => {
    seedV2Vault();
    writeOrphan("t-20260701-101", "Orphan me task", "accepted-me");
    writeOrphan("t-20260701-104", "Dropped orphan", "dropped");
    writeOrphan("t-20260701-105", "Done orphan", "done");
    writeOrphan("t-20260701-106", "Proposal file", "proposed", path.join("tasks", ".proposals"));

    const res = await recycle({
      carry: ["task-0"],
      newWeek: NEW_WEEK,
      carryUnlisted: [
        "t-20260701-101",
        "t-20260701-104",
        "t-20260701-105",
        "t-20260701-106", // exists ONLY in .proposals — must not resolve
        "t-20260701-107", // no file at all
      ],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(1);
    expect(json.skippedUnlisted).toEqual([
      { id: "t-20260701-104", reason: 'status "dropped" is not active' },
      { id: "t-20260701-105", reason: 'status "done" is not active' },
      { id: "t-20260701-106", reason: "no task file in tasks/" },
      { id: "t-20260701-107", reason: "no task file in tasks/" },
    ]);
    const content = newListContent();
    expect(content).toContain("](tasks/t-20260701-101.md)");
    for (const id of ["t-20260701-104", "t-20260701-105", "t-20260701-106", "t-20260701-107"]) {
      expect(content).not.toContain(id);
    }
  });

  it("never duplicates an id already linked in the outgoing list / normal carry", async () => {
    seedV2Vault();
    // t-20260706-001 is LINKED on the outgoing list and carried normally as task-0.
    const res = await recycle({
      carry: ["task-0"],
      newWeek: NEW_WEEK,
      carryUnlisted: ["t-20260706-001"],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(0);
    expect(json.skippedUnlisted).toEqual([
      { id: "t-20260706-001", reason: "already linked in the outgoing list — not an orphan" },
    ]);
    expect(linkCount(newListContent(), "t-20260706-001")).toBe(1);
  });

  it("never duplicates a prior-mint orphan the retry guard already relinked (v1 outgoing)", async () => {
    // v1 outgoing + failed new-list write: files minted, list write died — the mint IS an
    // orphan (active file, no line anywhere). The retry's priorMints reuse relinks it via the
    // normal carry; naming it in carryUnlisted too must not produce a second line.
    seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    state.failNextWriteOf = `${NEW_WEEK}.md`;
    const failed = await recycle({ carry: ["task-0"], newWeek: NEW_WEEK });
    expect(failed.status).toBe(500);
    const orphanIds = taskFiles().map((f) => f.replace(/\.md$/, ""));
    expect(orphanIds).toHaveLength(1);

    const retry = await recycle({
      carry: ["task-0"],
      newWeek: NEW_WEEK,
      carryUnlisted: orphanIds,
    });
    expect(retry.status).toBe(200);
    const json = await retry.json();
    expect(json.carriedUnlisted).toBe(0);
    expect(json.skippedUnlisted).toEqual([
      { id: orphanIds[0], reason: "already carried by the normal carry set" },
    ]);
    expect(linkCount(newListContent(), orphanIds[0])).toBe(1);
  });

  it("rejects traversal and malformed ids (reported, never thrown)", async () => {
    seedV2Vault();
    const res = await recycle({
      carry: ["task-0"],
      newWeek: NEW_WEEK,
      carryUnlisted: ["../../../etc/passwd", "t-20260706-001/../002", "not-an-id", 42],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(0);
    expect(json.skippedUnlisted).toHaveLength(4);
    for (const skipped of json.skippedUnlisted) {
      expect(skipped.reason).toBe("invalid task id");
    }
    expect(newListContent()).not.toContain("passwd");
  });

  it("carries an orphan even when the OUTGOING list is v1 (mirror-failure adds)", async () => {
    // The v1 real week never links task files, so ANY active file is unlisted — the exact
    // pre-splice-era / mirror-failure orphan class this sweep exists for.
    seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    writeOrphan("t-20260701-102", "Orphan agent task", "accepted-agent");
    const parsed = parseWeeklyFile(outgoingContent(), REAL_WEEK);
    const carry = parsed.tasks.filter((t) => !t.done).map((t) => t.id);

    const res = await recycle({ carry, newWeek: NEW_WEEK, carryUnlisted: ["t-20260701-102"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriedUnlisted).toBe(1);
    expect(json.tasksCreated).toBe(carry.length); // v1 conversion untouched by the sweep
    const content = newListContent();
    const headingIdx = content.indexOf("### Ready for agents");
    expect(headingIdx).toBeGreaterThan(-1);
    expect(content.indexOf("[Orphan agent task](tasks/t-20260701-102.md)")).toBeGreaterThan(headingIdx);
  });
});

describe("POST /api/bridge/recycle — rerun guards (adversarial findings)", () => {
  it("refuses to recycle into an existing week (409, nothing written)", async () => {
    seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    const first = await recycle({ carry: ["task-0"], newWeek: NEW_WEEK });
    expect(first.status).toBe(200);
    const filesAfterFirst = taskFiles();
    const listAfterFirst = newListContent();

    const rerun = await recycle({ carry: ["task-0", "task-1"], newWeek: NEW_WEEK });
    expect(rerun.status).toBe(409);
    expect(taskFiles()).toEqual(filesAfterFirst);
    expect(newListContent()).toBe(listAfterFirst);
  });

  it("retry after a failed new-list write reuses prior mints instead of duplicating", async () => {
    seedList(path.join(FIXTURE_DIR, REAL_WEEK));
    // Simulate the partial failure: first attempt minted files but the new-list write died.
    state.failNextWriteOf = `${NEW_WEEK}.md`;
    const failed = await recycle({ carry: ["task-0", "task-1"], newWeek: NEW_WEEK });
    expect(failed.status).toBe(500);
    const orphans = taskFiles();
    expect(orphans.length).toBe(2); // files minted, list write failed

    const retry = await recycle({ carry: ["task-0", "task-1"], newWeek: NEW_WEEK });
    expect(retry.status).toBe(200);
    expect(taskFiles().length).toBe(2); // reused, not re-minted
    // and the new list links exactly those files
    const links = [...newListContent().matchAll(/\(tasks\/(t-[\d-]+)\.md\)/g)].map((m) => m[1]);
    expect(links.sort()).toEqual(orphans.map((f) => f.replace(/\.md$/, "")).sort());
  });
});
