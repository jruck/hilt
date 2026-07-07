"use client";

/**
 * SWR + WS hooks over the task-object store (v3 unit A2).
 *
 * useTaskFile(taskId)  — one task by id (probes tasks/ then .proposals/ server-side).
 * useTasksList()       — both stores at once (Priorities' Proposals section, task panes).
 * useDismissed(loop)   — a loop's dismissed LEDGER record (gate-B: dismissed are never gone).
 *
 * All revalidate on the `tasks-changed` bridge event — the only push path (API routes
 * never broadcast; the file write reaches us via BridgeWatcher → EventServer).
 */
import { useEffect, useRef } from "react";
import useSWR from "swr";
import type { TaskFile } from "@/lib/tasks/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import { withBasePath } from "@/lib/base-path";

export type TaskStore = "tasks" | "proposals";

interface TaskFileResponse {
  task: TaskFile;
  store: TaskStore;
}

interface TasksListResponse {
  tasks: TaskFile[];
  proposals: TaskFile[];
}

const fetcher = async (url: string) => {
  const res = await fetch(withBasePath(url));
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = `${detail}: ${body.error}`;
    } catch {
      // Keep the HTTP status when the response cannot be parsed.
    }
    throw new Error(detail);
  }
  return res.json();
};

/** Shared subscription plumbing: revalidate on tasks-changed + refetch on reconnect. */
function useTasksChanged(connected: boolean, mutate: () => void) {
  const { subscribe, unsubscribe, on } = useEventSocketContext();

  useEffect(() => {
    if (!connected) return;

    subscribe("bridge", {});
    const unsub = on("bridge", "tasks-changed", () => {
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
}

export function useTaskFile(taskId: string | null) {
  const { connected } = useEventSocketContext();
  const refreshInterval = connected ? 0 : 5000;

  const { data, error, isLoading, mutate } = useSWR<TaskFileResponse>(
    taskId ? `/api/tasks/${encodeURIComponent(taskId)}` : null,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  useTasksChanged(connected, mutate);

  return {
    task: data?.task ?? null,
    store: data?.store ?? null,
    isLoading,
    error,
    mutate,
  };
}

export function useTasksList() {
  const { connected } = useEventSocketContext();
  const refreshInterval = connected ? 0 : 5000;

  const { data, error, isLoading, mutate } = useSWR<TasksListResponse>(
    "/api/tasks",
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  useTasksChanged(connected, mutate);

  return {
    tasks: data?.tasks ?? [],
    proposals: data?.proposals ?? [],
    isLoading,
    error,
    mutate,
  };
}

/** One dismissed ledger record from GET /api/loops/dismissed — a RECORD, not a task file
 * (dismiss deletes the proposal file; the loop's ledger is the memory). */
export interface DismissedLoopItem {
  id: string;
  action: string;
  dismissed_at: string;
  opened_from: string;
  task_id?: string;
}

interface DismissedResponse {
  loop: string;
  days: number;
  items: DismissedLoopItem[];
}

/**
 * A loop's recently dismissed items (default window 30 days). A dismiss verdict deletes the
 * proposal FILE immediately (→ `tasks-changed` revalidates us), but the LEDGER stamp lands at
 * the loop's next run — so a just-dismissed item appears here after that run, not instantly.
 * Errors (registry missing, loop disabled) degrade to an empty list.
 */
export function useDismissed(loop: string, days = 30) {
  const { connected } = useEventSocketContext();
  const refreshInterval = connected ? 0 : 5000;

  const { data, error, isLoading, mutate } = useSWR<DismissedResponse>(
    `/api/loops/dismissed?loop=${encodeURIComponent(loop)}&days=${days}`,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  useTasksChanged(connected, mutate);

  return {
    dismissed: data?.items ?? [],
    isLoading,
    error,
    mutate,
  };
}
