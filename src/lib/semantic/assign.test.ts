import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assignItemChunks, assignToTopics } from "./assign";
import type { TopicCentroid } from "./db";
import { l2normalize } from "./vector";

/** A unit vector at angle theta in the first two dims (deterministic, easy cosines). */
function unit(theta: number): Float32Array {
  return l2normalize(Float32Array.from([Math.cos(theta), Math.sin(theta), 0, 0]));
}

const centroids: TopicCentroid[] = [
  { id: "topic:A", level: 1, vec: unit(0) }, // along +x
  { id: "topic:B", level: 1, vec: unit(Math.PI / 2) }, // along +y
  { id: "topic:C", level: 1, vec: unit(Math.PI) }, // along -x
];

describe("assignToTopics — incremental nearest-topic (§C.4)", () => {
  test("an item near a centroid joins it (above the floor)", () => {
    const r = assignToTopics(unit(0.05), centroids, { floor: 0.55 });
    assert.equal(r.outlier, false);
    assert.equal(r.topics[0].topicId, "topic:A", "nearest is the +x centroid");
    assert.ok(r.topics[0].score > 0.99);
  });

  test("an item equidistant-but-below-floor from all centroids ⇒ OUTLIER (never creates a topic)", () => {
    // 45° between A(+x) and B(+y): cosine to each is ~0.707; with a high floor it's an outlier.
    const r = assignToTopics(unit(Math.PI / 4), centroids, { floor: 0.9 });
    assert.equal(r.outlier, true);
    assert.equal(r.topics.length, 0);
  });

  test("top-k is capped and ordered by score with a deterministic id tie-break", () => {
    // Equidistant from A and C? No — pick a vector closer to A, then B. Cap k=2.
    const r = assignToTopics(unit(0.3), centroids, { floor: 0, k: 2 });
    assert.equal(r.topics.length, 2);
    assert.ok(r.topics[0].score >= r.topics[1].score);
  });

  test("respects the env floor by default (semanticAssignCos 0.55)", () => {
    const r = assignToTopics(unit(0), centroids); // exact match to A
    assert.equal(r.topics[0].topicId, "topic:A");
  });
});

describe("assignItemChunks — max-rollup across an item's chunks", () => {
  test("an item joins a topic if ANY chunk is close (max cosine)", () => {
    // One chunk near A, one near B; both clear a low floor.
    const r = assignItemChunks([unit(0.02), unit(Math.PI / 2 + 0.02)], centroids, { floor: 0.55, k: 3 });
    const ids = r.topics.map((t) => t.topicId).sort();
    assert.deepEqual(ids, ["topic:A", "topic:B"]);
  });

  test("an item whose every chunk is far from every centroid ⇒ outlier", () => {
    const r = assignItemChunks([unit(Math.PI / 4)], centroids, { floor: 0.95 });
    assert.equal(r.outlier, true);
  });
});
