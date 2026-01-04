"use client";

import { useState, ReactNode } from "react";
import { ChevronDown, ChevronRight, LucideIcon } from "lucide-react";

interface SidebarSectionProps {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  defaultExpanded?: boolean;
  isCollapsed?: boolean;
}

/**
 * Reusable collapsible section wrapper for sidebar
 */
export function SidebarSection({
  title,
  icon: Icon,
  children,
  defaultExpanded = true,
  isCollapsed = false,
}: SidebarSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // When sidebar is collapsed, just show the icon
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="p-2 text-zinc-400" title={title}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-400 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <Icon className="w-3.5 h-3.5" />
        <span>{title}</span>
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}
