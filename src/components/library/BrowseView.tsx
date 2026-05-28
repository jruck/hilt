"use client";

import { useEffect, useMemo, useState } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { archiveArtifact, promoteCandidate, skipCandidate, useLibrary, useLibraryArtifact, useLibrarySources } from "@/hooks/useLibrary";
import { Archive, ArrowLeft, Bookmark, ExternalLink, FileText } from "lucide-react";
import { getYouTubeVideoId } from "@/lib/library/media";
import { LibraryMarkdown } from "./LibraryMarkdown";

function SourceNav({
  selectedSource,
  onSelect,
  className = "",
}: {
  selectedSource: string | null;
  onSelect: (source: string | null) => void;
  className?: string;
}) {
  const { sources } = useLibrarySources();
  return (
    <aside data-testid="library-source-nav" className={`overflow-y-auto bg-[var(--bg-primary)] p-3 ${className}`}>
      <button
        onClick={() => onSelect(null)}
        className={`mb-2 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selectedSource === null ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
      >
        <span>All sources</span>
      </button>
      <div className="space-y-1">
        {sources.map((source) => (
          <button
            key={source.id}
            onClick={() => onSelect(source.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${selectedSource === source.id ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
          >
            <span className="min-w-0 truncate">{source.name}</span>
            <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{source.artifact_count + source.candidate_count}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ArtifactList({
  artifacts,
  selected,
  onSelect,
  className = "",
}: {
  artifacts: LibraryArtifact[];
  selected: string | null;
  onSelect: (artifact: LibraryArtifact) => void;
  className?: string;
}) {
  return (
    <div data-testid="library-artifact-list" className={`overflow-y-auto bg-[var(--bg-primary)] ${className}`}>
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          data-testid="library-artifact-row"
          onClick={() => onSelect(artifact)}
          className={`flex w-full gap-3 border-b border-[var(--border-default)] p-3 text-left transition-colors ${selected === artifact.id ? "bg-[var(--bg-secondary)]" : "hover:bg-[var(--bg-secondary)]"}`}
        >
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--content-surface)] text-[var(--text-tertiary)]">
            {artifact.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artifact.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : artifact.lifecycle_status === "candidate" ? (
              <Bookmark className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm font-medium leading-5 text-[var(--text-primary)]">{artifact.title}</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-tertiary)]">
              <span className="truncate">{artifact.source_name || artifact.channel}</span>
              <span>{artifact.created_at?.slice(0, 10)}</span>
              <span className={`rounded-full px-1.5 py-0.5 ${artifact.lifecycle_status === "candidate" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
                {artifact.lifecycle_status === "candidate" ? "Candidate" : "Saved"}
              </span>
            </div>
          </div>
        </button>
      ))}
      {artifacts.length === 0 && (
        <div className="p-5 text-sm text-[var(--text-tertiary)]">No artifacts match this source or search.</div>
      )}
    </div>
  );
}

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
  const body = removeMarkdownSections(artifact.content, ["Media", "Raw Content"]);
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

