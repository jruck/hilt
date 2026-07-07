/**
 * POST /api/loops/verdicts file-effect spec (v3 unit A6), via direct handler invocation
 * (precedent: src/app/api/tasks/[id]/route.test.ts). The verdict jsonl append is the unchanged
 * audit trail; these tests pin the ADDITIVE synchronous proposal-file effect: each verdict
 * kind's file semantics, repeat = already-applied, no-file = missing (pre-A6 items and
 * non-vault sinks), and unknown items absorbed exactly as before.
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

import { POST } from "./route";
import { createTask, proposalPath, readTask, taskPath } from "@/lib/tasks/store";
import { listProposals, readProposal } from "@/lib/tasks/proposals";
import { readVerdicts } from "@/lib/loops/stores";
import type { TaskFile } from "@/lib/tasks/types";

let vault: string;

/** Loop is `live` so the verdict store lands inside the temp vault, not the $DATA sandbox. */
const REGISTRY = [
  "loops:",
  "  - id: meeting-actions",
  "    domain: meetings",
  "    cadence: daily",
  "    enabled: true",
  "    phase: live",
  "    proposal_sink: vault",
  "",
].join("\n");

function postVerdict(body: unknown) {
  const request = new Request("http://localhost/api/loops/verdicts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // NextRequest-compatible: the handler only uses request.json().
  return POST(request as never);
}

function mintProposal(itemId: string, overrides: Partial<Parameters<typeof createTask>[1]> = {}): TaskFile {
  return createTask(vault, {
    title: `Proposal for ${itemId}`,
    status: "proposed",
    origin: { loop: "meeting-actions", meeting: "meetings/2026-07-05/floyds.md", item_id: itemId },
    provenance: { quote: "I'll do it", source: "meetings/2026-07-05/floyds.md" },
    ...overrides,
  });
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-verdicts-route-"));
  fs.mkdirSync(path.join(vault, "meta", "loops"), { recursive: true });
  fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), REGISTRY, "utf-8");
  getVaultPathMock.mockResolvedValue(vault);
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

const meetingsHome = () => path.join(vault, "meta", "loops", "meetings");

describe("POST /api/loops/verdicts — proposal file effects", () => {
  it("approve moves the file into tasks/ as accepted-me and reports applied", async () => {
    const proposal = mintProposal("ma-2026-07-05-001");
    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-001", verdict: "approve" });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.file_effect).toBe("applied");
    expect(json.verdict).toBe("approve");

    expect(fs.existsSync(proposalPath(vault, proposal.id))).toBe(false);
    const accepted = readTask(vault, proposal.id);
    expect(accepted?.status).toBe("accepted-me");
    expect(accepted?.body).toMatch(/status: proposed → accepted-me \(via verdict:approve\)/);

    // The audit trail is unchanged: one verdict record appended in the loop home.
    const records = readVerdicts(meetingsHome());
    expect(records).toHaveLength(1);
    expect(records[0].item_id).toBe("ma-2026-07-05-001");
  });

  it("assign_to_me → accepted-me; assign_to_agent → accepted-agent", async () => {
    const mine = mintProposal("ma-2026-07-05-002");
    const agents = mintProposal("ma-2026-07-05-003");

    const mineRes = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-002", verdict: "assign_to_me" });
    expect((await mineRes.json()).file_effect).toBe("applied");
    expect(readTask(vault, mine.id)?.status).toBe("accepted-me");

    const agentRes = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-003", verdict: "assign_to_agent" });
    expect((await agentRes.json()).file_effect).toBe("applied");
    expect(readTask(vault, agents.id)?.status).toBe("accepted-agent");
  });

  it("dismiss deletes the proposal file (the ledger remembers)", async () => {
    const proposal = mintProposal("ma-2026-07-05-004");
    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-004", verdict: "dismiss" });

    expect((await res.json()).file_effect).toBe("applied");
    expect(fs.existsSync(proposalPath(vault, proposal.id))).toBe(false);
    expect(fs.existsSync(taskPath(vault, proposal.id))).toBe(false);
  });

  it("revise appends the note and the file stays proposed in place", async () => {
    const proposal = mintProposal("ma-2026-07-05-005");
    const res = await postVerdict({
      loop: "meeting-actions", item_id: "ma-2026-07-05-005", verdict: "revise",
      note: "Split this into two tasks",
    });

    expect((await res.json()).file_effect).toBe("applied");
    const onDisk = readProposal(vault, proposal.id);
    expect(onDisk?.status).toBe("proposed");
    expect(onDisk?.body).toContain("Split this into two tasks");
    expect(fs.existsSync(taskPath(vault, proposal.id))).toBe(false);
  });

  it("repeat verdict = already-applied (the file already moved), idempotent", async () => {
    mintProposal("ma-2026-07-05-006");
    const first = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-006", verdict: "approve" });
    expect((await first.json()).file_effect).toBe("applied");

    const second = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-006", verdict: "approve" });
    expect(second.status).toBe(201);
    expect((await second.json()).file_effect).toBe("already-applied");

    // Both decisions are on the audit trail; the proposal store stays empty.
    expect(readVerdicts(meetingsHome())).toHaveLength(2);
    expect(listProposals(vault)).toHaveLength(0);
  });

  it("no proposal file = missing, still 201 (pre-A6 items / non-vault sinks)", async () => {
    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-01-01-001", verdict: "approve" });
    expect(res.status).toBe(201);
    expect((await res.json()).file_effect).toBe("missing");
    // Unknown item absorbed exactly as before: the verdict record still lands.
    expect(readVerdicts(meetingsHome())).toHaveLength(1);
  });

  it("only matches proposals minted by the SAME loop (origin.loop join)", async () => {
    const foreign = createTask(vault, {
      title: "Someone else's proposal",
      status: "proposed",
      origin: { loop: "goals-areas", item_id: "ma-2026-07-05-007" },
    });
    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-007", verdict: "dismiss" });
    expect((await res.json()).file_effect).toBe("missing");
    expect(fs.existsSync(proposalPath(vault, foreign.id))).toBe(true);
  });

  it("keeps the existing validation behavior (revise requires note; unknown loop 404s)", async () => {
    const noNote = await postVerdict({ loop: "meeting-actions", item_id: "x", verdict: "revise" });
    expect(noNote.status).toBe(400);

    const unknownLoop = await postVerdict({ loop: "nope", item_id: "x", verdict: "approve" });
    expect(unknownLoop.status).toBe(404);
  });
});

describe("POST /api/loops/verdicts — contradictory verdicts (latest decision wins)", () => {
  it("dismiss after approve DROPS the accepted task (file and ledger agree)", async () => {
    const proposal = mintProposal("ma-2026-07-05-050");
    const approve = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-050", verdict: "approve" });
    expect((await approve.json()).file_effect).toBe("applied");

    const dismiss = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-050", verdict: "dismiss" });
    const payload = await dismiss.json();
    expect(payload.file_effect).toBe("applied");
    const task = readTask(vault, proposal.id);
    expect(task?.status).toBe("dropped");
    expect(task?.body).toMatch(/status: accepted-me → dropped \(via verdict:dismiss\)/);
  });

  it("repeat approve after approve stays already-applied", async () => {
    mintProposal("ma-2026-07-05-051");
    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-051", verdict: "approve" });
    const again = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-051", verdict: "approve" });
    expect((await again.json()).file_effect).toBe("already-applied");
  });
});
