import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { getVaultPathMock } = vi.hoisted(() => ({ getVaultPathMock: vi.fn<() => Promise<string>>() }));
vi.mock("@/lib/bridge/vault", () => ({ getVaultPath: getVaultPathMock }));

import { GET as listLedger } from "./route";
import { GET as getLedgerEntry } from "./[id]/route";
import type { LedgerEntry } from "@/lib/loops/meeting-ledger";
import { MeetingLedgerStore, meetingLedgerDbPath, writeMeetingLedgerStorageMarker } from "@/lib/loops/meeting-ledger-store";

let root: string;
let vault: string;

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const date = id.slice(3, 13);
  return {
    id,
    action: `Action ${id}`,
    owner: "justin",
    context: "A searchable launch dependency.",
    citations: [{ source: `meetings/${date}/Fixture.md`, date, anchor: "Evidence" }],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: `${date}T12:00:00.000Z`,
    opened_from: `meetings/${date}/Fixture.md`,
    status_history: [{ at: `${date}T12:00:00.000Z`, from: null, to: "open" }],
    sightings: [],
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-ledger-api-"));
  vault = path.join(root, "vault");
  process.env.DATA_DIR = path.join(root, "data");
  fs.mkdirSync(path.join(vault, "meta", "loops"), { recursive: true });
  fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), [
    "loops:", "  - id: meeting-actions", "    domain: meetings", "    cadence: daily", "    enabled: true", "    phase: live", "",
  ].join("\n"));
  getVaultPathMock.mockResolvedValue(vault);
  const store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  store.putEntries([
    entry("ma-2026-07-12-001", { task_id: "t-20260712-001" }),
    entry("ma-2026-07-11-001", { owner: "unclear" }),
    entry("ma-2026-07-10-001", {
      status: "dropped",
      verdict: { verdict: "dismiss", at: "2026-07-11T12:00:00.000Z" },
      status_history: [
        { at: "2026-07-10T12:00:00.000Z", from: null, to: "open" },
        { at: "2026-07-11T12:00:00.000Z", from: "open", to: "dropped" },
      ],
    }),
  ], { type: "fixture", at: "2026-07-12T13:00:00.000Z" });
  store.close();
  writeMeetingLedgerStorageMarker(vault, { version: 1, mode: "sqlite", migrated_at: "2026-07-12T13:00:00.000Z", legacy_home: null });
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("meeting ledger API", () => {
  it("paginates and filters by surfacing state without returning the lifetime ledger", async () => {
    const first = await listLedger(new Request("http://localhost/api/loops/meeting-ledger?limit=1") as never);
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(page.next_cursor).toBeTruthy();
    const second = await listLedger(new Request(`http://localhost/api/loops/meeting-ledger?limit=1&cursor=${encodeURIComponent(page.next_cursor)}`) as never);
    const secondPage = await second.json();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.total).toBe(3);
    const latent = await (await listLedger(new Request("http://localhost/api/loops/meeting-ledger?surface=latent&q=launch") as never)).json();
    expect(latent.items.map((value: { id: string }) => value.id)).toEqual(["ma-2026-07-11-001"]);
    expect(latent.facets.surface.latent).toBe(1);
    expect(latent.facets.surface.dismissed).toBe(1);
  });

  it("returns full evidence, status history, task linkage, and immutable events for one id", async () => {
    const response = await getLedgerEntry(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "ma-2026-07-12-001" }),
    });
    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail.entry.surface).toBe("pending");
    expect(detail.entry.citations[0].anchor).toBe("Evidence");
    expect(detail.events[0].event_type).toBe("fixture");
    expect(detail.entry.task_id).toBe("t-20260712-001");
  });
});
