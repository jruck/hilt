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
      className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-300 transition-colors"
      title="Browse folders in Finder"
    >
      <FolderOpen className="w-4 h-4" />
      <span>Browse</span>
    </button>
  );
}
