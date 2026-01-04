"use client";

import { useMemo } from "react";
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
import { Session } from "@/lib/types";
import { PinnedFolder } from "@/lib/pinned-folders";
import { SidebarToggle } from "./SidebarToggle";
import { SidebarSection } from "./SidebarSection";
import { SortablePinnedFolderItem } from "./SortablePinnedFolderItem";

interface PinnedFoldersHook {
  folders: PinnedFolder[];
  unpinFolder: (id: string) => void;
  reorderFolders: (activeId: string, overId: string) => void;
  isHydrated: boolean;
}

interface InboxItem {
  id: string;
  prompt: string;
  completed: boolean;
  section: string | null;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

interface SidebarProps {
  sessions: Session[];
  inboxItems: InboxItem[];  // Inbox items for current scope
  currentScope: string;
  onScopeChange: (path: string) => void;
  pinnedFolders: PinnedFoldersHook;
}

/**
 * Main collapsible sidebar with pinned folders
 */
export function Sidebar({ sessions, inboxItems, currentScope, onScopeChange, pinnedFolders }: SidebarProps) {
  const { isCollapsed, toggle, isHydrated: sidebarHydrated } = useSidebarState();
  const { folders, unpinFolder, reorderFolders, isHydrated: foldersHydrated } = pinnedFolders;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Compute counts per pinned folder
  // - inboxCount: from inbox items (To Do) - only available for current scope
  // - activeCount: from sessions with status "active" (In Progress)
  const folderStats = useMemo(() => {
    const stats: Record<string, { inboxCount: number; activeCount: number; hasRunning: boolean }> = {};

    for (const folder of folders) {
      let inboxCount = 0;
      let activeCount = 0;
      let hasRunning = false;

      // Count inbox items - only for the folder matching current scope
      // (we only have inbox data for the currently viewed scope)
      if (folder.path === currentScope || currentScope.startsWith(folder.path + "/")) {
        // If viewing this folder or a subfolder, count all inbox items
        if (folder.path === currentScope) {
          inboxCount = inboxItems.length;
        }
        // If viewing a subfolder of this pinned folder, we can't show accurate count
        // (would need to fetch that folder's Todo.md separately)
      }

      // Count active sessions under this folder
      for (const session of sessions) {
        if (session.projectPath?.startsWith(folder.path) && session.status === "active") {
          activeCount++;
          if (session.isRunning) {
            hasRunning = true;
          }
        }
      }

      stats[folder.id] = { inboxCount, activeCount, hasRunning };
    }

    return stats;
  }, [folders, sessions, inboxItems, currentScope]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderFolders(active.id as string, over.id as string);
    }
  };

  // Don't render until hydrated to prevent flash
  if (!sidebarHydrated || !foldersHydrated) {
    return (
      <div
        className="flex-shrink-0 bg-zinc-900 border-r border-zinc-700 transition-all duration-300"
        style={{ width: 256 }}
      />
    );
  }

  return (
    <div
      className="flex-shrink-0 bg-zinc-900 border-r border-zinc-700 transition-all duration-300 flex flex-col"
      style={{ width: isCollapsed ? 48 : 256 }}
    >
      {/* Header with toggle */}
      <div
        className={`flex items-center h-11 border-b border-zinc-800 ${
          isCollapsed ? "justify-center px-0" : "justify-end px-2"
        }`}
      >
        <SidebarToggle isCollapsed={isCollapsed} onToggle={toggle} />
      </div>

      {/* Pinned Folders Section */}
      <div className="flex-1 overflow-y-auto">
        <SidebarSection
          title="Pinned"
          icon={Pin}
          defaultExpanded={true}
          isCollapsed={isCollapsed}
        >
          {folders.length === 0 ? (
            <div className="px-2 py-4 text-xs text-zinc-500 text-center">
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
                  const stats = folderStats[folder.id] || { inboxCount: 0, activeCount: 0, hasRunning: false };
                  return (
                    <SortablePinnedFolderItem
                      key={folder.id}
                      folder={folder}
                      inboxCount={stats.inboxCount}
                      activeCount={stats.activeCount}
                      hasRunning={stats.hasRunning}
                      isActive={currentScope === folder.path}
                      onClick={() => onScopeChange(folder.path)}
                      onUnpin={() => unpinFolder(folder.id)}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
        </SidebarSection>
      </div>
    </div>
  );
}
