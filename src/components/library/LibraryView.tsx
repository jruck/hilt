"use client";

import { useState } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { FileText, List } from "lucide-react";
import { BrowseView } from "./BrowseView";
import { FeedView } from "./FeedView";
import { LibraryHealthPanel } from "./LibraryHealthPanel";
import { SecondarySegmentedButton, SecondarySegmentedControl, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";

export function LibraryView({ searchQuery }: { searchQuery: string }) {
  const [view, setView] = useState<"feed" | "browse">("feed");
  const [feedMode, setFeedMode] = useState<"recent" | "for-you">("recent");
  const [statusFilter, setStatusFilter] = useState<"all" | "saved" | "candidate">("all");
  const [visibleCount, setVisibleCount] = useState(0);
  const [, setOpened] = useState<LibraryArtifact | null>(null);

  const openArtifact = (artifact: LibraryArtifact) => {
    setOpened(artifact);
    if (view !== "browse") setView("browse");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <SecondaryToolbar
        left={
          <SecondarySegmentedControl>
            <SecondarySegmentedButton
              onClick={() => setView("feed")}
              active={view === "feed"}
              icon={<List className="h-4 w-4" />}
              title="Feed"
            >
              Feed
            </SecondarySegmentedButton>
            <SecondarySegmentedButton
              onClick={() => setView("browse")}
              active={view === "browse"}
              icon={<FileText className="h-4 w-4" />}
              title="Browse"
            >
              Browse
            </SecondarySegmentedButton>
          </SecondarySegmentedControl>
        }
        right={
          <>
            {searchQuery && <div className="max-w-[180px] truncate text-xs text-[var(--text-tertiary)] sm:max-w-[260px]">Search: {searchQuery}</div>}
            {view === "feed" ? (
              <SecondarySegmentedControl>
                <SecondarySegmentedButton onClick={() => setFeedMode("recent")} active={feedMode === "recent"}>Recent</SecondarySegmentedButton>
                <SecondarySegmentedButton onClick={() => setFeedMode("for-you")} active={feedMode === "for-you"}>For You</SecondarySegmentedButton>
              </SecondarySegmentedControl>
            ) : (
              <SecondarySegmentedControl data-testid="library-status-filter">
                {(["all", "saved", "candidate"] as const).map((status) => (
                  <SecondarySegmentedButton
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    active={statusFilter === status}
                  >
                    {status === "candidate" ? "Candidates" : status[0].toUpperCase() + status.slice(1)}
                  </SecondarySegmentedButton>
                ))}
              </SecondarySegmentedControl>
            )}
            <div className="hidden shrink-0 text-xs text-[var(--text-tertiary)] md:block">
              {view === "feed" && feedMode === "for-you" ? `${visibleCount} picks` : `${visibleCount} items`}
            </div>
            <LibraryHealthPanel />
          </>
        }
      />
      {view === "feed" ? (
        <FeedView searchQuery={searchQuery} mode={feedMode} onModeChange={setFeedMode} onCountChange={setVisibleCount} onOpen={openArtifact} />
      ) : (
        <BrowseView searchQuery={searchQuery} statusFilter={statusFilter} onCountChange={setVisibleCount} onOpen={setOpened} />
      )}
    </div>
  );
}
