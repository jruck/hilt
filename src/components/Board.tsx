"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useScope } from "@/contexts/ScopeContext";
import dynamic from "next/dynamic";
import { ScopeBreadcrumbs, BrowseButton, RecentScopesButton } from "./scope";
import { PinnedFoldersPopover } from "./scope/PinnedFoldersPopover";
import { ViewMode, getPrimaryView } from "./ViewToggle";
import { NavBar } from "./NavBar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBriefingUnread } from "@/hooks/useBriefingUnread";
import { PullToRefresh } from "./PullToRefresh";

const DocsView = dynamic(() => import("./DocsView").then(m => ({ default: m.DocsView })), { ssr: false });
const StackView = dynamic(() => import("./stack").then(m => ({ default: m.StackView })), { ssr: false });
const BridgeView = dynamic(() => import("./bridge/BridgeView").then(m => ({ default: m.BridgeView })), { ssr: false });
const BriefingsView = dynamic(() => import("./briefings/BriefingsView").then(m => ({ default: m.BriefingsView })), { ssr: false });
import { usePinnedFolders } from "@/hooks/usePinnedFolders";

const HOME_DIR_STORAGE_KEY = "hilt-home-dir";

export function Board() {
  // Scope path and view mode from context — URL-based routing
  const { scopePath, setScopePath, viewMode: urlViewMode, setViewMode: setUrlViewMode, replaceViewMode, navigateTo } = useScope();

  // Track if we've hydrated from localStorage (to prevent hydration mismatch)
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize with empty/default values for SSR, then hydrate from localStorage
  const [homeDir, setHomeDir] = useState<string>("");
  // Default scope for all views — fetched from server preferences
  // undefined = not yet loaded, string = resolved path (always has a value once loaded)
  const [workingFolder, setWorkingFolder] = useState<string | undefined>(undefined);
  const [docsInitialFile, setDocsInitialFile] = useState<string | null>(null);

  // Derive ViewMode from URL prefix
  const viewMode: ViewMode = urlViewMode === "bridge" ? "bridge"
    : urlViewMode === "docs" ? "docs"
    : urlViewMode === "stack" ? "stack"
    : urlViewMode === "briefings" ? "briefings"
    : "bridge"; // fallback

  // Unified setter
  const setViewMode = useCallback((mode: ViewMode) => {
    if (mode === "bridge") {
      setUrlViewMode("bridge");
    } else if (mode === "docs") {
      setUrlViewMode("docs");
    } else if (mode === "stack") {
      setUrlViewMode("stack");
    } else if (mode === "briefings") {
      setUrlViewMode("briefings");
    }
  }, [setUrlViewMode]);

  // Hydrate from localStorage (for homeDir) and server after mount
  useEffect(() => {
    const cachedHomeDir = localStorage.getItem(HOME_DIR_STORAGE_KEY) || "";

    if (cachedHomeDir) {
      setHomeDir(cachedHomeDir);
    }

    // Always open to Bridge when no view prefix in URL (e.g., Electron app startup)
    if (!urlViewMode) {
      replaceViewMode("bridge");
    }

    setIsHydrated(true);
  }, []);

  // Persist view mode to server when it changes (skip during initial hydration)
  useEffect(() => {
    if (isHydrated) {
      fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "viewMode", value: viewMode }),
      }).catch(() => {
        // Silently fail
      });
    }
  }, [viewMode, isHydrated]);


  // Fetch home directory after hydration (if not cached) and validate scope if set
  useEffect(() => {
    if (!isHydrated) return;

    // If we already have homeDir from cache, just validate scope and fetch workingFolder
    if (homeDir) {
      // Fetch workingFolder preference (needed for initial scope default)
      if (workingFolder === undefined) {
        fetch("/api/folders")
          .then((res) => res.json())
          .then((data) => {
            setWorkingFolder(data.workingFolder || data.homeDir);
          })
          .catch(() => setWorkingFolder(homeDir));
      }
      // Only validate if scope looks suspicious (not empty and not under cached homeDir)
      if (scopePath && !scopePath.startsWith(homeDir)) {
        fetch(`/api/folders?validate=${encodeURIComponent(scopePath)}`)
          .then((res) => res.json())
          .then((data) => {
            if (!data.valid) {
              setScopePath(workingFolder || homeDir);
            }
          })
          .catch(console.error);
      }
      return;
    }

    // No cache, need to fetch homeDir and workingFolder
    fetch("/api/folders")
      .then((res) => res.json())
      .then(async (data) => {
        setHomeDir(data.homeDir);
        localStorage.setItem(HOME_DIR_STORAGE_KEY, data.homeDir);
        setWorkingFolder(data.workingFolder || data.homeDir);

        // Validate current scope path if set
        if (scopePath && scopePath !== data.homeDir) {
          const validateRes = await fetch(`/api/folders?validate=${encodeURIComponent(scopePath)}`);
          const validateData = await validateRes.json();
          if (!validateData.valid) {
            setScopePath(data.workingFolder || data.homeDir);
          }
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  // Track if we've done the initial redirect (to prevent re-redirecting when user navigates to root)
  const hasInitialRedirected = useRef(false);

  // Default to workingFolder on initial load
  useEffect(() => {
    // Wait for workingFolder to be loaded (undefined = still loading)
    if (workingFolder === undefined) return;
    if (isHydrated && !hasInitialRedirected.current) {
      hasInitialRedirected.current = true;
      setScopePath(workingFolder);
    }
  }, [isHydrated, workingFolder, setScopePath]);

  const pinnedFolders = usePinnedFolders();
  const isMobile = useIsMobile();
  const { hasUnread: hasBriefingUnread } = useBriefingUnread();

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [addTaskTrigger, setAddTaskTrigger] = useState(0);

  // Pull-to-refresh: full page reload (simplest, most reliable for PWA)
  const handleRefresh = useCallback(async () => {
    window.location.reload();
    // Return a promise that never resolves — page will reload
    return new Promise<void>(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Nothing to dismiss currently
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Don't render until viewMode preference is loaded to prevent flash
  if (!isHydrated) {
    return <div className="flex flex-col h-dvh bg-[var(--bg-primary)]" />;
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-primary)]">
      {/* NavBar: top bar on desktop, fixed bottom bar on mobile */}
      <NavBar
        viewMode={viewMode}
        setViewMode={setViewMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setAddTaskTrigger={setAddTaskTrigger}
        unreadTabs={hasBriefingUnread ? new Set(["briefings"]) : undefined}
      />

      <div
        className="flex flex-1 overflow-hidden"
        style={undefined}
      >
        {/* Main content column — wrapped in PullToRefresh on mobile */}
        {isMobile && <PullToRefresh onRefresh={handleRefresh}>
        <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile scope header — breadcrumb + browse at top of content */}
        {getPrimaryView(viewMode) !== "bridge" && getPrimaryView(viewMode) !== "briefings" && (
          <div className="flex-shrink-0 flex items-center gap-1 px-3 h-10 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]">
            {homeDir && (
              <ScopeBreadcrumbs
                value={scopePath}
                homeDir={homeDir}
                onChange={setScopePath}
                isPinned={pinnedFolders.isPinned(scopePath)}
                onTogglePin={() => pinnedFolders.togglePin(scopePath)}
              />
            )}
            <BrowseButton onSelect={setScopePath} />
          </div>
        )}

        {/* Conditional View */}
        {viewMode === "bridge" ? (
          <BridgeView
            addTaskTrigger={addTaskTrigger}
            searchQuery={searchQuery}
            onNavigateToProject={(project) => {
              navigateTo("docs", project.path);
            }}
          />
        ) : viewMode === "docs" ? (
          <DocsView
            scopePath={scopePath}
            onScopeChange={setScopePath}
            searchQuery={searchQuery}
            initialFilePath={docsInitialFile}
            onInitialFileConsumed={() => setDocsInitialFile(null)}
          />
        ) : viewMode === "stack" ? (
          <div className="flex-1 overflow-hidden">
            <StackView scopePath={scopePath} searchQuery={searchQuery} />
          </div>
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : null}
        </div>
        </PullToRefresh>}

        {!isMobile && <div className="flex-1 flex flex-col overflow-hidden">
        {/* Conditional View */}
        {viewMode === "bridge" ? (
          <BridgeView
            addTaskTrigger={addTaskTrigger}
            searchQuery={searchQuery}
            onNavigateToProject={(project) => {
              navigateTo("docs", project.path);
            }}
          />
        ) : viewMode === "docs" ? (
          <DocsView
            scopePath={scopePath}
            onScopeChange={setScopePath}
            searchQuery={searchQuery}
            initialFilePath={docsInitialFile}
            onInitialFileConsumed={() => setDocsInitialFile(null)}
          />
        ) : viewMode === "stack" ? (
          <div className="flex-1 overflow-hidden">
            <StackView scopePath={scopePath} searchQuery={searchQuery} />
          </div>
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : null}

        {/* Bottom toolbar — scope controls (desktop only) */}
        {getPrimaryView(viewMode) !== "bridge" && getPrimaryView(viewMode) !== "briefings" && (
          <div className="flex-shrink-0 mt-auto flex items-center gap-1 px-4 h-10 bg-[var(--bg-secondary)] border-t border-[var(--border-default)]">
            {homeDir && (
              <>
                <ScopeBreadcrumbs
                  value={scopePath}
                  homeDir={homeDir}
                  onChange={setScopePath}
                  isPinned={pinnedFolders.isPinned(scopePath)}
                  onTogglePin={() => pinnedFolders.togglePin(scopePath)}
                />
                <RecentScopesButton
                  currentPath={scopePath}
                  homeDir={homeDir}
                  onSelect={setScopePath}
                />
              </>
            )}
            <BrowseButton onSelect={setScopePath} />
            <PinnedFoldersPopover
              currentScope={scopePath}
              onScopeChange={setScopePath}
              pinnedFolders={pinnedFolders}
            />
          </div>
        )}
        </div>}
      </div>
    </div>
  );
}
