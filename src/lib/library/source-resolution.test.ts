import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  attachLibraryAttention,
  libraryRefetchAttemptsPath,
  pruneLibraryRefetchAttempts,
  readLibraryRefetchAttempts,
  resetLibraryRefetchAttempt,
  writeLibraryRefetchAttempts,
} from "./attention";
import { listLibraryArtifactDetails } from "./library";
import {
  libraryProcessingQueuePath,
  readProcessingQueueRecord,
  writeProcessingQueueRecord,
  type LibraryProcessingQueueRecord,
} from "./processing";
import { buildForYouPool, evalAttrsForArtifact } from "./recommendations";
import { retryLibrarySource } from "./source-recovery";
import {
  archivedProcessingRecordPath,
  archiveTerminalProcessingRecord,
  clearLibrarySourceResolution,
  LibrarySourceResolutionError,
  librarySourceResolutionPath,
  readLibrarySourceResolutions,
  resolveLibrarySourceFailure,
  restoreArchivedProcessingRecord,
  setLibrarySourceResolution,
  sourceResolutionForArtifact,
} from "./source-resolution";
import type { LibraryArtifactDetail } from "./types";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-source-resolution-data-"));
process.env.DATA_DIR = dataDir;
process.env.LIBRARY_CONNECTIONS_DISABLED = "1";

function tempVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-source-resolution-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  return vault;
}

function blockedArtifact(vault: string, overrides: Partial<LibraryArtifactDetail> = {}): LibraryArtifactDetail {
  return {
    id: "artifact-1",
    path: "references/blocked.md",
    abs_path: path.join(vault, "references", "blocked.md"),
    title: "Blocked source",
    source_title: "Blocked source",
    summary: null,
    source_type: "reference",
    channel: "manual",
    source_id: "manual",
    source_name: "Manual",
    tags: [],
    source_tags: [],
    source_collection: null,
    source_collection_id: null,
    source_folder: null,
    source_folder_id: null,
    library_mode: "study",
    thumbnail: null,
    author: null,
    url: "https://example.com/blocked",
    created_at: "2026-07-20",
    updated_at: "2026-07-20",
    lifecycle_status: "saved",
    is_unread: true,
    read_at: null,
    processing: {
      state: "blocked",
      stage: "capture",
      completed_stages: ["metadata"],
      started_at: "2026-07-20T10:00:00.000Z",
      updated_at: "2026-07-20T10:05:00.000Z",
      attempt: 2,
      next_retry_at: null,
      last_error: { code: "capture_failed", message: "No usable source content was captured.", retryable: false },
    },
    content: "# Blocked source\n\nNo cached source content available.",
    key_points: [],
    connections: [],
    raw_frontmatter: {},
    ...overrides,
  };
}

function blockedQueueRecord(
  vault: string,
  artifact: LibraryArtifactDetail,
  overrides: Partial<LibraryProcessingQueueRecord> = {},
): LibraryProcessingQueueRecord {
  return {
    version: 1,
    artifact_uid: artifact.id,
    vault_path: vault,
    target_path: artifact.path,
    lifecycle_status: "saved",
    source_title: artifact.title,
    raw: { title: artifact.title, url: artifact.url!, date: "2026-07-20", content: "", metadata: {} },
    source: {
      id: "manual",
      name: "Manual",
      channel: "manual",
      url: "manual://library",
      intent: "explicit_save",
      enabled: true,
      cadence: "manual",
      auth: { required: false, stop_on_missing_credential: false },
      filters: { include_topics: [], exclude_topics: [] },
      retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 1 },
      backfill: { enabled: false, mode: "none" },
      tags: [],
      metadata: {},
      path: "meta/sources/manual.yaml",
    },
    queued_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-20T10:05:00.000Z",
    attempt: 2,
    status: "blocked",
    next_retry_at: null,
    ...overrides,
  };
}

