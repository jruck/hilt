"use client";

import { useState } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { FileText, List } from "lucide-react";
import { BrowseView } from "./BrowseView";
import { FeedView } from "./FeedView";

export function LibraryView({ searchQuery }: { searchQuery: string }) {
  const [view, setView] = useState<"feed" | "browse">("feed");
  const [_opened, setOpened] = useState<LibraryArtifact | null>(null);

  const openArtifact = (artifact: LibraryArtifact) => {
    setOpened(artifact);
    if (view !== "browse") setView("browse");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="flex shrink-0 items-center justify-between px-5 py-3">
        <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-secondary)] p-1">
          <button
            onClick={() => setView("feed")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === "feed" ? "bg-[var(--content-surface)] text-[var(--text-primary)] content-card-shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            title="Feed"
          >
            <List className="h-4 w-4" />
            Feed
          </button>
          <button
            onClick={() => setView("browse")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === "browse" ? "bg-[var(--content-surface)] text-[var(--text-primary)] content-card-shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            title="Browse"
          >
            <FileText className="h-4 w-4" />
            Browse
          </button>
        </div>
        {searchQuery && <div className="text-xs text-[var(--text-tertiary)]">Search: {searchQuery}</div>}
      </div>
      {view === "feed" ? (
        <FeedView searchQuery={searchQuery} onOpen={openArtifact} />
      ) : (
        <BrowseView searchQuery={searchQuery} onOpen={setOpened} />
      )}
    </div>
  );
}
