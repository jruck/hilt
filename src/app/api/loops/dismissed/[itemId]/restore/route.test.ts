import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { getVaultPathMock } = vi.hoisted(() => ({
  getVaultPathMock: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/lib/bridge/vault", () => ({ getVaultPath: getVaultPathMock }));

import { POST } from "./route";
import { readLedger, writeLedger, type LedgerEntry } from "@/lib/loops/meeting-ledger";
import { appendVerdict, readVerdicts } from "@/lib/loops/stores";
import { readProposal } from "@/lib/tasks/proposals";
import { writeTask } from "@/lib/tasks/store";

let vault: string;
const home = () => path.join(vault, "meta", "loops", "meetings");

const REGISTRY = `loops:
  - id: meeting-actions
    domain: meetings
    cadence: daily
    enabled: true
    phase: live
    proposal_sink: vault
`;

function dismissedEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "ma-2026-07-09-010",
    action: "Send the launch note",
    owner: "justin",
    context: "The team agreed the launch note should include the remaining rollout risk.",
    citations: [{ source: "meetings/2026-07-09/Launch review.md", date: "2026-07-09", anchor: "I'll send the launch note" }],
    confidence: 0.9,
    source: "extractor",
    status: "dropped",
    opened_at: "2026-07-09T14:00:00.000Z",
    opened_from: "meetings/2026-07-09/Launch review.md",
    verdict: { verdict: "dismiss", at: "2026-07-10T01:00:00.000Z", note: "Looked redundant" },
    task_id: "t-20260709-004",
    status_history: [
      { at: "2026-07-09T14:00:00.000Z", from: null, to: "open" },
      { at: "2026-07-10T01:00:00.000Z", from: "open", to: "dropped", evidence: "dismissed by verdict" },
    ],
    sightings: [],
    ...overrides,
  };
}

function seed(entry = dismissedEntry()): void {
  writeLedger(home(), { version: 1, entries: { [entry.id]: entry } });
}

function restore(itemId = "ma-2026-07-09-010", body: unknown = { loop: "meeting-actions" }) {
  return POST(new Request(`http://localhost/api/loops/dismissed/${itemId}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ itemId }) });
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-restore-dismissed-"));
  fs.mkdirSync(path.join(vault, "meta", "loops"), { recursive: true });
  fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), REGISTRY, "utf-8");
  getVaultPathMock.mockResolvedValue(vault);
});

afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

describe("POST /api/loops/dismissed/[itemId]/restore", () => {
  it("recreates the original proposal identity and appends a durable restore action", async () => {
    seed();
    const response = await restore();
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.verdict).toBe("restore");
    expect(payload.task.id).toBe("t-20260709-004");

    const task = readProposal(vault, "t-20260709-004");
    expect(task?.status).toBe("proposed");
    expect(task?.origin).toEqual({
      loop: "meeting-actions",
      meeting: "meetings/2026-07-09/Launch review.md",
      item_id: "ma-2026-07-09-010",
    });
    expect(task?.provenance?.quote).toBe("I'll send the launch note");
    expect(task?.body).toContain("restored to proposed");
    expect(readVerdicts(home()).at(-1)?.verdict).toBe("restore");
    // The API leaves the ledger single-writer; the next loop run consumes the record.
    expect(readLedger(home()).entries["ma-2026-07-09-010"].status).toBe("dropped");
  });

  it("is idempotent when the restore record and proposal already exist", async () => {
    seed();
    expect((await restore()).status).toBe(201);
    const repeated = await restore();
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).already_restored).toBe(true);
    expect(readVerdicts(home()).filter((record) => record.verdict === "restore")).toHaveLength(1);
  });

  it("can undo a dismissal before the loop has stamped the ledger", async () => {
    const open = dismissedEntry({ status: "open", verdict: undefined });
    seed(open);
    appendVerdict(home(), {
      id: "v-dismiss",
      author: "justin",
      created_at: "2026-07-10T01:00:00.000Z",
      loop: "meeting-actions",
      item_id: open.id,
      verdict: "dismiss",
    });
    const response = await restore();
    expect(response.status).toBe(201);
    expect(readVerdicts(home()).map((record) => record.verdict)).toEqual(["dismiss", "restore"]);
    expect(readProposal(vault, open.task_id!)?.id).toBe(open.task_id);
  });

  it("rejects unknown, non-dismissed, and identity-colliding entries", async () => {
    seed(dismissedEntry({ status: "open", verdict: undefined }));
    expect((await restore()).status).toBe(409);
    expect((await restore("ma-missing")).status).toBe(404);

    const collision = dismissedEntry();
    seed(collision);
    writeTask(vault, {
      id: collision.task_id!,
      title: "Accepted task occupying the identity",
      status: "accepted-me",
      created_at: "2026-07-09T12:00:00.000Z",
      body: "",
    });
    expect((await restore()).status).toBe(409);
  });
});
