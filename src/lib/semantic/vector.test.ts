import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { blobToFloat32, cosineSimilarity, float32ToBlob, knnCosine, l2normalize } from "./vector";

describe("vector helpers", () => {
  test("BLOB round-trips bit-identical", () => {
    const v = new Float32Array([0.5, -0.25, 1, 0, 3.14159]);
    const back = blobToFloat32(float32ToBlob(v));
    assert.deepEqual(Array.from(back), Array.from(v));
  });

  test("cosine: identical = 1, orthogonal = 0, opposite = -1, mismatch = 0", () => {
    const a = new Float32Array([1, 0, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-6);
    assert.ok(Math.abs(cosineSimilarity(a, new Float32Array([0, 1, 0]))) < 1e-6);
    assert.ok(Math.abs(cosineSimilarity(a, new Float32Array([-1, 0, 0])) + 1) < 1e-6);
    assert.equal(cosineSimilarity(a, new Float32Array([1, 0])), 0);
  });

  test("l2normalize yields unit length; zero vector passes through", () => {
    const n = l2normalize(new Float32Array([3, 4]));
    assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-6);
    assert.deepEqual(Array.from(l2normalize(new Float32Array([0, 0]))), [0, 0]);
  });

  test("knnCosine ranks by similarity, stable id tie-break, honors excludeId/k", () => {
    const q = new Float32Array([1, 0]);
    const cands = [
      { id: "near", vec: new Float32Array([0.9, 0.1]) },
      { id: "far", vec: new Float32Array([-1, 0]) },
      { id: "mid", vec: new Float32Array([0.5, 0.5]) },
      { id: "self", vec: new Float32Array([1, 0]) },
    ];
    const top = knnCosine(q, cands, 2, "self");
    assert.deepEqual(top.map((h) => h.id), ["near", "mid"]);
    assert.ok(top[0].score > top[1].score);
    // excludeId removed the perfect self-match; k caps the result.
    assert.ok(!knnCosine(q, cands, 10, "self").some((h) => h.id === "self"));
  });
});
