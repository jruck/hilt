"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Session } from "@/lib/types";
import { useState, useEffect, useMemo } from "react";
import {
  MessageSquare,
  Clock,
  Folder,
  Lock,
  Play,
  CheckCircle,
  Square,
  CheckSquare,
  Star,
  Hash,
  Check,
  FileText,
  Archive,
  ArchiveRestore,
} from "lucide-react";

interface SessionCardProps {
  session: Session;
  onOpen?: (session: Session) => void;
  onOpenPlan?: (session: Session) => void;  // Open session in plan mode
  onDelete?: (session: Session) => void;
  onToggleStarred?: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;  // Archive session
  onUnarchive?: (sessionId: string) => void;  // Unarchive session
  status?: string;  // Dynamic terminal status from Claude Code
  firstSeenAt?: number;  // Timestamp when this session first appeared on the board
  isSelected?: boolean;
  onSelect?: (session: Session, selected: boolean) => void;
  isContinuable?: boolean;  // This session would be resumed by `claude --continue`
  disableDrag?: boolean;  // Disable drag for time-ordered columns like Recent
}

// Duration for the "new" effect to fade (60 seconds)
const NEW_EFFECT_DURATION_MS = 60_000;

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function SessionCard({ session, onOpen, onOpenPlan, onDelete, onToggleStarred, onArchive, onUnarchive, status, firstSeenAt, isSelected, onSelect, isContinuable, disableDrag }: SessionCardProps) {
  const [copiedResume, setCopiedResume] = useState(false);
  // Track current time in state - use lazy initializer to avoid setState in effect
  const [now, setNow] = useState(() => Date.now());

  // Update time periodically while the "new" effect is fading
  useEffect(() => {
    if (!firstSeenAt) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - firstSeenAt;
      if (elapsed >= NEW_EFFECT_DURATION_MS) {
        clearInterval(interval);
      } else {
        setNow(Date.now());
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [firstSeenAt]);

  // Calculate "newness" - how recently this session appeared (0 = not new, 1 = just appeared)
  const newness = useMemo(() => {
    if (!firstSeenAt) return 0;
    const elapsed = now - firstSeenAt;
    if (elapsed >= NEW_EFFECT_DURATION_MS) return 0;
    return 1 - (elapsed / NEW_EFFECT_DURATION_MS);
  }, [firstSeenAt, now]);

  const isNewlyAdded = newness > 0;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id, disabled: disableDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleCopyResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`claude --resume ${session.id}`);
    setCopiedResume(true);
    setTimeout(() => setCopiedResume(false), 1500);
  };

  // Compute glow effect style for newly added cards
  const glowStyle = isNewlyAdded ? {
    boxShadow: `0 0 ${12 * newness}px ${4 * newness}px rgba(34, 197, 94, ${0.4 * newness})`,
  } : {};

  // Corner fold color - matches card's border stroke exactly
  const getFoldColor = () => {
    if (isSelected) return "var(--status-todo)";
    if (session.starred) return "var(--status-starred)";
    if (session.status === "active") return "var(--status-active-border)";
    return "var(--border-default)";
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...glowStyle,
        transition: 'transform 300ms, box-shadow 300ms, background-color var(--theme-transition), border-color var(--theme-transition), color var(--theme-transition)'
      }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(session)}
      title={isContinuable && !isNewlyAdded ? "Most recent - will be resumed by 'claude --continue'" : undefined}
      className={`
        group relative border rounded-lg p-3 overflow-hidden
        cursor-pointer
        ${isDragging ? "shadow-xl ring-2 ring-[var(--status-active)]" : "shadow-sm"}
        ${isNewlyAdded
          ? "border-[var(--status-active)] bg-[var(--status-active-bg)]"
          : isSelected
            ? "border-[var(--status-todo)] bg-[var(--status-todo-bg)] hover:border-[var(--status-todo)]"
            : session.archived
              ? "border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] opacity-75 hover:opacity-100"
              : session.starred
                ? "border-[var(--status-starred)] bg-[var(--status-starred-bg)] hover:border-[var(--status-starred)]"
                : session.status === "active"
                  ? "border-[var(--status-active-border)] bg-[var(--status-active-bg)] hover:border-[var(--status-active)]"
                  : "border-[var(--border-default)] bg-[var(--bg-tertiary)] hover:border-[var(--border-hover)]"
        }
      `}
    >
      {/* Corner fold for continuable session */}
      {isContinuable && !isNewlyAdded && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3"
          style={{
            background: `linear-gradient(135deg, transparent 50%, ${getFoldColor()} 50%)`,
          }}
        />
      )}
      {/* Hover actions - floating toolbar */}
      {(() => {
        const hoverBg = isNewlyAdded || session.status === "active"
          ? "hover:bg-[var(--toolbar-hover-emerald)]"
          : isSelected
            ? "hover:bg-[var(--toolbar-hover-blue)]"
            : "hover:bg-[var(--toolbar-hover)]";
        return (
          <div
            className={`
              absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1 py-0.5
              rounded-md shadow-lg
              ${isNewlyAdded
                ? "bg-[var(--toolbar-bg-emerald)] border border-[var(--toolbar-border-emerald)]"
                : isSelected
                  ? "bg-[var(--toolbar-bg-blue)] border border-[var(--toolbar-border-blue)]"
                  : session.status === "active"
                    ? "bg-[var(--toolbar-bg-emerald)] border border-[var(--toolbar-border-emerald)]"
                    : "bg-[var(--toolbar-bg)] border border-[var(--toolbar-border)]"
              }
              ${isSelected || session.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
              transition-opacity
            `}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onSelect?.(session, !isSelected); }}
              className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
              title={isSelected ? "Deselect" : "Select"}
            >
              {isSelected ? <CheckSquare className="w-4 h-4 text-blue-400" /> : <Square className="w-4 h-4" />}
            </button>
            {session.status === "recent" && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleStarred?.(session.id); }}
                className={`p-1 ${hoverBg} rounded transition-colors ${
                  session.starred ? "text-yellow-400" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title={session.starred ? "Unstar" : "Star"}
              >
                <Star className={`w-4 h-4 ${session.starred ? "fill-current" : ""}`} />
              </button>
            )}
            {session.status === "recent" && !session.archived && onArchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(session.id); }}
                className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
                title="Archive"
              >
                <Archive className="w-4 h-4" />
              </button>
            )}
            {session.archived && onUnarchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onUnarchive(session.id); }}
                className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
                title="Unarchive"
              >
                <ArchiveRestore className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onOpen?.(session); }}
              className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
              title="Open session"
            >
              <Play className="w-4 h-4" />
            </button>
            {session.status !== "recent" && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete?.(session); }}
                className={`p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${hoverBg} rounded transition-colors`}
                title="Mark as done"
              >
                <CheckCircle className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })()}

      {/* Title */}
      <div className="flex items-center gap-1.5 pr-20">
        {/* Live indicator - pulsing dot for running sessions */}
        {session.isRunning && (
          <span className="relative flex h-2 w-2 flex-shrink-0" title="Session is running">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        )}
        <h3 className="text-sm font-medium text-[var(--text-primary)] truncate flex-1" title={session.title}>
          {session.title}
        </h3>
        {session.isolation?.enabled && (
          <span title="Isolated session">
            <Lock className="w-3 h-3 text-blue-400 flex-shrink-0" />
          </span>
        )}
        {session.isNew && (
          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded flex-shrink-0">
            NEW
          </span>
        )}
      </div>

      {/* Status - dynamic terminal title from Claude */}
      {status && (
        <p className="text-xs text-emerald-400 font-medium truncate mt-1">{status}</p>
      )}

      {/* Last Prompt */}
      {session.lastPrompt && session.lastPrompt !== session.title && (
        <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
          {session.lastPrompt}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-[var(--text-tertiary)]">
        <button
          onClick={(e) => {
            e.stopPropagation();
            fetch('/api/reveal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: session.projectPath })
            }).catch(console.error);
          }}
          className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
          title="Open in Finder"
        >
          <Folder className="w-3 h-3" />
          {session.project}
        </button>

        <button
          onClick={handleCopyResume}
          className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
          title="Copy resume command"
        >
          <Hash className="w-3 h-3" />
          <span className="font-mono text-[11px]">{session.id.slice(0, 8)}</span>
          {copiedResume && <Check className="w-3 h-3 text-emerald-400" />}
        </button>

        {session.planSlugs && session.planSlugs.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenPlan?.(session); }}
            className="flex items-center gap-0.5 hover:text-[var(--text-secondary)] transition-colors"
            title="Open in plan mode"
          >
            <FileText className="w-3 h-3" />
            {session.planSlugs.length > 1 && (
              <span className="text-[10px]">{session.planSlugs.length}</span>
            )}
          </button>
        )}

        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {session.messageCount}
        </span>

        <span className={`flex items-center gap-1 ${isNewlyAdded ? "text-emerald-400 font-medium" : ""}`}>
          <Clock className={`w-3 h-3 ${isNewlyAdded ? "text-emerald-400" : ""}`} />
          {isNewlyAdded ? "NEW" : formatRelativeTime(new Date(session.lastActivity))}
        </span>
      </div>
    </div>
  );
}
