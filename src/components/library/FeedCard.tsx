"use client";

import { useState, type MouseEvent } from "react";
import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import type { PromotionReason } from "@/lib/library/types";
import { Archive, Bookmark, ExternalLink, FileText, Mail, MoreHorizontal, Play, Rss, Sparkles, X } from "lucide-react";
import { archiveArtifact, promoteCandidate, skipCandidate } from "@/hooks/useLibrary";

function ChannelIcon({ channel }: { channel: LibraryArtifact["channel"] }) {
  const cls = "h-4 w-4";
  if (channel === "youtube") return <Play className={cls} />;
  if (channel === "rss") return <Rss className={cls} />;
  if (channel === "email") return <Mail className={cls} />;
  if (channel === "twitter") return <X className={cls} />;
  if (channel === "raindrop") return <Bookmark className={cls} />;
  return <FileText className={cls} />;
}

export function FeedCard({
  artifact,
  why,
  priority,
  promoteReason = "manual_save",
  onChanged,
  onOpen,
  active = false,
}: {
  artifact: LibraryArtifact | RecommendedArtifact;
  why?: string;
  priority?: RecommendedArtifact["priority"];
  promoteReason?: PromotionReason;
  onChanged?: () => void;
  onOpen?: (artifact: LibraryArtifact) => void;
  active?: boolean;
}) {
  const isCandidate = artifact.lifecycle_status === "candidate";
  const [actionsOpen, setActionsOpen] = useState(false);
  const priorityLabel = priority === "must_read" ? "Must Read" : priority === "recommended" ? "Recommended" : priority === "interesting" ? "Interesting" : null;
  const openArtifact = () => onOpen?.(artifact);
  const stopCardClick = (event: MouseEvent) => event.stopPropagation();
  const activeClass = active
    ? "border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]"
    : "border-[var(--border-default)] hover:border-[var(--text-tertiary)]";

  return (
    <article className={`group relative overflow-hidden rounded-lg border bg-[var(--content-surface)] content-card-shadow transition-colors ${activeClass}`}>
      <button
        type="button"
        aria-label={`Open ${artifact.title}`}
        onClick={openArtifact}
        aria-current={active ? "true" : undefined}
        className="absolute inset-0 z-0 cursor-pointer rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)]"
      />
      {artifact.thumbnail && (
        <div className="relative z-10 block aspect-video w-full overflow-hidden bg-[var(--bg-secondary)] text-left pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifact.thumbnail} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="relative z-10 space-y-3 p-4 pointer-events-none">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
          <div className="flex min-w-0 items-center gap-2">
            {artifact.is_unread && <span aria-label="Unread" title="Unread" className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
            <ChannelIcon channel={artifact.channel} />
            <span className="truncate">{artifact.source_name || artifact.channel || "Reference"}</span>
            <span className="shrink-0">{artifact.created_at?.slice(0, 10)}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {priorityLabel && <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[var(--text-secondary)]">{priorityLabel}</span>}
            {isCandidate && <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">Candidate</span>}
          </div>
        </div>

        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-[var(--text-primary)]">{artifact.title}</h3>
        {artifact.summary && <p className="line-clamp-3 text-sm leading-6 text-[var(--text-secondary)]">{artifact.summary}</p>}
        {why && (
          <p className="flex gap-2 text-sm leading-5 text-[var(--text-tertiary)]">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{why}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {artifact.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{tag}</span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-default)] pt-3">
            {isCandidate && (
              <>
                <button
                  onClick={async (event) => { event.stopPropagation(); await promoteCandidate(artifact.id, promoteReason); onChanged?.(); }}
                  className="pointer-events-auto min-h-9 rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                  title="Save this candidate as a durable reference"
                >
                  Save
                </button>
                <button
                  onClick={async (event) => { event.stopPropagation(); await skipCandidate(artifact.id); onChanged?.(); }}
                  className="pointer-events-auto min-h-9 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                  title="Dismiss this candidate from review; it remains in the temporary candidate cache until cleanup"
                >
                  Dismiss
                </button>
              </>
            )}
            {!isCandidate && (
              <div className="pointer-events-auto relative" onClick={stopCardClick}>
                <button
                  onClick={() => setActionsOpen((value) => !value)}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  title="More saved-reference actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {actionsOpen && (
                  <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow">
                    <button
                      onClick={async () => {
                        if (!window.confirm("Archive this saved reference? It will move out of the active Library.")) return;
                        await archiveArtifact(artifact.id);
                        onChanged?.();
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      Archive reference
                    </button>
                  </div>
                )}
              </div>
            )}
            {artifact.url && (
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                onClick={stopCardClick}
                className="pointer-events-auto inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                title="Open source"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
        </div>
      </div>
    </article>
  );
}
