"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, ArchiveRestore } from "lucide-react";
import type { BridgeProject, BridgeProjectStatus } from "@/lib/types";
import { useBridgeProjects } from "@/hooks/useBridgeProjects";
import { useBridgeThoughts } from "@/hooks/useBridgeThoughts";

const RESTORE_OPTIONS: { key: BridgeProjectStatus; label: string }[] = [
  { key: "considering", label: "Considering" },
  { key: "refining", label: "Refining" },
  { key: "doing", label: "Doing" },
];

interface ProjectPickerProps {
  onSelect: (projectPath: string) => void;
  onClose: () => void;
}

export function ProjectPicker({ onSelect, onClose }: ProjectPickerProps) {
  const { data: projects, updateProjectStatus } = useBridgeProjects();
  const { data: thoughts } = useBridgeThoughts();
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [restoreProject, setRestoreProject] = useState<BridgeProject | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (restoreProject) {
          setRestoreProject(null);
        } else if (showDone) {
          setShowDone(false);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, showDone, restoreProject]);

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

  const allActive: BridgeProject[] = projects
    ? Object.entries(projects.columns)
        .filter(([key]) => key !== "done")
        .flatMap(([, list]) => list)
    : [];

  const allDone: BridgeProject[] = projects?.columns.done ?? [];

  // Writing/thoughts as pickable items
  const allThoughts: { title: string; relativePath: string; slug: string }[] = thoughts
    ? Object.values(thoughts.columns).flat().map(t => ({
        title: t.title,
        relativePath: t.relativePath,
        slug: t.slug,
      }))
    : [];

  const q = search.toLowerCase().trim();

  const filtered = q
    ? allActive.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.area.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q)
      )
    : allActive;

  const filteredThoughts = q
    ? allThoughts.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q)
      )
    : allThoughts;

  const filteredDone = q
    ? allDone.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.area.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q)
      )
    : allDone;

  // Group by source
  const grouped = useMemo(() => {
    const groups: { source: string; projects: BridgeProject[] }[] = [];
    const sourceMap = new Map<string, BridgeProject[]>();
    for (const p of filtered) {
      let list = sourceMap.get(p.source);
      if (!list) {
        list = [];
        sourceMap.set(p.source, list);
        groups.push({ source: p.source, projects: list });
      }
      list.push(p);
    }
    return groups;
  }, [filtered]);

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full mt-1 w-72 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden"
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
        <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto">
        {!showDone ? (
          <>
            {grouped.length === 0 && filteredThoughts.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">
                {allActive.length === 0 && allThoughts.length === 0 ? "No projects found" : "No matches"}
              </div>
            )}

            {/* Writing projects */}
            {filteredThoughts.length > 0 && (
              <div>
                <div className="px-3 pt-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Writing
                </div>
                {filteredThoughts.map((thought) => (
                  <button
                    key={thought.relativePath}
                    onClick={() => onSelect(thought.relativePath)}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <div className="text-sm text-[var(--text-primary)] truncate">{thought.title}</div>
                  </button>
                ))}
              </div>
            )}

            {grouped.map(({ source, projects: groupProjects }) => (
              <div key={source}>
                <div className="px-3 pt-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  {source}
                </div>
                {groupProjects.map((project) => (
                  <button
                    key={project.relativePath}
                    onClick={() => onSelect(project.relativePath)}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <div className="text-sm text-[var(--text-primary)] truncate">{project.title}</div>
                    {project.area && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                        {project.area}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}

            {/* Done projects toggle */}
            {allDone.length > 0 && (
              <button
                onClick={() => setShowDone(true)}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors border-t border-[var(--border-default)]"
              >
                {allDone.length} done project{allDone.length !== 1 ? "s" : ""}...
              </button>
            )}
          </>
        ) : (
          <>
            {/* Done projects view */}
            <button
              onClick={() => setShowDone(false)}
              className="w-full text-left px-3 py-2 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors border-b border-[var(--border-default)]"
            >
              ← Back
            </button>
            <div className="px-3 pt-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              Done
            </div>
            {filteredDone.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">
                No done projects
              </div>
            )}
            {filteredDone.map((project) => (
              <div
                key={project.relativePath}
                className="relative flex items-center px-3 py-1.5 hover:bg-[var(--bg-secondary)] transition-colors group"
              >
                <button
                  onClick={() => onSelect(project.relativePath)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-sm text-[var(--text-secondary)] truncate">{project.title}</div>
                  {project.area && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                      {project.area}
                    </span>
                  )}
                </button>

                {/* Restore menu */}
                <div ref={restoreProject?.relativePath === project.relativePath ? restoreRef : undefined} className="relative flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRestoreProject(restoreProject?.relativePath === project.relativePath ? null : project);
                    }}
                    className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
                    title="Restore to board"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                  </button>

                  {restoreProject?.relativePath === project.relativePath && (
                    <div className="absolute right-0 top-full mt-1 w-36 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
                      <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                        Restore to
                      </div>
                      {RESTORE_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateProjectStatus(project.path, key);
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
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
