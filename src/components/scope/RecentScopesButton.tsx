"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Clock, Folder } from "lucide-react";
import { getRecentScopes, type RecentScope } from "@/lib/recent-scopes";

interface RecentScopesButtonProps {
  currentPath: string;
  homeDir: string;
  onSelect: (path: string) => void;
}

export function RecentScopesButton({
  currentPath,
  homeDir,
  onSelect,
}: RecentScopesButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Track a version number that changes when dropdown opens - triggers recompute
  const [refreshKey, setRefreshKey] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Compute recent scopes when dropdown opens (triggered by refreshKey change)
  const recentScopes = useMemo(() => {
    if (!isOpen) return [];
    // refreshKey is in deps to trigger recompute when dropdown opens
    void refreshKey;
    return getRecentScopes();
  }, [isOpen, refreshKey]);

  // Update refresh key when dropdown opens
  const handleToggle = () => {
    if (!isOpen) {
      setRefreshKey(k => k + 1);
    }
    setIsOpen(!isOpen);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Get home folder name (e.g., "jruck" from "/Users/jruck")
  const homeFolderName = homeDir ? homeDir.split("/").filter(Boolean).pop() || "" : "";

  const displayPath = (path: string) => {
    if (!path) return "/";  // Root = all projects
    if (!homeDir) return path;
    if (path === homeDir) return `~/${homeFolderName}`;  // Home dir shows as ~/username
    if (path.startsWith(homeDir)) return "~" + path.slice(homeDir.length);
    return path;
  };

  const handleSelect = (path: string) => {
    onSelect(path);
    setIsOpen(false);
  };

  // Filter out current path from recent scopes
  const filteredScopes = recentScopes.filter((s) => s.path !== currentPath);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`p-1.5 rounded transition-colors ${
          isOpen
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        }`}
        title="Recent scopes"
      >
        <Clock className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 mt-1 w-[300px] bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg shadow-xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[var(--border-default)]">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
              Recent Scopes
            </span>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {filteredScopes.length === 0 ? (
              <p className="px-3 py-3 text-sm text-[var(--text-tertiary)] text-center">
                No recent scopes
              </p>
            ) : (
              filteredScopes.map((scope) => (
                <button
                  key={scope.path}
                  onClick={() => handleSelect(scope.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)]"
                >
                  <Folder className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
                  <span className="flex-1 font-mono truncate">
                    {displayPath(scope.path)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
