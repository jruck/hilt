"use client";

import { useState, useCallback, useEffect } from "react";
import { useScope } from "@/contexts/ScopeContext";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import dynamic from "next/dynamic";
import type { ViewPrefix } from "@/lib/url-utils";
import { ViewMode } from "./ViewToggle";
import { NavBar } from "./NavBar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBriefingUnread } from "@/hooks/useBriefingUnread";
import { PullToRefresh } from "./PullToRefresh";
import { isSystemMode, stackScopeFromSystemUrl, systemModeFromUrl, systemScopeForMode, type SystemMode } from "@/lib/system/navigation";
import { Bookmark } from "lucide-react";

const DocsView = dynamic(() => import("./DocsView").then(m => ({ default: m.DocsView })), { ssr: false });
const BridgeView = dynamic(() => import("./bridge/BridgeView").then(m => ({ default: m.BridgeView })), { ssr: false });
const BriefingsView = dynamic(() => import("./briefings/BriefingsView").then(m => ({ default: m.BriefingsView })), { ssr: false });
const PeopleView = dynamic(() => import("./people/PeopleView").then(m => ({ default: m.PeopleView })), { ssr: false });
const SystemView = dynamic(() => import("./system").then(m => ({ default: m.SystemView })), { ssr: false });

const SYSTEM_MODE_STORAGE_KEY = "hilt-system-mode";
const PEOPLE_SCOPE_STORAGE_KEY = "hilt-people-scope";

function LibraryComingSoon() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--bg-primary)] px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] text-[var(--text-secondary)] content-card-shadow">
          <Bookmark className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium text-[var(--text-secondary)]">Coming Soon</p>
      </div>
    </div>
  );
}

function getStoredPeopleScope(): string {
  if (typeof window === "undefined") return "/__inbox__";
  const scope = localStorage.getItem(PEOPLE_SCOPE_STORAGE_KEY);
  if (!scope) return "/__inbox__";
  if (scope === "/sessions" || scope === "/apps" || scope === "/stack" || scope === "/sync" || scope.startsWith("/stack/")) {
    return "/__inbox__";
  }
  return scope.startsWith("/") ? scope : `/${scope}`;
}

