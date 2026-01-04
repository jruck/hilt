"use client";

import { Pin } from "lucide-react";

interface PinButtonProps {
  scope: string;
  isPinned?: boolean;
  onToggle?: () => void;
}

/**
 * Pin icon button for scope breadcrumbs
 * Filled when pinned, outline when not
 */
export function PinButton({ scope, isPinned = false, onToggle }: PinButtonProps) {
  // Don't show button for root scope (empty string)
  if (!scope) {
    return null;
  }

  return (
    <button
      onClick={onToggle}
      className={`p-1.5 rounded transition-colors ${
        isPinned
          ? "text-blue-400 bg-blue-900/30 hover:bg-blue-900/50"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
      }`}
      title={isPinned ? "Unpin folder" : "Pin folder"}
    >
      <Pin
        className={`w-4 h-4 ${isPinned ? "fill-current" : ""}`}
      />
    </button>
  );
}
