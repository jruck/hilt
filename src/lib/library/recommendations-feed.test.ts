import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLibraryEvents } from "./events";
import { listLibraryArtifactDetails } from "./library";
import { stringifyMarkdown } from "./markdown";
import { dismissRecommendation, writeRecommendationBatch } from "./recommendation-store";
import { attachCurrentRecommendations, getRecommendationEpisodeArtifacts, getRecommendationFeed } from "./recommendations";

const SCORES = { worth: 0.8, relevance: 0.8, substance: 0.9, freshness: 0.85 };

function setup(t: test.TestContext): string {
  const previousData = process.env.DATA_DIR;
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-rec-feed-vault-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-rec-feed-data-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  process.env.DATA_DIR = data;
  t.after(() => {
    if (previousData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousData;
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });
  return vault;
}

function writeArtifact(vault: string, id: string, title: string, sourceId: string): void {
  const at = "2026-07-10T08:00:00.000Z";
  const body = `# ${title}\n\n## Summary\n\n${title} source summary with enough real content for evaluation.\n\n## Connections\n\n- [[projects/hilt|Hilt]] - Directly useful to current recommendation work.\n\n## Raw Content\n\nA substantive deterministic source body that is complete and ready for evaluation.`;
  fs.writeFileSync(path.join(vault, "references", `${id}.md`), stringifyMarkdown({
    type: "reference",
    artifact_uid: id,
    title,
    description: `${title} source summary`,
    url: `https://example.com/${id}`,
    format: "article",
    channel: "manual",
    source_id: sourceId,
    source_name: sourceId,
    library_mode: "study",
    captured: "2026-07-10",
    captured_at: at,
    published: at,
    reconnected_at: at,
    extracted_chars: 3000,
    substance: 0.9,
    digestion_status: "hot",
    tags: ["recommendations"],
  }, body));
}

test("recommendation feed cursor pagination preserves episode order and server filters", (t) => {
  const vault = setup(t);
  writeArtifact(vault, "artifact-a", "Alpha workflow", "source-a");
  writeArtifact(vault, "artifact-b", "Beta operating model", "source-b");
  writeArtifact(vault, "artifact-c", "Gamma review loop", "source-a");
  const at = "2026-07-10T09:20:00.000Z";
  const batch = writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: at,
    context_window: { start: "2026-07-10T06:20:00.000Z", end: at },
    pool_size: 3,
    picks: ["artifact-a", "artifact-b", "artifact-c"].map((artifactId, index) => ({
      artifact_id: artifactId,
      why_now: `Reason ${index + 1}`,
      triggers: [{
        id: `task:${artifactId}`,
        kind: "task" as const,
        label: artifactId,
        occurred_at: at,
        fingerprint: `fingerprint-${artifactId}`,
      }],
      scores: SCORES,
    })),
  });

  const first = getRecommendationFeed(vault, { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.id), ["artifact-a", "artifact-b"]);
  assert.equal(first.total, 3);
  assert.equal(first.cursor, null);
  assert.ok(first.next_cursor);
  assert.deepEqual(first.batch, { id: batch.id, generated_at: at, size: 3, kind: "fixture" });
  assert.equal(first.items[0].worth, first.items[0].eval_attrs?.worth, "cards show the current hybrid score");
  assert.equal(first.items[0].eval_attrs?.scoring_method, "explicit_context_hybrid");
  assert.equal(first.items[0].eval_attrs?.scoring_config_version, "s3");
  assert.deepEqual(first.items[0].recommendation?.selection_scores, SCORES, "the historical selection score remains an immutable audit snapshot");
  assert.notEqual(first.items[0].worth, first.items[0].recommendation?.selection_scores?.worth);
  assert.match(first.items[0].why, /relevance|substance/i);
  assert.equal(first.items[0].recommendation?.why_now, "Reason 1");

  const second = getRecommendationFeed(vault, { limit: 2, cursor: first.next_cursor });
  assert.deepEqual(second.items.map((item) => item.id), ["artifact-c"]);
  assert.equal(second.cursor, first.next_cursor);
  assert.equal(second.next_cursor, null);

  const filtered = getRecommendationFeed(vault, { source: "source-b", q: "operating" });
  assert.deepEqual(filtered.items.map((item) => item.id), ["artifact-b"]);
  assert.equal(filtered.total, 1);

  const eventCount = readLibraryEvents(vault).length;
  assert.equal(getRecommendationEpisodeArtifacts(vault, [batch.episodes[0].id]).length, 1);
  assert.equal(readLibraryEvents(vault).length, eventCount, "briefing hydration must not record an open");

  const missing = writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: "2026-07-10T10:20:00.000Z",
    context_window: { start: at, end: "2026-07-10T10:20:00.000Z" },
    pool_size: 1,
    picks: [{
      artifact_id: "missing-artifact",
      why_now: "A frozen placement whose artifact was later removed",
      triggers: [{ id: "task:missing", kind: "task", label: "Missing", occurred_at: at, fingerprint: "missing" }],
      scores: SCORES,
    }],
  });
  assert.deepEqual(getRecommendationEpisodeArtifacts(vault, [missing.episodes[0].id]), []);
});

test("normal Library artifacts join only active recommendation presentations", (t) => {
  const vault = setup(t);
  writeArtifact(vault, "artifact-a", "Alpha workflow", "source-a");
  const batch = writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: "2026-07-10T09:20:00.000Z",
    context_window: { start: "2026-07-10T06:20:00.000Z", end: "2026-07-10T09:20:00.000Z" },
    pool_size: 1,
    picks: [{
      artifact_id: "artifact-a",
      why_now: "A changed implementation task makes the review-loop pattern useful today.",
      triggers: [{
        id: "task:alpha",
        kind: "task",
        label: "Alpha implementation",
        occurred_at: "2026-07-10T09:00:00.000Z",
        fingerprint: "alpha-changed",
      }],
      scores: SCORES,
    }],
  });
  const [artifact] = listLibraryArtifactDetails(vault, { includeCandidates: true }).artifacts;
  const [active] = attachCurrentRecommendations(vault, [artifact]);
  assert.equal(active.recommendation?.episode_id, batch.episodes[0].id);
  assert.equal(active.recommendation?.why_now, batch.episodes[0].why_now);

  dismissRecommendation(vault, batch.episodes[0].id, "Not useful now", "2026-07-10T10:00:00.000Z");
  const [dismissed] = attachCurrentRecommendations(vault, [artifact]);
  assert.equal(dismissed.recommendation, undefined, "dismissed episodes do not mark standard Library cards as recommended");
});
