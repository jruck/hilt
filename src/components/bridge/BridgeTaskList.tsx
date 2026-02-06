"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { BridgeTask } from "@/lib/types";
import { BridgeTaskItem } from "./BridgeTaskItem";

interface BridgeTaskListProps {
  tasks: BridgeTask[];
  selectedTaskId: string | null;
  onToggle: (id: string, done: boolean) => void;
  onReorder: (order: string[]) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onSelectTask: (task: BridgeTask) => void;
}

export function BridgeTaskList({
  tasks,
  selectedTaskId,
  onToggle,
  onReorder,
  onUpdateTitle,
  onDeleteTask,
  onSelectTask,
}: BridgeTaskListProps) {
  const [localTasks, setLocalTasks] = useState<BridgeTask[] | null>(null);
  const displayTasks = localTasks || tasks;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setLocalTasks(null);
      return;
    }

    const oldIndex = displayTasks.findIndex(t => t.id === active.id);
    const newIndex = displayTasks.findIndex(t => t.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayTasks, oldIndex, newIndex);
    setLocalTasks(reordered);

    const order = reordered.map(t => t.id);
    onReorder(order);

    setTimeout(() => setLocalTasks(null), 500);
  }

  if (displayTasks.length === 0) {
    return (
      <div className="text-sm text-[var(--text-tertiary)] py-4">
        No tasks this week.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
          Tasks
        </h2>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={displayTasks.map(t => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {displayTasks.map((task) => (
              <BridgeTaskItem
                key={task.id}
                task={task}
                isSelected={task.id === selectedTaskId}
                onToggle={onToggle}
                onUpdateTitle={onUpdateTitle}
                onSelect={onSelectTask}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
