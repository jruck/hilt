"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Home } from "lucide-react";
import { SubfolderDropdown } from "./SubfolderDropdown";

interface ScopeBreadcrumbsProps {
  value: string;
  onChange: (path: string) => void;
}

interface Segment {
  name: string;      // Display name (e.g., "Work")
  fullPath: string;  // Full path up to this segment (e.g., "/Users/jruck/Work")
  isHome: boolean;   // Whether this is the home directory
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

  // Parse path into segments
  const parseSegments = (): Segment[] => {
    if (!homeDir || !value) return [];

    const segments: Segment[] = [];

    // Add home as first segment
    segments.push({
      name: "~",
      fullPath: homeDir,
      isHome: true,
    });

    // If we're at home, that's the only segment
    if (value === homeDir) return segments;

    // Get the relative path from home
    let relativePath = value;
    if (value.startsWith(homeDir)) {
      relativePath = value.slice(homeDir.length);
    }

    // Split into parts and build segments
    const parts = relativePath.split("/").filter(Boolean);
    let currentPath = homeDir;

    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      segments.push({
        name: part,
        fullPath: currentPath,
        isHome: false,
      });
    }

    return segments;
  };

  const segments = parseSegments();

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
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <div key={segment.fullPath} className="flex items-center">
            {/* Separator */}
            {index > 0 && (
              <span className="text-zinc-500 px-1">/</span>
            )}

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
              {segment.isHome ? (
                <Home className="w-3.5 h-3.5" />
              ) : (
                <span className="font-mono">{segment.name}</span>
              )}
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
