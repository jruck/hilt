"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { archiveArtifact, promoteCandidate, skipCandidate, useLibrary, useLibraryArtifact, useLibrarySources } from "@/hooks/useLibrary";
import { Archive, ArrowLeft, Bookmark, FileText, MoreHorizontal } from "lucide-react";
import { getYouTubeVideoId } from "@/lib/library/media";
import { SECONDARY_TOOLBAR_BODY_GUTTER_CLASS } from "@/components/layout/SecondaryToolbar";
import { LibraryMarkdown } from "./LibraryMarkdown";

const SOURCE_WIDTH_KEY = "hilt-library-source-width";
const LIST_WIDTH_KEY = "hilt-library-list-width";
const DEFAULT_SOURCE_WIDTH = 220;
const MIN_SOURCE_WIDTH = 180;
const MAX_SOURCE_WIDTH = 320;
const DEFAULT_LIST_WIDTH = 360;
const MIN_LIST_WIDTH = 300;
const MAX_LIST_WIDTH = 540;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function storedWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function SourceNav({
  selectedSource,
  statusFilter,
  searchQuery,
  onSelect,
  className = "",
  style,
}: {
  selectedSource: string | null;
  statusFilter: "all" | "saved" | "candidate";
  searchQuery: string;
  onSelect: (source: string | null) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { sources } = useLibrarySources({
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
  });
  const totalCount = sources.reduce((sum, source) => sum + source.artifact_count + source.candidate_count, 0);
  return (
    <aside data-testid="library-source-nav" className={`overflow-y-auto bg-[var(--bg-primary)] p-3 ${className}`} style={style}>
      <button
        onClick={() => onSelect(null)}
        className={`mb-2 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selectedSource === null ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
      >
        <span>All sources</span>
        <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{totalCount}</span>
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
  style,
}: {
  artifacts: LibraryArtifact[];
  selected: string | null;
  onSelect: (artifact: LibraryArtifact) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div data-testid="library-artifact-list" className={`overflow-y-auto bg-[var(--bg-primary)] ${className}`} style={style}>
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
  const [mode, setMode] = useState<"summary" | "cache">("summary");
  const [actionsOpen, setActionsOpen] = useState(false);

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
                >
                  Skip
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

export function BrowseView({
  searchQuery,
  statusFilter,
  onCountChange,
  onOpen,
}: {
  searchQuery: string;
  statusFilter: "all" | "saved" | "candidate";
  onCountChange?: (count: number) => void;
  onOpen?: (artifact: LibraryArtifact) => void;
}) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const { artifacts, total, mutate } = useLibrary({
    source: selectedSource,
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
    limit: 200,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"sources" | "list" | "detail">("list");
  const [sourceWidth, setSourceWidth] = useState(() => storedWidth(SOURCE_WIDTH_KEY, DEFAULT_SOURCE_WIDTH, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
  const [listWidth, setListWidth] = useState(() => storedWidth(LIST_WIDTH_KEY, DEFAULT_LIST_WIDTH, MIN_LIST_WIDTH, MAX_LIST_WIDTH));
  const [resizing, setResizing] = useState<"source" | "list" | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const firstId = useMemo(() => artifacts[0]?.id || null, [artifacts]);
  const selectedArtifactId = selectedId && artifacts.some((artifact) => artifact.id === selectedId) ? selectedId : firstId;

  useEffect(() => {
    onCountChange?.(total);
  }, [onCountChange, total]);

  useEffect(() => {
    localStorage.setItem(SOURCE_WIDTH_KEY, String(sourceWidth));
  }, [sourceWidth]);

  useEffect(() => {
    localStorage.setItem(LIST_WIDTH_KEY, String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = event.clientX - resizeRef.current.startX;
      if (resizing === "source") {
        setSourceWidth(clamp(resizeRef.current.startWidth + delta, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
      } else {
        setListWidth(clamp(resizeRef.current.startWidth + delta, MIN_LIST_WIDTH, MAX_LIST_WIDTH));
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  const selectSource = (source: string | null) => {
    setSelectedSource(source);
    setSelectedId(null);
    setMobilePane("list");
  };

  const selectArtifact = (artifact: LibraryArtifact) => {
    setSelectedId(artifact.id);
    setMobilePane("detail");
    onOpen?.(artifact);
  };

  const startResize = useCallback((kind: "source" | "list", width: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(kind);
    resizeRef.current = { startX: event.clientX, startWidth: width };
  }, []);

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${SECONDARY_TOOLBAR_BODY_GUTTER_CLASS} ${resizing ? "select-none" : ""}`}>
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
            disabled={!selectedArtifactId}
            className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium ${mobilePane === "detail" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] disabled:opacity-40"}`}
          >
            Detail
          </button>
          <span className="ml-auto min-w-0 truncate text-xs text-[var(--text-tertiary)]">{artifacts.length} items</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <SourceNav
            selectedSource={selectedSource}
            statusFilter={statusFilter}
            searchQuery={searchQuery}
            onSelect={selectSource}
            className={`${mobilePane === "sources" ? "block" : "hidden"} relative min-h-0 w-full flex-1 lg:block lg:w-[var(--library-source-width)] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--border-default)]`}
            style={{ "--library-source-width": `${sourceWidth}px` } as CSSProperties}
          />
          <div
            data-testid="library-source-resizer"
            className={`hidden lg:block w-1 cursor-col-resize transition-colors hover:bg-[var(--accent-primary)] ${resizing === "source" ? "bg-[var(--accent-primary)]" : "bg-transparent"}`}
            onMouseDown={startResize("source", sourceWidth)}
          />
          <ArtifactList
            artifacts={artifacts}
            selected={selectedArtifactId}
            onSelect={selectArtifact}
            className={`${mobilePane === "list" ? "block" : "hidden"} min-h-0 w-full flex-1 lg:block lg:w-[var(--library-list-width)] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--border-default)]`}
            style={{ "--library-list-width": `${listWidth}px` } as CSSProperties}
          />
          <div
            data-testid="library-list-resizer"
            className={`hidden lg:block w-1 cursor-col-resize transition-colors hover:bg-[var(--accent-primary)] ${resizing === "list" ? "bg-[var(--accent-primary)]" : "bg-transparent"}`}
            onMouseDown={startResize("list", listWidth)}
          />
          <div className={`${mobilePane === "detail" ? "flex" : "hidden"} min-h-0 flex-1 lg:flex`}>
            <ArtifactDetail
              key={selectedArtifactId ?? "empty"}
              id={selectedArtifactId}
              showBack={mobilePane === "detail"}
              onBack={() => setMobilePane("list")}
              onChanged={() => mutate()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
