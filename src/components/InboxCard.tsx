"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2, Play, Square, CheckSquare, Pencil, Check, X, Brain, Bookmark } from "lucide-react";

/**
 * Extract a display title from todo content.
 * Returns the first/highest-level heading found, or the first line if no heading.
 */
function extractDisplayTitle(text: string): { title: string; hasStructure: boolean } {
  const lines = text.split("\n");

  // Find the first heading (highest level = fewest #)
  let bestHeading: { level: number; text: string } | null = null;

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const headingText = match[2].trim();
      if (!bestHeading || level < bestHeading.level) {
        bestHeading = { level, text: headingText };
      }
      // Stop at H1-H3, good enough
      if (level <= 3) break;
    }
  }

  if (bestHeading) {
    return { title: bestHeading.text, hasStructure: true };
  }

  // No heading found, use first non-empty line
  const firstLine = lines.find(l => l.trim().length > 0) || text;
  const isMultiLine = lines.filter(l => l.trim().length > 0).length > 1;

  return { title: firstLine.trim(), hasStructure: isMultiLine };
}

interface InboxItem {
  id: string;
  prompt: string;
  completed: boolean;
  section: string | null;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

interface InboxCardProps {
  item: InboxItem;
  onDelete?: () => void;
  onStart?: () => void;
  onRefine?: () => void;
  onProcessReference?: () => void;
  onUpdate?: (prompt: string) => void;
  isSelected?: boolean;
  onSelect?: (item: InboxItem, selected: boolean) => void;
  isEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function InboxCard({
  item,
  onDelete,
  onStart,
  onRefine,
  onProcessReference,
  onUpdate,
  isSelected,
  onSelect,
  isEditing: externalIsEditing,
  onEditingChange,
}: InboxCardProps) {
  // Use external editing state if provided, otherwise track internally
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const isEditing = externalIsEditing ?? internalIsEditing;

  const [editValue, setEditValue] = useState(item.prompt);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Extract display title from structured content
  const { title: displayTitle, hasStructure } = useMemo(
    () => extractDisplayTitle(item.prompt),
    [item.prompt]
  );

  // Calculate rows for textarea based on content
  const editRows = useMemo(() => {
    const lineCount = editValue.split("\n").length;
    return Math.max(4, Math.min(20, lineCount + 2));
  }, [editValue]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `inbox-${item.id}`, disabled: isEditing });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Reset edit value when entering edit mode
  // React-approved pattern: update state during render when props change
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevIsEditing, setPrevIsEditing] = useState(isEditing);
  if (isEditing !== prevIsEditing) {
    setPrevIsEditing(isEditing);
    if (isEditing) {
      setEditValue(item.prompt);
    }
  }

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.prompt) {
      onUpdate?.(trimmed);
    }
    setInternalIsEditing(false);
    onEditingChange?.(false);
  }, [editValue, item.prompt, onUpdate, onEditingChange]);

  const handleCancel = useCallback(() => {
    setEditValue(item.prompt);
    setInternalIsEditing(false);
    onEditingChange?.(false);
  }, [item.prompt, onEditingChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  const startEditing = useCallback(() => {
    // Note: editValue is reset in the render logic above when isEditing becomes true
    setInternalIsEditing(true);
    onEditingChange?.(true);
  }, [onEditingChange]);

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="relative bg-[var(--status-todo-bg)] border border-[var(--status-todo)] rounded-lg p-3 shadow-sm"
      >
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          placeholder="Enter your prompt..."
          className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500 resize-none font-mono"
          rows={editRows}
        />
        <div className="flex justify-end gap-1 mt-2">
          <button
            onClick={handleCancel}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            className="p-1 text-emerald-500 hover:text-emerald-400 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Save"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        group relative bg-[var(--status-todo-bg)] border rounded-lg p-3
        hover:border-[var(--status-todo)] transition-colors cursor-grab
        ${isDragging ? "shadow-xl ring-2 ring-[var(--status-todo)]" : "shadow-sm"}
        ${isSelected ? "border-[var(--status-todo)] bg-[var(--status-todo-bg)]" : "border-[var(--status-todo-border)]"}
      `}
    >
      {/* Hover actions - floating toolbar */}
      <div className={`
        absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1 py-0.5
        bg-[var(--toolbar-bg-blue)] border border-[var(--toolbar-border-blue)] rounded-md shadow-lg
        ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
        transition-opacity
      `}>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(item, !isSelected); }}
          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-hover-blue)] rounded transition-colors"
          title={isSelected ? "Deselect" : "Select"}
        >
          {isSelected ? <CheckSquare className="w-4 h-4 text-blue-400" /> : <Square className="w-4 h-4" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); startEditing(); }}
          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-hover-blue)] rounded transition-colors"
          title="Edit prompt"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRefine?.(); }}
          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-hover-blue)] rounded transition-colors"
          title="Refine this idea before implementing"
        >
          <Brain className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onProcessReference?.(); }}
          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-hover-blue)] rounded transition-colors"
          title="Process as reference"
        >
          <Bookmark className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onStart?.(); }}
          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-hover-blue)] rounded transition-colors"
          title="Start session with this prompt"
        >
          <Play className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-hover-blue)] rounded transition-colors"
          title="Delete draft"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <p className="text-sm text-[var(--text-secondary)] line-clamp-2" title={hasStructure ? item.prompt : displayTitle}>
        {displayTitle}
      </p>
      {hasStructure && (
        <p className="text-xs text-[var(--text-tertiary)] mt-1 truncate">
          {item.prompt.split("\n").length} lines
        </p>
      )}
    </div>
  );
}
