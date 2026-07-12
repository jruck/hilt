import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEditorialCandidatePool,
  contextTextHasStrongLibraryMatch,
  recommendationCooldownEligible,
  recommendationPitchHasContextDelta,
  recommendationTextSimilarity,
  validateRecommendationPicks,
} from "./recommendation-editor";
import { DEFAULT_SCORING_CONFIG } from "./scoring-config";
import type { RecommendationEpisode, RecommendationTrigger, RecommendedArtifact } from "./types";

function artifact(id: string, title: string, summary: string, createdAt: string, worth = 0.2): RecommendedArtifact {
  return {
    id, path: `references/${id}.md`, abs_path: `/tmp/${id}.md`, title, summary, source_type: "fixture",
    channel: "manual", source_id: "fixture", source_name: "Fixture", tags: [], source_tags: [],
    source_collection: null, source_collection_id: null, source_folder: null, source_folder_id: null,
    library_mode: "study", thumbnail: null, author: null, url: `https://example.com/${id}`,
    created_at: createdAt, updated_at: createdAt, lifecycle_status: "saved", is_unread: true, read_at: null,
    why: "structural score", worth, relevance: worth, substance: 0.8, freshness: 0.8,
    lifecycle: "active", matched_terms: [],
  };
}

function trigger(id: string, fingerprint = id, kind: RecommendationTrigger["kind"] = "meeting"): RecommendationTrigger & { text: string } {
  return { id, fingerprint, kind, label: id, occurred_at: "2026-07-10T08:00:00.000Z", text: "agent native software delivery workflow" };
}

function previous(itemId: string, why = "Old explanation", triggerFingerprint = "old"): RecommendationEpisode {
  return {
    id: `rec-old-${itemId}`, batch_id: "batch-old", artifact_id: itemId,
    recommended_at: "2026-06-20T09:20:00.000Z", rank: 1, why_now: why,
    triggers: [trigger("meeting:old", triggerFingerprint)], scores: { worth: 0.7, relevance: 0.7, substance: 0.8, freshness: 0.6 },
    is_resurface: false, previous_episode_id: null, previous_recommended_at: null,
  };
}

test("candidate generation always includes fresh items and requires novel context for old ones", () => {
  const freshLow = artifact("fresh", "Fresh unrelated item", "A niche new save", "2026-07-09T10:00:00.000Z", 0.05);
  const oldMatch = artifact("old-match", "Agent native software delivery", "A workflow for agent native software delivery", "2026-04-01T10:00:00.000Z", 0.3);
  const oldNoMatch = artifact("old-no", "Cooking pasta", "A kitchen recipe", "2026-04-01T10:00:00.000Z", 0.9);
  const items = buildEditorialCandidatePool({
    pool: [oldNoMatch, oldMatch, freshLow],
    triggers: [trigger("meeting:delivery", "delivery-v2")],
    previousByArtifact: new Map(),
    now: new Date("2026-07-10T12:00:00.000Z"),
    config: DEFAULT_SCORING_CONFIG.for_you,
  });
  assert.deepEqual(items.map((item) => item.id), ["fresh", "old-match"]);
});

test("repeated context fingerprints cannot float an older item", () => {
  const item = artifact("old", "Agent native software delivery", "Agent native software delivery workflow", "2026-04-01T10:00:00.000Z");
  const old = previous(item.id, "This connects to the delivery workflow", "same-fingerprint");
  const candidates = buildEditorialCandidatePool({
    pool: [item], triggers: [trigger("meeting:repeat", "same-fingerprint")],
    previousByArtifact: new Map([[item.id, old]]), now: new Date("2026-07-10T12:00:00.000Z"),
    config: DEFAULT_SCORING_CONFIG.for_you,
  });
  assert.deepEqual(candidates, []);
});

test("pick validation rejects repeated triggers and unchanged pitches, then accepts genuinely new evidence", () => {
  const item = artifact("old", "Agent native software delivery", "Agent native software delivery workflow", "2026-04-01T10:00:00.000Z");
  const old = previous(item.id, "Use this for the agent native delivery workflow", "old-fingerprint");
  const repeated = trigger("meeting:repeat", "old-fingerprint");
  const novel = trigger("task:launch", "new-fingerprint", "task");
  const base = { candidates: [item], previousByArtifact: new Map([[item.id, old]]), maxItems: 12, nearDuplicate: () => false };
  assert.equal(validateRecommendationPicks({
    ...base, triggers: [repeated], raw: [{ id: item.id, reason: "A different sentence", trigger_ids: [repeated.id] }],
  }).length, 0);
  assert.equal(validateRecommendationPicks({
    ...base, triggers: [novel], raw: [{ id: item.id, reason: old.why_now, trigger_ids: [novel.id] }],
  }).length, 0);
  assert.equal(validateRecommendationPicks({
    ...base, triggers: [novel], raw: [{ id: item.id, reason: "A launch task now needs the deployment checks from this reference", trigger_ids: [novel.id] }],
  }).length, 1);
});

test("cooldowns distinguish exposure, read, and dismissal windows", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const old = previous("a");
  const config = DEFAULT_SCORING_CONFIG.for_you;
  assert.equal(recommendationCooldownEligible({ previous: old, exposure: { type: "served", at: "2026-07-15T12:00:00.000Z" }, now, config }), false);
  assert.equal(recommendationCooldownEligible({ previous: old, exposure: { type: "served", at: "2026-07-12T12:00:00.000Z" }, now, config }), true);
  assert.equal(recommendationCooldownEligible({ previous: old, exposure: { type: "read", at: "2026-07-10T12:00:00.000Z" }, now, config }), false);
  assert.equal(recommendationCooldownEligible({
    previous: old,
    dismissal: { artifact_id: "a", episode_id: old.id, dismissed_at: "2026-07-01T12:00:00.000Z", restored_at: null, note: null },
    now, config,
  }), false);
});

test("meaningful context preflight needs three non-generic overlapping terms", () => {
  const item = artifact("a", "Agent native software delivery", "A deployment workflow for coding agents", "2026-07-09T10:00:00.000Z");
  assert.equal(contextTextHasStrongLibraryMatch("The agent native software delivery plan changed", [item]), true);
  assert.equal(contextTextHasStrongLibraryMatch("Software meeting today", [item]), false);
});

test("recommendation pitches cannot restate the source description", () => {
  const item = artifact("a", "Agent native software delivery", "A workflow for agent native software delivery", "2026-07-09T10:00:00.000Z");
  const artifactTrigger = trigger(`artifact:${item.id}`, "artifact-a", "artifact");
  const picks = validateRecommendationPicks({
    candidates: [item],
    triggers: [artifactTrigger],
    previousByArtifact: new Map(),
    maxItems: 12,
    nearDuplicate: () => false,
    raw: [{ id: item.id, reason: "Agent native software delivery is a workflow for agent native software delivery", trigger_ids: [artifactTrigger.id] }],
  });
  assert.equal(picks.length, 0);
  assert.ok(recommendationTextSimilarity(`${item.title} ${item.summary}`, "Agent native software delivery is a workflow for agent native software delivery") >= 0.65);
});

test("contextual recommendation pitches must carry a novel trigger detail", () => {
  const item = artifact("a", "Agent native software delivery", "A workflow for agent native software delivery", "2026-07-09T10:00:00.000Z");
  const launch = trigger("task:launch", "launch-v2", "task");
  assert.equal(recommendationPitchHasContextDelta("This is relevant to the agent native delivery workflow", item, [launch]), false);
  assert.equal(recommendationPitchHasContextDelta("The launch task now needs the delivery checks in this reference", item, [launch]), true);
});
