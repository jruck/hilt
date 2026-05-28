"use client";

import { useState } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { useLibrary, useRecommendations } from "@/hooks/useLibrary";
import { FeedCard } from "./FeedCard";

export function FeedView({ searchQuery, onOpen }: { searchQuery: string; onOpen: (artifact: LibraryArtifact) => void }) {
  const [mode, setMode] = useState<"recent" | "for-you">("recent");
  const recent = useLibrary({ q: searchQuery || null, limit: 80 });
  const recs = useRecommendations(10);
  const loading = mode === "recent" ? recent.isLoading : recs.isLoading;
  const items = mode === "recent" ? recent.artifacts : recs.items;

  const refresh = () => {
    recent.mutate();
    recs.mutate();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-default)] px-3 py-3 sm:px-5">
        <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-secondary)] p-1">
          <button
            onClick={() => setMode("recent")}
            className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === "recent" ? "bg-[var(--content-surface)] text-[var(--text-primary)] content-card-shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
          >
            Recent
          </button>
          <button
            onClick={() => setMode("for-you")}
            className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === "for-you" ? "bg-[var(--content-surface)] text-[var(--text-primary)] content-card-shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
          >
            For You
          </button>
        </div>
        <div className="shrink-0 text-xs text-[var(--text-tertiary)]">{mode === "recent" ? `${recent.total} items` : `${items.length} picks`}</div>
      </div>
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
