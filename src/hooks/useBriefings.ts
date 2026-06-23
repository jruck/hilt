"use client";

import { useState, useEffect, useCallback } from "react";
import { withBasePath } from "@/lib/base-path";

export type BriefingKind = "daily" | "weekend";

export interface BriefingDateRange {
  start: string;
  end: string;
}

export interface BriefingSummary {
  id: string;
  kind: BriefingKind;
  date: string;
  title: string;
  summary: string | null;
  dateRange?: BriefingDateRange;
  status?: "ready" | "failed";
  run?: BriefingRunFailure;
}

interface BriefingDetail extends BriefingSummary {
  content: string;
  /** Absolute path to the briefing file (from the API) — for per-item Copy reference. */
  absPath?: string;
}

interface LegacyBriefingDetail {
  date: string;
  title: string;
  summary: string | null;
  content: string;
  status?: "ready" | "failed";
  run?: BriefingRunFailure;
}

export interface BriefingRunFailure {
  status: "failed";
  kind: "quota" | "rate_limit" | "model" | "unknown";
  date: string;
  jobId: string;
  jobName: string;
  runAt: string;
  nextRunAt: string | null;
  autoRetryNextRunAt: string | null;
  error: string;
  outputPath: string | null;
}

export function useBriefings() {
  const [briefings, setBriefings] = useState<BriefingSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<BriefingDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [retryStatus, setRetryStatus] = useState<"idle" | "queued" | "error">("idle");
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  // Fetch briefing list
  const fetchList = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const [listRes, stateRes] = await Promise.all([
        fetch(withBasePath("/api/bridge/briefings")),
        fetch(withBasePath("/api/bridge/briefings/read-state")),
      ]);
      if (!listRes.ok) throw new Error("Failed to fetch briefings");
      const rawData: Array<BriefingSummary | Omit<BriefingSummary, "id" | "kind">> = await listRes.json();
      const data: BriefingSummary[] = rawData.map((item) => "id" in item ? item : {
        ...item,
        id: item.date,
        kind: "daily",
      });
      setBriefings(data);

      // Check for unread via server state
      const state = stateRes.ok ? await stateRes.json() : { lastRead: null };
      if (data.length > 0 && data[0].id !== state.lastRead) {
        setHasUnread(true);
      }

      // Auto-select most recent if none selected
      if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch briefing list:", err);
    } finally {
      setIsLoadingList(false);
    }
  }, [selectedId]);

  const retryBriefing = useCallback(async () => {
    const id = briefing?.id ?? selectedId;
    if (!id) return;

    setRetryStatus("idle");
    setRetryMessage(null);
    try {
      const res = await fetch(withBasePath("/api/bridge/briefings/retry"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to queue retry");
      }
      setRetryStatus("queued");
      setRetryMessage(data?.message || "Retry queued for Hermes.");
      fetchList();
    } catch (err) {
      setRetryStatus("error");
      setRetryMessage(err instanceof Error ? err.message : "Failed to queue retry");
    }
  }, [briefing?.id, fetchList, selectedId]);

  // Fetch single briefing content
  useEffect(() => {
    if (!selectedId) {
      setBriefing(null);
      return;
    }

    let cancelled = false;
    setIsLoadingContent(true);

    fetch(withBasePath(`/api/bridge/briefings/${encodeURIComponent(selectedId)}`))
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: BriefingDetail | LegacyBriefingDetail) => {
        if (!cancelled) {
          const normalized: BriefingDetail = "id" in data ? data : {
            ...data,
            id: data.date,
            kind: "daily",
          };
          setBriefing(normalized);
          // Mark as read via server (syncs across devices)
          setHasUnread(false);
          fetch(withBasePath("/api/bridge/briefings/read-state"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lastRead: normalized.id }),
          }).catch(() => {});
          window.dispatchEvent(new Event("briefing-read"));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch briefing:", err);
          setBriefing(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingContent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Fetch list on mount
  useEffect(() => {
    fetchList();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return {
    briefings,
    selectedId,
    setSelectedId,
    briefing,
    isLoadingList,
    isLoadingContent,
    hasUnread,
    retryBriefing,
    retryStatus,
    retryMessage,
    refresh: fetchList,
  };
}
