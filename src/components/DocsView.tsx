"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocs } from "@/hooks/useDocs";
import { DocsFileTree } from "./docs/DocsFileTree";
import { DocsContentPane } from "./docs/DocsContentPane";
import type { FileNode } from "@/lib/types";

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 256;
const STORAGE_KEY = "docs-sidebar-width";

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

  // Handle file selection
  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedPath(filePath);
  }, [setSelectedPath]);

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
  // Uses requestAnimationFrame to run after useDocs scope-sync effect resets expandedPaths
  const consumedInitialFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tree || treeLoading || !initialFilePath) return;
    if (consumedInitialFileRef.current === initialFilePath) return;
    consumedInitialFileRef.current = initialFilePath;

    const filePath = initialFilePath;
    const raf = requestAnimationFrame(() => {
      // Expand folders between scope root and the file
      const relative = filePath.slice(scopePath.length + 1); // e.g. "projects/perf-review/index.md"
      const parts = relative.split("/");
      let currentPath = scopePath;
      for (let i = 0; i < parts.length - 1; i++) { // -1 to skip filename
        currentPath = `${currentPath}/${parts[i]}`;
        expandPath(currentPath);
      }
      setSelectedPath(filePath);
      onInitialFileConsumed?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [tree, treeLoading, initialFilePath, scopePath, expandPath, setSelectedPath, onInitialFileConsumed]);

  // Auto-select root index.md on initial load (when no file is selected)
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    // Only run once per scope when tree loads and nothing is selected
    // Skip if an initialFilePath is pending
    if (tree && !selectedPath && !treeLoading && !hasAutoSelectedRef.current && !initialFilePath) {
      hasAutoSelectedRef.current = true;
      const indexPath = findIndexFile(scopePath);
      if (indexPath) {
        setSelectedPath(indexPath);
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
        // For scope root, still try to find and select index.md
        if (folderPath === scopePath) {
          const indexPath = findIndexFile(folderPath);
          if (indexPath) {
            setSelectedPath(indexPath);
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
          return;
        }
      }
      // Deselect file if no index.md found
      setSelectedPath(null);
    },
    [scopePath, onScopeChange, expandPath, setSelectedPath, findIndexFile]
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

  return (
    <div className={`flex-1 flex overflow-hidden ${isResizing ? "select-none" : ""}`}>
      {/* File tree sidebar */}
      <div className="flex-shrink-0 relative" style={{ width: sidebarWidth }}>
        <DocsFileTree
          tree={tree}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggleExpand={toggleExpanded}
          onSelect={handleFileSelect}
          isLoading={treeLoading}
          searchQuery={searchQuery}
        />
        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent-primary)] transition-colors ${
            isResizing ? "bg-[var(--accent-primary)]" : "bg-transparent"
          }`}
          onMouseDown={handleResizeStart}
        />
      </div>

      {/* Content pane */}
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
      />
    </div>
  );
}
