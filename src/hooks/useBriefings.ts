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

const LAST_READ_KEY = "hilt-briefing-last-read";

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
      const res = await fetch("/api/bridge/briefings");
      if (!res.ok) throw new Error("Failed to fetch briefings");
      const data: BriefingSummary[] = await res.json();
      setBriefings(data);

      // Check for unread
      const lastRead = localStorage.getItem(LAST_READ_KEY);
      if (data.length > 0 && data[0].date !== lastRead) {
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
          // Mark as read
          localStorage.setItem(LAST_READ_KEY, data.date);
          setHasUnread(false);
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
