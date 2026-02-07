"use client";

import { useMemo } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { FileNode } from "@/lib/types";
import { DocsTreeItem } from "./DocsTreeItem";

interface DocsFileTreeProps {
  tree: FileNode | null;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  isLoading?: boolean;
  searchQuery?: string;
}

// Recursively filter file tree based on search query
// Returns null if no matches in this node or its children
function filterFileTree(node: FileNode, query: string): FileNode | null {
  const lowerQuery = query.toLowerCase();
  const nameMatches = node.name.toLowerCase().includes(lowerQuery);

  if (node.type === "file") {
    return nameMatches ? node : null;
  }

  // Directory: check children
  const filteredChildren: FileNode[] = [];
  if (node.children) {
    for (const child of node.children) {
      const filtered = filterFileTree(child, query);
      if (filtered) {
        filteredChildren.push(filtered);
      }
    }
  }

  // Keep directory if name matches OR has matching children
  if (nameMatches || filteredChildren.length > 0) {
    return {
      ...node,
      children: filteredChildren.length > 0 ? filteredChildren : node.children,
    };
  }

  return null;
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
  isLoading,
  searchQuery,
}: DocsFileTreeProps) {
  const isMobile = useIsMobile();

  // Filter tree if search query is active
  const displayTree = useMemo(() => {
    if (!tree || !searchQuery?.trim()) {
      return tree;
    }
    return filterFileTree(tree, searchQuery.trim());
  }, [tree, searchQuery]);

  return (
    <div className={`flex flex-col h-full bg-[var(--bg-primary)] ${isMobile ? "" : "border-r border-[var(--border-default)]"}`}>
      {/* Tree content */}
      <div className="flex-1 overflow-auto py-1">
        {!displayTree ? (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
            {isLoading ? "Loading..." : searchQuery?.trim() ? "No matching files" : "Select a scope to browse files"}
          </div>
        ) : displayTree.children?.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
            {searchQuery?.trim() ? "No matching files" : "No files in this folder"}
          </div>
        ) : (
          <TreeItems
            node={displayTree}
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
