import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import type { DocsTreeResponse, DocsFileResponse, FileNode } from "@/lib/types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to fetch");
  }
  return res.json();
};

// Visibility-aware refresh interval
function useVisibilityAwareInterval(activeInterval: number, hiddenInterval: number) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return isVisible ? activeInterval : hiddenInterval;
}

// localStorage keys for expanded paths
const EXPANDED_PATHS_KEY = "docs-expanded-paths";

function getStoredExpandedPaths(scope: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(EXPANDED_PATHS_KEY);
    if (!stored) return new Set();
    const data = JSON.parse(stored);
    return new Set(data[scope] || []);
  } catch {
    return new Set();
  }
}

function setStoredExpandedPaths(scope: string, paths: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const stored = localStorage.getItem(EXPANDED_PATHS_KEY);
    const data = stored ? JSON.parse(stored) : {};
    data[scope] = Array.from(paths);
    localStorage.setItem(EXPANDED_PATHS_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

export interface UseDocsResult {
  // Tree state
  tree: FileNode | null;
  treeLoading: boolean;
  treeError: Error | null;
  treeModTime: number | null;
  refreshTree: () => void;

  // Expanded folders
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  expandPath: (path: string) => void;
  collapsePath: (path: string) => void;

  // Selected file
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;

  // File content
  fileContent: string | null;
  fileLoading: boolean;
  fileError: Error | null;
  fileMeta: {
    isBinary: boolean;
    isViewable: boolean;
    mimeType: string;
    size: number;
    modTime: number;
  } | null;
  refreshFile: () => void;

  // Edit state
  isEditMode: boolean;
  setEditMode: (mode: boolean) => void;
  editedContent: string | null;
  setEditedContent: (content: string | null) => void;
  hasUnsavedChanges: boolean;

  // Save
  saveFile: () => Promise<{ success: boolean; error?: string }>;
  isSaving: boolean;
}

export function useDocs(scopePath: string | null): UseDocsResult {
  // Visibility-aware polling: 5s active, 30s hidden
  const treeRefreshInterval = useVisibilityAwareInterval(5000, 30000);

  // Tree data
  const {
    data: treeData,
    error: treeError,
    isLoading: treeLoading,
    mutate: mutateTree,
  } = useSWR<DocsTreeResponse>(
    scopePath ? `/api/docs/tree?scope=${encodeURIComponent(scopePath)}` : null,
    fetcher,
    { refreshInterval: treeRefreshInterval, keepPreviousData: true }
  );

  // Expanded paths state
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    scopePath ? getStoredExpandedPaths(scopePath) : new Set()
  );

  // Sync expanded paths with scope changes
  useEffect(() => {
    if (scopePath) {
      setExpandedPaths(getStoredExpandedPaths(scopePath));
    }
  }, [scopePath]);

  // Persist expanded paths on change
  useEffect(() => {
    if (scopePath) {
      setStoredExpandedPaths(scopePath, expandedPaths);
    }
  }, [scopePath, expandedPaths]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandPath = useCallback((path: string) => {
    setExpandedPaths((prev) => new Set([...prev, path]));
  }, []);

  const collapsePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  // Selected file
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Edit mode
  const [isEditMode, setEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // File content - only poll when not in edit mode
  const fileRefreshInterval = useVisibilityAwareInterval(5000, 30000);
  const {
    data: fileData,
    error: fileError,
    isLoading: fileLoading,
    mutate: mutateFile,
  } = useSWR<DocsFileResponse>(
    selectedPath && scopePath
      ? `/api/docs/file?path=${encodeURIComponent(selectedPath)}&scope=${encodeURIComponent(scopePath)}`
      : null,
    fetcher,
    {
      refreshInterval: isEditMode ? 0 : fileRefreshInterval, // Don't poll while editing
      keepPreviousData: true,
    }
  );

  // Reset edit state when file changes
  useEffect(() => {
    setEditedContent(null);
    setEditMode(false);
  }, [selectedPath]);

  // Check for unsaved changes
  const hasUnsavedChanges = editedContent !== null && editedContent !== fileData?.content;

  // Save file
  const saveFile = useCallback(async () => {
    if (!selectedPath || !scopePath || editedContent === null) {
      return { success: false, error: "No content to save" };
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/docs/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedPath,
          content: editedContent,
          scope: scopePath,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Clear edited content and refresh file data
        setEditedContent(null);
        await mutateFile();
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      setIsSaving(false);
    }
  }, [selectedPath, scopePath, editedContent, mutateFile]);

  return {
    // Tree
    tree: treeData?.root ?? null,
    treeLoading,
    treeError: treeError ?? null,
    treeModTime: treeData?.modTime ?? null,
    refreshTree: () => mutateTree(),

    // Expanded
    expandedPaths,
    toggleExpanded,
    expandPath,
    collapsePath,

    // Selected
    selectedPath,
    setSelectedPath,

    // File content
    fileContent: fileData?.content ?? null,
    fileLoading,
    fileError: fileError ?? null,
    fileMeta: fileData
      ? {
          isBinary: fileData.isBinary,
          isViewable: fileData.isViewable,
          mimeType: fileData.mimeType,
          size: fileData.size,
          modTime: fileData.modTime,
        }
      : null,
    refreshFile: () => mutateFile(),

    // Edit
    isEditMode,
    setEditMode,
    editedContent,
    setEditedContent,
    hasUnsavedChanges,

    // Save
    saveFile,
    isSaving,
  };
}
