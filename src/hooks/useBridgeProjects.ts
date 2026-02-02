"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import type { BridgeProjectsResponse, BridgeProjectStatus } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useBridgeProjects() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  const refreshInterval = connected ? 0 : 30000;

  const { data, error, isLoading, mutate } = useSWR<BridgeProjectsResponse>(
    "/api/bridge/projects",
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
    const unsub = on("bridge", "projects-changed", () => {
      mutate();
    });

    return () => {
      unsub();
      unsubscribe("bridge");
    };
  }, [connected, subscribe, unsubscribe, on, mutate]);

  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) {
      mutate();
    }
    wasConnectedRef.current = connected;
  }, [connected, mutate]);

  async function updateProjectStatus(projectPath: string, status: BridgeProjectStatus) {
    // Optimistic update — move between columns
    if (data) {
      const allProjects = Object.values(data.columns).flat();
      const project = allProjects.find(p => p.path === projectPath);
      if (project) {
        const newColumns = { ...data.columns };
        // Remove from old column
        newColumns[project.status] = newColumns[project.status].filter(p => p.path !== projectPath);
        // Add to new column
        newColumns[status] = [...newColumns[status], { ...project, status }];
        mutate({ ...data, columns: newColumns }, false);
      }
    }

    await fetch("/api/bridge/projects/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, status }),
    });
    mutate();
  }

  return {
    data,
    isLoading,
    isError: error,
    updateProjectStatus,
  };
}
