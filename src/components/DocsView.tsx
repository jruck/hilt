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
  scopePath: string;
  onScopeChange?: (path: string) => void;
  searchQuery?: string;
  /** When set, expands parent folders and selects this file on load. Cleared after use. */
  initialFilePath?: string | null;
  onInitialFileConsumed?: () => void;
}

export function DocsView({ scopePath, onScopeChange, searchQuery, initialFilePath, onInitialFileConsumed }: DocsViewProps) {
  const {
    // Tree
    tree,
    treeLoading,
    expandedPaths,
    toggleExpanded,
    expandPath,

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
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [setSelectedPath, isMobile]);

  // Toggle sidebar
  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Find index.md in a folder node
  const findIndexFile = useCallback((folderPath: string): string | null => {
    if (!tree) return null;

    // Find the folder node in the tree
    const findNode = (node: FileNode, targetPath: string): FileNode | null => {
      if (node.path === targetPath) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child, targetPath);
          if (found) return found;
        }
      }
      return null;
    };

    const folderNode = findNode(tree, folderPath);
    if (!folderNode?.children) return null;

    const indexFile = folderNode.children.find(
      child => child.type === "file" &&
      (child.name === "index.md" || child.name === "index.markdown" || child.name === "index.mdx")
    );
    return indexFile?.path || null;
  }, [tree]);

  // Handle initialFilePath: expand parents and select the file once tree loads
  // Ref blocks auto-select from racing with uncommitted selectedPath state
  const consumedInitialFileRef = useRef<string | null>(null);
  const initialFileHandledRef = useRef(false);
  useEffect(() => {
    if (!initialFilePath) {
      consumedInitialFileRef.current = null;
      return;
    }
    if (!tree || treeLoading) return;
    if (consumedInitialFileRef.current === initialFilePath) return;
    consumedInitialFileRef.current = initialFilePath;

    // Block auto-select synchronously — selectedPath won't commit until next render
    initialFileHandledRef.current = true;

    // Expand folders between scope root and the file
    const relative = initialFilePath.slice(scopePath.length + 1);
    const parts = relative.split("/");
    let currentPath = scopePath;
    for (let i = 0; i < parts.length - 1; i++) { // -1 to skip filename
      currentPath = `${currentPath}/${parts[i]}`;
      expandPath(currentPath);
    }
    setSelectedPath(initialFilePath, { replace: true });
    // Navigation intent: navigating to a specific file
    // Mobile: close sidebar to show content immediately
    // Desktop: keep sidebar open (user can see both)
    if (isMobile) {
      setSidebarOpen(false);
    }
    onInitialFileConsumed?.();
  }, [tree, treeLoading, initialFilePath, scopePath, expandPath, setSelectedPath, onInitialFileConsumed, isMobile]);

  // Clear the handled ref once selectedPath commits (non-null means setSelectedPath took effect)
  useEffect(() => {
    if (selectedPath && initialFileHandledRef.current) {
      initialFileHandledRef.current = false;
    }
  }, [selectedPath]);

  // Auto-select root index.md on initial load (when no file is selected)
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    // Skip if initialFilePath effect already called setSelectedPath (state pending commit)
    if (initialFileHandledRef.current) return;
    // Only run once per scope when tree loads and nothing is selected
    // Skip if an initialFilePath is pending
    if (tree && !selectedPath && !treeLoading && !hasAutoSelectedRef.current && !initialFilePath) {
      hasAutoSelectedRef.current = true;
      const indexPath = findIndexFile(scopePath);
      if (indexPath) {
        setSelectedPath(indexPath, { replace: true });
      }
    }
  }, [tree, selectedPath, treeLoading, scopePath, findIndexFile, setSelectedPath, initialFilePath]);

  // Reset auto-selection flag when scope changes
  useEffect(() => {
    hasAutoSelectedRef.current = false;
  }, [scopePath]);

  // Navigate to folder (expand it in tree and optionally change scope)
  const handleNavigateToFolder = useCallback(
    (folderPath: string) => {
      // If navigating to scope or above, change scope
      if (!folderPath.startsWith(scopePath) || folderPath === scopePath) {
        if (onScopeChange) {
          onScopeChange(folderPath);
        }
        // For scope root, try to find and select index.md
        if (folderPath === scopePath) {
          const indexPath = findIndexFile(folderPath);
          if (indexPath) {
            setSelectedPath(indexPath);
            if (isMobile) setSidebarOpen(false);
            return;
          }
        }
      } else {
        // Expand the folder in tree
        expandPath(folderPath);
        // Auto-select index.md if it exists
        const indexPath = findIndexFile(folderPath);
        if (indexPath) {
          setSelectedPath(indexPath);
          if (isMobile) setSidebarOpen(false);
          return;
        }
      }
      // Deselect file if no index.md found — on mobile, open sidebar to show tree
      setSelectedPath(null);
      if (isMobile) setSidebarOpen(true);
    },
    [scopePath, onScopeChange, expandPath, setSelectedPath, findIndexFile, isMobile]
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
    },
    [scopePath, expandPath, setSelectedPath]
  );

  // No scope selected
  if (!scopePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <p className="text-sm">Select a scope from the toolbar to browse documents</p>
      </div>
    );
  }

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
