"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { BridgeWeekly, BridgeTask } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useBridgeWeekly() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  // Ephemeral preview state — not persisted, resets on reload/nav
  const [previewWeek, setPreviewWeek] = useState<string | null>(null);

  const refreshInterval = connected ? 0 : 5000;

  // Build API URL with optional week param
  const apiUrl = previewWeek
    ? `/api/bridge/weekly?week=${previewWeek}`
    : "/api/bridge/weekly";

  const { data, error, isLoading, mutate } = useSWR<BridgeWeekly>(
    apiUrl,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );

  useEffect(() => {
    if (!connected) return;

    subscribe("bridge", {});
    const unsub = on("bridge", "weekly-changed", () => {
      mutate();
    });

    return () => {
      unsub();
      unsubscribe("bridge");
    };
  }, [connected, subscribe, unsubscribe, on, mutate]);

  // Re-fetch on reconnect
  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) {
      mutate();
    }
    wasConnectedRef.current = connected;
  }, [connected, mutate]);

  async function toggleTask(id: string, done: boolean) {
    // Optimistic update — toggle done state in place (no reorder in file)
    if (data) {
      const updatedTasks = data.tasks.map(t =>
        t.id === id ? { ...t, done } : t
      );
      mutate({ ...data, tasks: updatedTasks }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    mutate();
  }

  async function reorderTasks(order: string[]) {
    // Optimistic update
    if (data) {
      const taskMap = new Map(data.tasks.map(t => [t.id, t]));
      const reordered = order
        .map(id => taskMap.get(id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined);
      // Re-assign IDs based on new positions
      const reassigned = reordered.map((t, i) => ({ ...t, id: `task-${i}` }));
      mutate({ ...data, tasks: reassigned }, false);
    }

    await fetch("/api/bridge/tasks/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    mutate();
  }

  async function updateTaskDetails(id: string, details: string[]) {
    if (data) {
      const updatedTasks = data.tasks.map(t =>
        t.id === id ? { ...t, details } : t
      );
      mutate({ ...data, tasks: updatedTasks }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ details }),
    });
    mutate();
  }

  async function updateTaskTitle(id: string, title: string) {
    if (data) {
      const updatedTasks = data.tasks.map(t =>
        t.id === id ? { ...t, title } : t
      );
      mutate({ ...data, tasks: updatedTasks }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    mutate();
  }

  async function updateNotes(notes: string) {
    if (data) {
      mutate({ ...data, notes }, false);
    }

    await fetch("/api/bridge/notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    mutate();
  }

  async function deleteTask(id: string) {
    if (data) {
      const filtered = data.tasks.filter(t => t.id !== id);
      mutate({ ...data, tasks: filtered }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, { method: "DELETE" });
    // No revalidation — the optimistic filter is the correct final state.
    // Revalidating would re-fetch position-based IDs (task-0, task-1, ...)
    // that shift after removal, causing React key collisions and a brief
    // "checked off" flash when a deleted task's ID gets reused.
  }

  async function addTask(title: string): Promise<BridgeTask> {
    // Optimistic update — add to top with task-0 (matches server ID)
    const newTask: BridgeTask = {
      id: "task-0",
      title,
      done: false,
      details: [],
      rawLines: [`- [ ] ${title}`],
      projectPath: null,
      projectPaths: [],
      dueDate: null,
    };
    if (data) {
      const reindexed = data.tasks.map((t, i) => ({ ...t, id: `task-${i + 1}` }));
      mutate({ ...data, tasks: [newTask, ...reindexed] }, false);
    }

    await fetch("/api/bridge/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    mutate();
    return newTask;
  }

  async function updateTaskProject(id: string, projectPath: string | null, projectTitles?: Record<string, string>) {
    // Legacy single-project update — adds to existing paths or sets as only path
    const task = data?.tasks.find(t => t.id === id);
    const currentPaths = task?.projectPaths ?? (task?.projectPath ? [task.projectPath] : []);
    const newPaths = projectPath
      ? [...currentPaths.filter(p => p !== projectPath), projectPath]
      : [];
    
    if (data) {
      const updatedTasks = data.tasks.map(t =>
        t.id === id ? { ...t, projectPath: newPaths[0] ?? null, projectPaths: newPaths } : t
      );
      mutate({ ...data, tasks: updatedTasks }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPaths: newPaths, projectTitles }),
    });
    mutate();
  }

  async function removeTaskProject(id: string, projectPath: string, projectTitles?: Record<string, string>) {
    const task = data?.tasks.find(t => t.id === id);
    const currentPaths = task?.projectPaths ?? (task?.projectPath ? [task.projectPath] : []);
    const newPaths = currentPaths.filter(p => p !== projectPath);

    if (data) {
      const updatedTasks = data.tasks.map(t =>
        t.id === id ? { ...t, projectPath: newPaths[0] ?? null, projectPaths: newPaths } : t
      );
      mutate({ ...data, tasks: updatedTasks }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPaths: newPaths, projectTitles }),
    });
    mutate();
  }

  async function updateAccomplishments(accomplishments: string, week?: string) {
    if (data) {
      mutate({ ...data, accomplishments }, false);
    }

    await fetch("/api/bridge/accomplishments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accomplishments, week }),
    });
    mutate();
  }

  async function recycle(carry: string[], newWeek: string, notes?: string, accomplishments?: string) {
    await fetch("/api/bridge/recycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carry, newWeek, notes, accomplishments }),
    });
    mutate();
  }

  // Computed: are we previewing a past week?
  const isPreviewingPast = Boolean(
    previewWeek && data?.latestWeek && previewWeek !== data.latestWeek
  );

  function clearPreview() {
    setPreviewWeek(null);
  }

  return {
    data,
    isLoading,
    isError: error,
    // Week preview (ephemeral, resets on reload/nav)
    previewWeek,
    setPreviewWeek,
    clearPreview,
    isPreviewingPast,
    availableWeeks: data?.availableWeeks ?? [],
    // Mutations
    addTask,
    deleteTask,
    toggleTask,
    reorderTasks,
    updateTaskDetails,
    updateTaskTitle,
    updateTaskProject,
    removeTaskProject,
    updateNotes,
    updateAccomplishments,
    recycle,
  };
}
