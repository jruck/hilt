"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CirclePlus, Clock3, FileText, List, Loader2, PanelLeft, RefreshCw, Sparkles, X } from "lucide-react";
import { useSWRConfig } from "swr";
import { useScope } from "@/contexts/ScopeContext";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import type { LibraryArtifact, RecommendedArtifact } from "@/lib/library/types";
import { buildLibraryUrl, libraryConcreteSource, libraryItemIdFromScope, libraryItemScope, librarySourceChannel, parseLibraryControls, recommendationEpisodeIdFromSearch, type LibraryDensity, type LibraryModeControl, type LibraryRanking, type LibraryStatusFilter, type LibraryUrlControls } from "@/lib/library/url";
import { archiveArtifact, dismissLibraryRecommendation, intakeLibrarySources, markLibraryArtifactsRead, markLibraryArtifactsUnread, restoreCandidate, restoreLibraryRecommendation, setReviewStatus, skipCandidate, useInfiniteLibrary, useInfiniteRecommendations, useReviewQueue } from "@/hooks/useLibrary";
import type { ReviewQueueStatus } from "@/lib/library/review-queue";
import { MobileChromeContent, MobileChromeTopBar, useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import { SECONDARY_CHROME_BODY_GUTTER_CLASS, SECONDARY_CHROME_MOBILE_OFFSET, SecondaryIconButton, SecondarySegmentedButton, SecondarySegmentedControl, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import { ArtifactList, SourceNav } from "./BrowseView";
import { FeedCard } from "./FeedCard";
import { GenerationNoteCard } from "./GenerationNoteCard";
import { LIBRARY_META_OPEN_KEY, LibraryArtifactDetailPane } from "./LibraryArtifactDetailPane";
import { LibraryHealthPanel } from "./LibraryHealthPanel";
import { VirtualFeedRow } from "./VirtualFeedRow";

const SOURCE_WIDTH_KEY = "hilt-library-source-width";
const CONTENT_WIDTH_KEY = "hilt-library-content-width";
const SOURCES_OPEN_KEY = "hilt-library-sources-open";
const DEFAULT_SOURCE_WIDTH = 220;
const MIN_SOURCE_WIDTH = 180;
const MAX_SOURCE_WIDTH = 320;
const DEFAULT_CONTENT_WIDTH = 380;
const MIN_CONTENT_WIDTH = 300;
const MAX_CONTENT_WIDTH = 1000;
const FEED_CARD_ESTIMATED_HEIGHT = 400;
const FEED_CARD_OVERSCAN = 6;

interface LibraryToast {
  id: string;
  title: string;
  message: string;
  undo?: () => void | Promise<void>;
}

interface FeedScrollAnchor {
  id: string;
  offsetTop: number;
  waitForArtifactId?: string;
  settleFrames: number;
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

function storedBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const stored = localStorage.getItem(key);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return fallback;
}

function initialLibraryControls(): LibraryUrlControls {
  if (typeof window === "undefined") return { density: "feed", ranking: "recent", status: "all", mode: "study", source: null, tag: null };
  const controls = parseLibraryControls(window.location.search);
  return controls.ranking === "for-you" ? { ...controls, density: "feed" } : controls;
}

function applyLocalReadState<T extends LibraryArtifact | RecommendedArtifact>(items: T[], localReadIds: Set<string>): T[] {
  if (!localReadIds.size) return items;
  return items.map((artifact) => localReadIds.has(artifact.id)
    ? { ...artifact, is_unread: false, read_at: artifact.read_at || new Date().toISOString() }
    : artifact);
}

function isActivelyProcessing(artifact: LibraryArtifact | RecommendedArtifact): boolean {
  return artifact.processing?.state === "queued" || artifact.processing?.state === "active";
}

function isReadableArtifact(artifact: LibraryArtifact | RecommendedArtifact): boolean {
  return !artifact.processing || artifact.processing.state === "ready";
}

function pinProcessing(items: LibraryArtifact[]): LibraryArtifact[] {
  return items.map((artifact, index) => ({ artifact, index }))
    .sort((a, b) => Number(isActivelyProcessing(b.artifact)) - Number(isActivelyProcessing(a.artifact)) || a.index - b.index)
    .map(({ artifact }) => artifact);
}

export function LibraryView({ searchQuery, activationToken = 0 }: { searchQuery: string; activationToken?: number }) {
  const { mutate: mutateGlobal } = useSWRConfig();
  const { scopePath, navigateTo } = useScope();
  const { subscribe: subscribeEvents, unsubscribe: unsubscribeEvents, on: onEvent } = useEventSocketContext();
  const [density, setDensityState] = useState<LibraryDensity>(() => initialLibraryControls().density);
  const [ranking, setRankingState] = useState<LibraryRanking>(() => initialLibraryControls().ranking);
  const [statusFilter, setStatusFilterState] = useState<LibraryStatusFilter>(() => initialLibraryControls().status);
  const [modeFilter, setModeFilterState] = useState<LibraryModeControl>(() => initialLibraryControls().mode);
  const [sourcesOpen, setSourcesOpen] = useState(() => storedBoolean(SOURCES_OPEN_KEY, false));
  const [selectedSource, setSelectedSourceState] = useState<string | null>(() => initialLibraryControls().source);
  const [selectedTag, setSelectedTagState] = useState<string | null>(() => initialLibraryControls().tag);
  const [selectedId, setSelectedId] = useState<string | null>(() => libraryItemIdFromScope(scopePath));
  const [selectedRecommendationEpisodeId, setSelectedRecommendationEpisodeId] = useState<string | null>(() => (
    typeof window === "undefined" ? null : recommendationEpisodeIdFromSearch(window.location.search)
  ));
  const [mobileDetailOpen, setMobileDetailOpen] = useState(() => Boolean(libraryItemIdFromScope(scopePath)));
  const [sourceWidth, setSourceWidth] = useState(() => storedWidth(SOURCE_WIDTH_KEY, DEFAULT_SOURCE_WIDTH, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
  const [contentWidth, setContentWidth] = useState(() => storedWidth(CONTENT_WIDTH_KEY, DEFAULT_CONTENT_WIDTH, MIN_CONTENT_WIDTH, MAX_CONTENT_WIDTH));
  const [resizing, setResizing] = useState<"source" | "content" | null>(null);
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(() => new Set());
  const [localHiddenIds, setLocalHiddenIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<LibraryToast | null>(null);
  const [isCheckingSources, setIsCheckingSources] = useState(false);
  const [newItemNoticeCount, setNewItemNoticeCount] = useState(0);
  const [evalFilters, setEvalFilters] = useState<{
    lifecycle?: string | null;
    connection_state?: string | null;
    digested_with?: string | null;
    pipeline_version?: string | null;
    substance_graded?: string | null;
    reweave_pending?: boolean | null;
    worth_min?: number | null;
    feedback?: string | null;
    youtube_clip_policy?: string | null;
  }>({});
  // Type is a BROWSE dimension (like Source/Status/Mode), not an admin filter — separate state so
  // admin "clear"/active-dot semantics never touch it.
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const pendingFeedScrollAnchorRef = useRef<FeedScrollAnchor | null>(null);
  const noticedArtifactIdsRef = useRef<Set<string>>(new Set());
  const noticedRecommendationEpisodesRef = useRef<Set<string>>(new Set());
  const latestRecommendationAtRef = useRef<string | null>(null);
  const recommendationDeepInsertRef = useRef(false);
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const readFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readEligibleIdsRef = useRef<Set<string>>(new Set());
  const lastActivationTokenRef = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);
  const selectedChannel = librarySourceChannel(selectedSource);
  const selectedSourceId = libraryConcreteSource(selectedSource);
  const libraryControls = useMemo<LibraryUrlControls>(() => ({
    density,
    ranking,
    status: statusFilter,
    mode: modeFilter,
    source: selectedSource,
    tag: selectedTag,
  }), [density, modeFilter, ranking, selectedSource, selectedTag, statusFilter]);

  const recent = useInfiniteLibrary({
    source: selectedSourceId,
    channel: selectedChannel,
    tag: selectedTag,
    mode: modeFilter,
    status: statusFilter === "all" ? null : statusFilter,
    unread: ranking === "new",
    q: searchQuery || null,
    content_type: typeFilter,
    ...evalFilters,
  }, density === "list" ? 80 : 40);
  const recommendations = useInfiniteRecommendations({
    source: selectedSourceId,
    channel: selectedChannel,
    tag: selectedTag,
    mode: modeFilter,
    status: statusFilter === "all" ? null : statusFilter,
    q: searchQuery || null,
    content_type: typeFilter,
  }, density === "list" ? 80 : 40);
  const recommendationItemsRef = useRef(recommendations.items);
  const recommendationMutateRef = useRef(recommendations.mutate);
  recommendationItemsRef.current = recommendations.items;
  recommendationMutateRef.current = recommendations.mutate;
  const reviewQueue = useReviewQueue();

  const localRecentUnreadReads = recent.artifacts.filter((artifact) => artifact.is_unread && localReadIds.has(artifact.id)).length;
  const localUnreadExcludedCount = recent.artifacts.filter((artifact) => (
    artifact.is_unread && (localReadIds.has(artifact.id) || localHiddenIds.has(artifact.id))
  )).length;
  const localUpdatedHiddenCount = reviewQueue.items.filter((artifact) => localHiddenIds.has(artifact.id)).length;
  const recentRankedItems = ranking === "recent" || ranking === "new" ? pinProcessing(recent.artifacts) : recent.artifacts;
  const rawItems: LibraryArtifact[] = ranking === "for-you"
    ? recommendations.items
    : ranking === "updated"
      ? reviewQueue.items
      : ranking === "new"
        ? recentRankedItems.filter((artifact) => (artifact.is_unread && !localReadIds.has(artifact.id)) || artifact.id === selectedId)
        : recentRankedItems;
  const visibleRawItems = useMemo(() => rawItems.filter((artifact) => !localHiddenIds.has(artifact.id)), [localHiddenIds, rawItems]);
  const items = useMemo(() => applyLocalReadState(visibleRawItems, localReadIds), [visibleRawItems, localReadIds]);
  const localHiddenCount = rawItems.length - visibleRawItems.length;
  const total = ranking === "for-you"
    ? Math.max(0, recommendations.total - localHiddenCount)
    : ranking === "updated"
      ? Math.max(0, reviewQueue.total - localHiddenCount)
      : ranking === "new"
        ? Math.max(0, recent.total - localRecentUnreadReads - localHiddenCount)
        : Math.max(0, recent.total - localHiddenCount);
  // Per-ranking counts shown inside each toggle (independent of which ranking is active), so the
  // toggle itself carries its label + count — consolidating the separate count/unread chips.
  const recentCount = recent.total;
  const forYouCount = recommendations.total;
  const newCount = Math.max(0, recent.unreadTotal - localUnreadExcludedCount);
  const updatedCount = Math.max(0, reviewQueue.total - localUpdatedHiddenCount);
  const processingCount = recent.artifacts.filter(isActivelyProcessing).length;
  const loading = ranking === "for-you"
    ? recommendations.isLoading
    : ranking === "updated"
      ? reviewQueue.isLoading
      : recent.isLoading;
  const usesRecentPaging = ranking === "recent" || ranking === "new";
  const usesRecommendationPaging = ranking === "for-you";
  const hasMore = usesRecentPaging ? recent.hasMore : usesRecommendationPaging ? recommendations.hasMore : false;
  const isLoadingMore = usesRecentPaging ? recent.isLoadingMore : usesRecommendationPaging ? recommendations.isLoadingMore : false;
  const adminEvalActive = Boolean(evalFilters.lifecycle || evalFilters.connection_state || evalFilters.digested_with || evalFilters.pipeline_version || evalFilters.substance_graded || evalFilters.feedback || evalFilters.youtube_clip_policy || (typeof evalFilters.worth_min === "number" && evalFilters.worth_min > 0));
  const selectedVisible = selectedId ? items.some((artifact) => artifact.id === selectedId) : false;
  const selectedArtifact = selectedId ? items.find((artifact) => artifact.id === selectedId) || null : null;
  const desktopReaderVisible = density === "list" || selectedId !== null;
  const mobileReaderVisible = selectedId !== null && mobileDetailOpen;
  useMobileChromeVisibilityLock(sourcesOpen);

  // Feed virtualization — only the visible cards (plus overscan) are mounted,
  // so a deeply-scrolled feed doesn't accumulate hundreds of FeedCards in the
  // DOM. Review notes stay outside the virtual container (sticky positioning
  // breaks inside transformed rows); the trailing "x of y loaded" row rides
  // along as the last virtual row.
  const feedFooterCount = (usesRecentPaging || usesRecommendationPaging) && items.length > 0 ? 1 : 0;
  const feedRowCount = items.length + feedFooterCount;
  const feedVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: density === "feed" ? feedRowCount : 0,
    getScrollElement: () => feedScrollRef.current,
    estimateSize: () => FEED_CARD_ESTIMATED_HEIGHT,
    overscan: FEED_CARD_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });

  const captureFirstVisibleFeedAnchor = useCallback((waitForArtifactId?: string) => {
    if (density !== "feed") return;
    if (pendingFeedScrollAnchorRef.current) return;
    const scroller = feedScrollRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const card = Array.from(scroller.querySelectorAll<HTMLElement>("[data-library-artifact-id]"))
      .find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.bottom > scrollerRect.top + 8 && rect.top < scrollerRect.bottom;
      });
    const id = card?.dataset.libraryArtifactId;
    if (!card || !id) return;
    pendingFeedScrollAnchorRef.current = {
      id,
      offsetTop: card.getBoundingClientRect().top - scrollerRect.top,
      waitForArtifactId,
      // Virtualized cards can be remeasured after thumbnails and ResizeObserver settle. Keep
      // correcting for one second so a late height update cannot jump a deep reader downward.
      settleFrames: 60,
    };
  }, [density]);

  useEffect(() => {
    subscribeEvents("library");
    const off = onEvent("library", "artifact-changed", (data) => {
      const event = data as { operation?: string; id?: string };
      if (event.operation !== "add" || !event.id || noticedArtifactIdsRef.current.has(event.id)) return;
      noticedArtifactIdsRef.current.add(event.id);
      if (ranking === "for-you") return;
      if (density !== "feed" || (ranking !== "recent" && ranking !== "new")) return;
      const scroller = feedScrollRef.current;
      if (!scroller || scroller.scrollTop < 160) return;
      captureFirstVisibleFeedAnchor(event.id);
      setNewItemNoticeCount((count) => count + 1);
    });
    const offRecommendations = onEvent("library", "recommendations-changed", (data) => {
      if (ranking !== "for-you") return;
      const scroller = feedScrollRef.current;
      void recommendationMutateRef.current();
      const event = data as { affects_feed?: boolean };
      if (event.affects_feed === false) return;
      if (!scroller || scroller.scrollTop < 160) {
        recommendationDeepInsertRef.current = false;
        return;
      }
      recommendationDeepInsertRef.current = true;
      captureFirstVisibleFeedAnchor();
    });
    return () => {
      off();
      offRecommendations();
      unsubscribeEvents("library");
    };
  }, [captureFirstVisibleFeedAnchor, density, onEvent, ranking, subscribeEvents, unsubscribeEvents]);

  useEffect(() => {
    const current = recommendations.items
      .map((item) => item.recommendation)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.episode_id));
    const previousLatestAt = latestRecommendationAtRef.current;
    const added = previousLatestAt
      ? current.filter((entry) => (
          entry.recommended_at > previousLatestAt
          && !noticedRecommendationEpisodesRef.current.has(entry.episode_id)
        )).length
      : 0;
    if (added > 0 && ranking === "for-you" && recommendationDeepInsertRef.current) {
      setNewItemNoticeCount((count) => count + added);
      recommendationDeepInsertRef.current = false;
    }
    for (const entry of current) noticedRecommendationEpisodesRef.current.add(entry.episode_id);
    const latestAt = current.reduce<string | null>((latest, entry) => (
      !latest || entry.recommended_at > latest ? entry.recommended_at : latest
    ), previousLatestAt);
    latestRecommendationAtRef.current = latestAt;
  }, [ranking, recommendations.items]);

  const refreshReadAwareData = useCallback(() => {
    void recent.mutate();
    void recommendations.mutate();
    void mutateGlobal((key) => typeof key === "string" && (
      key.startsWith("/api/library?") ||
      key.startsWith("/api/library/sources") ||
      key.startsWith("/api/library/recommendations") ||
      key.startsWith("/api/library/review") ||
      key.startsWith("/api/library/workbench") ||
      /^\/api\/library\/[^/]+(?:\?.*)?$/.test(key)
    ));
  }, [mutateGlobal, recent, recommendations]);

  useEffect(() => {
    if (lastActivationTokenRef.current === activationToken) return;
    lastActivationTokenRef.current = activationToken;
    refreshReadAwareData();
  }, [activationToken, refreshReadAwareData]);

  const captureFeedScrollAnchor = useCallback((id: string | null) => {
    if (density !== "feed" || !id) return;
    const scroller = feedScrollRef.current;
    if (!scroller) return;
    const card = scroller.querySelector<HTMLElement>(`[data-library-artifact-id="${CSS.escape(id)}"]`);
    if (!card) return;
    pendingFeedScrollAnchorRef.current = {
      id,
      offsetTop: card.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      settleFrames: 3,
    };
  }, [density]);

  useLayoutEffect(() => {
    const anchor = pendingFeedScrollAnchorRef.current;
    if (!anchor || density !== "feed") return;
    if (anchor.waitForArtifactId && !items.some((artifact) => artifact.id === anchor.waitForArtifactId)) return;

    let frame = 0;
    let attempts = 0;
    const restore = () => {
      if (pendingFeedScrollAnchorRef.current !== anchor) return;
      const scroller = feedScrollRef.current;
      const card = scroller?.querySelector<HTMLElement>(`[data-library-artifact-id="${CSS.escape(anchor.id)}"]`);
      if (scroller && card) {
        const currentOffset = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += currentOffset - anchor.offsetTop;
      } else if (scroller) {
        // Virtualized feed: the anchor card may not be mounted at the current
        // scroll offset — jump the virtualizer to its index so the next frame
        // can fine-tune against the real element.
        const anchorIndex = items.findIndex((artifact) => artifact.id === anchor.id);
        if (anchorIndex !== -1) feedVirtualizer.scrollToIndex(anchorIndex, { align: "start" });
      }
      attempts += 1;
      if (attempts < anchor.settleFrames) {
        frame = window.requestAnimationFrame(restore);
      } else {
        pendingFeedScrollAnchorRef.current = null;
      }
    };

    frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, [density, desktopReaderVisible, feedVirtualizer, items, selectedId]);

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

  const markUnread = useCallback(async (id: string) => {
    // Drop any pending/local read mark so the item is unread locally, then persist to the server.
    pendingReadIdsRef.current.delete(id);
    readEligibleIdsRef.current.delete(id);
    setLocalReadIds((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    try {
      await markLibraryArtifactsUnread([id]);
    } catch (error) {
      console.warn("[library] failed to mark artifact unread", error);
    }
    refreshReadAwareData();
  }, [refreshReadAwareData]);

  const replaceLibraryHistory = useCallback((scope: string, controls: LibraryUrlControls, recommendationEpisodeId?: string | null) => {
    if (typeof window === "undefined") return;
    window.history.replaceState({ scope }, "", buildLibraryUrl(scope, controls, { recommendationEpisodeId }));
  }, []);

  const pushLibraryHistory = useCallback((scope: string, controls: LibraryUrlControls, recommendationEpisodeId?: string | null) => {
    if (typeof window === "undefined") return;
    window.history.pushState({ scope }, "", buildLibraryUrl(scope, controls, { recommendationEpisodeId }));
  }, []);

  const navigateLibrary = useCallback((scope: string, controls: LibraryUrlControls, recommendationEpisodeId?: string | null) => {
    navigateTo("library", scope);
    replaceLibraryHistory(scope, controls, recommendationEpisodeId);
  }, [navigateTo, replaceLibraryHistory]);

  const pushControlChange = useCallback((controls: LibraryUrlControls) => {
    pushLibraryHistory(scopePath, controls);
  }, [pushLibraryHistory, scopePath]);

  const handleReviewStatus = useCallback(async (id: string, status: ReviewQueueStatus, note?: string) => {
    // Optimistically drop the item from the Updated lane, then persist + revalidate the queue.
    setLocalHiddenIds((previous) => {
      const next = new Set(previous);
      next.add(id);
      return next;
    });
    if (selectedId === id) {
      captureFeedScrollAnchor(id);
      setSelectedId(null);
      setMobileDetailOpen(false);
      navigateLibrary("", libraryControls);
    }
    try {
      await setReviewStatus(id, status, note);
    } catch (error) {
      setLocalHiddenIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      console.warn("[library] failed to set review status", error);
      return;
    }
    void reviewQueue.mutate();
    refreshReadAwareData();
  }, [captureFeedScrollAnchor, libraryControls, navigateLibrary, refreshReadAwareData, reviewQueue, selectedId]);

  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseLibraryControls(window.location.search);
      const controls = parsed.ranking === "for-you" ? { ...parsed, density: "feed" as const } : parsed;
      setDensityState(controls.density);
      setRankingState(controls.ranking);
      setStatusFilterState(controls.status);
      setModeFilterState(controls.mode);
      setSelectedSourceState(controls.source);
      setSelectedTagState(controls.tag);
      setSelectedRecommendationEpisodeId(recommendationEpisodeIdFromSearch(window.location.search));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const itemId = libraryItemIdFromScope(scopePath);
    if (itemId) {
      setSelectedId(itemId);
      setSelectedRecommendationEpisodeId(typeof window === "undefined" ? null : recommendationEpisodeIdFromSearch(window.location.search));
      setMobileDetailOpen(true);
      return;
    }
    setSelectedRecommendationEpisodeId(null);
    if (density === "feed") {
      setSelectedId(null);
      setMobileDetailOpen(false);
    }
  }, [density, scopePath]);

  useEffect(() => {
    if (!selectedId || !selectedArtifact) return;
    if (isReadableArtifact(selectedArtifact)) readEligibleIdsRef.current.add(selectedId);
    else readEligibleIdsRef.current.delete(selectedId);
  }, [selectedArtifact, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedId || loading) return;
    if (libraryItemIdFromScope(scopePath)) return;
    if (!selectedVisible) {
      if (ranking === "new" && localReadIds.has(selectedId)) return;
      if (density === "list" && items[0]) {
        const nextId = items[0].id;
        setSelectedId(nextId);
        replaceLibraryHistory(libraryItemScope(nextId), libraryControls);
      } else {
        captureFeedScrollAnchor(selectedId);
        setSelectedId(null);
        setMobileDetailOpen(false);
        if (libraryItemIdFromScope(scopePath)) replaceLibraryHistory("", libraryControls);
      }
    }
  }, [captureFeedScrollAnchor, density, items, libraryControls, loading, localReadIds, ranking, replaceLibraryHistory, scopePath, selectedId, selectedVisible]);

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
        captureFeedScrollAnchor(selectedId);
        setSelectedId(null);
        setMobileDetailOpen(false);
        navigateLibrary("", libraryControls);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [captureFeedScrollAnchor, density, libraryControls, navigateLibrary, selectedId]);

  // Mark an item read only when you move OFF it (open another, or close the reader) — not on open.
  // Combined with the unread filter retaining the selected item, an opened item stays visible while
  // you read it and only drops out of the New/unread view once you click away.
  const previousSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousSelectedIdRef.current;
    if (previous && previous !== selectedId && readEligibleIdsRef.current.has(previous)) {
      readEligibleIdsRef.current.delete(previous);
      markRead([previous]);
    }
    previousSelectedIdRef.current = selectedId;
  }, [selectedId, markRead]);

  useEffect(() => {
    localStorage.setItem(SOURCE_WIDTH_KEY, String(sourceWidth));
  }, [sourceWidth]);

  useEffect(() => {
    localStorage.setItem(CONTENT_WIDTH_KEY, String(contentWidth));
  }, [contentWidth]);

  useEffect(() => {
    localStorage.setItem(SOURCES_OPEN_KEY, String(sourcesOpen));
  }, [sourcesOpen]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = event.clientX - resizeRef.current.startX;
      if (delta !== 0) resizeRef.current.moved = true;
      if (resizing === "source") {
        setSourceWidth(clamp(resizeRef.current.startWidth + delta, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH));
      } else {
        setContentWidth(clamp(resizeRef.current.startWidth + delta, MIN_CONTENT_WIDTH, MAX_CONTENT_WIDTH));
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      const gesture = resizeRef.current;
      const moved = Boolean(gesture && (gesture.moved || event.clientX !== gesture.startX));
      if (resizing === "source" && gesture && !moved) {
        setSourcesOpen(false);
      }
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
    const checkedSourceIds = selectedSourceId && selectedSourceId !== "manual" ? [selectedSourceId] : undefined;
    try {
      refreshReadAwareData();
      const report = await intakeLibrarySources({
        sourceIds: checkedSourceIds,
        limit: 25,
      });
      const added = report.queued + report.promoted;
      const issueCount = report.errors.length + report.blocked.length;
      setToast({
        id: `source-check:${Date.now()}`,
        title: issueCount
          ? report.errors[0] || report.blocked[0]?.reason || "Source check needs attention"
          : `${report.checked} ${report.checked === 1 ? "source" : "sources"} checked`,
        message: issueCount
          ? report.errors[0] || report.blocked[0]?.reason || "Source check needs attention"
          : added
            ? `${added} ${added === 1 ? "item" : "items"} processing`
            : "No new items",
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
  }, [isCheckingSources, mutateGlobal, refreshReadAwareData, selectedSourceId]);

  const dismissCandidate = useCallback(async (artifact: LibraryArtifact | RecommendedArtifact) => {
    setLocalHiddenIds((previous) => {
      const next = new Set(previous);
      next.add(artifact.id);
      return next;
    });
    if (selectedId === artifact.id) {
      captureFeedScrollAnchor(artifact.id);
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
  }, [captureFeedScrollAnchor, libraryControls, navigateLibrary, refreshReadAwareData, selectedId]);

  const archiveReference = useCallback(async (artifact: LibraryArtifact | RecommendedArtifact) => {
    setLocalHiddenIds((previous) => {
      const next = new Set(previous);
      next.add(artifact.id);
      return next;
    });
    const wasSelected = selectedId === artifact.id;
    if (wasSelected) {
      captureFeedScrollAnchor(artifact.id);
      setSelectedId(null);
      setMobileDetailOpen(false);
      navigateLibrary("", libraryControls);
    }
    try {
      await archiveArtifact(artifact.id);
    } catch (error) {
      setLocalHiddenIds((previous) => {
        const next = new Set(previous);
        next.delete(artifact.id);
        return next;
      });
      if (wasSelected) {
        setSelectedId(artifact.id);
        setMobileDetailOpen(true);
        navigateLibrary(libraryItemScope(artifact.id), libraryControls);
      }
      setToast({
        id: `archive-error:${artifact.id}:${Date.now()}`,
        title: error instanceof Error ? error.message : "Archive failed",
        message: "Archive failed",
      });
      console.warn("[library] failed to archive reference", error);
      return;
    }
    setToast({
      id: `archive:${artifact.id}:${Date.now()}`,
      title: artifact.title,
      message: "Reference archived",
    });
    refreshReadAwareData();
  }, [captureFeedScrollAnchor, libraryControls, navigateLibrary, refreshReadAwareData, selectedId]);

  const dismissRecommendation = useCallback(async (artifact: LibraryArtifact | RecommendedArtifact, note?: string) => {
    const episodeId = "recommendation" in artifact ? artifact.recommendation?.episode_id : undefined;
    if (!episodeId) return;
    setLocalHiddenIds((previous) => new Set(previous).add(artifact.id));
    if (selectedId === artifact.id) {
      captureFeedScrollAnchor(artifact.id);
      setSelectedId(null);
      setMobileDetailOpen(false);
      navigateLibrary("", libraryControls);
    }
    try {
      await dismissLibraryRecommendation(episodeId, note, "for_you");
    } catch (error) {
      setLocalHiddenIds((previous) => {
        const next = new Set(previous);
        next.delete(artifact.id);
        return next;
      });
      setToast({
        id: `recommendation-dismiss-error:${Date.now()}`,
        title: artifact.title,
        message: error instanceof Error ? error.message : "Dismiss failed",
      });
      return;
    }
    setToast({
      id: `recommendation-dismiss:${episodeId}:${Date.now()}`,
      title: artifact.title,
      message: "Recommendation dismissed",
      undo: async () => {
        try {
          await restoreLibraryRecommendation(episodeId);
          setLocalHiddenIds((previous) => {
            const next = new Set(previous);
            next.delete(artifact.id);
            return next;
          });
          setToast(null);
          void recommendations.mutate();
        } catch (error) {
          setToast({ id: `recommendation-restore-error:${Date.now()}`, title: artifact.title, message: error instanceof Error ? error.message : "Restore failed" });
        }
      },
    });
    void recommendations.mutate().then((pages) => {
      const episodeStillPresent = pages?.some((page) => page.items.some((item) => item.recommendation?.episode_id === episodeId));
      if (episodeStillPresent) return;
      setLocalHiddenIds((previous) => {
        const next = new Set(previous);
        next.delete(artifact.id);
        return next;
      });
    }).catch(() => {});
  }, [captureFeedScrollAnchor, libraryControls, navigateLibrary, recommendations, selectedId]);

  const openArtifact = useCallback((artifact: LibraryArtifact | RecommendedArtifact, intent: "default" | "metadata" = "default") => {
    // Do NOT mark read on open — an opened item stays in the unread view while you read it. It's
    // marked read only when you move off it (see the deselect effect below), so it doesn't vanish.
    const recommendationEpisodeId = ranking === "for-you" ? artifact.recommendation?.episode_id || null : null;
    if (intent === "metadata") {
      try { window.localStorage.setItem(LIBRARY_META_OPEN_KEY, "1"); } catch { /* ignore */ }
      captureFeedScrollAnchor(artifact.id);
      if (isReadableArtifact(artifact)) readEligibleIdsRef.current.add(artifact.id);
      setSelectedId(artifact.id);
      setSelectedRecommendationEpisodeId(recommendationEpisodeId);
      setMobileDetailOpen(true);
      navigateLibrary(libraryItemScope(artifact.id), libraryControls, recommendationEpisodeId);
      return;
    }
    if (density === "feed" && selectedId === artifact.id) {
      captureFeedScrollAnchor(artifact.id);
      setSelectedId(null);
      setSelectedRecommendationEpisodeId(null);
      setMobileDetailOpen(false);
      navigateLibrary("", libraryControls);
      return;
    }
    captureFeedScrollAnchor(artifact.id);
    if (isReadableArtifact(artifact)) readEligibleIdsRef.current.add(artifact.id);
    setSelectedId(artifact.id);
    setSelectedRecommendationEpisodeId(recommendationEpisodeId);
    setMobileDetailOpen(true);
    navigateLibrary(libraryItemScope(artifact.id), libraryControls, recommendationEpisodeId);
  }, [captureFeedScrollAnchor, density, libraryControls, navigateLibrary, ranking, selectedId]);

  const selectDensity = useCallback((nextDensity: LibraryDensity) => {
    const nextControls = { ...libraryControls, density: nextDensity };
    setDensityState(nextDensity);
    pushControlChange(nextControls);
  }, [libraryControls, pushControlChange]);

  const selectRanking = useCallback((nextRanking: LibraryRanking) => {
    const nextDensity = nextRanking === "for-you" ? "feed" : density;
    const nextControls = { ...libraryControls, ranking: nextRanking, density: nextDensity };
    if (nextDensity !== density) setDensityState(nextDensity);
    setRankingState(nextRanking);
    pushControlChange(nextControls);
  }, [density, libraryControls, pushControlChange]);

  useEffect(() => {
    if (ranking === "new" && !recent.isLoading && newCount === 0) {
      const nextControls = { ...libraryControls, ranking: "recent" as const };
      setRankingState("recent");
      replaceLibraryHistory(scopePath, nextControls);
      return;
    }

    if (ranking === "updated" && !reviewQueue.isLoading && updatedCount === 0) {
      const nextControls = { ...libraryControls, ranking: "recent" as const };
      setRankingState("recent");
      replaceLibraryHistory(scopePath, nextControls);
    }
  }, [libraryControls, newCount, ranking, recent.isLoading, replaceLibraryHistory, reviewQueue.isLoading, scopePath, updatedCount]);

  const selectStatusFilter = useCallback((nextStatus: LibraryStatusFilter) => {
    const nextControls = { ...libraryControls, status: nextStatus };
    setStatusFilterState(nextStatus);
    pushControlChange(nextControls);
  }, [libraryControls, pushControlChange]);

  const selectModeFilter = useCallback((nextMode: LibraryModeControl) => {
    const nextControls = { ...libraryControls, mode: nextMode };
    setModeFilterState(nextMode);
    pushControlChange(nextControls);
  }, [libraryControls, pushControlChange]);

  const selectSource = (source: string | null) => {
    const nextControls = { ...libraryControls, source, tag: null };
    setSelectedSourceState(source);
    setSelectedTagState(null);
    pushControlChange(nextControls);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSourcesOpen(false);
  };

  const selectTag = (source: string | null, tag: string | null) => {
    const nextControls = { ...libraryControls, source, tag };
    setSelectedSourceState(source);
    setSelectedTagState(tag);
    pushControlChange(nextControls);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSourcesOpen(false);
  };

  const handleFeedScroll = useCallback(() => {
    const node = feedScrollRef.current;
    if (!node) return;
    if (node.scrollTop < 80 && newItemNoticeCount && !pendingFeedScrollAnchorRef.current) {
      setNewItemNoticeCount(0);
    }
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 900) {
      if (usesRecentPaging && recent.hasMore && !recent.isLoadingMore) recent.loadMore();
      if (usesRecommendationPaging && recommendations.hasMore && !recommendations.isLoadingMore) recommendations.loadMore();
    }
  }, [newItemNoticeCount, recent, recommendations, usesRecentPaging, usesRecommendationPaging]);

  const startResize = useCallback((kind: "source" | "content", width: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(kind);
    resizeRef.current = { startX: event.clientX, startWidth: width, moved: false };
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
                  title="Filters"
                >
                  Filters
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
                  title={ranking === "for-you" ? "For You uses recommendation cards" : "List view"}
                  disabled={ranking === "for-you"}
                  className={ranking === "for-you" ? "cursor-default opacity-40" : ""}
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
                <SecondarySegmentedButton
                  onClick={() => selectRanking("recent")}
                  active={ranking === "recent"}
                  icon={<Clock3 className="h-4 w-4" />}
                  title="Recent"
                >
                  Recent<span className="ml-1.5 text-xs tabular-nums text-[var(--text-tertiary)]">{recentCount}</span>
                </SecondarySegmentedButton>
                <SecondarySegmentedButton
                  onClick={() => selectRanking("for-you")}
                  active={ranking === "for-you"}
                  icon={<Sparkles className="h-4 w-4" />}
                  title="For You"
                >
                  For You<span className="ml-1.5 text-xs tabular-nums text-[var(--text-tertiary)]">{forYouCount}</span>
                </SecondarySegmentedButton>
                {newCount > 0 && (
                  <SecondarySegmentedButton
                    onClick={() => selectRanking("new")}
                    active={ranking === "new"}
                    icon={<CirclePlus className="h-4 w-4" />}
                    title="New"
                  >
                    New
                    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-blue-500 tabular-nums">{newCount}</span>
                  </SecondarySegmentedButton>
                )}
                {updatedCount > 0 && (
                  <SecondarySegmentedButton
                    onClick={() => selectRanking("updated")}
                    active={ranking === "updated"}
                    icon={<RefreshCw className="h-4 w-4" />}
                    title="Updated"
                  >
                    Updated
                    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-600 tabular-nums">{updatedCount}</span>
                  </SecondarySegmentedButton>
                )}
              </SecondarySegmentedControl>
              {processingCount > 0 && ranking !== "recent" && ranking !== "new" && (
                <SecondarySegmentedControl>
                  <SecondarySegmentedButton
                    onClick={() => selectRanking("recent")}
                    active={false}
                    icon={<Loader2 className="h-4 w-4 motion-safe:animate-spin" />}
                    title="Show processing items in Recent"
                  >
                    Processing <span className="ml-1.5 text-xs tabular-nums text-[var(--text-tertiary)]">{processingCount}</span>
                  </SecondarySegmentedButton>
                </SecondarySegmentedControl>
              )}
              <SecondaryIconButton
                data-testid="library-check-sources-toolbar"
                onClick={() => { void checkSourcesNow(); }}
                disabled={isCheckingSources}
                aria-busy={isCheckingSources}
                title={selectedSourceId && selectedSourceId !== "manual" ? `Check ${selectedSourceId} now` : "Check hourly Library sources now"}
                aria-label={selectedSourceId && selectedSourceId !== "manual" ? `Check ${selectedSourceId} now` : "Check hourly Library sources now"}
                className={isCheckingSources ? "cursor-wait" : ""}
              >
                {isCheckingSources ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </SecondaryIconButton>
              <LibraryHealthPanel onCheckSources={checkSourcesNow} isCheckingSources={isCheckingSources} />
            </>
          }
        />
      </MobileChromeTopBar>

      <MobileChromeContent
        offset={SECONDARY_CHROME_MOBILE_OFFSET}
        inactiveClassName={SECONDARY_CHROME_BODY_GUTTER_CLASS}
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${resizing ? "select-none" : ""}`}
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-[var(--border-default)]">
          {sourcesOpen && (
            <button
              type="button"
              aria-label="Close filters"
              className="absolute bottom-0 right-0 top-0 z-10 bg-transparent left-[344px] lg:hidden"
              onClick={() => setSourcesOpen(false)}
            />
          )}
          {sourcesOpen && (
            <SourceNav
              selectedSource={selectedSource}
              selectedTag={selectedTag}
              statusFilter={statusFilter}
              modeFilter={modeFilter}
              searchQuery={searchQuery}
              onSelect={selectSource}
              onTagSelect={selectTag}
              onStatusSelect={selectStatusFilter}
              onModeSelect={selectModeFilter}
              typeFilter={typeFilter}
              onTypeSelect={setTypeFilter}
              evalFilters={evalFilters}
              onEvalFilterChange={setEvalFilters}
              className="absolute bottom-3 left-3 top-3 z-20 w-[min(82vw,320px)] rounded-lg border border-[var(--border-default)] content-card-shadow lg:static lg:bottom-auto lg:left-auto lg:top-auto lg:z-auto lg:block lg:w-[var(--library-source-width)] lg:flex-none lg:shrink-0 lg:rounded-none lg:border-0 lg:shadow-none"
              style={{ "--library-source-width": `${sourceWidth}px` } as CSSProperties}
            />
          )}
          {sourcesOpen && (
            <div className="relative hidden w-px shrink-0 self-stretch bg-[var(--border-default)] lg:block">
              <div
                aria-hidden
                className="absolute inset-0 bg-[var(--border-default)]"
              />
              <button
                type="button"
                aria-label="Resize or collapse filters"
                data-testid="library-source-resizer"
                className="hilt-resize-separator-hit absolute inset-y-0 left-1/2 z-20 w-2 -translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0"
                onMouseDown={startResize("source", sourceWidth)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSourcesOpen(false);
                  }
                }}
              />
            </div>
          )}

          <div
            className={`relative z-0 ${mobileReaderVisible ? "hidden" : "flex"} ${desktopReaderVisible ? "lg:flex lg:w-[var(--library-content-width)] lg:flex-none lg:shrink-0" : "lg:flex lg:flex-1"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]`}
            style={{ "--library-content-width": `${contentWidth}px` } as CSSProperties}
          >
            {density === "feed" ? (
              <div ref={feedScrollRef} onScroll={handleFeedScroll} data-mobile-scroll-chrome="top-bottom" data-testid="library-feed-list" className="hilt-mobile-scroll-clearance min-h-0 flex-1 overflow-y-auto">
                {newItemNoticeCount > 0 && (
                  <div className="sticky top-3 z-30 flex h-0 justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        pendingFeedScrollAnchorRef.current = null;
                        feedVirtualizer.scrollToOffset(0, { align: "start" });
                        setNewItemNoticeCount(0);
                      }}
                      className="rounded-full border border-[var(--border-default)] bg-[var(--content-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] content-card-shadow hover:text-[var(--text-primary)]"
                    >
                      {newItemNoticeCount} new {newItemNoticeCount === 1 ? "item" : "items"}
                    </button>
                  </div>
                )}
                <div className={`${desktopReaderVisible ? "max-w-none px-3 pt-3" : "mx-auto max-w-4xl px-4 pt-5"} w-full`}>
                  {ranking === "updated" && reviewQueue.notes.length > 0 && (
                    <div className={`flex w-full flex-col ${desktopReaderVisible ? "gap-3 pb-3" : "gap-5 pb-5"}`}>
                      {reviewQueue.notes.map((note) => (
                        <GenerationNoteCard key={note.batch} note={note} />
                      ))}
                    </div>
                  )}
                  {loading && <LoadingState label="Loading library" className="min-h-40 py-8" />}
                  {!loading && items.length === 0 && (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-5 text-sm text-[var(--text-secondary)]">
                      No library items match these controls.
                    </div>
                  )}
                  {items.length > 0 && (
                    <div className="relative w-full" style={{ height: feedVirtualizer.getTotalSize() }}>
                      {feedVirtualizer.getVirtualItems().map((virtualRow) => {
                        const artifact = items[virtualRow.index];
                        if (!artifact) {
                          return (
                            <VirtualFeedRow
                              key="library-feed-footer"
                              virtualizer={feedVirtualizer}
                              virtualRow={virtualRow}
                              className="py-2 text-center text-xs text-[var(--text-tertiary)]"
                            >
                              {isLoadingMore ? <LoadingState label="Loading more" size="sm" className="py-0 text-xs" /> : `${items.length} of ${total} loaded`}
                            </VirtualFeedRow>
                          );
                        }
                        return (
                          // Row padding stands in for the old flex-column gap; descending
                          // z-index keeps a card's downward-opening menus above the rows
                          // below it (each translateY row is its own stacking context).
                          <VirtualFeedRow
                            key={artifact.id}
                            virtualizer={feedVirtualizer}
                            virtualRow={virtualRow}
                            className={desktopReaderVisible ? "pb-3" : "pb-5"}
                            style={{ zIndex: feedRowCount - virtualRow.index }}
                          >
                            <FeedCard
                              artifact={artifact}
                              variant={ranking === "for-you" ? "recommendation" : "standard"}
                              showEvalBreakdown={adminEvalActive}
                              promoteReason={ranking === "for-you" ? "for_you_selected" : "manual_save"}
                              onChanged={refresh}
                              onOpen={openArtifact}
                              onMarkUnread={markUnread}
                              onDismissCandidate={dismissCandidate}
                              onArchiveReference={archiveReference}
                              onReviewStatus={ranking === "updated" ? handleReviewStatus : undefined}
                              onDismissRecommendation={ranking === "for-you" ? dismissRecommendation : undefined}
                              active={artifact.id === selectedId}
                              wideLayout={!desktopReaderVisible}
                            />
                          </VirtualFeedRow>
                        );
                      })}
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
                onLoadMore={ranking === "for-you" ? recommendations.loadMore : recent.loadMore}
                header={ranking === "updated" && reviewQueue.notes.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {reviewQueue.notes.map((note) => (
                      <GenerationNoteCard key={note.batch} note={note} stickyWhenCollapsed={false} />
                    ))}
                  </div>
                ) : undefined}
                showEvalBreakdown={adminEvalActive}
                className="min-h-0 w-full flex-1"
              />
            )}
          </div>
          {desktopReaderVisible && (
            <div className="group relative hidden w-px shrink-0 self-stretch lg:block">
              <div
                aria-hidden
                className="absolute inset-0 bg-[var(--border-default)]"
              />
              <div
                data-testid="library-content-resizer"
                className="absolute inset-y-0 left-1/2 z-20 w-2 -translate-x-1/2 cursor-col-resize"
                onMouseDown={startResize("content", contentWidth)}
              />
            </div>
          )}

          {desktopReaderVisible && (
            <div data-testid="library-feed-detail" className={`${mobileReaderVisible ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 lg:flex`}>
              <LibraryArtifactDetailPane
                key={`${selectedId ?? "empty"}:${selectedRecommendationEpisodeId || "current"}`}
                id={selectedId}
                artifactPath={selectedArtifact?.path || null}
                recommendationEpisodeId={selectedRecommendationEpisodeId}
                showBack
                controlsClassName="lg:hidden"
                backClassName="lg:hidden"
                onBack={() => {
                  captureFeedScrollAnchor(selectedId);
                  setMobileDetailOpen(false);
                  if (density === "feed") {
                    setSelectedId(null);
                    navigateLibrary("", libraryControls);
                  }
                }}
                onChanged={refresh}
                onMarkUnread={markUnread}
                onCandidateDismissed={dismissCandidate}
                onArchiveReference={archiveReference}
                onReviewStatus={ranking === "updated" ? handleReviewStatus : undefined}
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
