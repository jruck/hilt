"use client";

import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FileCode, FileJson, File, Image } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { FileNode } from "@/lib/types";

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
}

export function DocsTreeItem({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
}: DocsTreeItemProps) {
  const isMobile = useIsMobile();
  const isDirectory = node.type === "directory";
  const isIgnored = node.ignored === true;
  const indent = depth * 16;

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

  return (
    <div
      className={`
        flex items-center gap-1 px-2 ${isMobile ? "py-2.5 text-[15px]" : "py-1 text-sm"}
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
      <span className="truncate">{node.name}</span>
    </div>
  );
}
