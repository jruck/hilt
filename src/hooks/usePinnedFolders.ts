"use client";

import { useState, useCallback } from "react";
import {
  PinnedFolder,
  getPinnedFolders,
  pinFolder as pinFolderUtil,
  unpinFolder as unpinFolderUtil,
  isPinned as isPinnedUtil,
  findPinnedByPath,
  reorderFolders as reorderFoldersUtil,
} from "@/lib/pinned-folders";

/**
 * Hook for pinned folders CRUD operations
 */
export function usePinnedFolders() {
  // Use lazy initializer to read from localStorage without setState in effect
  const [folders, setFolders] = useState<PinnedFolder[]>(() => {
    if (typeof window === "undefined") return [];
    return getPinnedFolders();
  });
  // Client-side only - will be true after first render
  const [isHydrated] = useState(() => typeof window !== "undefined");

  const pinFolder = useCallback((path: string) => {
    const newFolder = pinFolderUtil(path);
    setFolders(getPinnedFolders());
    return newFolder;
  }, []);

  const unpinFolder = useCallback((id: string) => {
    unpinFolderUtil(id);
    setFolders(getPinnedFolders());
  }, []);

  const isPinned = useCallback((path: string) => {
    return isPinnedUtil(path);
  }, []);

  const togglePin = useCallback((path: string) => {
    const existing = findPinnedByPath(path);
    if (existing) {
      unpinFolderUtil(existing.id);
    } else {
      pinFolderUtil(path);
    }
    setFolders(getPinnedFolders());
  }, []);

  const reorderFolders = useCallback((activeId: string, overId: string) => {
    const reordered = reorderFoldersUtil(activeId, overId);
    setFolders(reordered);
  }, []);

  // Allow external refresh of folders (for cross-component sync)
  const refreshFolders = useCallback(() => {
    setFolders(getPinnedFolders());
  }, []);

  return {
    folders,
    pinFolder,
    unpinFolder,
    isPinned,
    togglePin,
    reorderFolders,
    refreshFolders,
    isHydrated,
  };
}
