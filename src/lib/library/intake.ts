import path from "node:path";
import { fetchArtifactBatchForSource } from "./adapters";
import { findCandidateByUrl } from "./candidate-cache";
import { isLibrarySourceBlockedError } from "./errors";
import { isMutedSender, readMutedSenders } from "./library-mute";
import {
  beginLibraryIntakeBatch,
  endLibraryIntakeBatch,
  enqueueLibraryArtifact,
} from "./processing";
import { promoteCandidateImmediately } from "./promotion";
import { findArchivedReferenceByUrl, findSavedReferenceByUrl } from "./references";
import { loadSources, readSourceState, writeSourceState, type SourceState, type SourceStateEntry } from "./source-config";
import type { LibraryIntakeReport, LibrarySourceConfig, RawArtifact } from "./types";
import { canonicalUrl, isoNow } from "./utils";
import { relativeVaultPath } from "./markdown";

const DEFAULT_POLL_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface RunLibraryIntakeOptions {
  sourceIds?: string[];
  force?: boolean;
  explicitOnly?: boolean;
  limit?: number;
  pollIntervalMs?: number;
  now?: Date;
}

interface FetchedSourceBatch {
  source: LibrarySourceConfig;
  artifacts: RawArtifact[];
  checked: boolean;
  blocked?: string;
  error?: string;
}

function afterSince(artifact: RawArtifact, since?: string): boolean {
  if (!since) return true;
  const artifactDate = Date.parse(artifact.date);
  const sinceDate = Date.parse(since);
  return !Number.isFinite(artifactDate) || !Number.isFinite(sinceDate) || artifactDate > sinceDate;
}

function usesFetchedWindow(source: LibrarySourceConfig): boolean {
  return source.metadata.incremental_mode === "window"
    || source.signal === "twitter_bookmark"
    || source.signal === "youtube_bookmark_playlist";
}

function rateLimited(message: string): boolean {
  return /(?:\b429\b|rate.?limit|too many requests|quota (?:reached|exceeded))/i.test(message);
}

export function libraryPollBackoffMs(message: string, failures: number): number {
  const explicit = message.match(/retry[- ]after[: ]+(\d+)\s*(seconds?|minutes?|hours?)?/i);
  if (explicit) {
    const amount = Number(explicit[1]);
    const unit = (explicit[2] || "seconds").toLowerCase();
    if (unit.startsWith("hour")) return Math.min(MAX_BACKOFF_MS, amount * 60 * 60 * 1000);
    if (unit.startsWith("minute")) return Math.min(MAX_BACKOFF_MS, amount * 60 * 1000);
    return Math.min(MAX_BACKOFF_MS, amount * 1000);
  }
  return Math.min(MAX_BACKOFF_MS, DEFAULT_POLL_MS * (2 ** Math.max(0, failures - 1)));
}

export function librarySourcePollDue(entry: SourceStateEntry | undefined, now: Date, force: boolean): boolean {
  const backoff = entry?.poll_backoff_until ? Date.parse(entry.poll_backoff_until) : NaN;
  if (Number.isFinite(backoff) && backoff > now.getTime()) return false;
  if (force) return true;
  const next = entry?.next_poll_at ? Date.parse(entry.next_poll_at) : NaN;
  return !Number.isFinite(next) || next <= now.getTime();
}

async function fetchSource(
  source: LibrarySourceConfig,
  state: SourceState,
  options: Required<Pick<RunLibraryIntakeOptions, "force" | "limit">> & { now: Date },
): Promise<FetchedSourceBatch> {
  if (!librarySourcePollDue(state[source.id], options.now, options.force)) {
    return { source, artifacts: [], checked: false };
  }
  try {
    const batch = await fetchArtifactBatchForSource(source, { cursor: null, limit: options.limit || null });
    const artifacts = batch.artifacts
      .filter((artifact) => usesFetchedWindow(source) || afterSince(artifact, state[source.id]?.last_checked_at))
      .slice(0, options.limit || undefined);
    return { source, artifacts, checked: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source,
      artifacts: [],
      checked: true,
      ...(isLibrarySourceBlockedError(error) && !rateLimited(message) ? { blocked: message } : { error: message }),
    };
  }
}

