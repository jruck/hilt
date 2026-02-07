"use client";

import * as path from "path";
import { useIsMobile } from "@/hooks/useIsMobile";

interface DocsBreadcrumbsProps {
  filePath: string;
  scopePath: string;
  onNavigate: (path: string) => void;
}

export function DocsBreadcrumbs({ filePath, scopePath, onNavigate }: DocsBreadcrumbsProps) {
  const isMobile = useIsMobile();
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
    <nav className={`flex items-center gap-0.5 overflow-x-auto ${isMobile ? "h-11 scrollbar-none" : ""}`}>
      {items.map((item, index) => (
        <span key={item.path} className="flex items-center flex-shrink-0">
          {index > 0 && (
            <span className="text-[var(--text-tertiary)] text-[13px] px-0.5">→</span>
          )}
          {item.isLast ? (
            <span className="px-2 py-1 text-[13px] font-mono text-[var(--text-secondary)]">
              {item.name}
            </span>
          ) : (
            <button
              onClick={() => onNavigate(item.path)}
              className="px-2 py-1 rounded text-[13px] font-mono transition-colors hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {item.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
