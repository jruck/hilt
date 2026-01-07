"use client";

import useSWR from "swr";
import { TreeSessionsResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

/**
 * Hook for fetching sessions in tree mode.
 * Returns sessions with child rollup and tree structure for treemap visualization.
 */
export function useTreeSessions(scopePath: string, showArchived = false) {
  const scopeParam = scopePath ? `&scope=${encodeURIComponent(scopePath)}` : "";
  const archivedParam = showArchived ? "&showArchived=true" : "";
  const { data, error, isLoading, mutate } = useSWR<TreeSessionsResponse>(
    `/api/sessions?mode=tree&pageSize=500${scopeParam}${archivedParam}`,
    fetcher,
    {
      refreshInterval: 5000, // Refresh every 5 seconds
      revalidateOnFocus: true,
      keepPreviousData: true, // Prevent loading flash on scope change
    }
  );

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
