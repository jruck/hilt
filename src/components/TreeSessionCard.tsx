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
  const isActive = session.status === "active" || session.isRunning;

  return (
    <button
      onClick={onClick}
      className={`
        w-full h-full rounded-lg border
        transition-all duration-150 cursor-pointer
        flex flex-col overflow-hidden text-left
        ${isActive
          ? "border-[var(--status-active-border)] bg-[var(--status-active-bg)] hover:border-[var(--status-active)]"
          : session.status === "inbox"
            ? "border-[var(--status-todo-border)] bg-[var(--status-todo-bg)] hover:border-[var(--status-todo)]"
            : "border-[var(--border-default)] bg-[var(--bg-tertiary)]/80 hover:border-[var(--border-hover)]"
        }
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
          <div className="font-medium text-[var(--text-primary)] line-clamp-2">
            {session.title || session.slug || "Untitled"}
          </div>
          {session.slug && session.title && (
            <div className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
              {session.slug}
            </div>
          )}
        </div>
      </div>

      {/* Last prompt preview */}
      {session.lastPrompt && (
        <div className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-2 flex-1">
          {session.lastPrompt}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] mt-auto">
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
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
          {session.title || session.slug || "session"}
        </span>
      </div>
      <div className="text-xs text-[var(--text-tertiary)] mt-1">
        {session.messageCount} msgs
      </div>
      {session.lastPrompt && (
        <div className="text-xs text-[var(--text-secondary)] truncate mt-1 flex-1">
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
        <span className="text-xs text-[var(--text-secondary)] truncate">
          {(session.title || session.slug || "session").slice(0, 12)}
        </span>
      </div>
    </div>
  );
}

function SessionLevel4({ session }: { session: Session }) {
  const isActive = session.status === "active" || session.isRunning;

  return (
    <div className="flex items-center justify-center h-full">
      {session.isRunning ? (
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      ) : isActive ? (
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
      ) : session.status === "inbox" ? (
        <span className="w-2 h-2 rounded-full bg-blue-400" />
      ) : (
        <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
      )}
    </div>
  );
}
