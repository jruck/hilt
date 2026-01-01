"use client";

import useSWR from "swr";
import { Session, SessionStatus, SessionsResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useSessions(scopePath?: string, page = 1, pageSize = 100) {
  const scopeParam = scopePath ? `&scope=${encodeURIComponent(scopePath)}` : '';
  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    `/api/sessions?page=${page}&pageSize=${pageSize}${scopeParam}`,
    fetcher,
    {
      refreshInterval: 5000, // Refresh every 5 seconds
      revalidateOnFocus: true,
      keepPreviousData: true, // Prevent loading flash on scope change
    }
  );

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

  return {
    sessions: data?.sessions ?? [],
    total: data?.total ?? 0,
    counts: data?.counts ?? { inbox: 0, active: 0, recent: 0 },
    isLoading,
    isError: error,
    mutate,
    updateStatus,
    toggleStarred,
  };
}

export function useInboxItems(scopePath?: string) {
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
    refreshInterval: 2000, // Poll every 2 seconds to detect external file changes
    keepPreviousData: true, // Prevent loading flash on scope change
  });

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
  };
}
