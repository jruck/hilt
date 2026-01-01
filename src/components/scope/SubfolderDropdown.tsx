"use client";

import { useState, useEffect } from "react";
import { Folder, Check } from "lucide-react";

interface SubfolderDropdownProps {
  currentPath: string;
  homeDir: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function SubfolderDropdown({
  currentPath,
  homeDir,
  onSelect,
  onClose,
}: SubfolderDropdownProps) {
  const [folders, setFolders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch subfolders (or top-level folders if at root)
  useEffect(() => {
    setIsLoading(true);
    // If currentPath is empty (root), don't pass a scope to get all top-level folders
    const url = currentPath
      ? `/api/folders?scope=${encodeURIComponent(currentPath)}`
      : `/api/folders`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setFolders(data.folders || []);
        setIsLoading(false);
      })
      .catch(() => {
        setFolders([]);
        setIsLoading(false);
      });
  }, [currentPath]);

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
    <div className="w-[300px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
      {/* Subfolders/Projects section */}
      <div className="px-2 py-1.5">
        <span className="text-xs text-zinc-500 uppercase tracking-wide">
          {isAtRoot ? "Projects" : "Subfolders"}
        </span>
      </div>

      <div className="max-h-[250px] overflow-y-auto">
        {isLoading ? (
          <p className="px-3 py-2 text-sm text-zinc-500">Loading...</p>
        ) : folders.length === 0 ? (
          <p className="px-3 py-2 text-sm text-zinc-500">
            {isAtRoot ? "No projects with sessions" : "No subfolders with sessions"}
          </p>
        ) : (
          folders.map((folder) => (
            <button
              key={folder}
              onClick={() => onSelect(folder)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors ${
                currentPath === folder ? "bg-zinc-800 text-blue-400" : "text-zinc-300"
              }`}
            >
              <Folder className="w-4 h-4 text-zinc-500 flex-shrink-0" />
              <span className="flex-1 font-mono truncate">{getFolderName(folder)}</span>
              {currentPath === folder && <Check className="w-4 h-4 flex-shrink-0" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
