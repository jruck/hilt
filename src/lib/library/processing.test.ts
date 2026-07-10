import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findCandidateByUrl, listCandidates } from "./candidate-cache";
import { libraryPollBackoffMs, librarySourcePollDue } from "./intake";
import { getLibraryArtifact } from "./library";
import {
  enqueueLibraryArtifact,
  libraryProcessingQueuePath,
  listProcessingQueue,
  readProcessingQueueRecord,
} from "./processing";
import { drainLibraryProcessingQueue, processLibraryQueueRecord } from "./processing-worker";
import { promoteCandidateImmediately } from "./promotion";
import { markLibraryArtifactsRead } from "./read-state";
import { scoreArtifacts } from "./recommendations";
import { parseReferenceFile } from "./references";
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

test("capture exhaustion becomes terminal blocked and remains retryable by explicit action", async () => {
  const vault = tempVault();
  const empty = { ...raw("https://openai.com/index/missing-fixture/"), content: "" };
  const intake = enqueueLibraryArtifact(vault, empty, source(), { useSummarize: false });
  const firstRecord = listProcessingQueue(vault)[0];
  const first = await processLibraryQueueRecord(firstRecord);
  assert.equal(first.status, "retry_scheduled");
  const secondRecord = readProcessingQueueRecord(libraryProcessingQueuePath(vault, intake.artifact_uid));
  assert.ok(secondRecord);
  const second = await processLibraryQueueRecord(secondRecord);
  assert.equal(second.status, "blocked");
  const artifact = getLibraryArtifact(vault, intake.artifact_uid);
  assert.equal(artifact?.processing?.state, "blocked");
  assert.equal(artifact?.processing?.last_error?.code, "needs_source");
  assert.equal(readProcessingQueueRecord(libraryProcessingQueuePath(vault, intake.artifact_uid))?.status, "blocked");
});

test("processing artifacts cannot be read or scored until ready", async () => {
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
  assert.equal(scoreArtifacts(vault, [ready]).length, 1);
});

test("poll scheduling persists cadence and rate-limit backoff overrides force", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");
  assert.equal(librarySourcePollDue({ next_poll_at: "2026-07-09T12:05:00.000Z" }, now, false), false);
  assert.equal(librarySourcePollDue({ next_poll_at: "2026-07-09T12:05:00.000Z" }, now, true), true);
  assert.equal(librarySourcePollDue({ poll_backoff_until: "2026-07-09T12:10:00.000Z" }, now, true), false);
  assert.equal(libraryPollBackoffMs("429 too many requests", 1), 5 * 60_000);
  assert.equal(libraryPollBackoffMs("retry-after: 90 seconds", 4), 90_000);
});
