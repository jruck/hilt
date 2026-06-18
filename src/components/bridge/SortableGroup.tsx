"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { BridgeTask } from "@/lib/types";
import { BridgeTaskItem } from "./BridgeTaskItem";

interface SortableGroupProps {
  groupId: string;
  groupLabel: string | null;
  tasks: BridgeTask[];
  showTopPadding: boolean;
  selectedTaskId: string | null;
  reorderDisabled?: boolean;
  onToggle: (id: string, done: boolean) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSelectTask: (task: BridgeTask) => void;
  onDeleteTask: (id: string) => void;
}

export function SortableGroup({
  groupId,
  groupLabel,
  tasks,
  showTopPadding,
  selectedTaskId,
  reorderDisabled = false,
  onToggle,
  onUpdateTitle,
  onSelectTask,
  onDeleteTask,
}: SortableGroupProps) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId });

  return (
    <div ref={setNodeRef}>
      {groupLabel && (
        <h3
          className={`text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide px-3 ${showTopPadding ? "pt-4" : ""} pb-1 transition-colors ${
            isOver ? "text-[var(--text-secondary)]" : ""
          }`}
        >
          {groupLabel}
        </h3>
      )}
      <SortableContext
        id={groupId}
        items={tasks.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={`flex min-h-[4px] flex-col gap-1.5 rounded transition-colors ${
            isOver && tasks.length === 0 ? "bg-[var(--bg-tertiary)]" : ""
          }`}
        >
          {tasks.map((task) => (
            <BridgeTaskItem
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              reorderDisabled={reorderDisabled}
              onToggle={onToggle}
              onUpdateTitle={onUpdateTitle}
              onSelect={onSelectTask}
              onDelete={onDeleteTask}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
