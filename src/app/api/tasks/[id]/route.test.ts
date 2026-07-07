/**
 * PUT /api/tasks/[id] behavioral spec (v3 unit A2), via direct handler invocation
 * (precedent: src/app/api/reveal/route.test.ts). Focus: the JSON null → undefined
 * (clear-the-key) translation, the transition branch (shared audited path), and the
 * status-in-patch rejection. The vault is a temp dir injected by mocking getVaultPath.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { getVaultPathMock } = vi.hoisted(() => ({
  getVaultPathMock: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/lib/bridge/vault", () => ({
  getVaultPath: getVaultPathMock,
}));

import { GET, PUT } from "./route";
import { createTask, readTask } from "@/lib/tasks/store";

let baseDir: string;

function putRequest(id: string, body: unknown) {
  const request = new Request(`http://localhost/api/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-tasks-route-"));
  getVaultPathMock.mockResolvedValue(baseDir);
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("PUT /api/tasks/[id]", () => {
  it("patches non-status fields and returns the updated task", async () => {
    const task = createTask(baseDir, { title: "Ship A2", body: "plumbing\n" });
    const res = await putRequest(task.id, { title: "Ship A2 (renamed)", due: "2026-07-10" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.store).toBe("tasks");
    expect(json.task.title).toBe("Ship A2 (renamed)");
    expect(json.task.due).toBe("2026-07-10");
    expect(readTask(baseDir, task.id)?.due).toBe("2026-07-10");
  });

  it("translates explicit null into clear-the-key (the lib's undefined convention)", async () => {
    const task = createTask(baseDir, {
      title: "Clear me",
      due: "2026-07-11",
      projects: ["projects/hilt.md"],
    });

    const res = await putRequest(task.id, { due: null, projects: null });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect("due" in json.task).toBe(false);
    expect("projects" in json.task).toBe(false);

    const onDisk = readTask(baseDir, task.id);
    expect(onDisk?.due).toBeUndefined();
    expect(onDisk?.projects).toBeUndefined();
  });

  it("rejects clearing required keys (title/body) with 400", async () => {
    const task = createTask(baseDir, { title: "Keep title" });
    const res = await putRequest(task.id, { title: null });
    expect(res.status).toBe(400);
    expect(readTask(baseDir, task.id)?.title).toBe("Keep title");
  });

  it("rejects status in the patch with a pointer to the transition path", async () => {
    const task = createTask(baseDir, { title: "No direct status" });
    const res = await putRequest(task.id, { status: "done" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("transition");
    expect(readTask(baseDir, task.id)?.status).toBe("accepted-me");
  });

  it("accepts { transition: { to, via } } through the shared audited path", async () => {
    const task = createTask(baseDir, { title: "Transition me" });
    const res = await putRequest(task.id, { transition: { to: "done", via: "test" } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.task.status).toBe("done");
    // The audited path appends a History ledger line — the whole point of the shared route.
    const onDisk = readTask(baseDir, task.id);
    expect(onDisk?.status).toBe("done");
    expect(onDisk?.body).toMatch(/## History/);
    expect(onDisk?.body).toMatch(/status: accepted-me → done \(via test\)/);
  });

  it("maps an illegal transition to 400, not 500", async () => {
    const task = createTask(baseDir, { title: "Illegal hop" });
    const res = await putRequest(task.id, { transition: { to: "proposed", via: "test" } });
    expect(res.status).toBe(400);
    expect(readTask(baseDir, task.id)?.status).toBe("accepted-me");
  });

  it("404s an unknown id and 409s a proposal id", async () => {
    const missing = await putRequest("t-20990101-001", { title: "nope" });
    expect(missing.status).toBe(404);

    const proposal = createTask(baseDir, { title: "Still proposed", status: "proposed" });
    const res = await putRequest(proposal.id, { title: "not editable here" });
    expect(res.status).toBe(409);
  });

  it("rejects unknown patch keys with 400", async () => {
    const task = createTask(baseDir, { title: "Strict keys" });
    const res = await putRequest(task.id, { dueDate: "2026-07-12" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tasks/[id]", () => {
  it("reports which store answered", async () => {
    const accepted = createTask(baseDir, { title: "Accepted" });
    const proposed = createTask(baseDir, { title: "Proposed", status: "proposed" });

    const acceptedRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: accepted.id }),
    });
    expect((await acceptedRes.json()).store).toBe("tasks");

    const proposedRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: proposed.id }),
    });
    expect((await proposedRes.json()).store).toBe("proposals");

    const missingRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "t-20990101-001" }),
    });
    expect(missingRes.status).toBe(404);
  });
});

describe("id validation (path-traversal guard)", () => {
  it("GET rejects a traversal id with 400 before touching the store", async () => {
    const response = await GET(new Request("http://localhost/api/tasks/x"), {
      params: Promise.resolve({ id: "../../../etc/passwd" }),
    });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/invalid task id/);
  });

  it("PUT rejects a traversal id with 400", async () => {
    const response = await putRequest("../../evil", { due: null });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/invalid task id/);
  });
});
