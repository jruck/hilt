"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { CommentPopover } from "@/components/comments/CommentPopover";
import { ContentTypeIcon } from "@/components/library/ContentTypeIcon";
import { RecommendationDismissPopover } from "@/components/library/RecommendationDismissPopover";
import { useScope } from "@/contexts/ScopeContext";
import { recordRecommendationImpressions } from "@/hooks/useLibrary";
import { contentTypeForArtifact } from "@/lib/library/content-type";
import { buildLibraryUrl, defaultLibraryUrlControls, libraryItemScope } from "@/lib/library/url";
import type { RecommendedArtifact } from "@/lib/library/types";

const impressedEpisodes = new Set<string>();

export function BriefingRecommendationRow({
  artifact,
  onDismiss,
}: {
  artifact: RecommendedArtifact;
  onDismiss: (note?: string) => void | Promise<void>;
}) {
  const { navigateTo } = useScope();
  const rowRef = useRef<HTMLDivElement>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const recommendation = artifact.recommendation;
  const episodeId = recommendation?.episode_id;
  const hasThumbnail = Boolean(artifact.thumbnail) && !thumbnailFailed;

  useEffect(() => setThumbnailFailed(false), [artifact.id, artifact.thumbnail]);

  useEffect(() => {
    const node = rowRef.current;
    if (!episodeId || !node || impressedEpisodes.has(episodeId)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) return;
      impressedEpisodes.add(episodeId);
      void recordRecommendationImpressions([episodeId], "briefing");
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [episodeId]);

  function openArtifact() {
    const scope = libraryItemScope(artifact.id);
    navigateTo("library", scope);
    window.history.replaceState(
      { scope },
      "",
      buildLibraryUrl(scope, { ...defaultLibraryUrlControls, ranking: "for-you" }, { recommendationEpisodeId: episodeId }),
    );
  }

  return (
    <div
      ref={rowRef}
      data-recommendation-episode-id={episodeId}
      className="hilt-card group relative mx-3 my-2 overflow-hidden"
    >
      <button
        type="button"
        onClick={openArtifact}
        className={`grid w-full min-w-0 gap-3 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)] ${hasThumbnail ? "grid-cols-[minmax(0,1fr)_6rem] sm:grid-cols-[minmax(0,1fr)_7rem]" : "grid-cols-1"}`}
        aria-label={`Open ${artifact.title} in Library`}
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-[var(--text-tertiary)]">
            {artifact.is_unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />}
            <ContentTypeIcon type={contentTypeForArtifact(artifact)} />
            <span className="truncate">{artifact.source_name || artifact.channel || "Library"}</span>
            <span className="shrink-0">{artifact.created_at?.slice(0, 10)}</span>
            {recommendation?.is_resurface && <span className="shrink-0">Recommended again</span>}
          </span>
          <span className="mt-1 block line-clamp-2 text-sm font-semibold leading-5 text-[var(--text-primary)]">{artifact.title}</span>
          {recommendation?.why_now && (
            <span
              data-briefing-recommendation-description
              className="mt-1.5 block line-clamp-3 text-[13px] leading-5 text-[var(--text-secondary)]"
            >
              {recommendation.why_now}
            </span>
          )}
        </span>
        {hasThumbnail && (
          <span className="aspect-video w-24 self-start overflow-hidden rounded-md bg-[var(--bg-secondary)] sm:w-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artifact.thumbnail || ""} alt="" onError={() => setThumbnailFailed(true)} className="h-full w-full object-cover" />
          </span>
        )}
      </button>
      <div className="flex min-h-8 items-center gap-1 border-t border-[var(--border-default)] px-3 py-1.5 text-[11px] text-[var(--text-tertiary)]">
        {artifact.lifecycle_status === "saved"
          ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> Saved</>
          : <><CircleDashed className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Candidate</>}
        <span className="ml-1">{artifact.is_unread ? "Unread" : "Read"}</span>
        <span className="ml-auto flex items-center gap-1">
          <CommentPopover
            compact
            target={{ kind: "library", id: artifact.id }}
            placeholder="Feedback on this recommendation"
            triggerTitle="Comment on this recommendation"
          />
          <RecommendationDismissPopover onDismiss={onDismiss} />
        </span>
      </div>
    </div>
  );
}
