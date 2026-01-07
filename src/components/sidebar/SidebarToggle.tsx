"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface SidebarToggleProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

/**
 * Collapse/expand button for sidebar
 */
export function SidebarToggle({ isCollapsed, onToggle }: SidebarToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="p-1.5 rounded transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
      title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {isCollapsed ? (
        <ChevronRight className="w-4 h-4" />
      ) : (
        <ChevronLeft className="w-4 h-4" />
      )}
    </button>
  );
}
