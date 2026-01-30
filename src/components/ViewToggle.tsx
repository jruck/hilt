"use client";

import { Columns3, Network, FileText, Layers, Terminal, Compass } from "lucide-react";

// The underlying view mode stored in state/preferences
export type ViewMode = "tree" | "board" | "docs" | "stack" | "bridge";

// Primary view categories
export type PrimaryView = "sessions" | "docs" | "stack" | "bridge";

// Task-specific view modes
export type TaskViewMode = "board" | "tree";

// Helper to derive primary view from viewMode
export function getPrimaryView(viewMode: ViewMode): PrimaryView {
  if (viewMode === "board" || viewMode === "tree") return "sessions";
  if (viewMode === "docs") return "docs";
  if (viewMode === "bridge") return "bridge";
  return "stack";
}

// Helper to get task view mode (only valid when primary is "tasks")
export function getTaskViewMode(viewMode: ViewMode): TaskViewMode {
  return viewMode === "tree" ? "tree" : "board";
}

interface PrimaryViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

const PRIMARY_VIEW_CONFIG = [
  { id: "bridge" as const, label: "Bridge", icon: Compass, title: "Bridge weekly tasks & projects", targetMode: "bridge" as ViewMode },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation", targetMode: "docs" as ViewMode },
  { id: "stack" as const, label: "Stack", icon: Layers, title: "Claude configuration stack", targetMode: "stack" as ViewMode },
  { id: "sessions" as const, label: "Sessions", icon: Terminal, title: "Claude Code sessions (Board/Tree)", targetMode: "board" as ViewMode },
];

/**
 * Primary view toggle: Docs | Stack | Sessions
 * When switching to Sessions, preserves the last used session view mode (board/tree)
 */
export function PrimaryViewToggle({ view, onChange }: PrimaryViewToggleProps) {
  const currentPrimary = getPrimaryView(view);
  const currentTaskMode = getTaskViewMode(view);

  const handleChange = (primary: PrimaryView) => {
    if (primary === "sessions") {
      onChange(currentTaskMode);
    } else if (primary === "docs") {
      onChange("docs");
    } else if (primary === "bridge") {
      onChange("bridge");
    } else {
      onChange("stack");
    }
  };

  return (
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
      {PRIMARY_VIEW_CONFIG.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          onClick={() => handleChange(id)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            transition-colors
            ${
              currentPrimary === id
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

interface TaskViewModeToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

/**
 * Single button toggle for task view mode: Board <-> Tree
 * Clicking switches between modes, icon shows the mode it will switch TO
 */
export function TaskViewModeToggle({ view, onChange }: TaskViewModeToggleProps) {
  const currentMode = getTaskViewMode(view);
  // Show the icon for the mode we're switching TO
  const Icon = currentMode === "board" ? Network : Columns3;
  const nextMode = currentMode === "board" ? "tree" : "board";
  const title = currentMode === "board" ? "Switch to Tree view" : "Switch to Board view";

  return (
    <button
      onClick={() => onChange(nextMode)}
      className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
      title={title}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

// Legacy export for backward compatibility during transition
export function ViewToggle({ view, onChange }: PrimaryViewToggleProps) {
  return <PrimaryViewToggle view={view} onChange={onChange} />;
}
