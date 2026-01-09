"use client";

import { Play, MessageSquare, GitBranch, Square, CheckSquare, CheckCircle, Archive, ArchiveRestore } from "lucide-react";
import { Session } from "@/lib/types";

interface TreeSessionCardProps {
  session: Session;
  renderLevel: 1 | 2 | 3 | 4;
  onClick: () => void;
  onSelect?: (session: Session, selected: boolean) => void;
  onDelete?: (session: Session) => void;
  onArchive?: (sessionId: string) => void;
  onUnarchive?: (sessionId: string) => void;
  isSelected?: boolean;
}

export function TreeSessionCard({
  session,
  renderLevel,
  onClick,
  onSelect,
  onDelete,
  onArchive,
  onUnarchive,
  isSelected,
}: TreeSessionCardProps) {
  const isActive = session.status === "active" || !!session.isRunning;

  // Determine if we can show action buttons (only Level 1 and 2 have enough space)
  const canShowActions = renderLevel <= 2;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        transition: 'transform 150ms, box-shadow 150ms, background-color var(--theme-transition), border-color var(--theme-transition), color var(--theme-transition)'
      }}
      className={`
        group relative w-full h-full rounded-lg border
        cursor-pointer
        flex flex-col overflow-hidden text-left
        ${isSelected
          ? "border-[var(--status-todo)] bg-[var(--status-todo-bg)] hover:border-[var(--status-todo)]"
          : session.archived
            ? "border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] opacity-75 hover:opacity-100"
            : isActive
              ? "border-[var(--status-active-border)] bg-[var(--status-active-bg)] hover:border-[var(--status-active)]"
              : session.status === "inbox"
                ? "border-[var(--status-todo-border)] bg-[var(--status-todo-bg)] hover:border-[var(--status-todo)]"
                : "border-[var(--border-default)] bg-[var(--bg-tertiary)]/80 hover:border-[var(--border-hover)]"
        }
      `}
    >
      {/* Action buttons - only shown at larger render levels */}
      {canShowActions && (
        <ActionToolbar
          session={session}
          isSelected={isSelected}
          isActive={isActive}
          onSelect={onSelect}
          onClick={onClick}
          onDelete={onDelete}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
        />
      )}
      {renderLevel === 1 && <SessionLevel1 session={session} />}
      {renderLevel === 2 && <SessionLevel2 session={session} />}
      {renderLevel === 3 && <SessionLevel3 session={session} />}
      {renderLevel === 4 && <SessionLevel4 session={session} />}
    </div>
  );
}

// Floating toolbar for session actions (matches SessionCard)
function ActionToolbar({
  session,
  isSelected,
  isActive,
  onSelect,
  onClick,
  onDelete,
  onArchive,
  onUnarchive,
}: {
  session: Session;
  isSelected?: boolean;
  isActive: boolean;
  onSelect?: (session: Session, selected: boolean) => void;
  onClick: () => void;
  onDelete?: (session: Session) => void;
  onArchive?: (sessionId: string) => void;
  onUnarchive?: (sessionId: string) => void;
}) {
  const hoverBg = isActive
    ? "hover:bg-[var(--toolbar-hover-emerald)]"
    : isSelected
      ? "hover:bg-[var(--toolbar-hover-blue)]"
      : "hover:bg-[var(--toolbar-hover)]";

  return (
    <div
      className={`
        absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1 py-0.5
        rounded-md shadow-lg z-10
        ${isActive
          ? "bg-[var(--toolbar-bg-emerald)] border border-[var(--toolbar-border-emerald)]"
          : isSelected
            ? "bg-[var(--toolbar-bg-blue)] border border-[var(--toolbar-border-blue)]"
            : "bg-[var(--toolbar-bg)] border border-[var(--toolbar-border)]"
        }
        ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
        transition-opacity
      `}
    >
      {onSelect && (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(session, !isSelected); }}
          className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
          title={isSelected ? "Deselect" : "Select"}
        >
          {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-blue-400" /> : <Square className="w-3.5 h-3.5" />}
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
        title="Open session"
      >
        <Play className="w-3.5 h-3.5" />
      </button>
      {session.status !== "recent" && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(session); }}
          className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
          title="Mark as done"
        >
          <CheckCircle className="w-3.5 h-3.5" />
        </button>
      )}
      {session.status === "recent" && !session.archived && onArchive && (
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(session.id); }}
          className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
          title="Archive"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
      )}
      {session.archived && onUnarchive && (
        <button
          onClick={(e) => { e.stopPropagation(); onUnarchive(session.id); }}
          className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
          title="Unarchive"
        >
          <ArchiveRestore className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function SessionLevel1({ session }: { session: Session }) {
  return (
    <div className="flex flex-col h-full p-3">
      {/* Header - with padding for action toolbar */}
      <div className="flex items-start gap-2 mb-2 pr-16">
        {session.isRunning && (
          <Play className="w-4 h-4 text-emerald-400 fill-emerald-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[var(--text-primary)] line-clamp-2">
            {session.title || session.slug || "Untitled"}
          </div>
        </div>
      </div>

      {/* Last prompt preview - only if different from title */}
      {session.lastPrompt && session.lastPrompt !== session.title && (
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
      {/* Title row - with padding for action toolbar */}
      <div className="flex items-center gap-1.5 pr-14">
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
