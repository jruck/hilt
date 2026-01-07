"use client";

import { FolderOpen } from "lucide-react";
import * as tauri from "@/lib/tauri";

interface BrowseButtonProps {
  onSelect: (path: string) => void;
}

export function BrowseButton({ onSelect }: BrowseButtonProps) {
  const handleBrowse = async () => {
    try {
      const path = await tauri.pickFolder();

      if (path) {
        onSelect(path);
      }
      // If path is null, user cancelled - do nothing
    } catch (error) {
      console.error("Failed to open folder picker:", error);
    }
  };

  return (
    <button
      onClick={handleBrowse}
      className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
      title="Browse folders in Finder"
    >
      <FolderOpen className="w-4 h-4" />
    </button>
  );
}
