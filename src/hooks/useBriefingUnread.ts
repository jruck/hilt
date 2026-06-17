"use client";

import { useState, useEffect } from "react";
import { withBasePath } from "@/lib/base-path";

/**
 * Lightweight hook that checks if there's an unread briefing.
 * Read state is stored server-side (briefings/.briefing-state.json)
 * so it syncs across devices via Obsidian Sync.
 */
export function useBriefingUnread() {
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const [listRes, stateRes] = await Promise.all([
          fetch(withBasePath("/api/bridge/briefings")),
          fetch(withBasePath("/api/bridge/briefings/read-state")),
        ]);
        if (!listRes.ok || !stateRes.ok) return;

        const list = await listRes.json();
        const state = await stateRes.json();
        if (cancelled || list.length === 0) return;

        const latestId = list[0].id ?? list[0].date;
        setHasUnread(latestId !== state.lastRead);
      } catch {
        // Silently fail — don't show indicator if we can't check
      }
    }

    check();

    // Re-check when tab becomes visible (user returns to app)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") check();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Listen for briefing-read events (fired by useBriefings when a briefing is viewed)
    function onBriefingRead() {
      setHasUnread(false);
    }
    window.addEventListener("briefing-read", onBriefingRead);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("briefing-read", onBriefingRead);
    };
  }, []);

  const markRead = (date: string) => {
    // Optimistic update
    setHasUnread(false);
    // Persist to server (syncs via Obsidian Sync)
    fetch(withBasePath("/api/bridge/briefings/read-state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastRead: date }),
    }).catch(() => {
      // If server write fails, state will re-check on next visibility change
    });
  };

  return { hasUnread, markRead };
}
