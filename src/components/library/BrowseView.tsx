"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LibraryArtifact, LibrarySourceFacetSummary, LibrarySourceSummary } from "@/lib/library/types";
import { formatVideoDuration } from "@/lib/library/media";
import { artifactDisplayTags } from "@/lib/library/taxonomy";
import { libraryChannelSource, librarySourceChannel, type LibraryModeControl } from "@/lib/library/url";
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

function CountBadge({ count, unread, review }: { count: number; unread?: number; review?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-xs text-[var(--text-tertiary)]">{count}</span>
      {Boolean(unread) && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-blue-500">
          {unread}
        </span>
      )}
      {Boolean(review) && (
        <span title="Pending review" className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-600">
          {review}
        </span>
      )}
    </span>
  );
}

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

function sourceTotal(source: LibrarySourceSummary): number {
  return source.artifact_count + source.candidate_count;
}

function sumSourceTotals(sources: LibrarySourceSummary[]): number {
  return sources.reduce((sum, source) => sum + sourceTotal(source), 0);
}

function sumSourceField(sources: LibrarySourceSummary[], field: keyof Pick<LibrarySourceSummary, "unread_count" | "review_count">): number {
  return sources.reduce((sum, source) => sum + Number(source[field] || 0), 0);
}

function mergeFacets(sources: LibrarySourceSummary[]): LibrarySourceFacetSummary[] {
  const facets = new Map<string, LibrarySourceFacetSummary>();
  for (const source of sources) {
    for (const facet of source.facets) {
      const key = `${facet.kind}:${facet.value.toLowerCase()}`;
      const current = facets.get(key) || { ...facet, count: 0, unread_count: 0, review_count: 0 };
      current.count += facet.count;
      current.unread_count += facet.unread_count;
      current.review_count += facet.review_count;
      facets.set(key, current);
    }
  }
  return Array.from(facets.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 40);
}

function youtubeSourceRank(source: LibrarySourceSummary): number {
  if (source.id === "youtube-bookmarks") return 0;
  if (source.id === "youtube-watch-later") return 1;
  if (source.id === "youtube-liked-videos") return 2;
  return 10;
}

function sortYoutubeSources(sources: LibrarySourceSummary[]): LibrarySourceSummary[] {
  return [...sources].sort((a, b) => youtubeSourceRank(a) - youtubeSourceRank(b) || a.name.localeCompare(b.name));
}

