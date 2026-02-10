"use client";

const REMOTE_HOST = "xochipilli.tailc0acaa.ts.net";
const LOCAL_FALLBACK = "http://localhost:3000";
const STORAGE_KEY = "hilt-local-url";

export type Source = "local" | "remote";

export function useSource() {
  const isRemote =
    typeof window !== "undefined" &&
    window.location.hostname === REMOTE_HOST;

  const source: Source = isRemote ? "remote" : "local";
  const remoteUrl = `https://${REMOTE_HOST}`;

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

  function switchSource() {
    if (isRemote) {
      window.location.href = localUrl;
    } else {
      const url = new URL(remoteUrl);
      url.searchParams.set("from", window.location.origin);
      window.location.href = url.toString();
    }
  }

  return { source, switchSource, remoteUrl, localUrl };
}
