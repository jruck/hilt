"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ViewToggle, ViewMode } from "./ViewToggle";
import { ThemeToggle } from "./ThemeToggle";
import { SourceToggle } from "./SourceToggle";
import { Search, X, Plus } from "lucide-react";

const SHORTCUTS = [
  { keys: "⌘ K", description: "Search" },
  { keys: "⌘ J", description: "Add task" },
  { keys: "⌘ 1", description: "Bridge" },
  { keys: "⌘ 2", description: "Docs" },
  { keys: "⌘ 3", description: "Stack" },
  { keys: "Esc", description: "Close search" },
];

function ShortcutsPopup({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      {/* Popup */}
      <div
        className="fixed z-[101] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl p-4 w-64"
        style={{ top: "56px", left: "50%", transform: "translateX(-50%)" }}
      >
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
          Keyboard Shortcuts
        </h3>
        <div className="space-y-2">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={keys} className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">{description}</span>
              <kbd className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-default)]">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastCmdPressRef = useRef<number>(0);

  const VIEW_KEYS: Record<string, ViewMode> = { "1": "bridge", "2": "docs", "3": "stack" };

  // Double-press ⌘ to toggle shortcuts popup
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Meta" || e.key === "Control") {
        const now = Date.now();
        if (now - lastCmdPressRef.current < 400) {
          setShowShortcuts((prev) => !prev);
          lastCmdPressRef.current = 0; // reset so triple doesn't re-toggle
        } else {
          lastCmdPressRef.current = now;
        }
      } else {
        // Any other key pressed with ⌘ means it's a shortcut, not a double-press
        if (e.metaKey || e.ctrlKey) lastCmdPressRef.current = 0;
        // Close popup on any shortcut use
        if (showShortcuts) setShowShortcuts(false);
      }
    }
    function handleBlur() { setShowShortcuts(false); }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [showShortcuts]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K: toggle search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isMobile) {
          setMobileSearchOpen((prev) => !prev);
        } else if (searchQuery) {
          setSearchQuery("");
          searchInputRef.current?.blur();
        } else {
          setSearchQuery(" ");
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }
        return;
      }

      // Escape: close search
      if (e.key === "Escape") {
        if (searchQuery || mobileSearchOpen) {
          e.preventDefault();
          setSearchQuery("");
          setMobileSearchOpen(false);
          searchInputRef.current?.blur();
          return;
        }
      }

      // Cmd+1/2/3: switch tabs
      if ((e.metaKey || e.ctrlKey) && VIEW_KEYS[e.key]) {
        e.preventDefault();
        setViewMode(VIEW_KEYS[e.key]);
        return;
      }

      // Cmd+J: add task
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        if (viewMode !== "bridge") setViewMode("bridge");
        setAddTaskTrigger((c) => c + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery, mobileSearchOpen, isMobile, setSearchQuery, setViewMode, viewMode, setAddTaskTrigger]);

  if (isMobile) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)",
        }}
      >
        <nav
          className={`pointer-events-auto rounded-full border border-white/20 shadow-lg shadow-black/20 ${mobileSearchOpen ? "mx-6 w-[calc(100%-48px)]" : ""}`}
          style={{
            background: "rgba(255, 255, 255, 0.15)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            transition: "width 200ms ease",
          }}
        >
          {mobileSearchOpen ? (
            /* Search mode: full-width pill with input */
            <div className="flex items-center gap-2 h-14 px-4">
              <Search className="flex-shrink-0 w-5 h-5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery.trim() === "" ? "" : searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="flex-1 min-w-0 py-2 text-base bg-transparent text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
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
      {/* Left: Add task button */}
      <div
        className="flex items-center flex-1 mr-4 pointer-events-none"
      >
        <div className="relative pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={() => {
              if (viewMode !== "bridge") setViewMode("bridge");
              setAddTaskTrigger((c) => c + 1);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-80 transition-opacity"
            title="Add task (⌘J)"
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Center: View toggle — absolutely centered in full toolbar width */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-10 overflow-visible"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <ViewToggle view={viewMode} onChange={setViewMode} />
      </div>

      {/* Right: search, theme, source — fills from center toggle */}
      <div
        className="flex items-center justify-end gap-2 flex-1 min-w-0 ml-4 pointer-events-none"
      >
        {/* Search — expands to the left */}
        <div
          className="relative flex items-center justify-end pointer-events-auto"
          style={{
            WebkitAppRegion: "no-drag",
            flex: searchQuery ? "1 1 auto" : "0 0 auto",
            minWidth: searchQuery ? 0 : "auto",
            transition: "flex 250ms cubic-bezier(0.4, 0, 0.2, 1)",
          } as React.CSSProperties}
        >
          {/* Expanded: pill search bar */}
          <div
            className="relative overflow-hidden rounded-full"
            style={{
              background: "var(--bg-tertiary)",
              width: searchQuery ? "100%" : "0px",
              opacity: searchQuery ? 1 : 0,
              transition: "width 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease",
            }}
          >
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={searchQuery.trim() === "" ? "" : searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={(e) => {
                if (!e.target.value.trim()) setSearchQuery("");
              }}
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-transparent rounded-full text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
              tabIndex={searchQuery ? 0 : -1}
            />
            <button
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.blur();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              style={{
                opacity: searchQuery ? 1 : 0,
                transition: "opacity 150ms ease",
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Collapsed: invisible spacer to hold the icon button size */}
          <div
            className="flex-shrink-0"
            style={{
              width: searchQuery ? "0px" : "28px",
              height: "28px",
              transition: "width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
              overflow: "hidden",
            }}
          />

          {/* Single search icon — travels from right (collapsed) to left of pill (expanded) */}
          <div
            onClick={() => {
              if (!searchQuery) {
                setSearchQuery(" ");
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }
            }}
            className="absolute top-1/2 -translate-y-1/2 z-10 w-4 h-4 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            style={{
              left: searchQuery ? "10px" : "calc(100% - 22px)",
              cursor: searchQuery ? "default" : "pointer",
              transition: "left 250ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            title="Search (⌘K)"
          >
            <Search className="w-4 h-4" />
          </div>
        </div>

        <div className="pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}><ThemeToggle /></div>
        <div className="pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}><SourceToggle /></div>
      </div>

      <ShortcutsPopup visible={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
