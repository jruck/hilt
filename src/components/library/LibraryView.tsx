"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileText, List, Loader2, PanelLeft, RefreshCw, X } from "lucide-react";
import { useSWRConfig } from "swr";
import { useScope } from "@/contexts/ScopeContext";
import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import { buildLibraryUrl, libraryItemIdFromScope, libraryItemScope, parseLibraryControls, type LibraryDensity, type LibraryRanking, type LibraryStatusFilter, type LibraryUrlControls } from "@/lib/library/url";
import { ingestLibrarySources, markLibraryArtifactsRead, restoreCandidate, skipCandidate, useInfiniteLibrary, useRecommendations } from "@/hooks/useLibrary";
import { MobileChromeContent, MobileChromeTopBar, useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import { SecondarySegmentedButton, SecondarySegmentedControl, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { ArtifactList, SourceNav } from "./BrowseView";
import { FeedCard } from "./FeedCard";
import { LibraryArtifactDetailPane } from "./LibraryArtifactDetailPane";
import { LibraryHealthPanel } from "./LibraryHealthPanel";

const SOURCE_WIDTH_KEY = "hilt-library-source-width";
const CONTENT_WIDTH_KEY = "hilt-library-content-width";
const DEFAULT_SOURCE_WIDTH = 220;
const MIN_SOURCE_WIDTH = 180;
const MAX_SOURCE_WIDTH = 320;
const DEFAULT_CONTENT_WIDTH = 380;
const MIN_CONTENT_WIDTH = 300;
const MAX_CONTENT_WIDTH = 560;

interface LibraryToast {
  id: string;
  title: string;
  message: string;
  undo?: () => void | Promise<void>;
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

function initialLibraryControls(): LibraryUrlControls {
  if (typeof window === "undefined") return { density: "feed", ranking: "recent", status: "all", source: null };
  return parseLibraryControls(window.location.search);
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
  const { scopePath, navigateTo } = useScope();
  const [density, setDensityState] = useState<LibraryDensity>(() => initialLibraryControls().density);
  const [ranking, setRankingState] = useState<LibraryRanking>(() => initialLibraryControls().ranking);
  const [statusFilter, setStatusFilterState] = useState<LibraryStatusFilter>(() => initialLibraryControls().status);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedSource, setSelectedSourceState] = useState<string | null>(() => initialLibraryControls().source);
  const [selectedId, setSelectedId] = useState<string | null>(() => libraryItemIdFromScope(scopePath));
  const [mobileDetailOpen, setMobileDetailOpen] = useState(() => Boolean(libraryItemIdFromScope(scopePath)));
  const [sourceWidth, setSourceWidth] = useState(() => storedWidth(SOURCE_WIDTH_KEY, DEFAULT_SOURCE_WIDTH, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
  const [contentWidth, setContentWidth] = useState(() => storedWidth(CONTENT_WIDTH_KEY, DEFAULT_CONTENT_WIDTH, MIN_CONTENT_WIDTH, MAX_CONTENT_WIDTH));
  const [resizing, setResizing] = useState<"source" | "content" | null>(null);
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(() => new Set());
  const [localHiddenIds, setLocalHiddenIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<LibraryToast | null>(null);
  const [isCheckingSources, setIsCheckingSources] = useState(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const seenFeedIdsRef = useRef<Set<string>>(new Set());
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const readFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryControls = useMemo<LibraryUrlControls>(() => ({
    density,
    ranking,
    status: statusFilter,
    source: selectedSource,
  }), [density, ranking, selectedSource, statusFilter]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const recent = useInfiniteLibrary({
    source: selectedSource,
    status: statusFilter === "all" ? null : statusFilter,
    unread: ranking === "new",
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

  const localRecentUnreadReads = recent.artifacts.filter((artifact) => artifact.is_unread && localReadIds.has(artifact.id)).length;
  const rawItems: LibraryArtifact[] = ranking === "for-you"
    ? filteredRecommendations
    : ranking === "new"
      ? recent.artifacts.filter((artifact) => artifact.is_unread && !localReadIds.has(artifact.id))
      : recent.artifacts;
  const visibleRawItems = useMemo(() => rawItems.filter((artifact) => !localHiddenIds.has(artifact.id)), [localHiddenIds, rawItems]);
  const items = useMemo(() => applyLocalReadState(visibleRawItems, localReadIds), [visibleRawItems, localReadIds]);
  const localHiddenCount = rawItems.length - visibleRawItems.length;
  const total = ranking === "for-you"
    ? Math.max(0, filteredRecommendations.length - localHiddenCount)
    : ranking === "new"
      ? Math.max(0, recent.total - localRecentUnreadReads - localHiddenCount)
      : Math.max(0, recent.total - localHiddenCount);
  const unreadTotal = Math.max(0, ranking === "for-you"
    ? filteredRecommendations.filter((artifact) => artifact.is_unread && !localReadIds.has(artifact.id)).length
    : recent.unreadTotal - localRecentUnreadReads);
  const loading = ranking === "for-you" ? recommendations.isLoading : recent.isLoading;
  const hasMore = ranking !== "for-you" && recent.hasMore;
  const isLoadingMore = ranking !== "for-you" && recent.isLoadingMore;
  const selectedVisible = selectedId ? items.some((artifact) => artifact.id === selectedId) : false;
  const selectedArtifact = selectedId ? items.find((artifact) => artifact.id === selectedId) || null : null;
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
      /^\/api\/library\/[^/]+(?:\?.*)?$/.test(key)
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

  const replaceLibraryHistory = useCallback((scope: string, controls: LibraryUrlControls) => {
    if (typeof window === "undefined") return;
    window.history.replaceState({ scope }, "", buildLibraryUrl(scope, controls));
  }, []);

  const pushLibraryHistory = useCallback((scope: string, controls: LibraryUrlControls) => {
    if (typeof window === "undefined") return;
    window.history.pushState({ scope }, "", buildLibraryUrl(scope, controls));
  }, []);

  const navigateLibrary = useCallback((scope: string, controls: LibraryUrlControls) => {
    navigateTo("library", scope);
    replaceLibraryHistory(scope, controls);
  }, [navigateTo, replaceLibraryHistory]);

  const pushControlChange = useCallback((controls: LibraryUrlControls) => {
    pushLibraryHistory(scopePath, controls);
  }, [pushLibraryHistory, scopePath]);

  useEffect(() => {
    const handlePopState = () => {
      const controls = parseLibraryControls(window.location.search);
      setDensityState(controls.density);
      setRankingState(controls.ranking);
      setStatusFilterState(controls.status);
      setSelectedSourceState(controls.source);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const itemId = libraryItemIdFromScope(scopePath);
    if (itemId) {
      setSelectedId(itemId);
      setMobileDetailOpen(true);
      return;
    }
    if (density === "feed") {
      setSelectedId(null);
      setMobileDetailOpen(false);
    }
  }, [density, scopePath]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedId || loading) return;
    if (libraryItemIdFromScope(scopePath) === selectedId) return;
    if (!selectedVisible) {
      if (ranking === "new" && localReadIds.has(selectedId)) return;
      if (density === "list" && items[0]) {
        const nextId = items[0].id;
        setSelectedId(nextId);
        replaceLibraryHistory(libraryItemScope(nextId), libraryControls);
      } else {
        setSelectedId(null);
        setMobileDetailOpen(false);
        if (libraryItemIdFromScope(scopePath)) replaceLibraryHistory("", libraryControls);
      }
    }
  }, [density, items, libraryControls, loading, localReadIds, ranking, replaceLibraryHistory, scopePath, selectedId, selectedVisible]);

  useEffect(() => {
    if (density === "list" && !selectedId && items[0]) {
      const nextId = items[0].id;
      setSelectedId(nextId);
      setMobileDetailOpen(true);
      replaceLibraryHistory(libraryItemScope(nextId), libraryControls);
    }
  }, [density, items, libraryControls, replaceLibraryHistory, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && density === "feed") {
        setSelectedId(null);
        setMobileDetailOpen(false);
        navigateLibrary("", libraryControls);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [density, libraryControls, navigateLibrary, selectedId]);

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

  const checkSourcesNow = useCallback(async () => {
    if (isCheckingSources) return;
    setIsCheckingSources(true);
    const checkedSourceIds = selectedSource && selectedSource !== "manual" ? [selectedSource] : undefined;
    try {
      const report = await ingestLibrarySources({
        sourceIds: checkedSourceIds,
        cadence: checkedSourceIds ? undefined : "hourly",
        limit: 10,
      });
      const added = report.saved + report.candidates + report.promoted;
      const issueCount = report.errors.length + report.blocked.length;
      const sourceLabel = checkedSourceIds ? selectedSource : "hourly sources";
      setToast({
        id: `source-check:${Date.now()}`,
        title: issueCount
          ? report.errors[0] || report.blocked[0]?.reason || "Source check needs attention"
          : `${report.checked} ${report.checked === 1 ? "source" : "sources"} checked`,
        message: issueCount
          ? "Source check needs attention"
          : added
            ? `Added ${added} ${added === 1 ? "item" : "items"} from ${sourceLabel}`
            : `No new items from ${sourceLabel}`,
      });
      refreshReadAwareData();
      void mutateGlobal((key) => typeof key === "string" && (
        key === "/api/library/health" ||
        key === "/api/library/unread" ||
        key.startsWith("/api/library/health?") ||
        key.startsWith("/api/library/unread?")
      ));
    } catch (error) {
      setToast({
        id: `source-check-error:${Date.now()}`,
        title: error instanceof Error ? error.message : "Source check failed",
        message: "Source check failed",
      });
    } finally {
      setIsCheckingSources(false);
    }
  }, [isCheckingSources, mutateGlobal, refreshReadAwareData, selectedSource]);

  const dismissCandidate = useCallback(async (artifact: LibraryArtifact | RecommendedArtifact) => {
    setLocalHiddenIds((previous) => {
      const next = new Set(previous);
      next.add(artifact.id);
      return next;
    });
    if (selectedId === artifact.id) {
      setSelectedId(null);
      setMobileDetailOpen(false);
      navigateLibrary("", libraryControls);
    }
    try {
      await skipCandidate(artifact.id);
    } catch (error) {
      setLocalHiddenIds((previous) => {
        const next = new Set(previous);
        next.delete(artifact.id);
        return next;
      });
      console.warn("[library] failed to dismiss candidate", error);
      return;
    }
    setToast({
      id: `${artifact.id}:${Date.now()}`,
      title: artifact.title,
      message: "Candidate dismissed",
      undo: async () => {
        setLocalHiddenIds((previous) => {
          const next = new Set(previous);
          next.delete(artifact.id);
          return next;
        });
        setToast(null);
        try {
          await restoreCandidate(artifact.id);
          refreshReadAwareData();
        } catch (error) {
          setLocalHiddenIds((previous) => {
            const next = new Set(previous);
            next.add(artifact.id);
            return next;
          });
          console.warn("[library] failed to restore dismissed candidate", error);
        }
      },
    });
    refreshReadAwareData();
  }, [libraryControls, navigateLibrary, refreshReadAwareData, selectedId]);

  const openArtifact = useCallback((artifact: LibraryArtifact | RecommendedArtifact) => {
    if (artifact.is_unread) markRead([artifact.id]);
    if (density === "feed" && selectedId === artifact.id) {
      setSelectedId(null);
      setMobileDetailOpen(false);
      navigateLibrary("", libraryControls);
      return;
    }
    setSelectedId(artifact.id);
    setMobileDetailOpen(true);
    navigateLibrary(libraryItemScope(artifact.id), libraryControls);
  }, [density, libraryControls, markRead, navigateLibrary, selectedId]);

  const selectDensity = useCallback((nextDensity: LibraryDensity) => {
    const nextControls = { ...libraryControls, density: nextDensity };
    setDensityState(nextDensity);
    pushControlChange(nextControls);
  }, [libraryControls, pushControlChange]);

  const selectRanking = useCallback((nextRanking: LibraryRanking) => {
    const nextControls = { ...libraryControls, ranking: nextRanking };
    setRankingState(nextRanking);
    pushControlChange(nextControls);
  }, [libraryControls, pushControlChange]);

  const selectStatusFilter = useCallback((nextStatus: LibraryStatusFilter) => {
    const nextControls = { ...libraryControls, status: nextStatus };
    setStatusFilterState(nextStatus);
    pushControlChange(nextControls);
  }, [libraryControls, pushControlChange]);

  const selectSource = (source: string | null) => {
    const nextControls = { ...libraryControls, source };
    setSelectedSourceState(source);
    pushControlChange(nextControls);
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
    if (ranking !== "for-you" && recent.hasMore && !recent.isLoadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < 900) {
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
                  onClick={() => selectDensity("feed")}
                  active={density === "feed"}
                  icon={<List className="h-4 w-4" />}
                  title="Feed view"
                >
                  Feed
                </SecondarySegmentedButton>
                <SecondarySegmentedButton
                  onClick={() => selectDensity("list")}
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
                <SecondarySegmentedButton onClick={() => selectRanking("recent")} active={ranking === "recent"}>Recent</SecondarySegmentedButton>
                <SecondarySegmentedButton onClick={() => selectRanking("for-you")} active={ranking === "for-you"}>For You</SecondarySegmentedButton>
                <SecondarySegmentedButton onClick={() => selectRanking("new")} active={ranking === "new"}>New</SecondarySegmentedButton>
              </SecondarySegmentedControl>
              <div className="hidden shrink-0 text-xs text-[var(--text-tertiary)] md:block">
                <span>{ranking === "for-you" ? `${total} picks` : ranking === "new" ? `${total} new` : `${total} items`}</span>
                {ranking !== "new" && unreadTotal > 0 && (
                  <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-500">{unreadTotal} new</span>
                )}
              </div>
              <button
                type="button"
                data-testid="library-check-sources-toolbar"
                onClick={() => { void checkSourcesNow(); }}
                disabled={isCheckingSources}
                aria-busy={isCheckingSources}
                title={selectedSource && selectedSource !== "manual" ? `Check ${selectedSource} now` : "Check hourly Library sources now"}
                aria-label={selectedSource && selectedSource !== "manual" ? `Check ${selectedSource} now` : "Check hourly Library sources now"}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:text-[var(--text-tertiary)] ${isCheckingSources ? "cursor-wait" : ""}`}
              >
                {isCheckingSources ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span>Check sources</span>
              </button>
              <LibraryHealthPanel onCheckSources={checkSourcesNow} isCheckingSources={isCheckingSources} />
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
              onStatusSelect={selectStatusFilter}
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
                        onDismissCandidate={dismissCandidate}
                        active={artifact.id === selectedId}
                      />
                    </div>
                  ))}
                  {ranking !== "for-you" && items.length > 0 && (
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
                artifactPath={selectedArtifact?.path || null}
                showBack
                controlsClassName="lg:hidden"
                backClassName="lg:hidden"
                onBack={() => {
                  setMobileDetailOpen(false);
                  if (density === "feed") {
                    setSelectedId(null);
                    navigateLibrary("", libraryControls);
                  }
                }}
                onChanged={refresh}
                onCandidateDismissed={dismissCandidate}
              />
            </div>
          )}
        </div>
      </MobileChromeContent>
      {toast && (
        <div className="pointer-events-none fixed bottom-[calc(var(--hilt-mobile-nav-clearance)+1rem)] left-1/2 z-[70] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] px-3 py-2 text-sm content-card-shadow">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--text-primary)]">{toast.message}</div>
              <div className="truncate text-xs text-[var(--text-tertiary)]">{toast.title}</div>
            </div>
            {toast.undo && (
              <button
                type="button"
                onClick={() => { void toast.undo?.(); }}
                className="min-h-8 rounded-md px-2 text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--bg-secondary)]"
              >
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => setToast(null)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss notification"
              title="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
