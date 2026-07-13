import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { getVaultPathMock } = vi.hoisted(() => ({ getVaultPathMock: vi.fn<() => Promise<string>>() }));
vi.mock("@/lib/bridge/vault", () => ({ getVaultPath: getVaultPathMock }));

import { POST } from "./route";
import { readProposal } from "@/lib/tasks/proposals";
import { createTask, readTask } from "@/lib/tasks/store";

let vault: string;

function decide(id: string, body: unknown) {
  return POST(new Request(`http://localhost/api/tasks/${id}/verdict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-task-verdict-"));
  getVaultPathMock.mockResolvedValue(vault);
});

afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

describe("POST /api/tasks/[id]/verdict", () => {
  it("approves a thread proposal and preserves its context", async () => {
    const proposal = createTask(vault, { title: "Follow up", status: "proposed", origin: { thread: "thread-1" }, body: "Why this matters.\n" });
    const response = await decide(proposal.id, { verdict: "approve", note: "Keep the investigation scoped." });
    expect(response.status).toBe(200);
    expect(readProposal(vault, proposal.id)).toBeNull();
    const accepted = readTask(vault, proposal.id);
    expect(accepted?.status).toBe("accepted-me");
    expect(accepted?.body).toContain("Why this matters.");
    expect(accepted?.body).toContain("Decision note: Keep the investigation scoped.");
  });

  it("dismisses a task-native proposal and revises in place", async () => {
    const revised = createTask(vault, { title: "Revise", status: "proposed", origin: { thread: "thread-2" } });
    expect((await decide(revised.id, { verdict: "revise", note: "Split this into two tasks." })).status).toBe(200);
    expect(readProposal(vault, revised.id)?.body).toContain("Split this into two tasks.");
    expect((await decide(revised.id, { verdict: "dismiss" })).status).toBe(200);
    expect(readProposal(vault, revised.id)).toBeNull();
  });

  it("refuses to bypass the loop verdict audit", async () => {
    const proposal = createTask(vault, { title: "Meeting ask", status: "proposed", origin: { loop: "meeting-actions", item_id: "ma-1" } });
    const response = await decide(proposal.id, { verdict: "approve" });
    expect(response.status).toBe(409);
    expect(readProposal(vault, proposal.id)).not.toBeNull();
  });
});
