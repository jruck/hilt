"use client";

import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FileCode, FileJson, File, Image } from "lucide-react";
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
  const isDirectory = node.type === "directory";
  const indent = depth * 16;

  const handleClick = () => {
    if (isDirectory) {
      onToggleExpand(node.path);
    } else {
      onSelect(node.path);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  // Determine if it's a markdown file (for styling)
  const isMarkdown = node.extension === "md" || node.extension === "markdown" || node.extension === "mdx";

  return (
    <div
      className={`
        flex items-center gap-1 px-2 py-1 cursor-pointer text-sm
        transition-colors duration-150
        ${isSelected ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-secondary)]"}
        ${isMarkdown ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}
      `}
      style={{ paddingLeft: `${indent + 8}px` }}
      onClick={handleClick}
    >
      {/* Chevron for directories */}
      {isDirectory ? (
        <button
          onClick={handleChevronClick}
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
      ) : (
        <span className="w-4" />
      )}

      {/* Icon */}
      <IconComponent
        className={`w-4 h-4 flex-shrink-0 ${
          isDirectory
            ? "text-[var(--accent-primary)]"
            : isMarkdown
            ? "text-[var(--text-secondary)]"
            : "text-[var(--text-tertiary)]"
        }`}
      />

      {/* Name */}
      <span className="truncate">{node.name}</span>
    </div>
  );
}
