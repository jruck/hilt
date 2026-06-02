"use client";

import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type { IngestionReport, LibraryArtifact, LibraryArtifactDetail, LibraryOperationalHealth, LibrarySourceConfig, LibrarySourceSummary, PromotionReason, RecommendedArtifact } from "@/lib/library/types";
import type { ActiveBatchNote, ReviewQueueEntry, ReviewQueueStatus } from "@/lib/library/review-queue";

export type ReviewQueueArtifact = LibraryArtifact & { review: ReviewQueueEntry };

interface ReviewQueueResponse {
  items: ReviewQueueArtifact[];
  total: number;
  notes: ActiveBatchNote[];
}

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((res) => {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
});

export interface UseLibraryOptions {
  source?: string | null;
  channel?: string | null;
  tag?: string | null;
  mode?: string | null;
  status?: string | null;
  unread?: boolean | null;
  q?: string | null;
  limit?: number;
}

interface LibraryListResponse {
  artifacts: LibraryArtifact[];
  total: number;
  unread_total: number;
  offset: number;
  limit: number;
}

function libraryParams(options: UseLibraryOptions, offset?: number, limit?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.channel) params.set("channel", options.channel);
  if (options.tag) params.set("tag", options.tag);
  if (options.mode) params.set("mode", options.mode);
  if (options.status) params.set("status", options.status);
  if (options.unread) params.set("unread", "true");
  if (options.q) params.set("q", options.q);
  params.set("limit", String(limit || options.limit || 80));
  if (typeof offset === "number") params.set("offset", String(offset));
  return params;
}

export function useLibrary(options: UseLibraryOptions = {}) {
  const params = libraryParams(options);
  const { data, error, isLoading, mutate } = useSWR<LibraryListResponse>(`/api/library?${params.toString()}`, fetcher);
  return { artifacts: data?.artifacts || [], total: data?.total || 0, unreadTotal: data?.unread_total || 0, error, isLoading, mutate };
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
  const unreadTotal = data?.[0]?.unread_total || 0;
  const lastPage = data?.[data.length - 1] || null;
  const isLoadingMore = Boolean(isLoading || (size > 0 && data && typeof data[size - 1] === "undefined"));
  const hasMore = Boolean(lastPage && lastPage.offset + lastPage.artifacts.length < lastPage.total);
  const loadMore = () => {
    if (!hasMore || isLoadingMore) return;
    void setSize(size + 1);
  };

  return { artifacts, total, unreadTotal, error, isLoading, isLoadingMore, isValidating, hasMore, loadMore, mutate, size, setSize };
}

export function useLibrarySources(options: Pick<UseLibraryOptions, "channel" | "tag" | "mode" | "status" | "q"> = {}) {
  const params = new URLSearchParams();
  if (options.channel) params.set("channel", options.channel);
  if (options.tag) params.set("tag", options.tag);
  if (options.mode) params.set("mode", options.mode);
  if (options.status) params.set("status", options.status);
  if (options.q) params.set("q", options.q);
  const key = `/api/library/sources${params.toString() ? `?${params.toString()}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<{ sources: LibrarySourceSummary[] }>(key, fetcher);
  return { sources: data?.sources || [], error, isLoading, mutate };
}

export function useLibraryArtifact(id: string | null, artifactPath?: string | null) {
  const key = id
    ? `/api/library/${id}${artifactPath ? `?${new URLSearchParams({ path: artifactPath }).toString()}` : ""}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<LibraryArtifactDetail>(key, fetcher);
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

export function useLibraryUnread() {
  const { data, error, isLoading, mutate } = useSWR<{ has_unread: boolean }>("/api/library/unread", fetcher, {
    refreshInterval: 60_000,
  });
  return { hasUnread: Boolean(data?.has_unread), error, isLoading, mutate };
}

export function useReviewQueue() {
  const { data, error, isLoading, mutate } = useSWR<ReviewQueueResponse>("/api/library/review", fetcher);
  return { items: data?.items || [], total: data?.total || 0, notes: data?.notes || [], error, isLoading, mutate };
}

export async function setReviewStatus(id: string, status: ReviewQueueStatus, note?: string) {
  const res = await fetch("/api/library/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, note }),
  });
  if (!res.ok) throw new Error(`Failed to set review status: ${res.status}`);
  return res.json() as Promise<ReviewQueueEntry>;
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

export async function updateCandidateStatus(id: string, status: "candidate" | "skipped") {
  const res = await fetch(`/api/library/candidates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Failed to update candidate: ${res.status}`);
  return res.json();
}

export async function skipCandidate(id: string) {
  return updateCandidateStatus(id, "skipped");
}

export async function restoreCandidate(id: string) {
  return updateCandidateStatus(id, "candidate");
}

export async function ingestLibrarySources(options: {
  sourceIds?: string[];
  cadence?: LibrarySourceConfig["cadence"];
  useSummarize?: boolean;
  dryRun?: boolean;
  ignoreState?: boolean;
  useCursor?: boolean;
  limit?: number;
} = {}) {
  const res = await fetch("/api/sources/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const body = await res.json().catch(() => null) as IngestionReport | { error?: string } | null;
  if (!res.ok) {
    const reportMessage = body && "blocked" in body && body.blocked.length
      ? body.blocked.map((entry) => `${entry.source_id}: ${entry.reason}`).join("; ")
      : body && "errors" in body && body.errors.length
        ? body.errors.join("; ")
        : null;
    const apiMessage = body && "error" in body && body.error ? body.error : null;
    const message = reportMessage || apiMessage || `Failed to check sources: ${res.status}`;
    throw new Error(message);
  }
  return body as IngestionReport;
}

export async function archiveArtifact(id: string) {
  const res = await fetch(`/api/library/${id}/archive`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to archive artifact: ${res.status}`);
  return res.json();
}

export async function markLibraryArtifactsRead(ids: string[]) {
  const res = await fetch("/api/library/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to mark library artifacts read: ${res.status}`);
  return res.json();
}

export async function markLibraryArtifactsUnread(ids: string[]) {
  const res = await fetch("/api/library/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, unread: true }),
  });
  if (!res.ok) throw new Error(`Failed to mark library artifacts unread: ${res.status}`);
  return res.json();
}
