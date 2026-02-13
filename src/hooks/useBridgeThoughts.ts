"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import type { BridgeThoughtsResponse, BridgeThoughtStatus } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useBridgeThoughts() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  const refreshInterval = connected ? 0 : 30000;

  const { data, error, isLoading, mutate } = useSWR<BridgeThoughtsResponse>(
    "/api/bridge/thoughts",
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
    const unsub = on("bridge", "thoughts-changed", () => {
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

  async function updateThoughtStatus(thoughtPath: string, status: BridgeThoughtStatus) {
    if (data) {
      const allThoughts = Object.values(data.columns).flat();
      const thought = allThoughts.find((t) => t.path === thoughtPath);
      if (thought) {
        const newColumns = { ...data.columns };
        newColumns[thought.status] = newColumns[thought.status].filter((t) => t.path !== thoughtPath);
        newColumns[status] = [...newColumns[status], { ...thought, status }];
        mutate({ ...data, columns: newColumns }, false);
      }
    }

    await fetch("/api/bridge/thoughts/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thoughtPath, status }),
    });
    mutate();
  }

  return {
    data,
    isLoading,
    isError: error,
    updateThoughtStatus,
  };
}
