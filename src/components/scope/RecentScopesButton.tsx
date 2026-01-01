"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, Folder, Check } from "lucide-react";
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
  const [recentScopes, setRecentScopes] = useState<RecentScope[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Load recent scopes when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setRecentScopes(getRecentScopes());
    }
  }, [isOpen]);

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

  const displayPath = (path: string) => {
    if (!path) return "All Projects";
    if (!homeDir) return path;
    if (path === homeDir) return "All Projects";
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
        onClick={() => setIsOpen(!isOpen)}
        className={`p-1.5 rounded transition-colors ${
          isOpen
            ? "bg-zinc-700 text-zinc-200"
            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
        }`}
        title="Recent scopes"
      >
        <Clock className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 mt-1 w-[300px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-500 uppercase tracking-wide">
              Recent Scopes
            </span>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {filteredScopes.length === 0 ? (
              <p className="px-3 py-3 text-sm text-zinc-500 text-center">
                No recent scopes
              </p>
            ) : (
              filteredScopes.map((scope) => (
                <button
                  key={scope.path}
                  onClick={() => handleSelect(scope.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors text-zinc-300"
                >
                  <Folder className="w-4 h-4 text-zinc-500 flex-shrink-0" />
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
