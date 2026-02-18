"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import type { BridgePeopleResponse } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useBridgePeople() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  const refreshInterval = connected ? 0 : 30000;

  const { data, error, isLoading, mutate } = useSWR<BridgePeopleResponse>(
    "/api/bridge/people",
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
    const unsub = on("bridge", "people-changed", () => {
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

  return {
    data,
    isLoading,
    isError: error,
  };
}
