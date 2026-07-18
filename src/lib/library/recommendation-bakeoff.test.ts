import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateArtifact } from "./library-eval";
import {
  buildBakeoffCheckpoint,
  explicitContextHybridScore,
  scoreBoundedLexical,
  selectCounterfactualBriefing,
  type BakeoffEditorPick,
  type BakeoffContextSignal,
} from "./recommendation-bakeoff";
import { DEFAULT_SCORING_CONFIG } from "./scoring-config";
import type { LibraryArtifactDetail, RecommendationBatch } from "./types";

function artifact(id: string, title: string, summary: string, content: string, createdAt: string): LibraryArtifactDetail {
  return {
    id,
    path: `references/${id}.md`,
    abs_path: `/tmp/${id}.md`,
    title,
    summary,
    source_type: "fixture",
    channel: "manual",
    source_id: "fixture",
    source_name: "Fixture",
    tags: [],
    source_tags: [],
    source_collection: null,
    source_collection_id: null,
    source_folder: null,
    source_folder_id: null,
    library_mode: "study",
    format: "article",
    thumbnail: null,
    author: null,
    url: `https://example.com/${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    lifecycle_status: "saved",
    is_unread: true,
    read_at: null,
    content,
    key_points: [],
    connections: [],
    raw_frontmatter: { format: "article", extracted_chars: content.length, reconnected_at: createdAt },
  };
}

function signal(text: string): BakeoffContextSignal {
  return {
    id: "task:fixture",
    kind: "task",
    label: "Agent delivery",
    target: "projects/hilt",
    text,
    weight: 1.35,
    occurred_at: "2026-07-10T08:00:00.000Z",
    fidelity: "exact",
  };
}

test("bounded lexical scoring is deterministic, capped, and separates strong from generic matches", () => {
  const artifacts = [
    artifact("strong", "Agent delivery review loop", "Ship software with explicit review checkpoints", "Agent delivery requires a review loop and deployment checks.", "2026-07-09T08:00:00.000Z"),
    artifact("generic", "Weekly software news", "A general technology roundup", "Several products shipped this week.", "2026-07-09T08:00:00.000Z"),
  ];
  const context = [signal("The agent delivery project needs review checkpoints and deployment checks")];
  const first = scoreBoundedLexical(artifacts, context);
  const second = scoreBoundedLexical(artifacts, context);
  assert.deepEqual(first, second);
  assert.equal(first.get("strong")?.score, 0.3);
  assert.equal(first.get("generic")?.score, 0);
  assert.ok((first.get("strong")?.matchedTerms.length || 0) >= 2);
});

test("explicit-context hybrid applies active-target and attention adjustments inside the cap", () => {
  assert.equal(explicitContextHybridScore(0.12, true, "high"), 0.27);
  assert.equal(explicitContextHybridScore(0.28, true, "high"), 0.3);
  assert.equal(explicitContextHybridScore(0.02, false, "low"), 0);
  assert.equal(explicitContextHybridScore(0.12, false, "medium"), 0.14);
});

test("historical freshness uses the injected checkpoint instead of wall-clock time", () => {
  const input = {
    connections: [],
    contextFit: 0.3,
    createdAt: "2026-07-01T00:00:00.000Z",
    substance: 1,
    analyzed: true,
    extraction_ok: true,
  };
  const historical = evaluateArtifact(input, DEFAULT_SCORING_CONFIG, new Date("2026-07-05T00:00:00.000Z"));
  const later = evaluateArtifact(input, DEFAULT_SCORING_CONFIG, new Date("2027-07-05T00:00:00.000Z"));
  assert.equal(historical.freshness, 1);
  assert.equal(later.freshness, 0.6);
  assert.ok(historical.worth > later.worth);
});

test("checkpoint replay excludes future artifacts and future negative events without writing the vault", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-bakeoff-vault-"));
  fs.mkdirSync(path.join(vault, "lists", "now"), { recursive: true });
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-07-06.md"), "# Week\n\n- [ ] Agent delivery review\n");
  const before = fs.readdirSync(vault, { recursive: true }).map(String).sort();
  const current = artifact("current", "Agent delivery", "Review workflow", "Agent delivery review workflow", "2026-07-09T08:00:00.000Z");
  const future = artifact("future", "Future launch", "Not available yet", "Future release", "2026-07-12T08:00:00.000Z");
  const batch: RecommendationBatch = {
    version: 1,
    id: "batch-fixture",
    kind: "fixture",
    generated_at: "2026-07-10T09:00:00.000Z",
    context_window: { start: "2026-07-07T09:00:00.000Z", end: "2026-07-10T09:00:00.000Z" },
    pool_size: 1,
    episodes: [{
      id: "rec-current",
      batch_id: "batch-fixture",
      artifact_id: "current",
      recommended_at: "2026-07-10T09:00:00.000Z",
      rank: 1,
      why_now: "The delivery task makes this useful now.",
      triggers: [{ id: "artifact:current", kind: "artifact", label: "Agent delivery", occurred_at: current.created_at, fingerprint: "current" }],
      scores: { worth: 0.5, relevance: 0.5, substance: 0.8, freshness: 1 },
      is_resurface: false,
      previous_episode_id: null,
      previous_recommended_at: null,
    }],
  };
  const runtime = buildBakeoffCheckpoint(vault, batch, [current, future], [batch], [{
    at: "2026-07-11T00:00:00.000Z",
    type: "skipped",
    artifact_id: "current",
  }]);
  assert.equal(runtime.result.artifact_count, 1);
  assert.equal(runtime.result.methods.explicit.scores.some((item) => item.artifact_id === "future"), false);
  assert.equal(runtime.result.methods.explicit.candidate_ids.includes("current"), true);
  assert.deepEqual(fs.readdirSync(vault, { recursive: true }).map(String).sort(), before);
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
});

test("checkpoint replay is deterministic and does not compound hypothetical later exposures", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-bakeoff-determinism-"));
  fs.mkdirSync(path.join(vault, "lists", "now"), { recursive: true });
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-07-06.md"), "# Week\n\n- [ ] Agent delivery review\n");
  const item = artifact("current", "Agent delivery", "Review workflow", "Agent delivery review workflow", "2026-07-01T08:00:00.000Z");
  const checkpoint: RecommendationBatch = {
    version: 1,
    id: "checkpoint",
    kind: "fixture",
    generated_at: "2026-07-10T09:00:00.000Z",
    context_window: { start: "2026-07-07T09:00:00.000Z", end: "2026-07-10T09:00:00.000Z" },
    pool_size: 0,
    episodes: [],
  };
  const previous = {
    ...checkpoint,
    id: "previous",
    generated_at: "2026-07-01T09:00:00.000Z",
    episodes: [{
      id: "rec-previous",
      batch_id: "previous",
      artifact_id: "current",
      recommended_at: "2026-07-01T09:00:00.000Z",
      rank: 1,
      why_now: "Earlier recommendation.",
      triggers: [],
      scores: { worth: 0.4, relevance: 0.3, substance: 0.8, freshness: 1 },
      is_resurface: false,
      previous_episode_id: null,
      previous_recommended_at: null,
    }],
  } satisfies RecommendationBatch;
  const future = {
    ...checkpoint,
    id: "future",
    generated_at: "2026-07-11T09:00:00.000Z",
    episodes: [{
      ...previous.episodes[0],
      id: "rec-future",
      batch_id: "future",
      recommended_at: "2026-07-11T09:00:00.000Z",
    }],
  } satisfies RecommendationBatch;
  const first = buildBakeoffCheckpoint(vault, checkpoint, [item], [future, checkpoint, previous], []);
  const second = buildBakeoffCheckpoint(vault, checkpoint, [item], [future, checkpoint, previous], []);
  assert.deepEqual(first.result, second.result);
  assert.equal(first.previousByArtifact.get("current")?.id, "rec-previous");
  assert.equal(first.previousByArtifact.get("current")?.id, second.previousByArtifact.get("current")?.id);
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
});

test("connection and attention metadata created after a checkpoint cannot boost the hybrid", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-bakeoff-metadata-"));
  fs.mkdirSync(path.join(vault, "projects", "hilt"), { recursive: true });
  fs.writeFileSync(path.join(vault, "projects", "hilt", "index.md"), "# Hilt\n\nActive application project.\n");
  const item = artifact("future-metadata", "Cooking notes", "A recipe", "Stock, onions, and carrots.", "2026-07-01T08:00:00.000Z");
  item.raw_frontmatter = {
    ...item.raw_frontmatter,
    reconnected_at: "2026-07-11T09:00:00.000Z",
    connection_suggestions: [{ target: "projects/hilt", label: "Hilt", relationship: "Useful to the active project." }],
    attention_judgment: { tier: "high", reason: "Important." },
  };
  const checkpoint: RecommendationBatch = {
    version: 1,
    id: "checkpoint",
    kind: "fixture",
    generated_at: "2026-07-10T09:00:00.000Z",
    context_window: { start: "2026-07-07T09:00:00.000Z", end: "2026-07-10T09:00:00.000Z" },
    pool_size: 0,
    episodes: [],
  };
  const runtime = buildBakeoffCheckpoint(vault, checkpoint, [item], [checkpoint], []);
  const lexical = runtime.result.methods.bounded_lexical.scores[0];
  const hybrid = runtime.result.methods.explicit_context_hybrid.scores[0];
  assert.equal(hybrid.context_score, lexical.context_score);
  assert.equal(hybrid.context_score, 0);
  assert.equal(hybrid.reconstructed, true);
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
});

test("Briefing reconstruction applies as-of unread state and the existing three-item limit", () => {
  const picks: BakeoffEditorPick[] = ["a", "b", "c", "d"].map((artifactId, index) => ({
    artifact_id: artifactId,
    title: artifactId.toUpperCase(),
    reason: "Fixture",
    trigger_ids: [],
    rank: index + 1,
  }));
  const selected = selectCounterfactualBriefing(picks, "2026-07-10T09:00:00.000Z", [
    { at: "2026-07-10T08:00:00.000Z", type: "read", artifact_id: "a" },
    { at: "2026-07-10T10:00:00.000Z", type: "read", artifact_id: "b" },
  ]);
  assert.deepEqual(selected.map((pick) => pick.artifact_id), ["b", "c", "d"]);
});
