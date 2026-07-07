/**
 * GET /api/loops/dismissed behavioral spec (gate-B: dismissed are never gone), via direct
 * handler invocation (precedent: the verdicts route test). The route reads the loop's LEDGER
 * (registry-resolved home) and returns entries dropped via a DISMISS verdict, newest first,
 * capped by ?days — closure drops (no verdict) and open entries are excluded.
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

import { GET } from "./route";
import type { Ledger, LedgerEntry } from "@/lib/loops/meeting-ledger";

let vault: string;

/** Loop is `live` so the ledger home resolves inside the temp vault, not the $DATA sandbox. */
const REGISTRY = [
  "loops:",
  "  - id: meeting-actions",
  "    domain: meetings",
  "    cadence: daily",
  "    enabled: true",
  "    phase: live",
  "",
].join("\n");

function get(query: string) {
  return GET(new Request(`http://localhost/api/loops/dismissed${query}`) as never);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function entry(id: string, overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id,
    action: `Action for ${id}`,
    owner: "justin",
    citations: [],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: isoDaysAgo(50),
    opened_from: "meetings/2026-05-20/floyds.md",
    status_history: [{ at: isoDaysAgo(50), from: null, to: "open" }],
    sightings: [],
    ...overrides,
  };
}

function dismissedEntry(id: string, droppedDaysAgo: number, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const at = isoDaysAgo(droppedDaysAgo);
  return entry(id, {
    status: "dropped",
    verdict: { verdict: "dismiss", at },
    status_history: [
      { at: isoDaysAgo(50), from: null, to: "open" },
      { at, from: "open", to: "dropped", evidence: "verdict:dismiss" },
    ],
    ...overrides,
  });
}

function seedLedger(entries: LedgerEntry[]): void {
  const stateDir = path.join(vault, "meta", "loops", "meetings", "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const ledger: Ledger = {
    version: 1,
    entries: Object.fromEntries(entries.map((e) => [e.id, e])),
  };
  fs.writeFileSync(path.join(stateDir, "ledger.json"), JSON.stringify(ledger, null, 1), "utf-8");
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-dismissed-route-"));
  fs.mkdirSync(path.join(vault, "meta", "loops"), { recursive: true });
  fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), REGISTRY, "utf-8");
  getVaultPathMock.mockResolvedValue(vault);
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("GET /api/loops/dismissed", () => {
  it("returns dismiss-verdict drops newest first, with the documented shape", async () => {
    seedLedger([
      dismissedEntry("ma-2026-05-20-001", 8, { task_id: "t-20260520-001" }),
      dismissedEntry("ma-2026-05-20-002", 2),
      entry("ma-2026-05-20-003", {}), // open — excluded
      // Closure drop (no verdict) — excluded: this route is the record of JUSTIN's declines.
      entry("ma-2026-05-20-004", {
        status: "dropped",
        status_history: [
          { at: isoDaysAgo(50), from: null, to: "open" },
          { at: isoDaysAgo(3), from: "open", to: "dropped", evidence: "we're not doing that" },
        ],
      }),
    ]);

    const res = await get("?loop=meeting-actions");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.loop).toBe("meeting-actions");
    expect(json.days).toBe(30);
    expect(json.items.map((item: { id: string }) => item.id)).toEqual([
      "ma-2026-05-20-002",
      "ma-2026-05-20-001",
    ]);
    expect(json.items[1]).toEqual({
      id: "ma-2026-05-20-001",
      action: "Action for ma-2026-05-20-001",
      dismissed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      opened_from: "meetings/2026-05-20/floyds.md",
      task_id: "t-20260520-001",
    });
    expect(json.items[0].task_id).toBeUndefined();
  });

  it("caps by ?days (default 30) and a wider window admits older dismissals", async () => {
    seedLedger([
      dismissedEntry("ma-2026-05-20-010", 5),
      dismissedEntry("ma-2026-05-20-011", 40),
    ]);

    const byDefault = await (await get("?loop=meeting-actions")).json();
    expect(byDefault.items.map((item: { id: string }) => item.id)).toEqual(["ma-2026-05-20-010"]);

    const wide = await (await get("?loop=meeting-actions&days=60")).json();
    expect(wide.days).toBe(60);
    expect(wide.items.map((item: { id: string }) => item.id)).toEqual([
      "ma-2026-05-20-010",
      "ma-2026-05-20-011",
    ]);
  });

  it("falls back to the verdict stamp when the drop transition is missing from history", async () => {
    const at = isoDaysAgo(4);
    seedLedger([
      entry("ma-2026-05-20-020", {
        status: "dropped",
        verdict: { verdict: "dismiss", at },
        status_history: [{ at: isoDaysAgo(50), from: null, to: "open" }],
      }),
    ]);

    const json = await (await get("?loop=meeting-actions")).json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].dismissed_at).toBe(at);
  });

  it("missing ledger file → 200 with empty items (first-run store)", async () => {
    const res = await get("?loop=meeting-actions");
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("validates: loop required (400), non-positive days (400), unknown loop (404)", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?loop=meeting-actions&days=0")).status).toBe(400);
    expect((await get("?loop=meeting-actions&days=nope")).status).toBe(400);
    expect((await get("?loop=nope")).status).toBe(404);
  });
});

describe("degradation", () => {
  function seedLedgerRaw(raw: string): void {
    const stateDir = path.join(vault, "meta", "loops", "meetings", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "ledger.json"), raw, "utf-8");
  }

  it("corrupt ledger → 200 with empty items (read surface never 500s)", async () => {
    seedLedgerRaw('{"version":1,"entries":{"trunc');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await get("?loop=meeting-actions");
    warn.mockRestore();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("ledger missing entries key → 200 empty", async () => {
    seedLedgerRaw('{"version":1}');
    const res = await get("?loop=meeting-actions");
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });
});
