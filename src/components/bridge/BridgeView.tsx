"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useBridgeWeekly } from "@/hooks/useBridgeWeekly";
import { useBridgeProjects } from "@/hooks/useBridgeProjects";
import { useBridgeThoughts } from "@/hooks/useBridgeThoughts";
import { useBridgeAreas } from "@/hooks/useBridgeAreas";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import { WeekHeader } from "./WeekHeader";
import { BridgeTaskList } from "./BridgeTaskList";
import { BridgeNotes } from "./BridgeNotes";
import { AreaBoard } from "./AreaBoard";
import { ProjectBoard } from "./ProjectBoard";
import { ThoughtBoard } from "./ThoughtBoard";
import { RecycleModal } from "./RecycleModal";
import { BridgeTaskPanel } from "./BridgeTaskPanel";
import { AppHud, AppHudCollapsedBar } from "@/components/AppHud";
import { LoadingState } from "@/components/ui/LoadingState";
import { SecondaryInlineContent } from "@/components/layout/SecondaryToolbar";
import { BridgeModeToggle, type BridgeMode } from "./BridgeModeToggle";
import { parseLifecycle } from "@/lib/attribution";
import type { CalendarEventOpenDetail } from "@/lib/calendar/deeplink";
import type { BridgeArea, BridgeTask, BridgeProject, BridgeWeeklySection } from "@/lib/types";

interface BridgeViewProps {
  addTaskTrigger?: number;
  hudVisible?: boolean;
  onHudVisibleChange?: (visible: boolean) => void;
  onOpenCalendarEvent?: (detail: CalendarEventOpenDetail) => void;
  openTaskRequest?: { taskId: string; token: number } | null;
  searchQuery?: string;
  onNavigateToArea?: (area: BridgeArea) => void;
  onNavigateToProject?: (project: BridgeProject) => void;
  onBridgeModeChange?: (mode: BridgeMode) => void;
}

const NEW_TASK_TITLE = "New Task";