test("source resolutions are per-vault, bounded, and resolve by stable id or path", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  const resolution = setLibrarySourceResolution(vault, artifact, {
    status: "unavailable",
    reason: "x".repeat(700),
    resolvedAt: "2026-07-20T12:00:00.000Z",
    evidence: {
      attention_kind: "processing_blocked",
      processing_stage: "capture",
      attempt_count: 2,
      error_code: "capture_failed",
      error_message: "No usable source content was captured.",
    },
  });
  assert.equal(resolution.reason.length, 500);
  assert.ok(fs.existsSync(librarySourceResolutionPath(vault)));

  const resolutions = readLibrarySourceResolutions(vault);
  assert.equal(sourceResolutionForArtifact(resolutions, artifact)?.status, "unavailable");
  assert.equal(sourceResolutionForArtifact(resolutions, { id: "legacy-path-id", path: artifact.path })?.artifact_id, artifact.id);
  assert.equal(resolutions[artifact.id]?.evidence?.error_code, "capture_failed");
  assert.equal(clearLibrarySourceResolution(vault, artifact), true);
  assert.deepEqual(readLibrarySourceResolutions(vault), {});
});

test("acknowledged failures leave Needs attention without becoming healthy or scored", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  assert.equal(attachLibraryAttention(vault, [artifact])[0].attention?.kind, "processing_blocked");

  setLibrarySourceResolution(vault, artifact, { status: "unavailable", reason: "The original source is gone." });
  const [acknowledged] = attachLibraryAttention(vault, [artifact]);
  assert.equal(acknowledged.attention, undefined);
  assert.equal(acknowledged.source_resolution?.status, "unavailable");

  fs.writeFileSync(path.join(vault, "references", "unavailable.md"), `---
type: reference
artifact_uid: unavailable-1
title: Unavailable source
description: Placeholder only.
url: https://example.com/unavailable
library_mode: study
captured: 2026-07-20
---
# Unavailable source

No cached source content available.
`, "utf-8");
  const unavailable = listLibraryArtifactDetails(vault, { mode: "all", limit: 20 }).artifacts
    .find((item) => item.id === "unavailable-1");
  assert.ok(unavailable);
  setLibrarySourceResolution(vault, unavailable!, { status: "unavailable", reason: "No source remains." });
  const refreshed = listLibraryArtifactDetails(vault, { mode: "all", limit: 20 }).artifacts
    .find((item) => item.id === "unavailable-1");
  assert.equal(refreshed?.source_resolution?.status, "unavailable");
  assert.equal(evalAttrsForArtifact(vault, refreshed!)?.lifecycle, "needs_refetch");
  assert.equal(buildForYouPool(vault).pool.some((item) => item.id === "unavailable-1"), false);
});

test("blocked source decisions fail closed when the live queue record does not match", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  writeProcessingQueueRecord(blockedQueueRecord(vault, artifact, { target_path: "references/replaced.md" }));

  assert.throws(
    () => resolveLibrarySourceFailure(vault, artifact, { status: "unavailable" }),
    (error: unknown) => {
      assert.ok(error instanceof LibrarySourceResolutionError);
      assert.equal(error.code, "processing_record_mismatch");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.deepEqual(readLibrarySourceResolutions(vault), {});
  assert.ok(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)));

  // Defend against a legacy inconsistent ledger: a live blocked queue always needs attention.
  setLibrarySourceResolution(vault, artifact, { status: "unavailable" });
  assert.equal(attachLibraryAttention(vault, [artifact])[0].attention?.kind, "processing_blocked");
  assert.equal(attachLibraryAttention(vault, [artifact])[0].source_resolution, undefined);
});

test("blocked source decisions do not write the ledger when queue archival fails", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  writeProcessingQueueRecord(blockedQueueRecord(vault, artifact));
  const archivePath = archivedProcessingRecordPath(vault, artifact.id);
  fs.mkdirSync(archivePath, { recursive: true });

  assert.throws(
    () => resolveLibrarySourceFailure(vault, artifact, { status: "accepted_limited" }),
    (error: unknown) => {
      assert.ok(error instanceof LibrarySourceResolutionError);
      assert.equal(error.code, "processing_archive_failed");
      assert.equal(error.status, 500);
      return true;
    },
  );
  assert.deepEqual(readLibrarySourceResolutions(vault), {});
  assert.ok(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)));
  assert.equal(attachLibraryAttention(vault, [artifact])[0].attention?.kind, "processing_blocked");
});

