import fs from "node:fs";
import path from "node:path";
import { captureFailed } from "./capture-health";
import type { LibraryArtifactDetail, LibrarySourceResolution, LibrarySourceResolutionEvidence, LibrarySourceResolutionStatus } from "./types";
import {
  libraryProcessingQueuePath,
  readProcessingQueueRecord,
  writeProcessingQueueRecord,
} from "./processing";
import { atomicWriteFile, ensureDir, hashId, isoNow } from "./utils";

const SOURCE_RESOLUTION_DIR = "library-source-resolutions";
const SOURCE_RESOLUTION_QUEUE_DIR = "library-source-resolution-queue";

interface LibrarySourceResolutionLedger {
  version: 1;
  updated_at: string;
  entries: Record<string, LibrarySourceResolution>;
}

export type LibrarySourceResolutionErrorCode =
  | "processing_record_mismatch"
  | "processing_archive_failed"
  | "resolution_write_failed";

export class LibrarySourceResolutionError extends Error {
  constructor(
    public readonly code: LibrarySourceResolutionErrorCode,
    message: string,
    public readonly status: 409 | 500,
  ) {
    super(message);
    this.name = "LibrarySourceResolutionError";
  }
}

export interface ResolveLibrarySourceFailureResult {
  resolution: LibrarySourceResolution;
  processing_record_archived: boolean;
}

function defaultDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function normalizedStatus(value: unknown): LibrarySourceResolutionStatus | null {
  return value === "unavailable" || value === "accepted_limited" ? value : null;
}

function normalizedEntry(key: string, value: unknown): LibrarySourceResolution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = normalizedStatus(record.status);
  const artifactId = typeof record.artifact_id === "string" ? record.artifact_id.trim() : key.trim();
  const artifactPath = typeof record.path === "string" ? record.path.trim() : "";
  const resolvedAt = typeof record.resolved_at === "string" ? record.resolved_at.trim() : "";
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 500) : "";
  const rawEvidence = record.evidence && typeof record.evidence === "object"
    ? record.evidence as Record<string, unknown>
    : null;
  const evidence: LibrarySourceResolutionEvidence | undefined = rawEvidence ? {
    attention_kind: rawEvidence.attention_kind === "processing_blocked" || rawEvidence.attention_kind === "capture_exhausted"
      ? rawEvidence.attention_kind
      : null,
    processing_stage: rawEvidence.processing_stage === "metadata"
      || rawEvidence.processing_stage === "capture"
      || rawEvidence.processing_stage === "transcribe"
      || rawEvidence.processing_stage === "digest"
      || rawEvidence.processing_stage === "reweave"
      ? rawEvidence.processing_stage
      : null,
    attempt_count: typeof rawEvidence.attempt_count === "number" && Number.isFinite(rawEvidence.attempt_count)
      ? Math.max(0, Math.floor(rawEvidence.attempt_count))
      : null,
    error_code: typeof rawEvidence.error_code === "string" ? rawEvidence.error_code.slice(0, 120) : null,
    error_message: typeof rawEvidence.error_message === "string" ? rawEvidence.error_message.slice(0, 500) : null,
  } : undefined;
  if (!status || !artifactId || !artifactPath || !resolvedAt) return null;
  return {
    status,
    artifact_id: artifactId,
    path: artifactPath,
    resolved_at: resolvedAt,
    reason: reason || (status === "unavailable" ? "Source is unavailable." : "Limited source accepted."),
    ...(evidence ? { evidence } : {}),
  };
}

export function librarySourceResolutionPath(vaultPath: string, dataDir = defaultDataDir()): string {
  return path.join(dataDir, SOURCE_RESOLUTION_DIR, `${hashId(path.resolve(vaultPath), 16)}.json`);
}

