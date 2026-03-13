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
  closestCorners,
  DragOverlay,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Plus, ChevronRight } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";
import type { BridgeTask } from "@/lib/types";
import { BridgeTaskItem } from "./BridgeTaskItem";
import { SortableGroup } from "./SortableGroup";
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

type ContainerMap = Record<string, string[]>; // groupId → taskIds

const UNGROUPED = "__ungrouped";

/** Build container map from tasks */
function buildContainers(tasks: BridgeTask[]): { containers: ContainerMap; groupOrder: string[]; groupLabels: Record<string, string | null> } {
  const containers: ContainerMap = {};
  const groupOrder: string[] = [];
  const groupLabels: Record<string, string | null> = {};

  for (const task of tasks) {
    const groupId = task.group ?? UNGROUPED;
    if (!containers[groupId]) {
      containers[groupId] = [];
      groupOrder.push(groupId);
      groupLabels[groupId] = task.group;
    }
    containers[groupId].push(task.id);
  }

  return { containers, groupOrder, groupLabels };
}

/** Find which container a task ID is in */
function findContainer(containers: ContainerMap, taskId: string): string | undefined {
  // Check if taskId is actually a container ID (dropping on empty container)
  if (taskId in containers) return taskId;
  return Object.keys(containers).find(key => containers[key].includes(taskId));
}

