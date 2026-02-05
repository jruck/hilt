"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Pin } from "lucide-react";
import useSWR from "swr";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PinnedFolder } from "@/lib/pinned-folders";
import { SortablePinnedFolderItem } from "@/components/sidebar/SortablePinnedFolderItem";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface PinnedFoldersHook {
  folders: PinnedFolder[];
  unpinFolder: (id: string) => void;
  reorderFolders: (activeId: string, overId: string) => void;
  setEmoji: (id: string, emoji: string | null) => Promise<void>;
  isHydrated: boolean;
}

interface PinnedFoldersPopoverProps {
  currentScope: string;
  onScopeChange: (path: string) => void;
  pinnedFolders: PinnedFoldersHook;
}

export function PinnedFoldersPopover({
  currentScope,
  onScopeChange,
  pinnedFolders,
}: PinnedFoldersPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { folders, unpinFolder, reorderFolders, setEmoji } = pinnedFolders;

  // Fetch inbox counts for all pinned folders
  const folderPaths = folders.map((f) => f.path).join(",");
  const { data: inboxCountsData } = useSWR<{ counts: Record<string, number> }>(
    isOpen && folderPaths
      ? `/api/inbox-counts?paths=${encodeURIComponent(folderPaths)}`
      : null,
    fetcher,
    { refreshInterval: 10000 }
  );
  const inboxCounts = inboxCountsData?.counts ?? {};

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Compute counts per pinned folder
  const folderStats = useMemo(() => {
    const stats: Record<string, { inboxCount: number }> = {};

    for (const folder of folders) {
      const inboxCount = inboxCounts[folder.path] ?? 0;
      stats[folder.id] = { inboxCount };
    }

    return stats;
  }, [folders, inboxCounts]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderFolders(active.id as string, over.id as string);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleFolderClick = (path: string) => {
    onScopeChange(path);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`p-1.5 rounded transition-colors ${
          isOpen
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        }`}
        title="Pinned folders"
      >
        <Pin className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full mb-1 left-0 w-[300px] bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg shadow-xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[var(--border-default)]">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
              Pinned Folders
            </span>
          </div>

          <div className="max-h-[400px] overflow-y-auto p-1">
            {folders.length === 0 ? (
              <p className="px-2 py-4 text-xs text-[var(--text-tertiary)] text-center">
                Pin folders from the breadcrumbs above
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={folders.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {folders.map((folder) => {
                    const stats = folderStats[folder.id] || { inboxCount: 0 };
                    return (
                      <SortablePinnedFolderItem
                        key={folder.id}
                        folder={folder}
                        inboxCount={stats.inboxCount}
                        activeCount={0}
                        reviewCount={0}
                        hasRunning={false}
                        isActive={currentScope === folder.path}
                        onClick={() => handleFolderClick(folder.path)}
                        onUnpin={() => unpinFolder(folder.id)}
                        onSetEmoji={(emoji) => setEmoji(folder.id, emoji)}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
