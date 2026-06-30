import fs from "fs";
import path from "path";
import type { LibrarySourceConfig, PromotionReason, RawArtifact, YouTubeClipReviewAttrs } from "./types";
import { findCandidateByUrl, updateCandidate, writeCandidate } from "./candidate-cache";
import { findArchivedReferenceByUrl, findSavedReferenceByUrl, writeDurableReference } from "./references";
import { promoteCandidate } from "./promotion";
import { digestArtifact } from "./digestion";
import { appendCitationToFile, citationFrom, findContentDuplicate, sourceRank, type ContentDuplicate } from "./citations";
import { dateOnly } from "./utils";

export interface ProcessArtifactResult {
  status: "candidate" | "saved" | "promoted" | "duplicate" | "skipped";
  path?: string;
  reason?: string;
  youtube_clip?: YouTubeClipReviewAttrs;
}

/** Build a Citation from an incoming raw item + its source config. */
function citationForIncoming(raw: RawArtifact, source: LibrarySourceConfig) {
  return citationFrom({
    source_id: source.id,
    source_name: source.name,
    url: raw.url,
    channel: source.channel,
    at: dateOnly(raw.date || new Date()),
    title: raw.title,
  });
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
    // An explicit user save (a bookmark) of something we'd only DISCOVERED as a candidate must promote
    // it to a durable reference — the explicit intent outranks discovery routing. Without this, the
    // candidate-dedup short-circuits before the explicit_save branch below, so the bookmark is silently
    // dropped and the item stays a TTL-expiring candidate (root cause of "my bookmarks never get pulled
    // in" when the same URL was already surfaced by a discovery source, e.g. a channel feed).
    if (source.intent === "explicit_save") {
      if (options.dryRun) {
        return { status: "promoted", path: path.join(vaultPath, existingCandidate.path), reason: "dry_run_explicit_promote" };
      }
      const promotedPath = await promoteCandidate(vaultPath, existingCandidate, "explicit_signal");
      return { status: "promoted", path: promotedPath, reason: "explicit_save_promoted_candidate" };
    }
    return { status: "duplicate", path: path.join(vaultPath, existingCandidate.path), reason: "candidate_exists" };
  }

  // Content-level dedup: the same article/video/episode can arrive from DIFFERENT urls (a podcast
  // episode via its YouTube feed AND the newsletter announcing it). There should be ONE entry — the
  // content — that records the others as `cited_from` citations, not duplicate entries. URL dedup above
  // can't catch these (the urls differ); match on video-id / title. Skip explicit saves of the SAME url
  // (handled above) — this only fires across sources.
  const contentDup: ContentDuplicate | null =
    source.intent === "explicit_save" ? null : findContentDuplicate(vaultPath, { url: raw.url, title: raw.title, sourceId: source.id, date: raw.date || undefined });
  if (contentDup && sourceRank(source.id, source.channel) <= sourceRank(contentDup.source_id, contentDup.channel)) {
    // The existing entry is at least as canonical (e.g. the YouTube video already exists and this is the
    // newsletter mention) — fold this source in as a citation instead of writing a duplicate.
    if (options.dryRun) {
      return { status: "duplicate", path: contentDup.path, reason: "dry_run_content_cited" };
    }
    appendCitationToFile(contentDup.path, citationForIncoming(raw, source));
    return { status: "duplicate", path: contentDup.path, reason: "content_cited_into_existing" };
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

  let result: ProcessArtifactResult;
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
    result = { status: "skipped", path: candidatePath, reason: "low_score_candidate_written", youtube_clip: processed.youtube_clip };
  } else if (source.intent === "explicit_save") {
    const filePath = writeDurableReference(vaultPath, processed, "explicit_signal");
    result = { status: "saved", path: filePath, reason: "explicit_save", youtube_clip: processed.youtube_clip };
  } else if (
    processed.assessment.save_recommendation === "file" &&
    processed.score.total >= source.retention.auto_promote_threshold
  ) {
    const reason: PromotionReason = "auto_threshold";
    const filePath = writeDurableReference(vaultPath, processed, reason);
    result = { status: "promoted", path: filePath, reason, youtube_clip: processed.youtube_clip };
  } else {
    const candidatePath = writeCandidate(vaultPath, processed);
    result = { status: "candidate", path: candidatePath, reason: "discovery", youtube_clip: processed.youtube_clip };
  }

  // Reaching here with a `contentDup` means the incoming source is MORE canonical than an entry we'd
  // already captured from a thinner source (e.g. the YouTube video arriving after the newsletter
  // mention). The new entry above is now canonical; fold the superseded entry in as a citation (+ its
  // connections) and remove it — candidate-cache only; never delete a saved reference.
  if (contentDup && result.path) {
    appendCitationToFile(
      result.path,
      citationFrom({
        source_id: contentDup.source_id,
        source_name: contentDup.source_name,
        url: contentDup.url,
        channel: contentDup.channel || undefined,
        at: contentDup.at,
        title: contentDup.title,
      }),
      contentDup.connections,
    );
    if (!contentDup.saved) { try { fs.rmSync(contentDup.path); } catch { /* already gone */ } }
    result.reason = `${result.reason}_superseded_${contentDup.source_id}`;
  }
  return result;
}
