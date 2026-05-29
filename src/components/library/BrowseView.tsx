"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LibraryArtifact } from "@/lib/library/types";
import { useInfiniteLibrary, useLibrarySources } from "@/hooks/useLibrary";
import { Bookmark, FileText } from "lucide-react";
import { SECONDARY_TOOLBAR_BODY_GUTTER_CLASS } from "@/components/layout/SecondaryToolbar";
import { LibraryArtifactDetailPane } from "./LibraryArtifactDetailPane";

const SOURCE_WIDTH_KEY = "hilt-library-source-width";
const LIST_WIDTH_KEY = "hilt-library-list-width";
const DEFAULT_SOURCE_WIDTH = 220;
const MIN_SOURCE_WIDTH = 180;
const MAX_SOURCE_WIDTH = 320;
const DEFAULT_LIST_WIDTH = 360;
const MIN_LIST_WIDTH = 300;
const MAX_LIST_WIDTH = 540;
const ARTIFACT_ROW_HEIGHT = 104;
const ARTIFACT_ROW_OVERSCAN = 10;

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

export function SourceNav({
  selectedSource,
  statusFilter,
  searchQuery,
  onSelect,
  onStatusSelect,
  className = "",
  style,
}: {
  selectedSource: string | null;
  statusFilter: "all" | "saved" | "candidate";
  searchQuery: string;
  onSelect: (source: string | null) => void;
  onStatusSelect?: (status: "all" | "saved" | "candidate") => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { sources: allStatusSources } = useLibrarySources({
    q: searchQuery || null,
  });
  const { sources } = useLibrarySources({
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
  });
  const allCount = allStatusSources.reduce((sum, source) => sum + source.artifact_count + source.candidate_count, 0);
  const savedCount = allStatusSources.reduce((sum, source) => sum + source.artifact_count, 0);
  const candidateCount = allStatusSources.reduce((sum, source) => sum + source.candidate_count, 0);
  const totalCount = sources.reduce((sum, source) => sum + source.artifact_count + source.candidate_count, 0);
  const statusItems = [
    { id: "all", label: "All", count: allCount },
    { id: "saved", label: "Saved", count: savedCount },
    { id: "candidate", label: "Candidates", count: candidateCount },
  ] as const;
  return (
    <aside data-testid="library-source-nav" className={`overflow-y-auto bg-[var(--bg-primary)] p-3 ${className}`} style={style}>
      {onStatusSelect && (
        <div className="mb-4 border-b border-[var(--border-default)] pb-3">
          <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Status</div>
          <div className="space-y-1">
            {statusItems.map((status) => (
              <button
                key={status.id}
                onClick={() => onStatusSelect(status.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${statusFilter === status.id ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
              >
                <span>{status.label}</span>
                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{status.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Sources</div>
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

export function ArtifactList({
  artifacts,
  total,
  selected,
  onSelect,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  className = "",
  style,
}: {
  artifacts: LibraryArtifact[];
  total: number;
  selected: string | null;
  onSelect: (artifact: LibraryArtifact) => void;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = artifacts.length + (hasMore || isLoadingMore ? 1 : 0);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ARTIFACT_ROW_HEIGHT,
    overscan: ARTIFACT_ROW_OVERSCAN,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const maybeLoadMore = useCallback(() => {
    const node = parentRef.current;
    if (!node || !hasMore || isLoadingMore) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 900) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    const node = parentRef.current;
    if (!node) return;
    const update = () => {
      maybeLoadMore();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [maybeLoadMore]);

  useEffect(() => {
    maybeLoadMore();
  }, [artifacts.length, maybeLoadMore]);

  const handleScroll = useCallback(() => {
    maybeLoadMore();
  }, [maybeLoadMore]);

  return (
    <div ref={parentRef} onScroll={handleScroll} data-mobile-scroll-chrome="top-bottom" data-testid="library-artifact-list" className={`overflow-y-auto bg-[var(--bg-primary)] ${className}`} style={style}>
      {artifacts.length > 0 ? (
        <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {virtualItems.map((virtualRow) => {
            const artifact = artifacts[virtualRow.index];
            if (!artifact) {
              return (
                <div
                  key="library-artifact-list-loader"
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 flex min-h-20 w-full items-center justify-center border-b border-[var(--border-default)] px-3 py-4 text-xs text-[var(--text-tertiary)]"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {isLoadingMore ? "Loading more..." : `${artifacts.length} of ${total} loaded`}
                </div>
              );
            }
            return (
              <button
                key={artifact.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                data-testid="library-artifact-row"
                onClick={() => onSelect(artifact)}
                className={`absolute left-0 top-0 flex min-h-[92px] w-full gap-3 border-b border-[var(--border-default)] p-3 text-left transition-colors ${selected === artifact.id ? "bg-[var(--bg-secondary)]" : "hover:bg-[var(--bg-secondary)]"}`}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
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
                <div className="min-w-0 flex-1 self-center">
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
            );
          })}
        </div>
      ) : (
        <div className="p-5 text-sm text-[var(--text-tertiary)]">{isLoading ? "Loading library..." : "No artifacts match this source or search."}</div>
      )}
      {artifacts.length > 0 && !hasMore && (
        <div className="border-t border-[var(--border-default)] p-3 text-center text-xs text-[var(--text-tertiary)]">
          {artifacts.length} of {total} loaded
        </div>
      )}
    </div>
  );
}

export function BrowseView({
  searchQuery,
  statusFilter,
  openArtifactId,
  onCountChange,
  onOpen,
}: {
  searchQuery: string;
  statusFilter: "all" | "saved" | "candidate";
  openArtifactId?: string | null;
  onCountChange?: (count: number) => void;
  onOpen?: (artifact: LibraryArtifact) => void;
}) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const { artifacts, total, mutate, isLoading, hasMore, isLoadingMore, loadMore } = useInfiniteLibrary({
    source: selectedSource,
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
  }, 80);
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
    if (!openArtifactId) return;
    setSelectedId(openArtifactId);
    setMobilePane("detail");
  }, [openArtifactId]);

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
          <span className="ml-auto min-w-0 truncate text-xs text-[var(--text-tertiary)]">{artifacts.length} of {total}</span>
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
            total={total}
            selected={selectedArtifactId}
            onSelect={selectArtifact}
            isLoading={isLoading}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            className={`${mobilePane === "list" ? "block" : "hidden"} min-h-0 w-full flex-1 lg:block lg:w-[var(--library-list-width)] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--border-default)]`}
            style={{ "--library-list-width": `${listWidth}px` } as CSSProperties}
          />
          <div
            data-testid="library-list-resizer"
            className={`hidden lg:block w-1 cursor-col-resize transition-colors hover:bg-[var(--accent-primary)] ${resizing === "list" ? "bg-[var(--accent-primary)]" : "bg-transparent"}`}
            onMouseDown={startResize("list", listWidth)}
          />
          <div className={`${mobilePane === "detail" ? "flex" : "hidden"} min-h-0 flex-1 lg:flex`}>
            <LibraryArtifactDetailPane
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
