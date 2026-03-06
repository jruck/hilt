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
  return (
    <div className="flex items-center rounded-md border border-[var(--border-default)] overflow-hidden">
      <button
        onClick={() => { haptics.medium(); onToggle(false); }}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors
          ${!isEditMode
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
        title="Read mode"
      >
        <BookOpen className="w-3.5 h-3.5" />
        Read
      </button>
      <button
        onClick={() => { haptics.medium(); onToggle(true); }}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border-l border-[var(--border-default)]
          ${isEditMode
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
        title="Edit mode"
      >
        <Pencil className="w-3.5 h-3.5" />
        Edit
      </button>
    </div>
  );
}
