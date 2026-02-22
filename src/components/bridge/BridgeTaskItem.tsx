"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BridgeTask } from "@/lib/types";
import { GripVertical, ChevronRight } from "lucide-react";
import { parseLifecycle } from "@/lib/attribution";
import { useIsMobile } from "@/hooks/useIsMobile";

function DueDateBadge({ dueDate, done }: { dueDate: string; done?: boolean }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);

  let colorClass: string;
  if (done) {
    colorClass = "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"; // neutral for completed tasks
  } else if (diffDays <= 0) {
    colorClass = "bg-red-500/15 text-red-500"; // overdue or today
  } else if (diffDays <= 2) {
    colorClass = "bg-orange-500/15 text-orange-500"; // tomorrow or next day
  } else {
    colorClass = "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"; // future
  }

  const label = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

interface BridgeTaskItemProps {
  task: BridgeTask;
  isSelected: boolean;
  onToggle: (id: string, done: boolean) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSelect: (task: BridgeTask) => void;
  onDelete: (id: string) => void;
}

export function BridgeTaskItem({
  task,
  isSelected,
  onToggle,
  onUpdateTitle,
  onSelect,
  onDelete,
}: BridgeTaskItemProps) {
  const [title, setTitle] = useState(task.title);
  const lastSavedTitle = useRef(task.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isTouch = useIsMobile();

  // Parse lifecycle markers from title (memoized)
  const lifecycle = useMemo(() => parseLifecycle(title, task.done), [title, task.done]);
  const displayTitle = lifecycle.displayTitle;

  useEffect(() => {
    if (task.title !== lastSavedTitle.current) {
      setTitle(task.title);
      lastSavedTitle.current = task.title;
    }
  }, [task.title]);

  function promptDeleteIfEmpty(): boolean {
    if (title.trim() === "") {
      setConfirmDelete(true);
      return true;
    }
    return false;
  }

  function saveTitle(value: string) {
    const trimmed = value.trim();
    // Compare against the displayed (stripped) version of the last saved title
    // to avoid accidentally removing lifecycle markers on focus+blur
    const lastDisplay = parseLifecycle(lastSavedTitle.current, task.done).displayTitle;
    if (trimmed && trimmed !== lastDisplay) {
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

  const isNew = lifecycle.state === "new";
  const isReview = lifecycle.state === "review";
  // Review tasks look unchecked (pending user confirmation) even though markdown has [x]
  const visuallyDone = task.done && !isReview;

  // Left border accent using inset box-shadow (doesn't affect layout)
  const leftAccentStyle = isNew
    ? { boxShadow: "inset 3px 0 0 0 rgb(245 158 11)" } // amber-500
    : isReview
    ? { boxShadow: "inset 3px 0 0 0 rgb(59 130 246)" } // blue-500
    : undefined;

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Task card */}
      <div
        style={leftAccentStyle}
        className={`flex-1 min-w-0 rounded-lg border bg-[var(--bg-secondary)] transition-all duration-150 ease-out hover:shadow-sm hover:border-[var(--border-hover)] ${
          isSelected
            ? "border-[var(--interactive-default)]"
            : "border-[var(--border-default)]"
        } ${visuallyDone || isReview ? "opacity-50" : ""}`}
      >
        <div
          className={`flex items-center gap-2 px-3 ${isTouch ? "py-3" : "py-2.5"} cursor-pointer ${isTouch ? "select-none touch-manipulation" : ""}`}
          onClick={() => onSelect(task)}
        >
          {/* Drag handle — always visible, only way to reorder */}
          <button
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className={`flex-shrink-0 cursor-grab text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] active:cursor-grabbing ${isTouch ? "p-1 -m-1" : ""}`}
            style={{ touchAction: "none" }}
          >
            <GripVertical className={isTouch ? "w-5 h-5" : "w-4 h-4"} />
          </button>

          {/* Checkbox — review tasks show unchecked; clicking confirms by stripping marker */}
          <input
            type="checkbox"
            checked={visuallyDone}
            onChange={() => {
              if (isReview) {
                // Confirm completion: strip the ⁉️ marker, task stays [x] in markdown
                onUpdateTitle(task.id, lifecycle.displayTitle);
              } else {
                onToggle(task.id, !task.done);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className={`bridge-checkbox flex-shrink-0 ${isTouch ? "w-5 h-5" : "w-4 h-4"} cursor-pointer`}
          />

          {/* Title area — flex-1 with fade mask pinned to row edge */}
          <div
            className="flex-1 min-w-0 overflow-hidden flex items-center"
            style={{ maskImage: "linear-gradient(to right, black calc(100% - 48px), transparent)" }}
          >
            <div className="inline-grid min-w-0 max-w-full">
              <input
                ref={inputRef}
                type="text"
                value={displayTitle}
                readOnly={isTouch}
                onChange={(e) => setTitle(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (!isTouch && !promptDeleteIfEmpty()) {
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
                className={`text-sm bg-transparent border-none outline-none p-0 min-w-[1ch] [grid-area:1/1] ${
                  visuallyDone
                    ? "line-through text-[var(--text-tertiary)]"
                    : "text-[var(--text-primary)]"
                } ${isTouch ? "pointer-events-none" : ""}`}
              />
              <span className="text-sm invisible whitespace-pre [grid-area:1/1] pointer-events-none">
                {displayTitle || " "}
              </span>
            </div>
          </div>

          {/* Due date badge */}
          {task.dueDate && (
            <DueDateBadge dueDate={task.dueDate} done={task.done} />
          )}

          {/* Open detail panel indicator */}
          <ChevronRight className={`flex-shrink-0 w-4 h-4 transition-colors ${
            isSelected
              ? "text-[var(--interactive-default)]"
              : "text-[var(--text-tertiary)]"
          }`} />
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
    </div>
  );
}
