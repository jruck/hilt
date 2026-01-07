"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Session, SessionStatus } from "@/lib/types";
import * as tauri from "@/lib/tauri";

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

export function useSessions(scopePath?: string, _page = 1, _pageSize = 100) {
  const refreshInterval = useVisibilityAwareInterval(5000, 30000); // 5s visible, 30s hidden
  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState({ inbox: 0, active: 0, recent: 0, running: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await tauri.getSessions(scopePath);
      // Map Tauri response to frontend Session type
      const mappedSessions: Session[] = response.sessions.map(s => ({
        id: s.id,
        title: s.title,
        project: s.project,
        projectPath: s.projectPath || "",
        lastActivity: new Date(s.updatedAt),
        messageCount: s.messageCount,
        gitBranch: s.gitBranch || null,
        firstPrompt: s.firstPrompt || null,
        lastPrompt: s.lastPrompt || null,
        slug: s.slug || null,
        slugs: s.slugs,
        status: s.status,
        sortOrder: s.sortOrder,
        starred: s.starred,
        isRunning: s.isRunning,
        planSlugs: s.planSlugs,
        terminalId: s.terminalId,
      }));

      // Deduplicate sessions by ID
      const seen = new Set<string>();
      const deduplicatedSessions = mappedSessions.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      setSessions(deduplicatedSessions);
      setCounts(response.counts);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [scopePath]);

  // Initial fetch and polling
  useEffect(() => {
    fetchSessions();

    intervalRef.current = setInterval(fetchSessions, refreshInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchSessions, refreshInterval]);

  // Listen for file change events from Tauri
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    tauri.onFileChanged((event) => {
      if (event.fileType === "session") {
        fetchSessions();
      }
    }).then(fn => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [fetchSessions]);

  const updateStatus = async (
    sessionId: string,
    status: SessionStatus,
    sortOrder?: number
  ) => {
    // Optimistic update
    setSessions(prev =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, status, sortOrder: sortOrder ?? s.sortOrder } : s
      )
    );

    // Send to Tauri backend
    await tauri.updateSessionStatus(sessionId, status, sortOrder);

    // Revalidate
    fetchSessions();
  };

  const toggleStarred = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    const newStarred = !session?.starred;

    // Optimistic update
    setSessions(prev =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, starred: newStarred } : s
      )
    );

    // Send to Tauri backend
    await tauri.updateSessionStatus(sessionId, undefined, undefined, newStarred);

    // Revalidate
    fetchSessions();
  };

  return {
    sessions,
    total: sessions.length,
    counts,
    isLoading,
    isError: error,
    mutate: fetchSessions,
    updateStatus,
    toggleStarred,
  };
}

export function useInboxItems(scopePath?: string) {
  const refreshInterval = useVisibilityAwareInterval(5000, 30000); // 5s visible, 30s hidden
  const [items, setItems] = useState<Array<{
    id: string;
    prompt: string;
    completed: boolean;
    section: string | null;
    projectPath: string | null;
    createdAt: string;
    sortOrder: number;
  }>>([]);
  const [sections, setSections] = useState<Array<{
    heading: string;
    level: number;
  }>>([]);
  const [lastModTime, setLastModTime] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchInbox = useCallback(async () => {
    if (!scopePath) {
      setItems([]);
      setSections([]);
      setLastModTime(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await tauri.getInbox(scopePath);
      // Map sections to the expected format
      const mappedItems = response.sections.flatMap(section =>
        section.items.map(item => ({
          id: item.id,
          prompt: item.content,
          completed: false,
          section: section.name || null,
          projectPath: scopePath,
          createdAt: item.createdAt,
          sortOrder: 0,
        }))
      );
      const mappedSections = response.sections.map(s => ({
        heading: s.name,
        level: 2,
      }));

      setItems(mappedItems);
      setSections(mappedSections);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [scopePath]);

  // Initial fetch and polling
  useEffect(() => {
    fetchInbox();

    intervalRef.current = setInterval(fetchInbox, refreshInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchInbox, refreshInterval]);

  // Listen for file change events from Tauri
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    tauri.onFileChanged((event) => {
      if (event.fileType === "inbox" || event.fileType === "todo") {
        fetchInbox();
      }
    }).then(fn => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [fetchInbox]);

  const createItem = async (prompt: string, section?: string | null) => {
    if (!scopePath) return "";

    const result = await tauri.addInboxItem(scopePath, section || "Inbox", prompt);
    fetchInbox();
    return result.id;
  };

  const updateItem = async (
    id: string,
    prompt?: string,
    _completed?: boolean,
    section?: string | null
  ) => {
    if (!scopePath) return;

    if (prompt !== undefined) {
      await tauri.updateInboxItem(scopePath, id, prompt);
    }
    if (section !== undefined) {
      await tauri.moveInboxItem(scopePath, id, section || "Inbox");
    }
    fetchInbox();
  };

  const deleteItem = async (id: string) => {
    if (!scopePath) return;

    await tauri.deleteInboxItem(scopePath, id);
    fetchInbox();
  };

  const reorderSections = async (_sectionOrder: string[]) => {
    // Section reordering is handled by the markdown file structure
    // This would require updating the Todo.md file order
    fetchInbox();
  };

  const reorderItem = async (
    itemId: string,
    targetSection: string | null,
    _targetIndex: number
  ) => {
    if (!scopePath) return;

    // Move item to target section
    await tauri.moveInboxItem(scopePath, itemId, targetSection || "Inbox");
    fetchInbox();
  };

  return {
    items,
    sections,
    lastModTime,
    isLoading,
    isError: error,
    mutate: fetchInbox,
    createItem,
    updateItem,
    deleteItem,
    reorderSections,
    reorderItem,
  };
}
