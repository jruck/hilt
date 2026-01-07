"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { TreeNode, Session } from "@/lib/types";
import {
  layoutTreemap,
  prepareLayoutItems,
  isSessionNode,
  TreemapRect,
} from "@/lib/treemap-layout";
import { TreeNodeCard } from "./TreeNodeCard";
import { TreeSessionCard } from "./TreeSessionCard";
import { Loader2 } from "lucide-react";

interface TreeViewProps {
  tree: TreeNode | null;
  scopePath: string;
  onNavigate: (path: string) => void;
  onOpenSession: (session: Session) => void;
  isLoading?: boolean;
  // Session action callbacks
  onSelectSession?: (session: Session, selected: boolean) => void;
  onDeleteSession?: (session: Session) => void;
  onArchiveSession?: (sessionId: string) => void;
  onUnarchiveSession?: (sessionId: string) => void;
  selectedSessionIds?: Set<string>;
}

export function TreeView({
  tree,
  scopePath,
  onNavigate,
  onOpenSession,
  isLoading,
  onSelectSession,
  onDeleteSession,
  onArchiveSession,
  onUnarchiveSession,
  selectedSessionIds,
}: TreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate layout when dimensions or tree changes
  const rects = useMemo(() => {
    if (!tree || dimensions.width === 0 || dimensions.height === 0) {
      return [];
    }

    // Prepare items for layout (child folders + direct sessions)
    const itemsToLayout = prepareLayoutItems(tree);

    if (itemsToLayout.length === 0) {
      return [];
    }

    return layoutTreemap(itemsToLayout, {
      width: dimensions.width,
      height: dimensions.height,
      padding: 8,
      minWidth: 60,
      minHeight: 40,
    });
  }, [tree, dimensions.width, dimensions.height]);

  // Handle click on a rectangle
  const handleRectClick = (rect: TreemapRect) => {
    if (isSessionNode(rect.node)) {
      // It's a session pseudo-node - open the session
      const session = rect.node.sessions[0];
      if (session) {
        onOpenSession(session);
      }
    } else {
      // It's a folder - navigate to it
      onNavigate(rect.node.path);
    }
  };

  // Handle opening a session from within a folder card
  const handleOpenSessionFromCard = (sessionId: string) => {
    if (!tree) return;

    // Find the session in the tree
    const session = findSessionInTree(tree, sessionId);
    if (session) {
      onOpenSession(session);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 relative bg-[var(--bg-secondary)] overflow-hidden rounded-lg"
    >
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-[var(--bg-secondary)]/50 flex items-center justify-center z-10">
          <Loader2 className="w-6 h-6 text-[var(--text-secondary)] animate-spin" />
        </div>
      )}

      {/* Treemap rectangles */}
      {rects.map((rect) => (
        <div
          key={rect.node.path}
          className="absolute transition-all duration-300 ease-out"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          {isSessionNode(rect.node) ? (
            // Session card
            <TreeSessionCard
              session={rect.node.sessions[0]}
              renderLevel={rect.renderLevel}
              onClick={() => handleRectClick(rect)}
              onSelect={onSelectSession}
              onDelete={onDeleteSession}
              onArchive={onArchiveSession}
              onUnarchive={onUnarchiveSession}
              isSelected={selectedSessionIds?.has(rect.node.sessions[0].id)}
            />
          ) : (
            // Folder card
            <TreeNodeCard
              node={rect.node}
              renderLevel={rect.renderLevel}
              onClick={() => handleRectClick(rect)}
              onOpenSession={handleOpenSessionFromCard}
            />
          )}
        </div>
      ))}

      {/* Empty state */}
      {!isLoading && tree && rects.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] gap-2">
          <span className="text-lg">No sessions in this scope</span>
          <span className="text-sm">
            {scopePath
              ? `No sessions found under ${scopePath}`
              : "No sessions found across all projects"}
          </span>
        </div>
      )}

      {/* No tree yet (initial load) */}
      {!isLoading && !tree && (
        <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
    </div>
  );
}

// Helper to find a session by ID anywhere in the tree
function findSessionInTree(node: TreeNode, sessionId: string): Session | null {
  // Check direct sessions
  for (const session of node.sessions) {
    if (session.id === sessionId) {
      return session;
    }
  }

  // Check children recursively
  for (const child of node.children) {
    const found = findSessionInTree(child, sessionId);
    if (found) return found;
  }

  return null;
}
