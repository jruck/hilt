"use client";

import { RefreshCw } from "lucide-react";
import type { FileNode } from "@/lib/types";
import { DocsTreeItem } from "./DocsTreeItem";

interface DocsFileTreeProps {
  tree: FileNode | null;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
  scopeName: string;
}

function TreeItems({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggleExpand,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <>
      {/* Don't render the root node itself, just its children at depth 0 */}
      {depth >= 0 && (
        <DocsTreeItem
          node={node}
          depth={depth}
          isExpanded={isExpanded}
          isSelected={isSelected}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      )}

      {/* Render children if expanded (or if root) */}
      {node.type === "directory" && (isExpanded || depth < 0) && node.children && (
        <>
          {node.children.map((child) => (
            <TreeItems
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </>
  );
}

export function DocsFileTree({
  tree,
  expandedPaths,
  selectedPath,
  onToggleExpand,
  onSelect,
  onRefresh,
  isLoading,
  scopeName,
}: DocsFileTreeProps) {
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] border-r border-[var(--border-default)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)]">
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
          {scopeName}
        </span>
        <button
          onClick={onRefresh}
          className={`p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ${
            isLoading ? "animate-spin" : ""
          }`}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-auto py-1">
        {!tree ? (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
            {isLoading ? "Loading..." : "Select a scope to browse files"}
          </div>
        ) : tree.children?.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
            No files in this folder
          </div>
        ) : (
          <TreeItems
            node={tree}
            depth={-1}
            expandedPaths={expandedPaths}
            selectedPath={selectedPath}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}
