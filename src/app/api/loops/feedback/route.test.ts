/**
 * /api/loops/feedback contract tests — added at the comment-primitive round (the route had
 * ZERO in-tree tests; the section-level field validation was verifier-only until now).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

beforeEach(() => {
  state.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-feedback-route-"));
  seedRegistry();
});
afterEach(() => fs.rmSync(state.baseDir, { recursive: true, force: true }));

function records(): string[] {
  const p = path.join(state.baseDir, "meta", "loops", "meetings", "feedback", "records.jsonl");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim().split("\n") : [];
}

describe("POST /api/loops/feedback", () => {
  it("item-level with item_id (the pre-primitive body shape) round-trips", async () => {
    const res = await post({ loop: "meeting-actions", text: "note", target: { level: "item", item_id: "ma-1" } });
    expect(res.status).toBe(201);
    expect(JSON.parse(records()[0]).target.item_id).toBe("ma-1");
  });

  it("section-level accepts the new section field; item-level rejects it", async () => {
    const ok = await post({ loop: "meeting-actions", text: "note", target: { level: "section", section: "📅 Today" } });
    expect(ok.status).toBe(201);
    expect(JSON.parse(records()[0]).target.section).toBe("📅 Today");
    const bad = await post({ loop: "meeting-actions", text: "note", target: { level: "item", item_id: "ma-2", section: "📅 Today" } });
    expect(bad.status).toBe(400);
  });

  it("item-level anchor bodies may carry artifact_date (the primitive's enrichment)", async () => {
    const res = await post({
      loop: "meeting-actions", text: "note",
      target: { level: "item", anchor: { section: "🧠", text: "some bullet" }, artifact_date: "2026-07-07" },
    });
    expect(res.status).toBe(201);
    expect(JSON.parse(records()[0]).target.artifact_date).toBe("2026-07-07");
  });
});
