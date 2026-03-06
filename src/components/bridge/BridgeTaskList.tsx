"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Plus, ChevronRight } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";
import type { BridgeTask } from "@/lib/types";
import { BridgeTaskItem } from "./BridgeTaskItem";
import { parseLifecycle } from "@/lib/attribution";

interface BridgeTaskListProps {
  tasks: BridgeTask[];
  selectedTaskId: string | null;
  onToggle: (id: string, done: boolean) => void;
  onReorder: (order: string[]) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onSelectTask: (task: BridgeTask) => void;
  onAddTask?: () => void;
}

export function BridgeTaskList({
  tasks,
  selectedTaskId,
  onToggle,
  onReorder,
  onUpdateTitle,
  onDeleteTask,
  onSelectTask,
  onAddTask,
}: BridgeTaskListProps) {
  const haptics = useHaptics();
  const [localTasks, setLocalTasks] = useState<BridgeTask[] | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-task-done-expanded") === "true"; } catch { return false; }
  });
  const toggleDoneExpanded = () => setDoneExpanded(prev => {
    const next = !prev;
    next ? haptics.soft() : haptics.rigid(); // expand = soft reveal, collapse = sharp snap
    try { sessionStorage.setItem("bridge-task-done-expanded", String(next)); } catch {}
    return next;
  });
  const displayTasks = localTasks || tasks;

  // Split into To Do / Done, preserving markdown order within each
  const { todoTasks, doneTasks } = useMemo(() => {
    const todo: BridgeTask[] = [];
    const done: BridgeTask[] = [];
    for (const task of displayTasks) {
      const { state } = parseLifecycle(task.title, task.done);
      if (state === "done" || state === "review") {
        done.push(task);
      } else {
        todo.push(task);
      }
    }
    return { todoTasks: todo, doneTasks: done };
  }, [displayTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={displayTasks.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-5">
          {/* === To Do === */}
          {todoTasks.length > 0 && (
            <div>
              <div
                className="flex items-center justify-between mb-3 pr-3 cursor-pointer group"
                onClick={onAddTask}
                title="Add task (⌘J)"
              >
                <h2 className="text-sm font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] uppercase tracking-wide transition-colors">
                  To Do
                  <span className="text-[var(--text-quaternary)] group-hover:text-[var(--text-tertiary)] ml-1.5 font-normal transition-colors">
                    {todoTasks.length}
                  </span>
                </h2>
                {onAddTask && (
                  <Plus className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors" />
                )}
              </div>
              <div className="space-y-1">
                {todoTasks.map((task) => (
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
          )}

          {/* === Done === */}
          {doneTasks.length > 0 && (
            <div>
              <div
                className="flex items-center justify-between mb-3 pr-3 cursor-pointer group"
                onClick={toggleDoneExpanded}
                title={doneExpanded ? "Collapse done" : "Expand done"}
              >
                <h2 className="text-sm font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] uppercase tracking-wide transition-colors">
                  Done
                  <span className="text-[var(--text-quaternary)] group-hover:text-[var(--text-tertiary)] ml-1.5 font-normal transition-colors">
                    {doneTasks.length}
                  </span>
                </h2>
                <ChevronRight className={`w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-all ${doneExpanded ? "rotate-90" : ""}`} />
              </div>
              {doneExpanded && (
                <div className="space-y-1">
                  {doneTasks.map((task) => (
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
              )}
            </div>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}
