"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Trash2, FolderOpen, MoreVertical, Copy } from "lucide-react";
import type { BridgeTask, BridgeProject } from "@/lib/types";
import { parseLifecycle } from "@/lib/attribution";
import { useBridgeProjects } from "@/hooks/useBridgeProjects";
import { useBridgeThoughts } from "@/hooks/useBridgeThoughts";
import { ProjectPicker } from "./ProjectPicker";
import dynamic from "next/dynamic";

const BridgeTaskEditor = dynamic(
  () => import("./BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface BridgeTaskPanelProps {
  task: BridgeTask;
  autoFocusTitle?: boolean;
  vaultPath?: string;
  filePath?: string;
  onClose: () => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateDetails: (id: string, details: string[]) => void;
  onUpdateProject: (id: string, projectPath: string | null) => void;
  onRemoveProject?: (id: string, projectPath: string) => void;
  onDelete: (id: string) => void;
  onNavigateToProject?: (projectPath: string, vaultPath: string) => void;
}

export function BridgeTaskPanel({
  task,
  autoFocusTitle,
  vaultPath,
  filePath,
  onClose,
  onUpdateTitle,
  onUpdateDetails,
  onUpdateProject,
  onRemoveProject,
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
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);

  const { data: projects } = useBridgeProjects();
  const { data: thoughts } = useBridgeThoughts();

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

  // Auto-focus and select title for newly added tasks
  useEffect(() => {
    if (autoFocusTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [autoFocusTitle, task.id]);

  function focusEditor() {
    const el = editorAreaRef.current?.querySelector("[contenteditable]") as HTMLElement;
    el?.focus();
  }

  // Strip lifecycle emoji for display (🆕, ⁇ are markdown tags, not user-visible)
  const displayTitle = useMemo(() => {
    return parseLifecycle(title, task.done).displayTitle;
  }, [title, task.done]);

  function saveTitle(value: string) {
    const trimmed = value.trim();
    const lastDisplay = parseLifecycle(lastSavedTitle.current, task.done).displayTitle;
    if (trimmed && trimmed !== lastDisplay) {
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

  // Resolve all linked projects/thoughts
  const projectPaths = task.projectPaths ?? (task.projectPath ? [task.projectPath] : []);

  const linkedItems = useMemo(() => {
    const allProjects = projects ? Object.values(projects.columns).flat() : [];
    const allThoughts = thoughts ? Object.values(thoughts.columns).flat() : [];

    return projectPaths.map(pp => {
      const project = allProjects.find(p => p.relativePath === pp);
      if (project) return { path: pp, title: project.title, icon: project.icon, type: "project" as const };
      const thought = allThoughts.find(t => t.relativePath === pp);
      if (thought) return { path: pp, title: thought.title, icon: thought.icon, type: "thought" as const };
      return { path: pp, title: pp.split("/").pop() || pp, icon: "", type: "unknown" as const };
    });
  }, [projectPaths, projects, thoughts]);

  // Legacy compat
  const linkedProject = linkedItems.length > 0 ? linkedItems[0] : null;
  const projectDisplayName = linkedProject?.title ?? null;

  const fullMarkdown = task.details.join("\n");

  const [copyFeedback, setCopyFeedback] = useState(false);

  function copyAsMarkdown() {
    const lines: string[] = [];
    // Source file for vault context
    if (filePath) {
      const vaultRelative = vaultPath ? filePath.replace(vaultPath + "/", "") : filePath;
      lines.push(`> Source: \`${vaultRelative}\``);
      lines.push("");
    }
    // Task title with checkbox
    lines.push(`- [${task.done ? "x" : " "}] ${task.title}${task.dueDate ? ` [due:: ${task.dueDate}]` : ""}`);
    // Project links
    for (const pp of projectPaths) {
      lines.push(`  - Project: \`${pp}\``);
    }
    // Details
    if (task.details.length > 0 && task.details.some(l => l.trim())) {
      lines.push("");
      lines.push(...task.details);
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    });
    setShowMenu(false);
  }

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
          ref={titleRef}
          value={displayTitle}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
              e.preventDefault();
              saveTitle(e.currentTarget.value);
              focusEditor();
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
                Attach project
              </button>
              <button
                onClick={copyAsMarkdown}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
                {copyFeedback ? "Copied!" : "Copy as markdown"}
              </button>
              <div className="my-1 border-t border-[var(--border-default)]" />
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

      {/* Project cards (pinned) */}
      {linkedItems.length > 0 && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-default)] space-y-2">
          {linkedItems.map((item) => (
            <div
              key={item.path}
              className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 group cursor-pointer hover:border-[var(--border-hover)] transition-colors"
              onClick={() => {
                if (vaultPath && onNavigateToProject) {
                  onNavigateToProject(item.path, vaultPath);
                }
              }}
            >
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {item.icon ? (
                  <span className="text-base leading-none">{item.icon}</span>
                ) : (
                  <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {item.title}
                </div>
                <span className="text-xs text-[var(--text-tertiary)] truncate">
                  {item.path}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onRemoveProject) {
                    onRemoveProject(task.id, item.path);
                  } else {
                    // Fallback: remove by setting projectPaths without this one
                    const remaining = projectPaths.filter(p => p !== item.path);
                    onUpdateProject(task.id, remaining[0] ?? null);
                  }
                }}
                className="p-1 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
                title="Detach project"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
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
      <div ref={editorAreaRef} className="flex-1 overflow-y-auto px-6 py-4">
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
