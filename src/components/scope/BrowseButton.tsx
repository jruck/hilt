"use client";

import { FolderOpen } from "lucide-react";

interface BrowseButtonProps {
  onSelect: (path: string) => void;
}

export function BrowseButton({ onSelect }: BrowseButtonProps) {
  const handleBrowse = async () => {
    try {
      const res = await fetch("/api/folders", { method: "POST" });
      const data = await res.json();

      if (data.cancelled) {
        // User cancelled, do nothing
        return;
      }

      if (data.path) {
        onSelect(data.path);
      }
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
