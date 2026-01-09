"use client";

import { LayoutGrid, Network, FileText, Layers, CheckSquare } from "lucide-react";

// The underlying view mode stored in state/preferences
export type ViewMode = "tree" | "board" | "docs" | "stack";

// Primary view categories
export type PrimaryView = "tasks" | "docs" | "stack";

// Task-specific view modes
export type TaskViewMode = "board" | "tree";

// Helper to derive primary view from viewMode
export function getPrimaryView(viewMode: ViewMode): PrimaryView {
  if (viewMode === "board" || viewMode === "tree") return "tasks";
  if (viewMode === "docs") return "docs";
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
  { id: "tasks" as const, label: "Tasks", icon: CheckSquare, title: "Task management (Board/Tree)", targetMode: "board" as ViewMode },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation", targetMode: "docs" as ViewMode },
  { id: "stack" as const, label: "Stack", icon: Layers, title: "Claude configuration stack", targetMode: "stack" as ViewMode },
];

/**
 * Primary view toggle: Tasks | Docs | Stack
 * When switching to Tasks, preserves the last used task view mode (board/tree)
 */
export function PrimaryViewToggle({ view, onChange }: PrimaryViewToggleProps) {
  const currentPrimary = getPrimaryView(view);
  const currentTaskMode = getTaskViewMode(view);

  const handleChange = (primary: PrimaryView) => {
    if (primary === "tasks") {
      // When switching to tasks, use the current task mode (preserved from last time)
      onChange(currentTaskMode);
    } else if (primary === "docs") {
      onChange("docs");
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

const TASK_VIEW_CONFIG = [
  { id: "board" as const, icon: LayoutGrid, title: "Kanban board" },
  { id: "tree" as const, icon: Network, title: "Tree view" },
];

/**
 * Secondary toggle for task view mode: Board | Tree
 * Compact, icon-only design to fit inline with search/filter
 */
export function TaskViewModeToggle({ view, onChange }: TaskViewModeToggleProps) {
  const currentMode = getTaskViewMode(view);

  return (
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded p-0.5">
      {TASK_VIEW_CONFIG.map(({ id, icon: Icon, title }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`
            p-1.5 rounded transition-colors
            ${
              currentMode === id
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }
          `}
          title={title}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}

// Legacy export for backward compatibility during transition
export function ViewToggle({ view, onChange }: PrimaryViewToggleProps) {
  return <PrimaryViewToggle view={view} onChange={onChange} />;
}
