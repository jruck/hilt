"use client";

import { Folder, X } from "lucide-react";
import { PinnedFolder } from "@/lib/pinned-folders";
import { LiveIndicator } from "@/components/ui/LiveIndicator";

interface PinnedFolderItemProps {
  folder: PinnedFolder;
  sessionCount: number;
  hasRunning: boolean;
  isActive: boolean;
  onClick: () => void;
  onUnpin: () => void;
}

/**
 * Individual pinned folder row in sidebar
 */
export function PinnedFolderItem({
  folder,
  sessionCount,
  hasRunning,
  isActive,
  onClick,
  onUnpin,
}: PinnedFolderItemProps) {
  // Get truncated path for display (remove home directory prefix)
  const displayPath = folder.path.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isActive
          ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      }`}
      onClick={onClick}
      title={folder.path}
    >
      <Folder className="w-4 h-4 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm truncate">{folder.name}</span>
          {hasRunning && <LiveIndicator title="Running sessions" />}
        </div>
        <div className="text-xs text-[var(--text-tertiary)] truncate">{displayPath}</div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {sessionCount > 0 && (
          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
            {sessionCount}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnpin();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-opacity"
          title="Unpin folder"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
