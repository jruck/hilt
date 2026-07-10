"use client";

import { useCallback, useEffect } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type { IngestionReport, LibraryArtifact, LibraryArtifactDetail, LibraryIntakeReport, LibraryOperationalHealth, LibrarySourceConfig, LibrarySourceSummary, PromotionReason, RecommendedArtifact } from "@/lib/library/types";
import type { ActiveBatchNote, ReviewQueueEntry, ReviewQueueStatus } from "@/lib/library/review-queue";
import { withBasePath } from "@/lib/base-path";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

export type ReviewQueueArtifact = LibraryArtifact & { review: ReviewQueueEntry };

interface ReviewQueueResponse {
  items: ReviewQueueArtifact[];
  total: number;
  notes: ActiveBatchNote[];
}

const fetcher = (url: string) => fetch(withBasePath(url), { cache: "no-store" }).then((res) => {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
});

export interface UseLibraryOptions {
  source?: string | null;
  channel?: string | null;
  tag?: string | null;
  series?: string | null;
  mode?: string | null;
  status?: string | null;
  unread?: boolean | null;
  q?: string | null;
  limit?: number;
  surface?: "feed" | null;
  // Eval workbench filters (narrow the feed).
  pipeline_version?: string | null;
  digested_with?: string | null;
  connection_state?: string | null;
  substance_graded?: string | null;
  reweave_pending?: boolean | null;
  lifecycle?: string | null;
  worth_min?: number | null;
  feedback?: string | null;
  youtube_clip_policy?: string | null;
  content_type?: string | null;
}

export interface LibraryFacets {
  total: number;
  facets: Record<string, Record<string, number>>;
  worths: number[];
  muted: Array<{ email: string; name: string }>;
}

interface LibraryListResponse {
  artifacts: LibraryArtifact[];
  total: number;
  unread_total: number;
  offset: number;
  limit: number;
}

interface LibraryArtifactEvent {
  operation: "add" | "change" | "unlink";
  id: string;
  path: string;
}

function useLibraryEvents(
  onArtifactChanged: (event: LibraryArtifactEvent) => void,
  onQueueChanged?: () => void,
): boolean {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();
  useEffect(() => {
    subscribe("library");
    const off = on("library", "artifact-changed", (data) => onArtifactChanged(data as LibraryArtifactEvent));
    const offQueue = onQueueChanged ? on("library", "queue-changed", onQueueChanged) : null;
    return () => {
      off();
      offQueue?.();
      unsubscribe("library");
    };
  }, [on, onArtifactChanged, onQueueChanged, subscribe, unsubscribe]);
  return connected;
}

function libraryParams(options: UseLibraryOptions, offset?: number, limit?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.channel) params.set("channel", options.channel);
  if (options.tag) params.set("tag", options.tag);
  if (options.series) params.set("series", options.series);
  if (options.mode) params.set("mode", options.mode);
  if (options.status) params.set("status", options.status);
  if (options.unread) params.set("unread", "true");
  if (options.q) params.set("q", options.q);
  if (options.pipeline_version) params.set("pipeline_version", options.pipeline_version);
  if (options.digested_with) params.set("digested_with", options.digested_with);
  if (options.connection_state) params.set("connection_state", options.connection_state);
  if (options.substance_graded) params.set("substance_graded", options.substance_graded);
  if (options.reweave_pending != null) params.set("reweave_pending", options.reweave_pending ? "true" : "false");
  if (options.lifecycle) params.set("lifecycle", options.lifecycle);
  if (options.feedback) params.set("feedback", options.feedback);
  if (options.youtube_clip_policy) params.set("youtube_clip_policy", options.youtube_clip_policy);
  if (options.content_type) params.set("content_type", options.content_type);
  if (typeof options.worth_min === "number") params.set("worth_min", String(options.worth_min));
  // Impression attribution: only the Feed view declares itself, so served-event logging
  // (metric 4 baseline) never fires for Browse, agents, or ad-hoc API consumers.
  if (options.surface) params.set("surface", options.surface);
  params.set("limit", String(limit || options.limit || 80));
  if (typeof offset === "number") params.set("offset", String(offset));
  return params;
}

export function useLibraryFacets() {
  const { data } = useSWR<LibraryFacets>("/api/library/workbench", fetcher);
  return { facets: data?.facets || {}, total: data?.total || 0, worths: data?.worths || [], muted: data?.muted || [] };
}

