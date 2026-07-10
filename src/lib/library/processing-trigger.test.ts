import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { enqueueLibraryArtifact, listProcessingQueue, removeProcessingQueueRecord } from "./processing";
import { LibraryProcessingRunner } from "./processing-trigger";
import type { LibrarySourceConfig } from "./types";

test("queue change bursts start only one serial processing worker", async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-runner-data-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-runner-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  const source: LibrarySourceConfig = {
    id: "fixture", name: "Fixture", channel: "fixture", url: "fixture://runner", enabled: true,
    cadence: "hourly", intent: "explicit_save", signal: "fixture_save",
    retention: { mode: "durable", ttl_days: 30, candidate_ttl_days: 30, auto_promote_threshold: 0.9 },
    backfill: { enabled: false, mode: "none" }, tags: [], filters: { include_topics: [], exclude_topics: [] }, metadata: {}, path: "",
  };
  enqueueLibraryArtifact(vault, {
    url: "https://openai.com/index/runner-fixture/", title: "Runner fixture", date: "2026-07-09",
    content: "A deterministic fixture with enough source content for the queue runner test.", metadata: {},
  }, source, { useSummarize: false });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let runs = 0;
  const runner = new LibraryProcessingRunner(vault, async () => {
    runs += 1;
    await gate;
    for (const record of listProcessingQueue(vault)) removeProcessingQueueRecord(record);
  });
  runner.kick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  runner.kick();
  runner.kick();
  release();
  await runner.idle();
  assert.equal(runs, 1);
});
