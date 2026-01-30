"use client";

import { CalendarDays, RefreshCw } from "lucide-react";

interface WeekHeaderProps {
  week: string;
  needsRecycle: boolean;
  onRecycle: () => void;
}

function formatWeekDate(week: string): string {
  try {
    const date = new Date(week + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return week;
  }
}

export function WeekHeader({ week, needsRecycle, onRecycle }: WeekHeaderProps) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[var(--text-primary)]">
        <CalendarDays className="w-5 h-5 text-[var(--text-tertiary)]" />
        <h1 className="text-lg font-semibold">Week of {formatWeekDate(week)}</h1>
      </div>

      {needsRecycle && (
        <div className="mt-3 flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--status-todo-bg)] border border-[var(--status-todo-border)]">
          <span className="text-sm text-[var(--text-secondary)] flex-1">
            This list is from a previous week. Start a new one?
          </span>
          <button
            onClick={onRecycle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--interactive-default)] text-white hover:bg-[var(--interactive-hover)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            New Week
          </button>
        </div>
      )}
    </div>
  );
}
