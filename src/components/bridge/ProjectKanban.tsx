"use client";

import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";

const COLUMN_ORDER: { key: BridgeProjectStatus; label: string }[] = [
  { key: "thinking", label: "Thinking" },
  { key: "refining", label: "Refining" },
  { key: "scoping", label: "Scoping" },
  { key: "doing", label: "Doing" },
];

interface ProjectKanbanProps {
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
  onProjectClick?: (project: BridgeProject) => void;
}

export function ProjectKanban({ columns, onProjectClick }: ProjectKanbanProps) {
  const hasProjects = Object.values(columns).some(col => col.length > 0);

  if (!hasProjects) return null;

  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        Projects
      </h2>
      <div className="grid grid-cols-4 gap-3">
        {COLUMN_ORDER.map(({ key, label }) => (
          <div key={key} className="min-w-0">
            <div className="text-xs font-medium text-[var(--text-tertiary)] mb-2 flex items-center gap-1.5">
              <span>{label}</span>
              {columns[key].length > 0 && (
                <span className="text-[var(--text-tertiary)] opacity-60">
                  {columns[key].length}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {columns[key].map(project => (
                <ProjectCard key={project.slug} project={project} onClick={onProjectClick} />
              ))}
              {columns[key].length === 0 && (
                <div className="text-xs text-[var(--text-tertiary)] opacity-50 py-4 text-center">
                  —
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
