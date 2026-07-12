import assert from "node:assert/strict";
import test from "node:test";
import { libraryCardCopy, readerRecommendationContext } from "./card-copy";
import type { LibraryArtifact } from "./types";

const artifact = {
  id: "a", path: "references/a.md", abs_path: "/tmp/references/a.md", title: "A",
  summary: "Evergreen source description.", source_type: "fixture", channel: "manual",
  source_id: "fixture", source_name: "Fixture", tags: [], source_tags: [], source_collection: null,
  source_collection_id: null, source_folder: null, source_folder_id: null, library_mode: "study",
  thumbnail: null, author: null, url: null, created_at: "2026-07-11T10:00:00.000Z",
  updated_at: "2026-07-11T10:00:00.000Z", lifecycle_status: "saved", is_unread: true, read_at: null,
  recommendation: {
    episode_id: "rec-a", batch_id: "batch-a", recommended_at: "2026-07-11T09:20:00.000Z",
    rank: 1, why_now: "A changed launch decision makes this useful today.", triggers: [],
    is_resurface: false, previous_recommended_at: null,
  },
} satisfies LibraryArtifact;

test("standard cards use the source description even when recommended", () => {
  assert.equal(libraryCardCopy(artifact, "standard").description, artifact.summary);
});

test("recommendation cards use only the episode pitch", () => {
  const copy = libraryCardCopy(artifact, "recommendation");
  assert.equal(copy.description, artifact.recommendation?.why_now);
  assert.notEqual(copy.description, copy.sourceDescription);
});

test("reader context uses current, exact, and unavailable-exact presentations deliberately", () => {
  const current = artifact.recommendation!;
  const exact = { ...current, episode_id: "rec-frozen", why_now: "The frozen briefing pitch." };

  assert.equal(readerRecommendationContext({ currentRecommendation: current }), current);
  assert.equal(readerRecommendationContext({ requestedEpisodeId: exact.episode_id, exactRecommendation: exact, currentRecommendation: current }), exact);
  assert.equal(
    readerRecommendationContext({ requestedEpisodeId: exact.episode_id, currentRecommendation: current }),
    null,
    "an exact deep link must not flash the current pitch while its episode is still loading",
  );
  assert.equal(
    readerRecommendationContext({ requestedEpisodeId: exact.episode_id, currentRecommendation: current, exactUnavailable: true }),
    current,
    "a known missing historical episode falls back to the current active pitch",
  );
});
