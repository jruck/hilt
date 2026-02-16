"use client";

import useSWR from "swr";
import type { BriefingMeta, BriefingFull, BriefingsListResponse } from "@/lib/bridge/briefing-parser";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useBriefingsList() {
  const { data, error, isLoading, mutate } = useSWR<BriefingsListResponse>(
    "/api/bridge/briefings",
    fetcher,
    { refreshInterval: 30000 }
  );

  return {
    briefings: data?.briefings ?? [],
    latest: data?.latest ?? null,
    isLoading,
    error,
    mutate,
  };
}

export function useBriefing(date: string | null) {
  const { data, error, isLoading, mutate } = useSWR<BriefingFull>(
    date ? `/api/bridge/briefings/${date}` : null,
    fetcher,
  );

  async function markRead() {
    if (!date) return;
    await fetch(`/api/bridge/briefings/${date}`, { method: "PATCH" });
    mutate();
  }

  return {
    briefing: data ?? null,
    isLoading,
    error,
    markRead,
    mutate,
  };
}

export type { BriefingMeta, BriefingFull };
