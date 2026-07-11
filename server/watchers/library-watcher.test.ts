import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringifyMarkdown } from "../../src/lib/library/markdown";
import { enqueueLibraryArtifact, listProcessingQueue, removeProcessingQueueRecord } from "../../src/lib/library/processing";
import { LibraryProcessingRunner } from "../../src/lib/library/processing-trigger";
import type { LibrarySourceConfig } from "../../src/lib/library/types";
import { LibraryWatcher, type LibraryArtifactChangedEvent } from "./library-watcher";

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
    fs.writeFileSync(saved, stringifyMarkdown({ type: "reference", artifact_uid: "stable-saved", title: "Saved", url: "https://example.com/saved" }, "# Saved\n"));
    fs.writeFileSync(saved, stringifyMarkdown({ type: "reference", artifact_uid: "stable-saved", title: "Saved updated", url: "https://example.com/saved" }, "# Saved updated\n"));
    const candidate = path.join(vault, "references", ".cache", "library-candidates", "candidate.md");
    fs.writeFileSync(candidate, stringifyMarkdown({ type: "reference-candidate", artifact_uid: "stable-candidate", title: "Candidate", url: "https://example.com/candidate", status: "candidate" }, "# Candidate\n"));
    await settle();
    const savedEvents = events.filter((event) => event.id === "stable-saved");
    assert.equal(savedEvents.length, 1);
    assert.equal(savedEvents[0].operation, "add", "a fast placeholder enrichment must preserve the add event");
    assert.equal(events.filter((event) => event.id === "stable-candidate").length, 1);
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
