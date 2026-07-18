import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendLibraryEvents } from "./events";
import {
  bootstrapLegacyRecommendationCache,
  dismissRecommendation,
  projectedRecommendationEpisodes,
  readRecommendationBatches,
  readRecommendationRuntime,
  recommendationRoot,
  restoreRecommendation,
  writeRecommendationBatch,
  writeRecommendationRuntime,
} from "./recommendation-store";
import type { RecommendationTrigger } from "./types";

const scores = { worth: 0.8, relevance: 0.75, substance: 0.9, freshness: 0.85 };

function setup(t: test.TestContext): { vault: string; data: string } {
  const previous = process.env.DATA_DIR;
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-rec-vault-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-rec-data-"));
  process.env.DATA_DIR = data;
  t.after(() => {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });
  return { vault, data };
}

function trigger(id: string, occurredAt: string, fingerprint = id): RecommendationTrigger {
  return { id, kind: id.startsWith("artifact:") ? "artifact" : "meeting", label: id, occurred_at: occurredAt, fingerprint };
}

function batch(vault: string, at: string, picks: Array<{ id: string; why: string; trigger: RecommendationTrigger }>) {
  return writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: at,
    context_window: { start: at, end: at },
    pool_size: picks.length,
    picks: picks.map((pick) => ({ artifact_id: pick.id, why_now: pick.why, triggers: [pick.trigger], scores })),
  });
}

test("immutable batches project one latest episode per artifact and heal a stale projection", (t) => {
  const { vault } = setup(t);
  const day1 = batch(vault, "2026-07-08T09:20:00.000Z", [
    { id: "a", why: "First reason", trigger: trigger("artifact:a", "2026-07-08T09:00:00.000Z") },
    { id: "b", why: "Second reason", trigger: trigger("artifact:b", "2026-07-08T09:00:00.000Z") },
  ]);
  const day2 = batch(vault, "2026-07-09T09:20:00.000Z", [
    { id: "c", why: "Third reason", trigger: trigger("artifact:c", "2026-07-09T09:00:00.000Z") },
  ]);
  const day3 = batch(vault, "2026-07-10T09:20:00.000Z", [
    { id: "a", why: "A materially new reason", trigger: trigger("meeting:launch", "2026-07-10T08:00:00.000Z", "launch-v2") },
  ]);

  assert.equal(readRecommendationBatches(vault).length, 3);
  assert.deepEqual(projectedRecommendationEpisodes(vault).map((episode) => episode.artifact_id), ["a", "c", "b"]);
  const resurfaced = projectedRecommendationEpisodes(vault)[0];
  assert.equal(resurfaced.is_resurface, true);
  assert.equal(resurfaced.previous_episode_id, day1.episodes[0].id);
  assert.equal(resurfaced.why_now, "A materially new reason");

  fs.writeFileSync(path.join(recommendationRoot(vault), "feed.json"), JSON.stringify({ version: 1, batch_count: 1, latest_batch_id: day2.id, entries: [] }));
  assert.deepEqual(projectedRecommendationEpisodes(vault).map((episode) => episode.id), [day3.episodes[0].id, day2.episodes[0].id, day1.episodes[1].id]);
});

test("dismissal and restore affect recommendation state only, while old-episode dismissal cannot hide a resurface", (t) => {
  const { vault } = setup(t);
  const first = batch(vault, "2026-07-01T09:20:00.000Z", [
    { id: "a", why: "Original", trigger: trigger("artifact:a", "2026-07-01T09:00:00.000Z") },
  ]);
  dismissRecommendation(vault, first.episodes[0].id, "Not timely", "2026-07-02T12:00:00.000Z");
  assert.equal(projectedRecommendationEpisodes(vault).length, 0);
  restoreRecommendation(vault, first.episodes[0].id, "2026-07-03T12:00:00.000Z");
  assert.equal(projectedRecommendationEpisodes(vault).length, 1);

  const second = batch(vault, "2026-08-04T09:20:00.000Z", [
    { id: "a", why: "New context", trigger: trigger("meeting:new", "2026-08-04T08:00:00.000Z") },
  ]);
  dismissRecommendation(vault, second.episodes[0].id, "Not now", "2026-08-05T11:00:00.000Z");
  assert.equal(projectedRecommendationEpisodes(vault).length, 0);
  dismissRecommendation(vault, first.episodes[0].id, null, "2026-08-05T12:00:00.000Z");
  assert.equal(projectedRecommendationEpisodes(vault).length, 0, "an old briefing dismissal cannot overwrite the current episode verdict");
  restoreRecommendation(vault, second.episodes[0].id, "2026-08-05T13:00:00.000Z");
  assert.equal(projectedRecommendationEpisodes(vault)[0].id, second.episodes[0].id);
});