test("blocked source decisions restore the live queue when the ledger write fails", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  const record = blockedQueueRecord(vault, artifact);
  writeProcessingQueueRecord(record);
  fs.mkdirSync(librarySourceResolutionPath(vault), { recursive: true });

  assert.throws(
    () => resolveLibrarySourceFailure(vault, artifact, { status: "unavailable" }),
    (error: unknown) => {
      assert.ok(error instanceof LibrarySourceResolutionError);
      assert.equal(error.code, "resolution_write_failed");
      return true;
    },
  );
  assert.deepEqual(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)), record);
  assert.equal(fs.existsSync(archivedProcessingRecordPath(vault, artifact.id)), false);
  assert.equal(attachLibraryAttention(vault, [artifact])[0].attention?.kind, "processing_blocked");
});

test("blocked source decisions archive the exact queue record before suppressing attention", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  writeProcessingQueueRecord(blockedQueueRecord(vault, artifact));

  const result = resolveLibrarySourceFailure(vault, artifact, {
    status: "unavailable",
    reason: "The original source is gone.",
  });
  assert.equal(result.processing_record_archived, true);
  assert.equal(result.resolution.status, "unavailable");
  assert.equal(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)), null);
  assert.ok(fs.existsSync(archivedProcessingRecordPath(vault, artifact.id)));
  assert.equal(readLibrarySourceResolutions(vault)[artifact.id]?.status, "unavailable");
  assert.equal(attachLibraryAttention(vault, [artifact])[0].attention, undefined);
});

test("a healed source clears its decision so a later regression needs attention again", () => {
  const vault = tempVault();
  const failed = blockedArtifact(vault, { processing: undefined });
  writeLibraryRefetchAttempts(vault, {
    [failed.path]: { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
  });
  const result = resolveLibrarySourceFailure(vault, failed, { status: "accepted_limited" });
  assert.equal(result.processing_record_archived, false);
  assert.equal(attachLibraryAttention(vault, [failed])[0].attention, undefined);

  const healed = {
    ...failed,
    content: "# Restored source\n\nThe complete source now contains useful prose and supporting detail.",
  };
  const [healthy] = attachLibraryAttention(vault, [healed]);
  assert.equal(healthy.source_resolution, undefined);
  assert.deepEqual(readLibrarySourceResolutions(vault), {});

  const [regressed] = attachLibraryAttention(vault, [failed]);
  assert.equal(regressed.source_resolution, undefined);
  assert.equal(regressed.attention?.kind, "capture_exhausted");
});

test("terminal processing payloads leave the live queue and can be restored exactly for Retry", () => {
  const vault = tempVault();
  const artifact = blockedArtifact(vault);
  const record = {
    version: 1,
    artifact_uid: artifact.id,
    vault_path: vault,
    target_path: artifact.path,
    lifecycle_status: "saved",
    source_title: artifact.title,
    raw: { title: artifact.title, url: artifact.url!, date: "2026-07-20", content: "", metadata: {} },
    source: {
      id: "manual",
      name: "Manual",
      channel: "manual",
      url: "manual://library",
      intent: "explicit_save",
      enabled: true,
      cadence: "manual",
      auth: { required: false, stop_on_missing_credential: false },
      filters: { include_topics: [], exclude_topics: [] },
      retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 1 },
      backfill: { enabled: false, mode: "none" },
      tags: [],
      metadata: {},
      path: "meta/sources/manual.yaml",
    },
    queued_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-20T10:05:00.000Z",
    attempt: 2,
    status: "blocked",
    next_retry_at: null,
  } as LibraryProcessingQueueRecord;
  writeProcessingQueueRecord(record);
  assert.ok(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)));

  assert.equal(archiveTerminalProcessingRecord(vault, artifact), true);
  assert.equal(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)), null);
  assert.equal(restoreArchivedProcessingRecord(vault, artifact), true);
  assert.deepEqual(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)), record);

  assert.equal(archiveTerminalProcessingRecord(vault, { ...artifact, path: "references/other.md" }), false);
  assert.ok(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)));

  const otherVault = tempVault();
  writeProcessingQueueRecord({ ...record, vault_path: otherVault });
  const otherQueuePath = libraryProcessingQueuePath(otherVault, artifact.id);
  fs.renameSync(otherQueuePath, libraryProcessingQueuePath(vault, artifact.id));
  assert.equal(archiveTerminalProcessingRecord(vault, artifact), false);
  assert.ok(readProcessingQueueRecord(libraryProcessingQueuePath(vault, artifact.id)));
});

