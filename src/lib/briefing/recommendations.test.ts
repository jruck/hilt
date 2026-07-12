import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { briefingLibraryHealthContext, briefingLibraryMemoContext, briefingRecommendationCutoff, selectBriefingRecommendationItems, weekendBriefingAnchor } from "./recommendations";
import type { RecommendedArtifact } from "@/lib/library/types";

function item(id: string, recommendedAt: string, unread = true): RecommendedArtifact {
  return {
    id, path: `references/${id}.md`, abs_path: `/tmp/${id}.md`, title: id, summary: `Summary ${id}`,
    source_type: "fixture", channel: "manual", source_id: "fixture", source_name: "Fixture",
    tags: [], source_tags: [], source_collection: null, source_collection_id: null, source_folder: null,
    source_folder_id: null, library_mode: "study", thumbnail: null, author: null, url: `https://example.com/${id}`,
    created_at: recommendedAt, updated_at: recommendedAt, lifecycle_status: "saved", is_unread: unread, read_at: unread ? null : recommendedAt,
    why: `Why ${id}`, worth: 0.8, relevance: 0.8, substance: 0.8, freshness: 0.8, lifecycle: "active", matched_terms: [],
    recommendation: {
      episode_id: `rec-${id}`, batch_id: "batch", recommended_at: recommendedAt, rank: 1,
      why_now: `Why now ${id}`, triggers: [], is_resurface: false, previous_recommended_at: null,
    },
  };
}

test("briefing selects at most three new unread episodes in feed order without padding", () => {
  const items = [
    item("new-1", "2026-07-10T09:20:00.000Z"),
    item("read", "2026-07-10T09:19:00.000Z", false),
    item("new-2", "2026-07-10T09:18:00.000Z"),
    item("new-3", "2026-07-10T09:17:00.000Z"),
    item("new-4", "2026-07-10T09:16:00.000Z"),
    item("old", "2026-07-09T09:00:00.000Z"),
  ];
  assert.deepEqual(
    selectBriefingRecommendationItems(items, "2026-07-09T10:00:00.000Z").map((entry) => entry.id),
    ["new-1", "new-2", "new-3"],
  );
  assert.deepEqual(selectBriefingRecommendationItems([item("old", "2026-07-09T09:00:00.000Z")], "2026-07-09T10:00:00.000Z"), []);
});

test("briefing cutoff anchors to six AM Eastern on the latest prior daily briefing", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-briefing-rec-vault-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  fs.mkdirSync(path.join(vault, "briefings"), { recursive: true });
  fs.writeFileSync(path.join(vault, "briefings", "2026-07-08.md"), "# old\n");
  fs.writeFileSync(path.join(vault, "briefings", "2026-07-09.md"), "# previous\n");
  assert.equal(briefingRecommendationCutoff(vault, "2026-07-10"), "2026-07-09T10:00:00.000Z");
});

test("weekly memo selection is exact to the Saturday-anchored weekend and absent on weekdays", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-briefing-memo-vault-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const memoDir = path.join(vault, "meta", "loops", "references", "memos");
  fs.mkdirSync(memoDir, { recursive: true });
  fs.writeFileSync(path.join(memoDir, "2026-07-11-editors-memo.md"), "---\ntitle: The weekly argument\ndescription: What the week's reading means.\n---\n# The weekly argument\n");
  assert.equal(weekendBriefingAnchor("2026-07-11"), "2026-07-11");
  assert.equal(weekendBriefingAnchor("2026-07-12"), "2026-07-11");
  assert.equal(weekendBriefingAnchor("2026-07-13"), null);
  assert.equal(briefingLibraryMemoContext(vault, "2026-07-12")?.title, "The weekly argument");
  assert.equal(briefingLibraryMemoContext(vault, "2026-07-13"), null);
});

test("daily health uses the exact report date and never falls back to an older report", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-briefing-health-vault-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const reportDir = path.join(vault, "meta", "loops", "references", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "2026-07-10.md"), "---\nhealth:\n  ok: true\n  briefing_summary: Older report.\n---\n# Older\n");
  assert.equal(briefingLibraryHealthContext(vault, "2026-07-11").available, false);
  fs.writeFileSync(path.join(reportDir, "2026-07-11.md"), "---\nhealth:\n  ok: true\n  briefing_summary: Library processing is healthy.\n---\n# Today\n");
  assert.deepEqual(briefingLibraryHealthContext(vault, "2026-07-11"), {
    date: "2026-07-11", available: true, summary: "Library processing is healthy.", path: "meta/loops/references/reports/2026-07-11.md",
  });
});
