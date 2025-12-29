"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SessionStatus, Session } from "@/lib/types";
import { SessionCard } from "./SessionCard";
import { InboxCard } from "./InboxCard";
import { NewDraftCard } from "./NewDraftCard";
import {
  Inbox,
  Loader2,
  Bookmark,
  CheckCircle,
  Plus,
} from "lucide-react";

interface InboxItem {
  id: string;
  prompt: string;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

interface ColumnProps {
  status: SessionStatus;
  sessions: Session[];
  inboxItems?: InboxItem[];
  onOpenSession?: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  onCreateInboxItem?: (prompt: string) => void;
  onCreateAndRunInboxItem?: (prompt: string) => void;
  onUpdateInboxItem?: (id: string, prompt: string) => void;
  onDeleteInboxItem?: (id: string) => void;
  onStartInboxItem?: (item: { id: string; prompt: string }) => void;
  sessionStatuses?: Record<string, string>;
  selectedIds?: Set<string>;
  onSelectSession?: (session: Session, selected: boolean) => void;
  onSelectInboxItem?: (item: InboxItem, selected: boolean) => void;
}

const columnConfig: Record<
  SessionStatus,
  { title: string; icon: React.ReactNode; color: string }
> = {
  inbox: {
    title: "To Do",
    icon: <Inbox className="w-4 h-4" />,
    color: "text-blue-400",
  },
  active: {
    title: "In Progress",
    icon: <Loader2 className="w-4 h-4" />,
    color: "text-green-400",
  },
  inactive: {
    title: "Saved",
    icon: <Bookmark className="w-4 h-4" />,
    color: "text-yellow-400",
  },
  done: {
    title: "Done",
    icon: <CheckCircle className="w-4 h-4" />,
    color: "text-zinc-400",
  },
};

export function Column({
  status,
  sessions,
  inboxItems = [],
  onOpenSession,
  onDeleteSession,
  onCreateInboxItem,
  onCreateAndRunInboxItem,
  onUpdateInboxItem,
  onDeleteInboxItem,
  onStartInboxItem,
  sessionStatuses = {},
  selectedIds = new Set(),
  onSelectSession,
  onSelectInboxItem,
}: ColumnProps) {
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const config = columnConfig[status];

  const itemIds = [
    ...inboxItems.map((item) => `inbox-${item.id}`),
    ...sessions.map((s) => s.id),
  ];

  const handleAddClick = () => {
    setIsCreatingNew(true);
  };

  const handleCreate = (prompt: string) => {
    onCreateInboxItem?.(prompt);
    setIsCreatingNew(false);
  };

  const handleCreateAndRun = (prompt: string) => {
    onCreateAndRunInboxItem?.(prompt);
    setIsCreatingNew(false);
  };

  const handleCancelCreate = () => {
    setIsCreatingNew(false);
  };

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col bg-zinc-900 rounded-xl border border-zinc-800
        min-w-[300px] max-w-[350px] h-full
        ${isOver ? "ring-2 ring-blue-500 ring-opacity-50" : ""}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={config.color}>{config.icon}</span>
          <h2 className="font-semibold text-zinc-100">{config.title}</h2>
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
            {status === "inbox"
              ? inboxItems.length + sessions.length
              : sessions.length}
          </span>
        </div>

        {status === "inbox" && onCreateInboxItem && (
          <button
            onClick={handleAddClick}
            className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
            title="Add draft prompt"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* New draft card being created */}
        {status === "inbox" && isCreatingNew && (
          <NewDraftCard
            onSave={handleCreate}
            onCancel={handleCancelCreate}
            onSaveAndRun={onCreateAndRunInboxItem ? handleCreateAndRun : undefined}
          />
        )}

        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {/* Inbox items */}
          {status === "inbox" &&
            inboxItems.map((item) => (
              <InboxCard
                key={item.id}
                item={item}
                onDelete={() => onDeleteInboxItem?.(item.id)}
                onStart={() => onStartInboxItem?.(item)}
                onUpdate={(prompt) => onUpdateInboxItem?.(item.id, prompt)}
                isSelected={selectedIds.has(`inbox-${item.id}`)}
                onSelect={onSelectInboxItem}
              />
            ))}

          {/* Sessions */}
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onOpen={onOpenSession}
              onDelete={onDeleteSession}
              status={sessionStatuses[session.id]}
              isSelected={selectedIds.has(session.id)}
              onSelect={onSelectSession}
            />
          ))}
        </SortableContext>

        {sessions.length === 0 && inboxItems.length === 0 && !isCreatingNew && (
          <div className="text-center text-zinc-600 text-sm py-8">
            {status === "inbox"
              ? "No items"
              : status === "done"
              ? "No completed sessions"
              : status === "inactive"
              ? "No saved sessions"
              : "No sessions"}
          </div>
        )}
      </div>
    </div>
  );
}
