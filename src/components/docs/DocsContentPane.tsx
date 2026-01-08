"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save, Loader2, AlertCircle } from "lucide-react";
import { DocsBreadcrumbs } from "./DocsBreadcrumbs";
import { DocsEditToggle } from "./DocsEditToggle";
import { DocsFallbackView } from "./DocsFallbackView";
import type { FileNode } from "@/lib/types";

// Dynamic import for MDXEditor (no SSR)
const DocsEditor = dynamic(
  () => import("./DocsEditor").then((mod) => mod.DocsEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    ),
  }
);

interface DocsContentPaneProps {
  filePath: string | null;
  scopePath: string;
  content: string | null;
  fileMeta: {
    isBinary: boolean;
    isViewable: boolean;
    mimeType: string;
    size: number;
    modTime: number;
  } | null;
  isLoading: boolean;
  error: Error | null;
  isEditMode: boolean;
  onEditModeChange: (editMode: boolean) => void;
  editedContent: string | null;
  onContentChange: (content: string | null) => void;
  hasUnsavedChanges: boolean;
  onSave: () => Promise<{ success: boolean; error?: string }>;
  isSaving: boolean;
  onNavigateToFolder: (path: string) => void;
  onNavigateToFile: (path: string) => void;
  fileTree: FileNode | null;
}

export function DocsContentPane({
  filePath,
  scopePath,
  content,
  fileMeta,
  isLoading,
  error,
  isEditMode,
  onEditModeChange,
  editedContent,
  onContentChange,
  hasUnsavedChanges,
  onSave,
  isSaving,
  onNavigateToFolder,
  onNavigateToFile,
  fileTree,
}: DocsContentPaneProps) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Reset scroll position and clear save error when file changes
  useEffect(() => {
    setSaveError(null);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filePath]);

  // Handle mode toggle with unsaved changes
  const handleModeToggle = useCallback(
    (newEditMode: boolean) => {
      if (!newEditMode && hasUnsavedChanges) {
        const confirmed = window.confirm(
          "You have unsaved changes. Discard them and switch to read mode?"
        );
        if (!confirmed) return;
      }
      // Always reset editedContent when going to read mode
      // This ensures wikilinks are processed fresh from the original content
      if (!newEditMode) {
        onContentChange(null);
      }
      onEditModeChange(newEditMode);
    },
    [hasUnsavedChanges, onEditModeChange, onContentChange]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    setSaveError(null);
    const result = await onSave();
    if (!result.success) {
      setSaveError(result.error || "Failed to save");
    }
  }, [onSave]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges) {
          handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, handleSave]);

  // Handle breadcrumb navigation
  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      // If it's the same as scope, just deselect file
      if (path === scopePath) {
        onNavigateToFolder(path);
      } else {
        // Check if it's a file or folder and navigate accordingly
        onNavigateToFolder(path);
      }
    },
    [scopePath, onNavigateToFolder]
  );

  // No file selected
  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <p className="text-sm">Select a file to view</p>
      </div>
    );
  }

  // Loading
  if (isLoading && !content) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--text-tertiary)]">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  // Binary or non-viewable file
  if (fileMeta && (!fileMeta.isViewable || fileMeta.isBinary)) {
    return (
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] min-h-[44px]">
          <DocsBreadcrumbs
            filePath={filePath}
            scopePath={scopePath}
            onNavigate={handleBreadcrumbNavigate}
          />
        </div>

        <DocsFallbackView
          filePath={filePath}
          size={fileMeta.size}
          mimeType={fileMeta.mimeType}
          isLargeFile={fileMeta.size > 1024 * 1024}
        />
      </div>
    );
  }

  // Viewable content
  const displayContent = editedContent !== null ? editedContent : content || "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
        <DocsBreadcrumbs
          filePath={filePath}
          scopePath={scopePath}
          onNavigate={handleBreadcrumbNavigate}
        />

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Save button - shown when there are unsaved changes */}
          {hasUnsavedChanges && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-xs font-medium transition-colors"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </button>
          )}

          {/* Save error */}
          {saveError && (
            <span className="text-xs text-red-500">{saveError}</span>
          )}

          {/* Edit toggle */}
          <DocsEditToggle
            isEditMode={isEditMode}
            onToggle={handleModeToggle}
          />
        </div>
      </div>

      {/* Editor */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <DocsEditor
          markdown={displayContent}
          onChange={isEditMode ? (newContent) => onContentChange(newContent) : undefined}
          readOnly={!isEditMode}
          currentFilePath={filePath}
          scopePath={scopePath}
          fileTree={fileTree}
          onNavigateToFile={onNavigateToFile}
        />
      </div>
    </div>
  );
}
