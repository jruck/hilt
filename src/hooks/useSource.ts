"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Source } from "@/lib/types";

const LOCAL_FALLBACK = "http://localhost:3000";
const STORAGE_KEY = "hilt-local-url";
const PROBE_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 30000;
const FALLBACK_DELAY_MS = 3000;

/** Probe whether a source URL is reachable */
async function probeUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${url}/api/ws-port`, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || res.type === "opaque";
  } catch {
    return false;
  }
}

/** Normalize URL for comparison (strip trailing slash, lowercase hostname) */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

export interface SourceWithStatus extends Source {
  available: boolean | null; // null = unknown/checking
  isActive: boolean;
}

export function useSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [availability, setAvailability] = useState<Record<string, boolean | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef(0);

  const currentOrigin = typeof window !== "undefined" ? normalizeUrl(window.location.origin) : "";

  // Handle ?from= param on load (save local URL when arriving at remote)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (from) {
      try { localStorage.setItem(STORAGE_KEY, from); } catch {}
      params.delete("from");
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", clean);
    }
  }, []);

  // Fetch sources from API
  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/sources");
      if (res.ok) {
        const data: Source[] = await res.json();
        setSources(data);
        setLoaded(true);
        return data;
      }
    } catch {
      // API not available
    }
    setLoaded(true);
    return [];
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // Self-heal: if running on localhost but no source URL matches (e.g. port changed),
  // update the first local source's URL to match the actual origin
  useEffect(() => {
    if (!loaded || sources.length === 0 || !currentOrigin) return;
    const isLocalhost = currentOrigin.includes("localhost") || currentOrigin.includes("127.0.0.1");
    if (!isLocalhost) return;

    const hasMatch = sources.some(s => normalizeUrl(s.url) === currentOrigin);
    if (hasMatch) return;

    const localSource = sources.find(s => s.type === "local");
    if (!localSource) return;

    // Port drifted — update the source URL to match where we're actually running
    const actualOrigin = window.location.origin;
    console.log(`[useSource] Port drift detected: updating ${localSource.name} URL from ${localSource.url} to ${actualOrigin}`);
    fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: localSource.id, url: actualOrigin }),
    }).then(res => {
      if (res.ok) fetchSources();
    });
  }, [loaded, sources, currentOrigin, fetchSources]);

  // Determine active source
  const activeSource = sources.find(s => normalizeUrl(s.url) === currentOrigin) ?? null;

  // Poll availability of non-active sources
  useEffect(() => {
    if (typeof window === "undefined" || sources.length === 0) return;

    let mounted = true;

    async function checkAll() {
      for (const source of sources) {
        if (normalizeUrl(source.url) === currentOrigin) {
          // Active source is inherently available
          if (mounted) setAvailability(prev => ({ ...prev, [source.id]: true }));
          continue;
        }
        if (source.type === "local") {
          // Local sources are always "available" — localhost resolves to the
          // physical machine you're on, so probing from a remote context is
          // meaningless. Always let users click Local to return home.
          if (mounted) setAvailability(prev => ({ ...prev, [source.id]: true }));
          continue;
        }
        const available = await probeUrl(source.url);
        if (mounted) {
          setAvailability(prev => ({ ...prev, [source.id]: available }));
        }
      }
    }

    checkAll();
    const interval = setInterval(checkAll, POLL_INTERVAL_MS);

    function handleVisibility() {
      if (!document.hidden) checkAll();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [sources, currentOrigin]);

  // Auto-fallback: if on a remote source and it goes down, redirect to a local
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeSource || activeSource.type === "local") return;

    let mounted = true;

    async function check() {
      try {
        const res = await fetch("/api/ws-port", { cache: "no-store" });
        if (res.ok) {
          consecutiveFailuresRef.current = 0;
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
          return;
        }
      } catch {
        // fetch failed
      }

      consecutiveFailuresRef.current++;
      if (consecutiveFailuresRef.current >= 2 && mounted && !fallbackTimerRef.current) {
        // Find fallback: topmost local, then topmost remote, then hardcoded
        const activeId = activeSource?.id;
        const sorted = [...sources].sort((a, b) => a.rank - b.rank);
        const fallback =
          sorted.find(s => s.type === "local" && s.id !== activeId) ??
          sorted.find(s => s.type === "remote" && s.id !== activeId) ??
          null;
        const fallbackUrl = fallback?.url ?? LOCAL_FALLBACK;

        fallbackTimerRef.current = setTimeout(() => {
          window.location.href = fallbackUrl;
        }, FALLBACK_DELAY_MS);
      }
    }

    const interval = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, [activeSource, sources]);

  // Switch to a specific source
  const switchTo = useCallback(async (sourceId: string) => {
    setSwitchError(null);
    const target = sources.find(s => s.id === sourceId);
    if (!target) return;

    // If already on this source, no-op
    if (normalizeUrl(target.url) === currentOrigin) return;

    // Probe before switching
    const available = await probeUrl(target.url);
    if (!available) {
      setSwitchError(`${target.name} not responding`);
      setAvailability(prev => ({ ...prev, [target.id]: false }));
      setTimeout(() => setSwitchError(null), 3000);
      return;
    }

    // If switching to remote, pass local origin as ?from=
    const url = new URL(target.url);
    if (target.type === "remote") {
      url.searchParams.set("from", window.location.origin);
    }
    window.location.href = url.toString();
  }, [sources, currentOrigin]);

  // CRUD wrappers
  const addSourceApi = useCallback(async (name: string, url: string, type: "local" | "remote", folder?: string) => {
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url, type, folder }),
    });
    if (res.ok) {
      await fetchSources();
    }
  }, [fetchSources]);

  const updateSourceApi = useCallback(async (id: string, updates: Partial<Pick<Source, "name" | "url" | "type" | "folder">>) => {
    const res = await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) {
      await fetchSources();
    }
  }, [fetchSources]);

  const removeSource = useCallback(async (id: string) => {
    const res = await fetch(`/api/sources?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchSources();
    }
  }, [fetchSources]);

  const reorderSourcesApi = useCallback(async (orderedIds: string[]) => {
    const res = await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", orderedIds }),
    });
    if (res.ok) {
      const data = await res.json();
      setSources(data);
    }
  }, []);

  // Build enriched source list
  const sourcesWithStatus: SourceWithStatus[] = sources.map(s => ({
    ...s,
    available: availability[s.id] ?? null,
    isActive: normalizeUrl(s.url) === currentOrigin,
  }));

  const isUnconfigured = loaded && sources.length === 0;

  // Smart hint: detect if running at an origin that doesn't match any source
  const portMismatch = loaded && sources.length > 0 && !activeSource;

  // For backwards compat: derive simple source type
  const source: "local" | "remote" = activeSource?.type ?? "local";

  // Derive localUrl for backwards compat
  const localUrl = (() => {
    if (typeof window === "undefined") return LOCAL_FALLBACK;
    if (source === "local") return window.location.origin;
    try {
      return localStorage.getItem(STORAGE_KEY) || LOCAL_FALLBACK;
    } catch {
      return LOCAL_FALLBACK;
    }
  })();

  return {
    // Core multi-source state
    sources: sourcesWithStatus,
    activeSource,
    loaded,
    isUnconfigured,
    portMismatch,
    switchError,

    // Actions
    switchTo,
    addSource: addSourceApi,
    updateSource: updateSourceApi,
    removeSource,
    reorderSources: reorderSourcesApi,
    refetchSources: fetchSources,

    // Backwards-compatible fields
    source,
    localUrl,
  };
}
