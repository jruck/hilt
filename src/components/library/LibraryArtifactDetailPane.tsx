"use client";

import { useState } from "react";
import { Archive, ArrowLeft, MoreHorizontal, X } from "lucide-react";
import { archiveArtifact, promoteCandidate, skipCandidate, useLibraryArtifact } from "@/hooks/useLibrary";
import { stripLegacyReferenceBodyCruft } from "@/lib/library/legacy-cleanup";
import { getYouTubeVideoId } from "@/lib/library/media";
import { LibraryMarkdown } from "./LibraryMarkdown";

function markdownSection(markdown: string, sectionName: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
  if (start === -1) return "";
  const collected: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n").trim();
}

function removeMarkdownSections(markdown: string, sectionNames: string[]): string {
  const names = new Set(sectionNames.map((name) => name.toLowerCase()));
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      skipping = names.has(heading[1].toLowerCase());
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").replace(/^#\s+.+\n+/, "").trim();
}

function stripDetails(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^<details>\s*<summary>[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>$/i);
  return (match?.[1] || trimmed).trim();
}

function summaryMarkdown(artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>): string {
  const body = removeMarkdownSections(stripLegacyReferenceBodyCruft(artifact.content), ["Media", "Raw Content"]);
  if (body) return body;
  const keyPoints = artifact.key_points.length ? artifact.key_points.map((point) => `- ${point}`).join("\n") : "";
  const connections = artifact.connections.length ? artifact.connections.map((connection) => `- ${connection}`).join("\n") : "";
  return [
    "## Summary",
    artifact.summary || "",
    keyPoints ? `\n## Key Points\n\n${keyPoints}` : "",
    connections ? `\n## Connections\n\n${connections}` : "",
  ].join("\n").trim();
}

function cachedSourceMarkdown(content: string): string {
  return stripDetails(markdownSection(content, "Raw Content"));
}

function frontmatterString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function MediaPreview({ artifact }: { artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]> }) {
  const mediaMarkdown = markdownSection(artifact.content, "Media");
  if (mediaMarkdown) {
    return <LibraryMarkdown markdown={mediaMarkdown} className="mb-5" />;
  }
  if (artifact.content.includes("<iframe") || artifact.content.includes("youtube.com/embed/")) {
    return null;
  }

  const embeddedMediaUrl = frontmatterString(artifact.raw_frontmatter, ["video_url", "youtube_url", "media_url"]);
  const videoId = getYouTubeVideoId(embeddedMediaUrl || artifact.url);
  if (videoId) {
    return (
      <div className="mb-5 aspect-video w-full overflow-hidden rounded-lg border border-[var(--border-default)] bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          title={artifact.title}
          className="h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  if (artifact.thumbnail) {
    return (
      <div className="mb-5 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={artifact.thumbnail} alt="" className="max-h-[360px] w-full object-cover" />
      </div>
    );
  }
  return null;
}

export function LibraryArtifactDetailPane({
  id,
  onBack,
  onClose,
  showBack = false,
  showClose = false,
  onChanged,
  className = "",
  controlsClassName = "",
  backClassName = "",
  closeClassName = "",
}: {
  id: string | null;
  onBack?: () => void;
  onClose?: () => void;
  showBack?: boolean;
  showClose?: boolean;
  onChanged?: () => void;
  className?: string;
  controlsClassName?: string;
  backClassName?: string;
  closeClassName?: string;
}) {
  const { artifact, isLoading, mutate } = useLibraryArtifact(id);
  const [mode, setMode] = useState<"summary" | "cache">("summary");
  const [actionsOpen, setActionsOpen] = useState(false);

  if (!id) {
    return <div className={`flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)] ${className}`}>Select an artifact</div>;
  }
  if (isLoading || !artifact) {
    return <div className={`flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)] ${className}`}>Loading...</div>;
  }

  const sourceMarkdown = cachedSourceMarkdown(artifact.content);
  const hasCachedSource = sourceMarkdown.length > 0 && sourceMarkdown !== "No cached source content available.";
  const isCandidate = artifact.lifecycle_status === "candidate";
  const handleChanged = async () => {
    await mutate();
    onChanged?.();
  };

  return (
    <article data-testid="library-artifact-detail" data-mobile-scroll-chrome="top-bottom" className={`min-w-0 flex-1 overflow-y-auto bg-[var(--content-surface)] ${className}`}>
      <div className="mx-auto max-w-3xl px-4 pb-[calc(var(--hilt-mobile-nav-clearance)+1rem)] pt-4 sm:px-6 sm:pb-[calc(var(--hilt-mobile-nav-clearance)+1.25rem)] sm:pt-5 lg:px-7 lg:pt-6">
        {(showBack || showClose) && (
          <div className={`mb-4 flex items-center justify-between gap-3 ${controlsClassName}`}>
            {showBack ? (
              <button
                type="button"
                onClick={onBack}
                className={`inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] ${backClassName}`}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <span />
            )}
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                className={`ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] ${closeClassName}`}
                aria-label="Close reference"
                title="Close reference"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
          <span>{artifact.source_name || artifact.channel} · {artifact.created_at?.slice(0, 10)}</span>
          <span className={`rounded-full px-2 py-0.5 ${artifact.lifecycle_status === "candidate" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
            {artifact.lifecycle_status === "candidate" ? "Candidate" : "Saved"}
          </span>
        </div>
        <h1 className="text-xl font-semibold leading-tight text-[var(--text-primary)] sm:text-2xl">{artifact.title}</h1>

        <div className="mt-5 flex flex-col gap-3 border-y border-[var(--border-default)] py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="grid grid-cols-3 rounded-lg bg-[var(--bg-tertiary)] p-0.5 sm:inline-flex">
            <button
              onClick={() => setMode("summary")}
              className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${mode === "summary" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            >
              Summary
            </button>
            <button
              onClick={() => setMode("cache")}
              disabled={!hasCachedSource}
              className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${mode === "cache" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"}`}
            >
              Cache
            </button>
            {artifact.url ? (
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                Source
              </a>
            ) : (
              <span className="inline-flex h-8 cursor-not-allowed items-center justify-center rounded-md px-3 text-xs font-medium text-[var(--text-tertiary)] opacity-40">Source</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCandidate ? (
              <>
                <button
                  onClick={async () => { await promoteCandidate(artifact.id); await handleChanged(); }}
                  className="min-h-9 rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  Save
                </button>
                <button
                  onClick={async () => { await skipCandidate(artifact.id); await handleChanged(); }}
                  className="min-h-9 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                  title="Dismiss this candidate from review; it remains in the temporary candidate cache until cleanup"
                >
                  Dismiss
                </button>
              </>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setActionsOpen((value) => !value)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
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
                        setActionsOpen(false);
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
          </div>
        </div>

        <div className="mt-5">
          <MediaPreview artifact={artifact} />
          {mode === "summary" ? (
            <LibraryMarkdown markdown={summaryMarkdown(artifact)} />
          ) : hasCachedSource ? (
            <LibraryMarkdown markdown={sourceMarkdown} />
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">No cached source content is available for this item yet.</p>
          )}
        </div>
      </div>
    </article>
  );
}
