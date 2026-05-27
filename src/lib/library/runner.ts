import { appendDeadLetter } from "./dead-letter";
import { isLibrarySourceBlockedError } from "./errors";
import { fetchArtifactsForSource } from "./adapters";
import { loadSources, readSourceState, writeSourceState } from "./source-config";
import { processArtifact } from "./processor";
import { isoNow } from "./utils";
import type { IngestionReport, IngestionSourceResult, LibrarySourceConfig, RawArtifact } from "./types";

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
  };
}

export async function runIngestion(
  vaultPath: string,
  options: { sourceIds?: string[]; useSummarize?: boolean } = {},
): Promise<IngestionReport> {
  const started = isoNow();
  const state = readSourceState(vaultPath);
  const sources = loadSources(vaultPath)
    .filter((source) => source.enabled)
    .filter((source) => !options.sourceIds?.length || options.sourceIds.includes(source.id));

  const report: IngestionReport = {
    started_at: started,
    finished_at: started,
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
      const artifacts = (await fetchArtifactsForSource(source))
        .filter((artifact) => afterSince(artifact, state[source.id]?.last_checked_at));
      result.checked = true;
      result.fetched = artifacts.length;
      report.checked += 1;

      for (const artifact of artifacts) {
        try {
          const processed = await processArtifact(vaultPath, artifact, source, { useSummarize: options.useSummarize });
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(message);
          report.errors.push(`${source.id}: ${message}`);
          appendDeadLetter(vaultPath, { source_id: source.id, artifact_url: artifact.url, error: message });
        }
      }

      state[source.id] = {
        ...state[source.id],
        last_checked_at: isoNow(),
        last_success_at: isoNow(),
        last_error: undefined,
        blocked_reason: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isLibrarySourceBlockedError(error)) {
        result.blocked = true;
        result.blocked_reason = message;
        report.blocked.push({ source_id: source.id, reason: message });
        state[source.id] = { ...state[source.id], blocked_reason: message, last_error: message };
      } else {
        result.errors.push(message);
        report.errors.push(`${source.id}: ${message}`);
        state[source.id] = { ...state[source.id], last_error: message };
      }
      appendDeadLetter(vaultPath, { source_id: source.id, error: message });
    }
  }

  report.finished_at = isoNow();
  writeSourceState(vaultPath, state);
  return report;
}

