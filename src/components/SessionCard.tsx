"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Session } from "@/lib/types";
import { useState } from "react";
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
} from "lucide-react";

interface SessionCardProps {
  session: Session;
  onOpen?: (session: Session) => void;
  onDelete?: (session: Session) => void;
  onToggleStarred?: (sessionId: string) => void;
  status?: string;  // Dynamic terminal status from Claude Code
  isSelected?: boolean;
  onSelect?: (session: Session, selected: boolean) => void;
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

export function SessionCard({ session, onOpen, onDelete, onToggleStarred, status, isSelected, onSelect }: SessionCardProps) {
  const [copiedResume, setCopiedResume] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(session)}
      className={`
        group relative border rounded-lg p-3
        transition-colors cursor-pointer
        ${isDragging ? "shadow-xl ring-2 ring-blue-500" : "shadow-sm"}
        ${isSelected
          ? "border-blue-500 bg-blue-500/10 hover:border-blue-400"
          : session.starred
            ? "border-yellow-500/30 bg-yellow-500/5 hover:border-yellow-500/50"
            : session.status === "active"
              ? "border-green-500/20 bg-green-500/5 hover:border-green-500/40"
              : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
        }
      `}
    >
      {/* Hover actions - checkbox, star (recent only), play, done (not recent) */}
      <div className={`
        absolute top-2 right-2 flex items-center gap-1
        ${isSelected || session.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
        transition-opacity
      `}>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(session, !isSelected); }}
          className="p-1 text-zinc-500 hover:text-blue-400 hover:bg-zinc-700 rounded transition-colors"
          title={isSelected ? "Deselect" : "Select"}
        >
          {isSelected ? <CheckSquare className="w-4 h-4 text-blue-400" /> : <Square className="w-4 h-4" />}
        </button>
        {session.status === "recent" && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStarred?.(session.id); }}
            className={`p-1 hover:bg-zinc-700 rounded transition-colors ${
              session.starred ? "text-yellow-400" : "text-zinc-500 hover:text-yellow-400"
            }`}
            title={session.starred ? "Unstar" : "Star"}
          >
            <Star className={`w-4 h-4 ${session.starred ? "fill-current" : ""}`} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onOpen?.(session); }}
          className="p-1 text-zinc-500 hover:text-green-400 hover:bg-zinc-700 rounded transition-colors"
          title="Open session"
        >
          <Play className="w-4 h-4" />
        </button>
        {session.status !== "recent" && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(session); }}
            className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors"
            title="Mark as done"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="flex items-center gap-1.5 pr-20">
        <h3 className="text-sm font-medium text-zinc-100 truncate flex-1" title={session.title}>
          {session.title}
        </h3>
        {session.isolation?.enabled && (
          <span title="Isolated session">
            <Lock className="w-3 h-3 text-blue-400 flex-shrink-0" />
          </span>
        )}
        {session.isNew && (
          <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded flex-shrink-0">
            NEW
          </span>
        )}
      </div>

      {/* Status - dynamic terminal title from Claude */}
      {status && (
        <p className="text-xs text-green-400 font-medium truncate mt-1">{status}</p>
      )}

      {/* Last Prompt */}
      {session.lastPrompt && session.lastPrompt !== session.title && (
        <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
          {session.lastPrompt}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-zinc-500">
        <button
          onClick={(e) => {
            e.stopPropagation();
            fetch('/api/reveal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: session.projectPath })
            }).catch(console.error);
          }}
          className="flex items-center gap-1 hover:text-zinc-300 transition-colors"
          title="Open in Finder"
        >
          <Folder className="w-3 h-3" />
          {session.project}
        </button>

        <button
          onClick={handleCopyResume}
          className="flex items-center gap-1 hover:text-zinc-300 transition-colors"
          title="Copy resume command"
        >
          <Hash className="w-3 h-3" />
          <span className="font-mono text-[11px]">{session.id.slice(0, 8)}</span>
          {copiedResume && <Check className="w-3 h-3 text-green-400" />}
        </button>

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
