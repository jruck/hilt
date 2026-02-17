"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FileCode, FileJson, File, Image, MoreVertical, Check } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { FileNode } from "@/lib/types";
import type { FolderSortOrder } from "@/hooks/useDocs";

// File icons by extension
const FILE_ICONS: Record<string, typeof File> = {
  md: FileText,
  markdown: FileText,
  mdx: FileText,
  txt: FileText,
  json: FileJson,
  yaml: FileCode,
  yml: FileCode,
  toml: FileCode,
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  rb: FileCode,
  rs: FileCode,
  go: FileCode,
  java: FileCode,
  html: FileCode,
  css: FileCode,
  scss: FileCode,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
};

// Extensions that can be viewed in the docs viewer
const VIEWABLE_EXTENSIONS = new Set([
  // Markdown / text
  "md", "markdown", "mdx", "txt",
  // Code files
  "ts", "tsx", "js", "jsx", "py", "rb", "rs", "go", "java", "c", "cpp", "h", "hpp",
  "html", "css", "scss", "less", "sass",
  // Data files
  "json", "yaml", "yml", "toml", "xml", "svg",
  // Special renderers
  "csv", "tsv",
  "png", "jpg", "jpeg", "gif", "webp",
  "pdf",
]);

interface DocsTreeItemProps {
  node: FileNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  sortOrder?: FolderSortOrder;
  onSetFolderSort?: (folderPath: string, order: FolderSortOrder) => void;
}

export function DocsTreeItem({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
  sortOrder: sortOrderProp = "alpha",
  onSetFolderSort,
}: DocsTreeItemProps) {
  const isMobile = useIsMobile();
  const isDirectory = node.type === "directory";
  const isIgnored = node.ignored === true;
  const indent = depth * 16;
  // Local sort state for immediate UI feedback
  const [localSortOrder, setLocalSortOrder] = useState(sortOrderProp);
  useEffect(() => { setLocalSortOrder(sortOrderProp); }, [sortOrderProp]);
  const sortOrder = localSortOrder;

  // Sort menu state (directories only)
  const [showSortMenu, setShowSortMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showSortMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSortMenu]);

  const handleClick = () => {
    // Ignored directories are not interactive
    if (isIgnored) return;

    if (isDirectory) {
      onToggleExpand(node.path);
      // Auto-select index.md if it exists in this folder (desktop only)
      // On mobile, the single-panel drill-down means clicking a folder should
      // just expand it — the user should explicitly tap a file to navigate.
      if (!isMobile) {
        const indexFile = node.children?.find(
          child => child.type === "file" &&
          (child.name === "index.md" || child.name === "index.markdown" || child.name === "index.mdx")
        );
        if (indexFile) {
          onSelect(indexFile.path);
        }
      }
    } else {
      onSelect(node.path);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Ignored directories are not interactive
    if (isIgnored) return;

    if (isDirectory) {
      onToggleExpand(node.path);
    }
  };

  // Get the right icon
  let IconComponent = File;
  if (isDirectory) {
    IconComponent = isExpanded ? FolderOpen : Folder;
  } else if (node.extension) {
    IconComponent = FILE_ICONS[node.extension] || File;
  }

  // Determine if the file can be viewed
  const isViewable = !isIgnored && (isDirectory || (node.extension && VIEWABLE_EXTENSIONS.has(node.extension)));
  const isMarkdown = node.extension === "md" || node.extension === "markdown" || node.extension === "mdx";

  const showSortButton = isDirectory && !isIgnored && onSetFolderSort;

  return (
    <div
      className={`
        group/row relative flex items-center gap-1 px-2 ${isMobile ? "py-2.5 text-[15px]" : "py-1 text-sm"}
        transition-colors duration-150
        ${isSelected && !isIgnored ? "bg-[var(--bg-tertiary)]" : isIgnored ? "" : "hover:bg-[var(--bg-secondary)]"}
        ${isIgnored ? "opacity-30" : !isViewable ? "opacity-50" : ""}
        ${isIgnored ? "cursor-not-allowed" : isViewable ? "cursor-pointer" : "cursor-default"}
        ${isIgnored ? "text-[var(--text-tertiary)]" : isMarkdown ? "text-[var(--text-primary)]" : isViewable ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}
      `}
      style={{ paddingLeft: `${indent + 8}px` }}
      onClick={handleClick}
      title={isIgnored ? "System folder (not browseable)" : undefined}
    >
      {/* Chevron for directories */}
      {isDirectory && !isIgnored ? (
        <button
          onClick={handleChevronClick}
          className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"} flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
        >
          {isExpanded ? (
            <ChevronDown className={isMobile ? "w-4 h-4" : "w-3 h-3"} />
          ) : (
            <ChevronRight className={isMobile ? "w-4 h-4" : "w-3 h-3"} />
          )}
        </button>
      ) : (
        <span className={`${isMobile ? "w-5" : "w-4"} flex-shrink-0`} />
      )}

      {/* Icon */}
      <IconComponent
        className={`${isMobile ? "w-5 h-5" : "w-4 h-4"} flex-shrink-0 ${
          isIgnored
            ? "text-[var(--text-tertiary)]"
            : isDirectory
            ? "text-[var(--accent-primary)]"
            : isMarkdown
            ? "text-[var(--text-secondary)]"
            : isViewable
            ? "text-[var(--text-tertiary)]"
            : "text-[var(--text-tertiary)]"
        }`}
      />

      {/* Name */}
      <span className="truncate flex-1">{node.name}</span>

      {/* Sort menu for directories */}
      {showSortButton && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSortMenu((prev) => !prev);
            }}
            className={`
              ${isMobile ? "w-6 h-6" : "w-5 h-5"} flex items-center justify-center rounded
              text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]
              ${isMobile || showSortMenu ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}
              transition-opacity duration-150
            `}
            title="Sort order"
          >
            <MoreVertical className={isMobile ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </button>

          {showSortMenu && (
            <div
              className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors whitespace-nowrap"
                onClick={() => {
                  setLocalSortOrder("alpha");
                  if (onSetFolderSort) onSetFolderSort(node.path, "alpha");
                  setShowSortMenu(false);
                }}
              >
                <span className="w-4 flex-shrink-0 flex items-center justify-center">
                  {sortOrder === "alpha" && <Check className="w-3 h-3" />}
                </span>
                Sort A–Z
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors whitespace-nowrap"
                onClick={() => {
                  setLocalSortOrder("date");
                  if (onSetFolderSort) onSetFolderSort(node.path, "date");
                  setShowSortMenu(false);
                }}
              >
                <span className="w-4 flex-shrink-0 flex items-center justify-center">
                  {sortOrder === "date" && <Check className="w-3 h-3" />}
                </span>
                Most recent
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
