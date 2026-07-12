import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringifyMarkdown } from "../../src/lib/library/markdown";
import { enqueueLibraryArtifact, listProcessingQueue, removeProcessingQueueRecord } from "../../src/lib/library/processing";
import { LibraryProcessingRunner } from "../../src/lib/library/processing-trigger";
import { recommendationRoot, writeRecommendationBatch, writeRecommendationRuntime } from "../../src/lib/library/recommendation-store";
import type { LibrarySourceConfig } from "../../src/lib/library/types";
import { LibraryWatcher, type LibraryArtifactChangedEvent, type LibraryRecommendationsChangedEvent } from "./library-watcher";

async function settle(ms = 420): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("saved and hidden candidate writes each emit one debounced Library artifact event", async () => {
  process.env.HILT_LIBRARY_WATCHER_POLLING = "1";
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-data-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-vault-"));
  fs.mkdirSync(path.join(vault, "references", ".cache", "library-candidates"), { recursive: true });
  const watcher = new LibraryWatcher(vault, 30);
  const events: LibraryArtifactChangedEvent[] = [];
  watcher.on("artifact-changed", (event) => events.push(event));
  watcher.start();
  await watcher.ready();
  try {
    const saved = path.join(vault, "references", "saved.md");
    const processingBase = {
      completed_stages: [], started_at: "2026-07-10T12:00:00.000Z", updated_at: "2026-07-10T12:00:00.000Z",
      attempt: 1, next_retry_at: null, last_error: null,
    };
    fs.writeFileSync(saved, stringifyMarkdown({
      type: "reference", artifact_uid: "stable-saved", title: "Saved", url: "https://example.com/saved",
      processing: { ...processingBase, state: "queued", stage: "metadata" },
    }, "# Saved\n"));
    fs.writeFileSync(saved, stringifyMarkdown({
      type: "reference", artifact_uid: "stable-saved", title: "Saved updated", url: "https://example.com/saved",
      processing: { ...processingBase, state: "ready", stage: "reweave", completed_stages: ["metadata", "capture", "digest", "reweave"] },
    }, "# Saved updated\n"));
    const candidate = path.join(vault, "references", ".cache", "library-candidates", "candidate.md");
    fs.writeFileSync(candidate, stringifyMarkdown({ type: "reference-candidate", artifact_uid: "stable-candidate", title: "Candidate", url: "https://example.com/candidate", status: "candidate" }, "# Candidate\n"));
    await settle();
    const savedEvents = events.filter((event) => event.id === "stable-saved");
    assert.equal(savedEvents.length, 1);
    assert.equal(savedEvents[0].operation, "add", "a fast placeholder enrichment must preserve the add event");
    assert.equal(savedEvents[0].became_ready, true, "the coalesced event must preserve the queued-to-ready transition");
    assert.equal(events.filter((event) => event.id === "stable-candidate").length, 1);
    assert.equal(events.find((event) => event.id === "stable-candidate")?.became_ready, false);
  } finally {
    watcher.stop();
  }
});

test("editing an already-ready artifact does not report a newly-ready transition", async () => {
  process.env.HILT_LIBRARY_WATCHER_POLLING = "1";
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-ready-data-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-ready-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  const filePath = path.join(vault, "references", "existing.md");
  const processing = {
    state: "ready", stage: "reweave", completed_stages: ["metadata", "capture", "digest", "reweave"],
    started_at: "2026-07-10T12:00:00.000Z", updated_at: "2026-07-10T12:00:00.000Z",
    attempt: 1, next_retry_at: null, last_error: null,
  };
  fs.writeFileSync(filePath, stringifyMarkdown({
    type: "reference", artifact_uid: "existing-ready", title: "Existing", url: "https://example.com/existing", processing,
  }, "# Existing\n"));
  const watcher = new LibraryWatcher(vault, 30);
  const events: LibraryArtifactChangedEvent[] = [];
  watcher.on("artifact-changed", (event) => events.push(event));
  watcher.start();
  await watcher.ready();
  try {
    fs.writeFileSync(filePath, stringifyMarkdown({
      type: "reference", artifact_uid: "existing-ready", title: "Existing edited", url: "https://example.com/existing", processing,
    }, "# Existing edited\n"));
    await settle();
    assert.equal(events.length, 1);
    assert.equal(events[0].became_ready, false);
  } finally {
    watcher.stop();
  }
});

test("debounced queue events coalesce into one child worker start", async () => {
  process.env.HILT_LIBRARY_WATCHER_POLLING = "1";
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-queue-data-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-queue-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  const watcher = new LibraryWatcher(vault, 30);
  let runs = 0;
  const runner = new LibraryProcessingRunner(vault, async () => {
    runs += 1;
    for (const record of listProcessingQueue(vault)) removeProcessingQueueRecord(record);
  });
  watcher.on("queue-changed", () => runner.kick());
  watcher.start();
  await watcher.ready();
  const source: LibrarySourceConfig = {
    id: "fixture", name: "Fixture", channel: "fixture", url: "fixture://watcher", enabled: true,
    cadence: "hourly", intent: "explicit_save", signal: "fixture_save",
    retention: { mode: "durable", ttl_days: 30, candidate_ttl_days: 30, auto_promote_threshold: 0.9 },
    backfill: { enabled: false, mode: "none" }, tags: [], filters: { include_topics: [], exclude_topics: [] }, metadata: {}, path: "",
  };
  try {
    enqueueLibraryArtifact(vault, {
      url: "https://openai.com/index/watcher-fixture/", title: "Watcher fixture", date: "2026-07-09",
      content: "A fixture source body that creates a durable placeholder and queue record.", metadata: {},
    }, source, { useSummarize: false });
    await settle(240);
    await runner.idle();
    assert.equal(runs, 1);
  } finally {
    watcher.stop();
  }
});

test("batch, projection, and runtime writes emit one debounced recommendation event", async () => {
  process.env.HILT_LIBRARY_WATCHER_POLLING = "1";
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-rec-data-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-watcher-rec-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  const watcher = new LibraryWatcher(vault, 40);
  const events: LibraryRecommendationsChangedEvent[] = [];
  watcher.on("recommendations-changed", (event) => events.push(event));
  watcher.start();
  await watcher.ready();
  try {
    writeRecommendationBatch(vault, {
      kind: "fixture",
      generated_at: "2026-07-10T09:20:00.000Z",
      context_window: { start: "2026-07-10T06:00:00.000Z", end: "2026-07-10T09:20:00.000Z" },
      pool_size: 1,
      picks: [{
        artifact_id: "artifact-a",
        why_now: "A timely reason",
        triggers: [{ id: "artifact:artifact-a", kind: "artifact", label: "A", occurred_at: "2026-07-10T09:00:00.000Z", fingerprint: "a" }],
        scores: { worth: 0.8, relevance: 0.8, substance: 0.8, freshness: 0.8 },
      }],
    });
    await settle(500);
    assert.equal(events.length, 1);
    assert.equal(events[0].affects_feed, true);
    assert.ok(fs.existsSync(recommendationRoot(vault)));
    writeRecommendationRuntime(vault, { pending: true, pending_reasons: ["artifact:references/later.md"] });
    await settle(500);
    assert.equal(events.length, 2);
    assert.equal(events[1].affects_feed, false, "runtime-only health updates must not announce a feed insertion");
  } finally {
    watcher.stop();
  }
});
