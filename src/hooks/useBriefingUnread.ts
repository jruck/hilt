"use client";

import { useState, useEffect } from "react";

const LAST_READ_KEY = "hilt-briefing-last-read";

/**
 * Lightweight hook that checks if there's an unread briefing.
 * Polls the briefing list API on mount and when the tab becomes visible.
 */
export function useBriefingUnread() {
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/bridge/briefings");
        if (!res.ok) return;
        const list = await res.json();
        if (cancelled || list.length === 0) return;

        const latestDate = list[0].date;
        const lastRead = localStorage.getItem(LAST_READ_KEY);
        setHasUnread(latestDate !== lastRead);
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
    localStorage.setItem(LAST_READ_KEY, date);
    setHasUnread(false);
  };

  return { hasUnread, markRead };
}
