"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR, { mutate } from "swr";

export interface PinnedFolder {
  id: string;
  path: string;
  name: string;
  pinnedAt: number;
  emoji?: string;
}

const CACHE_KEY = "/api/preferences?key=pinnedFolders";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

/**
 * Hook for pinned folders CRUD operations
 * Now uses server-side storage via API instead of localStorage
 */
export function usePinnedFolders() {
  const { data: folders = [], isLoading, error } = useSWR<PinnedFolder[]>(
    CACHE_KEY,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const [isHydrated, setIsHydrated] = useState(false);

  // Mark as hydrated once we have data
  useEffect(() => {
    if (!isLoading) {
      setIsHydrated(true);
    }
  }, [isLoading]);

  const pinFolder = useCallback(async (path: string): Promise<PinnedFolder> => {
    const res = await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pinFolder", path }),
    });
    const newFolder = await res.json();

    // Optimistically update the cache
    mutate(CACHE_KEY);

    return newFolder;
  }, []);

  const unpinFolder = useCallback(async (id: string): Promise<void> => {
    // Optimistically update the cache
    mutate(
      CACHE_KEY,
      (current: PinnedFolder[] | undefined) =>
        current?.filter((f) => f.id !== id) ?? [],
      false
    );

    await fetch(`/api/preferences?action=unpinFolder&id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    // Revalidate
    mutate(CACHE_KEY);
  }, []);

  const isPinned = useCallback(
    (path: string): boolean => {
      return folders.some((f) => f.path === path);
    },
    [folders]
  );

  const togglePin = useCallback(
    async (path: string): Promise<void> => {
      const existing = folders.find((f) => f.path === path);
      if (existing) {
        await unpinFolder(existing.id);
      } else {
        await pinFolder(path);
      }
    },
    [folders, unpinFolder, pinFolder]
  );

  const reorderFolders = useCallback(
    async (activeId: string, overId: string): Promise<void> => {
      // Optimistically reorder
      mutate(
        CACHE_KEY,
        (current: PinnedFolder[] | undefined) => {
          if (!current) return [];
          const folders = [...current];
          const activeIndex = folders.findIndex((f) => f.id === activeId);
          const overIndex = folders.findIndex((f) => f.id === overId);
          if (activeIndex === -1 || overIndex === -1) return current;

          const [removed] = folders.splice(activeIndex, 1);
          folders.splice(overIndex, 0, removed);
          return folders;
        },
        false
      );

      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorderPinnedFolders",
          activeId,
          overId,
        }),
      });

      // Revalidate
      mutate(CACHE_KEY);
    },
    []
  );

  const refreshFolders = useCallback(() => {
    mutate(CACHE_KEY);
  }, []);

  const setEmoji = useCallback(
    async (id: string, emoji: string | null): Promise<void> => {
      // Optimistically update the cache
      mutate(
        CACHE_KEY,
        (current: PinnedFolder[] | undefined) => {
          if (!current) return [];
          return current.map((f) =>
            f.id === id
              ? { ...f, emoji: emoji === null ? undefined : emoji }
              : f
          );
        },
        false
      );

      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setFolderEmoji",
          id,
          emoji,
        }),
      });

      // Revalidate
      mutate(CACHE_KEY);
    },
    []
  );

  return {
    folders,
    pinFolder,
    unpinFolder,
    isPinned,
    togglePin,
    reorderFolders,
    refreshFolders,
    setEmoji,
    isHydrated,
    isLoading,
    error,
  };
}
