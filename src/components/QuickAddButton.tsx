"use client";

import { Plus } from "lucide-react";

interface QuickAddButtonProps {
  onClick: () => void;
}

/**
 * Button to open the QuickAdd modal — compact icon button for toolbar placement
 */
export function QuickAddButton({ onClick }: QuickAddButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      title="Quick Add (Ctrl+I)"
    >
      <Plus className="w-4 h-4 flex-shrink-0" />
      <span className="hidden sm:inline">Quick Add</span>
    </button>
  );
}
