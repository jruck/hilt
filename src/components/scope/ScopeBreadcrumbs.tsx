"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { SubfolderDropdown } from "./SubfolderDropdown";
import { useIsMobile } from "@/hooks/useIsMobile";

interface ScopeBreadcrumbsProps {
  value: string;
  homeDir: string;
  onChange: (path: string) => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

interface Segment {
  name: string;      // Display name (e.g., "Work")
  fullPath: string;  // Full path up to this segment (e.g., "/Users/me/Work")
}

export function ScopeBreadcrumbs({ value, homeDir, onChange, isPinned, onTogglePin }: ScopeBreadcrumbsProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownLeft, setDropdownLeft] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSegmentRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

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

  // Get home folder name (e.g., "username" from "/Users/username")
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

  // Calculate dropdown position relative to trigger button
  const updateDropdownPosition = (button: HTMLButtonElement) => {
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setDropdownLeft(buttonRect.left - containerRect.left);
    }
  };

  const handleRootClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isAtRoot) {
      // Already at root, toggle dropdown
      updateDropdownPosition(e.currentTarget);
      setIsDropdownOpen(!isDropdownOpen);
    } else {
      // Navigate to root (empty scope = all projects)
      onChange("");
      setIsDropdownOpen(false);
    }
  };

  const handleSegmentClick = (segment: Segment, e: React.MouseEvent<HTMLButtonElement>) => {
    // If clicking the last segment, toggle dropdown
    if (segment.fullPath === value) {
      updateDropdownPosition(e.currentTarget);
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

  // Get display name for a segment (use home folder name for home path)
  const getDisplayName = (segment: Segment): string => {
    if (segment.fullPath === homeDir) {
      return homeFolderName;
    }
    return segment.name;
  };

  const isLastSegment = (index: number) => index === segments.length - 1;
  const lastSegmentPath = segments.length > 0 ? segments[segments.length - 1].fullPath : "";

  return (
    <div className="flex items-center gap-1">
      <div ref={containerRef} className="relative flex items-center gap-0.5">
        {/* Root "/" button - always shown */}
        <button
          ref={isAtRoot ? lastSegmentRef : undefined}
          onClick={handleRootClick}
          className={`flex items-center gap-1 px-2 rounded text-[13px] transition-colors font-mono hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${isMobile ? "py-1.5 min-h-[32px]" : "py-1"}`}
          title="All Projects (root)"
        >
          <span>/</span>
          {isAtRoot && (
            <ChevronDown
              className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform ${
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
              <span className="text-[var(--text-tertiary)] text-[13px] px-0.5">→</span>

              {/* Segment button */}
              <button
                ref={isLast ? lastSegmentRef : undefined}
                onClick={(e) => handleSegmentClick(segment, e)}
                className={`flex items-center gap-1 px-2 rounded text-[13px] transition-colors font-mono hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${isMobile ? "py-1.5 min-h-[32px]" : "py-1"}`}
              >
                <span className="font-mono">{displayName}</span>
                {isLast && (
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform ${
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
            className="absolute top-full mt-1 z-50"
            style={{ left: dropdownLeft }}
          >
            <SubfolderDropdown
              currentPath={value}
              homeDir={homeDir}
              onSelect={handleSubfolderSelect}
              onClose={() => setIsDropdownOpen(false)}
              isPinned={isPinned}
              onTogglePin={onTogglePin}
            />
          </div>
        )}
      </div>
    </div>
  );
}
