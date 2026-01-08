"use client";

import { useCallback, useMemo } from "react";
import * as path from "path";
import { useDocs } from "@/hooks/useDocs";
import { DocsFileTree } from "./docs/DocsFileTree";
import { DocsContentPane } from "./docs/DocsContentPane";

interface DocsViewProps {
  scopePath: string;
  onScopeChange?: (path: string) => void;
}

export function DocsView({ scopePath, onScopeChange }: DocsViewProps) {
  const {
    // Tree
    tree,
    treeLoading,
    refreshTree,
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
    refreshFile,

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

  // Scope name for display
  const scopeName = useMemo(() => {
    if (!scopePath) return "Documents";
    return path.basename(scopePath);
  }, [scopePath]);

  // Handle file selection
  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedPath(filePath);
  }, [setSelectedPath]);

  // Navigate to folder (expand it in tree and optionally change scope)
  const handleNavigateToFolder = useCallback(
    (folderPath: string) => {
      // If navigating to scope or above, change scope
      if (!folderPath.startsWith(scopePath) || folderPath === scopePath) {
        if (onScopeChange) {
          onScopeChange(folderPath);
        }
      } else {
        // Just expand the folder in tree
        expandPath(folderPath);
      }
      // Deselect file
      setSelectedPath(null);
    },
    [scopePath, onScopeChange, expandPath, setSelectedPath]
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
    <div className="flex-1 flex overflow-hidden">
      {/* File tree sidebar */}
      <div className="w-64 flex-shrink-0">
        <DocsFileTree
          tree={tree}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggleExpand={toggleExpanded}
          onSelect={handleFileSelect}
          onRefresh={refreshTree}
          isLoading={treeLoading}
          scopeName={scopeName}
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
