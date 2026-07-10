import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { buildCandidateMarkdown, findCandidateByUrl, updateCandidate, writeCandidateAtPath } from "./candidate-cache";
import { captureFailed } from "./capture-health";
import { digestArtifact } from "./digestion";
import {
  isGenericLibraryThumbnail,
  libraryIntakeBatchActive,
  listProcessingQueue,
  markProcessingBlocked,
  removeProcessingQueueRecord,
  processingQueueRecordIsDue,
  updateProcessingCheckpoint,
  writeProcessingQueueRecord,
  type LibraryProcessingQueueRecord,
} from "./processing";
import { buildDurableReferenceMarkdown, writeDurableReference, writeDurableReferenceAtPath } from "./references";
import type { LibraryProcessingStage, LibraryProcessingState, ProcessedArtifact } from "./types";
import { isoNow } from "./utils";

function retryDelayMs(): number {
  const configured = Number(process.env.LIBRARY_PROCESSING_RETRY_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 5 * 60 * 1000;
}

async function processingStartDelay(): Promise<void> {
  const delay = Number(process.env.LIBRARY_PROCESSING_START_DELAY_MS || 0);
  if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

export interface LibraryProcessingResult {
  artifact_uid: string;
  status: "ready" | "blocked" | "retry_scheduled";
  path: string;
  error?: string;
  ingestion_status: "candidate" | "saved" | "promoted" | "skipped";
}

export interface LibraryProcessingWorkerOptions {
  now?: () => Date;
  digest?: typeof digestArtifact;
  onRecordChange?: (record: LibraryProcessingQueueRecord) => void;
}

function completedStages(processed: ProcessedArtifact): LibraryProcessingStage[] {
  const captureStage: LibraryProcessingStage = processed.source.channel === "youtube" || processed.format === "video"
    ? "transcribe"
    : "capture";
  const complete: LibraryProcessingStage[] = ["metadata", captureStage, "digest"];
  if (processed.library_mode === "study" && !processed.reweave_pending) complete.push("reweave");
  return complete;
}

function processingState(record: LibraryProcessingQueueRecord, processed: ProcessedArtifact, state: "queued" | "ready"): LibraryProcessingState {
  const now = isoNow();
  return {
    state,
    stage: processed.library_mode === "study" ? "reweave" : "digest",
    completed_stages: completedStages(processed),
    started_at: record.queued_at,
    updated_at: now,
    completed_at: state === "ready" ? now : null,
    attempt: record.attempt,
    next_retry_at: null,
    last_error: null,
  };
}

function finalMarkdown(record: LibraryProcessingQueueRecord, processed: ProcessedArtifact): string {
  return record.lifecycle_status === "saved"
    ? buildDurableReferenceMarkdown(processed)
    : buildCandidateMarkdown(processed);
}

function usableCapture(record: LibraryProcessingQueueRecord, processed: ProcessedArtifact): boolean {
  if (record.source.channel === "fixture" && (record.raw.content || "").trim().length > 0) return true;
  const parsed = matter(finalMarkdown(record, processed));
  return !captureFailed({ frontmatter: parsed.data as Record<string, unknown>, body: parsed.content });
}

function writeProcessedAtTarget(record: LibraryProcessingQueueRecord, processed: ProcessedArtifact): string {
  const absolute = path.join(record.vault_path, record.target_path);
  if (record.lifecycle_status === "saved") return writeDurableReferenceAtPath(absolute, processed);
  return writeCandidateAtPath(absolute, processed);
}

function scheduleFailure(
  record: LibraryProcessingQueueRecord,
  code: string,
  message: string,
  retryable: boolean,
  now: Date,
): LibraryProcessingResult {
  const terminal = !retryable || record.attempt >= 2;
  const nextRetryAt = terminal ? null : new Date(now.getTime() + retryDelayMs()).toISOString();
  markProcessingBlocked(record, { code, message, retryable }, nextRetryAt);
  return {
    artifact_uid: record.artifact_uid,
    status: terminal ? "blocked" : "retry_scheduled",
    path: record.target_path,
    error: message,
    ingestion_status: record.lifecycle_status === "saved" ? "saved" : "candidate",
  };
}

export async function processLibraryQueueRecord(
  input: LibraryProcessingQueueRecord,
  options: LibraryProcessingWorkerOptions = {},
): Promise<LibraryProcessingResult> {
  const now = options.now?.() || new Date();
  let record: LibraryProcessingQueueRecord = {
    ...input,
    status: "active",
    attempt: input.attempt + 1,
    next_retry_at: null,
    updated_at: now.toISOString(),
  };
  writeProcessingQueueRecord(record);
  options.onRecordChange?.(record);

  try {
    await processingStartDelay();
    const digest = options.digest || digestArtifact;
    const processed = await digest(record.raw, record.source, {
      vaultPath: record.vault_path,
      useSummarize: record.processing_options?.use_summarize,
      reweaveTimeoutMs: record.processing_options?.reweave_timeout_ms,
      onProgress: async (event) => updateProcessingCheckpoint(record, event),
    });
    processed.artifact_uid = record.artifact_uid;
    processed.source_title = record.source_title;
    if (isGenericLibraryThumbnail(processed.raw.thumbnail)) processed.raw.thumbnail = undefined;

    if (!usableCapture(record, processed)) {
      processed.processing = processingState(record, processed, "queued");
      writeProcessedAtTarget(record, processed);
      return scheduleFailure(record, "needs_source", "No usable source content was captured.", true, now);
    }

    processed.processing = processingState(record, processed, "ready");
    let ingestionStatus: LibraryProcessingResult["ingestion_status"];
    if (record.lifecycle_status === "candidate" && processed.assessment.save_recommendation === "file") {
      const candidatePath = path.join(record.vault_path, record.target_path);
      const durablePath = writeDurableReference(record.vault_path, processed, "auto_threshold");
      if (durablePath !== candidatePath) fs.rmSync(candidatePath, { force: true });
      record = {
        ...record,
        lifecycle_status: "saved",
        target_path: path.relative(record.vault_path, durablePath).split(path.sep).join("/"),
        updated_at: isoNow(),
      };
      ingestionStatus = "promoted";
    } else {
      writeProcessedAtTarget(record, processed);
      if (record.lifecycle_status === "candidate" && processed.assessment.save_recommendation === "skip") {
        const candidate = findCandidateByUrl(record.vault_path, record.raw.url);
        if (candidate) updateCandidate(record.vault_path, candidate, {
          status: "skipped",
          reviewed_at: isoNow(),
          reviewed_by: "system",
        });
        ingestionStatus = "skipped";
      } else {
        ingestionStatus = record.lifecycle_status === "saved" ? "saved" : "candidate";
      }
    }
    removeProcessingQueueRecord(record);
    return { artifact_uid: record.artifact_uid, status: "ready", path: record.target_path, ingestion_status: ingestionStatus };
  } catch (error) {
    return scheduleFailure(record, "processing_failed", error instanceof Error ? error.message : String(error), true, now);
  }
}

export async function drainLibraryProcessingQueue(
  vaultPath: string,
  options: LibraryProcessingWorkerOptions = {},
): Promise<LibraryProcessingResult[]> {
  const results: LibraryProcessingResult[] = [];
  if (libraryIntakeBatchActive(vaultPath)) return results;
  while (true) {
    const now = options.now?.() || new Date();
    const record = listProcessingQueue(vaultPath).find((item) => processingQueueRecordIsDue(item, now));
    if (!record) break;
    results.push(await processLibraryQueueRecord(record, options));
  }
  return results;
}
