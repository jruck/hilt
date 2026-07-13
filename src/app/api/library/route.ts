import { NextRequest, NextResponse } from "next/server";
import { appendLibraryEvents } from "@/lib/library/events";
import { CONTENT_TYPE_LABELS, type LibraryContentType } from "@/lib/library/content-type";
import { getVaultPath } from "@/lib/bridge/vault";
import { listLibraryArtifactDetails, summarizeArtifact, type LibraryListOptions } from "@/lib/library/library";
import { attachCurrentRecommendations, scoreArtifacts } from "@/lib/library/recommendations";
import type { LibraryArtifact, LibraryArtifactDetail, LibraryLifecycle, LibraryLifecycleStatus, LibraryModeFilter } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function evalField(value: string | null): boolean {
  return value !== null && value !== "";
}

function summarizeWithEval(vaultPath: string, artifacts: LibraryArtifactDetail[]): LibraryArtifact[] {
  const scoredById = new Map(
    scoreArtifacts(vaultPath, artifacts.filter((artifact) => artifact.library_mode !== "keep"))
      .map((artifact) => [artifact.id, artifact.eval_attrs]),
  );
  return attachCurrentRecommendations(vaultPath, artifacts.map((artifact) => {
    const summary = summarizeArtifact(artifact);
    const evalAttrs = scoredById.get(artifact.id);
    return evalAttrs ? { ...summary, eval_attrs: evalAttrs } : summary;
  }));
}

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const params = request.nextUrl.searchParams;
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 50);
    const includeCandidates = params.get("includeCandidates") !== "false";
    const status = params.get("status") as LibraryLifecycleStatus | "all" | null;

    const connectionState = params.get("connection_state");
    const substanceGraded = params.get("substance_graded");
    const reweavePendingParam = params.get("reweave_pending");
    const feedbackParam = params.get("feedback");
    const youtubeClipPolicyParam = params.get("youtube_clip_policy");
    const rawContentType = params.get("content_type");
    const contentTypeParam = rawContentType && rawContentType in CONTENT_TYPE_LABELS ? rawContentType as LibraryContentType : null;
    const baseOptions: LibraryListOptions = {
      source: params.get("source"),
      channel: params.get("channel"),
      tag: params.get("tag"),
      series: params.get("series"),
      mode: params.get("mode") as LibraryModeFilter | null,
      status,
      unread: params.get("unread") === "true",
      q: params.get("q"),
      after: params.get("after"),
      before: params.get("before"),
      includeCandidates,
      pipeline_version: params.get("pipeline_version"),
      digested_with: params.get("digested_with"),
      connection_state: connectionState === "has" || connectionState === "abstained" || connectionState === "never" ? connectionState : null,
      substance_graded: substanceGraded === "graded" || substanceGraded === "ungraded" ? substanceGraded : null,
      reweave_pending: reweavePendingParam === "true" ? true : reweavePendingParam === "false" ? false : null,
      feedback: feedbackParam === "none" || feedbackParam === "unprocessed" || feedbackParam === "processed" ? feedbackParam : null,
      youtube_clip_policy: youtubeClipPolicyParam === "process" || youtubeClipPolicyParam === "suppress" || youtubeClipPolicyParam === "label_review" || youtubeClipPolicyParam === "label_only" ? youtubeClipPolicyParam : null,
      content_type: contentTypeParam,
      attention: params.get("attention") === "true",
    };

    // Eval-filter path (lifecycle / worth) scores the source+pipeline-filtered set, then paginates.
    const lifecycle = params.get("lifecycle") as LibraryLifecycle | null;
    const worthMin = params.get("worth_min");
    const worthMax = params.get("worth_max");
    const evalFiltering = evalField(params.get("lifecycle")) || evalField(worthMin) || evalField(worthMax);

    if (evalFiltering) {
      const full = listLibraryArtifactDetails(vaultPath, { ...baseOptions, offset: 0, limit: 100000 });
      // worth scoring only applies to study items (keep is a stash, never in the worth feed).
      let scored = scoreArtifacts(vaultPath, full.artifacts.filter((a) => a.library_mode !== "keep"));
      if (lifecycle) scored = scored.filter((item) => item.lifecycle === lifecycle);
      const min = worthMin === null || worthMin === "" ? null : Number(worthMin);
      const max = worthMax === null || worthMax === "" ? null : Number(worthMax);
      if (min !== null && Number.isFinite(min)) scored = scored.filter((item) => (item.worth ?? 0) >= min);
      if (max !== null && Number.isFinite(max)) scored = scored.filter((item) => (item.worth ?? 0) <= max);
      const paged = attachCurrentRecommendations(vaultPath, scored.slice(offset, offset + limit));
      return NextResponse.json({
        artifacts: paged,
        total: scored.length,
        unread_total: scored.filter((item) => item.is_unread).length,
        offset,
        limit,
      });
    }

    const { artifacts, total, unread_total } = listLibraryArtifactDetails(vaultPath, { ...baseOptions, offset, limit });
    // Metric 4's feed baseline: impressions are logged ONLY when the caller declares surface=feed
    // (the Feed view's first page) — machine/agent GETs and Browse fetches stay out of the record.
    if (params.get("surface") === "feed" && offset === 0) {
      appendLibraryEvents(vaultPath, artifacts.slice(0, 40).map((artifact, index) => ({
        type: "served" as const,
        artifact_id: artifact.id,
        surface: "feed" as const,
        rank: index + 1,
      })));
    }
    return NextResponse.json({
      artifacts: summarizeWithEval(vaultPath, artifacts),
      total,
      unread_total,
      offset,
      limit,
    });
  } catch (error) {
    console.error("[library] list failed:", error);
    return NextResponse.json({ error: "Failed to list library artifacts" }, { status: 500 });
  }
}
