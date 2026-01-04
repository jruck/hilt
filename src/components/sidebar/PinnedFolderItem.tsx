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
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
        <div className="text-xs text-zinc-500 truncate">{displayPath}</div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {sessionCount > 0 && (
          <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
            {sessionCount}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnpin();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-opacity"
          title="Unpin folder"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
