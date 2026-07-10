"use client";

/**
 * useThreadCounts — ONE app-wide SWR fetch of the thread summaries (GET /api/threads; the
 * same key SystemThreadsView polls) → per-anchor message counts for CommentPopover pills.
 * Identity is the client-safe targetKey (src/lib/threads/target-key.ts). Counts revalidate
 * through mutateThreadsForTarget, which mutates this key alongside the per-target one.
 */
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { withBasePath } from "@/lib/base-path";
import { targetKey } from "@/lib/threads/target-key";
import type { CommentTarget, ThreadSummary } from "@/lib/threads/types";

export const THREAD_SUMMARIES_KEY = "/api/threads";

async function fetchSummaries(url: string): Promise<{ threads: ThreadSummary[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ threads: ThreadSummary[] }>;
}

/** Total message count (incl. agent replies) per anchor, summed across the anchor's threads. */
export function useThreadCounts(): { countFor: (target: CommentTarget) => number } {
  const { data } = useSWR<{ threads: ThreadSummary[] }>(THREAD_SUMMARIES_KEY, fetchSummaries, {
    keepPreviousData: true,
  });
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const thread of data?.threads ?? []) {
      const key = targetKey(thread.target);
      map.set(key, (map.get(key) ?? 0) + thread.message_count);
    }
    return map;
  }, [data]);
  return {
    countFor: useCallback((target: CommentTarget) => counts.get(targetKey(target)) ?? 0, [counts]),
  };
}
