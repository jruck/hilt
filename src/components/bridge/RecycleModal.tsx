"use client";

import { useMemo, useState } from "react";
import { useTasksList } from "@/hooks/useTaskFile";
import { taskIdFromTaskPath } from "@/lib/tasks/weekly-v2";
import type { BridgeTask } from "@/lib/types";
import { X, RefreshCw } from "lucide-react";

interface RecycleModalProps {
  tasks: BridgeTask[];
  notes: string;
  onClose: () => void;
  onRecycle: (
    carry: string[],
    newWeek: string,
    notes?: string,
    accomplishments?: string,
    carryUnlisted?: string[],
  ) => Promise<void>;
}

/** Task-file statuses that mean "still live work" — the orphan-detection statuses (mirrors
 * ACTIVE_ORPHAN_STATUSES in the recycle route, which re-validates server-side). */
const ACTIVE_STATUSES = new Set(["accepted-me", "accepted-agent", "in-progress"]);

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  return nextMonday.toISOString().split("T")[0];
}

export function RecycleModal({ tasks, notes, onClose, onRecycle }: RecycleModalProps) {
  const incompleteTasks = tasks.filter(t => !t.done);
  const completedTasks = tasks.filter(t => t.done);

  // Orphan sweep: ACTIVE task files with no line on this week's list are invisible everywhere
  // except their origin — and since the carry walks lines, they'd never ride into future weeks.
  const { tasks: taskFiles, isLoading: taskFilesLoading } = useTasksList();
  const unlistedTasks = useMemo(() => {
    const linkedIds = new Set<string>();
    for (const t of tasks) {
      const id = taskIdFromTaskPath(t.taskPath);
      if (id) linkedIds.add(id);
    }
    return taskFiles.filter(t => ACTIVE_STATUSES.has(t.status) && !linkedIds.has(t.id));
  }, [tasks, taskFiles]);

  // Pre-select all incomplete tasks to carry forward
  const [selected, setSelected] = useState<Set<string>>(
    new Set(incompleteTasks.map(t => t.id))
  );
  // Orphans default CHECKED; track exclusions so late-arriving list data stays pre-selected.
  const [excludedUnlisted, setExcludedUnlisted] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasNotes = notes.trim().length > 0;
  const [carryNotes, setCarryNotes] = useState(hasNotes);
  const [notesText, setNotesText] = useState(notes);
  const [accomplishmentsText, setAccomplishmentsText] = useState("");

  function toggleTask(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleUnlisted(id: string) {
    setExcludedUnlisted(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleRecycle() {
    setIsSubmitting(true);
    setError(null);
    try {
      // Always create for next Monday (end-of-week retrospective)
      const newWeek = getNextMonday();
      const carryUnlisted = unlistedTasks
        .filter(t => !excludedUnlisted.has(t.id))
        .map(t => t.id);
      await onRecycle(
        Array.from(selected),
        newWeek,
        carryNotes ? notesText.trim() : undefined,
        accomplishmentsText.trim() || undefined,
        carryUnlisted.length > 0 ? carryUnlisted : undefined
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start next week");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl border border-[var(--border-default)] w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Week Review
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-96 overflow-y-auto">
          {incompleteTasks.length > 0 && (
            <div className="mb-4">
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                Carry these tasks into next week:
              </p>
              <div className="space-y-2">
                {incompleteTasks.map((task, i) => {
                  const prevGroup = i > 0 ? incompleteTasks[i - 1].group : undefined;
                  const showGroupHeader = task.group && task.group !== prevGroup;
                  return (
                    <div key={task.id}>
                      {showGroupHeader && (
                        <h3 className={`text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide ${i > 0 ? "pt-3" : ""} pb-1`}>
                          {task.group}
                        </h3>
                      )}
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(task.id)}
                          onChange={() => toggleTask(task.id)}
                          className="w-4 h-4 rounded border-[var(--border-default)] text-[var(--interactive-default)] focus:ring-[var(--interactive-default)]"
                        />
                        <span className="text-sm text-[var(--text-primary)]">
                          {task.title}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {unlistedTasks.length > 0 && (
            <div className="mb-4">
              <p className="text-sm text-[var(--text-secondary)] mb-1">
                Unlisted tasks:
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mb-3">
                Active tasks not on this week&apos;s list.
              </p>
              <div className="space-y-2">
                {unlistedTasks.map(task => (
                  <label key={task.id} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!excludedUnlisted.has(task.id)}
                      onChange={() => toggleUnlisted(task.id)}
                      className="w-4 h-4 rounded border-[var(--border-default)] text-[var(--interactive-default)] focus:ring-[var(--interactive-default)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      {task.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {completedTasks.length > 0 && (
            <div>
              <p className="text-xs text-[var(--text-tertiary)] mb-2">
                Completed (not carried):
              </p>
              <div className="space-y-1">
                {completedTasks.map(task => (
                  <div
                    key={task.id}
                    className="text-sm text-[var(--text-tertiary)] line-through pl-6"
                  >
                    {task.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && (
            <p className="text-sm text-[var(--text-tertiary)]">
              No tasks from the current week.
            </p>
          )}

          {/* Accomplishments for outgoing week */}
          <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
            <label className="block text-sm text-[var(--text-secondary)] mb-2">
              What did you get done this week?
            </label>
            <textarea
              value={accomplishmentsText}
              onChange={e => setAccomplishmentsText(e.target.value)}
              rows={4}
              className="w-full text-sm p-2.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] resize-y focus:outline-none focus:border-[var(--interactive-default)]"
              placeholder="Shipped feature X, resolved bug Y, published article Z..."
            />
          </div>

          {/* Notes carry-over */}
          {hasNotes && (
            <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
              <label className="flex items-center gap-2.5 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={carryNotes}
                  onChange={() => setCarryNotes(prev => !prev)}
                  className="w-4 h-4 rounded border-[var(--border-default)] text-[var(--interactive-default)] focus:ring-[var(--interactive-default)]"
                />
                <span className="text-sm text-[var(--text-secondary)]">
                  Carry notes forward
                </span>
              </label>
              {carryNotes && (
                <textarea
                  value={notesText}
                  onChange={e => setNotesText(e.target.value)}
                  rows={4}
                  className="w-full text-sm p-2.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] resize-y focus:outline-none focus:border-[var(--interactive-default)]"
                  placeholder="Edit notes before carrying forward..."
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border-default)]">
          {error && (
            <div className="flex-1 text-xs text-[var(--text-error,#ef4444)] mr-2 truncate" title={error}>
              {error}
            </div>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRecycle}
            // Recycling is one-shot (the 409 existing-week guard): confirming before the
            // task-file fetch settles would silently drop the unlisted-orphans sweep for the
            // whole week (adversarial finding) — hold the button for the (sub-second) load.
            disabled={isSubmitting || taskFilesLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--interactive-default)] text-white hover:bg-[var(--interactive-hover)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? "animate-spin" : ""}`} />
            Start Next Week
          </button>
        </div>
      </div>
    </div>
  );
}