function MediaPreview({ artifact }: { artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]> }) {
  const videoId = getYouTubeVideoId(artifact.url);
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

function ArtifactDetail({
  id,
  onBack,
  showBack = false,
  onChanged,
}: {
  id: string | null;
  onBack?: () => void;
  showBack?: boolean;
  onChanged?: () => void;
}) {
  const { artifact, isLoading, mutate } = useLibraryArtifact(id);
  const [mode, setMode] = useState<"summary" | "source">("summary");

  useEffect(() => {
    setMode("summary");
  }, [id]);

  if (!id) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)]">Select an artifact</div>;
  }
  if (isLoading || !artifact) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)]">Loading...</div>;
  }
  const sourceMarkdown = cachedSourceMarkdown(artifact.content);
  const hasCachedSource = sourceMarkdown.length > 0 && sourceMarkdown !== "No cached source content available.";
  const isCandidate = artifact.lifecycle_status === "candidate";
  const handleChanged = async () => {
    await mutate();
    onChanged?.();
  };
  return (
    <article data-testid="library-artifact-detail" className="min-w-0 flex-1 overflow-y-auto bg-[var(--content-surface)]">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-5 lg:px-7 lg:py-6">
        {showBack && (
          <button
            onClick={onBack}
            className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
          <span>{artifact.source_name || artifact.channel} · {artifact.created_at?.slice(0, 10)}</span>
          <span className={`rounded-full px-2 py-0.5 ${artifact.lifecycle_status === "candidate" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
            {artifact.lifecycle_status === "candidate" ? "Candidate" : "Saved"}
          </span>
        </div>
        <h1 className="text-xl font-semibold leading-tight text-[var(--text-primary)] sm:text-2xl">{artifact.title}</h1>

        <div className="mt-5 flex flex-col gap-3 border-y border-[var(--border-default)] py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-0.5 sm:inline-flex">
            <button
              onClick={() => setMode("summary")}
              className={`min-h-9 rounded px-3 py-1.5 text-xs font-medium ${mode === "summary" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
            >
              Summary
            </button>
            <button
              onClick={() => setMode("source")}
              disabled={!hasCachedSource}
              className={`min-h-9 rounded px-3 py-1.5 text-xs font-medium ${mode === "source" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"}`}
            >
              Cached Source
            </button>
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
                >
                  Skip
                </button>
              </>
            ) : (
              <button
                onClick={async () => { await archiveArtifact(artifact.id); await handleChanged(); }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                title="Archive saved reference"
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </button>
            )}
            {artifact.url && (
              <a href={artifact.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]">
                <ExternalLink className="h-3.5 w-3.5" />
                Open source
              </a>
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

export function BrowseView({ searchQuery, onOpen }: { searchQuery: string; onOpen?: (artifact: LibraryArtifact) => void }) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "saved" | "candidate">("all");
  const { artifacts, mutate } = useLibrary({
    source: selectedSource,
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
    limit: 200,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"sources" | "list" | "detail">("list");
  const firstId = useMemo(() => artifacts[0]?.id || null, [artifacts]);

  useEffect(() => {
    if (!selectedId || !artifacts.some((artifact) => artifact.id === selectedId)) {
      setSelectedId(firstId);
    }
  }, [artifacts, firstId, selectedId]);

  const selectSource = (source: string | null) => {
    setSelectedSource(source);
    setMobilePane("list");
  };

  const selectArtifact = (artifact: LibraryArtifact) => {
    setSelectedId(artifact.id);
    setMobilePane("detail");
    onOpen?.(artifact);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[var(--border-default)]">
      <div data-testid="library-mobile-pane-nav" className="flex shrink-0 items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 lg:hidden">
        <button
          onClick={() => setMobilePane("sources")}
          className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium ${mobilePane === "sources" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
        >
          Sources
        </button>
        <button
          onClick={() => setMobilePane("list")}
          className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium ${mobilePane === "list" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
        >
          Items
        </button>
        <button
          onClick={() => setMobilePane("detail")}
          disabled={!selectedId}
          className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium ${mobilePane === "detail" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] disabled:opacity-40"}`}
        >
          Detail
        </button>
        <span className="ml-auto min-w-0 truncate text-xs text-[var(--text-tertiary)]">{artifacts.length} items</span>
      </div>

      <div data-testid="library-status-filter" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
        <div className="grid grid-cols-3 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-0.5">
          {(["all", "saved", "candidate"] as const).map((status) => (
            <button
              key={status}
              onClick={() => {
                setStatusFilter(status);
                setMobilePane("list");
              }}
              className={`min-h-9 rounded px-3 py-1.5 text-xs font-medium ${statusFilter === status ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
            >
              {status === "candidate" ? "Candidates" : status[0].toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">{artifacts.length} shown</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SourceNav
          selectedSource={selectedSource}
          onSelect={selectSource}
          className={`${mobilePane === "sources" ? "block" : "hidden"} min-h-0 flex-1 lg:block lg:w-64 lg:shrink-0 lg:border-r lg:border-[var(--border-default)]`}
        />
        <ArtifactList
          artifacts={artifacts}
          selected={selectedId}
          onSelect={selectArtifact}
          className={`${mobilePane === "list" ? "block" : "hidden"} min-h-0 flex-1 lg:block lg:w-[min(420px,42vw)] lg:shrink-0 lg:border-r lg:border-[var(--border-default)]`}
        />
        <div className={`${mobilePane === "detail" ? "flex" : "hidden"} min-h-0 flex-1 lg:flex`}>
          <ArtifactDetail
            id={selectedId}
            showBack={mobilePane === "detail"}
            onBack={() => setMobilePane("list")}
            onChanged={() => mutate()}
          />
        </div>
      </div>
    </div>
  );
}
