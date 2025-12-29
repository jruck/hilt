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

  return {
    sessions: data?.sessions ?? [],
    total: data?.total ?? 0,
    isLoading,
    isError: error,
    mutate,
    updateStatus,
  };
}

export function useInboxItems() {
  const { data, error, isLoading, mutate } = useSWR<{
    items: Array<{
      id: string;
      prompt: string;
      projectPath: string | null;
      createdAt: string;
      sortOrder: number;
    }>;
  }>("/api/inbox", fetcher, {
    refreshInterval: 5000,
  });

  const createItem = async (prompt: string, projectPath?: string) => {
    const response = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, projectPath }),
    });
    const result = await response.json();
    mutate();
    return result.id;
  };

  const updateItem = async (id: string, prompt?: string, sortOrder?: number) => {
    await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, prompt, sortOrder }),
    });
    mutate();
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/inbox?id=${id}`, { method: "DELETE" });
    mutate();
  };

  return {
    items: data?.items ?? [],
    isLoading,
    isError: error,
    mutate,
    createItem,
    updateItem,
    deleteItem,
  };
}
