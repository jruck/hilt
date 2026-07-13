"use client";

import { BookOpen, Pencil } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";

interface DocsEditToggleProps {
  isEditMode: boolean;
  onToggle: (editMode: boolean) => void;
  disabled?: boolean;
}

export function DocsEditToggle({ isEditMode, onToggle, disabled }: DocsEditToggleProps) {
  const haptics = useHaptics();
  const nextEditMode = !isEditMode;

  return (
    <button
      onClick={() => { haptics.medium(); onToggle(nextEditMode); }}
      disabled={disabled}
      className={`p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      title={isEditMode ? "Switch to read mode" : "Switch to edit mode"}
      aria-label={isEditMode ? "Switch to read mode" : "Switch to edit mode"}
    >
      {isEditMode ? <BookOpen className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
    </button>
  );
}
