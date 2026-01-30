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
import { SessionsResponse } from "@/lib/types";
import { PinnedFolder } from "@/lib/pinned-folders";
import { needsAttention } from "@/lib/session-status";
import { SidebarToggle } from "./SidebarToggle";
import { ThemeToggle } from "../ThemeToggle";
import { SidebarSection } from "./SidebarSection";
import { SortablePinnedFolderItem } from "./SortablePinnedFolderItem";
import { QuickAddButton } from "../QuickAddButton";

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
  onQuickAdd?: () => void;
}

/**
 * Main collapsible sidebar with pinned folders
 * Fetches its own session data (unscoped) to compute counts across all pinned folders
 */
export function Sidebar({ currentScope, onScopeChange, pinnedFolders, onQuickAdd }: SidebarProps) {
  const { isCollapsed, toggle, isHydrated: sidebarHydrated } = useSidebarState();
  const { folders, unpinFolder, reorderFolders, setEmoji, isHydrated: foldersHydrated } = pinnedFolders;

  // Fetch ALL sessions (no scope filter) so we can count across all pinned folders
  // Use longer refresh interval (10s) since sidebar counts are less time-critical
  const { data: sessionsData } = useSWR<SessionsResponse>(
    '/api/sessions?page=1&pageSize=500',
    fetcher,
    { refreshInterval: 10000 }
  );
  const allSessions = sessionsData?.sessions ?? [];

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

  // Compute counts per pinned folder from ALL sessions + inbox counts
  // - inboxCount: from batch API for each folder's Todo.md
  // - activeCount: sessions with status "active" that don't need attention
  // - reviewCount: sessions with status "active" that need attention (Review column)
  // - hasRunning: any running sessions in this folder
  const folderStats = useMemo(() => {
    const stats: Record<string, { inboxCount: number; activeCount: number; reviewCount: number; hasRunning: boolean }> = {};

    for (const folder of folders) {
      let activeCount = 0;
      let reviewCount = 0;
      let hasRunning = false;

      // Count active sessions in this exact folder (not subfolders)
      for (const session of allSessions) {
        if (session.projectPath === folder.path && session.status === "active") {
          // Check if session needs attention (goes in Review column)
          const sessionNeedsAttention = session.derivedState && needsAttention(session.derivedState.status);
          if (sessionNeedsAttention) {
            reviewCount++;
          } else {
            activeCount++;
          }
          if (session.isRunning) {
            hasRunning = true;
          }
        }
      }

      // Get inbox count from batch API response
      const inboxCount = inboxCounts[folder.path] ?? 0;

      stats[folder.id] = { inboxCount, activeCount, reviewCount, hasRunning };
    }

    return stats;
  }, [folders, allSessions, inboxCounts]);

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
                  const stats = folderStats[folder.id] || { inboxCount: 0, activeCount: 0, reviewCount: 0, hasRunning: false };
                  return (
                    <SortablePinnedFolderItem
                      key={folder.id}
                      folder={folder}
                      inboxCount={stats.inboxCount}
                      activeCount={stats.activeCount}
                      reviewCount={stats.reviewCount}
                      hasRunning={stats.hasRunning}
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

      {/* Footer with quick add, theme toggle, and sidebar toggle */}
      <div
        className={`flex-shrink-0 border-t border-[var(--border-default)] ${
          effectiveCollapsed
            ? "flex flex-col items-center py-2 gap-1"
            : "flex items-center justify-between px-2 h-11"
        }`}
      >
        {onQuickAdd && (
          <QuickAddButton onClick={onQuickAdd} isCollapsed={effectiveCollapsed} />
        )}
        <ThemeToggle />
        <SidebarToggle isCollapsed={effectiveCollapsed} onToggle={toggle} />
      </div>
    </div>
  );
}
