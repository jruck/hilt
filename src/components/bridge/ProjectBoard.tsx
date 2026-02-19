"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronRight, ArchiveRestore } from "lucide-react";
import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";

const SECTION_ORDER: { key: BridgeProjectStatus; label: string }[] = [
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

function sortByRecency(projects: BridgeProject[]): BridgeProject[] {
  return [...projects].sort((a, b) => b.lastModified - a.lastModified);
}

export function ProjectBoard({ columns, onProjectClick, onStatusChange, className }: ProjectBoardProps) {
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [restoreProject, setRestoreProject] = useState<BridgeProject | null>(null);
  const [dragOverSection, setDragOverSection] = useState<BridgeProjectStatus | null>(null);
  const restoreRef = useRef<HTMLDivElement>(null);

  const doneProjects = useMemo(() => sortByRecency(columns.done ?? []), [columns.done]);

  function findProjectBySlug(slug: string): BridgeProject | undefined {
    for (const list of Object.values(columns)) {
      const found = list.find(p => p.slug === slug);
      if (found) return found;
    }
    return undefined;
  }

  function handleDrop(e: React.DragEvent, targetStatus: BridgeProjectStatus) {
    e.preventDefault();
    setDragOverSection(null);
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
      setDragOverSection(status);
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

  const hasActiveProjects = SECTION_ORDER.some(({ key }) => columns[key]?.length > 0);

  if (!hasActiveProjects && doneProjects.length === 0) return null;

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        Projects
      </h2>

      <div className="flex flex-col gap-6">
        {/* Active sections: Doing → Refining → Considering */}
        {SECTION_ORDER.map(({ key, label }) => {
          const projects = sortByRecency(columns[key] ?? []);
          if (projects.length === 0) return null;

          return (
            <div
              key={key}
              className={`rounded-lg transition-colors ${
                dragOverSection === key ? "bg-[var(--bg-secondary)] p-2" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragEnter={(e) => handleDragOver(e, key)}
              onDragLeave={() => setDragOverSection(null)}
              onDrop={(e) => handleDrop(e, key)}
            >
              <div className="text-xs font-medium text-[var(--text-tertiary)] mb-2 flex items-center gap-1.5">
                <span>{label}</span>
                <span className="text-[var(--text-tertiary)] opacity-60">
                  {projects.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {projects.map(project => (
                  <ProjectCard
                    key={project.slug}
                    project={project}
                    onClick={onProjectClick}
                    onStatusChange={onStatusChange}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Done section — collapsed by default */}
        {doneProjects.length > 0 && (
          <div>
            <div
              className="flex items-center justify-between cursor-pointer group pr-3"
              onClick={() => setDoneExpanded(!doneExpanded)}
              title={doneExpanded ? "Collapse completed" : "Expand completed"}
            >
              <div className="text-xs font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors flex items-center gap-1.5">
                <span>Completed</span>
                <span className="opacity-60 group-hover:opacity-80 transition-opacity">
                  {doneProjects.length}
                </span>
              </div>
              <ChevronRight className={`w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-all ${doneExpanded ? "rotate-90" : ""}`} />
            </div>

            {doneExpanded && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {doneProjects.map(project => (
                  <div
                    key={project.slug}
                    className="group/done relative flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                  >
                    <button
                      onClick={() => onProjectClick?.(project)}
                      className="flex-1 text-left min-w-0"
                    >
                      <span className="text-sm text-[var(--text-secondary)] truncate block">
                        {project.icon && <span className="mr-1.5">{project.icon}</span>}
                        {project.title}
                      </span>
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
                          className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover/done:opacity-100 hover:text-[var(--text-secondary)] transition-all"
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
    </div>
  );
}
