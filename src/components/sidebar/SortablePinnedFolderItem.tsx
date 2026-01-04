"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Folder, X } from "lucide-react";
import { PinnedFolder } from "@/lib/pinned-folders";
import { LiveIndicator } from "@/components/ui/LiveIndicator";

interface SortablePinnedFolderItemProps {
  folder: PinnedFolder;
  inboxCount: number;
  activeCount: number;
  hasRunning: boolean;
  isActive: boolean;
  onClick: () => void;
  onUnpin: () => void;
}

/**
 * Sortable pinned folder item with drag handle
 */
export function SortablePinnedFolderItem({
  folder,
  inboxCount,
  activeCount,
  hasRunning,
  isActive,
  onClick,
  onUnpin,
}: SortablePinnedFolderItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Get truncated path for display (remove home directory prefix)
  const displayPath = folder.path.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 px-1 py-1.5 rounded cursor-pointer transition-colors ${
        isDragging
          ? "bg-zinc-700 opacity-50"
          : isActive
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="p-0.5 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Clickable content */}
      <div
        className="flex items-center gap-2 flex-1 min-w-0"
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
      </div>

      {/* Right side: count badges and unpin button */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Inbox (To Do) count - blue (matches column header) */}
        {inboxCount > 0 && (
          <span
            className="text-xs text-blue-400 bg-blue-500/20 px-1.5 py-0.5 rounded"
            title={`${inboxCount} in To Do`}
          >
            {inboxCount}
          </span>
        )}
        {/* Active (In Progress) count - green (matches column header) */}
        {activeCount > 0 && (
          <span
            className="text-xs text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded"
            title={`${activeCount} in progress`}
          >
            {activeCount}
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
