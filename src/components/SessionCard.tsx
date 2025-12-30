"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Session } from "@/lib/types";
import {
  MessageSquare,
  GitBranch,
  Clock,
  Folder,
  Lock,
  Play,
  CheckCircle,
  Square,
  CheckSquare,
  Trash2,
} from "lucide-react";

interface SessionCardProps {
  session: Session;
  onOpen?: (session: Session) => void;
  onDelete?: (session: Session) => void;
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

export function SessionCard({ session, onOpen, onDelete, status, isSelected, onSelect }: SessionCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(session)}
      className={`
        group relative bg-zinc-800 border rounded-lg p-3
        hover:border-zinc-600 transition-colors cursor-pointer
        ${isDragging ? "shadow-xl ring-2 ring-blue-500" : "shadow-sm"}
        ${isSelected ? "border-blue-500 bg-blue-500/10" : "border-zinc-700"}
      `}
    >
      {/* Hover actions - checkbox, play, trash */}
      <div className={`
        absolute top-2 right-2 flex items-center gap-1
        ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
        transition-opacity
      `}>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(session, !isSelected); }}
          className="p-1 text-zinc-500 hover:text-blue-400 hover:bg-zinc-700 rounded transition-colors"
          title={isSelected ? "Deselect" : "Select"}
        >
          {isSelected ? <CheckSquare className="w-4 h-4 text-blue-400" /> : <Square className="w-4 h-4" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen?.(session); }}
          className="p-1 text-zinc-500 hover:text-green-400 hover:bg-zinc-700 rounded transition-colors"
          title="Open session"
        >
          <Play className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.(session); }}
          className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors"
          title="Delete session"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Title */}
      <div className="flex items-center gap-1.5 pr-20">
        <h3 className="text-sm font-medium text-zinc-100 truncate flex-1">
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

      {/* Prompt */}
      {session.firstPrompt && session.firstPrompt !== session.title && (
        <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
          {session.firstPrompt}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <Folder className="w-3 h-3" />
          {session.project}
        </span>

        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {session.messageCount}
        </span>

        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatRelativeTime(new Date(session.lastActivity))}
        </span>
      </div>

      {session.gitBranch && (
        <div className="flex items-center gap-1 mt-1 text-xs text-zinc-500">
          <GitBranch className="w-3 h-3" />
          <span className="truncate">{session.gitBranch}</span>
        </div>
      )}
    </div>
  );
}
