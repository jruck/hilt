"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, X, Play, Brain, Bookmark } from "lucide-react";

interface NewDraftCardProps {
  onSave: (prompt: string) => void;
  onCancel: () => void;
  onSaveAndRun?: (prompt: string) => void;
  onRefine?: (prompt: string) => void;
  onProcessReference?: (prompt: string) => void;
}

export function NewDraftCard({ onSave, onCancel, onSaveAndRun, onRefine, onProcessReference }: NewDraftCardProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content, with max height at 50vh
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get accurate scrollHeight
    textarea.style.height = 'auto';

    // Calculate max height as 50% of viewport
    const maxHeight = window.innerHeight * 0.5;

    // Set height to scrollHeight, capped at maxHeight
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Enable scrolling if content exceeds max height
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
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
      if (document.activeElement !== textareaRef.current) {
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
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          adjustTextareaHeight();
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Enter your prompt..."
        className="w-full bg-transparent border-none text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none resize-none leading-normal"
        style={{ minHeight: '1.5em' }}
      />
      {/* Action buttons - always visible at bottom */}
      <div className="flex justify-between items-center mt-2">
        {/* Cancel on left */}
        <button
          onClick={onCancel}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
          title="Cancel (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
        {/* Actions on right */}
        <div className="flex items-center gap-1">
          {onRefine && (
            <button
              onClick={handleRefine}
              className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
              title="Refine"
            >
              <Brain className="w-4 h-4" />
            </button>
          )}
          {onProcessReference && (
            <button
              onClick={handleProcessReference}
              className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
              title="Process as reference"
            >
              <Bookmark className="w-4 h-4" />
            </button>
          )}
          {onSaveAndRun && (
            <button
              onClick={handleSaveAndRun}
              className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
              title="Run (⌘+Enter)"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleSave}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
            title="Save (Enter)"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
