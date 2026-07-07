"use client";

/**
 * TaskObjectCard (v3 unit B5) — the task body for the object popover: the shared TaskCard
 * rendered read-only (no onVerdict) with `flush` + `showStatus`, under a slim header row
 * that is the card's click-through into Bridge.
 */
import { ArrowUpRight, SquareCheck } from "lucide-react";
import type { TaskCardData } from "@/lib/objects/types";
import { TaskCard } from "@/components/tasks/TaskCard";

export function TaskObjectCard({ data, onOpen }: { data: TaskCardData; onOpen?: () => void }) {
  const kindLabel = data.store === "proposals" ? "Proposed task" : "Task";
  return (
    <div className="space-y-1.5" data-testid="task-object-card">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 rounded text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] transition-colors hover:text-[var(--interactive-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
          title="Open in Bridge"
        >
          <SquareCheck className="h-3 w-3" />
          {kindLabel}
          <ArrowUpRight className="h-3 w-3" />
        </button>
      ) : (
        <div className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          <SquareCheck className="h-3 w-3" />
          {kindLabel}
        </div>
      )}
      <TaskCard task={data.task} flush showStatus />
    </div>
  );
}
