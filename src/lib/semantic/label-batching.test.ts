import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runLabelBatches, type TopicLabel, type TopicLabelInput } from "./gemini";

const inputs = (n: number): TopicLabelInput[] =>
  Array.from({ length: n }, (_, i) => ({ clusterId: `c${i}`, sampleTexts: [`text ${i}`] }));

const echo = (batch: TopicLabelInput[]): TopicLabel[] =>
  batch.map((b) => ({ clusterId: b.clusterId, label: `label ${b.clusterId}`, summary: "" }));

describe("runLabelBatches — the per-batch fail-soft that fixes the 847-cluster mega-call", () => {
  test("splits into ceil(n/size) sequential calls and merges all labels", async () => {
    const calls: number[] = [];
    const out = await runLabelBatches(inputs(100), 48, async (batch) => {
      calls.push(batch.length);
      return echo(batch);
    });
    assert.deepEqual(calls, [48, 48, 4]);
    assert.equal(out.length, 100);
    assert.equal(out[99].label, "label c99");
  });

  test("a batch that throws retries once, then fail-softs for ITS clusters only", async () => {
    let secondBatchAttempts = 0;
    const out = await runLabelBatches(inputs(30), 10, async (batch) => {
      if (batch[0].clusterId === "c10") {
        secondBatchAttempts += 1;
        throw new Error("output limit");
      }
      return echo(batch);
    });
    assert.equal(secondBatchAttempts, 2, "failed batch retried exactly once");
    assert.equal(out.length, 20, "other batches' labels still land");
    assert.ok(out.every((l) => !l.clusterId.match(/^c1[0-9]$/)), "only the failed batch is missing");
  });

  test("a transient failure (throws once, succeeds on retry) loses nothing", async () => {
    const failedOnce = new Set<string>();
    const out = await runLabelBatches(inputs(20), 10, async (batch) => {
      const key = batch[0].clusterId;
      if (!failedOnce.has(key)) {
        failedOnce.add(key);
        return []; // empty response counts as a failure → retry
      }
      return echo(batch);
    });
    assert.equal(out.length, 20, "retry recovered every batch");
  });

  test("empty input ⇒ no calls, empty result", async () => {
    let calls = 0;
    const out = await runLabelBatches([], 48, async (b) => {
      calls += 1;
      return echo(b);
    });
    assert.equal(calls, 0);
    assert.deepEqual(out, []);
  });
});
