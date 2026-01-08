"use client";

import { ChevronRight } from "lucide-react";
import * as path from "path";

interface DocsBreadcrumbsProps {
  filePath: string;
  scopePath: string;
  onNavigate: (path: string) => void;
}

export function DocsBreadcrumbs({ filePath, scopePath, onNavigate }: DocsBreadcrumbsProps) {
  // Get relative path from scope
  const relativePath = filePath.startsWith(scopePath)
    ? filePath.slice(scopePath.length).replace(/^\//, "")
    : filePath;

  // Split into segments
  const segments = relativePath.split("/").filter(Boolean);

  // Build breadcrumb items with full paths
  const items: { name: string; path: string; isLast: boolean }[] = [];
  let currentPath = scopePath;

  // Add scope root
  const scopeName = path.basename(scopePath);
  items.push({
    name: scopeName,
    path: scopePath,
    isLast: segments.length === 0,
  });

  // Add each segment
  segments.forEach((segment, index) => {
    currentPath = path.join(currentPath, segment);
    items.push({
      name: segment,
      path: currentPath,
      isLast: index === segments.length - 1,
    });
  });

  return (
    <nav className="flex items-center gap-1 text-sm overflow-x-auto">
      {items.map((item, index) => (
        <span key={item.path} className="flex items-center gap-1 flex-shrink-0">
          {index > 0 && (
            <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)]" />
          )}
          {item.isLast ? (
            <span className="text-[var(--text-primary)] font-medium">
              {item.name}
            </span>
          ) : (
            <button
              onClick={() => onNavigate(item.path)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline transition-colors"
            >
              {item.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