export function SourceNav({
  selectedSource,
  selectedTag,
  statusFilter,
  modeFilter,
  searchQuery,
  onSelect,
  onTagSelect,
  onStatusSelect,
  onModeSelect,
  className = "",
  style,
}: {
  selectedSource: string | null;
  selectedTag: string | null;
  statusFilter: "all" | "saved" | "candidate";
  modeFilter: LibraryModeControl;
  searchQuery: string;
  onSelect: (source: string | null) => void;
  onTagSelect?: (source: string | null, tag: string | null) => void;
  onStatusSelect?: (status: "all" | "saved" | "candidate") => void;
  onModeSelect?: (mode: LibraryModeControl) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { sources: allStatusSources } = useLibrarySources({
    mode: modeFilter,
    tag: selectedTag,
    q: searchQuery || null,
  });
  const { sources: allModeSources } = useLibrarySources({
    mode: "all",
    tag: selectedTag,
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
  });
  const { sources } = useLibrarySources({
    status: statusFilter === "all" ? null : statusFilter,
    mode: modeFilter,
    tag: selectedTag,
    q: searchQuery || null,
  });
  const allCount = allStatusSources.reduce((sum, source) => sum + source.artifact_count + source.candidate_count, 0);
  const savedCount = allStatusSources.reduce((sum, source) => sum + source.artifact_count, 0);
  const candidateCount = allStatusSources.reduce((sum, source) => sum + source.candidate_count, 0);
  const allUnreadCount = allStatusSources.reduce((sum, source) => sum + source.unread_count, 0);
  const savedUnreadCount = allStatusSources.reduce((sum, source) => sum + source.saved_unread_count, 0);
  const candidateUnreadCount = allStatusSources.reduce((sum, source) => sum + source.candidate_unread_count, 0);
  const totalCount = sources.reduce((sum, source) => sum + source.artifact_count + source.candidate_count, 0);
  const totalUnreadCount = sources.reduce((sum, source) => sum + source.unread_count, 0);
  const totalReviewCount = sources.reduce((sum, source) => sum + source.review_count, 0);
  const allReviewCount = allStatusSources.reduce((sum, source) => sum + source.review_count, 0);
  const savedReviewCount = allStatusSources.reduce((sum, source) => sum + source.saved_review_count, 0);
  const candidateReviewCount = allStatusSources.reduce((sum, source) => sum + source.candidate_review_count, 0);
  const studyCount = allModeSources.reduce((sum, source) => sum + source.study_count, 0);
  const keepCount = allModeSources.reduce((sum, source) => sum + source.keep_count, 0);
  const studyUnreadCount = allModeSources.reduce((sum, source) => sum + source.study_unread_count, 0);
  const keepUnreadCount = allModeSources.reduce((sum, source) => sum + source.keep_unread_count, 0);
  const modeItems = [
    { id: "study", label: "Study", count: studyCount, unread: studyUnreadCount },
    { id: "keep", label: "Keep", count: keepCount, unread: keepUnreadCount },
  ] as const;
  const statusItems = [
    { id: "all", label: "All", count: allCount, unread: allUnreadCount, review: allReviewCount },
    { id: "saved", label: "Saved", count: savedCount, unread: savedUnreadCount, review: savedReviewCount },
    { id: "candidate", label: "Candidates", count: candidateCount, unread: candidateUnreadCount, review: candidateReviewCount },
  ] as const;
  const youtubeToken = libraryChannelSource("youtube");
  const newsletterToken = libraryChannelSource("email");
  const selectedChannel = librarySourceChannel(selectedSource);
  const youtubeSources = sortYoutubeSources(sources.filter((source) => source.channel === "youtube"));
  const newsletterSources = sources.filter((source) => source.channel === "email");
  const regularSources = sources.filter((source) => source.channel !== "youtube" && source.channel !== "email");
  const youtubeExpanded = selectedSource === youtubeToken || youtubeSources.some((source) => source.id === selectedSource);
  const newsletterExpanded = selectedSource === newsletterToken || selectedChannel === "email";
  const newsletterFacets = mergeFacets(newsletterSources);

  const sourceButtonClass = (active: boolean) => `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${active ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`;
  const facetButtonClass = (active: boolean) => `flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${active ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"}`;

  const renderSourceFacets = (sourceId: string | null, facets: LibrarySourceFacetSummary[], label = "All tags") => (
    <div className="ml-3 mt-1 space-y-1 border-l border-[var(--border-default)] pl-2">
      <button
        onClick={() => onTagSelect?.(sourceId, null)}
        className={facetButtonClass(selectedTag === null)}
      >
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {facets.map((facet) => (
        <button
          key={facet.id}
          onClick={() => onTagSelect?.(sourceId, facet.value)}
          title={`${facet.kind}: ${facet.label}`}
          className={facetButtonClass(selectedTag?.toLowerCase() === facet.value.toLowerCase())}
        >
          <span className="min-w-0 truncate">{facet.label}</span>
          <CountBadge count={facet.count} unread={facet.unread_count} review={facet.review_count} />
        </button>
      ))}
    </div>
  );

  const renderSourceRow = (source: LibrarySourceSummary) => (
    <div key={source.id}>
      <button
        onClick={() => onSelect(source.id)}
        className={sourceButtonClass(selectedSource === source.id)}
      >
        <span className="min-w-0 truncate">{source.name}</span>
        <CountBadge count={sourceTotal(source)} unread={source.unread_count} review={source.review_count} />
      </button>
      {selectedSource === source.id && source.facets.length > 0 && onTagSelect && renderSourceFacets(source.id, source.facets)}
    </div>
  );

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
                <span className="min-w-0 truncate">{status.label}</span>
                <CountBadge count={status.count} unread={status.unread} review={status.review} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Sources</div>
      <button
        onClick={() => onSelect(null)}
        className={`mb-2 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${selectedSource === null ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
      >
        <span className="min-w-0 truncate">All sources</span>
        <CountBadge count={totalCount} unread={totalUnreadCount} review={totalReviewCount} />
      </button>
      <div className="space-y-1">
        {regularSources.map(renderSourceRow)}
        {youtubeSources.length > 0 && (
          <div>
            <button
              onClick={() => onSelect(youtubeToken)}
              className={sourceButtonClass(selectedSource === youtubeToken)}
            >
              <span className="min-w-0 truncate">YouTube</span>
              <CountBadge count={sumSourceTotals(youtubeSources)} unread={sumSourceField(youtubeSources, "unread_count")} review={sumSourceField(youtubeSources, "review_count")} />
            </button>
            {youtubeExpanded && (
              <div className="ml-3 mt-1 space-y-1 border-l border-[var(--border-default)] pl-2">
                {youtubeSources.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => onSelect(source.id)}
                    className={facetButtonClass(selectedSource === source.id)}
                  >
                    <span className="min-w-0 truncate">{source.name.replace(/^YouTube\s+/, "")}</span>
                    <CountBadge count={sourceTotal(source)} unread={source.unread_count} review={source.review_count} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {newsletterSources.length > 0 && (
          <div>
            <button
              onClick={() => onSelect(newsletterToken)}
              className={sourceButtonClass(selectedSource === newsletterToken)}
            >
              <span className="min-w-0 truncate">Newsletters</span>
              <CountBadge count={sumSourceTotals(newsletterSources)} unread={sumSourceField(newsletterSources, "unread_count")} review={sumSourceField(newsletterSources, "review_count")} />
            </button>
            {newsletterExpanded && newsletterFacets.length > 0 && onTagSelect && renderSourceFacets(newsletterToken, newsletterFacets, "All newsletters")}
          </div>
        )}
      </div>
      {onModeSelect && (
        <div className="mt-4 border-t border-[var(--border-default)] pt-3">
          <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Mode</div>
          <div className="space-y-1">
            {modeItems.map((mode) => (
              <button
                key={mode.id}
                onClick={() => onModeSelect(mode.id)}
                className={sourceButtonClass(modeFilter === mode.id)}
              >
                <span className="min-w-0 truncate">{mode.label}</span>
                <CountBadge count={mode.count} unread={mode.unread} />
              </button>
            ))}
          </div>
        </div>
      )}
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
  header,
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
  header?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const headerCount = header ? 1 : 0;
  const rowCount = headerCount + artifacts.length + (hasMore || isLoadingMore ? 1 : 0);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => header && index === 0 ? 164 : ARTIFACT_ROW_HEIGHT,
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
      {artifacts.length > 0 || header ? (
        <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {virtualItems.map((virtualRow) => {
            if (header && virtualRow.index === 0) {
              return (
                <div
                  key="library-artifact-list-header"
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full p-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {header}
                </div>
              );
            }

            const artifact = artifacts[virtualRow.index - headerCount];
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
                <div className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--content-surface)] text-[var(--text-tertiary)]">
                  {artifact.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={artifact.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : artifact.lifecycle_status === "candidate" ? (
                    <Bookmark className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  {formatVideoDuration(artifact.video_duration_seconds) && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[9px] font-medium leading-tight text-white tabular-nums">
                      {formatVideoDuration(artifact.video_duration_seconds)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <div className="flex items-start gap-2">
                    {artifact.is_unread && (
                      <span aria-label="Unread" title="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                    <div className="line-clamp-2 min-w-0 text-sm font-medium leading-5 text-[var(--text-primary)]">{artifact.title}</div>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-tertiary)]">
                    <span className="truncate">{artifact.source_name || artifact.channel}</span>
                    <span>{artifact.created_at?.slice(0, 10)}</span>
                    <span className={`rounded-full px-1.5 py-0.5 ${artifact.lifecycle_status === "candidate" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
                      {artifact.lifecycle_status === "candidate" ? "Candidate" : "Saved"}
                    </span>
                  </div>
                  {artifactDisplayTags(artifact).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {artifactDisplayTags(artifact).slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] leading-none text-[var(--text-tertiary)]">{tag}</span>
                      ))}
                    </div>
                  )}
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
            selectedTag={null}
            statusFilter={statusFilter}
            modeFilter="study"
            searchQuery={searchQuery}
            onSelect={selectSource}
            className={`${mobilePane === "sources" ? "block" : "hidden"} relative min-h-0 w-full flex-1 lg:block lg:w-[var(--library-source-width)] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--border-default)]`}
            style={{ "--library-source-width": `${sourceWidth}px` } as CSSProperties}
          />
          <div
            data-testid="library-source-resizer"
            className="hidden w-1 cursor-col-resize bg-transparent lg:block"
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
            className="hidden w-1 cursor-col-resize bg-transparent lg:block"
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
