import fs from "fs";
import path from "path";
import { listCandidates } from "./candidate-cache";
import { listArchivedReferences, listSavedReferences } from "./references";
import { atomicWriteFile, canonicalUrl, ensureDir, isoNow } from "./utils";
import type { SourceState } from "./source-config";

const DEAD_LETTER_FILE = path.join("references", ".cache", "library-dead-letter.json");

export interface DeadLetterEntry {
  at: string;
  source_id: string;
  artifact_url?: string;
  error: string;
}

function filePath(vaultPath: string): string {
  return path.join(vaultPath, DEAD_LETTER_FILE);
}

export function readDeadLetters(vaultPath: string): DeadLetterEntry[] {
  const target = filePath(vaultPath);
  if (!fs.existsSync(target)) return [];
  try {
    return JSON.parse(fs.readFileSync(target, "utf-8")) as DeadLetterEntry[];
  } catch {
    return [];
  }
}

export function appendDeadLetter(vaultPath: string, entry: Omit<DeadLetterEntry, "at">): void {
  const target = filePath(vaultPath);
  ensureDir(path.dirname(target));
  const entries = readDeadLetters(vaultPath);
  entries.push({ ...entry, at: isoNow() });
  atomicWriteFile(target, JSON.stringify(entries.slice(-500), null, 2));
}

export function deadLetterArtifactUrls(vaultPath: string): Set<string> {
  const urls = [
    ...listSavedReferences(vaultPath).map((artifact) => artifact.url),
    ...listArchivedReferences(vaultPath).map((artifact) => artifact.url),
    ...listCandidates(vaultPath).map((candidate) => candidate.url),
  ];
  return new Set(urls.filter((url): url is string => Boolean(url)).map((url) => canonicalUrl(url)));
}

export function deadLetterResolved(entry: DeadLetterEntry, state: SourceState, artifactUrls?: Set<string>): boolean {
  if (entry.artifact_url) {
    return artifactUrls?.has(canonicalUrl(entry.artifact_url)) || false;
  }
  const entryTime = new Date(entry.at).getTime();
  const successAt = state[entry.source_id]?.last_success_at;
  const successTime = successAt ? new Date(successAt).getTime() : 0;
  return Number.isFinite(entryTime) && Number.isFinite(successTime) && successTime > entryTime;
}

export function unresolvedDeadLetters(vaultPath: string, state: SourceState): DeadLetterEntry[] {
  const entries = readDeadLetters(vaultPath);
  const artifactUrls = entries.some((entry) => entry.artifact_url) ? deadLetterArtifactUrls(vaultPath) : undefined;
  return entries.filter((entry) => !deadLetterResolved(entry, state, artifactUrls));
}

export function unresolvedDeadLetterSources(vaultPath: string, state: SourceState): string[] {
  return Array.from(new Set(unresolvedDeadLetters(vaultPath, state).map((entry) => entry.source_id))).filter(Boolean);
}

/**
 * Drop entries that have since RESOLVED (a later source success, or the artifact now exists in saved/
 * archived/candidate storage). Keeps the health panel's by-source counts reflecting live problems, not
 * historical outages (e.g. a 2-hour credential outage that self-recovered should not amber the panel
 * for weeks). Returns the number of entries pruned. Wired into the nightly cleanup job.
 */
export function pruneResolvedDeadLetters(vaultPath: string, state: SourceState): number {
  const entries = readDeadLetters(vaultPath);
  if (!entries.length) return 0;
  const artifactUrls = entries.some((entry) => entry.artifact_url) ? deadLetterArtifactUrls(vaultPath) : undefined;
  const unresolved = entries.filter((entry) => !deadLetterResolved(entry, state, artifactUrls));
  const pruned = entries.length - unresolved.length;
  if (pruned > 0) {
    atomicWriteFile(filePath(vaultPath), JSON.stringify(unresolved.slice(-500), null, 2));
  }
  return pruned;
}
