"use client";

import { useState } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { FileText, List } from "lucide-react";
import { BrowseView } from "./BrowseView";
import { FeedView } from "./FeedView";
import { LibraryHealthPanel } from "./LibraryHealthPanel";

function segmentedButton(active: boolean): string {
  return `inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors ${
    active
      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
  }`;
}

export function LibraryView({ searchQuery }: { searchQuery: string }) {
  const [view, setView] = useState<"feed" | "browse">("feed");
  const [feedMode, setFeedMode] = useState<"recent" | "for-you">("recent");
  const [statusFilter, setStatusFilter] = useState<"all" | "saved" | "candidate">("all");
  const [visibleCount, setVisibleCount] = useState(0);
  const [_opened, setOpened] = useState<LibraryArtifact | null>(null);

  const openArtifact = (artifact: LibraryArtifact) => {
    setOpened(artifact);
    if (view !== "browse") setView("browse");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="flex shrink-0 flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--bg-tertiary)] p-0.5">
          <button
            onClick={() => setView("feed")}
            className={segmentedButton(view === "feed")}
            title="Feed"
          >
            <List className="h-4 w-4" />
            Feed
          </button>
          <button
            onClick={() => setView("browse")}
            className={segmentedButton(view === "browse")}
            title="Browse"
          >
            <FileText className="h-4 w-4" />
            Browse
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 sm:flex-1 sm:justify-end">
          {searchQuery && <div className="min-w-0 truncate text-xs text-[var(--text-tertiary)]">Search: {searchQuery}</div>}
          {view === "feed" ? (
            <div className="flex min-w-0 shrink items-center gap-1 overflow-x-auto rounded-lg bg-[var(--bg-tertiary)] p-0.5">
              <button onClick={() => setFeedMode("recent")} className={segmentedButton(feedMode === "recent")}>Recent</button>
              <button onClick={() => setFeedMode("for-you")} className={segmentedButton(feedMode === "for-you")}>For You</button>
            </div>
          ) : (
            <div data-testid="library-status-filter" className="flex min-w-0 shrink items-center gap-1 overflow-x-auto rounded-lg bg-[var(--bg-tertiary)] p-0.5">
              {(["all", "saved", "candidate"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={segmentedButton(statusFilter === status)}
                >
                  {status === "candidate" ? "Candidates" : status[0].toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          )}
          <div className="hidden shrink-0 text-xs text-[var(--text-tertiary)] sm:block">
            {view === "feed" && feedMode === "for-you" ? `${visibleCount} picks` : `${visibleCount} items`}
          </div>
          <LibraryHealthPanel />
        </div>
      </div>
      {view === "feed" ? (
        <FeedView searchQuery={searchQuery} mode={feedMode} onModeChange={setFeedMode} onCountChange={setVisibleCount} onOpen={openArtifact} />
      ) : (
        <BrowseView searchQuery={searchQuery} statusFilter={statusFilter} onCountChange={setVisibleCount} onOpen={setOpened} />
      )}
    </div>
  );
}
