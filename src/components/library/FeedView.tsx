"use client";

import { useEffect } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { useLibrary, useRecommendations } from "@/hooks/useLibrary";
import { FeedCard } from "./FeedCard";

export function FeedView({
  searchQuery,
  mode,
  onCountChange,
  onOpen,
}: {
  searchQuery: string;
  mode: "recent" | "for-you";
  onModeChange?: (mode: "recent" | "for-you") => void;
  onCountChange?: (count: number) => void;
  onOpen: (artifact: LibraryArtifact) => void;
}) {
  const recent = useLibrary({ q: searchQuery || null, limit: 80 });
  const recs = useRecommendations(10);
  const loading = mode === "recent" ? recent.isLoading : recs.isLoading;
  const items = mode === "recent" ? recent.artifacts : recs.items;

  useEffect(() => {
    onCountChange?.(mode === "recent" ? recent.total : items.length);
  }, [items.length, mode, onCountChange, recent.total]);

  const refresh = () => {
    recent.mutate();
    recs.mutate();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-primary)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5">
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
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
