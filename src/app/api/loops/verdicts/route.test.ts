/**
 * POST /api/loops/verdicts file-effect spec (v3 unit A6), via direct handler invocation
 * (precedent: src/app/api/tasks/[id]/route.test.ts). The verdict jsonl append is the unchanged
 * audit trail; these tests pin the ADDITIVE synchronous proposal-file effect: each verdict
 * kind's file semantics, repeat = already-applied, no-file = missing (pre-A6 items and
 * non-vault sinks), and unknown items absorbed exactly as before — plus the gate-B weekly
 * mirror (approve/assign_to_me splice a v2 line at the top of the current weekly list's Tasks;
 * assign_to_agent splices into the "### Ready for agents" section, created when missing; every
 * promotion stamps the 🆕 lifecycle marker into the task FILE title exactly once; v1 lists
 * never splice; mirror failure is cosmetic).
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
import { createTask, proposalPath, readTask, taskPath, updateTask as updateTaskFile } from "@/lib/tasks/store";
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

/** Seed a current weekly list (the recycle test's seeding style: direct fs into lists/now/). */
function seedWeekly(content: string, name = "2026-07-06.md"): string {
  const dir = path.join(vault, "lists", "now");
  fs.mkdirSync(dir, { recursive: true });
  const listPath = path.join(dir, name);
  fs.writeFileSync(listPath, content, "utf-8");
  return listPath;
}

const V2_LIST = [
  "---",
  "week: 2026-07-06",
  "list_format: 2",
  "---",
  "",
  "## Tasks",
  "",
  "- [ ] [Existing task](tasks/t-20260706-001.md)",
  "",
].join("\n");

const V1_LIST = [
  "---",
  "week: 2026-07-06",
  "---",
  "",
  "## Tasks",
  "",
  "- [ ] Legacy v1 task",
  "",
].join("\n");

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

