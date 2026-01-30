"use client";

import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BridgeTask } from "@/lib/types";
import { GripVertical, ChevronRight } from "lucide-react";

interface BridgeTaskItemProps {
  task: BridgeTask;
  isSelected: boolean;
  autoFocus?: boolean;
  onToggle: (id: string, done: boolean) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSelect: (task: BridgeTask) => void;
  onDelete: (id: string) => void;
}

export function BridgeTaskItem({
  task,
  isSelected,
  autoFocus,
  onToggle,
  onUpdateTitle,
  onSelect,
  onDelete,
}: BridgeTaskItemProps) {
  const [title, setTitle] = useState(task.title);
  const lastSavedTitle = useRef(task.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (task.title !== lastSavedTitle.current) {
      setTitle(task.title);
      lastSavedTitle.current = task.title;
    }
  }, [task.title]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [autoFocus]);

  function promptDeleteIfEmpty(): boolean {
    if (title.trim() === "") {
      setConfirmDelete(true);
      return true;
    }
    return false;
  }

  function saveTitle(value: string) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== lastSavedTitle.current) {
      lastSavedTitle.current = trimmed;
      onUpdateTitle(task.id, trimmed);
    } else if (!trimmed) {
      // Don't restore old title if we're showing delete confirm
      if (!confirmDelete) {
        setTitle(lastSavedTitle.current);
      }
    }
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-[var(--bg-secondary)] transition-opacity ${
        isSelected
          ? "border-[var(--interactive-default)]"
          : "border-[var(--border-default)]"
      } ${task.done ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex-shrink-0 cursor-grab text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={task.done}
          onChange={() => onToggle(task.id, !task.done)}
          className="flex-shrink-0 w-4 h-4 rounded border-[var(--border-default)] text-[var(--interactive-default)] focus:ring-[var(--interactive-default)] cursor-pointer"
        />

        {/* Editable title */}
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => {
            if (!promptDeleteIfEmpty()) {
              saveTitle(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (title.trim() === "") {
                e.preventDefault();
                promptDeleteIfEmpty();
              } else {
                e.currentTarget.blur();
              }
            }
            if (e.key === "Backspace" && title === "") {
              e.preventDefault();
              promptDeleteIfEmpty();
            }
          }}
          className={`flex-1 text-sm bg-transparent border-none outline-none ${
            task.done
              ? "line-through text-[var(--text-tertiary)]"
              : "text-[var(--text-primary)]"
          }`}
        />

        {/* Open detail panel */}
        <button
          onClick={() => onSelect(task)}
          className={`flex-shrink-0 p-0.5 transition-colors ${
            isSelected
              ? "text-[var(--interactive-default)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
          title="Open details"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="flex items-center gap-3 px-3 py-2 bg-red-500/10 border-t border-red-500/20 rounded-b-lg">
          <span className="text-xs text-red-500 flex-1">Delete this task?</span>
          <button
            onClick={() => onDelete(task.id)}
            className="px-2.5 py-1 text-xs font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => {
              setConfirmDelete(false);
              setTitle(lastSavedTitle.current);
            }}
            className="px-2.5 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
