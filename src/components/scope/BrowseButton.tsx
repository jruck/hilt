"use client";

import { FolderOpen } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

interface BrowseButtonProps {
  onSelect: (path: string) => void;
}

export function BrowseButton({ onSelect }: BrowseButtonProps) {
  const isMobile = useIsMobile();
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
      className={`rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] ${isMobile ? "p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center" : "p-1.5"}`}
      title="Browse folders in Finder"
    >
      <FolderOpen className={isMobile ? "w-5 h-5" : "w-4 h-4"} />
    </button>
  );
}
