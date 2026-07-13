"use client";

import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import { withBasePath } from "@/lib/base-path";
import type { LedgerEntry } from "@/lib/loops/meeting-ledger";
import type {
  LedgerEventRecord,
  LedgerSurfaceState,
  MeetingExtractionQueueHealth,
  MeetingLedgerCounts,
} from "@/lib/loops/meeting-ledger-store";
import type { TaskFile } from "@/lib/tasks/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meeting ledger request failed: ${response.status}`);
  return response.json() as Promise<T>;
};

export interface MeetingLedgerListItem extends LedgerEntry {
  surface: LedgerSurfaceState;
  last_seen_at: string;
}

export interface MeetingLedgerPage {
  storage: "legacy" | "sqlite";
  items: MeetingLedgerListItem[];
  total: number;
  next_cursor: string | null;
  facets: {
    status: Record<string, number>;
    surface: Record<LedgerSurfaceState, number>;
    owner: Record<string, number>;
  };
}

export interface MeetingLedgerDetail {
  storage: "legacy" | "sqlite";
  entry: LedgerEntry & { surface: LedgerSurfaceState };
  meeting_summary: { date: string; summary: string } | null;
  task: TaskFile | null;
  events: LedgerEventRecord[];
}

export interface MeetingLedgerHealth {
  storage: "legacy" | "sqlite";
  counts: MeetingLedgerCounts;
  recent_context_tokens: number;
  context_chunks: number;
  integrity: string;
  extraction_queue: MeetingExtractionQueueHealth;
}

function useLedgerEvents(onChange: () => void): boolean {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    subscribe("bridge", {});
    const stop = on("bridge", "meeting-ledger-changed", () => changeRef.current());
    return () => { stop(); unsubscribe("bridge"); };
  }, [on, subscribe, unsubscribe]);
  return connected;
}

export function useMeetingLedger(input: { surface?: LedgerSurfaceState | "all"; query?: string; owner?: string; limit?: number }) {
  const params = useMemo(() => {
    const value = new URLSearchParams();
    if (input.surface && input.surface !== "all") value.set("surface", input.surface);
    if (input.query?.trim()) value.set("q", input.query.trim());
    if (input.owner) value.set("owner", input.owner);
    value.set("limit", String(input.limit ?? 50));
    return value;
  }, [input.limit, input.owner, input.query, input.surface]);
  const key = (index: number, previous: MeetingLedgerPage | null) => {
    if (previous && !previous.next_cursor) return null;
    const value = new URLSearchParams(params);
    if (previous?.next_cursor) value.set("cursor", previous.next_cursor);
    return withBasePath(`/api/loops/meeting-ledger?${value}`);
  };
  const swr = useSWRInfinite<MeetingLedgerPage>(key, fetcher, { revalidateFirstPage: false, persistSize: true });
  const connected = useLedgerEvents(() => { void swr.mutate(); });
  useEffect(() => {
    if (connected) return;
    const timer = window.setInterval(() => { void swr.mutate(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [connected, swr.mutate]);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (swr.data ?? []).flatMap((page) => page.items).filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
  }, [swr.data]);
  const first = swr.data?.[0];
  return {
    ...swr,
    items,
    total: first?.total ?? 0,
    facets: first?.facets ?? null,
    hasMore: Boolean(swr.data?.at(-1)?.next_cursor),
    loadMore: () => swr.setSize((size) => size + 1),
    connected,
  };
}

export function useMeetingLedgerDetail(id: string | null) {
  const swr = useSWR<MeetingLedgerDetail>(id ? withBasePath(`/api/loops/meeting-ledger/${encodeURIComponent(id)}`) : null, fetcher);
  const connected = useLedgerEvents(() => { if (id) void swr.mutate(); });
  useEffect(() => {
    if (connected || !id) return;
    const timer = window.setInterval(() => { void swr.mutate(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [connected, id, swr.mutate]);
  return swr;
}

export function useMeetingLedgerHealth() {
  const swr = useSWR<MeetingLedgerHealth>(withBasePath("/api/loops/meeting-ledger/health"), fetcher);
  const connected = useLedgerEvents(() => { void swr.mutate(); });
  useEffect(() => {
    if (connected) return;
    const timer = window.setInterval(() => { void swr.mutate(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [connected, swr.mutate]);
  return swr;
}
