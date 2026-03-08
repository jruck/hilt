"use client";

import { useState, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useHaptics } from "@/hooks/useHaptics";
import { ViewToggle, ViewMode } from "./ViewToggle";
import { ThemeToggle } from "./ThemeToggle";
import { SourceToggle } from "./SourceToggle";
import { Search, X, Layers } from "lucide-react";

const SHORTCUTS = [
  { keys: "⌘ K", description: "Search" },
  { keys: "⌘ J", description: "Add task" },
  { keys: "⌘ 1", description: "Briefing" },
  { keys: "⌘ 2", description: "Bridge" },
  { keys: "⌘ 3", description: "Docs" },
  { keys: "⌘ 4", description: "People" },
  { keys: "Esc", description: "Close search" },
];

function ShortcutsPopup({ visible, onFocus }: { visible: boolean; onClose: () => void; onFocus?: () => void }) {
  if (!visible) return null;
  return (
    <>
      <div
        className="fixed z-[101] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl p-4 w-64"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onClick={(e) => { e.stopPropagation(); onFocus?.(); }}
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
  unreadTabs?: Set<string>;
}

export function NavBar({
  viewMode,
  setViewMode,
  searchQuery,
  setSearchQuery,
  setAddTaskTrigger,
  unreadTabs,
}: NavBarProps) {
  const isMobile = useIsMobile();
  const haptics = useHaptics();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [activePanel, setActivePanel] = useState<"all" | "shortcuts" | "nextjs" | "inspector">("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastCmdPressRef = useRef<number>(0);

  const VIEW_KEYS: Record<string, ViewMode> = { "1": "briefings", "2": "bridge", "3": "docs", "4": "people" };

  const showShortcuts = devMode && (activePanel === "all" || activePanel === "shortcuts");
  const showNextjs = devMode && (activePanel === "all" || activePanel === "nextjs");
  const showInspector = devMode && (activePanel === "all" || activePanel === "inspector");

  // Sync dev mode + focus attributes on body
  useEffect(() => {
    if (devMode) {
      document.body.setAttribute("data-dev-mode", "");
      if (activePanel === "all") {
        document.body.removeAttribute("data-dev-focus");
      } else {
        document.body.setAttribute("data-dev-focus", activePanel);
      }
    } else {
      document.body.removeAttribute("data-dev-mode");
      document.body.removeAttribute("data-dev-focus");
    }
  }, [devMode, activePanel]);

  // Detect clicks on Next.js toolbar or Agentation to focus that panel
  useEffect(() => {
    if (!devMode) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // Check if click is inside Agentation
      if (target.closest("#agentation-wrapper")) {
        setActivePanel("inspector");
        return;
      }
      // Check if click is inside Next.js dev tools
      if (target.closest("nextjs-portal") || target.closest("[data-nextjs-toast]") || target.closest("[data-feedback-toolbar]")) {
        setActivePanel("nextjs");
        return;
      }
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [devMode]);

  // Also hide dev tools on initial mount (they may inject after first render)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (document.body.hasAttribute("data-dev-mode")) return;
      document.querySelectorAll("nextjs-portal, [data-nextjs-toast], [data-feedback-toolbar]").forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
    });
    observer.observe(document.body, { childList: true, subtree: false });
    // Initial pass
    document.querySelectorAll("nextjs-portal, [data-nextjs-toast], [data-feedback-toolbar]").forEach((el) => {
      (el as HTMLElement).style.display = "none";
    });
    return () => observer.disconnect();
  }, []);

  // Double-press ⌘ to toggle shortcuts popup
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = /mac/i.test(navigator.userAgent);
      if (e.key === (isMac ? "Meta" : "Control")) {
        const now = Date.now();
        if (now - lastCmdPressRef.current < 400) {
          setDevMode((prev) => !prev);
          setActivePanel("all");
          lastCmdPressRef.current = 0; // reset so triple doesn't re-toggle
        } else {
          lastCmdPressRef.current = now;
        }
      } else {
        // Any other key pressed with ⌘ means it's a shortcut, not a double-press
        if (e.metaKey || e.ctrlKey) lastCmdPressRef.current = 0;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
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
          paddingBottom: "calc(env(safe-area-inset-bottom) + 21px)",
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
                  haptics.rigid();
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
                onClick={() => { haptics.light(); setMobileSearchOpen(true); }}
                className="flex items-center justify-center w-12 h-12 rounded-full text-[var(--text-tertiary)] active:bg-white/10 transition-colors"
                title="Search"
              >
                <Search className="w-6 h-6" />
              </button>

              {/* View toggle (compact mode) */}
              <ViewToggle view={viewMode} onChange={setViewMode} compact onDoubleTapActive={() => window.location.reload()} unreadTabs={unreadTabs} />

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
      className="relative h-11 bg-[var(--bg-secondary)] border-b border-[var(--border-default)] px-4 flex items-center"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Center: View toggle — absolutely centered in the bar */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <ViewToggle view={viewMode} onChange={setViewMode} unreadTabs={unreadTabs} />
        </div>
      </div>

      {/* Right: search, stack, theme, source — pushed to the right */}
      <div
        className="ml-auto flex items-center justify-end gap-2 min-w-0 pointer-events-none"
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
                haptics.rigid();
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
                haptics.light();
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

        <button
          onClick={() => setViewMode("stack")}
          className={`pointer-events-auto flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
            viewMode === "stack"
              ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title="Settings"
        >
          <Layers className="w-4 h-4" />
        </button>
        <div className="pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}><ThemeToggle /></div>
        <div className="pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}><SourceToggle /></div>
      </div>

      <ShortcutsPopup visible={showShortcuts} onClose={() => setDevMode(false)} onFocus={() => setActivePanel("shortcuts")} />
    </div>
  );
}