export function readLibrarySourceResolutions(
  vaultPath: string,
  dataDir = defaultDataDir(),
): Record<string, LibrarySourceResolution> {
  try {
    const parsed = JSON.parse(fs.readFileSync(librarySourceResolutionPath(vaultPath, dataDir), "utf-8")) as Partial<LibrarySourceResolutionLedger>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed.entries)
        .map(([key, value]) => [key, normalizedEntry(key, value)] as const)
        .filter((entry): entry is readonly [string, LibrarySourceResolution] => entry[1] !== null),
    );
  } catch {
    return {};
  }
}

function writeLedger(vaultPath: string, entries: Record<string, LibrarySourceResolution>, dataDir = defaultDataDir()): void {
  const filePath = librarySourceResolutionPath(vaultPath, dataDir);
  ensureDir(path.dirname(filePath));
  const ledger: LibrarySourceResolutionLedger = { version: 1, updated_at: isoNow(), entries };
  atomicWriteFile(filePath, `${JSON.stringify(ledger, null, 2)}\n`);
}

export function sourceResolutionForArtifact(
  resolutions: Record<string, LibrarySourceResolution>,
  artifact: Pick<LibraryArtifactDetail, "id" | "path">,
): LibrarySourceResolution | null {
  const exact = resolutions[artifact.id];
  if (exact) return exact;
  return Object.values(resolutions).find((entry) => entry.path === artifact.path) || null;
}

