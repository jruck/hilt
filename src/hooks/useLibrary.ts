"use client";

import useSWR from "swr";
import type { LibraryArtifact, LibraryArtifactDetail, LibrarySourceSummary, RecommendedArtifact } from "@/lib/library/types";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
});

export interface UseLibraryOptions {
  source?: string | null;
  channel?: string | null;
  status?: string | null;
  q?: string | null;
  limit?: number;
}

export function useLibrary(options: UseLibraryOptions = {}) {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.channel) params.set("channel", options.channel);
  if (options.status) params.set("status", options.status);
  if (options.q) params.set("q", options.q);
  params.set("limit", String(options.limit || 80));
  const { data, error, isLoading, mutate } = useSWR<{ artifacts: LibraryArtifact[]; total: number }>(`/api/library?${params.toString()}`, fetcher);
  return { artifacts: data?.artifacts || [], total: data?.total || 0, error, isLoading, mutate };
}

export function useLibrarySources() {
  const { data, error, isLoading, mutate } = useSWR<{ sources: LibrarySourceSummary[] }>("/api/library/sources", fetcher);
  return { sources: data?.sources || [], error, isLoading, mutate };
}

export function useLibraryArtifact(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<LibraryArtifactDetail>(id ? `/api/library/${id}` : null, fetcher);
  return { artifact: data || null, error, isLoading, mutate };
}

export function useRecommendations(limit = 10) {
  const { data, error, isLoading, mutate } = useSWR<{ items: RecommendedArtifact[]; generated_at: string; context_summary: string }>(`/api/library/recommendations?limit=${limit}`, fetcher);
  return { items: data?.items || [], generatedAt: data?.generated_at || null, contextSummary: data?.context_summary || "", error, isLoading, mutate };
}

export async function promoteCandidate(id: string) {
  const res = await fetch(`/api/library/candidates/${id}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual_save" }),
  });
  if (!res.ok) throw new Error(`Failed to promote candidate: ${res.status}`);
  return res.json();
}

export async function skipCandidate(id: string) {
  const res = await fetch(`/api/library/candidates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "skipped" }),
  });
  if (!res.ok) throw new Error(`Failed to skip candidate: ${res.status}`);
  return res.json();
}

