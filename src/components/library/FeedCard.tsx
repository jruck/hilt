"use client";

import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import { Bookmark, ExternalLink, FileText, Mail, Play, Rss, Sparkles, X } from "lucide-react";
import { promoteCandidate, skipCandidate } from "@/hooks/useLibrary";

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
  onChanged,
  onOpen,
}: {
  artifact: LibraryArtifact | RecommendedArtifact;
  why?: string;
  priority?: RecommendedArtifact["priority"];
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
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-tertiary)]">
          <div className="flex min-w-0 items-center gap-2">
            <ChannelIcon channel={artifact.channel} />
            <span className="truncate">{artifact.source_name || artifact.channel || "Reference"}</span>
            <span className="shrink-0">{artifact.created_at?.slice(0, 10)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-default)] pt-3">
          <button onClick={() => onOpen?.(artifact)} className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]">Read more</button>
          <div className="flex items-center gap-2">
            {isCandidate && (
              <>
                <button
                  onClick={async () => { await promoteCandidate(artifact.id); onChanged?.(); }}
                  className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  Save
                </button>
                <button
                  onClick={async () => { await skipCandidate(artifact.id); onChanged?.(); }}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                >
                  Skip
                </button>
              </>
            )}
            {artifact.url && (
              <a href={artifact.url} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" title="Open source">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

