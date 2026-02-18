"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocs } from "@/hooks/useDocs";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DocsFileTree } from "./docs/DocsFileTree";
import { DocsContentPane } from "./docs/DocsContentPane";
import type { FileNode } from "@/lib/types";

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 256;
const STORAGE_KEY = "docs-sidebar-width";
const SIDEBAR_OPEN_KEY = "docs-sidebar-open";

interface DocsViewProps {
  scopePath: string;  // Always = workingFolder (tree root)
  focusedPath?: string;  // URL path to expand+select
  onPathChange?: (path: string) => void;  // Called when user clicks file -> update URL
  searchQuery?: string;
}

export function DocsView({ scopePath, focusedPath, onPathChange, searchQuery }: DocsViewProps) {
  const {
    // Tree
    tree,
    treeLoading,
    expandedPaths,
    toggleExpanded,
    expandPath,
    expandPaths,

    // Folder sort
    folderSortOrder,
    setFolderSort,

    // Selected file
    selectedPath,
    setSelectedPath,

    // File content
    fileContent,
    fileLoading,
    fileError,
    fileMeta,

    // Edit state
    isEditMode,
    setEditMode,
    editedContent,
    setEditedContent,
    hasUnsavedChanges,

    // Save
    saveFile,
    isSaving,
  } = useDocs(scopePath);

  const isMobile = useIsMobile();

  // Sidebar open/closed state
  // Desktop: persist to localStorage; Mobile: derive from navigation intent
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (isMobile) return true; // Default open when switching to Docs tab
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (stored !== null) return stored === "true";
    return true;
  });

  // Persist desktop sidebar open state
  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen));
    }
  }, [sidebarOpen, isMobile]);

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta)
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Handle file selection — close sidebar on mobile
  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedPath(filePath);
    onPathChange?.(filePath);
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [setSelectedPath, isMobile, onPathChange]);

  // Toggle sidebar
  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Find a node in the tree by absolute path
  const findNodeByPath = useCallback((root: FileNode | null, targetPath: string): FileNode | null => {
    if (!root) return null;
    if (root.path === targetPath) return root;
    if (root.children) {
      for (const child of root.children) {
        const found = findNodeByPath(child, targetPath);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Find index.md in a folder node
  const findIndexFile = useCallback((folderPath: string): string | null => {
    const folderNode = findNodeByPath(tree, folderPath);
    if (!folderNode?.children) return null;

    const indexFile = folderNode.children.find(
      child => child.type === "file" &&
      (child.name === "index.md" || child.name === "index.markdown" || child.name === "index.mdx")
    );
    return indexFile?.path || null;
  }, [tree, findNodeByPath]);

  // Handle focusedPath: expand parents and select the file when it changes
  // Ref blocks auto-select from racing with uncommitted selectedPath state
  const lastFocusedPathRef = useRef<string | null>(null);
  const focusedPathHandledRef = useRef(false);
  useEffect(() => {
    if (!focusedPath) {
      lastFocusedPathRef.current = null;
      return;
    }
    if (!tree || treeLoading) return;
    if (lastFocusedPathRef.current === focusedPath) return;
    lastFocusedPathRef.current = focusedPath;

    // Only process paths that are under scopePath (files, not just the root)
    if (!focusedPath.startsWith(scopePath + "/")) return;

    // Block auto-select synchronously — selectedPath won't commit until next render
    focusedPathHandledRef.current = true;

    // Collect all folders to expand between scope root and the focused path
    const relative = focusedPath.slice(scopePath.length + 1);
    const parts = relative.split("/");
    const pathsToExpand: string[] = [];
    let currentPath = scopePath;
    for (let i = 0; i < parts.length - 1; i++) { // -1 to skip last segment
      currentPath = `${currentPath}/${parts[i]}`;
      pathsToExpand.push(currentPath);
    }

    // Check if focusedPath is a folder — if so, expand it and select index.md
    const focusedNode = findNodeByPath(tree, focusedPath);
    if (focusedNode && focusedNode.type === "directory") {
      pathsToExpand.push(focusedPath);
      // Expand all parent folders + the target folder in one atomic update
      expandPaths(pathsToExpand);
      const indexPath = findIndexFile(focusedPath);
      if (indexPath) {
        setSelectedPath(indexPath, { replace: true });
      } else {
        // No index.md — just expand the folder, deselect file
        setSelectedPath(null);
      }
    } else {
      // Expand all parent folders in one atomic update
      expandPaths(pathsToExpand);
      setSelectedPath(focusedPath, { replace: true });
    }
    // Navigation intent: navigating to a specific file/folder
    // Mobile: close sidebar to show content immediately
    // Desktop: keep sidebar open (user can see both)
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [tree, treeLoading, focusedPath, scopePath, expandPaths, setSelectedPath, isMobile, findNodeByPath, findIndexFile]);

  // Clear the handled ref once selectedPath commits (non-null means setSelectedPath took effect)
  useEffect(() => {
    if (selectedPath && focusedPathHandledRef.current) {
      focusedPathHandledRef.current = false;
    }
  }, [selectedPath]);

  // Auto-select root index.md on initial load (when no file is selected)
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    // Skip if focusedPath effect already called setSelectedPath (state pending commit)
    if (focusedPathHandledRef.current) return;
    // Only run once per scope when tree loads and nothing is selected
    // Skip if a focusedPath is pending
    if (tree && !selectedPath && !treeLoading && !hasAutoSelectedRef.current && !focusedPath) {
      hasAutoSelectedRef.current = true;
      const indexPath = findIndexFile(scopePath);
      if (indexPath) {
        setSelectedPath(indexPath, { replace: true });
      }
    }
  }, [tree, selectedPath, treeLoading, scopePath, findIndexFile, setSelectedPath, focusedPath]);

  // Reset auto-selection flag when scope changes
  useEffect(() => {
    hasAutoSelectedRef.current = false;
  }, [scopePath]);

  // Navigate to folder — expand it in tree and select index.md if available
  const handleNavigateToFolder = useCallback(
    (folderPath: string) => {
      expandPath(folderPath);
      const indexPath = findIndexFile(folderPath);
      if (indexPath) {
        setSelectedPath(indexPath);
        onPathChange?.(indexPath);
        if (isMobile) setSidebarOpen(false);
        return;
      }
      setSelectedPath(null);
      if (isMobile) setSidebarOpen(true);
    },
    [expandPath, setSelectedPath, findIndexFile, isMobile, onPathChange]
  );

  // Navigate to file from wikilink
  const handleNavigateToFile = useCallback(
    (filePath: string) => {
      // Expand parent folders
      const parts = filePath.split("/");
      let currentPath = "";
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        if (currentPath.startsWith(scopePath)) {
          expandPath(currentPath);
        }
      }
      setSelectedPath(filePath);
      onPathChange?.(filePath);
    },
    [scopePath, expandPath, setSelectedPath, onPathChange]
  );

  // Unified layout: collapsible sidebar + content pane
  return (
    <div className={`flex-1 flex overflow-hidden relative ${isResizing ? "select-none" : ""}`}>
      {/* Sidebar */}
      <div
        className="flex-shrink-0 relative flex flex-col transition-transform duration-200 ease-out"
        style={{
          width: isMobile ? "85vw" : sidebarWidth,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          position: isMobile ? "absolute" : "relative",
          // On mobile: overlay as drawer from left
          ...(isMobile ? { top: 0, left: 0, bottom: 0, zIndex: 30 } : {}),
          // On desktop when closed: collapse out of flow
          ...(!isMobile && !sidebarOpen ? { position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 30 } : {}),
        }}
      >
        <DocsFileTree
          tree={tree}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggleExpand={toggleExpanded}
          onSelect={handleFileSelect}
          isLoading={treeLoading}
          searchQuery={searchQuery}
          folderSortOrder={folderSortOrder}
          onSetFolderSort={setFolderSort}
        />
        {/* Resize handle — desktop only, when sidebar open */}
        {!isMobile && sidebarOpen && (
          <div
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent-primary)] transition-colors ${
              isResizing ? "bg-[var(--accent-primary)]" : "bg-transparent"
            }`}
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* Backdrop — mobile only, when sidebar open */}
      {isMobile && sidebarOpen && (
        <div
          className="absolute inset-0 z-20 bg-black/40 transition-opacity duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Content pane — always visible, fills remaining space */}
      <DocsContentPane
        filePath={selectedPath}
        scopePath={scopePath}
        content={fileContent}
        fileMeta={fileMeta}
        isLoading={fileLoading}
        error={fileError}
        isEditMode={isEditMode}
        onEditModeChange={setEditMode}
        editedContent={editedContent}
        onContentChange={setEditedContent}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={saveFile}
        isSaving={isSaving}
        onNavigateToFolder={handleNavigateToFolder}
        onNavigateToFile={handleNavigateToFile}
        fileTree={tree}
        onToggleSidebar={handleToggleSidebar}
        sidebarOpen={sidebarOpen}
      />
    </div>
  );
}
