"use client";

import { useState, useRef, useEffect } from "react";
import { FileText, Check, X, Play, Brain, Bookmark } from "lucide-react";

interface NewDraftCardProps {
  onSave: (prompt: string) => void;
  onCancel: () => void;
  onSaveAndRun?: (prompt: string) => void;
  onRefine?: (prompt: string) => void;
  onProcessReference?: (prompt: string) => void;
}

export function NewDraftCard({ onSave, onCancel, onSaveAndRun, onRefine, onProcessReference }: NewDraftCardProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Don't save on blur if focus is moving to another form element
    // (like the section dropdown above this component)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget?.closest('select, button, input, textarea')) {
      return;
    }
    // Small delay to allow click events to fire first
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        handleSave();
      }
    }, 100);
  };

  const handleSaveAndRun = () => {
    const trimmed = value.trim();
    if (trimmed && onSaveAndRun) {
      onSaveAndRun(trimmed);
    } else if (trimmed) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  };

  const handleRefine = () => {
    const trimmed = value.trim();
    if (trimmed && onRefine) {
      onRefine(trimmed);
    }
  };

  const handleProcessReference = () => {
    const trimmed = value.trim();
    if (trimmed && onProcessReference) {
      onProcessReference(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSaveAndRun();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="relative bg-[var(--status-todo-bg)] border border-[var(--status-todo)] rounded-lg p-3 shadow-sm">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Enter your prompt..."
        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500 resize-none"
        rows={2}
      />
      <div className="flex justify-end gap-1 mt-2">
        <button
          onClick={onCancel}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          title="Cancel (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={handleSave}
          className="p-1 text-emerald-500 hover:text-emerald-400 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          title="Save (Enter)"
        >
          <Check className="w-4 h-4" />
        </button>
        {onRefine && (
          <button
            onClick={handleRefine}
            className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Refine"
          >
            <Brain className="w-4 h-4" />
          </button>
        )}
        {onProcessReference && (
          <button
            onClick={handleProcessReference}
            className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Process as reference"
          >
            <Bookmark className="w-4 h-4" />
          </button>
        )}
        {onSaveAndRun && (
          <button
            onClick={handleSaveAndRun}
            className="p-1 text-blue-500 hover:text-blue-400 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Save & Run (⌘+Enter)"
          >
            <Play className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
