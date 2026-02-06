"use client";

import { useState, useMemo, useEffect } from "react";
import { useBridgeWeekly } from "@/hooks/useBridgeWeekly";
import { useBridgeProjects } from "@/hooks/useBridgeProjects";
import { WeekHeader } from "./WeekHeader";
import { BridgeTaskList } from "./BridgeTaskList";
import { BridgeNotes } from "./BridgeNotes";
import { ProjectBoard } from "./ProjectBoard";
import { RecycleModal } from "./RecycleModal";
import { BridgeTaskPanel } from "./BridgeTaskPanel";
import { Loader2 } from "lucide-react";
import type { BridgeTask, BridgeProject } from "@/lib/types";

interface BridgeViewProps {
  pendingAddTask?: boolean;
  onTaskAdded?: () => void;
  onNavigateToProject?: (project: BridgeProject) => void;
}

export function BridgeView({ pendingAddTask, onTaskAdded, onNavigateToProject }: BridgeViewProps) {
  const {
    data: weekly,
    isLoading: weeklyLoading,
    addTask,
    deleteTask,
    toggleTask,
    reorderTasks,
    updateTaskDetails,
    updateTaskTitle,
    updateTaskProject,
    updateNotes,
    recycle,
    // Week preview (ephemeral)
    setPreviewWeek,
    isPreviewingPast,
    availableWeeks,
  } = useBridgeWeekly();

  const { data: projects, isLoading: projectsLoading, updateProjectStatus } = useBridgeProjects();

  const [showRecycleModal, setShowRecycleModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BridgeTask | null>(null);

  // Keep selected task in sync with latest data
  const resolvedTask = selectedTask && weekly
    ? weekly.tasks.find(t => t.id === selectedTask.id) ?? null
    : null;

  // Handle pending add-task from toolbar button
  useEffect(() => {
    if (pendingAddTask) {
      handleAddTask("New task");
      onTaskAdded?.();
    }
  }, [pendingAddTask]);

  // Display sort: unchecked first, checked last, both in file order
  const displayTasks = useMemo(() => {
    if (!weekly) return [];
    const undone = weekly.tasks.filter(t => !t.done);
    const done = weekly.tasks.filter(t => t.done);
    return [...undone, ...done];
  }, [weekly]);

  function handleAddTask(title: string) {
    // Select immediately — the optimistic task has id "task-0"
    setSelectedTask({ id: "task-0", title, done: false, details: [], rawLines: [`- [ ] ${title}`], projectPath: null });
    addTask(title);
  }

  function handleSelectTask(task: BridgeTask) {
    setSelectedTask(prev => prev?.id === task.id ? null : task);
  }

  if (weeklyLoading && !weekly) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!weekly) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <p>No weekly list found in bridge vault.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          <WeekHeader
            week={weekly.week}
            needsRecycle={weekly.needsRecycle}
            onRecycle={() => setShowRecycleModal(true)}
            availableWeeks={availableWeeks}
            isPreviewingPast={isPreviewingPast}
            onWeekChange={setPreviewWeek}
          />

          <BridgeTaskList
            tasks={displayTasks}
            selectedTaskId={resolvedTask?.id ?? null}
            onAddTask={handleAddTask}
            onToggle={toggleTask}
            onReorder={reorderTasks}
            onUpdateTitle={updateTaskTitle}
            onDeleteTask={(id) => {
              deleteTask(id);
              if (selectedTask?.id === id) setSelectedTask(null);
            }}
            onSelectTask={handleSelectTask}
          />

          <BridgeNotes
            notes={weekly.notes}
            vaultPath={weekly.vaultPath}
            filePath={weekly.filePath}
            onSave={updateNotes}
          />

          {projects && (
            <ProjectBoard
              columns={projects.columns}
              onProjectClick={(project) => onNavigateToProject?.(project)}
              onStatusChange={(project, status) => updateProjectStatus(project.path, status)}
            />
          )}

          {projectsLoading && !projects && (
            <div className="text-center text-[var(--text-tertiary)] py-4">
              <Loader2 className="w-4 h-4 animate-spin inline-block" />
            </div>
          )}
        </div>

        {showRecycleModal && (
          <RecycleModal
            tasks={weekly.tasks}
            onClose={() => setShowRecycleModal(false)}
            onRecycle={recycle}
          />
        )}
      </div>

      {/* Side panel for task details */}
      {resolvedTask && (
        <div className="w-96 flex-shrink-0 overflow-visible">
          <BridgeTaskPanel
            task={resolvedTask}
            vaultPath={weekly.vaultPath}
            filePath={weekly.filePath}
            onClose={() => setSelectedTask(null)}
            onUpdateTitle={updateTaskTitle}
            onUpdateDetails={updateTaskDetails}
            onUpdateProject={updateTaskProject}
            onDelete={(id) => {
              deleteTask(id);
              setSelectedTask(null);
            }}
            onNavigateToProject={(projectPath, vaultPath) => {
              // Try to resolve from loaded projects first
              if (projects) {
                const allProjects = Object.values(projects.columns).flat();
                const project = allProjects.find(p => p.relativePath === projectPath);
                if (project) {
                  onNavigateToProject?.(project);
                  return;
                }
              }
              // Fallback: construct absolute path and navigate directly
              if (vaultPath && onNavigateToProject) {
                const absolutePath = `${vaultPath}/${projectPath}`;
                onNavigateToProject({ path: absolutePath, relativePath: projectPath } as BridgeProject);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