export function useLibrary(options: UseLibraryOptions = {}) {
  const params = libraryParams(options);
  const key = `/api/library?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR<LibraryListResponse>(key, fetcher);
  const onChanged = useCallback(() => { void mutate(); }, [mutate]);
  const connected = useLibraryEvents(onChanged);
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => { void mutate(); }, 5_000);
    return () => clearInterval(timer);
  }, [connected, mutate]);
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
  const onChanged = useCallback(() => { void mutate(); }, [mutate]);
  const connected = useLibraryEvents(onChanged);
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => { void mutate(); }, 5_000);
    return () => clearInterval(timer);
  }, [connected, mutate]);
  const seen = new Set<string>();
  const artifacts = (data?.flatMap((page) => page.artifacts) || []).filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
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
  const onChanged = useCallback((event: LibraryArtifactEvent) => {
    if (event.id === id) void mutate();
  }, [id, mutate]);
  const connected = useLibraryEvents(onChanged);
  useEffect(() => {
    if (connected || !id) return;
    const timer = setInterval(() => { void mutate(); }, 5_000);
    return () => clearInterval(timer);
  }, [connected, id, mutate]);
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
  const onArtifactChanged = useCallback(() => { void mutate(); }, [mutate]);
  const onQueueChanged = useCallback(() => { void mutate(); }, [mutate]);
  useLibraryEvents(onArtifactChanged, onQueueChanged);
  const refresh = () => mutate(fetcher(`${key}?refresh=${Date.now()}`), { revalidate: false });
  return { health: data || null, error, isLoading, isValidating, mutate, refresh };
}

export function useLibraryUnread() {
  const { data, error, isLoading, mutate } = useSWR<{ has_new?: boolean; has_unread: boolean }>("/api/library/unread", fetcher, {
    refreshInterval: 60_000,
  });
  // `hasUnread` now means "new since you last opened Library" (the nav-dot signal), not "unread
  // items exist". markVisited stamps the visit server-side and optimistically clears the dot.
  // Stable identity (mutate is SWR-stable) so a caller can put it in an effect's deps safely.
  const markVisited = useCallback(async () => {
    mutate({ has_new: false, has_unread: false }, { revalidate: false });
    await fetch("/api/library/unread", { method: "POST" }).catch(() => {});
  }, [mutate]);
  return { hasUnread: Boolean(data?.has_new ?? data?.has_unread), error, isLoading, mutate, markVisited };
}

export function useReviewQueue() {
  const { data, error, isLoading, mutate } = useSWR<ReviewQueueResponse>("/api/library/review", fetcher);
  return { items: data?.items || [], total: data?.total || 0, notes: data?.notes || [], error, isLoading, mutate };
}

export async function setReviewStatus(id: string, status: ReviewQueueStatus, note?: string) {
  const res = await fetch(withBasePath("/api/library/review"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, note }),
  });
  if (!res.ok) throw new Error(`Failed to set review status: ${res.status}`);
  return res.json() as Promise<ReviewQueueEntry>;
}

export async function promoteCandidate(id: string, reason: PromotionReason = "manual_save") {
  const res = await fetch(withBasePath(`/api/library/candidates/${id}/promote`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`Failed to promote candidate: ${res.status}`);
  return res.json();
}

export async function updateCandidateStatus(id: string, status: "candidate" | "skipped") {
  const res = await fetch(withBasePath(`/api/library/candidates/${id}`), {
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
  reweaveTimeoutMs?: number;
} = {}) {
  const res = await fetch(withBasePath("/api/sources/ingest"), {
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

export async function intakeLibrarySources(options: { sourceIds?: string[]; limit?: number; force?: boolean } = {}) {
  const res = await fetch(withBasePath("/api/sources/intake"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, force: options.force !== false, explicitOnly: true }),
  });
  const body = await res.json().catch(() => null) as LibraryIntakeReport | { error?: string } | null;
  if (!res.ok) {
    throw new Error(body && "error" in body && body.error ? body.error : `Failed to check sources: ${res.status}`);
  }
  return body as LibraryIntakeReport;
}

export async function retryLibraryProcessing(id: string) {
  const res = await fetch(withBasePath(`/api/library/${id}/processing/retry`), { method: "POST" });
  const body = await res.json().catch(() => null) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error || `Failed to retry processing: ${res.status}`);
  return body;
}

export async function archiveArtifact(id: string) {
  const res = await fetch(withBasePath(`/api/library/${id}/archive`), { method: "POST" });
  if (!res.ok) throw new Error(`Failed to archive artifact: ${res.status}`);
  return res.json();
}

export async function markLibraryArtifactsRead(ids: string[]) {
  const res = await fetch(withBasePath("/api/library/read"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to mark library artifacts read: ${res.status}`);
  return res.json();
}

export async function markLibraryArtifactsUnread(ids: string[]) {
  const res = await fetch(withBasePath("/api/library/read"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, unread: true }),
  });
  if (!res.ok) throw new Error(`Failed to mark library artifacts unread: ${res.status}`);
  return res.json();
}
