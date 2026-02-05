"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Pin } from "lucide-react";
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
import { useSidebarState } from "@/hooks/useSidebarState";
import { PinnedFolder } from "@/lib/pinned-folders";
import { SidebarToggle } from "./SidebarToggle";
import { SidebarSection } from "./SidebarSection";
import { SortablePinnedFolderItem } from "./SortablePinnedFolderItem";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface PinnedFoldersHook {
  folders: PinnedFolder[];
  unpinFolder: (id: string) => void;
  reorderFolders: (activeId: string, overId: string) => void;
  setEmoji: (id: string, emoji: string | null) => Promise<void>;
  isHydrated: boolean;
}

interface SidebarProps {
  currentScope: string;
  onScopeChange: (path: string) => void;
  pinnedFolders: PinnedFoldersHook;
}

/**
 * Main collapsible sidebar with pinned folders
 * Fetches inbox counts for pinned folders
 */
export function Sidebar({ currentScope, onScopeChange, pinnedFolders }: SidebarProps) {
  const { isCollapsed, toggle, isHydrated: sidebarHydrated } = useSidebarState();
  const { folders, unpinFolder, reorderFolders, setEmoji, isHydrated: foldersHydrated } = pinnedFolders;

  // Fetch inbox counts for all pinned folders
  const folderPaths = folders.map(f => f.path).join(',');
  const { data: inboxCountsData } = useSWR<{ counts: Record<string, number> }>(
    folderPaths ? `/api/inbox-counts?paths=${encodeURIComponent(folderPaths)}` : null,
    fetcher,
    { refreshInterval: 10000 }
  );
  const inboxCounts = inboxCountsData?.counts ?? {};

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Compute counts per pinned folder from inbox counts
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

  // Determine if we're in a loading/hydrating state
  const isLoading = !sidebarHydrated || !foldersHydrated;

  // During loading, use default expanded state to match server render
  const effectiveCollapsed = isLoading ? false : isCollapsed;

  // Use default expanded width during loading to match server render
  const sidebarWidth = effectiveCollapsed ? 48 : 256;

  // Only enable width transitions after hydration to prevent flash
  const transitionStyle = isLoading
    ? 'background-color var(--theme-transition), border-color var(--theme-transition)'
    : 'width 300ms ease-in-out, background-color var(--theme-transition), border-color var(--theme-transition)';

  return (
    <div
      className="flex-shrink-0 h-full bg-[var(--bg-secondary)] border-r border-[var(--border-default)] flex flex-col overflow-hidden"
      style={{
        width: sidebarWidth,
        transition: transitionStyle
      }}
    >
      {/* Pinned Folders Section */}
      <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${effectiveCollapsed ? "py-2" : "pt-3"}`}>
        <SidebarSection
          title="Pinned"
          icon={Pin}
          defaultExpanded={true}
          isCollapsed={effectiveCollapsed}
          onExpandSidebar={toggle}
        >
          {folders.length === 0 ? (
            <div className="px-2 py-4 text-xs text-[var(--text-tertiary)] text-center">
              Pin folders from the breadcrumbs above
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={folders.map(f => f.id)}
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
                      onClick={() => onScopeChange(folder.path)}
                      onUnpin={() => unpinFolder(folder.id)}
                      onSetEmoji={(emoji) => setEmoji(folder.id, emoji)}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
        </SidebarSection>
      </div>

      {/* Footer with sidebar toggle */}
      <div className="flex-shrink-0 border-t border-[var(--border-default)] flex items-center justify-center px-2 h-11">
        <SidebarToggle isCollapsed={effectiveCollapsed} onToggle={toggle} />
      </div>
    </div>
  );
}
