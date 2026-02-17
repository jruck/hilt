"use client";

import { useState, useEffect, useCallback } from "react";

interface BriefingSummary {
  date: string;
  title: string;
  summary: string | null;
}

interface BriefingDetail {
  date: string;
  title: string;
  summary: string | null;
  content: string;
}

export function useBriefings() {
  const [briefings, setBriefings] = useState<BriefingSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<BriefingDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  // Fetch briefing list
  const fetchList = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const [listRes, stateRes] = await Promise.all([
        fetch("/api/bridge/briefings"),
        fetch("/api/bridge/briefings/read-state"),
      ]);
      if (!listRes.ok) throw new Error("Failed to fetch briefings");
      const data: BriefingSummary[] = await listRes.json();
      setBriefings(data);

      // Check for unread via server state
      const state = stateRes.ok ? await stateRes.json() : { lastRead: null };
      if (data.length > 0 && data[0].date !== state.lastRead) {
        setHasUnread(true);
      }

      // Auto-select most recent if none selected
      if (!selectedDate && data.length > 0) {
        setSelectedDate(data[0].date);
      }
    } catch (err) {
      console.error("Failed to fetch briefing list:", err);
    } finally {
      setIsLoadingList(false);
    }
  }, [selectedDate]);

  // Fetch single briefing content
  useEffect(() => {
    if (!selectedDate) {
      setBriefing(null);
      return;
    }

    let cancelled = false;
    setIsLoadingContent(true);

    fetch(`/api/bridge/briefings/${selectedDate}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: BriefingDetail) => {
        if (!cancelled) {
          setBriefing(data);
          // Mark as read via server (syncs across devices)
          setHasUnread(false);
          fetch("/api/bridge/briefings/read-state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lastRead: data.date }),
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
  }, [selectedDate]);

  // Fetch list on mount
  useEffect(() => {
    fetchList();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return {
    briefings,
    selectedDate,
    setSelectedDate,
    briefing,
    isLoadingList,
    isLoadingContent,
    hasUnread,
    refresh: fetchList,
  };
}
