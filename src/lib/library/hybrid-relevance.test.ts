import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  explicitContextHybridScore,
  scoreBoundedLexical,
  scoreExplicitContextHybrid,
  type HybridContextSignal,
} from "./hybrid-relevance";
import { DEFAULT_SCORING_CONFIG } from "./scoring-config";
import type { LibraryArtifactDetail } from "./types";

function artifact(
  id: string,
  fields: Partial<Pick<LibraryArtifactDetail, "title" | "summary" | "tags" | "source_tags" | "content" | "raw_frontmatter">> = {},
): LibraryArtifactDetail {
  return {
    id,
    path: `/tmp/${id}.md`,
    abs_path: `/tmp/${id}.md`,
    title: fields.title || id,
    summary: fields.summary || "",
    tags: fields.tags || [],
    source_tags: fields.source_tags || [],
    content: fields.content || "",
    raw_frontmatter: fields.raw_frontmatter || {},
    source_type: "reference",
    source_id: "fixture",
    source_name: "Fixture",
    channel: "fixture",
    source_collection: null,
    source_collection_id: null,
    source_folder: null,
    source_folder_id: null,
    library_mode: "study",
    thumbnail: null,
    author: null,
    url: null,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
    lifecycle_status: "saved",
    is_unread: true,
    read_at: null,
    key_points: [],
    connections: [],
  };
}

function signal(
  id: string,
  kind: HybridContextSignal["kind"],
  text: string,
  target: string | null = `projects/${id}`,
): HybridContextSignal {
  return { id, kind, label: id, target, text, weight: DEFAULT_SCORING_CONFIG.signal_weights[kind] };
}

function fillerArtifacts(count = 8): LibraryArtifactDetail[] {
  return Array.from({ length: count }, (_, index) => artifact(`filler-${index}`, {
    content: `quartz-${index} lantern-${index} meadow-${index}`,
  }));
}

test("BM25F preserves the evaluated field weights and strongest-plus-second-match formula", () => {
  const titleMatch = artifact("title-match", { title: "zephyr marigold" });
  const bodyMatch = artifact("body-match", { content: "cobalt saffron" });
  const artifacts = [titleMatch, bodyMatch, ...fillerArtifacts()];
  const fits = scoreBoundedLexical(artifacts, [
    signal("title-signal", "project", "zephyr marigold"),
    signal("body-signal", "project", "cobalt saffron"),
  ]);
  const titleFit = fits.get(titleMatch.id)!;
  const bodyFit = fits.get(bodyMatch.id)!;

  assert.ok(titleFit.raw > bodyFit.raw, "title weight 3 must outrank the same amount of body evidence at weight 1");
  assert.equal(titleFit.raw, titleFit.matches[0].score + DEFAULT_SCORING_CONFIG.hybrid.second_match_weight * (titleFit.matches[1]?.score || 0));
});

test("common terms are excluded and task/project versus area/person thresholds are enforced", () => {
  const fillers = fillerArtifacts(16);
  fillers[0].content += " shared";
  fillers[1].content += " shared";
  const artifacts = [
    artifact("task-match", { content: "alpha beta shared" }),
    artifact("shared-only", { content: "shared lone" }),
    artifact("area-two", { content: "cedar maple" }),
    artifact("area-three", { content: "cedar maple spruce" }),
    ...fillers,
  ];
  const fits = scoreBoundedLexical(artifacts, [
    signal("task", "task", "alpha beta shared", null),
    signal("area", "area", "cedar maple spruce", "areas/growth"),
  ]);

  assert.deepEqual(fits.get("task-match")!.matchedTerms, ["alpha", "beta"]);
  assert.equal(fits.get("shared-only")!.score, 0);
  assert.equal(fits.get("area-two")!.score, 0, "areas require three meaningful terms");
  assert.ok(fits.get("area-three")!.score > 0);
});

test("normalization uses the complete corpus p95 and remains deterministic", () => {
  const artifacts = Array.from({ length: 24 }, (_, index) => artifact(`item-${index}`, {
    content: `needle-${index} anchor-${index} ${"detail ".repeat(index + 1)}`,
  }));
  const signals = artifacts.map((_, index) => signal(
    `signal-${String(index).padStart(2, "0")}`,
    "project",
    `needle-${index} anchor-${index}`,
  ));
  const first = scoreBoundedLexical(artifacts, signals);
  const second = scoreBoundedLexical(artifacts, [...signals].reverse());
  const positives = [...first.values()].map((fit) => fit.raw).filter((raw) => raw > 0).sort((a, b) => a - b);
  const p95 = positives[Math.floor((positives.length - 1) * 0.95)];

  for (const item of artifacts) {
    const fit = first.get(item.id)!;
    const expected = Number(Math.min(0.3, (fit.raw / p95) * 0.3).toFixed(3));
    assert.equal(fit.score, expected);
    assert.deepEqual(second.get(item.id), fit, "signal ordering cannot change a scored result");
  }
});

test("explicit active connections and attention judgments produce bounded structured evidence", () => {
  const active = artifact("active", {
    raw_frontmatter: {
      connection_suggestions: [{ target: "./projects/launch/index.md", label: "Launch", relationship: "supports" }],
      attention_judgment: { tier: "high", reason: "Directly supports the launch." },
    },
  });
  const low = artifact("low", { raw_frontmatter: { attention_judgment: { tier: "low", reason: "Peripheral." } } });
  const evidence = scoreExplicitContextHybrid(
    [active, low, ...fillerArtifacts()],
    [signal("launch", "project", "unmatched terms", "projects/launch")],
  );

  assert.deepEqual(evidence.get("active")!.active_connection_targets, [{ target: "projects/launch", label: "Launch" }]);
  assert.equal(evidence.get("active")!.active_connection_boost, 0.1);
  assert.equal(evidence.get("active")!.attention_adjustment, 0.05);
  assert.equal(evidence.get("active")!.context_score, 0.15);
  assert.equal(evidence.get("active")!.attention_reason, "Directly supports the launch.");
  assert.equal(evidence.get("low")!.context_score, 0);
  assert.equal(explicitContextHybridScore(0.28, true, "high"), 0.3);
});

test("the production hybrid scorer has no retired provider dependency", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/lib/library/hybrid-relevance.ts"), "utf-8");
  assert.doesNotMatch(source, /semantic-relevance|gemini|@google/i);
});
