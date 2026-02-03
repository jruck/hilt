"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";
import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";

const STATUS_OPTIONS: { key: BridgeProjectStatus; label: string }[] = [
  { key: "considering", label: "Considering" },
  { key: "refining", label: "Refining" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
];

interface ProjectCardProps {
  project: BridgeProject;
  onClick?: (project: BridgeProject) => void;
  onStatusChange?: (project: BridgeProject, status: BridgeProjectStatus) => void;
}

export function ProjectCard({ project, onClick, onStatusChange }: ProjectCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<HTMLDivElement>(null);
  const pathContainerRef = useRef<HTMLDivElement>(null);

  // Measure overflow and set CSS variable for marquee distance
  useEffect(() => {
    const el = pathRef.current;
    const container = pathContainerRef.current;
    if (!el || !container) return;
    const overflow = el.scrollWidth - container.clientWidth;
    el.style.setProperty("--marquee-offset", overflow > 0 ? `-${overflow}px` : "0px");
  });

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

  return (
    <div
      draggable={!!onStatusChange}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-project-slug", project.slug);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 cursor-pointer hover:border-[var(--border-hover)] transition-colors"
      onClick={() => onClick?.(project)}
    >
      <div className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {project.title}
          </div>
        </div>

        {onStatusChange && (
          <div ref={menuRef} className="flex-shrink-0 relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-0.5 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Move to
                </div>
                {STATUS_OPTIONS.filter(s => s.key !== project.status).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      onStatusChange(project, key);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-secondary)] transition-colors ${
                      key === "done" ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={pathContainerRef} className="mt-1 overflow-hidden marquee-container">
        <div ref={pathRef} className="marquee-path text-xs text-[var(--text-tertiary)]">
          {project.relativePath}
        </div>
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