test("Retry restores archived processing failures and resets legacy exhausted captures honestly", () => {
  const vault = tempVault();
  const processingArtifact = blockedArtifact(vault);
  fs.writeFileSync(processingArtifact.abs_path, `---
type: reference
artifact_uid: ${processingArtifact.id}
title: ${processingArtifact.title}
url: ${processingArtifact.url}
library_mode: study
processing:
  state: blocked
  stage: capture
  completed_stages: [metadata]
  started_at: 2026-07-20T10:00:00.000Z
  updated_at: 2026-07-20T10:05:00.000Z
  attempt: 2
  next_retry_at: null
  last_error:
    code: capture_failed
    message: No usable source content was captured.
    retryable: false
---
# Blocked source

No cached source content available.
`, "utf-8");
  const processingRecord = {
    version: 1,
    artifact_uid: processingArtifact.id,
    vault_path: vault,
    target_path: processingArtifact.path,
    lifecycle_status: "saved",
    source_title: processingArtifact.title,
    raw: { title: processingArtifact.title, url: processingArtifact.url!, date: "2026-07-20", content: "", metadata: {} },
    source: {
      id: "manual",
      name: "Manual",
      channel: "manual",
      url: "manual://library",
      intent: "explicit_save",
      enabled: true,
      cadence: "manual",
      auth: { required: false, stop_on_missing_credential: false },
      filters: { include_topics: [], exclude_topics: [] },
      retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 1 },
      backfill: { enabled: false, mode: "none" },
      tags: [],
      metadata: {},
      path: "meta/sources/manual.yaml",
    },
    queued_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-20T10:05:00.000Z",
    attempt: 2,
    status: "blocked",
    next_retry_at: null,
  } as LibraryProcessingQueueRecord;
  writeProcessingQueueRecord(processingRecord);
  setLibrarySourceResolution(vault, processingArtifact, { status: "unavailable" });
  assert.equal(archiveTerminalProcessingRecord(vault, processingArtifact), true);

  assert.deepEqual(retryLibrarySource(vault, processingArtifact), {
    artifact_uid: processingArtifact.id,
    status: "queued",
    recovery: "processing",
  });
  assert.equal(readProcessingQueueRecord(libraryProcessingQueuePath(vault, processingArtifact.id))?.attempt, 0);
  assert.equal(sourceResolutionForArtifact(readLibrarySourceResolutions(vault), processingArtifact), null);

  const legacy = blockedArtifact(vault, {
    id: "legacy-1",
    path: "references/legacy.md",
    abs_path: path.join(vault, "references", "legacy.md"),
    processing: undefined,
  });
  writeLibraryRefetchAttempts(vault, {
    [legacy.path]: { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
  });
  setLibrarySourceResolution(vault, legacy, { status: "unavailable" });
  assert.deepEqual(retryLibrarySource(vault, legacy), {
    artifact_uid: legacy.id,
    status: "retry_reset",
    recovery: "next_scheduled_refetch",
  });
  assert.equal(readLibraryRefetchAttempts(vault)[legacy.path], undefined);
  assert.equal(sourceResolutionForArtifact(readLibrarySourceResolutions(vault), legacy), null);
});

test("legacy capture Retry removes only that artifact's attempt cap", () => {
  const vault = tempVault();
  const ledgerPath = libraryRefetchAttemptsPath(vault);
  writeLibraryRefetchAttempts(vault, {
    "references/exhausted.md": { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
    "references/other.md": { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
  });
  assert.ok(fs.existsSync(ledgerPath));
  assert.equal(resetLibraryRefetchAttempt(vault, "references/exhausted.md"), true);
  assert.deepEqual(readLibraryRefetchAttempts(vault), {
    "references/other.md": { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
  });
  assert.equal(resetLibraryRefetchAttempt(vault, "references/missing.md"), false);

  assert.deepEqual(pruneLibraryRefetchAttempts({
    "references/active.md": { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
    "references/healed.md": { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
    "references/deleted.md": { count: 1, last_at: "2026-07-20T10:00:00.000Z" },
  }, ["references/active.md"]), {
    attempts: {
      "references/active.md": { count: 2, last_at: "2026-07-20T10:00:00.000Z" },
    },
    pruned: ["references/healed.md", "references/deleted.md"],
  });
});
