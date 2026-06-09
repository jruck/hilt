import path from "path";
import type { LibrarySourceConfig, PromotionReason, RawArtifact, YouTubeClipReviewAttrs } from "./types";
import { findCandidateByUrl, updateCandidate, writeCandidate } from "./candidate-cache";
import { findArchivedReferenceByUrl, findSavedReferenceByUrl, writeDurableReference } from "./references";
import { digestArtifact } from "./digestion";

export interface ProcessArtifactResult {
  status: "candidate" | "saved" | "promoted" | "duplicate" | "skipped";
  path?: string;
  reason?: string;
  youtube_clip?: YouTubeClipReviewAttrs;
}

export async function processArtifact(
  vaultPath: string,
  raw: RawArtifact,
  source: LibrarySourceConfig,
  options: { useSummarize?: boolean; dryRun?: boolean; reweaveTimeoutMs?: number } = {},
): Promise<ProcessArtifactResult> {
  const existingRef = findSavedReferenceByUrl(vaultPath, raw.url);
  if (existingRef) {
    return { status: "duplicate", path: path.join(vaultPath, existingRef.path), reason: "saved_reference_exists" };
  }
  const archivedRef = findArchivedReferenceByUrl(vaultPath, raw.url);
  if (archivedRef) {
    return { status: "duplicate", path: path.join(vaultPath, archivedRef.path), reason: "archived_reference_exists" };
  }
  const existingCandidate = findCandidateByUrl(vaultPath, raw.url);
  if (existingCandidate && existingCandidate.status === "candidate") {
    return { status: "duplicate", path: path.join(vaultPath, existingCandidate.path), reason: "candidate_exists" };
  }

  const processed = await digestArtifact(raw, source, { ...options, vaultPath });
  if (options.dryRun) {
    if (processed.assessment.save_recommendation === "skip" && source.intent !== "explicit_save") {
      return { status: "skipped", reason: "dry_run_low_score_candidate", youtube_clip: processed.youtube_clip };
    }
    if (source.intent === "explicit_save") {
      return { status: "saved", reason: "dry_run_explicit_save", youtube_clip: processed.youtube_clip };
    }
    if (
      processed.assessment.save_recommendation === "file" &&
      processed.score.total >= source.retention.auto_promote_threshold
    ) {
      return { status: "promoted", reason: "dry_run_auto_threshold", youtube_clip: processed.youtube_clip };
    }
    return { status: "candidate", reason: "dry_run_discovery", youtube_clip: processed.youtube_clip };
  }

  if (processed.assessment.save_recommendation === "skip" && source.intent !== "explicit_save") {
    const candidatePath = writeCandidate(vaultPath, processed);
    const candidate = findCandidateByUrl(vaultPath, raw.url);
    if (candidate) {
      updateCandidate(vaultPath, candidate, {
        status: "skipped",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "system",
      });
    }
    return { status: "skipped", path: candidatePath, reason: "low_score_candidate_written", youtube_clip: processed.youtube_clip };
  }

  if (source.intent === "explicit_save") {
    const filePath = writeDurableReference(vaultPath, processed, "explicit_signal");
    return { status: "saved", path: filePath, reason: "explicit_save", youtube_clip: processed.youtube_clip };
  }

  if (
    processed.assessment.save_recommendation === "file" &&
    processed.score.total >= source.retention.auto_promote_threshold
  ) {
    const reason: PromotionReason = "auto_threshold";
    const filePath = writeDurableReference(vaultPath, processed, reason);
    return { status: "promoted", path: filePath, reason, youtube_clip: processed.youtube_clip };
  }

  const candidatePath = writeCandidate(vaultPath, processed);
  return { status: "candidate", path: candidatePath, reason: "discovery", youtube_clip: processed.youtube_clip };
}
