"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { SessionStatus, SessionsResponse } from "@/lib/types";
import type { DerivedSessionState } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Custom hook for visibility-aware polling
function useVisibilityAwareInterval(activeInterval: number, hiddenInterval: number) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return isVisible ? activeInterval : hiddenInterval;
}

export function useSessions(scopePath?: string, page = 1, pageSize = 100, showArchived = false) {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  // No polling when connected - rely entirely on WebSocket events
  // Fallback to polling only when WebSocket is disconnected
  const fallbackInterval = useVisibilityAwareInterval(5000, 30000); // 5s visible, 30s hidden
  const refreshInterval = connected ? 0 : fallbackInterval;

  const scopeParam = scopePath ? `&scope=${encodeURIComponent(scopePath)}` : '';
  const archivedParam = showArchived ? '&showArchived=true' : '';
  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    `/api/sessions?page=${page}&pageSize=${pageSize}${scopeParam}${archivedParam}`,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: true,
      keepPreviousData: true, // Prevent loading flash on scope change
    }
  );

  // Subscribe to session events and update data when events arrive
  useEffect(() => {
    if (!connected) return;

    // Subscribe to sessions channel with optional scope filter
    subscribe("sessions", scopePath ? { scope: scopePath } : {});

    // Handle session created events
    const unsubCreated = on("sessions", "created", (eventData: unknown) => {
      const event = eventData as {
        sessionId: string;
        projectFolder: string;
        derivedStatus: DerivedSessionState;
      };
      console.log("[useSessions] Session created event:", event.sessionId);
      // Trigger SWR refetch to get the new session
      mutate();
    });

    // Handle session updated events
    const unsubUpdated = on("sessions", "updated", (eventData: unknown) => {
      const event = eventData as {
        sessionId: string;
        projectFolder: string;
        derivedStatus: DerivedSessionState;
        previousStatus?: DerivedSessionState;
      };
      console.log("[useSessions] Session updated event:", event.sessionId, event.derivedStatus.status);

      // Optimistically update the derived state for the session
      if (data) {
        const sessionExists = data.sessions.some((s) => s.id === event.sessionId);
        if (sessionExists) {
          const updatedSessions = data.sessions.map((s) =>
            s.id === event.sessionId
              ? { ...s, derivedState: event.derivedStatus, isRunning: event.derivedStatus.isRunning }
              : s
          );
          mutate({ ...data, sessions: updatedSessions }, false);
        } else {
          // Session not in our data yet (new session, refetch pending) - trigger refetch
          console.log("[useSessions] Session not found, triggering refetch");
          mutate();
        }
      } else {
        // No data yet, trigger refetch
        mutate();
      }
    });

    // Handle session deleted events
    const unsubDeleted = on("sessions", "deleted", (eventData: unknown) => {
      const event = eventData as {
        sessionId: string;
        projectFolder: string;
      };
      console.log("[useSessions] Session deleted event:", event.sessionId);
      // Trigger SWR refetch to remove the deleted session
      mutate();
    });

    return () => {
      unsubscribe("sessions");
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [connected, scopePath, subscribe, unsubscribe, on, mutate, data]);

  // Re-fetch data when WebSocket reconnects (connected goes from false to true)
  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) {
      console.log("[useSessions] WebSocket reconnected, re-fetching data");
      mutate();
    }
    wasConnectedRef.current = connected;
  }, [connected, mutate]);

  const updateStatus = async (
    sessionId: string,
    status: SessionStatus,
    sortOrder?: number
  ) => {
    // Optimistic update
    if (data) {
      const updatedSessions = data.sessions.map((s) =>
        s.id === sessionId ? { ...s, status, sortOrder: sortOrder ?? s.sortOrder } : s
      );
      mutate({ ...data, sessions: updatedSessions }, false);
    }

    // Send to server
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, status, sortOrder }),
    });

    // Revalidate
    mutate();
  };

  const toggleStarred = async (sessionId: string) => {
    const session = data?.sessions.find((s) => s.id === sessionId);
    const newStarred = !session?.starred;

    // Optimistic update
    if (data) {
      const updatedSessions = data.sessions.map((s) =>
        s.id === sessionId ? { ...s, starred: newStarred } : s
      );
      mutate({ ...data, sessions: updatedSessions }, false);
    }

    // Send to server
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, starred: newStarred }),
    });

    // Revalidate
    mutate();
  };

  const archiveSession = async (sessionId: string) => {
    // Optimistic update - remove from list when not showing archived
    if (data && !showArchived) {
      const updatedSessions = data.sessions.filter((s) => s.id !== sessionId);
      const updatedCounts = {
        ...data.counts,
        recent: data.counts.recent - 1,
        archived: data.counts.archived + 1,
      };
      mutate({ ...data, sessions: updatedSessions, counts: updatedCounts }, false);
    } else if (data) {
      // When showing archived, just mark it as archived
      const updatedSessions = data.sessions.map((s) =>
        s.id === sessionId ? { ...s, archived: true } : s
      );
      mutate({ ...data, sessions: updatedSessions }, false);
    }

    // Send to server
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, archived: true }),
    });

    // Revalidate
    mutate();
  };

  const unarchiveSession = async (sessionId: string) => {
    // Optimistic update
    if (data) {
      const updatedSessions = data.sessions.map((s) =>
        s.id === sessionId ? { ...s, archived: false } : s
      );
      const updatedCounts = {
        ...data.counts,
        recent: data.counts.recent + 1,
        archived: Math.max(0, data.counts.archived - 1),
      };
      mutate({ ...data, sessions: updatedSessions, counts: updatedCounts }, false);
    }

    // Send to server
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, archived: false }),
    });

    // Revalidate
    mutate();
  };

  // Deduplicate sessions by ID (in case of race conditions between API calls)
  const sessions = data?.sessions ?? [];
  const seen = new Set<string>();
  const deduplicatedSessions = sessions.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return {
    sessions: deduplicatedSessions,
    total: data?.total ?? 0,
    counts: data?.counts ?? { inbox: 0, active: 0, recent: 0, archived: 0 },
    isLoading,
    isError: error,
    mutate,
    updateStatus,
    toggleStarred,
    archiveSession,
    unarchiveSession,
  };
}

