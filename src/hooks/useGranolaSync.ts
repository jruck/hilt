"use client";

import useSWR, { mutate as mutateCache } from "swr";
import type { GranolaSyncMode, GranolaSyncRunReport, GranolaSyncStatus } from "@/lib/granola/types";

const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed with ${response.status}`);
  return data as T;
};

export function useGranolaSyncStatus() {
  return useSWR<GranolaSyncStatus>("/api/granola-sync/status", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
}

export async function runGranolaSync(mode: GranolaSyncMode, options: {
  dryRun?: boolean;
  daysBack?: number;
  limit?: number;
} = {}): Promise<GranolaSyncRunReport> {
  const response = await fetch("/api/granola-sync/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...options }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(syncErrorMessage(data, response.status));
  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    throw new Error(syncErrorMessage(data, response.status));
  }
  await Promise.all([
    mutateCache("/api/granola-sync/status"),
    mutateCache("/api/bridge/people"),
    mutateCache((key) => typeof key === "string" && key.startsWith("/api/calendar/events")),
  ]);
  return data as GranolaSyncRunReport;
}

function syncErrorMessage(data: { error?: string; errors?: string[]; blocked?: boolean } | null, status: number): string {
  const raw = data?.error || data?.errors?.join("\n") || `Granola sync failed with ${status}`;
  if (data?.blocked || raw.includes("Obsidian Granola Sync")) {
    return "Obsidian Granola Sync is still enabled on Mercury V.";
  }
  if (raw.includes("granola-remote-helper.mjs") || raw.includes("MODULE_NOT_FOUND")) {
    return "Installing Mercury helper. Try compare again in a moment.";
  }
  if (raw === "Load failed" || raw.includes("Failed to fetch")) {
    return "Could not reach the Granola sync API.";
  }
  return raw.split("\n")[0] || "Granola sync failed";
}
