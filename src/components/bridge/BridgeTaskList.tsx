"use client";

import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
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
  onReorder: (order: string[], groupUpdates?: Record<string, string | null>) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onSelectTask: (task: BridgeTask) => void;
  onAddTask?: () => void;
}

/** Group tasks by their `group` field, preserving order within each group */
function groupTasks(tasks: BridgeTask[]): { group: string | null; tasks: BridgeTask[] }[] {
  const groups: { group: string | null; tasks: BridgeTask[] }[] = [];
  const groupMap = new Map<string | null, BridgeTask[]>();

  for (const task of tasks) {
    if (!groupMap.has(task.group)) {
      const entry = { group: task.group, tasks: [] as BridgeTask[] };
      groups.push(entry);
      groupMap.set(task.group, entry.tasks);
    }
    groupMap.get(task.group)!.push(task);
  }

  return groups;
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-task-done-expanded") === "true"; } catch { return false; }
  });
  const toggleDoneExpanded = () => setDoneExpanded(prev => {
    const next = !prev;
    next ? haptics.soft() : haptics.rigid();
    try { sessionStorage.setItem("bridge-task-done-expanded", String(next)); } catch {}
    return next;
  });
  const displayTasks = localTasks || tasks;

  // Split into To Do / Done
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

  // Group todo tasks by section
  const todoGroups = useMemo(() => groupTasks(todoTasks), [todoTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );

  const activeTask = activeId ? displayTasks.find(t => t.id === activeId) : null;

  /** Find which group a task ID belongs to */
  const findGroupForTask = useCallback((taskId: string): string | null => {
    const task = displayTasks.find(t => t.id === taskId);
    return task?.group ?? null;
  }, [displayTasks]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeGroup = findGroupForTask(active.id as string);
    const overGroup = findGroupForTask(over.id as string);

    // If dragging over a task in a different group, move the task to that group
    if (activeGroup !== overGroup) {
      setLocalTasks(prev => {
        const current = prev || [...displayTasks];
        const activeIdx = current.findIndex(t => t.id === active.id);
        if (activeIdx === -1) return current;

        const updated = [...current];
        // Update the task's group to the target group
        updated[activeIdx] = { ...updated[activeIdx], group: overGroup };

        // Move the task to the position of the over item
        const overIdx = updated.findIndex(t => t.id === over.id);
        if (overIdx === -1) return updated;

        return arrayMove(updated, activeIdx, overIdx);
      });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setLocalTasks(null);
      return;
    }

    const current = localTasks || [...displayTasks];
    const oldIndex = current.findIndex(t => t.id === active.id);
    const newIndex = current.findIndex(t => t.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      setLocalTasks(null);
      return;
    }

    // If the task moved to a different group during dragOver, it already has the new group
    const reordered = arrayMove(current, oldIndex, newIndex);

    // Ensure the moved task adopts the group of its new neighbors
    const movedTask = reordered[newIndex];
    const overTask = displayTasks.find(t => t.id === over.id);
    const groupUpdates: Record<string, string | null> = {};
    if (overTask && movedTask.group !== overTask.group) {
      reordered[newIndex] = { ...movedTask, group: overTask.group };
      groupUpdates[movedTask.id] = overTask.group;
    }

    setLocalTasks(reordered);
    const order = reordered.map(t => t.id);
    onReorder(order, Object.keys(groupUpdates).length > 0 ? groupUpdates : undefined);

    setTimeout(() => setLocalTasks(null), 500);
  }

  function handleDragCancel() {
    setActiveId(null);
    setLocalTasks(null);
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
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
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
              {todoGroups.map((section, sectionIdx) => (
                <div key={section.group ?? "__ungrouped"}>
                  {section.group && (
                    <h3 className={`text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide px-3 ${sectionIdx > 0 ? "pt-4" : ""} pb-1`}>
                      {section.group}
                    </h3>
                  )}
                  <SortableContext
                    items={section.tasks.map(t => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
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
                  </SortableContext>
                </div>
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
                {groupTasks(doneTasks).map((section, sectionIdx) => {
                  const showHeader = section.group && section.group.toLowerCase() !== "done";
                  return (
                    <div key={section.group ?? "__ungrouped_done"}>
                      {showHeader && (
                        <h3 className={`text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide px-3 ${sectionIdx > 0 ? "pt-4" : ""} pb-1`}>
                          {section.group}
                        </h3>
                      )}
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
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drag overlay — shows the task being dragged */}
      <DragOverlay>
        {activeTask ? (
          <div className="opacity-80">
            <BridgeTaskItem
              task={activeTask}
              isSelected={false}
              onToggle={() => {}}
              onUpdateTitle={() => {}}
              onSelect={() => {}}
              onDelete={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
