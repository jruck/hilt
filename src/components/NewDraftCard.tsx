"use client";

import { useState, useRef, useEffect } from "react";
import { FileText, Check, X, Play } from "lucide-react";

interface NewDraftCardProps {
  onSave: (prompt: string) => void;
  onCancel: () => void;
  onSaveAndRun?: (prompt: string) => void;
}

export function NewDraftCard({ onSave, onCancel, onSaveAndRun }: NewDraftCardProps) {
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
    <div className="relative bg-blue-950/30 border border-blue-500 rounded-lg p-3 shadow-sm">
      <div className="flex items-center gap-1 text-xs text-blue-400 mb-1">
        <FileText className="w-3 h-3" />
        <span>New draft prompt</span>
      </div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        placeholder="Enter your prompt..."
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
        rows={2}
      />
      <div className="flex justify-end gap-1 mt-2">
        <button
          onClick={onCancel}
          className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
          title="Cancel (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={handleSave}
          className="p-1 text-green-500 hover:text-green-400 hover:bg-zinc-700 rounded transition-colors"
          title="Save (Enter)"
        >
          <Check className="w-4 h-4" />
        </button>
        {onSaveAndRun && (
          <button
            onClick={handleSaveAndRun}
            className="p-1 text-blue-500 hover:text-blue-400 hover:bg-zinc-700 rounded transition-colors"
            title="Save & Run (⌘+Enter)"
          >
            <Play className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
