"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Trash2, FolderOpen, MoreVertical } from "lucide-react";
import type { BridgeTask, BridgeProject } from "@/lib/types";
import { useBridgeProjects } from "@/hooks/useBridgeProjects";
import { ProjectPicker } from "./ProjectPicker";
import dynamic from "next/dynamic";

const BridgeTaskEditor = dynamic(
  () => import("./BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface BridgeTaskPanelProps {
  task: BridgeTask;
  vaultPath?: string;
  filePath?: string;
  onClose: () => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateDetails: (id: string, details: string[]) => void;
  onUpdateProject: (id: string, projectPath: string | null) => void;
  onDelete: (id: string) => void;
  onNavigateToProject?: (projectPath: string, vaultPath: string) => void;
}

export function BridgeTaskPanel({
  task,
  vaultPath,
  filePath,
  onClose,
  onUpdateTitle,
  onUpdateDetails,
  onUpdateProject,
  onDelete,
  onNavigateToProject,
}: BridgeTaskPanelProps) {
  const [title, setTitle] = useState(task.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const lastSavedTitle = useRef(task.title);
  const lastSavedDetails = useRef(task.details.join("\n"));
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: projects } = useBridgeProjects();

  useEffect(() => {
    if (task.title !== lastSavedTitle.current) {
      setTitle(task.title);
      lastSavedTitle.current = task.title;
    }
    lastSavedDetails.current = task.details.join("\n");
  }, [task.title, task.details]);

  useEffect(() => {
    setConfirmDelete(false);
    setShowPicker(false);
    setShowMenu(false);
  }, [task.id]);

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  function saveTitle(value: string) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== lastSavedTitle.current) {
      lastSavedTitle.current = trimmed;
      onUpdateTitle(task.id, trimmed);
    } else if (!trimmed) {
      setTitle(lastSavedTitle.current);
    }
  }

  const handleContentChange = useCallback(
    (markdown: string) => {
      if (markdown !== lastSavedDetails.current) {
        lastSavedDetails.current = markdown;
        onUpdateDetails(task.id, markdown.split("\n"));
      }
    },
    [task.id, onUpdateDetails]
  );

  // Resolve project from relativePath
  const linkedProject: BridgeProject | null = (() => {
    if (!task.projectPath || !projects) return null;
    const allProjects = Object.values(projects.columns).flat();
    return allProjects.find(p => p.relativePath === task.projectPath) ?? null;
  })();

  const projectDisplayName = linkedProject?.title
    ?? task.projectPath?.split("/").pop()
    ?? null;

  const fullMarkdown = task.details.join("\n");

  return (
    <div className="relative flex flex-col h-full bg-[var(--bg-primary)] border-l border-[var(--border-default)]">
      {/* Retract edge — full-height clickable strip on the left border */}
      <div
        onClick={onClose}
        className="absolute -left-px top-0 bottom-0 w-3 z-10 cursor-e-resize"
      />

      {/* Header */}
      <div className="flex-shrink-0 flex items-start gap-3 px-6 py-5 border-b border-[var(--border-default)]">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") onClose();
          }}
          rows={1}
          className="flex-1 text-lg leading-snug font-semibold bg-transparent border-none outline-none text-[var(--text-primary)] placeholder-[var(--text-tertiary)] resize-none overflow-hidden p-0 m-0"
          placeholder="Task title..."
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />

        {/* Three-dot menu */}
        <div className="flex-shrink-0 relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
              <button
                onClick={() => {
                  setShowMenu(false);
                  setShowPicker(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
                {task.projectPath ? "Change project" : "Attach project"}
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  setConfirmDelete(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete task
              </button>
            </div>
          )}

          {/* Project picker popover */}
          {showPicker && (
            <ProjectPicker
              onSelect={(projectPath) => {
                onUpdateProject(task.id, projectPath);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>

      {/* Project card (pinned) */}
      {task.projectPath && projectDisplayName && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-default)]">
          <div
            className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 group cursor-pointer hover:border-[var(--border-hover)] transition-colors"
            onClick={() => {
              if (task.projectPath && vaultPath && onNavigateToProject) {
                onNavigateToProject(task.projectPath, vaultPath);
              }
            }}
          >
            <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                {projectDisplayName}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {linkedProject?.area && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                    {linkedProject.area}
                  </span>
                )}
                <span className="text-xs text-[var(--text-tertiary)] truncate">
                  {task.projectPath}
                </span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateProject(task.id, null);
              }}
              className="p-1 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
              title="Detach project"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 bg-red-500/10 border-b border-red-500/20">
          <span className="text-sm text-red-500 flex-1">Delete this task and all its content?</span>
          <button
            onClick={() => onDelete(task.id)}
            className="px-3 py-1 text-xs font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-3 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Content — always editable */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <BridgeTaskEditor
          markdown={fullMarkdown}
          onChange={handleContentChange}
          readOnly={false}
          vaultPath={vaultPath}
          filePath={filePath}
        />
      </div>
    </div>
  );
}
