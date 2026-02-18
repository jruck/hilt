"use client";

import { useState, useCallback, useEffect } from "react";
import { useScope } from "@/contexts/ScopeContext";
import dynamic from "next/dynamic";
import { ViewMode } from "./ViewToggle";
import { NavBar } from "./NavBar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBriefingUnread } from "@/hooks/useBriefingUnread";
import { PullToRefresh } from "./PullToRefresh";

const DocsView = dynamic(() => import("./DocsView").then(m => ({ default: m.DocsView })), { ssr: false });
const StackView = dynamic(() => import("./stack").then(m => ({ default: m.StackView })), { ssr: false });
const BridgeView = dynamic(() => import("./bridge/BridgeView").then(m => ({ default: m.BridgeView })), { ssr: false });
const BriefingsView = dynamic(() => import("./briefings/BriefingsView").then(m => ({ default: m.BriefingsView })), { ssr: false });
const PeopleView = dynamic(() => import("./people/PeopleView").then(m => ({ default: m.PeopleView })), { ssr: false });

export function Board() {
  // Scope path and view mode from context — URL-based routing
  const { scopePath, setScopePath, viewMode: urlViewMode, setViewMode: setUrlViewMode, replaceViewMode, navigateTo } = useScope();

  // Track if we've hydrated from localStorage (to prevent hydration mismatch)
  const [isHydrated, setIsHydrated] = useState(false);

  // Default scope for all views — fetched from server preferences
  // undefined = not yet loaded, string = resolved path (always has a value once loaded)
  const [workingFolder, setWorkingFolder] = useState<string | undefined>(undefined);

  // Derive ViewMode from URL prefix
  const viewMode: ViewMode = urlViewMode === "bridge" ? "bridge"
    : urlViewMode === "docs" ? "docs"
    : urlViewMode === "stack" ? "stack"
    : urlViewMode === "briefings" ? "briefings"
    : urlViewMode === "people" ? "people"
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
    } else if (mode === "people") {
      setUrlViewMode("people");
    }
  }, [setUrlViewMode]);

  // Hydrate after mount
  useEffect(() => {
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
        ) : viewMode === "stack" ? (
          <div className="flex-1 overflow-hidden">
            <StackView scopePath={workingFolder || ""} searchQuery={searchQuery} />
          </div>
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : viewMode === "people" ? (
          <PeopleView searchQuery={searchQuery} />
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
            scopePath={workingFolder || ""}
            focusedPath={scopePath}
            onPathChange={setScopePath}
            searchQuery={searchQuery}
          />
        ) : viewMode === "stack" ? (
          <div className="flex-1 overflow-hidden">
            <StackView scopePath={workingFolder || ""} searchQuery={searchQuery} />
          </div>
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : viewMode === "people" ? (
          <PeopleView searchQuery={searchQuery} />
        ) : null}
        </div>}
      </div>
    </div>
  );
}