test("read events never reorder the durable feed", (t) => {
  const { vault } = setup(t);
  batch(vault, "2026-07-10T09:20:00.000Z", [
    { id: "a", why: "A", trigger: trigger("artifact:a", "2026-07-10T09:00:00.000Z") },
    { id: "b", why: "B", trigger: trigger("artifact:b", "2026-07-10T09:00:00.000Z") },
  ]);
  const before = projectedRecommendationEpisodes(vault).map((episode) => episode.id);
  appendLibraryEvents(vault, [{ type: "read", artifact_id: "b", surface: "detail" }]);
  assert.deepEqual(projectedRecommendationEpisodes(vault).map((episode) => episode.id), before);
});

test("rate-limit runtime fallback preserves the last complete feed projection", (t) => {
  const { vault } = setup(t);
  batch(vault, "2026-07-10T09:20:00.000Z", [
    { id: "a", why: "A", trigger: trigger("artifact:a", "2026-07-10T09:00:00.000Z") },
  ]);
  const before = projectedRecommendationEpisodes(vault);
  writeRecommendationRuntime(vault, {
    pending: true,
    pending_reasons: ["editor-retry:morning"],
    next_retry_at: "2026-07-10T10:20:00.000Z",
    last_error: "rate_limited",
  });
  assert.deepEqual(projectedRecommendationEpisodes(vault), before);
  assert.equal(readRecommendationRuntime(vault).last_error, "rate_limited");
});

test("artifact-keyed rollout verdicts normalize to episode-keyed dismissal history", (t) => {
  const { vault } = setup(t);
  const created = batch(vault, "2026-07-10T09:20:00.000Z", [
    { id: "a", why: "A", trigger: trigger("artifact:a", "2026-07-10T09:00:00.000Z") },
  ]);
  fs.writeFileSync(path.join(recommendationRoot(vault), "verdicts.json"), JSON.stringify({
    version: 1,
    dismissals: {
      a: {
        artifact_id: "a",
        episode_id: created.episodes[0].id,
        dismissed_at: "2026-07-10T10:00:00.000Z",
        restored_at: null,
        note: null,
      },
    },
  }));
  assert.equal(projectedRecommendationEpisodes(vault).length, 0);
  restoreRecommendation(vault, created.episodes[0].id, "2026-07-10T11:00:00.000Z");
  assert.equal(projectedRecommendationEpisodes(vault).length, 1);
});

test("invalid or duplicate picks reject the whole batch without a partial write", (t) => {
  const { vault } = setup(t);
  assert.throws(() => writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: "2026-07-10T09:20:00.000Z",
    context_window: { start: "2026-07-10T06:00:00.000Z", end: "2026-07-10T09:20:00.000Z" },
    pool_size: 2,
    picks: [
      { artifact_id: "a", why_now: "A", triggers: [trigger("artifact:a", "2026-07-10T09:00:00.000Z")], scores },
      { artifact_id: "a", why_now: "B", triggers: [trigger("meeting:b", "2026-07-10T09:00:00.000Z")], scores },
    ],
  }), /Duplicate/);
  assert.equal(readRecommendationBatches(vault).length, 0);
});

test("s3 recommendation provenance is frozen on both the batch and its episodes", (t) => {
  const { vault } = setup(t);
  const created = writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: "2026-07-18T09:20:00.000Z",
    context_window: { start: "2026-07-18T06:00:00.000Z", end: "2026-07-18T09:20:00.000Z" },
    pool_size: 1,
    scoring_method: "explicit_context_hybrid",
    scoring_config_version: "s3",
    editor_model: "claude-sonnet-4-6",
    editor_prompt_version: "library-recommendations-v1",
    picks: [{ artifact_id: "a", why_now: "Useful now", triggers: [trigger("artifact:a", "2026-07-18T09:00:00.000Z")], scores }],
  });

  const expected = {
    scoring_method: "explicit_context_hybrid",
    scoring_config_version: "s3",
    editor_model: "claude-sonnet-4-6",
    editor_prompt_version: "library-recommendations-v1",
  } as const;
  assert.deepEqual({
    scoring_method: created.scoring_method,
    scoring_config_version: created.scoring_config_version,
    editor_model: created.editor_model,
    editor_prompt_version: created.editor_prompt_version,
  }, expected);
  assert.deepEqual({
    scoring_method: created.episodes[0].scoring_method,
    scoring_config_version: created.episodes[0].scoring_config_version,
    editor_model: created.episodes[0].editor_model,
    editor_prompt_version: created.episodes[0].editor_prompt_version,
  }, expected);
  assert.deepEqual(readRecommendationBatches(vault)[0], created);
});

test("legacy cache bootstraps once and deduplicates artifacts", (t) => {
  const { vault, data } = setup(t);
  const legacyDir = path.join(data, "library-for-you");
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyName = path.basename(recommendationRoot(vault));
  fs.writeFileSync(path.join(legacyDir, `${legacyName}.json`), JSON.stringify({
    generated_at: "2026-07-09T11:00:00.000Z",
    picks: [{ id: "a", reason: "One" }, { id: "a", reason: "Duplicate" }],
  }));
  const first = bootstrapLegacyRecommendationCache(vault, new Map([["a", scores]]));
  assert.equal(first?.episodes.length, 1);
  assert.equal(bootstrapLegacyRecommendationCache(vault, new Map([["a", scores]])), null);
});
