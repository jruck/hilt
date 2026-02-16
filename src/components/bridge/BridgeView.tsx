"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useBridgeWeekly } from "@/hooks/useBridgeWeekly";
import { useBridgeProjects } from "@/hooks/useBridgeProjects";
import { useBridgeThoughts } from "@/hooks/useBridgeThoughts";
import { useIsMobile } from "@/hooks/useIsMobile";
import { WeekHeader } from "./WeekHeader";
import { BridgeTaskList } from "./BridgeTaskList";
import { BridgeNotes } from "./BridgeNotes";
import { ProjectBoard } from "./ProjectBoard";
import { ThoughtBoard } from "./ThoughtBoard";
import { RecycleModal } from "./RecycleModal";
import { BridgeTaskPanel } from "./BridgeTaskPanel";
import { parseLifecycle } from "@/lib/attribution";
import { Loader2 } from "lucide-react";
import type { BridgeTask, BridgeProject, BridgeThought } from "@/lib/types";

interface BridgeViewProps {
  addTaskTrigger?: number;
  searchQuery?: string;
  onNavigateToProject?: (project: BridgeProject) => void;
}

export function BridgeView({ addTaskTrigger = 0, searchQuery = "", onNavigateToProject }: BridgeViewProps) {
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
    updateAccomplishments,
    recycle,
    // Week preview (ephemeral)
    setPreviewWeek,
    isPreviewingPast,
    availableWeeks,
  } = useBridgeWeekly();

  const { data: projects, isLoading: projectsLoading, updateProjectStatus } = useBridgeProjects();
  const { data: thoughts, isLoading: thoughtsLoading, updateThoughtStatus } = useBridgeThoughts();
  const isMobile = useIsMobile();

  const [showRecycleModal, setShowRecycleModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BridgeTask | null>(null);
  const [autoFocusPanel, setAutoFocusPanel] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  // Keep selected task in sync with latest data
  const resolvedTask = selectedTask && weekly
    ? weekly.tasks.find(t => t.id === selectedTask.id) ?? null
    : null;

  // Animate bottom sheet in on mobile when task is selected
  useEffect(() => {
    if (resolvedTask && isMobile) {
      // Trigger slide-up animation after mount
      const frame = requestAnimationFrame(() => setSheetVisible(true));
      return () => cancelAnimationFrame(frame);
    } else {
      setSheetVisible(false);
    }
  }, [resolvedTask, isMobile]);

  // Strip 🆕 marker when user navigates away from a task ("read receipt")
  const markTaskRead = useCallback((task: BridgeTask | null) => {
    if (task) {
      const { state, displayTitle } = parseLifecycle(task.title, task.done);
      if (state === "new") {
        updateTaskTitle(task.id, displayTitle);
      }
    }
  }, [updateTaskTitle]);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
    // Wait for slide-down animation before clearing selection
    setTimeout(() => {
      markTaskRead(selectedTask);
      setSelectedTask(null);
    }, 300);
  }, [selectedTask, markTaskRead]);

  // Handle add-task trigger from toolbar button (counter + ref prevents double-fires)
  const lastAddTrigger = useRef(0);
  useEffect(() => {
    if (addTaskTrigger > lastAddTrigger.current) {
      lastAddTrigger.current = addTaskTrigger;
      handleAddTask("New task");
    }
  }, [addTaskTrigger]);

  // Display sort: unchecked first, checked last, both in file order
  const displayTasks = useMemo(() => {
    if (!weekly) return [];
    const undone = weekly.tasks.filter(t => !t.done);
    const done = weekly.tasks.filter(t => t.done);
    return [...undone, ...done];
  }, [weekly]);

  // Search filtering
  const q = searchQuery.toLowerCase().trim();

  const filteredTasks = useMemo(() => {
    if (!q) return displayTasks;
    return displayTasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.details.some(d => d.toLowerCase().includes(q))
    );
  }, [displayTasks, q]);

  const showNotes = !q || (weekly?.notes ?? "").toLowerCase().includes(q);

  const filteredColumns = useMemo(() => {
    if (!projects || !q) return projects?.columns ?? null;
    const result = {} as Record<string, typeof projects.columns[keyof typeof projects.columns]>;
    for (const [status, list] of Object.entries(projects.columns)) {
      result[status] = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.area.toLowerCase().includes(q) ||
        p.tags.some(t => t.toLowerCase().includes(q)) ||
        p.description.toLowerCase().includes(q)
      );
    }
    return result as typeof projects.columns;
  }, [projects, q]);

  const filteredThoughtColumns = useMemo(() => {
    if (!thoughts || !q) return thoughts?.columns ?? null;
    const result = {} as Record<string, typeof thoughts.columns[keyof typeof thoughts.columns]>;
    for (const [status, list] of Object.entries(thoughts.columns)) {
      result[status] = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    }
    return result as typeof thoughts.columns;
  }, [thoughts, q]);

  const hasFilteredTasks = filteredTasks.length > 0;
  const hasFilteredProjects = filteredColumns
    ? Object.values(filteredColumns).some(col => col.length > 0)
    : false;
  const hasFilteredThoughts = filteredThoughtColumns
    ? Object.values(filteredThoughtColumns).some(col => col.length > 0)
    : false;
  const hasAnyResults = hasFilteredTasks || showNotes || hasFilteredProjects || hasFilteredThoughts;

  function handleAddTask(title: string) {
    // Select immediately — the optimistic task has id "task-0"
    setSelectedTask({ id: "task-0", title, done: false, details: [], rawLines: [`- [ ] ${title}`], projectPath: null });
    setAutoFocusPanel(true);
    addTask(title);
  }

  function handleSelectTask(task: BridgeTask) {
    // Mark outgoing task as read before switching
    if (selectedTask && selectedTask.id !== task.id) {
      markTaskRead(selectedTask);
    }
    // Toggle: clicking same task closes it (and marks read)
    if (selectedTask?.id === task.id) {
      markTaskRead(selectedTask);
      setSelectedTask(null);
    } else {
      setSelectedTask(task);
    }
    setAutoFocusPanel(false);
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
        <div className={`max-w-3xl mx-auto px-6 py-8 space-y-8 ${isMobile ? "pb-[100px]" : ""}`}>
          <WeekHeader
            week={weekly.week}
            needsRecycle={weekly.needsRecycle}
            onRecycle={() => setShowRecycleModal(true)}
            availableWeeks={availableWeeks}
            isPreviewingPast={isPreviewingPast}
            onWeekChange={setPreviewWeek}
          />

          {weekly.accomplishments && (
            <div>
              <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
                Accomplishments
              </h2>
              <BridgeNotes
                notes={weekly.accomplishments}
                vaultPath={weekly.vaultPath}
                filePath={weekly.filePath}
                onSave={updateAccomplishments}
              />
            </div>
          )}

          {hasFilteredTasks && (
            <BridgeTaskList
              tasks={filteredTasks}
              selectedTaskId={resolvedTask?.id ?? null}
              onToggle={toggleTask}
              onReorder={reorderTasks}
              onUpdateTitle={updateTaskTitle}
              onDeleteTask={(id) => {
                deleteTask(id);
                if (selectedTask?.id === id) setSelectedTask(null);
              }}
              onSelectTask={handleSelectTask}
            />
          )}

          {showNotes && (
            <BridgeNotes
              notes={weekly.notes}
              vaultPath={weekly.vaultPath}
              filePath={weekly.filePath}
              onSave={updateNotes}
            />
          )}

          {filteredThoughtColumns && hasFilteredThoughts && (
            <ThoughtBoard
              columns={filteredThoughtColumns}
              onThoughtClick={(thought) => {
                onNavigateToProject?.({ path: thought.path, relativePath: thought.relativePath } as BridgeProject);
              }}
              onStatusChange={(thought, status) => updateThoughtStatus(thought.path, status)}
            />
          )}

          {filteredColumns && hasFilteredProjects && (
            <ProjectBoard
              columns={filteredColumns}
              onProjectClick={(project) => onNavigateToProject?.(project)}
              onStatusChange={(project, status) => updateProjectStatus(project.path, status)}
            />
          )}

          {(projectsLoading || thoughtsLoading) && !projects && !thoughts && (
            <div className="text-center text-[var(--text-tertiary)] py-4">
              <Loader2 className="w-4 h-4 animate-spin inline-block" />
            </div>
          )}

          {q && !hasAnyResults && (
            <div className="text-center text-[var(--text-tertiary)] py-12">
              No matching items
            </div>
          )}
        </div>

        {showRecycleModal && (
          <RecycleModal
            tasks={weekly.tasks}
            notes={weekly.notes}
            onClose={() => setShowRecycleModal(false)}
            onRecycle={recycle}
          />
        )}
      </div>

      {/* Task detail panel — side panel on desktop, bottom sheet on mobile */}
      {resolvedTask && !isMobile && (
        <div className="w-96 flex-shrink-0 overflow-visible">
          <BridgeTaskPanel
            task={resolvedTask}
            autoFocusTitle={autoFocusPanel}
            vaultPath={weekly.vaultPath}
            filePath={weekly.filePath}
            onClose={() => { markTaskRead(resolvedTask); setSelectedTask(null); }}
            onUpdateTitle={updateTaskTitle}
            onUpdateDetails={updateTaskDetails}
            onUpdateProject={updateTaskProject}
            onDelete={(id) => {
              deleteTask(id);
              setSelectedTask(null);
            }}
            onNavigateToProject={(projectPath, vpPath) => {
              // Check projects
              if (projects) {
                const allProjects = Object.values(projects.columns).flat();
                const project = allProjects.find(p => p.relativePath === projectPath);
                if (project) { onNavigateToProject?.(project); return; }
              }
              // Check thoughts
              if (thoughts) {
                const allThoughts = Object.values(thoughts.columns).flat();
                const thought = allThoughts.find(t => t.relativePath === projectPath);
                if (thought) {
                  onNavigateToProject?.({ path: thought.path, relativePath: thought.relativePath } as BridgeProject);
                  return;
                }
              }
              if (vpPath && onNavigateToProject) {
                const absolutePath = `${vpPath}/${projectPath}`;
                onNavigateToProject({ path: absolutePath, relativePath: projectPath } as BridgeProject);
              }
            }}
          />
        </div>
      )}

      {/* Mobile bottom sheet */}
      {resolvedTask && isMobile && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-300"
            style={{ opacity: sheetVisible ? 1 : 0 }}
            onClick={closeSheet}
          />
          {/* Sheet */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-primary)] rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out"
            style={{
              maxHeight: "85vh",
              transform: sheetVisible ? "translateY(0)" : "translateY(100%)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-12 h-1 rounded-full bg-[var(--text-tertiary)] opacity-40" />
            </div>
            <div className="overflow-y-auto pb-[100px]" style={{ maxHeight: "calc(85vh - 24px)" }}>
              <BridgeTaskPanel
                task={resolvedTask}
                autoFocusTitle={autoFocusPanel}
                vaultPath={weekly.vaultPath}
                filePath={weekly.filePath}
                onClose={closeSheet}
                onUpdateTitle={updateTaskTitle}
                onUpdateDetails={updateTaskDetails}
                onUpdateProject={updateTaskProject}
                onDelete={(id) => {
                  deleteTask(id);
                  setSelectedTask(null);
                }}
                onNavigateToProject={(projectPath, vpPath) => {
                  if (projects) {
                    const allProjects = Object.values(projects.columns).flat();
                    const project = allProjects.find(p => p.relativePath === projectPath);
                    if (project) { onNavigateToProject?.(project); return; }
                  }
                  if (thoughts) {
                    const allThoughts = Object.values(thoughts.columns).flat();
                    const thought = allThoughts.find(t => t.relativePath === projectPath);
                    if (thought) {
                      onNavigateToProject?.({ path: thought.path, relativePath: thought.relativePath } as BridgeProject);
                      return;
                    }
                  }
                  if (vpPath && onNavigateToProject) {
                    const absolutePath = `${vpPath}/${projectPath}`;
                    onNavigateToProject({ path: absolutePath, relativePath: projectPath } as BridgeProject);
                  }
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
