import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findCandidateByUrl, listCandidates } from "./candidate-cache";
import { libraryPollBackoffMs, librarySourcePollDue, runLibraryIntake } from "./intake";
import { getLibraryArtifact } from "./library";
import {
  enqueueLibraryArtifact,
  libraryProcessingQueuePath,
  listProcessingQueue,
  processingQueueSummary,
  readProcessingQueueRecord,
  retryProcessingArtifact,
  writeProcessingQueueRecord,
} from "./processing";
import { drainLibraryProcessingQueue, processLibraryQueueRecord } from "./processing-worker";
import { promoteCandidateImmediately } from "./promotion";
import { markLibraryArtifactsRead } from "./read-state";
import { scoreArtifacts } from "./recommendations";
import { listSavedReferences, parseReferenceFile } from "./references";
import type { LibrarySourceConfig, RawArtifact } from "./types";

process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
process.env.LIBRARY_CONNECTIONS_DISABLED = "1";

function tempVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-processing-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  fs.mkdirSync(path.join(vault, "meta", "sources"), { recursive: true });
  return vault;
}

function source(intent: "discovery" | "explicit_save" = "explicit_save"): LibrarySourceConfig {
  return {
    id: intent === "explicit_save" ? "fixture-saves" : "fixture-discovery",
    name: intent === "explicit_save" ? "Fixture saves" : "Fixture discovery",
    channel: "fixture",
    url: "fixture://library-processing",
    enabled: true,
    cadence: "hourly",
    intent,
    signal: intent === "explicit_save" ? "fixture_save" : "fixture_discovery",
    retention: { mode: intent === "explicit_save" ? "durable" : "candidate", ttl_days: 30, candidate_ttl_days: 30, auto_promote_threshold: 0.99 },
    backfill: { enabled: false, mode: "none" },
    tags: ["test"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
}

function raw(url = "https://openai.com/index/introducing-gpt-4-1/"): RawArtifact {
  return {
    url,
    title: "Introducing GPT-4.1",
    author: "OpenAI",
    date: "2026-07-09T12:00:00.000Z",
    thumbnail: "https://example.com/source-image.jpg",
    content: "OpenAI describes a substantial model release with improved coding, instruction following, context handling, evaluations, availability, and practical guidance for developers building production systems.",
    metadata: { format: "article" },
  };
}

test.beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-processing-data-"));
});

test("intake writes a durable placeholder and queue record before processing", () => {
  const vault = tempVault();
  const result = enqueueLibraryArtifact(vault, raw(), source(), { useSummarize: false });
  assert.equal(result.status, "queued");
  assert.ok(fs.existsSync(path.join(vault, result.path)));
  const artifact = getLibraryArtifact(vault, result.artifact_uid);
  assert.equal(artifact?.id, result.artifact_uid);
  assert.equal(artifact?.processing?.state, "queued");
  assert.equal(artifact?.title, "Introducing GPT-4.1");
  const queue = readProcessingQueueRecord(libraryProcessingQueuePath(vault, result.artifact_uid));
  assert.equal(queue?.raw.url, raw().url);
  assert.equal(queue?.target_path, result.path);
});

test("processing retains stable identity and removes only a ready queue record", async () => {
  const vault = tempVault();
  const intake = enqueueLibraryArtifact(vault, raw(), source(), { useSummarize: false });
  const beforePath = intake.path;
  const [result] = await drainLibraryProcessingQueue(vault);
  assert.equal(result.status, "ready");
  assert.equal(result.ingestion_status, "saved");
  const artifact = getLibraryArtifact(vault, intake.artifact_uid);
  assert.equal(artifact?.id, intake.artifact_uid);
  assert.equal(artifact?.path, beforePath);
  assert.equal(artifact?.processing?.state, "ready");
  assert.equal(artifact?.source_title, "Introducing GPT-4.1");
  assert.equal(fs.existsSync(libraryProcessingQueuePath(vault, intake.artifact_uid)), false);
});

test("queue health identifies the active artifact", () => {
  const vault = tempVault();
  const intake = enqueueLibraryArtifact(vault, raw(), source(), { useSummarize: false });
  const record = readProcessingQueueRecord(libraryProcessingQueuePath(vault, intake.artifact_uid));
  assert.ok(record);
  writeProcessingQueueRecord({ ...record, status: "active" });

  assert.deepEqual(processingQueueSummary(vault).active_item, {
    artifact_uid: intake.artifact_uid,
    title: "Introducing GPT-4.1",
    path: intake.path,
  });
});

test("an explicit save promotes an active candidate and its queue follows the UID", async () => {
  const vault = tempVault();
  const intake = enqueueLibraryArtifact(vault, raw(), source("discovery"), { useSummarize: false });
  const candidate = findCandidateByUrl(vault, raw().url);
  assert.ok(candidate);
  const destination = promoteCandidateImmediately(vault, candidate, source(), raw());
  const queue = readProcessingQueueRecord(libraryProcessingQueuePath(vault, intake.artifact_uid));
  assert.equal(queue?.artifact_uid, intake.artifact_uid);
  assert.equal(queue?.lifecycle_status, "saved");
  assert.equal(path.join(vault, queue?.target_path || ""), destination);
  assert.equal(listCandidates(vault)[0].status, "promoted");

  await drainLibraryProcessingQueue(vault);
  const saved = parseReferenceFile(vault, destination);
  assert.equal(saved?.id, intake.artifact_uid);
  assert.equal(saved?.processing?.state, "ready");
});

