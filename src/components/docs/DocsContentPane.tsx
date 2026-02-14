"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save, Loader2, AlertCircle, Copy, FolderOpen, Check, ExternalLink, MoreVertical } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DocsBreadcrumbs } from "./DocsBreadcrumbs";
import { DocsEditToggle } from "./DocsEditToggle";
import { DocsFallbackView } from "./DocsFallbackView";
import { ImageViewer } from "./ImageViewer";
import { PDFViewer } from "./PDFViewer";
import { CSVTableViewer } from "./CSVTableViewer";
import { CodeViewer } from "./CodeViewer";
import type { FileNode } from "@/lib/types";

// File extensions by type
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const CODE_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts",
  // Python
  "py", "pyw", "pyi",
  // Web
  "html", "htm", "css", "scss", "less", "sass",
  // Data
  "json", "jsonc", "xml", "xsl", "xslt", "yaml", "yml", "toml",
  // Systems
  "rs", "go", "java", "c", "h", "cpp", "cc", "cxx", "hpp", "hxx",
  // Other
  "sql", "php", "rb", "sh", "bash", "zsh", "fish",
  // Config
  "env", "gitignore", "dockerignore", "editorconfig",
]);

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
  const isMobile = useIsMobile();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  // Copy file path to clipboard
  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    await navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [filePath]);

  // Reveal file in Finder
  const handleRevealInFinder = useCallback(async () => {
    if (!filePath) return;
    await fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
  }, [filePath]);

  // Open file in new browser tab (for PDFs and images)
  const handleOpenInNewTab = useCallback(() => {
    if (!filePath || !scopePath) return;
    const url = `/api/docs/raw?path=${encodeURIComponent(filePath)}&scope=${encodeURIComponent(scopePath)}`;
    window.open(url, "_blank");
  }, [filePath, scopePath]);

  // Mobile overflow menu state
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick as EventListener);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick as EventListener);
    };
  }, [showOverflow]);

  // Close overflow menu when file changes
  useEffect(() => {
    setShowOverflow(false);
  }, [filePath]);

  // File action buttons component for consistent UI across all file types
  const FileActionButtons = useCallback(({ showNewTab = false }: { showNewTab?: boolean }) => {
    if (isMobile) {
      // Mobile: overflow menu
      return (
        <div ref={overflowRef} className="relative">
          <button
            onClick={() => setShowOverflow(v => !v)}
            className="p-2 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {showOverflow && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg py-1">
              <button
                onClick={() => { handleCopyPath(); setShowOverflow(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />}
                Copy path
              </button>
              <button
                onClick={() => { handleRevealInFinder(); setShowOverflow(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
                Reveal in Finder
              </button>
              {showNewTab && (
                <button
                  onClick={() => { handleOpenInNewTab(); setShowOverflow(false); }}
                  className="flex items-center gap-3 w-full px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <ExternalLink className="w-4 h-4 text-[var(--text-tertiary)]" />
                  Open in new tab
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    // Desktop: inline buttons
    return (
      <>
        <button
          onClick={handleCopyPath}
          className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          title="Copy path"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
        <button
          onClick={handleRevealInFinder}
          className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          title="Reveal in Finder"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        {showNewTab && (
          <button
            onClick={handleOpenInNewTab}
            className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}
      </>
    );
  }, [copied, handleCopyPath, handleRevealInFinder, handleOpenInNewTab, isMobile, showOverflow]);

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

  // Get file extension for type detection
  const extension = filePath.split(".").pop()?.toLowerCase() || "";

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

  // Image files
  if (IMAGE_EXTENSIONS.has(extension)) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
          <DocsBreadcrumbs
            filePath={filePath}
            scopePath={scopePath}
            onNavigate={handleBreadcrumbNavigate}
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileActionButtons showNewTab />
          </div>
        </div>
        <ImageViewer filePath={filePath} scopePath={scopePath} />
      </div>
    );
  }

  // PDF files
  if (PDF_EXTENSIONS.has(extension)) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
          <DocsBreadcrumbs
            filePath={filePath}
            scopePath={scopePath}
            onNavigate={handleBreadcrumbNavigate}
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileActionButtons showNewTab />
          </div>
        </div>
        <PDFViewer filePath={filePath} scopePath={scopePath} />
      </div>
    );
  }

  // CSV files
  if (CSV_EXTENSIONS.has(extension) && content !== null) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
          <DocsBreadcrumbs
            filePath={filePath}
            scopePath={scopePath}
            onNavigate={handleBreadcrumbNavigate}
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileActionButtons />
          </div>
        </div>
        <CSVTableViewer filePath={filePath} content={content} />
      </div>
    );
  }

  // Code files
  if (CODE_EXTENSIONS.has(extension) && content !== null) {
    const displayContent = editedContent !== null ? editedContent : content;
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
          <DocsBreadcrumbs
            filePath={filePath}
            scopePath={scopePath}
            onNavigate={handleBreadcrumbNavigate}
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileActionButtons />
            {/* Save button */}
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
            {saveError && (
              <span className="text-xs text-red-500">{saveError}</span>
            )}
            <DocsEditToggle
              isEditMode={isEditMode}
              onToggle={handleModeToggle}
            />
          </div>
        </div>
        <CodeViewer
          filePath={filePath}
          content={displayContent}
          readOnly={!isEditMode}
          onChange={isEditMode ? (newContent) => onContentChange(newContent) : undefined}
        />
      </div>
    );
  }

  // Binary or non-viewable file
  if (fileMeta && (!fileMeta.isViewable || fileMeta.isBinary)) {
    return (
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
          <DocsBreadcrumbs
            filePath={filePath}
            scopePath={scopePath}
            onNavigate={handleBreadcrumbNavigate}
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileActionButtons />
          </div>
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
          <FileActionButtons />

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
          contentPadding={isMobile ? "px-3 py-3" : undefined}
        />
      </div>
    </div>
  );
}
