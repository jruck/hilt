/**
 * /api/loops/feedback contract tests — added at the comment-primitive round (the route had
 * ZERO in-tree tests; the section-level field validation was verifier-only until now).
 * Since C2 the route is a thin adapter over the thread store: the request/response contract
 * is pinned here unchanged; storage assertions read back through the same adapter the loop
 * runners use (readFeedback), not the retired records.jsonl files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFeedback } from "@/lib/loops/stores";

const state = vi.hoisted(() => ({ baseDir: "" }));

vi.mock("@/lib/bridge/vault", () => ({
  getVaultPath: async () => state.baseDir,
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(new Request("http://localhost/api/loops/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never);
}

function seedRegistry(): void {
  const dir = path.join(state.baseDir, "meta", "loops");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "registry.yml"),
    "loops:\n  - id: meeting-actions\n    domain: meetings\n    cadence: daily\n    enabled: true\n    phase: live\n", "utf-8");
}

const originalDataDir = process.env.DATA_DIR;
let dataDir = "";

beforeEach(() => {
  state.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-feedback-route-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-feedback-threads-"));
  process.env.DATA_DIR = dataDir; // thread store isolation
  seedRegistry();
});
afterEach(() => {
  fs.rmSync(state.baseDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function meetingsHome(): string {
  return path.join(state.baseDir, "meta", "loops", "meetings");
}

describe("POST /api/loops/feedback", () => {
  it("item-level with item_id (the pre-primitive body shape) round-trips", async () => {
    const res = await post({ loop: "meeting-actions", text: "note", target: { level: "item", item_id: "ma-1" } });
    expect(res.status).toBe(201);
    const record = await res.json();
    expect(record.target.item_id).toBe("ma-1");
    // Stored: readable back through the loop-runner adapter, FeedbackRecord-shaped.
    const stored = readFeedback(meetingsHome());
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(record.id);
    expect(stored[0].target).toEqual({ loop: "meeting-actions", level: "item", item_id: "ma-1" });
    expect(stored[0].text).toBe("note");
  });

  it("section-level accepts the new section field; item-level rejects it", async () => {
    const ok = await post({ loop: "meeting-actions", text: "note", target: { level: "section", section: "📅 Today" } });
    expect(ok.status).toBe(201);
    expect((await ok.json()).target.section).toBe("📅 Today");
    const bad = await post({ loop: "meeting-actions", text: "note", target: { level: "item", item_id: "ma-2", section: "📅 Today" } });
    expect(bad.status).toBe(400);
  });

  it("item-level anchor bodies may carry artifact_date (the primitive's enrichment)", async () => {
    const res = await post({
      loop: "meeting-actions", text: "note",
      target: { level: "item", anchor: { section: "🧠", text: "some bullet" }, artifact_date: "2026-07-07" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).target.artifact_date).toBe("2026-07-07");
  });
});
