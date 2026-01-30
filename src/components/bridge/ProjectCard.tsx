"use client";

import type { BridgeProject } from "@/lib/types";

interface ProjectCardProps {
  project: BridgeProject;
  onClick?: (project: BridgeProject) => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  return (
    <div
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 cursor-pointer hover:border-[var(--border-hover)] transition-colors"
      onClick={() => onClick?.(project)}
    >
      <div className="text-sm font-medium text-[var(--text-primary)] truncate">
        {project.title}
      </div>
      {project.area && (
        <div className="mt-1.5">
          <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
            {project.area}
          </span>
        </div>
      )}
    </div>
  );
}
