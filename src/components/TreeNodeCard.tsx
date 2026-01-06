"use client";

import { Folder, Play, Circle } from "lucide-react";
import { TreeNode, Session } from "@/lib/types";
import { getDisplaySessions } from "@/lib/tree-utils";

interface TreeNodeCardProps {
  node: TreeNode;
  renderLevel: 1 | 2 | 3 | 4;
  onClick: () => void;
  onOpenSession: (sessionId: string) => void;
}

export function TreeNodeCard({
  node,
  renderLevel,
  onClick,
  onOpenSession,
}: TreeNodeCardProps) {
  const { metrics } = node;
  const hasRunning = metrics.runningCount > 0;

  return (
    <button
      onClick={onClick}
      className={`
        w-full h-full rounded-lg border border-zinc-700
        bg-zinc-800/80 hover:bg-zinc-750 hover:border-zinc-600
        transition-all duration-150 cursor-pointer
        flex flex-col overflow-hidden text-left
        ${hasRunning ? "ring-1 ring-emerald-500/50" : ""}
      `}
    >
      {renderLevel === 1 && (
        <Level1Content node={node} onOpenSession={onOpenSession} />
      )}
      {renderLevel === 2 && <Level2Content node={node} />}
      {renderLevel === 3 && <Level3Content node={node} />}
      {renderLevel === 4 && <Level4Content node={node} />}
    </button>
  );
}

// Level 1: Full detail with session thumbnails
function Level1Content({
  node,
  onOpenSession,
}: {
  node: TreeNode;
  onOpenSession: (id: string) => void;
}) {
  const { metrics } = node;
  const displaySessions = getDisplaySessions(node, 6);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-zinc-700/50">
        <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-zinc-100 truncate">{node.name}</div>
          <div className="text-xs text-zinc-500 truncate">{node.path}</div>
        </div>
      </div>

      {/* Session thumbnails */}
      {displaySessions.length > 0 && (
        <div className="flex-1 p-2 grid grid-cols-2 gap-1.5 overflow-hidden">
          {displaySessions.map((session) => (
            <SessionThumbnail
              key={session.id}
              session={session}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSession(session.id);
              }}
            />
          ))}
        </div>
      )}

      {/* Footer metrics */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-zinc-700/50 text-xs">
        {metrics.activeCount > 0 && (
          <span className="flex items-center gap-1 text-emerald-400">
            <Circle className="w-2 h-2 fill-current" />
            {metrics.activeCount} active
          </span>
        )}
        {metrics.inboxCount > 0 && (
          <span className="flex items-center gap-1 text-blue-400">
            <Circle className="w-2 h-2" />
            {metrics.inboxCount} todo
          </span>
        )}
        {metrics.recentCount > 0 && (
          <span className="flex items-center gap-1 text-zinc-500">
            {metrics.recentCount} recent
          </span>
        )}
        {metrics.totalSessions === 0 && (
          <span className="text-zinc-500">Empty</span>
        )}
      </div>
    </>
  );
}

// Level 2: Medium - name, pills, counts
function Level2Content({ node }: { node: TreeNode }) {
  const { metrics } = node;
  const displaySessions = getDisplaySessions(node, 3);

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center gap-1.5 mb-2">
        <Folder className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        <span className="font-medium text-sm text-zinc-100 truncate">
          {node.name}
        </span>
      </div>

      {/* Session pills */}
      {displaySessions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 flex-1 overflow-hidden">
          {displaySessions.map((s) => (
            <span
              key={s.id}
              className={`
                text-xs px-1.5 py-0.5 rounded truncate max-w-[80px]
                ${
                  s.isRunning
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-zinc-700 text-zinc-300"
                }
              `}
            >
              {s.title || s.slug || "session"}
            </span>
          ))}
        </div>
      )}

      {/* Compact metrics */}
      <div className="mt-auto flex items-center gap-2 text-xs">
        {metrics.activeCount > 0 && (
          <span className="text-emerald-400">●{metrics.activeCount}</span>
        )}
        {metrics.inboxCount > 0 && (
          <span className="text-blue-400">○{metrics.inboxCount}</span>
        )}
        {metrics.activeCount === 0 && metrics.inboxCount === 0 && (
          <span className="text-zinc-500">{metrics.totalSessions}</span>
        )}
      </div>
    </div>
  );
}

// Level 3: Small - name and counts only
function Level3Content({ node }: { node: TreeNode }) {
  const { metrics } = node;

  return (
    <div className="flex flex-col items-center justify-center h-full p-1.5 text-center">
      <span className="text-xs font-medium text-zinc-200 truncate w-full">
        {node.name}
      </span>
      <div className="flex items-center gap-1.5 mt-1 text-xs">
        {metrics.runningCount > 0 && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
        {metrics.activeCount > 0 && (
          <span className="text-emerald-400">●{metrics.activeCount}</span>
        )}
        {metrics.inboxCount > 0 && (
          <span className="text-blue-400">○{metrics.inboxCount}</span>
        )}
        {metrics.activeCount === 0 && metrics.inboxCount === 0 && (
          <span className="text-zinc-500">{metrics.totalSessions}</span>
        )}
      </div>
    </div>
  );
}

// Level 4: Tiny - just name or initial
function Level4Content({ node }: { node: TreeNode }) {
  const { metrics } = node;
  const hasActivity = metrics.runningCount > 0 || metrics.activeCount > 0;

  return (
    <div
      className={`
      flex items-center justify-center h-full p-1 gap-1
      ${hasActivity ? "text-emerald-400" : "text-zinc-400"}
    `}
    >
      {metrics.runningCount > 0 && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
      )}
      <span className="text-xs font-medium truncate">
        {node.name.length > 8 ? node.name.slice(0, 6) + "…" : node.name}
      </span>
    </div>
  );
}

// Session thumbnail for Level 1
function SessionThumbnail({
  session,
  onClick,
}: {
  session: Session;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        p-1.5 rounded text-left text-xs
        bg-zinc-700/50 hover:bg-zinc-700
        border border-zinc-600/50 hover:border-zinc-500
        transition-colors
        ${session.isRunning ? "ring-1 ring-emerald-500" : ""}
      `}
    >
      <div className="flex items-center gap-1">
        {session.isRunning && (
          <Play className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400 flex-shrink-0" />
        )}
        <span className="truncate text-zinc-200">
          {session.title || session.slug || "session"}
        </span>
      </div>
    </button>
  );
}
