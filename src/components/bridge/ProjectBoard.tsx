"use client";

import { useMemo, useState } from "react";
import { ArchiveRestore, ChevronRight } from "lucide-react";
import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";

const ACTIVE_STATUSES: BridgeProjectStatus[] = ["doing", "refining", "considering"];
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface ProjectBoardProps {
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
  onProjectClick?: (project: BridgeProject) => void;
  onStatusChange?: (project: BridgeProject, status: BridgeProjectStatus) => void;
  className?: string;
}

function sortByRecency(projects: BridgeProject[]): BridgeProject[] {
  return [...projects].sort((a, b) => b.lastModified - a.lastModified);
}

function ProjectGrid({
  projects,
  onProjectClick,
  onStatusChange,
}: {
  projects: BridgeProject[];
  onProjectClick?: (project: BridgeProject) => void;
  onStatusChange?: (project: BridgeProject, status: BridgeProjectStatus) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {projects.map(project => (
        <ProjectCard
          key={project.relativePath}
          project={project}
          onClick={onProjectClick}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
}

function DividerToggle({
  expanded,
  onClick,
  closedLabel,
  openLabel,
  title,
}: {
  expanded: boolean;
  onClick: () => void;
  closedLabel: string;
  openLabel: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--border-default)]" />
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
        title={title}
      >
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        {expanded ? openLabel : closedLabel}
      </button>
      <div className="h-px flex-1 bg-[var(--border-default)]" />
    </div>
  );
}

export function ProjectBoard({ columns, onProjectClick, onStatusChange, className }: ProjectBoardProps) {
  const [olderExpanded, setOlderExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-project-older-expanded") === "true"; } catch { return false; }
  });
  const [completedExpanded, setCompletedExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-project-completed-expanded") === "true"; } catch { return false; }
  });
  const [recentCutoff] = useState(() => Date.now() - RECENT_WINDOW_MS);

  const activeProjects = useMemo(
    () => sortByRecency(ACTIVE_STATUSES.flatMap(status => columns[status] ?? [])),
    [columns]
  );
  const completedProjects = useMemo(() => sortByRecency(columns.done ?? []), [columns.done]);

  const recentProjects = activeProjects.filter(project => project.lastModified >= recentCutoff);
  const olderProjects = activeProjects.filter(project => project.lastModified < recentCutoff);

  function toggleOlderExpanded() {
    setOlderExpanded(prev => {
      const next = !prev;
      try { sessionStorage.setItem("bridge-project-older-expanded", String(next)); } catch {}
      return next;
    });
  }

  function toggleCompletedExpanded() {
    setCompletedExpanded(prev => {
      const next = !prev;
      try { sessionStorage.setItem("bridge-project-completed-expanded", String(next)); } catch {}
      return next;
    });
  }

  const hasProjects = activeProjects.length > 0 || completedProjects.length > 0;
  if (!hasProjects) return null;

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        Projects
      </h2>

      <div className="flex flex-col gap-4">
        {recentProjects.length > 0 && (
          <ProjectGrid
            projects={recentProjects}
            onProjectClick={onProjectClick}
            onStatusChange={onStatusChange}
          />
        )}

        {olderProjects.length > 0 && (
          <div>
            <DividerToggle
              expanded={olderExpanded}
              onClick={toggleOlderExpanded}
              closedLabel={`View older projects (${olderProjects.length})`}
              openLabel="Hide older projects"
              title={olderExpanded ? "Hide older projects" : "View older projects"}
            />

            {olderExpanded && (
              <div className="mt-3">
                <ProjectGrid
                  projects={olderProjects}
                  onProjectClick={onProjectClick}
                  onStatusChange={onStatusChange}
                />
              </div>
            )}
          </div>
        )}

        {completedProjects.length > 0 && (
          <div>
            <DividerToggle
              expanded={completedExpanded}
              onClick={toggleCompletedExpanded}
              closedLabel={`View completed projects (${completedProjects.length})`}
              openLabel="Hide completed projects"
              title={completedExpanded ? "Hide completed projects" : "View completed projects"}
            />

            {completedExpanded && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {completedProjects.map(project => (
                  <div
                    key={project.relativePath}
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
                      <button
                        onClick={() => onStatusChange(project, "doing")}
                        className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover/done:opacity-100 hover:text-[var(--text-secondary)] transition-all"
                        title="Restore to projects"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>
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
