"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteLibrary, useRecommendations } from "@/hooks/useLibrary";
import { FeedCard } from "./FeedCard";
import { LibraryArtifactDetailPane } from "./LibraryArtifactDetailPane";

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
  const recent = useInfiniteLibrary({ q: searchQuery || null }, 40);
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

  const refresh = () => {
    recent.mutate();
    recs.mutate();
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      <div
        className={`${detailOpen ? "hidden lg:flex lg:w-[min(42vw,520px)] lg:min-w-[360px] lg:max-w-[560px] lg:flex-none lg:border-r lg:border-[var(--border-default)]" : "flex flex-1"} min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]`}
      >
        <div ref={scrollRef} onScroll={handleScroll} data-mobile-scroll-chrome="top-bottom" data-testid="library-feed-list" className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${detailOpen ? "max-w-none gap-3 px-3 py-3" : "mx-auto max-w-3xl gap-5 px-4 py-5"} flex w-full flex-col`}>
            {loading && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-5 text-sm text-[var(--text-secondary)]">Loading library...</div>}
            {!loading && items.length === 0 && (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-5 text-sm text-[var(--text-secondary)]">
                No library items yet.
              </div>
            )}
            {items.map((artifact) => (
              <FeedCard
                key={artifact.id}
                artifact={artifact}
                why={"why" in artifact && typeof artifact.why === "string" ? artifact.why : undefined}
                priority={"priority" in artifact && (artifact.priority === "must_read" || artifact.priority === "recommended" || artifact.priority === "interesting") ? artifact.priority : undefined}
                promoteReason={mode === "for-you" ? "for_you_selected" : "manual_save"}
                onChanged={refresh}
                onOpen={() => setSelectedId(artifact.id)}
                active={artifact.id === selectedId}
              />
            ))}
            {mode === "recent" && items.length > 0 && (
              <div className="py-2 text-center text-xs text-[var(--text-tertiary)]">
                {recent.isLoadingMore ? "Loading more..." : recent.hasMore ? `${items.length} of ${recent.total} loaded` : `${items.length} of ${recent.total} loaded`}
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
