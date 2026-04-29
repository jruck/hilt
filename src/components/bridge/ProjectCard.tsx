"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { CheckCircle2, MoreHorizontal, FolderOpen } from "lucide-react";
import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";
import { useHaptics } from "@/hooks/useHaptics";

interface ProjectCardProps {
  project: BridgeProject;
  onClick?: (project: BridgeProject) => void;
  onStatusChange?: (project: BridgeProject, status: BridgeProjectStatus) => void;
}

function getDisplayPath(project: BridgeProject): string {
  if (project.relativePath.includes("/clients/") || project.relativePath.startsWith("clients/")) {
    return `${project.source} / ${project.slug}`;
  }
  return project.relativePath;
}

export function ProjectCard({ project, onClick, onStatusChange }: ProjectCardProps) {
  const haptics = useHaptics();
  const [showMenu, setShowMenu] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<HTMLDivElement>(null);
  const pathContainerRef = useRef<HTMLDivElement>(null);
  const displayPath = getDisplayPath(project);

  const measureOverflow = useCallback(() => {
    const el = pathRef.current;
    const container = pathContainerRef.current;
    if (!el || !container) return;
    const overflow = el.scrollWidth - container.clientWidth;
    const overflows = overflow > 2; // small threshold for rounding
    setIsOverflowing(overflows);
    el.style.setProperty("--marquee-offset", overflows ? `-${overflow}px` : "0px");
  }, []);

  // Measure overflow and set CSS variable for marquee distance
  useEffect(() => {
    measureOverflow();
  }, [measureOverflow, displayPath]);

  // Re-measure on resize
  useEffect(() => {
    const container = pathContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureOverflow]);

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
      className="group rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 pt-2 pb-2.5 cursor-pointer hover:border-[var(--border-hover)] transition-colors"
      onClick={() => { haptics.selection(); onClick?.(project); }}
      title={`${project.title}\n${project.relativePath}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {project.icon ? (
            <span className="text-base leading-none">{project.icon}</span>
          ) : (
            <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
            {project.title}
          </div>
        </div>

        {onStatusChange && project.status !== "done" && (
        <div ref={menuRef} className="flex-shrink-0 relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onStatusChange(project, "done");
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-[var(--text-tertiary)]" />
                Mark completed
              </button>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Byline: area + path — full card width for proper fade */}
      <div className="flex items-center gap-2">
        {project.area && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] flex-shrink-0">
            {project.area}
          </span>
        )}
        <div className={`relative min-w-0 flex-1${isOverflowing ? " marquee-container" : ""}`}>
          <div ref={pathContainerRef} className="overflow-hidden">
            <div ref={pathRef} className="marquee-path text-xs text-[var(--text-tertiary)] whitespace-nowrap leading-tight">
              {displayPath}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
