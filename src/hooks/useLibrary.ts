"use client";

import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type { LibraryArtifact, LibraryArtifactDetail, LibraryOperationalHealth, LibrarySourceSummary, PromotionReason, RecommendedArtifact } from "@/lib/library/types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((res) => {
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

interface LibraryListResponse {
  artifacts: LibraryArtifact[];
  total: number;
  offset: number;
  limit: number;
}

function libraryParams(options: UseLibraryOptions, offset?: number, limit?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.channel) params.set("channel", options.channel);
  if (options.status) params.set("status", options.status);
  if (options.q) params.set("q", options.q);
  params.set("limit", String(limit || options.limit || 80));
  if (typeof offset === "number") params.set("offset", String(offset));
  return params;
}

export function useLibrary(options: UseLibraryOptions = {}) {
  const params = libraryParams(options);
  const { data, error, isLoading, mutate } = useSWR<LibraryListResponse>(`/api/library?${params.toString()}`, fetcher);
  return { artifacts: data?.artifacts || [], total: data?.total || 0, error, isLoading, mutate };
}

export function useInfiniteLibrary(options: UseLibraryOptions = {}, pageSize = 80) {
  const getKey = (pageIndex: number, previousPageData: LibraryListResponse | null) => {
    if (previousPageData && previousPageData.artifacts.length === 0) return null;
    if (previousPageData && previousPageData.offset + previousPageData.artifacts.length >= previousPageData.total) return null;
    const params = libraryParams(options, pageIndex * pageSize, pageSize);
    return `/api/library?${params.toString()}`;
  };
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<LibraryListResponse>(getKey, fetcher, {
    revalidateFirstPage: false,
  });
  const artifacts = data?.flatMap((page) => page.artifacts) || [];
  const total = data?.[0]?.total || 0;
  const lastPage = data?.[data.length - 1] || null;
  const isLoadingMore = Boolean(isLoading || (size > 0 && data && typeof data[size - 1] === "undefined"));
  const hasMore = Boolean(lastPage && lastPage.offset + lastPage.artifacts.length < lastPage.total);
  const loadMore = () => {
    if (!hasMore || isLoadingMore) return;
    void setSize(size + 1);
  };

  return { artifacts, total, error, isLoading, isLoadingMore, isValidating, hasMore, loadMore, mutate, size, setSize };
}

export function useLibrarySources(options: Pick<UseLibraryOptions, "channel" | "status" | "q"> = {}) {
  const params = new URLSearchParams();
  if (options.channel) params.set("channel", options.channel);
  if (options.status) params.set("status", options.status);
  if (options.q) params.set("q", options.q);
  const key = `/api/library/sources${params.toString() ? `?${params.toString()}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<{ sources: LibrarySourceSummary[] }>(key, fetcher);
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

export function useLibraryHealth() {
  const key = "/api/library/health";
  const { data, error, isLoading, isValidating, mutate } = useSWR<LibraryOperationalHealth>(key, fetcher, {
    refreshInterval: 60_000,
  });
  const refresh = () => mutate(fetcher(`${key}?refresh=${Date.now()}`), { revalidate: false });
  return { health: data || null, error, isLoading, isValidating, mutate, refresh };
}

export async function promoteCandidate(id: string, reason: PromotionReason = "manual_save") {
  const res = await fetch(`/api/library/candidates/${id}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
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

export async function archiveArtifact(id: string) {
  const res = await fetch(`/api/library/${id}/archive`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to archive artifact: ${res.status}`);
  return res.json();
}
