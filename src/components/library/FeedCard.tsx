"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import type { PromotionReason } from "@/lib/library/types";
import type { ReviewQueueStatus } from "@/lib/library/review-queue";
import { formatVideoDuration } from "@/lib/library/media";
import { artifactDisplayTags } from "@/lib/library/taxonomy";
import { Check, ChevronDown, ExternalLink, FileText, MoreHorizontal, Play, ThumbsDown } from "lucide-react";
import { contentTypeForArtifact } from "@/lib/library/content-type";
import { ContentTypeIcon } from "./ContentTypeIcon";
import { EvalMetricPills } from "./EvalMetricPills";
import { LibraryLifecycleMenu } from "./LibraryLifecycleMenu";

function clipPolicyLabel(policy: string): string {
  if (policy === "label_review") return "Clip review";
  if (policy === "suppress") return "Auto-skip clip";
  if (policy === "label_only") return "Saved clip";
  return "YouTube";
}

function clipPolicyClass(policy: string): string {
  if (policy === "suppress") return "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300";
  if (policy === "label_review") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (policy === "label_only") return "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300";
  return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
}

function clipSignalSummary(signals: string[]): string {
  return signals.slice(0, 3).map((signal) => signal.replace(/_/g, " ")).join(" · ");
}

export function FeedCard({
  artifact,
  showEvalBreakdown = false,
  promoteReason = "manual_save",
  onChanged,
  onOpen,
  onMarkUnread,
  onDismissCandidate,
  onArchiveReference,
  onReviewStatus,
  active = false,
  wideLayout = false,
  reason,
}: {
  artifact: LibraryArtifact | RecommendedArtifact;
  showEvalBreakdown?: boolean;
  promoteReason?: PromotionReason;
  onChanged?: () => void;
  onOpen?: (artifact: LibraryArtifact, intent?: "default" | "metadata") => void;
  onMarkUnread?: (id: string) => void | Promise<void>;
  onDismissCandidate?: (artifact: LibraryArtifact | RecommendedArtifact) => void | Promise<void>;
  onArchiveReference?: (artifact: LibraryArtifact | RecommendedArtifact) => void | Promise<void>;
  onReviewStatus?: (id: string, status: ReviewQueueStatus, note?: string) => void | Promise<void>;
  active?: boolean;
  wideLayout?: boolean;
  /** The editor's stated pick reason (For You v2) — every pick explains itself on the card. */
  reason?: string;
}) {
  const isCandidate = artifact.lifecycle_status === "candidate";
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const hasThumbnail = Boolean(artifact.thumbnail) && !thumbnailFailed;
  const useWideLayout = wideLayout && hasThumbnail;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const openArtifact = (intent: "default" | "metadata" = "default") => onOpen?.(artifact, intent);
  const stopCardClick = (event: MouseEvent) => event.stopPropagation();
  const openArtifactMetadata = (event: MouseEvent) => {
    event.stopPropagation();
    setActionsOpen(false);
    setReviewOpen(false);
    setLifecycleOpen(false);
    openArtifact("metadata");
  };
  const hasUpdatedReviewActions = !isCandidate && Boolean(onReviewStatus);
  const hasGeneralActions = Boolean(isCandidate && artifact.url);
  const displayTags = artifactDisplayTags(artifact).slice(0, 4);
  const clipReview = artifact.youtube_clip && artifact.youtube_clip.policy_action !== "process" ? artifact.youtube_clip : null;
  const hasCardActionRow = Boolean(artifact.lifecycle_status || artifact.eval_attrs || hasUpdatedReviewActions || hasGeneralActions);
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openArtifact();
  };
  const activeClass = active
    ? "hilt-card-accent ring-1 ring-[var(--accent-primary)]"
    : "";

  useEffect(() => {
    setThumbnailFailed(false);
  }, [artifact.id, artifact.thumbnail]);

  useEffect(() => {
    setActionsOpen(false);
    setReviewOpen(false);
    setLifecycleOpen(false);
  }, [artifact.id]);

  return (
    <article
      role="button"
      tabIndex={0}
      data-library-artifact-id={artifact.id}
      aria-label={`Open ${artifact.title}`}
      aria-current={active ? "true" : undefined}
      onClick={() => openArtifact()}
      onKeyDown={handleCardKeyDown}
      className={`hilt-card group relative cursor-pointer overflow-visible transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)] ${actionsOpen || reviewOpen || lifecycleOpen ? "z-30" : "z-0"} ${useWideLayout ? "md:flex md:min-h-[190px] md:flex-row-reverse md:items-start" : ""} ${activeClass}`}
    >
      {hasThumbnail && (
        <div className={`relative z-10 block aspect-video w-full overflow-hidden rounded-t-lg bg-[var(--bg-secondary)] text-left ${useWideLayout ? "md:m-4 md:ml-0 md:aspect-auto md:w-[34%] md:min-w-[220px] md:max-w-[320px] md:shrink-0 md:self-start md:rounded-md" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifact.thumbnail || ""} alt="" onError={() => setThumbnailFailed(true)} className={`h-full w-full object-cover ${useWideLayout ? "md:h-auto md:object-contain" : ""}`} />
          {formatVideoDuration(artifact.video_duration_seconds) && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white tabular-nums">
              {formatVideoDuration(artifact.video_duration_seconds)}
            </span>
          )}
        </div>
      )}
      <div className={`relative z-10 min-w-0 space-y-3 p-4 ${useWideLayout ? "md:flex-1" : ""}`}>
        <div className="text-xs text-[var(--text-tertiary)]">
          <div className="flex min-w-0 items-center gap-2">
            {artifact.is_unread && <span aria-label="Unread" title="Unread" className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
            <ContentTypeIcon type={contentTypeForArtifact(artifact)} />
            <span className="truncate">{artifact.source_name || artifact.channel || "Reference"}</span>
            <span className="shrink-0">{artifact.created_at?.slice(0, 10)}</span>
          </div>
        </div>

        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-[var(--text-primary)]">{artifact.title}</h3>
        {reason && (
          <p className="text-[13px] italic leading-5 text-[var(--text-tertiary)]">
            {reason}
          </p>
        )}
        {artifact.summary && <p className="line-clamp-3 text-sm leading-6 text-[var(--text-secondary)]">{artifact.summary}</p>}
        {displayTags.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {displayTags.map((tag) => (
              <span key={tag} className="max-w-[8rem] shrink-0 truncate rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{tag}</span>
            ))}
          </div>
        )}
        {clipReview && (
          <div className="min-w-0 max-w-full overflow-hidden">
            <div className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${clipPolicyClass(clipReview.policy_action)}`} title={clipReview.signals.join(", ")}>
              <Play className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">{clipPolicyLabel(clipReview.policy_action)}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--text-tertiary)]">{clipReview.content_form} · {clipSignalSummary(clipReview.signals)}</span>
            </div>
          </div>
        )}

        {hasCardActionRow && (
          <div className="flex flex-wrap items-center justify-start gap-1 border-t border-[var(--border-default)] pt-3">
            <div className="flex shrink-0 items-center gap-1">
              <EvalMetricPills
                evalAttrs={artifact.eval_attrs}
                breakdown={showEvalBreakdown}
                showArchiveFlag={showEvalBreakdown}
                onWorthClick={openArtifactMetadata}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <LibraryLifecycleMenu
                artifact={artifact}
                promoteReason={promoteReason}
                onChanged={onChanged}
                onMarkUnread={onMarkUnread}
                onDismissCandidate={onDismissCandidate}
                onArchiveReference={onArchiveReference}
                open={lifecycleOpen}
                onOpenChange={(open) => {
                  setLifecycleOpen(open);
                  if (open) {
                    setActionsOpen(false);
                    setReviewOpen(false);
                  }
                }}
                stopPropagation
              />
              {hasUpdatedReviewActions && (
                <div className="pointer-events-auto relative" onClick={stopCardClick}>
                  <button
                    onClick={() => {
                      setReviewOpen((value) => !value);
                      setActionsOpen(false);
                      setLifecycleOpen(false);
                    }}
                    className="inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    title="Updated reference review actions"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Updated
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {reviewOpen && (
                    <div className="absolute left-0 z-50 mt-1 w-36 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow">
                      <button
                        onClick={async () => {
                          setReviewOpen(false);
                          await onReviewStatus?.(artifact.id, "approved");
                          onChanged?.();
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={async () => {
                          setReviewOpen(false);
                          const note = window.prompt("Reason for rejecting (optional):") ?? undefined;
                          await onReviewStatus?.(artifact.id, "rejected", note || undefined);
                          onChanged?.();
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
              {hasGeneralActions && (
                <div className="pointer-events-auto relative" onClick={stopCardClick}>
                  <button
                    onClick={() => {
                      setActionsOpen((value) => !value);
                      setReviewOpen(false);
                      setLifecycleOpen(false);
                    }}
                    className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    title="More reference actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {actionsOpen && (
                    <div className="absolute right-0 z-50 mt-1 w-44 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow">
                      {artifact.url && (
                        <a
                          href={artifact.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setActionsOpen(false)}
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open source
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