export function useInboxItems(scopePath?: string) {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  // No polling when connected - rely entirely on WebSocket events
  // Fallback to polling only when WebSocket is disconnected
  const fallbackInterval = useVisibilityAwareInterval(5000, 30000); // 5s visible, 30s hidden
  const refreshInterval = connected ? 0 : fallbackInterval;

  const scopeParam = scopePath ? `?scope=${encodeURIComponent(scopePath)}` : '';
  const { data, error, isLoading, mutate } = useSWR<{
    items: Array<{
      id: string;
      prompt: string;
      completed: boolean;
      section: string | null;
      projectPath: string | null;
      createdAt: string;
      sortOrder: number;
    }>;
    sections: Array<{
      heading: string;
      level: number;
    }>;
    lastModTime: number | null;
  }>(`/api/inbox${scopeParam}`, fetcher, {
    refreshInterval,
    revalidateOnFocus: true, // Refresh when tab becomes active
    keepPreviousData: true, // Prevent loading flash on scope change
  });

  // Subscribe to WebSocket events for real-time updates
  useEffect(() => {
    if (!connected || !scopePath) return;

    // Subscribe to inbox change events for this scope
    subscribe("inbox", { scope: scopePath });

    // Handle inbox changes - refresh the data
    const unsub = on("inbox", "changed", () => {
      mutate();
    });

    return () => {
      unsub();
      unsubscribe("inbox");
    };
  }, [connected, scopePath, subscribe, unsubscribe, on, mutate]);

  // Re-fetch data when WebSocket reconnects
  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) {
      console.log("[useInboxItems] WebSocket reconnected, re-fetching data");
      mutate();
    }
    wasConnectedRef.current = connected;
  }, [connected, mutate]);

  const createItem = async (prompt: string, section?: string | null) => {
    const response = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, section, scope: scopePath }),
    });
    const result = await response.json();
    mutate();
    return result.id;
  };

  const updateItem = async (
    id: string,
    prompt?: string,
    completed?: boolean,
    section?: string | null
  ) => {
    await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, prompt, completed, section, scope: scopePath }),
    });
    mutate();
  };

  const deleteItem = async (id: string) => {
    const scopeParam = scopePath ? `&scope=${encodeURIComponent(scopePath)}` : '';
    await fetch(`/api/inbox?id=${id}${scopeParam}`, { method: "DELETE" });
    mutate();
  };

  const reorderSections = async (sectionOrder: string[]) => {
    // Optimistic update
    if (data) {
      const reorderedSections = sectionOrder
        .map(heading => data.sections.find(s => s.heading === heading))
        .filter((s): s is { heading: string; level: number } => s !== undefined);
      mutate({ ...data, sections: reorderedSections }, false);
    }

    await fetch("/api/inbox", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionOrder, scope: scopePath }),
    });
    mutate();
  };

  const reorderItem = async (
    itemId: string,
    targetSection: string | null,
    targetIndex: number
  ) => {
    // Optimistic update
    if (data) {
      const items = [...data.items];
      const itemIndex = items.findIndex((i) => i.id === itemId);
      if (itemIndex !== -1) {
        const [item] = items.splice(itemIndex, 1);
        item.section = targetSection;

        // Find items in target section to compute insertion point
        const targetItems = items.filter((i) => i.section === targetSection);

        // Find where to insert in the flat array
        if (targetItems.length === 0) {
          // No items in target section, find first item of next section or append
          const sectionOrder = data.sections.map((s) => s.heading);
          const targetIdx = targetSection ? sectionOrder.indexOf(targetSection) : -1;

          if (targetSection === null) {
            // Insert at beginning (orphan items come first)
            items.unshift(item);
          } else if (targetIdx === -1 || targetIdx === sectionOrder.length - 1) {
            items.push(item);
          } else {
            // Find first item of next section
            const nextSection = sectionOrder[targetIdx + 1];
            const nextIdx = items.findIndex((i) => i.section === nextSection);
            if (nextIdx !== -1) {
              items.splice(nextIdx, 0, item);
            } else {
              items.push(item);
            }
          }
        } else {
          // Insert relative to existing items in section
          const clampedIndex = Math.min(targetIndex, targetItems.length);
          if (clampedIndex >= targetItems.length) {
            // Insert after last item in section
            const lastItemInSection = targetItems[targetItems.length - 1];
            const lastIdx = items.findIndex((i) => i.id === lastItemInSection.id);
            items.splice(lastIdx + 1, 0, item);
          } else {
            // Insert before the item at targetIndex
            const targetItem = targetItems[clampedIndex];
            const insertIdx = items.findIndex((i) => i.id === targetItem.id);
            items.splice(insertIdx, 0, item);
          }
        }

        mutate({ ...data, items }, false);
      }
    }

    await fetch("/api/inbox", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemReorder: { itemId, targetSection, targetIndex },
        scope: scopePath,
      }),
    });
    mutate();
  };

  return {
    items: data?.items ?? [],
    sections: data?.sections ?? [],
    lastModTime: data?.lastModTime ?? null,
    isLoading,
    isError: error,
    mutate,
    createItem,
    updateItem,
    deleteItem,
    reorderSections,
    reorderItem,
  };
}
