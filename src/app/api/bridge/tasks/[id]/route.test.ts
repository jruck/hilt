/**
 * Weekly-list v2 write-through behavioral spec (v3 unit A3), via direct handler invocation
 * (precedent: src/app/api/tasks/[id]/route.test.ts). The vault module is mocked onto a temp
 * dir seeded from the hand-authored v2 fixture tree (src/lib/bridge/__fixtures__/weekly-v2).
 *
 * The contract under test: task FILE written first (truth), list line mirrored second;
 * mirror failure = warn + success; file failure = error with the list untouched; v1 lists
 * flow through the untouched legacy path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  baseDir: "",
  failNextListWrite: false,
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
    if (state.failNextListWrite && rel.startsWith("lists/")) {
      state.failNextListWrite = false;
      throw new Error("simulated mirror write failure");
    }
    const full = path.join(state.baseDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    return full;
  },
}));

import { DELETE, PUT } from "./route";
import { POST as postTask } from "../route";
import { GET as getWeekly } from "../../weekly/route";
import { listTasks, readTask } from "@/lib/tasks/store";

const FIXTURE_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "lib", "bridge", "__fixtures__", "weekly-v2");
const LIST_REL = "lists/now/2026-07-06.md";

function seedV2Vault() {
  fs.mkdirSync(path.join(state.baseDir, "lists", "now"), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_DIR, "2026-07-06.md"), path.join(state.baseDir, LIST_REL));
  fs.cpSync(path.join(FIXTURE_DIR, "tasks"), path.join(state.baseDir, "tasks"), { recursive: true });
}

function seedV1Vault() {
  fs.mkdirSync(path.join(state.baseDir, "lists", "now"), { recursive: true });
  fs.writeFileSync(
    path.join(state.baseDir, LIST_REL),
    "---\ntype: weekly-list\nweek: 2026-07-06\n---\n\n# Week of 2026-07-06\n\n## Tasks\n- [ ] Legacy task\n\n## Notes\n",
    "utf-8",
  );
}

function listContent(): string {
  return fs.readFileSync(path.join(state.baseDir, LIST_REL), "utf-8");
}

function put(id: string, body: unknown) {
  const request = new Request(`http://localhost/api/bridge/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // NextRequest-compatible enough for the handler (it only reads request.json()).
  return PUT(request as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  state.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-weekly-v2-route-"));
  state.failNextListWrite = false;
});

afterEach(() => {
  fs.rmSync(state.baseDir, { recursive: true, force: true });
});

describe("GET /api/bridge/weekly — v2 hydration", () => {
  it("hydrates v2 lines from task files with additive fields, degrading missing files per-line", async () => {
    seedV2Vault();
    const res = await getWeekly(new NextRequest("http://localhost/api/bridge/weekly"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.listFormat).toBe(2);
    expect(json.tasks).toHaveLength(5);
    const [ship, audit, ghost, plain] = json.tasks;
    expect(ship.taskPath).toBe("tasks/t-20260706-001.md");
    expect(ship.missing).toBe(false);
    expect(ship.title).toBe("Ship the A3 write-through");
    expect(ship.projectPaths).toEqual(["projects/hilt"]); // from file frontmatter
    expect(audit.done).toBe(true);
    expect(ghost.missing).toBe(true); // t-…-003.md does not exist
    expect(ghost.title).toBe("Ghost line whose task file is missing"); // raw line kept
    expect(plain.missing).toBe(true);
  });

  it("keeps the v1 payload backward compatible (listFormat 1, no hydration)", async () => {
    seedV1Vault();
    const res = await getWeekly(new NextRequest("http://localhost/api/bridge/weekly"));
    const json = await res.json();
    expect(json.listFormat).toBe(1);
    expect(json.tasks[0].title).toBe("Legacy task");
    expect(json.tasks[0].missing).toBeUndefined();
  });
});

describe("PUT /api/bridge/tasks/[id] — v2 checkbox write-through", () => {
  it("checking writes the task file FIRST (audited done transition) then mirrors the line", async () => {
    seedV2Vault();
    const res = await put("task-0", { done: true });
    expect(res.status).toBe(200);

    const file = readTask(state.baseDir, "t-20260706-001");
    expect(file?.status).toBe("done"); // accepted-me → done shortcut
    expect(file?.body).toMatch(/status: accepted-me → done \(via weekly-checkbox\)/);

    expect(listContent()).toContain(
      "- [x] [Ship the A3 write-through](tasks/t-20260706-001.md) [due:: 2026-07-10]",
    );
    const json = await res.json();
    expect(json.listFormat).toBe(2);
    expect(json.tasks[0].done).toBe(true);
  });

  it("unchecking reopens: done → in-progress, mirrored as [ ]", async () => {
    seedV2Vault();
    const res = await put("task-1", { done: false });
    expect(res.status).toBe(200);
    const file = readTask(state.baseDir, "t-20260706-002");
    expect(file?.status).toBe("in-progress");
    expect(file?.body).toMatch(/status: done → in-progress \(via weekly-checkbox\)/);
    expect(listContent()).toContain("- [ ] [Close out the data audit](tasks/t-20260706-002.md)");
  });

  it("mirror failure is cosmetic: warn + success, file already transitioned", async () => {
    seedV2Vault();
    const before = listContent();
    state.failNextListWrite = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await put("task-0", { done: true });
    warn.mockRestore();

    expect(res.status).toBe(200); // still success — the truth landed
    expect((await res.json()).mirrorFailed).toBe(true);
    expect(readTask(state.baseDir, "t-20260706-001")?.status).toBe("done");
    expect(listContent()).toBe(before); // list untouched; self-heals on next hydrated read
  });

  it("missing task file = error, list untouched (never list-first)", async () => {
    seedV2Vault();
    const before = listContent();
    const res = await put("task-2", { done: true }); // ghost line
    expect(res.status).toBe(404);
    expect(listContent()).toBe(before);
  });

  it("a linkless line is rejected with 409, list untouched", async () => {
    seedV2Vault();
    const before = listContent();
    const res = await put("task-3", { done: true });
    expect(res.status).toBe(409);
    expect(listContent()).toBe(before);
  });

  it("checking a proposed-status task is an illegal transition → 409, nothing written", async () => {
    seedV2Vault();
    fs.writeFileSync(
      path.join(state.baseDir, "tasks", "t-20260706-005.md"),
      "---\nid: t-20260706-005\ntitle: Still proposed\nstatus: proposed\ncreated_at: '2026-07-06T12:00:00.000Z'\n---\n",
      "utf-8",
    );
    fs.appendFileSync(
      path.join(state.baseDir, LIST_REL),
      "- [ ] [Still proposed](tasks/t-20260706-005.md)\n",
    );
    const res = await put("task-5", { done: true });
    expect(res.status).toBe(409);
    expect(readTask(state.baseDir, "t-20260706-005")?.status).toBe("proposed");
  });
});

describe("PUT /api/bridge/tasks/[id] — v2 title/due/details/projects", () => {
  it("title edit lands in the file then re-renders the line (link + due preserved)", async () => {
    seedV2Vault();
    const res = await put("task-0", { title: "Ship it already" });
    expect(res.status).toBe(200);
    expect(readTask(state.baseDir, "t-20260706-001")?.title).toBe("Ship it already");
    expect(listContent()).toContain(
      "- [ ] [Ship it already](tasks/t-20260706-001.md) [due:: 2026-07-10]",
    );
  });

  it("due edit re-renders the badge; clearing removes it", async () => {
    seedV2Vault();
    await put("task-0", { dueDate: "2026-07-14" });
    expect(readTask(state.baseDir, "t-20260706-001")?.due).toBe("2026-07-14");
    expect(listContent()).toContain("(tasks/t-20260706-001.md) [due:: 2026-07-14]");

    await put("task-0", { dueDate: null });
    expect(readTask(state.baseDir, "t-20260706-001")?.due).toBeUndefined();
    expect(listContent()).toContain("- [ ] [Ship the A3 write-through](tasks/t-20260706-001.md)\n");
    expect(listContent()).not.toContain("t-20260706-001.md) [due::");
  });

  it("rejects a malformed due date with 400 before any write", async () => {
    seedV2Vault();
    const before = listContent();
    const res = await put("task-0", { dueDate: "2026-02-30" });
    expect(res.status).toBe(400);
    expect(listContent()).toBe(before);
    expect(readTask(state.baseDir, "t-20260706-001")?.due).toBe("2026-07-10");
  });

  it("details edits write the task file body ONLY — the weekly file is byte-untouched", async () => {
    seedV2Vault();
    const before = listContent();
    const res = await put("task-0", { details: ["new body line", "second"] });
    expect(res.status).toBe(200);
    expect(readTask(state.baseDir, "t-20260706-001")?.body).toBe("new body line\nsecond\n");
    expect(listContent()).toBe(before);
  });

  it("project edits write task frontmatter ONLY — the v2 line carries no project links", async () => {
    seedV2Vault();
    const before = listContent();
    await put("task-0", { projectPaths: ["projects/other", "projects/hilt"] });
    expect(readTask(state.baseDir, "t-20260706-001")?.projects).toEqual([
      "projects/other",
      "projects/hilt",
    ]);
    expect(listContent()).toBe(before);
  });

  it("moveTo reorders the view without touching task files", async () => {
    seedV2Vault();
    const res = await put("task-1", { moveTo: "top" });
    expect(res.status).toBe(200);
    const content = listContent();
    expect(content.indexOf("Close out the data audit")).toBeLessThan(
      content.indexOf("Ship the A3 write-through"),
    );
    // the moved line's bytes are preserved verbatim
    expect(content).toContain("- [x] [Close out the data audit](tasks/t-20260706-002.md)");
  });
});

describe("PUT /api/bridge/tasks/[id] — v1 lists stay on the legacy path", () => {
  it("toggles a v1 task in the list file without creating any task files", async () => {
    seedV1Vault();
    const res = await put("task-0", { done: true });
    expect(res.status).toBe(200);
    expect(listContent()).toContain("- [x] Legacy task");
    expect(fs.existsSync(path.join(state.baseDir, "tasks"))).toBe(false);
    const json = await res.json();
    expect(json.listFormat).toBeUndefined(); // v1 response shape unchanged
  });
});

describe("PUT /api/bridge/tasks/[id] — v2 input validation (truth-store protection)", () => {
  it("empty title → 400, task file untouched", async () => {
    seedV2Vault();
    const res = await put("task-0", { title: "   " });
    expect(res.status).toBe(400);
    expect(readTask(state.baseDir, "t-20260706-001")?.title).toBe("Ship the A3 write-through");
  });

  it("non-string title → 400, nothing written", async () => {
    seedV2Vault();
    const before = listContent();
    const res = await put("task-0", { title: 12345 });
    expect(res.status).toBe(400);
    expect(readTask(state.baseDir, "t-20260706-001")?.title).toBe("Ship the A3 write-through");
    expect(listContent()).toBe(before);
  });

  it("non-string-array details → 400", async () => {
    seedV2Vault();
    const res = await put("task-0", { details: "not an array" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/bridge/tasks — v2 add (file first, surgical line splice)", () => {
  function post(body: unknown) {
    return postTask(
      new Request("http://localhost/api/bridge/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as never,
    );
  }

  it("creates the task FILE (accepted-me) then splices the line at the top of the task section", async () => {
    seedV2Vault();
    const res = await post({ title: "Brand new v2 task" });
    expect(res.status).toBe(200);
    const json = await res.json();

    // File is the truth: born accepted-me in tasks/.
    const created = listTasks(state.baseDir).find((t) => t.title === "Brand new v2 task");
    expect(created).toBeDefined();
    expect(created!.status).toBe("accepted-me");

    // Line: rendered from the file, inserted directly under ## Tasks (v1's insertion spot),
    // before the previously-first task and any ### group heading.
    const content = listContent();
    const line = `- [ ] [Brand new v2 task](tasks/${created!.id}.md)`;
    expect(content).toContain(line);
    expect(content.indexOf("## Tasks")).toBeLessThan(content.indexOf(line));
    expect(content.indexOf(line)).toBeLessThan(content.indexOf("Ship the A3 write-through"));
    expect(content.indexOf(line)).toBeLessThan(content.indexOf("### Later"));

    // Response shape matches the v1 add: the new task, hydrated, at the top (task-0).
    expect(json.task.id).toBe("task-0");
    expect(json.task.taskPath).toBe(`tasks/${created!.id}.md`);
    expect(json.task.title).toBe("Brand new v2 task");
    expect(json.task.missing).toBe(false);
    expect(json.mirrorFailed).toBeUndefined();
  });

  it("mirror write failure: file created, warn + success + mirrorFailed, list untouched", async () => {
    seedV2Vault();
    const before = listContent();
    state.failNextListWrite = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post({ title: "Orphaned but real" });
    warn.mockRestore();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mirrorFailed).toBe(true);
    expect(json.task.title).toBe("Orphaned but real");
    // The task exists (truth); only the mirror line is missing.
    expect(listTasks(state.baseDir).some((t) => t.title === "Orphaned but real")).toBe(true);
    expect(listContent()).toBe(before);
  });

  it("no task-section anchor: file still created, mirrorFailed, list untouched", async () => {
    fs.mkdirSync(path.join(state.baseDir, "lists", "now"), { recursive: true });
    fs.writeFileSync(
      path.join(state.baseDir, LIST_REL),
      "---\ntype: weekly-list\nweek: 2026-07-06\nlist_format: 2\n---\n\n# Week of 2026-07-06\n\n## Notes\nNo tasks section at all.\n",
      "utf-8",
    );
    const before = listContent();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post({ title: "Nowhere to land" });
    warn.mockRestore();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mirrorFailed).toBe(true);
    expect(listTasks(state.baseDir).some((t) => t.title === "Nowhere to land")).toBe(true);
    expect(listContent()).toBe(before);
  });

  it("v1 lists keep the legacy add path — no task files are ever created", async () => {
    seedV1Vault();
    const res = await post({ title: "Another legacy task" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.task.title).toBe("Another legacy task");
    expect(listContent()).toContain("- [ ] Another legacy task");
    expect(fs.existsSync(path.join(state.baseDir, "tasks"))).toBe(false);
  });
});

describe("DELETE /api/bridge/tasks/[id] — v2 (line removed, file keeps the record)", () => {
  function del(id: string) {
    return DELETE(new Request(`http://localhost/api/bridge/tasks/${id}`, { method: "DELETE" }) as never, {
      params: Promise.resolve({ id }),
    });
  }

  it("active task: file transitions to dropped (History line), line removed", async () => {
    seedV2Vault();
    const res = await del("task-0");
    expect(res.status).toBe(200);
    const file = readTask(state.baseDir, "t-20260706-001");
    expect(file?.status).toBe("dropped");
    expect(file?.body).toMatch(/status: accepted-me → dropped \(via weekly-delete\)/);
    expect(listContent()).not.toContain("t-20260706-001");
  });

  it("done task: file stays done (the work happened), line removed", async () => {
    seedV2Vault();
    const res = await del("task-1");
    expect(res.status).toBe(200);
    const file = readTask(state.baseDir, "t-20260706-002");
    expect(file?.status).toBe("done");
    expect(listContent()).not.toContain("t-20260706-002");
  });

  it("line whose task file is missing: line still removed, no crash", async () => {
    seedV2Vault();
    const res = await del("task-2");
    expect(res.status).toBe(200);
    expect(listContent()).not.toContain("t-20260706-003");
  });
});
