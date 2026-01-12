"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2, Play, Square, CheckSquare, Pencil, Check, X } from "lucide-react";
import { SkillDropdownCompact } from "./SkillDropdown";
import type { SkillInfo, InboxItem } from "@/lib/types";

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

interface InboxCardProps {
  item: InboxItem;
  scope?: string; // For skill discovery
  onDelete?: () => void;
  onStart?: () => void;
  onRunWithSkill?: (skill: SkillInfo) => void;
  onUpdate?: (prompt: string) => void;
  isSelected?: boolean;
  onSelect?: (item: InboxItem, selected: boolean) => void;
  isEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function InboxCard({
  item,
  scope,
  onDelete,
  onStart,
  onRunWithSkill,
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

  // Extract display title from structured content
  const { title: displayTitle, hasStructure } = useMemo(
    () => extractDisplayTitle(item.prompt),
    [item.prompt]
  );

  // Auto-resize textarea to fit content, with max height at 50vh
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Focus and resize when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end
      textareaRef.current.selectionStart = textareaRef.current.value.length;
      textareaRef.current.selectionEnd = textareaRef.current.value.length;
      // Initial height adjustment
      adjustTextareaHeight();
    }
  }, [isEditing, adjustTextareaHeight]);

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

  // Save and then run the updated prompt
  const handleSaveAndRun = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.prompt) {
      onUpdate?.(trimmed);
    }
    setInternalIsEditing(false);
    onEditingChange?.(false);
    // Run after saving
    onStart?.();
  }, [editValue, item.prompt, onUpdate, onEditingChange, onStart]);

  // Save and then run with a specific skill
  const handleSaveAndRunWithSkill = useCallback((skill: SkillInfo) => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.prompt) {
      onUpdate?.(trimmed);
    }
    setInternalIsEditing(false);
    onEditingChange?.(false);
    onRunWithSkill?.(skill);
  }, [editValue, item.prompt, onUpdate, onEditingChange, onRunWithSkill]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSaveAndRun();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }, [handleSave, handleCancel, handleSaveAndRun]);

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
          ref={textareaRef}
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          placeholder="Enter your prompt..."
          className="w-full bg-transparent border-none text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none resize-none leading-normal"
          style={{ minHeight: '1.5em' }}
        />
        {/* Action buttons - always visible at bottom */}
        <div className="flex justify-between items-center mt-2">
          {/* Cancel on left */}
          <button
            onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
          {/* Actions on right */}
          <div className="flex items-center gap-1">
            {onRunWithSkill && (
              <SkillDropdownCompact
                scope={scope}
                prompt={editValue}
                onSelect={(skill) => skill && handleSaveAndRunWithSkill(skill)}
              />
            )}
            {onStart && (
              <button
                onMouseDown={(e) => { e.preventDefault(); handleSaveAndRun(); }}
                className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded transition-colors"
                title="Run (⌘+Enter)"
              >
                <Play className="w-4 h-4" />
              </button>
            )}
            <button
              onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
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
        {onRunWithSkill && (
          <div onClick={(e) => e.stopPropagation()}>
            <SkillDropdownCompact
              scope={scope}
              prompt={item.prompt}
              onSelect={(skill) => skill && onRunWithSkill(skill)}
            />
          </div>
        )}
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

      <p className="text-sm text-[var(--text-secondary)] leading-normal line-clamp-2" title={hasStructure ? item.prompt : displayTitle}>
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
