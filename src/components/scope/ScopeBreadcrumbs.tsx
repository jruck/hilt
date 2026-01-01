"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
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

  // Check if we're at root (all projects)
  const isAtRoot = !value;

  // Get home folder name (e.g., "jruck" from "/Users/jruck")
  const homeFolderName = homeDir ? homeDir.split("/").filter(Boolean).pop() || "" : "";

  // Parse path into segments starting from root
  const parseSegments = (): Segment[] => {
    if (!value) return [];

    const segments: Segment[] = [];
    const parts = value.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      segments.push({
        name: part,
        fullPath: currentPath,
      });
    }

    return segments;
  };

  const segments = parseSegments();

  const handleRootClick = () => {
    if (isAtRoot) {
      // Already at root, toggle dropdown
      setIsDropdownOpen(!isDropdownOpen);
    } else {
      // Navigate to root (empty scope = all projects)
      onChange("");
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

  // Get display name for a segment (use home folder name like "jruck" for home path)
  const getDisplayName = (segment: Segment): string => {
    if (segment.fullPath === homeDir) {
      return homeFolderName;
    }
    return segment.name;
  };

  if (!homeDir) {
    return (
      <div className="flex items-center gap-1 text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  const isLastSegment = (index: number) => index === segments.length - 1;
  const lastSegmentPath = segments.length > 0 ? segments[segments.length - 1].fullPath : "";

  return (
    <div className="relative flex items-center gap-0.5">
      {/* Root "/" button - always shown */}
      <button
        ref={isAtRoot ? lastSegmentRef : undefined}
        onClick={handleRootClick}
        className={`
          flex items-center gap-1 px-2 py-1 rounded text-sm transition-colors font-mono
          ${isAtRoot
            ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          }
        `}
        title="All Projects (root)"
      >
        <span>/</span>
        {isAtRoot && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${
              isDropdownOpen ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Path segments */}
      {segments.map((segment, index) => {
        const isLast = isLastSegment(index);
        const displayName = getDisplayName(segment);

        return (
          <div key={segment.fullPath} className="flex items-center">
            {/* Separator */}
            <span className="text-zinc-600 px-0.5">/</span>

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
              <span className="font-mono">{displayName}</span>
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
