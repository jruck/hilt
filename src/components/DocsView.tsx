"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
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
  const [mobilePanel, setMobilePanel] = useState<"tree" | "content">("tree");

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
    if (isMobile) {
      setMobilePanel("content");
    }
  }, [setSelectedPath, isMobile]);

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
    // On mobile, jump straight to the content pane
    if (isMobile) {
      setMobilePanel("content");
    }
    onInitialFileConsumed?.();
  }, [tree, treeLoading, initialFilePath, scopePath, expandPath, setSelectedPath, onInitialFileConsumed]);

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
    if (tree && !selectedPath && !treeLoading && !hasAutoSelectedRef.current && !initialFilePath && !isMobile) {
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
            if (isMobile) setMobilePanel("content");
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
          if (isMobile) setMobilePanel("content");
          return;
        }
      }
      // Deselect file if no index.md found (or on mobile, go back to tree)
      setSelectedPath(null);
      if (isMobile) setMobilePanel("tree");
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

  // Extract filename for mobile back-button header
  const selectedFileName = selectedPath ? selectedPath.split("/").pop() || "" : "";

  // Mobile: single-panel drill-down with slide transition
  if (isMobile) {
    const showContent = mobilePanel === "content";
    return (
      <div className="flex-1 relative overflow-hidden">
        {/* File tree panel - slides out left */}
        <div
          className="absolute inset-0 flex flex-col transition-transform duration-200 ease-out"
          style={{ transform: showContent ? "translateX(-100%)" : "translateX(0)" }}
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
        </div>

        {/* Content panel - slides in from right */}
        <div
          className="absolute inset-0 flex flex-col transition-transform duration-200 ease-out"
          style={{ transform: showContent ? "translateX(0)" : "translateX(100%)" }}
        >
          {/* Back button header */}
          <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] flex-shrink-0">
            <button
              onClick={() => setMobilePanel("tree")}
              className="flex items-center gap-1 text-sm text-[var(--text-secondary)]"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {selectedFileName}
            </span>
          </div>
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
      </div>
    );
  }

  // Desktop: two-column split layout
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
          folderSortOrder={folderSortOrder}
          onSetFolderSort={setFolderSort}
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
