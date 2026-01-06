"use client";

import { Play, MessageSquare, GitBranch } from "lucide-react";
import { Session } from "@/lib/types";

interface TreeSessionCardProps {
  session: Session;
  renderLevel: 1 | 2 | 3 | 4;
  onClick: () => void;
}

export function TreeSessionCard({
  session,
  renderLevel,
  onClick,
}: TreeSessionCardProps) {
  const isRunning = session.isRunning;

  // Status-based border colors
  const statusColors = {
    active: "border-emerald-500/50 bg-emerald-500/5",
    inbox: "border-blue-500/50 bg-blue-500/5",
    recent: "border-zinc-700 bg-zinc-800/80",
  };

  return (
    <button
      onClick={onClick}
      className={`
        w-full h-full rounded-lg border
        ${isRunning ? "border-emerald-500/50 bg-emerald-500/10" : statusColors[session.status]}
        hover:bg-zinc-800 hover:border-zinc-600
        transition-all duration-150 cursor-pointer
        flex flex-col overflow-hidden text-left
      `}
    >
      {renderLevel === 1 && <SessionLevel1 session={session} />}
      {renderLevel === 2 && <SessionLevel2 session={session} />}
      {renderLevel === 3 && <SessionLevel3 session={session} />}
      {renderLevel === 4 && <SessionLevel4 session={session} />}
    </button>
  );
}

function SessionLevel1({ session }: { session: Session }) {
  return (
    <div className="flex flex-col h-full p-3">
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        {session.isRunning && (
          <Play className="w-4 h-4 text-emerald-400 fill-emerald-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-zinc-100 line-clamp-2">
            {session.title || session.slug || "Untitled"}
          </div>
          {session.slug && session.title && (
            <div className="text-xs text-zinc-500 truncate mt-0.5">
              {session.slug}
            </div>
          )}
        </div>
      </div>

      {/* Last prompt preview */}
      {session.lastPrompt && (
        <div className="text-xs text-zinc-400 line-clamp-2 mb-2 flex-1">
          {session.lastPrompt}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-zinc-500 mt-auto">
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {session.messageCount}
        </span>
        {session.gitBranch && (
          <span className="flex items-center gap-1 truncate">
            <GitBranch className="w-3 h-3" />
            <span className="truncate">{session.gitBranch}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function SessionLevel2({ session }: { session: Session }) {
  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center gap-1.5">
        {session.isRunning && (
          <Play className="w-3 h-3 text-emerald-400 fill-emerald-400 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-zinc-100 truncate">
          {session.title || session.slug || "session"}
        </span>
      </div>
      <div className="text-xs text-zinc-500 mt-1">
        {session.messageCount} msgs
      </div>
      {session.lastPrompt && (
        <div className="text-xs text-zinc-400 truncate mt-1 flex-1">
          {session.lastPrompt.slice(0, 50)}
        </div>
      )}
    </div>
  );
}

function SessionLevel3({ session }: { session: Session }) {
  return (
    <div className="flex items-center justify-center h-full p-1">
      <div className="flex items-center gap-1">
        {session.isRunning && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
        )}
        <span className="text-xs text-zinc-300 truncate">
          {(session.title || session.slug || "session").slice(0, 12)}
        </span>
      </div>
    </div>
  );
}

function SessionLevel4({ session }: { session: Session }) {
  // Status indicator colors
  const statusDot = {
    active: "bg-emerald-400",
    inbox: "bg-blue-400",
    recent: "bg-zinc-500",
  };

  return (
    <div
      className={`
        flex items-center justify-center h-full
        ${session.isRunning ? "bg-emerald-500/20" : ""}
      `}
    >
      {session.isRunning ? (
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      ) : (
        <span className={`w-2 h-2 rounded-full ${statusDot[session.status]}`} />
      )}
    </div>
  );
}