export function BridgeView({
  addTaskTrigger = 0,
  hudVisible = false,
  onHudVisibleChange,
  onOpenCalendarEvent,
  openTaskRequest,
  searchQuery = "",
  onNavigateToArea,
  onNavigateToProject,
  onBridgeModeChange,
}: BridgeViewProps) {
  const {
    data: weekly,
    isLoading: weeklyLoading,
    addTask,
    deleteTask,
    toggleTask,
    reorderTasks,
    updateTaskDetails,
    updateTaskTitle,
    updateTaskDueDate,
    updateTaskProject,
    removeTaskProject,
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
  const { data: areas, isLoading: areasLoading } = useBridgeAreas();
  const isMobile = useIsMobile();

  const [showRecycleModal, setShowRecycleModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BridgeTask | null>(null);
  const [autoFocusPanel, setAutoFocusPanel] = useState(false);
  const [autoFocusTitleToken, setAutoFocusTitleToken] = useState(0);
  const [sheetVisible, setSheetVisible] = useState(false);
  const lastHandledOpenTaskToken = useRef<number | null>(null);

  // Build project path → title map for markdown serialization
  const projectTitlesMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (projects) {
      for (const list of Object.values(projects.columns)) {
        for (const p of list) map[p.relativePath] = p.title;
      }
    }
    if (thoughts) {
      for (const list of Object.values(thoughts.columns)) {
        for (const t of list) map[t.relativePath] = t.title;
      }
    }
    return map;
  }, [projects, thoughts]);

  const updateTaskProjectWithTitles = useCallback(
    (id: string, projectPath: string | null) => updateTaskProject(id, projectPath, projectTitlesMap),
    [updateTaskProject, projectTitlesMap]
  );

  const removeTaskProjectWithTitles = useCallback(
    (id: string, projectPath: string) => removeTaskProject(id, projectPath, projectTitlesMap),
    [removeTaskProject, projectTitlesMap]
  );

  // Keep selected task in sync with latest data
  const resolvedTask = selectedTask && weekly
    ? weekly.tasks.find(t => t.id === selectedTask.id) ?? null
    : null;
  useMobileChromeVisibilityLock(Boolean(resolvedTask) || showRecycleModal);

  // Animate bottom sheet in on mobile when task is selected
  useEffect(() => {
    let cancelled = false;
    if (resolvedTask && isMobile) {
      // Trigger slide-up animation after mount
      const frame = requestAnimationFrame(() => setSheetVisible(true));
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    } else {
      queueMicrotask(() => {
        if (!cancelled) setSheetVisible(false);
      });
    }
    return () => {
      cancelled = true;
    };
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
      setAutoFocusPanel(false);
    }, 300);
  }, [selectedTask, markTaskRead]);

  const handleAddTask = useCallback((title: string) => {
    // Select immediately — the optimistic task has id "task-0"
    setSelectedTask({ id: "task-0", title, done: false, details: [], rawLines: [`- [ ] ${title}`], projectPath: null, projectPaths: [], dueDate: null, group: null });
    setAutoFocusPanel(true);
    setAutoFocusTitleToken((token) => token + 1);
    addTask(title);
  }, [addTask]);

  // Handle add-task trigger from toolbar button (counter + ref prevents double-fires)
  const lastAddTrigger = useRef(0);
  useEffect(() => {
    let cancelled = false;
    if (addTaskTrigger > lastAddTrigger.current) {
      const trigger = addTaskTrigger;
      queueMicrotask(() => {
        if (cancelled || trigger <= lastAddTrigger.current) return;
        lastAddTrigger.current = trigger;
        handleAddTask(NEW_TASK_TITLE);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [addTaskTrigger, handleAddTask]);

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
  const showAccomplishments = Boolean(weekly?.accomplishments) && (
    !q || (weekly?.accomplishments ?? "").toLowerCase().includes(q)
  );

  const filteredColumns = useMemo(() => {
    if (!projects || !q) return projects?.columns ?? null;
    const result = {} as Record<string, typeof projects.columns[keyof typeof projects.columns]>;
    for (const [status, list] of Object.entries(projects.columns)) {
      result[status] = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.area.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q) ||
        p.relativePath.toLowerCase().includes(q) ||
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

  const filteredAreas = useMemo(() => {
    if (!areas) return null;
    if (!q) return areas.areas;
    return areas.areas.filter((area) => {
      const haystack = [
        area.title,
        area.slug,
        area.relativePath,
        area.description,
        ...area.goals,
        ...area.standards,
        ...area.focus.map((focus) => focus.text),
        ...area.activeProjects.map((project) => project.raw),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [areas, q]);

  const hasFilteredTasks = filteredTasks.length > 0;
  const hasFilteredAreas = (filteredAreas?.length ?? 0) > 0;
  const hasFilteredProjects = filteredColumns
    ? Object.values(filteredColumns).some(col => col.length > 0)
    : false;
  const hasFilteredThoughts = filteredThoughtColumns
    ? Object.values(filteredThoughtColumns).some(col => col.length > 0)
    : false;
  const hasAnyResults = hasFilteredTasks || showNotes || showAccomplishments || hasFilteredAreas || hasFilteredProjects || hasFilteredThoughts;

  const handleSelectTask = useCallback((task: BridgeTask) => {
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
  }, [selectedTask, markTaskRead]);

  const openTaskById = useCallback((taskId: string) => {
    const task = weekly?.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (selectedTask && selectedTask.id !== task.id) {
      markTaskRead(selectedTask);
    }
    setSelectedTask(task);
    setAutoFocusPanel(false);
  }, [weekly?.tasks, selectedTask, markTaskRead]);

  useEffect(() => {
    if (!openTaskRequest || lastHandledOpenTaskToken.current === openTaskRequest.token) return;
    const task = weekly?.tasks.find(t => t.id === openTaskRequest.taskId);
    if (!task) return;
    openTaskById(task.id);
    lastHandledOpenTaskToken.current = openTaskRequest.token;
  }, [openTaskById, openTaskRequest, weekly?.tasks]);

  const weeklySectionOrder = useMemo(() => {
    if (!weekly) return [];
    const order: BridgeWeeklySection[] = [...(weekly.sectionOrder ?? [])];
    if (weekly.accomplishments && !order.includes("accomplishments")) {
      order.unshift("accomplishments");
    }
    if (!order.includes("notes")) {
      const taskIndex = order.indexOf("tasks");
      const notesIndex = taskIndex === -1 ? order.length : taskIndex + 1;
      order.splice(notesIndex, 0, "notes");
    }
    if (!order.includes("tasks")) {
      const notesIndex = order.indexOf("notes");
      const taskIndex = notesIndex === -1 ? order.length : notesIndex + 1;
      order.splice(taskIndex, 0, "tasks");
    }
    return order;
  }, [weekly]);

  const renderWeeklySection = useCallback((section: BridgeWeeklySection) => {
    if (!weekly) return null;

    if (section === "accomplishments") {
      if (!showAccomplishments) return null;
      return (
        <BridgeNotes
          key="accomplishments"
          title="Accomplishments"
          notes={weekly.accomplishments}
          vaultPath={weekly.vaultPath}
          filePath={weekly.filePath}
          onSave={updateAccomplishments}
        />
      );
    }

    if (section === "notes") {
      if (!showNotes) return null;
      return (
        <BridgeNotes
          key="notes"
          notes={weekly.notes}
          vaultPath={weekly.vaultPath}
          filePath={weekly.filePath}
          onSave={updateNotes}
        />
      );
    }

    if (!hasFilteredTasks) return null;
    return (
      <BridgeTaskList
        key="tasks"
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
        onAddTask={() => handleAddTask(NEW_TASK_TITLE)}
        reorderDisabled={Boolean(q)}
      />
    );
  }, [
    weekly,
    showAccomplishments,
    showNotes,
    hasFilteredTasks,
    filteredTasks,
    resolvedTask?.id,
    toggleTask,
    reorderTasks,
    updateTaskTitle,
    deleteTask,
    selectedTask?.id,
    handleSelectTask,
    handleAddTask,
    q,
    updateNotes,
    updateAccomplishments,
  ]);

  if (weeklyLoading && !weekly) {
    return (
      <LoadingState />
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
    <div className={`${isMobile ? "flex-col" : ""} flex min-h-0 flex-1 overflow-hidden`}>
      {isMobile && onHudVisibleChange ? (
        hudVisible ? (
          <AppHud
            placement="top"
            variant="mobile"
            onCollapse={() => onHudVisibleChange(false)}
            onOpenCalendarEvent={onOpenCalendarEvent}
            onOpenTask={openTaskById}
          />
        ) : (
          <AppHudCollapsedBar onExpand={() => onHudVisibleChange(true)} />
        )
      ) : null}

      {/* Main content */}
      <div data-mobile-scroll-chrome="bottom" className="hilt-mobile-scroll-clearance flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto max-w-3xl px-4 pb-0 pt-8 sm:px-6 sm:pb-8 sm:pt-2">
          <WeekHeader
            week={weekly.week}
            needsRecycle={weekly.needsRecycle}
            onRecycle={() => setShowRecycleModal(true)}
            availableWeeks={availableWeeks}
            isPreviewingPast={isPreviewingPast}
            onWeekChange={setPreviewWeek}
            rightSlot={
              onBridgeModeChange ? (
                <BridgeModeToggle mode="priorities" onModeChange={onBridgeModeChange} />
              ) : undefined
            }
          />

          <SecondaryInlineContent className="space-y-8">
            {weeklySectionOrder.map(renderWeeklySection)}

            {filteredAreas && hasFilteredAreas && (
              <AreaBoard
                areas={filteredAreas}
                onAreaClick={onNavigateToArea}
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

            {(areasLoading || projectsLoading || thoughtsLoading) && !areas && !projects && !thoughts && (
              <LoadingState className="min-h-16 py-4" />
            )}

            {q && !hasAnyResults && (
              <div className="text-center text-[var(--text-tertiary)] py-12">
                No matching items
              </div>
            )}
          </SecondaryInlineContent>
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
            autoFocusTitleToken={autoFocusTitleToken}
            autoFocusTitleValue={NEW_TASK_TITLE}
            vaultPath={weekly.vaultPath}
            filePath={weekly.filePath}
            onClose={() => { markTaskRead(resolvedTask); setSelectedTask(null); setAutoFocusPanel(false); }}
            onUpdateTitle={updateTaskTitle}
            onUpdateDueDate={updateTaskDueDate}
            onUpdateDetails={updateTaskDetails}
            onUpdateProject={updateTaskProjectWithTitles}
            onRemoveProject={removeTaskProjectWithTitles}
            onDelete={(id) => {
              deleteTask(id);
              setSelectedTask(null);
              setAutoFocusPanel(false);
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
            <div className="overflow-y-auto pb-[var(--hilt-mobile-nav-clearance)]" style={{ maxHeight: "calc(85vh - 24px)" }}>
              <BridgeTaskPanel
                task={resolvedTask}
                autoFocusTitle={autoFocusPanel}
                autoFocusTitleToken={autoFocusTitleToken}
                autoFocusTitleValue={NEW_TASK_TITLE}
                vaultPath={weekly.vaultPath}
                filePath={weekly.filePath}
                onClose={closeSheet}
                onUpdateTitle={updateTaskTitle}
                onUpdateDueDate={updateTaskDueDate}
                onUpdateDetails={updateTaskDetails}
                onUpdateProject={updateTaskProjectWithTitles}
                onRemoveProject={removeTaskProjectWithTitles}
                onDelete={(id) => {
                  deleteTask(id);
                  setSelectedTask(null);
                  setAutoFocusPanel(false);
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