export function Board() {
  // Scope path and view mode from context — URL-based routing
  const { scopePath, setScopePath, viewMode: urlViewMode, setViewMode: setUrlViewMode, replaceViewMode, navigateTo } = useScope();

  const { on } = useEventSocketContext();

  // Track if we've hydrated from localStorage (to prevent hydration mismatch)
  const [isHydrated, setIsHydrated] = useState(false);

  // Default scope for all views — fetched from server preferences
  // undefined = not yet loaded, string = resolved path (always has a value once loaded)
  const [workingFolder, setWorkingFolder] = useState<string | undefined>(undefined);

  // Derive top-level ViewMode from URL prefix.
  const viewMode: ViewMode = urlViewMode === "bridge" ? "bridge"
    : urlViewMode === "docs" ? "docs"
    : urlViewMode === "briefings" ? "briefings"
    : urlViewMode === "library" ? "library"
    : urlViewMode === "people" ? "people"
    : urlViewMode === "system" || urlViewMode === "map" || urlViewMode === "local-apps" || urlViewMode === "stack" ? "system"
    : "bridge"; // fallback
  const systemMode = systemModeFromUrl(urlViewMode, scopePath);
  const stackScopePath = stackScopeFromSystemUrl(urlViewMode, scopePath);

  // Unified setter
  const setViewMode = useCallback((mode: ViewMode) => {
    if (mode === "bridge") {
      setUrlViewMode("bridge");
    } else if (mode === "docs") {
      setUrlViewMode("docs");
    } else if (mode === "briefings") {
      setUrlViewMode("briefings");
    } else if (mode === "library") {
      navigateTo("library", "");
    } else if (mode === "people") {
      navigateTo("people", getStoredPeopleScope());
    } else if (mode === "system") {
      const lastMode = typeof window !== "undefined"
        ? (localStorage.getItem(SYSTEM_MODE_STORAGE_KEY) as SystemMode | null)
        : null;
      const nextMode: SystemMode = isSystemMode(lastMode)
        ? lastMode
        : systemMode;
      navigateTo("system", systemScopeForMode(nextMode, stackScopePath));
    }
  }, [navigateTo, setUrlViewMode, stackScopePath, systemMode]);

  const setSystemMode = useCallback((mode: SystemMode) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SYSTEM_MODE_STORAGE_KEY, mode);
    }
    navigateTo("system", systemScopeForMode(mode, mode === "stack" ? (stackScopePath || workingFolder || "") : ""));
  }, [navigateTo, stackScopePath, workingFolder]);

  // Hydrate after mount
  useEffect(() => {
    // Always open to Bridge when no view prefix in URL (e.g., Electron app startup)
    if (!urlViewMode) {
      replaceViewMode("bridge");
    }

    const frame = window.requestAnimationFrame(() => setIsHydrated(true));
    return () => window.cancelAnimationFrame(frame);
  }, [replaceViewMode, urlViewMode]);

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


  // Fetch workingFolder from server
  useEffect(() => {
    if (!isHydrated) return;
    if (workingFolder !== undefined) return;

    fetch("/api/folders")
      .then((res) => res.json())
      .then((data) => {
        setWorkingFolder(data.workingFolder || data.homeDir);
      })
      .catch(console.error);
  }, [isHydrated, workingFolder]);
  const isMobile = useIsMobile();
  const { hasUnread: hasBriefingUnread } = useBriefingUnread();
  const usesWorkspaceGutter = !isMobile && (viewMode === "docs" || viewMode === "people" || viewMode === "system");
  const usesWorkspaceTopBorder = !isMobile && (viewMode === "docs" || viewMode === "people");

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [addTaskTrigger, setAddTaskTrigger] = useState(0);

  // Pull-to-refresh: full page reload (simplest, most reliable for PWA)
  const handleRefresh = useCallback(async () => {
    window.location.reload();
    // Return a promise that never resolves — page will reload
    return new Promise<void>(() => {});
  }, []);

  // Listen for CLI navigation commands.
  //
  // Two paths cover this:
  //  1. WebSocket — works in both browser and Electron, but the renderer's
  //     reconnect timer pauses when an Electron window is hidden.
  //  2. Electron IPC — main process watches ~/.hilt-pending-navigate.json and
  //     forwards via webContents. Survives renderer throttling, so navigate
  //     reliably wakes a backgrounded window.
  useEffect(() => {
    const handleNavigate = (view: string, path: string) => {
      navigateTo(view as ViewPrefix, path || "");
      if (window.electronAPI?.focusWindow) {
        window.electronAPI.focusWindow();
      }
    };

    const unsubWs = on("navigate", "goto", (data: unknown) => {
      const { view, path } = data as { view: string; path?: string };
      handleNavigate(view, path || "");
    });

    const unsubIpc = window.electronAPI?.onNavigate?.(({ view, path }) => {
      handleNavigate(view, path);
    });

    return () => {
      unsubWs();
      unsubIpc?.();
    };
  }, [navigateTo, on]);

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
            scopePath={workingFolder || ""}
            focusedPath={scopePath}
            onPathChange={setScopePath}
            searchQuery={searchQuery}
          />
        ) : viewMode === "system" ? (
          <SystemView
            mode={systemMode}
            onModeChange={setSystemMode}
            searchQuery={searchQuery}
            workingFolder={stackScopePath || workingFolder || ""}
          />
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : viewMode === "library" ? (
          <LibraryComingSoon />
        ) : viewMode === "people" ? (
          <PeopleView searchQuery={searchQuery} />
        ) : null}
        </div>
        </PullToRefresh>}

        {!isMobile && <div className={`flex-1 flex flex-col overflow-hidden ${usesWorkspaceGutter ? "pt-[15px]" : ""}`}>
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${usesWorkspaceTopBorder ? "border-t border-[var(--border-default)]" : ""}`}>
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
            scopePath={workingFolder || ""}
            focusedPath={scopePath}
            onPathChange={setScopePath}
            searchQuery={searchQuery}
          />
        ) : viewMode === "system" ? (
          <SystemView
            mode={systemMode}
            onModeChange={setSystemMode}
            searchQuery={searchQuery}
            workingFolder={stackScopePath || workingFolder || ""}
          />
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : viewMode === "library" ? (
          <LibraryComingSoon />
        ) : viewMode === "people" ? (
          <PeopleView searchQuery={searchQuery} />
        ) : null}
        </div>
        </div>}
      </div>
    </div>
  );
}
