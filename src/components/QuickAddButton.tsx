"use client";

import { Plus } from "lucide-react";

interface QuickAddButtonProps {
  onClick: () => void;
  isCollapsed: boolean;
}

/**
 * Button to open the QuickAdd modal
 * Shows in sidebar footer, adapts to collapsed/expanded state
 */
export function QuickAddButton({ onClick, isCollapsed }: QuickAddButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center justify-center gap-2
        text-[var(--text-secondary)] hover:text-[var(--text-primary)]
        hover:bg-[var(--bg-tertiary)] rounded-md transition-colors
        ${isCollapsed ? "w-8 h-8" : "px-2 h-8 flex-1"}
      `}
      title="Quick Add (Ctrl+I)"
    >
      <Plus className="w-4 h-4 flex-shrink-0" />
      {!isCollapsed && <span className="text-xs font-medium">Quick Add</span>}
    </button>
  );
}