function updatePollState(
  state: SourceState,
  batch: FetchedSourceBatch,
  now: Date,
  intervalMs: number,
): void {
  if (!batch.checked) return;
  const previous = state[batch.source.id] || {};
  const nowIso = now.toISOString();
  if (!batch.error && !batch.blocked) {
    state[batch.source.id] = {
      ...previous,
      last_checked_at: nowIso,
      last_success_at: nowIso,
      last_polled_at: nowIso,
      next_poll_at: new Date(now.getTime() + intervalMs).toISOString(),
      poll_backoff_until: undefined,
      consecutive_poll_errors: 0,
      last_error: undefined,
      blocked_reason: undefined,
    };
    return;
  }

  const message = batch.error || batch.blocked || "Source check failed";
  const failures = (previous.consecutive_poll_errors || 0) + 1;
  const backoffMs = rateLimited(message) ? libraryPollBackoffMs(message, failures) : intervalMs;
  const backoffUntil = new Date(now.getTime() + backoffMs).toISOString();
  state[batch.source.id] = {
    ...previous,
    last_polled_at: nowIso,
    next_poll_at: backoffUntil,
    poll_backoff_until: rateLimited(message) ? backoffUntil : undefined,
    consecutive_poll_errors: failures,
    last_error: message,
    blocked_reason: batch.blocked || undefined,
  };
}

export async function runLibraryIntake(
  vaultPath: string,
  options: RunLibraryIntakeOptions = {},
): Promise<LibraryIntakeReport> {
  const now = options.now || new Date();
  const startedAt = now.toISOString();
  const state = readSourceState(vaultPath);
  const sources = loadSources(vaultPath)
    .filter((source) => source.enabled && source.cadence !== "manual")
    .filter((source) => options.explicitOnly === false || source.intent === "explicit_save")
    .filter((source) => !options.sourceIds || options.sourceIds.includes(source.id));
  const batches = await Promise.all(sources.map((source) => fetchSource(source, state, {
    force: options.force === true,
    limit: Number.isFinite(options.limit) && Number(options.limit) > 0 ? Number(options.limit) : 0,
    now,
  })));
  const intervalMs = Math.max(1_000, options.pollIntervalMs || DEFAULT_POLL_MS);
  for (const batch of batches) updatePollState(state, batch, now, intervalMs);
  writeSourceState(vaultPath, state);

  const report: LibraryIntakeReport = {
    started_at: startedAt,
    finished_at: startedAt,
    checked: batches.filter((batch) => batch.checked).length,
    queued: 0,
    duplicates: 0,
    promoted: 0,
    blocked: batches.filter((batch) => batch.blocked).map((batch) => ({ source_id: batch.source.id, reason: batch.blocked! })),
    errors: batches.filter((batch) => batch.error).map((batch) => `${batch.source.id}: ${batch.error}`),
    artifacts: [],
  };

  const mutedSenders = readMutedSenders(vaultPath);
  const seen = new Set<string>();
  const pending: Array<{ source: LibrarySourceConfig; raw: RawArtifact }> = [];
  for (const batch of batches) {
    for (const raw of batch.artifacts) {
      const sender = raw.author || (typeof raw.metadata.author === "string" ? raw.metadata.author : null);
      if (isMutedSender(mutedSenders, sender)) continue;
      const key = canonicalUrl(raw.url);
      if (seen.has(key)) {
        report.duplicates += 1;
        continue;
      }
      seen.add(key);
      pending.push({ source: batch.source, raw });
    }
  }

  if (pending.length) beginLibraryIntakeBatch(vaultPath);
  try {
    for (const { source, raw } of pending) {
      const existingReference = source.intent === "explicit_save"
        ? findSavedReferenceByUrl(vaultPath, raw.url) || findArchivedReferenceByUrl(vaultPath, raw.url)
        : null;
      const existingCandidate = source.intent === "explicit_save" && !existingReference
        ? findCandidateByUrl(vaultPath, raw.url)
        : null;
      if (existingCandidate && existingCandidate.status !== "promoted") {
        const destination = promoteCandidateImmediately(vaultPath, existingCandidate, source, raw);
        report.promoted += 1;
        report.artifacts.push({
          artifact_uid: existingCandidate.artifact_uid || existingCandidate.id,
          url: raw.url,
          title: existingCandidate.title,
          lifecycle_status: "saved",
          path: relativeVaultPath(vaultPath, destination),
          status: "promoted",
          reason: "explicit_save_promoted_candidate",
        });
        continue;
      }
      const result = enqueueLibraryArtifact(vaultPath, raw, source);
      report.artifacts.push(result);
      if (result.status === "queued") report.queued += 1;
      else if (result.status === "duplicate") report.duplicates += 1;
      else if (result.status === "promoted") report.promoted += 1;
    }
  } finally {
    if (pending.length) endLibraryIntakeBatch(vaultPath);
  }

  report.finished_at = isoNow();
  return report;
}
