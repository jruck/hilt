"use client";

import { useState, useRef, useEffect } from "react";
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
  onSetEmoji: (emoji: string | null) => void;
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
  onSetEmoji,
}: SortablePinnedFolderItemProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiInput, setEmojiInput] = useState(folder.emoji || "");
  const emojiInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id });

  // Focus input when picker opens
  useEffect(() => {
    if (showEmojiPicker && emojiInputRef.current) {
      emojiInputRef.current.focus();
    }
  }, [showEmojiPicker]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showEmojiPicker]);

  const handleEmojiSubmit = () => {
    const trimmed = emojiInput.trim();
    if (trimmed !== (folder.emoji || "")) {
      onSetEmoji(trimmed || null);
    }
    setShowEmojiPicker(false);
  };

  const handleEmojiKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEmojiSubmit();
    } else if (e.key === "Escape") {
      setEmojiInput(folder.emoji || "");
      setShowEmojiPicker(false);
    }
  };

  const handleIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEmojiInput(folder.emoji || "");
    setShowEmojiPicker(true);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Get concise path showing just 2 levels up from folder (parent/grandparent)
  // Uses "..." when levels are skipped to avoid misleading display
  // e.g., /Users/jruck/Bridge/Libraries/Personal/Process -> ~/.../Libraries/Personal
  // e.g., /Users/jruck/Bridge/Tools -> ~/Bridge
  const getShortPath = (fullPath: string): string => {
    // Remove home directory prefix first
    const homePath = fullPath.replace(/^\/Users\/[^/]+\/?/, "");
    if (!homePath) return "~";

    const parts = homePath.split("/").filter(Boolean);
    if (parts.length <= 1) return "~"; // Folder is directly in home

    // Take up to 2 levels above the folder name
    const parentParts = parts.slice(0, -1); // All except folder itself
    const relevantParts = parentParts.slice(-2); // Last 2 parent levels

    // Use "..." prefix if we're skipping levels
    const prefix = parentParts.length > 2 ? "~/.../": "~/";
    return prefix + relevantParts.join("/");
  };
  const displayPath = getShortPath(folder.path);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 px-1 py-1.5 rounded cursor-pointer transition-colors ${
        isDragging
          ? "bg-[var(--bg-tertiary)] opacity-50"
          : isActive
          ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="p-0.5 cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Clickable content */}
      <div
        className="flex items-center gap-2 flex-1 min-w-0"
        onClick={onClick}
        title={folder.path}
      >
        {/* Icon/emoji with picker */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={handleIconClick}
            className="w-5 h-5 flex items-center justify-center flex-shrink-0 rounded hover:bg-[var(--bg-elevated)] transition-colors"
            title="Click to set emoji"
          >
            {folder.emoji ? (
              <span className="text-sm leading-none">{folder.emoji}</span>
            ) : (
              <Folder className="w-4 h-4" />
            )}
          </button>

          {/* Emoji picker popover */}
          {showEmojiPicker && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg p-2">
              <input
                ref={emojiInputRef}
                type="text"
                value={emojiInput}
                onChange={(e) => setEmojiInput(e.target.value)}
                onKeyDown={handleEmojiKeyDown}
                onBlur={handleEmojiSubmit}
                placeholder="🗂️"
                className="w-16 px-2 py-1 text-center text-lg bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--interactive-default)]"
                maxLength={4}
              />
              <div className="text-[10px] text-[var(--text-tertiary)] mt-1 text-center whitespace-nowrap">
                ⌘⌃Space for picker
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm truncate">{folder.name}</span>
            {hasRunning && <LiveIndicator title="Running sessions" />}
          </div>
          <div className="text-xs text-[var(--text-tertiary)] truncate">{displayPath}</div>
        </div>
      </div>

      {/* Right side: count badges and unpin button */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Inbox (To Do) count - blue (matches column header) */}
        {inboxCount > 0 && (
          <span
            className="text-xs text-[var(--status-todo)] bg-[var(--status-todo-bg)] px-1.5 py-0.5 rounded"
            title={`${inboxCount} in To Do`}
          >
            {inboxCount}
          </span>
        )}
        {/* Active (In Progress) count - green (matches column header) */}
        {activeCount > 0 && (
          <span
            className="text-xs text-[var(--status-active)] bg-[var(--status-active-bg)] px-1.5 py-0.5 rounded"
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
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-opacity"
          title="Unpin folder"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
