"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileText, List, PanelLeft } from "lucide-react";
import { useSWRConfig } from "swr";
import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import { markLibraryArtifactsRead, useInfiniteLibrary, useRecommendations } from "@/hooks/useLibrary";
import { MobileChromeContent, MobileChromeTopBar, useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import { SecondarySegmentedButton, SecondarySegmentedControl, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { ArtifactList, SourceNav } from "./BrowseView";
import { FeedCard } from "./FeedCard";
import { LibraryArtifactDetailPane } from "./LibraryArtifactDetailPane";
import { LibraryHealthPanel } from "./LibraryHealthPanel";

type LibraryDensity = "feed" | "list";
type LibraryRanking = "recent" | "for-you";
type LibraryStatusFilter = "all" | "saved" | "candidate";

const SOURCE_WIDTH_KEY = "hilt-library-source-width";
const CONTENT_WIDTH_KEY = "hilt-library-content-width";
const DEFAULT_SOURCE_WIDTH = 220;
const MIN_SOURCE_WIDTH = 180;
const MAX_SOURCE_WIDTH = 320;
const DEFAULT_CONTENT_WIDTH = 380;
const MIN_CONTENT_WIDTH = 300;
const MAX_CONTENT_WIDTH = 560;

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

function artifactMatchesFilter(artifact: LibraryArtifact, {
  source,
  status,
  query,
}: {
  source: string | null;
  status: LibraryStatusFilter;
  query: string;
}) {
  if (source && artifact.source_id !== source) return false;
  if (status !== "all" && artifact.lifecycle_status !== status) return false;
  if (!query) return true;
  const haystack = [
    artifact.title,
    artifact.summary || "",
    artifact.source_name || "",
    artifact.channel || "",
    artifact.tags.join(" "),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function applyLocalReadState<T extends LibraryArtifact | RecommendedArtifact>(items: T[], localReadIds: Set<string>): T[] {
  if (!localReadIds.size) return items;
  return items.map((artifact) => localReadIds.has(artifact.id)
    ? { ...artifact, is_unread: false, read_at: artifact.read_at || new Date().toISOString() }
    : artifact);
}

export function LibraryView({ searchQuery }: { searchQuery: string }) {
  const { mutate: mutateGlobal } = useSWRConfig();
  const [density, setDensity] = useState<LibraryDensity>("feed");
  const [ranking, setRanking] = useState<LibraryRanking>("recent");
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>("all");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sourceWidth, setSourceWidth] = useState(() => storedWidth(SOURCE_WIDTH_KEY, DEFAULT_SOURCE_WIDTH, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
  const [contentWidth, setContentWidth] = useState(() => storedWidth(CONTENT_WIDTH_KEY, DEFAULT_CONTENT_WIDTH, MIN_CONTENT_WIDTH, MAX_CONTENT_WIDTH));
  const [resizing, setResizing] = useState<"source" | "content" | null>(null);
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(() => new Set());
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const seenFeedIdsRef = useRef<Set<string>>(new Set());
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const readFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const recent = useInfiniteLibrary({
    source: selectedSource,
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
  }, density === "list" ? 80 : 40);
  const recommendations = useRecommendations(20);
  const filteredRecommendations = useMemo(
    () => recommendations.items.filter((artifact) => artifactMatchesFilter(artifact, {
      source: selectedSource,
      status: statusFilter,
      query: normalizedQuery,
    })),
    [normalizedQuery, recommendations.items, selectedSource, statusFilter],
  );

  const rawItems: LibraryArtifact[] = ranking === "recent" ? recent.artifacts : filteredRecommendations;
  const items = useMemo(() => applyLocalReadState(rawItems, localReadIds), [rawItems, localReadIds]);
  const total = ranking === "recent" ? recent.total : filteredRecommendations.length;
  const localUnreadReads = rawItems.filter((artifact) => artifact.is_unread && localReadIds.has(artifact.id)).length;
  const unreadTotal = Math.max(0, ranking === "recent"
    ? recent.unreadTotal - localUnreadReads
    : filteredRecommendations.filter((artifact) => artifact.is_unread && !localReadIds.has(artifact.id)).length);
  const loading = ranking === "recent" ? recent.isLoading : recommendations.isLoading;
  const hasMore = ranking === "recent" && recent.hasMore;
  const isLoadingMore = ranking === "recent" && recent.isLoadingMore;
  const selectedVisible = selectedId ? items.some((artifact) => artifact.id === selectedId) : false;
  const desktopReaderVisible = density === "list" || selectedId !== null;
  const mobileReaderVisible = selectedId !== null && mobileDetailOpen;
  useMobileChromeVisibilityLock(sourcesOpen);

  const refreshReadAwareData = useCallback(() => {
    void recent.mutate();
    void recommendations.mutate();
    void mutateGlobal((key) => typeof key === "string" && (
      key.startsWith("/api/library?") ||
      key.startsWith("/api/library/sources") ||
      key.startsWith("/api/library/recommendations") ||
      /^\/api\/library\/[^/]+$/.test(key)
    ));
  }, [mutateGlobal, recent, recommendations]);

  const flushPendingReadIds = useCallback(() => {
    const ids = Array.from(pendingReadIdsRef.current);
    pendingReadIdsRef.current.clear();
    readFlushTimerRef.current = null;
    if (!ids.length) return;
    void markLibraryArtifactsRead(ids)
      .then(refreshReadAwareData)
      .catch((error) => {
        console.warn("[library] failed to mark artifacts read", error);
      });
  }, [refreshReadAwareData]);

  const markRead = useCallback((ids: string[]) => {
    const nextIds = ids.filter((id) => id && !localReadIds.has(id));
    if (!nextIds.length) return;
    setLocalReadIds((previous) => {
      const next = new Set(previous);
      for (const id of nextIds) next.add(id);
      return next;
    });
    for (const id of nextIds) pendingReadIdsRef.current.add(id);
    if (readFlushTimerRef.current) clearTimeout(readFlushTimerRef.current);
    readFlushTimerRef.current = setTimeout(flushPendingReadIds, 250);
  }, [flushPendingReadIds, localReadIds]);

  useEffect(() => () => {
    if (readFlushTimerRef.current) clearTimeout(readFlushTimerRef.current);
    if (pendingReadIdsRef.current.size) flushPendingReadIds();
  }, [flushPendingReadIds]);

  useEffect(() => {
    if (!selectedId || loading) return;
    if (!selectedVisible) {
      if (density === "list" && items[0]) {
        setSelectedId(items[0].id);
      } else {
        setSelectedId(null);
        setMobileDetailOpen(false);
      }
    }
  }, [density, items, loading, selectedId, selectedVisible]);

  useEffect(() => {
    if (density === "list" && !selectedId && items[0]) {
      setSelectedId(items[0].id);
      setMobileDetailOpen(true);
    }
  }, [density, items, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && density === "feed") setSelectedId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [density, selectedId]);

  useEffect(() => {
    localStorage.setItem(SOURCE_WIDTH_KEY, String(sourceWidth));
  }, [sourceWidth]);

  useEffect(() => {
    localStorage.setItem(CONTENT_WIDTH_KEY, String(contentWidth));
  }, [contentWidth]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = event.clientX - resizeRef.current.startX;
      if (resizing === "source") {
        setSourceWidth(clamp(resizeRef.current.startWidth + delta, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
      } else {
        setContentWidth(clamp(resizeRef.current.startWidth + delta, MIN_CONTENT_WIDTH, MAX_CONTENT_WIDTH));
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

  const refresh = useCallback(() => {
    recent.mutate();
    recommendations.mutate();
  }, [recent, recommendations]);

  const openArtifact = useCallback((artifact: LibraryArtifact | RecommendedArtifact) => {
    if (artifact.is_unread) markRead([artifact.id]);
    if (density === "feed" && selectedId === artifact.id) {
      setSelectedId(null);
      setMobileDetailOpen(false);
      return;
    }
    setSelectedId(artifact.id);
    setMobileDetailOpen(true);
  }, [density, markRead, selectedId]);

  const selectSource = (source: string | null) => {
    setSelectedSource(source);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSourcesOpen(false);
  };

  const registerFeedItem = useCallback((id: string) => (node: HTMLDivElement | null) => {
    if (node) feedItemRefs.current.set(id, node);
    else feedItemRefs.current.delete(id);
  }, []);

  const updateFeedReadProgress = useCallback(() => {
    if (density !== "feed") return;
    const node = feedScrollRef.current;
    if (!node) return;
    const containerRect = node.getBoundingClientRect();
    const scrolledPastUnreadIds: string[] = [];
    for (const artifact of items) {
      if (!artifact.is_unread) continue;
      const element = feedItemRefs.current.get(artifact.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const isVisible = rect.bottom > containerRect.top + 24 && rect.top < containerRect.bottom - 24;
      if (isVisible) seenFeedIdsRef.current.add(artifact.id);
      if (seenFeedIdsRef.current.has(artifact.id) && rect.bottom < containerRect.top + 2) {
        scrolledPastUnreadIds.push(artifact.id);
      }
    }
    if (scrolledPastUnreadIds.length) markRead(scrolledPastUnreadIds);
  }, [density, items, markRead]);

  const handleFeedScroll = useCallback(() => {
    const node = feedScrollRef.current;
    if (!node) return;
    if (ranking === "recent" && recent.hasMore && !recent.isLoadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < 900) {
      recent.loadMore();
    }
    updateFeedReadProgress();
  }, [ranking, recent, updateFeedReadProgress]);

  useEffect(() => {
    if (density !== "feed") return;
    const frame = requestAnimationFrame(updateFeedReadProgress);
    return () => cancelAnimationFrame(frame);
  }, [density, items, updateFeedReadProgress]);

  const startResize = useCallback((kind: "source" | "content", width: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(kind);
    resizeRef.current = { startX: event.clientX, startWidth: width };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <MobileChromeTopBar>
        <SecondaryToolbar
          left={
            <div className="flex items-center gap-2">
              <SecondarySegmentedControl>
                <SecondarySegmentedButton
                  onClick={() => setSourcesOpen((value) => !value)}
                  active={sourcesOpen}
                  icon={<PanelLeft className="h-4 w-4" />}
                  title="Sources"
                >
                  Sources
                </SecondarySegmentedButton>
              </SecondarySegmentedControl>
              <SecondarySegmentedControl>
                <SecondarySegmentedButton
                  onClick={() => setDensity("feed")}
                  active={density === "feed"}
                  icon={<List className="h-4 w-4" />}
                  title="Feed view"
                >
                  Feed
                </SecondarySegmentedButton>
                <SecondarySegmentedButton
                  onClick={() => setDensity("list")}
                  active={density === "list"}
                  icon={<FileText className="h-4 w-4" />}
                  title="List view"
                >
                  List
                </SecondarySegmentedButton>
              </SecondarySegmentedControl>
            </div>
          }
          right={
            <>
              {searchQuery && <div className="max-w-[180px] truncate text-xs text-[var(--text-tertiary)] sm:max-w-[260px]">Search: {searchQuery}</div>}
              <SecondarySegmentedControl>
                <SecondarySegmentedButton onClick={() => setRanking("recent")} active={ranking === "recent"}>Recent</SecondarySegmentedButton>
                <SecondarySegmentedButton onClick={() => setRanking("for-you")} active={ranking === "for-you"}>For You</SecondarySegmentedButton>
              </SecondarySegmentedControl>
              <div className="hidden shrink-0 text-xs text-[var(--text-tertiary)] md:block">
                <span>{ranking === "for-you" ? `${total} picks` : `${total} items`}</span>
                {unreadTotal > 0 && (
                  <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-500">{unreadTotal} new</span>
                )}
              </div>
              <LibraryHealthPanel />
            </>
          }
        />
      </MobileChromeTopBar>

      <MobileChromeContent
        offset="calc(var(--hilt-mobile-top-chrome-height) + 13px)"
        inactiveClassName="pt-[13px]"
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${resizing ? "select-none" : ""}`}
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-[var(--border-default)]">
          {sourcesOpen && (
            <button
              type="button"
              aria-label="Close sources"
              className="absolute bottom-0 right-0 top-0 z-10 bg-black/5 left-[344px] lg:hidden"
              onClick={() => setSourcesOpen(false)}
            />
          )}
          {sourcesOpen && (
            <SourceNav
              selectedSource={selectedSource}
              statusFilter={statusFilter}
              searchQuery={searchQuery}
              onSelect={selectSource}
              onStatusSelect={setStatusFilter}
              className="absolute bottom-3 left-3 top-3 z-20 w-[min(82vw,320px)] rounded-lg border border-[var(--border-default)] content-card-shadow lg:static lg:bottom-auto lg:left-auto lg:top-auto lg:z-auto lg:block lg:w-[var(--library-source-width)] lg:flex-none lg:shrink-0 lg:rounded-none lg:border-0 lg:border-r lg:border-[var(--border-default)] lg:shadow-none"
              style={{ "--library-source-width": `${sourceWidth}px` } as CSSProperties}
            />
          )}
          {sourcesOpen && (
            <div
              data-testid="library-source-resizer"
              className={`hidden w-1 cursor-col-resize transition-colors hover:bg-[var(--accent-primary)] lg:block ${resizing === "source" ? "bg-[var(--accent-primary)]" : "bg-transparent"}`}
              onMouseDown={startResize("source", sourceWidth)}
            />
          )}

          <div
            className={`${mobileReaderVisible ? "hidden" : "flex"} ${desktopReaderVisible ? "lg:flex lg:w-[var(--library-content-width)] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--border-default)]" : "lg:flex lg:flex-1"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]`}
            style={{ "--library-content-width": `${contentWidth}px` } as CSSProperties}
          >
            {density === "feed" ? (
              <div ref={feedScrollRef} onScroll={handleFeedScroll} data-mobile-scroll-chrome="top-bottom" data-testid="library-feed-list" className="min-h-0 flex-1 overflow-y-auto">
                <div className={`${desktopReaderVisible ? "max-w-none gap-3 px-3 py-3" : "mx-auto max-w-3xl gap-5 px-4 py-5"} flex w-full flex-col`}>
                  {loading && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-5 text-sm text-[var(--text-secondary)]">Loading library...</div>}
                  {!loading && items.length === 0 && (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-5 text-sm text-[var(--text-secondary)]">
                      No library items match these controls.
                    </div>
                  )}
                  {items.map((artifact) => (
                    <div key={artifact.id} ref={registerFeedItem(artifact.id)}>
                      <FeedCard
                        artifact={artifact}
                        why={"why" in artifact && typeof artifact.why === "string" ? artifact.why : undefined}
                        priority={"priority" in artifact && (artifact.priority === "must_read" || artifact.priority === "recommended" || artifact.priority === "interesting") ? artifact.priority : undefined}
                        promoteReason={ranking === "for-you" ? "for_you_selected" : "manual_save"}
                        onChanged={refresh}
                        onOpen={openArtifact}
                        active={artifact.id === selectedId}
                      />
                    </div>
                  ))}
                  {ranking === "recent" && items.length > 0 && (
                    <div className="py-2 text-center text-xs text-[var(--text-tertiary)]">
                      {isLoadingMore ? "Loading more..." : hasMore ? `${items.length} of ${recent.total} loaded` : `${items.length} of ${recent.total} loaded`}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <ArtifactList
                artifacts={items}
                total={total}
                selected={selectedId}
                onSelect={openArtifact}
                isLoading={loading}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={recent.loadMore}
                className="min-h-0 w-full flex-1"
              />
            )}
          </div>
          {desktopReaderVisible && (
            <div
              data-testid="library-content-resizer"
              className={`hidden w-1 cursor-col-resize transition-colors hover:bg-[var(--accent-primary)] lg:block ${resizing === "content" ? "bg-[var(--accent-primary)]" : "bg-transparent"}`}
              onMouseDown={startResize("content", contentWidth)}
            />
          )}

          {desktopReaderVisible && (
            <div data-testid="library-feed-detail" className={`${mobileReaderVisible ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 lg:flex`}>
              <LibraryArtifactDetailPane
                key={selectedId ?? "empty"}
                id={selectedId}
                showBack
                controlsClassName="lg:hidden"
                backClassName="lg:hidden"
                onBack={() => {
                  setMobileDetailOpen(false);
                  if (density === "feed") setSelectedId(null);
                }}
                onChanged={refresh}
              />
            </div>
          )}
        </div>
      </MobileChromeContent>
    </div>
  );
}
