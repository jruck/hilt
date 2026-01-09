"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Session, DerivedStatus } from "@/lib/types";
import { needsAttention } from "@/lib/session-status";
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
  Loader2,
  AlertCircle,
  MessageCircle,
} from "lucide-react";

interface SessionCardProps {
  session: Session;
  scopePath?: string;  // Current scope path - hide folder if same as session.projectPath
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

// Status badge configuration for derived states
const STATUS_BADGE_CONFIG: Record<DerivedStatus, { label: string; icon: React.ReactNode } | null> = {
  working: {
    label: "Working",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  waiting_for_approval: {
    label: "Needs Approval",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  waiting_for_input: {
    label: "Waiting",
    icon: <MessageCircle className="w-3 h-3" />,
  },
  idle: null, // Don't show badge for idle
};

/**
 * Format elapsed time as a ticking timer
 * - Seconds: "5s", "45s"
 * - Minutes: "1m", "5m 30s", "45m"
 * - Hours: "1h", "2h 15m"
 * - Days: "1d", "3d 5h"
 */
function formatElapsedTimer(elapsedMs: number): string {
  // Handle edge case where lastActivityTime is slightly ahead of now
  if (elapsedMs < 0) return "0s";

  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMins = minutes % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

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

export function SessionCard({ session, scopePath, onOpen, onOpenPlan, onDelete, onToggleStarred, onArchive, onUnarchive, status, firstSeenAt, isSelected, onSelect, isContinuable, disableDrag }: SessionCardProps) {
  const [copiedResume, setCopiedResume] = useState(false);
  // Track current time in state - use lazy initializer to avoid setState in effect
  const [now, setNow] = useState(() => Date.now());

  // Determine if we need a ticking timer (for status badge elapsed time)
  const hasStatusTimer = session.derivedState?.status &&
    STATUS_BADGE_CONFIG[session.derivedState.status] !== null &&
    session.derivedState.lastActivityTime;

  // Update time periodically:
  // 1. While the "new" effect is fading (first 60s)
  // 2. While session has a status badge showing elapsed time
  useEffect(() => {
    const needsNewEffect = firstSeenAt && (Date.now() - firstSeenAt < NEW_EFFECT_DURATION_MS);

    if (!needsNewEffect && !hasStatusTimer) return;

    const interval = setInterval(() => {
      setNow(Date.now());

      // Stop interval if no longer needed for either purpose
      const stillNeedsNewEffect = firstSeenAt && (Date.now() - firstSeenAt < NEW_EFFECT_DURATION_MS);
      if (!stillNeedsNewEffect && !hasStatusTimer) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [firstSeenAt, hasStatusTimer]);

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

  // Check if session needs attention (used for glow and other styling)
  const sessionNeedsAttention = session.derivedState && needsAttention(session.derivedState.status);

  // Compute glow effect style for newly added cards
  // Use amber glow for cards needing attention, green for normal active cards
  const glowColor = sessionNeedsAttention
    ? `rgba(245, 158, 11, ${0.4 * newness})`  // amber-500
    : `rgba(34, 197, 94, ${0.4 * newness})`;   // emerald-500
  const glowStyle = isNewlyAdded ? {
    boxShadow: `0 0 ${12 * newness}px ${4 * newness}px ${glowColor}`,
  } : {};

  // Corner fold color - matches card's border stroke exactly
  const getFoldColor = () => {
    if (isSelected) return "var(--status-todo)";
    if (sessionNeedsAttention) return "rgb(245 158 11 / 0.5)"; // amber-500/50
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
        ${sessionNeedsAttention
          ? "border-amber-500/50 bg-amber-500/5 hover:border-amber-500"
          : isNewlyAdded
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
        // Priority: sessionNeedsAttention > isNewlyAdded > isSelected > active > default
        const hoverBg = sessionNeedsAttention
          ? "hover:bg-amber-500/20"
          : isNewlyAdded
            ? "hover:bg-[var(--toolbar-hover-emerald)]"
            : isSelected
              ? "hover:bg-[var(--toolbar-hover-blue)]"
              : session.status === "active"
                ? "hover:bg-[var(--toolbar-hover-emerald)]"
                : "hover:bg-[var(--toolbar-hover)]";
        return (
          <div
            className={`
              absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1 py-0.5
              rounded-md shadow-lg
              ${sessionNeedsAttention
                ? "bg-amber-500/10 border border-amber-500/30"
                : isNewlyAdded
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
        {/* Live indicator - pulsing dot for running sessions, color matches card */}
        {session.isRunning && (
          <span className="relative flex h-2 w-2 flex-shrink-0" title="Session is running">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${sessionNeedsAttention ? "bg-amber-400" : "bg-emerald-400"}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${sessionNeedsAttention ? "bg-amber-500" : "bg-emerald-500"}`}></span>
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
      </div>

      {/* Status - dynamic terminal title from Claude */}
      {status && (
        <p className={`text-xs font-medium truncate mt-1 ${sessionNeedsAttention ? "text-amber-500" : "text-emerald-400"}`}>{status}</p>
      )}

      {/* Last Message (user or assistant) - prefer live derived state for running sessions */}
      {(() => {
        // Use derived lastMessage for running sessions (live updates), fallback to static lastMessage
        const displayMessage = session.derivedState?.lastMessage || session.lastMessage;
        if (displayMessage && displayMessage !== session.title) {
          return (
            <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
              {displayMessage}
            </p>
          );
        }
        return null;
      })()}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-[var(--text-tertiary)]">
        {/* Status badge with elapsed timer - first item in metadata */}
        {(() => {
          // Priority: isNew > derivedState
          if (session.isNew) {
            return (
              <span className="flex items-center gap-1" title="New session">
                New
              </span>
            );
          }
          if (session.derivedState) {
            const config = STATUS_BADGE_CONFIG[session.derivedState.status];
            if (config) {
              // Calculate elapsed time from lastActivityTime
              const lastActivity = session.derivedState.lastActivityTime;
              const elapsedMs = lastActivity ? now - lastActivity : 0;
              const elapsedStr = lastActivity ? formatElapsedTimer(elapsedMs) : null;

              return (
                <span className="flex items-center gap-1" title={config.label}>
                  {config.icon}
                  {config.label}
                  {elapsedStr && (
                    <span className="text-[var(--text-quaternary)] tabular-nums">
                      {elapsedStr}
                    </span>
                  )}
                </span>
              );
            }
          }
          return null;
        })()}

        {/* Folder - only show if different from current scope */}
        {(!scopePath || session.projectPath !== scopePath) && (
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
        )}

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

        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatRelativeTime(new Date(session.lastActivity))}
        </span>
      </div>
    </div>
  );
}
