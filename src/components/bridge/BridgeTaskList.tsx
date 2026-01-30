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
import { Plus } from "lucide-react";

interface BridgeTaskListProps {
  tasks: BridgeTask[];
  selectedTaskId: string | null;
  onAddTask: (title: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onReorder: (order: string[]) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onSelectTask: (task: BridgeTask) => void;
}

export function BridgeTaskList({
  tasks,
  selectedTaskId,
  onAddTask,
  onToggle,
  onReorder,
  onUpdateTitle,
  onDeleteTask,
  onSelectTask,
}: BridgeTaskListProps) {
  const [localTasks, setLocalTasks] = useState<BridgeTask[] | null>(null);
  const displayTasks = localTasks || tasks;
  const [focusNewTask, setFocusNewTask] = useState(false);

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
        <button
          onClick={() => {
            onAddTask("New task");
            setFocusNewTask(true);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Add task"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
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
            {displayTasks.map((task, idx) => (
              <BridgeTaskItem
                key={task.id}
                task={task}
                isSelected={task.id === selectedTaskId}
                autoFocus={focusNewTask && idx === 0}
                onToggle={onToggle}
                onUpdateTitle={(id, title) => {
                  if (focusNewTask) setFocusNewTask(false);
                  onUpdateTitle(id, title);
                }}
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
