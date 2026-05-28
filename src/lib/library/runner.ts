import { appendDeadLetter } from "./dead-letter";
import { isLibrarySourceBlockedError } from "./errors";
import { fetchArtifactBatchForSource } from "./adapters";
import { loadSources, readSourceState, writeSourceState } from "./source-config";
import { processArtifact } from "./processor";
import { isoNow } from "./utils";
import type { ArtifactFetchBatch, IngestionReport, IngestionSourceResult, LibrarySourceConfig, RawArtifact } from "./types";

function afterSince(artifact: RawArtifact, since?: string): boolean {
  if (!since) return true;
  const artifactDate = new Date(artifact.date).getTime();
  const sinceDate = new Date(since).getTime();
  if (Number.isNaN(artifactDate) || Number.isNaN(sinceDate)) return true;
  return artifactDate > sinceDate;
}

function sourceResult(source: LibrarySourceConfig): IngestionSourceResult {
  return {
    source_id: source.id,
    source_name: source.name,
    checked: false,
    blocked: false,
    fetched: 0,
    candidates: 0,
    promoted: 0,
    saved: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
    artifacts: [],
  };
}

export interface RunIngestionOptions {
  sourceIds?: string[];
  useSummarize?: boolean;
  dryRun?: boolean;
  limit?: number;
  ignoreState?: boolean;
  useCursor?: boolean;
}

function hasNextCursor(batch: ArtifactFetchBatch): boolean {
  return Object.prototype.hasOwnProperty.call(batch, "next_cursor");
}

export async function runIngestion(
  vaultPath: string,
  options: RunIngestionOptions = {},
): Promise<IngestionReport> {
  const started = isoNow();
  const state = readSourceState(vaultPath);
  const limit = Number.isFinite(options.limit) && Number(options.limit) > 0 ? Number(options.limit) : null;
  const useCursor = Boolean(options.useCursor);
  const sources = loadSources(vaultPath)
    .filter((source) => source.enabled)
    .filter((source) => !options.sourceIds?.length || options.sourceIds.includes(source.id));

  const report: IngestionReport = {
    started_at: started,
    finished_at: started,
    dry_run: Boolean(options.dryRun),
    use_cursor: useCursor,
    limit,
    checked: 0,
    candidates: 0,
    promoted: 0,
    saved: 0,
    skipped: 0,
    duplicates: 0,
    blocked: [],
    errors: [],
    sources: [],
  };

  for (const source of sources) {
    const result = sourceResult(source);
    report.sources.push(result);
    try {
      const sourceCursor = useCursor ? (state[source.id]?.cursor ?? source.backfill.cursor ?? null) : null;
      result.cursor = sourceCursor;
      const batch = await fetchArtifactBatchForSource(source, { cursor: sourceCursor, limit });
      result.next_cursor = batch.next_cursor ?? null;
      const artifacts = batch.artifacts
        .filter((artifact) => options.ignoreState || options.dryRun || useCursor || afterSince(artifact, state[source.id]?.last_checked_at))
        .slice(0, limit ?? undefined);
      result.checked = true;
      result.fetched = artifacts.length;
      report.checked += 1;

      for (const artifact of artifacts) {
        try {
          const processed = await processArtifact(vaultPath, artifact, source, {
            useSummarize: options.useSummarize,
            dryRun: options.dryRun,
          });
          if (processed.status === "candidate") {
            result.candidates += 1;
            report.candidates += 1;
          } else if (processed.status === "promoted") {
            result.promoted += 1;
            report.promoted += 1;
          } else if (processed.status === "saved") {
            result.saved += 1;
            report.saved += 1;
          } else if (processed.status === "skipped") {
            result.skipped += 1;
            report.skipped += 1;
          } else if (processed.status === "duplicate") {
            result.duplicates += 1;
            report.duplicates += 1;
          }
          result.artifacts.push({
            url: artifact.url,
            title: artifact.title,
            status: processed.status,
            path: processed.path,
            reason: processed.reason,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(message);
          report.errors.push(`${source.id}: ${message}`);
          result.artifacts.push({
            url: artifact.url,
            title: artifact.title,
            status: "error",
            reason: message,
          });
          if (!options.dryRun) {
            appendDeadLetter(vaultPath, { source_id: source.id, artifact_url: artifact.url, error: message });
          }
        }
      }

      if (!options.dryRun) {
        const checkedAt = isoNow();
        const nextState = {
          ...state[source.id],
          last_checked_at: checkedAt,
          last_success_at: checkedAt,
          last_error: undefined,
          blocked_reason: undefined,
        };
        if (useCursor && hasNextCursor(batch)) {
          if (batch.next_cursor) {
            nextState.cursor = batch.next_cursor;
            nextState.backfill_complete_at = undefined;
          } else {
            nextState.cursor = undefined;
            nextState.backfill_complete_at = checkedAt;
          }
        }
        state[source.id] = {
          ...nextState,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isLibrarySourceBlockedError(error)) {
        result.blocked = true;
        result.blocked_reason = message;
        report.blocked.push({ source_id: source.id, reason: message });
        if (!options.dryRun) {
          state[source.id] = { ...state[source.id], blocked_reason: message, last_error: message };
        }
      } else {
        result.errors.push(message);
        report.errors.push(`${source.id}: ${message}`);
        if (!options.dryRun) {
          state[source.id] = { ...state[source.id], last_error: message };
        }
      }
      if (!options.dryRun) {
        appendDeadLetter(vaultPath, { source_id: source.id, error: message });
      }
    }
  }

  report.finished_at = isoNow();
  if (!options.dryRun) {
    writeSourceState(vaultPath, state);
  }
  return report;
}
