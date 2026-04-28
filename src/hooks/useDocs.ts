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

// localStorage keys
const EXPANDED_PATHS_KEY = "docs-expanded-paths";
const FOLDER_SORT_KEY = "docs-folder-sort";

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

export type FolderSortOrder = "alpha" | "date";

function getStoredFolderSort(scope: string): Map<string, FolderSortOrder> {
  if (typeof window === "undefined") return new Map();
  try {
    // Try localStorage first (fast, synchronous) — server state loads async
    const stored = localStorage.getItem(FOLDER_SORT_KEY);
    if (!stored) return new Map();
    const data = JSON.parse(stored);
    const scopeData = data[scope];
    if (!scopeData) return new Map();
    return new Map(Object.entries(scopeData) as [string, FolderSortOrder][]);
  } catch {
    return new Map();
  }
}

function setStoredFolderSort(scope: string, sortMap: Map<string, FolderSortOrder>) {
  if (typeof window === "undefined") return;
  try {
    const stored = localStorage.getItem(FOLDER_SORT_KEY);
    const data = stored ? JSON.parse(stored) : {};
    // Only store non-default (date) entries
    const obj: Record<string, FolderSortOrder> = {};
    sortMap.forEach((v, k) => { if (v === "date") obj[k] = v; });
    if (Object.keys(obj).length > 0) {
      data[scope] = obj;
    } else {
      delete data[scope];
    }
    localStorage.setItem(FOLDER_SORT_KEY, JSON.stringify(data));

    // Also persist to server (syncs across devices via Obsidian Sync)
    fetch("/api/bridge/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "folderSort", value: data }),
    }).catch(() => {});
  } catch {
    // Ignore storage errors
  }
}

/** Load folder sort prefs from server and merge into state */
async function loadServerFolderSort(scope: string): Promise<Map<string, FolderSortOrder> | null> {
  try {
    const res = await fetch("/api/bridge/preferences");
    if (!res.ok) return null;
    const prefs = await res.json();
    const data = prefs.folderSort;
    if (!data) return null;
    const scopeData = data[scope];
    if (!scopeData) return null;
    // Sync to localStorage too
    localStorage.setItem(FOLDER_SORT_KEY, JSON.stringify(data));
    return new Map(Object.entries(scopeData) as [string, FolderSortOrder][]);
  } catch {
    return null;
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
  expandPaths: (paths: string[]) => void;
  collapsePath: (path: string) => void;

  // Folder sort
  folderSortOrder: Map<string, FolderSortOrder>;
  setFolderSort: (folderPath: string, order: FolderSortOrder) => void;

  // Selected file
  selectedPath: string | null;
  setSelectedPath: (path: string | null, options?: { replace?: boolean }) => void;

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

  const expandPaths = useCallback((paths: string[]) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const p of paths) next.add(p);
      return next;
    });
  }, []);

  const collapsePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  // Folder sort preferences
  const [folderSortOrder, setFolderSortOrder] = useState<Map<string, FolderSortOrder>>(() =>
    scopePath ? getStoredFolderSort(scopePath) : new Map()
  );

  // Sync sort prefs with scope changes — load from localStorage immediately, then server
  useEffect(() => {
    if (scopePath) {
      setFolderSortOrder(getStoredFolderSort(scopePath));
      // Load from server (may have newer state from another device)
      loadServerFolderSort(scopePath).then((serverSort) => {
        if (serverSort && serverSort.size > 0) {
          setFolderSortOrder(serverSort);
        }
      });
    }
  }, [scopePath]);

  // Persist sort prefs on change
  useEffect(() => {
    if (scopePath) {
      setStoredFolderSort(scopePath, folderSortOrder);
    }
  }, [scopePath, folderSortOrder]);

  const setFolderSort = useCallback((folderPath: string, order: FolderSortOrder) => {
    setFolderSortOrder((prev) => {
      const next = new Map(prev);
      if (order === "alpha") {
        next.delete(folderPath);
      } else {
        next.set(folderPath, order);
      }
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
  // replace=true uses replaceState (for auto-selections that shouldn't create history entries)
  const setSelectedPath = useCallback(
    (path: string | null, { replace = false }: { replace?: boolean } = {}) => {
      setSelectedPathInternal(path);
      if (typeof window === "undefined" || !scopePath) return;

      const url = new URL(window.location.href);
      const fileName = path?.split("/").pop();
      const isIndex = fileName === "index.md" || fileName === "index.markdown" || fileName === "index.mdx";
      if (path && path.startsWith(scopePath) && !isIndex) {
        const relativePath = path.slice(scopePath.length + 1); // +1 for the trailing /
        url.searchParams.set("doc", relativePath);
      } else {
        url.searchParams.delete("doc");
      }
      if (replace) {
        window.history.replaceState({}, "", url.toString());
      } else {
        window.history.pushState({}, "", url.toString());
      }
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

  // Re-initialize from URL when scope changes (skip initial mount —
  // on mount the useState initializer already reads from URL).
  // Uses value comparison instead of a boolean flag so it survives
  // React Strict Mode's unmount/remount cycle.
  const prevScopeRef = useRef(scopePath);
  useEffect(() => {
    if (prevScopeRef.current === scopePath) return; // Same scope — skip (includes initial mount)
    prevScopeRef.current = scopePath;
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
    setEditMode(false);
  }, [selectedPath]);

  // CodeMirror edits are byte-exact: compare directly against the loaded file content.
  const loadedContent = fileData?.content ?? null;
  const hasUnsavedChanges = editedContent !== null && loadedContent !== null && editedContent !== loadedContent;

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
    expandPaths,
    collapsePath,

    // Folder sort
    folderSortOrder,
    setFolderSort,

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
