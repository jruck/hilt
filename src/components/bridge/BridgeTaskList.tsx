"use client";

import { useState, useMemo } from "react";
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
import { parseLifecycle, type LifecycleState } from "@/lib/attribution";

interface TaskSection {
  key: LifecycleState;
  label: string;
  tasks: BridgeTask[];
}

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

  // Group tasks by lifecycle state (visual only, preserves markdown order within groups)
  const sections = useMemo((): TaskSection[] => {
    const grouped: Record<LifecycleState, BridgeTask[]> = {
      new: [],
      active: [],
      review: [],
      done: [],
    };

    for (const task of displayTasks) {
      const { state } = parseLifecycle(task.title, task.done);
      grouped[state].push(task);
    }

    const sectionDefs: { key: LifecycleState; label: string }[] = [
      { key: "new", label: "New" },
      { key: "active", label: "Tasks" },
      { key: "review", label: "Needs Review" },
      { key: "done", label: "Done" },
    ];

    return sectionDefs
      .map(def => ({ ...def, tasks: grouped[def.key] }))
      .filter(s => s.tasks.length > 0);
  }, [displayTasks]);

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
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.key}>
                {/* Section header - skip for "Tasks" (active) since it's the default */}
                {section.key !== "active" && (
                  <h3 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-2 flex items-center gap-2">
                    {section.key === "new" && <span className="text-yellow-500">●</span>}
                    {section.key === "review" && <span className="text-blue-500">●</span>}
                    {section.key === "done" && <span className="text-green-500">●</span>}
                    {section.label}
                    <span className="text-[var(--text-quaternary)]">({section.tasks.length})</span>
                  </h3>
                )}
                <div className="space-y-1">
                  {section.tasks.map((task) => (
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
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
