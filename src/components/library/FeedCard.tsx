"use client";

import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import type { PromotionReason } from "@/lib/library/types";
import { Archive, Bookmark, ExternalLink, FileText, Mail, Play, Rss, Sparkles, X } from "lucide-react";
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
}: {
  artifact: LibraryArtifact | RecommendedArtifact;
  why?: string;
  priority?: RecommendedArtifact["priority"];
  promoteReason?: PromotionReason;
  onChanged?: () => void;
  onOpen?: (artifact: LibraryArtifact) => void;
}) {
  const isCandidate = artifact.lifecycle_status === "candidate";
  const priorityLabel = priority === "must_read" ? "Must Read" : priority === "recommended" ? "Recommended" : priority === "interesting" ? "Interesting" : null;

  return (
    <article className="group overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] content-card-shadow transition-colors hover:border-[var(--text-tertiary)]">
      {artifact.thumbnail && (
        <button onClick={() => onOpen?.(artifact)} className="block aspect-video w-full overflow-hidden bg-[var(--bg-secondary)] text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifact.thumbnail} alt="" className="h-full w-full object-cover" />
        </button>
      )}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
          <div className="flex min-w-0 items-center gap-2">
            <ChannelIcon channel={artifact.channel} />
            <span className="truncate">{artifact.source_name || artifact.channel || "Reference"}</span>
            <span className="shrink-0">{artifact.created_at?.slice(0, 10)}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {priorityLabel && <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[var(--text-secondary)]">{priorityLabel}</span>}
            {isCandidate && <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">Candidate</span>}
          </div>
        </div>

        <button onClick={() => onOpen?.(artifact)} className="block text-left">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-[var(--text-primary)]">{artifact.title}</h3>
        </button>
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
        <div className="flex flex-col gap-3 border-t border-[var(--border-default)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <button onClick={() => onOpen?.(artifact)} className="min-h-9 text-left text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]">Read more</button>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {isCandidate && (
              <>
                <button
                  onClick={async () => { await promoteCandidate(artifact.id, promoteReason); onChanged?.(); }}
                  className="min-h-9 rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  Save
                </button>
                <button
                  onClick={async () => { await skipCandidate(artifact.id); onChanged?.(); }}
                  className="min-h-9 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                >
                  Skip
                </button>
              </>
            )}
            {!isCandidate && (
              <button
                onClick={async () => { await archiveArtifact(artifact.id); onChanged?.(); }}
                className="inline-flex min-h-9 items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                title="Archive saved reference"
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </button>
            )}
            {artifact.url && (
              <a href={artifact.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" title="Open source">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
