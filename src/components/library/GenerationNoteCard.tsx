"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ActiveBatchNote } from "@/lib/library/review-queue";
import { LibraryMarkdown } from "./LibraryMarkdown";

interface GenerationNoteCardProps {
  note: ActiveBatchNote;
  stickyWhenCollapsed?: boolean;
}

/**
 * The pinned card atop the Updated lane that explains what a generation changed and what feedback is
 * wanted. Collapsible to a one-line header and sticky while the feed scrolls; the collapsed state is
 * remembered per batch (in localStorage), so a fresh generation always appears expanded.
 */
export function GenerationNoteCard({ note, stickyWhenCollapsed = true }: GenerationNoteCardProps) {
  const storageKey = `hilt:gennote-collapsed:${note.batch}`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        if (next) window.localStorage.setItem(storageKey, "1");
        else window.localStorage.removeItem(storageKey);
      }
      return next;
    });
  };

  return (
    <div
      data-testid="library-generation-note"
      className={`overflow-hidden rounded-lg border border-amber-500/30 bg-[var(--content-surface)] shadow-sm ${
        // Expanded: sit in normal flow (a tall card pinned in a narrow column overlaps the feed).
        // Collapsed: the one-line header pins to the top, opaque and above the feed cards (z-10).
        collapsed && stickyWhenCollapsed ? "sticky top-0 z-20" : "relative"
      }`}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-amber-500/60" aria-hidden />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {collapsed
          ? <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />}
        <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-600 tabular-nums">
          {note.version}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">{note.title}</span>
        <span className="ml-auto shrink-0 text-xs text-[var(--text-tertiary)]">
          reviewing {note.pending_count} {note.pending_count === 1 ? "item" : "items"}
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-[var(--border-default)] px-4 py-3">
          <LibraryMarkdown markdown={note.markdown} className="text-sm" />
        </div>
      )}
    </div>
  );
}
