"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Pencil, Eye, Trash2 } from "lucide-react";
import type { BridgeTask } from "@/lib/types";
import dynamic from "next/dynamic";

const BridgeTaskEditor = dynamic(
  () => import("./BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface BridgeTaskPanelProps {
  task: BridgeTask;
  vaultPath?: string;
  filePath?: string;
  onClose: () => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateDetails: (id: string, details: string[]) => void;
  onDelete: (id: string) => void;
}

export function BridgeTaskPanel({
  task,
  vaultPath,
  filePath,
  onClose,
  onUpdateTitle,
  onUpdateDetails,
  onDelete,
}: BridgeTaskPanelProps) {
  const [title, setTitle] = useState(task.title);
  const [isEditMode, setIsEditMode] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastSavedTitle = useRef(task.title);
  const lastSavedDetails = useRef(task.details.join("\n"));

  useEffect(() => {
    if (task.title !== lastSavedTitle.current) {
      setTitle(task.title);
      lastSavedTitle.current = task.title;
    }
    lastSavedDetails.current = task.details.join("\n");
  }, [task.title, task.details]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [task.id]);

  function saveTitle(value: string) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== lastSavedTitle.current) {
      lastSavedTitle.current = trimmed;
      onUpdateTitle(task.id, trimmed);
    } else if (!trimmed) {
      setTitle(lastSavedTitle.current);
    }
  }

  const handleContentChange = useCallback(
    (markdown: string) => {
      if (markdown !== lastSavedDetails.current) {
        lastSavedDetails.current = markdown;
        onUpdateDetails(task.id, markdown.split("\n"));
      }
    },
    [task.id, onUpdateDetails]
  );

  const fullMarkdown = task.details.join("\n");

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] border-l border-[var(--border-default)]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-start gap-3 px-6 py-5 border-b border-[var(--border-default)]">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") onClose();
          }}
          rows={1}
          className="flex-1 text-lg leading-snug font-semibold bg-transparent border-none outline-none text-[var(--text-primary)] placeholder-[var(--text-tertiary)] resize-none overflow-hidden p-0 m-0"
          placeholder="Task title..."
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`p-1 rounded transition-colors ${
              isEditMode
                ? "text-[var(--interactive-default)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
            title={isEditMode ? "Preview" : "Edit"}
          >
            {isEditMode ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 bg-red-500/10 border-b border-red-500/20">
          <span className="text-sm text-red-500 flex-1">Delete this task and all its content?</span>
          <button
            onClick={() => onDelete(task.id)}
            className="px-3 py-1 text-xs font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-3 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <BridgeTaskEditor
          markdown={fullMarkdown}
          onChange={handleContentChange}
          readOnly={!isEditMode}
          vaultPath={vaultPath}
          filePath={filePath}
        />
      </div>
    </div>
  );
}
