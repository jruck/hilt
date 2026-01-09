"use client";

import { LayoutGrid, Network, FileText, Layers } from "lucide-react";

export type ViewMode = "tree" | "board" | "docs" | "stack";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

const VIEW_CONFIG = [
  { id: "tree" as const, label: "Tree", icon: Network, title: "Tree view (folders as treemap)" },
  { id: "board" as const, label: "Board", icon: LayoutGrid, title: "Kanban board view" },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation" },
  { id: "stack" as const, label: "Stack", icon: Layers, title: "Claude configuration stack" },
];

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
      {VIEW_CONFIG.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            transition-colors
            ${
              view === id
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }
          `}
          title={title}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
