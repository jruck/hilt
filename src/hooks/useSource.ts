"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const REMOTE_HOST = process.env.NEXT_PUBLIC_REMOTE_HOST || "";
const LOCAL_FALLBACK = "http://localhost:3000";
const STORAGE_KEY = "hilt-local-url";
const PROBE_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 30000;
const FALLBACK_DELAY_MS = 3000;

export type Source = "local" | "remote";

/** Probe whether the remote server is reachable */
async function probeRemote(): Promise<boolean> {
  if (!REMOTE_HOST) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`https://${REMOTE_HOST}/api/ws-port`, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    // no-cors returns opaque response (status 0) on success, which is fine
    return res.ok || res.type === "opaque";
  } catch {
    return false;
  }
}

export function useSource() {
  const isRemote =
    typeof window !== "undefined" &&
    window.location.hostname === REMOTE_HOST;

  const source: Source = isRemote ? "remote" : "local";
  const remoteUrl = `https://${REMOTE_HOST}`;

  const [remoteAvailable, setRemoteAvailable] = useState<boolean | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On remote: read ?from= param, persist it, strip from URL
  if (isRemote && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (from) {
      try {
        localStorage.setItem(STORAGE_KEY, from);
      } catch {}
      params.delete("from");
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", clean);
    }
  }

  const localUrl = (() => {
    if (typeof window === "undefined") return LOCAL_FALLBACK;
    if (!isRemote) return window.location.origin;
    try {
      return localStorage.getItem(STORAGE_KEY) || LOCAL_FALLBACK;
    } catch {
      return LOCAL_FALLBACK;
    }
  })();

  // Poll remote availability when on local
  useEffect(() => {
    if (typeof window === "undefined") return;

    // No remote host configured — skip polling entirely
    if (!REMOTE_HOST) return;

    // When on remote, we know it's available
    if (isRemote) {
      setRemoteAvailable(true);
      return;
    }

    let mounted = true;

    async function check() {
      const available = await probeRemote();
      if (mounted) setRemoteAvailable(available);
    }

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);

    // Pause polling when tab is hidden
    function handleVisibility() {
      if (document.hidden) return;
      check();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isRemote]);

  // Auto-fallback: when on remote and server health fails, redirect to local
  useEffect(() => {
    if (!isRemote || typeof window === "undefined") return;

    let mounted = true;
    let consecutiveFailures = 0;

    async function check() {
      try {
        const res = await fetch("/api/ws-port", { cache: "no-store" });
        if (res.ok) {
          consecutiveFailures = 0;
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
          return;
        }
      } catch {
        // fetch failed
      }

      consecutiveFailures++;
      // Only fallback after 2 consecutive failures to avoid flaky redirects
      if (consecutiveFailures >= 2 && mounted && !fallbackTimerRef.current) {
        fallbackTimerRef.current = setTimeout(() => {
          window.location.href = localUrl;
        }, FALLBACK_DELAY_MS);
      }
    }

    const interval = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, [isRemote, localUrl]);

  const switchSource = useCallback(async () => {
    setSwitchError(null);

    if (isRemote) {
      window.location.href = localUrl;
      return;
    }

    // Probe remote before switching
    const available = await probeRemote();
    if (!available) {
      setSwitchError("Remote server not responding");
      setRemoteAvailable(false);
      // Clear error after 3s
      setTimeout(() => setSwitchError(null), 3000);
      return;
    }

    const url = new URL(remoteUrl);
    url.searchParams.set("from", window.location.origin);
    window.location.href = url.toString();
  }, [isRemote, localUrl, remoteUrl]);

  return { source, switchSource, remoteUrl, localUrl, remoteAvailable, switchError };
}
