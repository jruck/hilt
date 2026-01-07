"use client";

import { LayoutGrid, Network, FileText } from "lucide-react";

export type ViewMode = "tree" | "board" | "docs";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
      <button
        onClick={() => onChange("tree")}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
          transition-colors
          ${
            view === "tree"
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }
        `}
        title="Tree view (folders as treemap)"
      >
        <Network className="w-4 h-4" />
        <span className="hidden sm:inline">Tree</span>
      </button>
      <button
        onClick={() => onChange("board")}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
          transition-colors
          ${
            view === "board"
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }
        `}
        title="Kanban board view"
      >
        <LayoutGrid className="w-4 h-4" />
        <span className="hidden sm:inline">Board</span>
      </button>
      <button
        onClick={() => onChange("docs")}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
          transition-colors
          ${
            view === "docs"
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }
        `}
        title="Documentation"
      >
        <FileText className="w-4 h-4" />
        <span className="hidden sm:inline">Docs</span>
      </button>
    </div>
  );
}
