import fs from "fs";
import path from "path";
import { captureFailed } from "./capture-health";
import type { LibraryArtifactAttention, LibraryArtifactDetail } from "./types";
import { hashId } from "./utils";

export const LIBRARY_REFETCH_MAX_ATTEMPTS = 2;

interface RefetchAttemptRecord {
  count: number;
  last_at: string;
}

export type LibraryRefetchAttempts = Record<string, RefetchAttemptRecord>;

export function libraryRefetchAttemptsPath(vaultPath: string, dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data")): string {
  return path.join(dataDir, "library-refetch-attempts", `${hashId(path.resolve(vaultPath), 16)}.json`);
}

export function readLibraryRefetchAttempts(vaultPath: string): LibraryRefetchAttempts {
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryRefetchAttemptsPath(vaultPath), "utf-8")) as LibraryRefetchAttempts;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function processingAttention(artifact: LibraryArtifactDetail): LibraryArtifactAttention | null {
  const processing = artifact.processing;
  if (processing?.state !== "blocked") return null;
  const sourceFailure = processing.stage === "capture" || processing.stage === "transcribe";
  return {
    kind: "processing_blocked",
    label: sourceFailure ? "Needs source" : "Processing blocked",
    detail: processing.last_error?.message || `Automatic processing stopped at ${processing.stage}.`,
    attempt_count: processing.attempt,
  };
}

export function libraryAttentionForArtifact(
  artifact: LibraryArtifactDetail,
  refetchAttempts: LibraryRefetchAttempts,
): LibraryArtifactAttention | null {
  if (artifact.lifecycle_status !== "saved" && artifact.lifecycle_status !== "candidate") return null;

  const blocked = processingAttention(artifact);
  if (blocked) return blocked;

  if (!captureFailed({ body: artifact.content, frontmatter: artifact.raw_frontmatter })) return null;
  const attemptCount = refetchAttempts[artifact.path]?.count || 0;
  if (attemptCount < LIBRARY_REFETCH_MAX_ATTEMPTS) return null;
  return {
    kind: "capture_exhausted",
    label: "Source recovery exhausted",
    detail: `Automatic source recovery stopped after ${attemptCount} attempts.`,
    attempt_count: attemptCount,
  };
}

export function attachLibraryAttention(vaultPath: string, artifacts: LibraryArtifactDetail[]): LibraryArtifactDetail[] {
  const attempts = readLibraryRefetchAttempts(vaultPath);
  return artifacts.map((artifact) => {
    const attention = libraryAttentionForArtifact(artifact, attempts);
    return attention ? { ...artifact, attention } : artifact;
  });
}
