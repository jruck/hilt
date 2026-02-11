"use client";

import { useState, useRef, useEffect } from "react";
import { ArchiveRestore } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";

const COLUMN_ORDER: { key: BridgeProjectStatus; label: string }[] = [
  { key: "considering", label: "Considering" },
  { key: "refining", label: "Refining" },
  { key: "doing", label: "Doing" },
];

// Reversed for mobile: in-progress first
const COLUMN_ORDER_MOBILE: { key: BridgeProjectStatus; label: string }[] = [
  { key: "doing", label: "Doing" },
  { key: "refining", label: "Refining" },
  { key: "considering", label: "Considering" },
];

const RESTORE_OPTIONS: { key: BridgeProjectStatus; label: string }[] = [
  { key: "considering", label: "Considering" },
  { key: "refining", label: "Refining" },
  { key: "doing", label: "Doing" },
];

interface ProjectBoardProps {
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
  onProjectClick?: (project: BridgeProject) => void;
  onStatusChange?: (project: BridgeProject, status: BridgeProjectStatus) => void;
  className?: string;
}

export function ProjectBoard({ columns, onProjectClick, onStatusChange, className }: ProjectBoardProps) {
  const isMobile = useIsMobile();
  const [showDone, setShowDone] = useState(false);
  const [restoreProject, setRestoreProject] = useState<BridgeProject | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<BridgeProjectStatus | null>(null);
  const columnOrder = isMobile ? COLUMN_ORDER_MOBILE : COLUMN_ORDER;
  const restoreRef = useRef<HTMLDivElement>(null);

  const doneProjects = columns.done ?? [];

  function findProjectBySlug(slug: string): BridgeProject | undefined {
    for (const list of Object.values(columns)) {
      const found = list.find(p => p.slug === slug);
      if (found) return found;
    }
    return undefined;
  }

  function handleDrop(e: React.DragEvent, targetStatus: BridgeProjectStatus) {
    e.preventDefault();
    setDragOverColumn(null);
    const slug = e.dataTransfer.getData("application/x-project-slug");
    if (!slug || !onStatusChange) return;
    const project = findProjectBySlug(slug);
    if (project && project.status !== targetStatus) {
      onStatusChange(project, targetStatus);
    }
  }

  function handleDragOver(e: React.DragEvent, status: BridgeProjectStatus) {
    if (e.dataTransfer.types.includes("application/x-project-slug")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverColumn(status);
    }
  }

  // Close restore menu on click outside
  useEffect(() => {
    if (!restoreProject) return;
    function handleClick(e: MouseEvent) {
      if (restoreRef.current && !restoreRef.current.contains(e.target as Node)) {
        setRestoreProject(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [restoreProject]);

  // Only check the visible columns (not done)
  const hasProjects = columnOrder.some(({ key }) => columns[key]?.length > 0);

  if (!hasProjects && doneProjects.length === 0) return null;

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        Projects
      </h2>
      {hasProjects && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" style={{ minWidth: 0 }}>
          {columnOrder.map(({ key, label }) => (
            <div
              key={key}
              className={`min-w-0 rounded-lg p-2 -m-2 transition-colors ${
                dragOverColumn === key ? "bg-[var(--bg-secondary)]" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragEnter={(e) => handleDragOver(e, key)}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={(e) => handleDrop(e, key)}
            >
              <div className="text-xs font-medium text-[var(--text-tertiary)] mb-2 flex items-center gap-1.5">
                <span>{label}</span>
                {columns[key]?.length > 0 && (
                  <span className="text-[var(--text-tertiary)] opacity-60">
                    {columns[key].length}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {(columns[key] || []).map(project => (
                  <ProjectCard
                    key={project.slug}
                    project={project}
                    onClick={onProjectClick}
                    onStatusChange={onStatusChange}
                  />
                ))}
                {(!columns[key] || columns[key].length === 0) && (
                  <div className="text-xs text-[var(--text-tertiary)] opacity-50 py-4 text-center">
                    —
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Done projects */}
      {doneProjects.length > 0 && (
        <div className={hasProjects ? "mt-3" : ""}>
          <button
            onClick={() => setShowDone(!showDone)}
            className="w-full py-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-center"
          >
            {showDone ? "Hide" : "View"} {doneProjects.length} completed project{doneProjects.length !== 1 ? "s" : ""}
          </button>

          {showDone && (
            <div className="mt-1 space-y-1">
              {doneProjects.map(project => (
                <div
                  key={project.slug}
                  className="group relative flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                >
                  <button
                    onClick={() => onProjectClick?.(project)}
                    className="flex-1 text-left min-w-0"
                  >
                    <span className="text-sm text-[var(--text-secondary)] truncate block">{project.title}</span>
                    {project.area && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                        {project.area}
                      </span>
                    )}
                  </button>

                  {onStatusChange && (
                    <div ref={restoreProject?.slug === project.slug ? restoreRef : undefined} className="relative flex-shrink-0">
                      <button
                        onClick={() => setRestoreProject(restoreProject?.slug === project.slug ? null : project)}
                        className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
                        title="Restore to board"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>

                      {restoreProject?.slug === project.slug && (
                        <div className="absolute right-0 bottom-full mb-1 w-36 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
                          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                            Restore to
                          </div>
                          {RESTORE_OPTIONS.map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() => {
                                onStatusChange(project, key);
                                setRestoreProject(null);
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