test("foreground intake does not re-promote a candidate after its durable reference exists", async () => {
  const vault = tempVault();
  const intake = enqueueLibraryArtifact(vault, raw(), source("discovery"), { useSummarize: false });
  const candidate = findCandidateByUrl(vault, raw().url);
  assert.ok(candidate);
  promoteCandidateImmediately(vault, candidate, source(), raw());
  fs.writeFileSync(path.join(vault, "meta", "sources", "fixture-saves.yaml"), `
id: fixture-saves
name: Fixture saves
channel: fixture
url: fixture://library-processing
enabled: true
cadence: hourly
intent: explicit_save
signal: fixture_save
metadata:
  incremental_mode: window
fixtures:
  - url: ${raw().url}
    title: Introducing GPT-4.1
    date: 2026-07-09T12:00:00.000Z
    content: A repeated explicit save of the already-promoted candidate.
    metadata:
      format: article
`, "utf-8");

  for (let index = 0; index < 2; index += 1) {
    const report = await runLibraryIntake(vault, { force: true, sourceIds: ["fixture-saves"] });
    assert.equal(report.promoted, 0);
    assert.equal(report.queued, 0);
    assert.equal(report.duplicates, 1);
  }
  assert.equal(listSavedReferences(vault).filter((artifact) => artifact.url === raw().url).length, 1);
  assert.equal(listCandidates(vault)[0].status, "promoted");
  assert.equal(fs.existsSync(libraryProcessingQueuePath(vault, intake.artifact_uid)), true);
});

test("capture exhaustion becomes terminal blocked and remains retryable by explicit action", async () => {
  const vault = tempVault();
  const empty = { ...raw("https://openai.com/index/missing-fixture/"), content: "" };
  const intake = enqueueLibraryArtifact(vault, empty, source(), { useSummarize: false });
  const firstRecord = listProcessingQueue(vault)[0];
  const attemptStartedAt = new Date("2026-07-10T12:00:00.000Z");
  const attemptFailedAt = new Date("2026-07-10T12:03:00.000Z");
  const firstClock = [attemptStartedAt, attemptFailedAt];
  const first = await processLibraryQueueRecord(firstRecord, { now: () => firstClock.shift() || attemptFailedAt });
  assert.equal(first.status, "retry_scheduled");
  const secondRecord = readProcessingQueueRecord(libraryProcessingQueuePath(vault, intake.artifact_uid));
  assert.ok(secondRecord);
  assert.equal(secondRecord.next_retry_at, "2026-07-10T12:08:00.000Z");
  const second = await processLibraryQueueRecord(secondRecord);
  assert.equal(second.status, "blocked");
  const artifact = getLibraryArtifact(vault, intake.artifact_uid);
  assert.equal(artifact?.processing?.state, "blocked");
  assert.equal(artifact?.processing?.stage, "capture");
  assert.deepEqual(artifact?.processing?.completed_stages, ["metadata"]);
  assert.equal(artifact?.processing?.last_error?.code, "needs_source");
  assert.equal(readProcessingQueueRecord(libraryProcessingQueuePath(vault, intake.artifact_uid))?.status, "blocked");

  assert.ok(retryProcessingArtifact(vault, intake.artifact_uid));
  const retried = getLibraryArtifact(vault, intake.artifact_uid);
  assert.equal(retried?.processing?.state, "queued");
  assert.equal(retried?.processing?.stage, "metadata");
  assert.deepEqual(retried?.processing?.completed_stages, []);
  assert.equal(retried?.processing?.completed_at, null);
});

test("processing and deferred-reweave artifacts cannot be read or scored as complete", async () => {
  const vault = tempVault();
  const intake = enqueueLibraryArtifact(vault, raw(), source(), { useSummarize: false });
  assert.equal(markLibraryArtifactsRead(vault, [intake.artifact_uid]).marked, 0);
  const pending = getLibraryArtifact(vault, intake.artifact_uid);
  assert.ok(pending);
  assert.deepEqual(scoreArtifacts(vault, [pending]), []);

  await drainLibraryProcessingQueue(vault);
  assert.equal(markLibraryArtifactsRead(vault, [intake.artifact_uid]).marked, 1);
  const ready = getLibraryArtifact(vault, intake.artifact_uid);
  assert.ok(ready);
  assert.equal(ready.raw_frontmatter.reweave_pending, true);
  assert.equal(scoreArtifacts(vault, [ready]).length, 0);
  // s3 scores from one canonical full-corpus map. A caller-side clone cannot bypass
  // the persisted deferred-reweave gate and create a list/detail score mismatch.
  assert.equal(scoreArtifacts(vault, [{
    ...ready,
    raw_frontmatter: { ...ready.raw_frontmatter, reweave_pending: undefined },
  }]).length, 0);
});

test("poll scheduling persists cadence and rate-limit backoff overrides force", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");
  assert.equal(librarySourcePollDue({ next_poll_at: "2026-07-09T12:05:00.000Z" }, now, false), false);
  assert.equal(librarySourcePollDue({ next_poll_at: "2026-07-09T12:05:00.000Z" }, now, true), true);
  assert.equal(librarySourcePollDue({ poll_backoff_until: "2026-07-09T12:10:00.000Z" }, now, true), false);
  assert.equal(libraryPollBackoffMs("429 too many requests", 1), 5 * 60_000);
  assert.equal(libraryPollBackoffMs("retry-after: 90 seconds", 4), 90_000);
});
