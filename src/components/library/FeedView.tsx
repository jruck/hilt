"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useInfiniteLibrary, useRecommendations } from "@/hooks/useLibrary";
import type { RecommendedArtifact } from "@/lib/library/types";
import { LoadingState } from "@/components/ui/LoadingState";
import { FeedCard } from "./FeedCard";
import { LIBRARY_META_OPEN_KEY, LibraryArtifactDetailPane } from "./LibraryArtifactDetailPane";

const FEED_CARD_ESTIMATED_HEIGHT = 400;
const FEED_CARD_OVERSCAN = 6;

export function FeedView({
  searchQuery,
  mode,
  onCountChange,
}: {
  searchQuery: string;
  mode: "recent" | "for-you";
  onModeChange?: (mode: "recent" | "for-you") => void;
  onCountChange?: (count: number) => void;
}) {
  const recent = useInfiniteLibrary({ q: searchQuery || null, surface: "feed" }, 40);
  const recs = useRecommendations(10);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const loading = mode === "recent" ? recent.isLoading : recs.isLoading;
  const items = mode === "recent" ? recent.artifacts : recs.items;
  const detailOpen = selectedId !== null;

  useEffect(() => {
    onCountChange?.(mode === "recent" ? recent.total : items.length);
  }, [items.length, mode, onCountChange, recent.total]);

  useEffect(() => {
    if (!selectedId || loading) return;
    if (!items.some((artifact) => artifact.id === selectedId)) setSelectedId(null);
  }, [items, loading, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

  const handleScroll = useCallback(() => {
    if (mode !== "recent" || !recent.hasMore || recent.isLoadingMore) return;
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 900) recent.loadMore();
  }, [mode, recent]);

  // Trailing "x of y loaded" row rendered as the last virtual row in recent mode.
  const footerCount = mode === "recent" && items.length > 0 ? 1 : 0;
  const rowCount = items.length + footerCount;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FEED_CARD_ESTIMATED_HEIGHT,
    overscan: FEED_CARD_OVERSCAN,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const refresh = () => {
    recent.mutate();
    recs.mutate();
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      <div
        className={`${detailOpen ? "hidden lg:flex lg:w-[min(42vw,520px)] lg:min-w-[360px] lg:max-w-[560px] lg:flex-none lg:border-r lg:border-[var(--border-default)]" : "flex flex-1"} min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]`}
      >
        <div ref={scrollRef} onScroll={handleScroll} data-mobile-scroll-chrome="top-bottom" data-testid="library-feed-list" className="hilt-mobile-scroll-clearance min-h-0 flex-1 overflow-y-auto">
          <div className={`${detailOpen ? "max-w-none px-3 pt-3" : "mx-auto max-w-3xl px-4 pt-5"} w-full`}>
            {loading && <LoadingState label="Loading library" className="min-h-40 py-8" />}
            {!loading && items.length === 0 && (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-5 text-sm text-[var(--text-secondary)]">
                No library items yet.
              </div>
            )}
            {items.length > 0 && (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {virtualItems.map((virtualRow) => {
                  const artifact = items[virtualRow.index];
                  if (!artifact) {
                    return (
                      <div
                        key="library-feed-footer"
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute left-0 top-0 w-full py-2 text-center text-xs text-[var(--text-tertiary)]"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        {recent.isLoadingMore ? <LoadingState label="Loading more" size="sm" className="py-0 text-xs" /> : `${items.length} of ${recent.total} loaded`}
                      </div>
                    );
                  }
                  return (
                    // Row padding stands in for the old flex-column gap; descending
                    // z-index keeps a card's downward-opening menus above the rows
                    // below it (transform creates a stacking context per row).
                    <div
                      key={artifact.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className={`absolute left-0 top-0 w-full ${detailOpen ? "pb-3" : "pb-5"}`}
                      style={{ transform: `translateY(${virtualRow.start}px)`, zIndex: rowCount - virtualRow.index }}
                    >
                      <FeedCard
                        artifact={artifact}
                        reason={mode === "for-you" && typeof (artifact as RecommendedArtifact).why === "string" ? (artifact as RecommendedArtifact).why : undefined}
                        promoteReason={mode === "for-you" ? "for_you_selected" : "manual_save"}
                        onChanged={refresh}
                        onOpen={(_, intent) => {
                          if (intent === "metadata") {
                            try { window.localStorage.setItem(LIBRARY_META_OPEN_KEY, "1"); } catch { /* ignore */ }
                          }
                          setSelectedId(artifact.id);
                        }}
                        active={artifact.id === selectedId}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {detailOpen && (
        <div data-testid="library-feed-detail" className="flex min-h-0 flex-1">
          <LibraryArtifactDetailPane
            key={selectedId}
            id={selectedId}
            showBack
            showClose
            backClassName="lg:hidden"
            closeClassName="max-lg:hidden"
            onBack={() => setSelectedId(null)}
            onClose={() => setSelectedId(null)}
            onChanged={refresh}
          />
        </div>
      )}
    </div>
  );
}
