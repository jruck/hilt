"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { SubfolderDropdown } from "./SubfolderDropdown";

interface ScopeBreadcrumbsProps {
  value: string;
  onChange: (path: string) => void;
}

interface Segment {
  name: string;      // Display name (e.g., "Work")
  fullPath: string;  // Full path up to this segment (e.g., "/Users/jruck/Work")
}

export function ScopeBreadcrumbs({ value, onChange }: ScopeBreadcrumbsProps) {
  const [homeDir, setHomeDir] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const lastSegmentRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch home directory
  useEffect(() => {
    fetch("/api/folders")
      .then((res) => res.json())
      .then((data) => setHomeDir(data.homeDir))
      .catch(console.error);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        lastSegmentRef.current &&
        !lastSegmentRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Check if we're at "All Projects" (home dir or no scope)
  const isAllProjects = !value || value === homeDir;

  // Parse path into segments (only when we have a specific scope beyond home)
  const parseSegments = (): Segment[] => {
    if (!homeDir || !value || value === homeDir) return [];

    const segments: Segment[] = [];

    // Get the relative path from home (or use absolute if not under home)
    let pathToProcess = value;
    let startPath = "";

    if (value.startsWith(homeDir)) {
      // Path is under home, start from home
      pathToProcess = value.slice(homeDir.length);
      startPath = homeDir;
    } else {
      // Path is not under home (rare), show full path
      pathToProcess = value;
      startPath = "";
    }

    // Split into parts and build segments
    const parts = pathToProcess.split("/").filter(Boolean);
    let currentPath = startPath;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
      segments.push({
        name: part,
        fullPath: currentPath,
      });
    }

    return segments;
  };

  const segments = parseSegments();

  const handleAllClick = () => {
    if (isAllProjects) {
      // Already at all projects, toggle dropdown to show top-level folders
      setIsDropdownOpen(!isDropdownOpen);
    } else {
      // Navigate to all projects (set to home dir)
      onChange(homeDir);
      setIsDropdownOpen(false);
    }
  };

  const handleSegmentClick = (segment: Segment) => {
    // If clicking the last segment, toggle dropdown
    if (segment.fullPath === value) {
      setIsDropdownOpen(!isDropdownOpen);
      return;
    }
    // Otherwise navigate to that path
    onChange(segment.fullPath);
    setIsDropdownOpen(false);
  };

  const handleSubfolderSelect = (path: string) => {
    onChange(path);
    setIsDropdownOpen(false);
  };

  if (!homeDir) {
    return (
      <div className="flex items-center gap-1 text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-0.5">
      {/* "All" button - always shown */}
      <button
        ref={isAllProjects ? lastSegmentRef : undefined}
        onClick={handleAllClick}
        className={`
          flex items-center gap-1 px-2 py-1 rounded text-sm transition-colors
          ${isAllProjects
            ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          }
        `}
        title="All Projects"
      >
        <Layers className="w-3.5 h-3.5" />
        <span>All</span>
        {isAllProjects && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${
              isDropdownOpen ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Path segments (only shown when scoped) */}
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <div key={segment.fullPath} className="flex items-center">
            {/* Separator */}
            <span className="text-zinc-500 px-1">/</span>

            {/* Segment button */}
            <button
              ref={isLast ? lastSegmentRef : undefined}
              onClick={() => handleSegmentClick(segment)}
              className={`
                flex items-center gap-1 px-2 py-1 rounded text-sm transition-colors
                ${isLast
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }
              `}
            >
              <span className="font-mono">{segment.name}</span>
              {isLast && (
                <ChevronDown
                  className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              )}
            </button>
          </div>
        );
      })}

      {/* Subfolder Dropdown */}
      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 mt-1 z-50"
        >
          <SubfolderDropdown
            currentPath={value}
            homeDir={homeDir}
            onSelect={handleSubfolderSelect}
            onClose={() => setIsDropdownOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
