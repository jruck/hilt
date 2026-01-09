import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import type { DocsTreeResponse, DocsFileResponse, FileNode } from "@/lib/types";
import { useEventSocketContext } from "@/contexts/EventSocketContext";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to fetch");
  }
  return res.json();
};

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
  // Event socket for real-time updates
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();

  // Track selected path in ref for event handler (avoids stale closure)
  const selectedPathRef = useRef<string | null>(null);

  // Tree data - no polling, updated via WebSocket events
  const {
    data: treeData,
    error: treeError,
    isLoading: treeLoading,
    mutate: mutateTree,
  } = useSWR<DocsTreeResponse>(
    scopePath ? `/api/docs/tree?scope=${encodeURIComponent(scopePath)}` : null,
    fetcher,
    { keepPreviousData: true }
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

  // Selected file - initialize from URL if present
  const [selectedPath, setSelectedPathInternal] = useState<string | null>(() => {
    if (typeof window === "undefined" || !scopePath) return null;
    const params = new URLSearchParams(window.location.search);
    const docParam = params.get("doc");
    return docParam ? `${scopePath}/${docParam}` : null;
  });

  // Wrapper that also updates URL
  const setSelectedPath = useCallback(
    (path: string | null) => {
      setSelectedPathInternal(path);
      if (typeof window === "undefined" || !scopePath) return;

      const url = new URL(window.location.href);
      if (path && path.startsWith(scopePath)) {
        const relativePath = path.slice(scopePath.length + 1); // +1 for the trailing /
        url.searchParams.set("doc", relativePath);
      } else {
        url.searchParams.delete("doc");
      }
      window.history.pushState({ doc: path }, "", url.toString());
    },
    [scopePath]
  );

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      if (!scopePath) return;
      const params = new URLSearchParams(window.location.search);
      const docParam = params.get("doc");
      setSelectedPathInternal(docParam ? `${scopePath}/${docParam}` : null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [scopePath]);

  // Re-initialize from URL when scope changes
  useEffect(() => {
    if (typeof window === "undefined" || !scopePath) {
      setSelectedPathInternal(null);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const docParam = params.get("doc");
    setSelectedPathInternal(docParam ? `${scopePath}/${docParam}` : null);
  }, [scopePath]);

  // Keep selectedPathRef in sync for event handler
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  // Edit mode
  const [isEditMode, setEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  // Baseline content is what MDXEditor produces on initialization (may differ from file due to normalization)
  const [baselineContent, setBaselineContent] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // File content - no polling, updated via WebSocket events (unless in edit mode)
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
    { keepPreviousData: true }
  );

  // Track edit mode in ref to avoid stale closures
  const isEditModeRef = useRef(isEditMode);
  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);

  // Subscribe to WebSocket events for real-time updates
  useEffect(() => {
    if (!connected || !scopePath) return;

    // Subscribe to tree and file change events for this scope
    subscribe("tree", { scope: scopePath });
    subscribe("file", { scope: scopePath });

    // Handle tree changes - refresh the file tree
    const unsubTree = on("tree", "changed", () => {
      mutateTree();
    });

    // Handle file changes - refresh if it's the selected file (and not in edit mode)
    const unsubFile = on("file", "changed", (data) => {
      const event = data as { path: string };
      // Only refresh if it's the currently selected file and not editing
      if (event.path === selectedPathRef.current && !isEditModeRef.current) {
        mutateFile();
      }
    });

    return () => {
      unsubTree();
      unsubFile();
      unsubscribe("tree");
      unsubscribe("file");
    };
  }, [connected, scopePath, subscribe, unsubscribe, on, mutateTree, mutateFile]);

  // Re-fetch data when WebSocket reconnects (connected goes from false to true)
  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) {
      console.log("[useDocs] WebSocket reconnected, re-fetching data");
      mutateTree();
      if (selectedPathRef.current && !isEditModeRef.current) {
        mutateFile();
      }
    }
    wasConnectedRef.current = connected;
  }, [connected, mutateTree, mutateFile]);

  // Reset edit state when file changes
  useEffect(() => {
    setEditedContent(null);
    setBaselineContent(null);
    setEditMode(false);
  }, [selectedPath]);

  // Reset baseline when entering edit mode (first setEditedContent will establish it)
  useEffect(() => {
    if (isEditMode) {
      setBaselineContent(null);
    }
  }, [isEditMode]);

  // Wrapper for setEditedContent that captures baseline on first call in edit mode
  const handleSetEditedContent = useCallback((content: string | null) => {
    setEditedContent(content);
    // First content set in edit mode becomes the baseline (MDXEditor's normalized version)
    setBaselineContent((prev) => prev === null && content !== null ? content : prev);
  }, []);

  // Check for unsaved changes - compare against baseline (what MDXEditor produced on init)
  // This prevents spurious "unsaved" state from MDXEditor's normalization
  const hasUnsavedChanges = editedContent !== null && baselineContent !== null && editedContent !== baselineContent;

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
    setEditedContent: handleSetEditedContent,
    hasUnsavedChanges,

    // Save
    saveFile,
    isSaving,
  };
}