describe("POST /api/loops/verdicts — weekly-list mirror (gate-B: approve gains weekly visibility)", () => {
  it("approve splices the accepted task's v2 line into the top of the current weekly list", async () => {
    // An older v1 week alongside pins "current = lexicographically latest".
    seedWeekly(V1_LIST, "2026-06-29.md");
    const listPath = seedWeekly(V2_LIST);
    const proposal = mintProposal("ma-2026-07-05-101");

    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-101", verdict: "approve" });
    expect((await res.json()).file_effect).toBe("applied");

    const content = fs.readFileSync(listPath, "utf-8");
    const line = `- [ ] [🆕 Proposal for ma-2026-07-05-101](tasks/${proposal.id}.md)`;
    expect(content).toContain(line);
    // A4's insertion convention: top of the task section, before existing tasks.
    expect(content.indexOf(line)).toBeLessThan(content.indexOf("Existing task"));
    // The older week is untouched.
    expect(fs.readFileSync(path.join(vault, "lists", "now", "2026-06-29.md"), "utf-8")).toBe(V1_LIST);
  });

  it("assign_to_me splices at the top; assign_to_agent lands in a created 'Ready for agents' section", async () => {
    const listPath = seedWeekly(V2_LIST);
    const mine = mintProposal("ma-2026-07-05-102");
    const agents = mintProposal("ma-2026-07-05-103");

    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-102", verdict: "assign_to_me" });
    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-103", verdict: "assign_to_agent" });

    const content = fs.readFileSync(listPath, "utf-8");
    expect(content).toContain(`tasks/${mine.id}.md`);
    // Agent tasks get a home: the section is created at the bottom of the Tasks region and
    // holds the agent line — below Justin's own tasks, never mixed in at the top.
    expect(content).toContain(`### Ready for agents\n- [ ] [🆕 Proposal for ma-2026-07-05-103](tasks/${agents.id}.md)`);
    expect(content.indexOf(`tasks/${mine.id}.md`)).toBeLessThan(content.indexOf("### Ready for agents"));
  });

  it("assign_to_agent reuses an existing section (case-insensitive), splicing at its top", async () => {
    const listWithSection = [
      "---",
      "week: 2026-07-06",
      "list_format: 2",
      "---",
      "",
      "## Tasks",
      "",
      "- [ ] [Existing task](tasks/t-20260706-001.md)",
      "",
      "### ready FOR agents",
      "",
      "- [ ] [Queued agent task](tasks/t-20260706-002.md)",
      "",
    ].join("\n");
    const listPath = seedWeekly(listWithSection);
    const agents = mintProposal("ma-2026-07-05-110");

    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-110", verdict: "assign_to_agent" });

    const content = fs.readFileSync(listPath, "utf-8");
    // No second section minted; the new line sits at the top of the existing one.
    expect(content.match(/###\s+ready for agents/gi)).toHaveLength(1);
    expect(content).toContain(
      `### ready FOR agents\n\n- [ ] [🆕 Proposal for ma-2026-07-05-110](tasks/${agents.id}.md)\n- [ ] [Queued agent task]`,
    );
  });

  it("both promotion kinds stamp 🆕 into the task FILE title (and the line agrees)", async () => {
    const listPath = seedWeekly(V2_LIST);
    const mine = mintProposal("ma-2026-07-05-111");
    const agents = mintProposal("ma-2026-07-05-112");

    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-111", verdict: "approve" });
    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-112", verdict: "assign_to_agent" });

    expect(readTask(vault, mine.id)?.title).toBe("🆕 Proposal for ma-2026-07-05-111");
    expect(readTask(vault, agents.id)?.title).toBe("🆕 Proposal for ma-2026-07-05-112");
    const content = fs.readFileSync(listPath, "utf-8");
    expect(content).toContain(`[🆕 Proposal for ma-2026-07-05-111](tasks/${mine.id}.md)`);
    expect(content).toContain(`[🆕 Proposal for ma-2026-07-05-112](tasks/${agents.id}.md)`);
  });

  it("approve twice never double-prefixes the marker; a viewed (stripped) task is not re-marked", async () => {
    seedWeekly(V2_LIST);
    const proposal = mintProposal("ma-2026-07-05-113");

    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-113", verdict: "approve" });
    expect(readTask(vault, proposal.id)?.title).toBe("🆕 Proposal for ma-2026-07-05-113");

    // Repeat verdict against the already-accepted file: still exactly one marker.
    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-113", verdict: "approve" });
    expect(readTask(vault, proposal.id)?.title).toBe("🆕 Proposal for ma-2026-07-05-113");

    // Justin viewed the task → the Bridge read-receipt stripped the marker from the file.
    // A later repeat verdict (self-heal probe) must NOT re-mark it.
    updateTaskFile(vault, proposal.id, { title: "Proposal for ma-2026-07-05-113" });
    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-113", verdict: "approve" });
    expect(readTask(vault, proposal.id)?.title).toBe("Proposal for ma-2026-07-05-113");
  });

  it("repeat assign_to_agent self-heals a missed section splice without re-marking", async () => {
    // First verdict lands with NO weekly list present (mirror is a cosmetic no-op)…
    const proposal = mintProposal("ma-2026-07-05-114");
    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-114", verdict: "assign_to_agent" });
    // …the marker is stripped by viewing, then a list appears and the verdict repeats.
    updateTaskFile(vault, proposal.id, { title: "Proposal for ma-2026-07-05-114" });
    const listPath = seedWeekly(V2_LIST);
    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-114", verdict: "assign_to_agent" });
    expect((await res.json()).file_effect).toBe("already-applied");

    const content = fs.readFileSync(listPath, "utf-8");
    expect(content).toContain(`### Ready for agents\n- [ ] [Proposal for ma-2026-07-05-114](tasks/${proposal.id}.md)`);
    expect(readTask(vault, proposal.id)?.title).toBe("Proposal for ma-2026-07-05-114"); // no re-mark
  });

  it("a v1 current list stays byte-untouched for assign_to_agent too", async () => {
    const listPath = seedWeekly(V1_LIST);
    const proposal = mintProposal("ma-2026-07-05-115");

    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-115", verdict: "assign_to_agent" });
    expect((await res.json()).file_effect).toBe("applied");
    expect(readTask(vault, proposal.id)?.status).toBe("accepted-agent");
    expect(fs.readFileSync(listPath, "utf-8")).toBe(V1_LIST);
    // No v2 line will ever exist to strip a marker — so the file must not be marked at all.
    expect(readTask(vault, proposal.id)?.title.includes("🆕")).toBe(false);
  });

  it("approve twice → no duplicate line (already-linked check)", async () => {
    const listPath = seedWeekly(V2_LIST);
    const proposal = mintProposal("ma-2026-07-05-104");

    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-104", verdict: "approve" });
    const second = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-104", verdict: "approve" });
    expect((await second.json()).file_effect).toBe("already-applied");

    const content = fs.readFileSync(listPath, "utf-8");
    const occurrences = content.split(`tasks/${proposal.id}.md`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("a v1 current list stays byte-untouched (no format upgrade from a side effect)", async () => {
    const listPath = seedWeekly(V1_LIST);
    const proposal = mintProposal("ma-2026-07-05-105");

    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-105", verdict: "approve" });
    expect((await res.json()).file_effect).toBe("applied");
    expect(readTask(vault, proposal.id)?.status).toBe("accepted-me");
    expect(fs.readFileSync(listPath, "utf-8")).toBe(V1_LIST);
  });

  it("no weekly list at all → the verdict still succeeds (mirror failure is cosmetic)", async () => {
    const proposal = mintProposal("ma-2026-07-05-106");
    const res = await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-106", verdict: "approve" });
    expect(res.status).toBe(201);
    expect((await res.json()).file_effect).toBe("applied");
    expect(readTask(vault, proposal.id)?.status).toBe("accepted-me");
  });

  it("a due date rides into the spliced line", async () => {
    const listPath = seedWeekly(V2_LIST);
    const proposal = mintProposal("ma-2026-07-05-107", { due: "2026-07-10" });

    await postVerdict({ loop: "meeting-actions", item_id: "ma-2026-07-05-107", verdict: "approve" });
    expect(fs.readFileSync(listPath, "utf-8")).toContain(
      `- [ ] [🆕 Proposal for ma-2026-07-05-107](tasks/${proposal.id}.md) [due:: 2026-07-10]`,
    );
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