/** Flatten containers back to ordered task list with group updates */
function flattenContainers(
  containers: ContainerMap,
  groupOrder: string[],
  groupLabels: Record<string, string | null>,
  taskMap: Map<string, BridgeTask>
): { tasks: BridgeTask[]; groupUpdates: Record<string, string | null> } {
  const tasks: BridgeTask[] = [];
  const groupUpdates: Record<string, string | null> = {};

  for (const groupId of groupOrder) {
    const ids = containers[groupId] || [];
    const groupValue = groupLabels[groupId] ?? null;
    for (const id of ids) {
      const task = taskMap.get(id);
      if (!task) continue;
      if (task.group !== groupValue) {
        groupUpdates[id] = groupValue;
        tasks.push({ ...task, group: groupValue });
      } else {
        tasks.push(task);
      }
    }
  }

  return { tasks, groupUpdates };
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localContainers, setLocalContainers] = useState<ContainerMap | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-task-done-expanded") === "true"; } catch { return false; }
  });
  const toggleDoneExpanded = () => setDoneExpanded(prev => {
    const next = !prev;
    next ? haptics.soft() : haptics.rigid();
    try { sessionStorage.setItem("bridge-task-done-expanded", String(next)); } catch {}
    return next;
  });

  // Split into To Do / Done
  const { todoTasks, doneTasks } = useMemo(() => {
    const todo: BridgeTask[] = [];
    const done: BridgeTask[] = [];
    for (const task of tasks) {
      const { state } = parseLifecycle(task.title, task.done);
      if (state === "done" || state === "review") {
        done.push(task);
      } else {
        todo.push(task);
      }
    }
    return { todoTasks: todo, doneTasks: done };
  }, [tasks]);

  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  // Build container structure from todo tasks
  const { containers: sourceContainers, groupOrder, groupLabels } = useMemo(
    () => buildContainers(todoTasks),
    [todoTasks]
  );

  const containers = localContainers || sourceContainers;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );

  const activeTask = activeId ? taskMap.get(activeId) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(containers, active.id as string);
    const overContainer = findContainer(containers, over.id as string);

    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }

    // Move item from source container to target container
    setLocalContainers(prev => {
      const current = prev || { ...containers };
      const sourceItems = [...(current[activeContainer] || [])];
      const destItems = [...(current[overContainer] || [])];

      const activeIndex = sourceItems.indexOf(active.id as string);
      if (activeIndex === -1) return current;

      // Remove from source
      sourceItems.splice(activeIndex, 1);

      // Insert into destination at the over item's position
      const overIndex = destItems.indexOf(over.id as string);
      if (overIndex === -1) {
        // Dropping on the container itself (not an item) — append
        destItems.push(active.id as string);
      } else {
        destItems.splice(overIndex, 0, active.id as string);
      }

      return {
        ...current,
        [activeContainer]: sourceItems,
        [overContainer]: destItems,
      };
    });
  }, [containers]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (!over) {
      setLocalContainers(null);
      return;
    }

    const current = localContainers || { ...containers };
    const activeContainer = findContainer(current, active.id as string);
    const overContainer = findContainer(current, over.id as string);

    if (!activeContainer || !overContainer) {
      setLocalContainers(null);
      return;
    }

    // Same container — reorder within
    if (activeContainer === overContainer) {
      const items = current[activeContainer];
      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);

      if (oldIndex !== newIndex) {
        const updated = {
          ...current,
          [activeContainer]: arrayMove(items, oldIndex, newIndex),
        };
        setLocalContainers(updated);

        // Flatten and send to backend
        const { tasks: flatTasks, groupUpdates } = flattenContainers(updated, groupOrder, groupLabels, taskMap);
        onReorder(
          flatTasks.map(t => t.id),
          Object.keys(groupUpdates).length > 0 ? groupUpdates : undefined
        );
      }
    } else {
      // Cross-container move already handled in dragOver — just persist
      const { tasks: flatTasks, groupUpdates } = flattenContainers(current, groupOrder, groupLabels, taskMap);
      onReorder(
        flatTasks.map(t => t.id),
        Object.keys(groupUpdates).length > 0 ? groupUpdates : undefined
      );
    }

    setTimeout(() => setLocalContainers(null), 500);
  }, [localContainers, containers, groupOrder, groupLabels, taskMap, onReorder]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalContainers(null);
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="text-sm text-[var(--text-tertiary)] py-4">
        No tasks this week.
      </div>
    );
  }

  // Build display tasks from containers for rendering
  const displayTodoTasks = useMemo(() => {
    const result: { groupId: string; groupLabel: string | null; tasks: BridgeTask[] }[] = [];
    for (const groupId of groupOrder) {
      const ids = containers[groupId] || [];
      const groupTasks = ids
        .map(id => taskMap.get(id))
        .filter((t): t is BridgeTask => t !== undefined);
      result.push({
        groupId,
        groupLabel: groupLabels[groupId],
        tasks: groupTasks,
      });
    }
    return result;
  }, [containers, groupOrder, groupLabels, taskMap]);

  const totalTodo = displayTodoTasks.reduce((sum, g) => sum + g.tasks.length, 0);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-5">
        {/* === To Do === */}
        {totalTodo > 0 && (
          <div>
            <div
              className="flex items-center justify-between mb-3 pr-3 cursor-pointer group"
              onClick={onAddTask}
              title="Add task (⌘J)"
            >
              <h2 className="text-sm font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] uppercase tracking-wide transition-colors">
                To Do
                <span className="text-[var(--text-quaternary)] group-hover:text-[var(--text-tertiary)] ml-1.5 font-normal transition-colors">
                  {totalTodo}
                </span>
              </h2>
              {onAddTask && (
                <Plus className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors" />
              )}
            </div>
            <div className="space-y-1">
              {displayTodoTasks.map((section, sectionIdx) => (
                <SortableGroup
                  key={section.groupId}
                  groupId={section.groupId}
                  groupLabel={section.groupLabel}
                  tasks={section.tasks}
                  showTopPadding={sectionIdx > 0}
                  selectedTaskId={selectedTaskId}
                  onToggle={onToggle}
                  onUpdateTitle={onUpdateTitle}
                  onSelectTask={onSelectTask}
                  onDeleteTask={onDeleteTask}
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
                {doneTasks.map((task, i) => {
                  const prevGroup = i > 0 ? doneTasks[i - 1].group : undefined;
                  const showGroupHeader = task.group && task.group !== prevGroup && task.group.toLowerCase() !== "done";
                  return (
                    <div key={task.id}>
                      {showGroupHeader && (
                        <h3 className={`text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide px-3 ${i > 0 ? "pt-4" : ""} pb-1`}>
                          {task.group}
                        </h3>
                      )}
                      <BridgeTaskItem
                        task={task}
                        isSelected={task.id === selectedTaskId}
                        onToggle={onToggle}
                        onUpdateTitle={onUpdateTitle}
                        onSelect={onSelectTask}
                        onDelete={onDeleteTask}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drag overlay */}
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
