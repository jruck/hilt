"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { TreeSessionsResponse } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Custom hook for visibility-aware polling
function useVisibilityAwareInterval(activeInterval: number, hiddenInterval: number) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return isVisible ? activeInterval : hiddenInterval;
}

/**
 * Hook for fetching sessions in tree mode.
 * Returns sessions with child rollup and tree structure for treemap visualization.
 */
export function useTreeSessions(scopePath: string, showArchived = false, enabled = true) {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  // No polling when connected - rely entirely on WebSocket events
  // Fallback to polling only when WebSocket is disconnected
  const fallbackInterval = useVisibilityAwareInterval(5000, 30000); // 5s visible, 30s hidden
  const refreshInterval = connected ? 0 : fallbackInterval;

  const scopeParam = scopePath ? `&scope=${encodeURIComponent(scopePath)}` : "";
  const archivedParam = showArchived ? "&showArchived=true" : "";
  // Pass null key when disabled to skip fetching (SWR convention)
  const swrKey = enabled ? `/api/sessions?mode=tree&pageSize=500${scopeParam}${archivedParam}` : null;
  const { data, error, isLoading, mutate } = useSWR<TreeSessionsResponse>(
    swrKey,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: true,
      keepPreviousData: true, // Prevent loading flash on scope change
    }
  );

  // Subscribe to session events and update data when events arrive
  useEffect(() => {
    if (!connected || !enabled) return;

    // Subscribe to sessions channel with scope filter (tree uses prefix match)
    subscribe("sessions", scopePath ? { scope: scopePath } : {});

    // Handle session created events
    const unsubCreated = on("sessions", "created", () => {
      console.log("[useTreeSessions] Session created event, refreshing tree");
      mutate();
    });

    // Handle session updated events
    const unsubUpdated = on("sessions", "updated", () => {
      console.log("[useTreeSessions] Session updated event, refreshing tree");
      mutate();
    });

    // Handle session deleted events
    const unsubDeleted = on("sessions", "deleted", () => {
      console.log("[useTreeSessions] Session deleted event, refreshing tree");
      mutate();
    });

    return () => {
      unsubscribe("sessions");
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [connected, enabled, scopePath, subscribe, unsubscribe, on, mutate]);

  // Re-fetch data when WebSocket reconnects (connected goes from false to true)
  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) {
      console.log("[useTreeSessions] WebSocket reconnected, re-fetching data");
      mutate();
    }
    wasConnectedRef.current = connected;
  }, [connected, mutate]);

  return {
    tree: data?.tree ?? null,
    sessions: data?.sessions ?? [],
    total: data?.total ?? 0,
    counts: data?.counts ?? { inbox: 0, active: 0, recent: 0, archived: 0 },
    isLoading,
    isError: error,
    refresh: mutate,
  };
}
