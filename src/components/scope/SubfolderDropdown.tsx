"use client";

import { useState, useEffect } from "react";
import { Folder, Check, Pin } from "lucide-react";

interface SubfolderDropdownProps {
  currentPath: string;
  homeDir: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

export function SubfolderDropdown({
  currentPath,
  onSelect,
  onClose,
  isPinned,
  onTogglePin,
}: SubfolderDropdownProps) {
  const [folders, setFolders] = useState<string[]>([]);
  // Track which path we've loaded data for - isLoading is derived from comparison
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  // Fetch subfolders (or top-level folders if at root)
  useEffect(() => {
    // If currentPath is empty (root), don't pass a scope to get all top-level folders
    const url = currentPath
      ? `/api/folders?scope=${encodeURIComponent(currentPath)}`
      : `/api/folders`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setFolders(data.folders || []);
        setLoadedPath(currentPath);
      })
      .catch(() => {
        setFolders([]);
        setLoadedPath(currentPath);
      });
  }, [currentPath]);

  // Derive loading state - we're loading if we haven't loaded the current path yet
  const isLoading = loadedPath !== currentPath;

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Get just the folder name from a full path
  const getFolderName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  // Check if we're at root (all projects)
  const isAtRoot = !currentPath;

  return (
    <div className="w-[300px] bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg shadow-xl overflow-hidden">
      {/* Subfolders/Projects section */}
      <div className="px-2 py-1.5">
        <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
          {isAtRoot ? "Projects" : "Subfolders with sessions"}
        </span>
      </div>

      <div className="max-h-[250px] overflow-y-auto">
        {isLoading ? (
          <p className="px-3 py-2 text-sm text-[var(--text-tertiary)]">Loading...</p>
        ) : folders.length === 0 ? (
          <p className="px-3 py-2 text-sm text-[var(--text-tertiary)]">
            {isAtRoot ? "No projects with sessions" : "No subfolders with sessions"}
          </p>
        ) : (
          folders.map((folder) => (
            <button
              key={folder}
              onClick={() => onSelect(folder)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors ${
                currentPath === folder ? "bg-[var(--bg-tertiary)] text-blue-400" : "text-[var(--text-secondary)]"
              }`}
            >
              <Folder className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
              <span className="flex-1 font-mono truncate">{getFolderName(folder)}</span>
              {currentPath === folder && <Check className="w-4 h-4 flex-shrink-0" />}
            </button>
          ))
        )}
      </div>

      {/* Action buttons row */}
      {currentPath && onTogglePin && (
        <div className="border-t border-[var(--border-default)] px-2 py-2 flex items-center gap-1">
          <button
            onClick={() => {
              onTogglePin();
              onClose();
            }}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              isPinned
                ? "text-[var(--status-todo)] bg-[var(--status-todo-bg)] hover:bg-[var(--status-todo-bg)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            }`}
            title={isPinned ? "Unpin folder" : "Pin folder"}
          >
            <Pin className={`w-3.5 h-3.5 ${isPinned ? "fill-current" : ""}`} />
            <span>{isPinned ? "Unpin" : "Pin"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
