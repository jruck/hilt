"use client";

import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ViewToggle, ViewMode } from "./ViewToggle";
import { ThemeToggle } from "./ThemeToggle";
import { Search, X, Plus } from "lucide-react";

interface NavBarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setAddTaskTrigger: React.Dispatch<React.SetStateAction<number>>;
}

export function NavBar({
  viewMode,
  setViewMode,
  searchQuery,
  setSearchQuery,
  setAddTaskTrigger,
}: NavBarProps) {
  const isMobile = useIsMobile();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  if (isMobile) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
        }}
      >
        <nav
          className="pointer-events-auto rounded-full border border-white/20 shadow-lg shadow-black/20"
          style={{
            background: "rgba(255, 255, 255, 0.15)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
          }}
        >
          {mobileSearchOpen ? (
            /* Search mode: expanded pill with input */
            <div className="flex items-center gap-2 h-14 px-4">
              <Search className="flex-shrink-0 w-5 h-5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery.trim() === "" ? "" : searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-48 py-2 text-base bg-transparent text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
              />
              <button
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSearchQuery("");
                }}
                className="flex items-center justify-center w-10 h-10 text-[var(--text-secondary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            /* Normal mode: compact floating pill */
            <div className="flex items-center gap-1 h-14 px-2">
              {/* Search */}
              <button
                onClick={() => setMobileSearchOpen(true)}
                className="flex items-center justify-center w-12 h-12 rounded-full text-[var(--text-secondary)] active:bg-white/10 transition-colors"
                title="Search"
              >
                <Search className="w-6 h-6" />
              </button>

              {/* View toggle (compact mode) */}
              <ViewToggle view={viewMode} onChange={setViewMode} compact />

              {/* Add button */}
              <button
                onClick={() => {
                  if (viewMode !== "bridge") setViewMode("bridge");
                  setAddTaskTrigger((c) => c + 1);
                }}
                className="flex items-center justify-center w-12 h-12 rounded-full text-[var(--text-secondary)] active:bg-white/10 transition-colors"
                title="Add task"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
          )}
        </nav>
      </div>
    );
  }

  // Desktop: render the existing top bar
  return (
    <div
      data-statusbar
      className="relative flex items-center px-4 h-11 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: search, theme */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Search */}
        {searchQuery ? (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={(e) => {
                if (!e.target.value) setSearchQuery("");
              }}
              autoFocus
              className="w-40 pl-8 pr-7 py-1.5 text-sm bg-[var(--bg-tertiary)] rounded text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
            />
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchQuery(" ")}
            className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            title="Search"
          >
            <Search className="w-4 h-4" />
          </button>
        )}

        {/* Theme toggle */}
        <ThemeToggle />
      </div>

      {/* Center: View toggle (absolute center) */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <ViewToggle view={viewMode} onChange={setViewMode} />
      </div>

      {/* Right: Add task button */}
      <div
        className="flex items-center ml-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={() => {
            if (viewMode !== "bridge") setViewMode("bridge");
            setAddTaskTrigger((c) => c + 1);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-80 transition-opacity"
          title="Add task"
        >
          <Plus className="w-4 h-4" />
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}