export function setLibrarySourceResolution(
  vaultPath: string,
  artifact: Pick<LibraryArtifactDetail, "id" | "path">,
  input: { status: LibrarySourceResolutionStatus; reason?: string; resolvedAt?: string; evidence?: LibrarySourceResolutionEvidence },
  dataDir = defaultDataDir(),
): LibrarySourceResolution {
  const entries = readLibrarySourceResolutions(vaultPath, dataDir);
  const resolution: LibrarySourceResolution = {
    status: input.status,
    artifact_id: artifact.id,
    path: artifact.path,
    resolved_at: input.resolvedAt || isoNow(),
    reason: (input.reason || "").trim().slice(0, 500)
      || (input.status === "unavailable" ? "Source is unavailable." : "Limited source accepted."),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
  entries[artifact.id] = resolution;
  writeLedger(vaultPath, entries, dataDir);
  return resolution;
}

export function archivedProcessingRecordPath(vaultPath: string, artifactId: string, dataDir = defaultDataDir()): string {
  return path.join(dataDir, SOURCE_RESOLUTION_QUEUE_DIR, hashId(path.resolve(vaultPath), 16), `${artifactId}.json`);
}

/**
 * Remove an acknowledged terminal item from the runnable queue without discarding the raw payload.
 * Exact uid/path matching prevents a stale UI action from moving another artifact's queue record.
 */
export function archiveTerminalProcessingRecord(
  vaultPath: string,
  artifact: Pick<LibraryArtifactDetail, "id" | "path">,
  dataDir = defaultDataDir(),
): boolean {
  const queuePath = libraryProcessingQueuePath(vaultPath, artifact.id);
  const record = readProcessingQueueRecord(queuePath);
  if (!record
    || path.resolve(record.vault_path) !== path.resolve(vaultPath)
    || record.status !== "blocked"
    || record.artifact_uid !== artifact.id
    || record.target_path !== artifact.path) return false;
  const archivePath = archivedProcessingRecordPath(vaultPath, artifact.id, dataDir);
  ensureDir(path.dirname(archivePath));
  atomicWriteFile(archivePath, `${JSON.stringify(record, null, 2)}\n`);
  try {
    fs.unlinkSync(queuePath);
  } catch (error) {
    // Do not leave a misleading archive copy when the live queue record could not be removed.
    try { fs.unlinkSync(archivePath); } catch { /* best effort cleanup */ }
    throw error;
  }
  if (fs.existsSync(queuePath)) {
    try { fs.unlinkSync(archivePath); } catch { /* best effort cleanup */ }
    throw new Error("Could not remove the acknowledged processing record.");
  }
  return true;
}

/**
 * Record a source disposition while keeping the terminal processing queue and resolution ledger
 * consistent. A blocked processing item is resolved only after its exact queue payload has moved
 * out of the live queue. If the ledger write then fails, the queue payload is restored.
 */
export function resolveLibrarySourceFailure(
  vaultPath: string,
  artifact: Pick<LibraryArtifactDetail, "id" | "path" | "processing">,
  input: { status: LibrarySourceResolutionStatus; reason?: string; resolvedAt?: string; evidence?: LibrarySourceResolutionEvidence },
  dataDir = defaultDataDir(),
): ResolveLibrarySourceFailureResult {
  const requiresArchive = artifact.processing?.state === "blocked";
  let processingRecordArchived = false;

  if (requiresArchive) {
    try {
      processingRecordArchived = archiveTerminalProcessingRecord(vaultPath, artifact, dataDir);
    } catch {
      throw new LibrarySourceResolutionError(
        "processing_archive_failed",
        "The blocked processing record could not be archived. No source decision was saved.",
        500,
      );
    }
    if (!processingRecordArchived) {
      throw new LibrarySourceResolutionError(
        "processing_record_mismatch",
        "The blocked processing record changed before this decision was saved. Refresh and try again.",
        409,
      );
    }
  }

  try {
    const resolution = setLibrarySourceResolution(vaultPath, artifact, input, dataDir);
    return { resolution, processing_record_archived: processingRecordArchived };
  } catch {
    if (processingRecordArchived) {
      try { restoreArchivedProcessingRecord(vaultPath, artifact, dataDir); } catch { /* preserve original failure */ }
    }
    throw new LibrarySourceResolutionError(
      "resolution_write_failed",
      "The source decision could not be saved. The item still needs attention.",
      500,
    );
  }
}

/** Restore a previously acknowledged processing payload so the normal retry path can reset it. */
export function restoreArchivedProcessingRecord(
  vaultPath: string,
  artifact: Pick<LibraryArtifactDetail, "id" | "path">,
  dataDir = defaultDataDir(),
): boolean {
  const archivePath = archivedProcessingRecordPath(vaultPath, artifact.id, dataDir);
  const record = readProcessingQueueRecord(archivePath);
  if (!record
    || path.resolve(record.vault_path) !== path.resolve(vaultPath)
    || record.artifact_uid !== artifact.id
    || record.target_path !== artifact.path) return false;
  writeProcessingQueueRecord(record);
  fs.unlinkSync(archivePath);
  return true;
}

export function clearLibrarySourceResolution(
  vaultPath: string,
  artifact: Pick<LibraryArtifactDetail, "id" | "path">,
  dataDir = defaultDataDir(),
): boolean {
  const entries = readLibrarySourceResolutions(vaultPath, dataDir);
  const matchingKeys = Object.entries(entries)
    .filter(([key, entry]) => key === artifact.id || entry.path === artifact.path)
    .map(([key]) => key);
  if (!matchingKeys.length) return false;
  for (const key of matchingKeys) delete entries[key];
  writeLedger(vaultPath, entries, dataDir);
  return true;
}

/** Clear acknowledgements once their source has healed so a later regression needs a new decision. */
export function pruneHealedLibrarySourceResolutions(
  vaultPath: string,
  artifacts: Array<Pick<LibraryArtifactDetail, "id" | "path" | "processing" | "content" | "raw_frontmatter">>,
  dataDir = defaultDataDir(),
): Record<string, LibrarySourceResolution> {
  const entries = readLibrarySourceResolutions(vaultPath, dataDir);
  let changed = false;
  for (const artifact of artifacts) {
    const failed = artifact.processing?.state === "blocked"
      || captureFailed({ body: artifact.content, frontmatter: artifact.raw_frontmatter });
    if (failed) continue;
    for (const [key, entry] of Object.entries(entries)) {
      if (key !== artifact.id && entry.path !== artifact.path) continue;
      delete entries[key];
      changed = true;
    }
  }
  if (changed) writeLedger(vaultPath, entries, dataDir);
  return entries;
}
