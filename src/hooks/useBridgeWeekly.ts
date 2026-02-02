"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import type { BridgeWeekly, BridgeTask } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useBridgeWeekly() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  const refreshInterval = connected ? 0 : 5000;

  const { data, error, isLoading, mutate } = useSWR<BridgeWeekly>(
    "/api/bridge/weekly",
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
    mutate();
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

  async function updateTaskProject(id: string, projectPath: string | null) {
    if (data) {
      const updatedTasks = data.tasks.map(t =>
        t.id === id ? { ...t, projectPath } : t
      );
      mutate({ ...data, tasks: updatedTasks }, false);
    }

    await fetch(`/api/bridge/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath }),
    });
    mutate();
  }

  async function recycle(carry: string[], newWeek: string) {
    await fetch("/api/bridge/recycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carry, newWeek }),
    });
    mutate();
  }

  return {
    data,
    isLoading,
    isError: error,
    addTask,
    deleteTask,
    toggleTask,
    reorderTasks,
    updateTaskDetails,
    updateTaskTitle,
    updateTaskProject,
    updateNotes,
    recycle,
  };
}
