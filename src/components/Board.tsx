"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useScope } from "@/contexts/ScopeContext";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import dynamic from "next/dynamic";
import type { ViewPrefix } from "@/lib/url-utils";
import { chooseLandingView } from "@/lib/landing-view";
import { ViewMode } from "./ViewToggle";
import { NavBar } from "./NavBar";
import { AppHud } from "./AppHud";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBriefingUnread } from "@/hooks/useBriefingUnread";
import { prefetchCalendarCaches } from "@/hooks/useCalendar";
import { useLibraryUnread } from "@/hooks/useLibrary";
import { prefetchWeatherForecast } from "@/hooks/useWeather";
import { PullToRefresh } from "./PullToRefresh";
import { MobileChromeProvider } from "@/contexts/MobileChromeContext";
import { CALENDAR_EVENT_OPEN_EVENT, PENDING_CALENDAR_EVENT_STORAGE_KEY, type CalendarEventOpenDetail } from "@/lib/calendar/deeplink";
import { isSystemMode, stackScopeFromSystemUrl, systemModeFromUrl, systemScopeForMode, type SystemMode } from "@/lib/system/navigation";
import { withBasePath } from "@/lib/base-path";

const DocsView = dynamic(() => import("./DocsView").then(m => ({ default: m.DocsView })), { ssr: false });
const BridgeView = dynamic(() => import("./bridge/BridgeView").then(m => ({ default: m.BridgeView })), { ssr: false });
const BriefingsView = dynamic(() => import("./briefings/BriefingsView").then(m => ({ default: m.BriefingsView })), { ssr: false });
const CalendarView = dynamic(() => loadCalendarViewModule().then(m => ({ default: m.CalendarView })), { ssr: false });
const LibraryView = dynamic(() => import("./library/LibraryView").then(m => ({ default: m.LibraryView })), { ssr: false });
const PeopleView = dynamic(() => import("./people/PeopleView").then(m => ({ default: m.PeopleView })), { ssr: false });
const SystemView = dynamic(() => import("./system").then(m => ({ default: m.SystemView })), { ssr: false });

const SYSTEM_MODE_STORAGE_KEY = "hilt-system-mode";
const PEOPLE_SCOPE_STORAGE_KEY = "hilt-people-scope";
const HUD_VISIBILITY_STORAGE_KEY = "hilt-app-hud-visible";
const CALENDAR_WARMUP_DELAY_MS = 1_200;
const CALENDAR_WARMUP_IDLE_TIMEOUT_MS = 4_000;

type BridgeTaskOpenRequest = { taskId: string; token: number };
type IdleCallbackHandle = number;
type IdleWindow = Window & {
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => IdleCallbackHandle;
};

let calendarWarmupPromise: Promise<void> | null = null;

function loadCalendarViewModule() {
  return import("./calendar/CalendarView");
}

function warmCalendarTabResources(): Promise<void> {
  if (calendarWarmupPromise) return calendarWarmupPromise;
  const { eventRange, weatherRange } = defaultCalendarWarmupRanges();
  calendarWarmupPromise = Promise.allSettled([
    loadCalendarViewModule(),
    prefetchCalendarCaches(eventRange),
    prefetchWeatherForecast(weatherRange),
  ]).then(() => undefined);
  return calendarWarmupPromise;
}

function defaultCalendarWarmupRanges(): {
  eventRange: { start: Date; end: Date };
  weatherRange: { start: string; end: string };
} {
  const today = new Date();
  const mode = window.matchMedia("(max-width: 767px)").matches ? "day" : "week";
  const start = startOfLocalDay(today);
  if (mode === "week") start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + (mode === "week" ? 6 : 0));
  end.setHours(23, 59, 59, 999);
  return {
    eventRange: { start, end },
    weatherRange: {
      start: localDateKey(start),
      end: localDateKey(end),
    },
  };
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleIdleWarmup(callback: () => void): () => void {
  const win = window as IdleWindow;
  let timeoutId: number | null = null;
  let idleHandle: IdleCallbackHandle | null = null;
  timeoutId = window.setTimeout(() => {
    timeoutId = null;
    if (win.requestIdleCallback) {
      idleHandle = win.requestIdleCallback(callback, { timeout: CALENDAR_WARMUP_IDLE_TIMEOUT_MS });
      return;
    }
    callback();
  }, CALENDAR_WARMUP_DELAY_MS);

  return () => {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (idleHandle !== null) win.cancelIdleCallback?.(idleHandle);
  };
}

function shouldSkipCalendarWarmup(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
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
  const [hudVisible, setHudVisible] = useState(false);

  // Default scope for all views — fetched from server preferences
  // undefined = not yet loaded, string = resolved path (always has a value once loaded)
  const [workingFolder, setWorkingFolder] = useState<string | undefined>(undefined);

  // Derive top-level ViewMode from URL prefix.
  const viewMode: ViewMode = urlViewMode === "bridge" ? "bridge"
    : urlViewMode === "docs" ? "docs"
    : urlViewMode === "briefings" ? "briefings"
    : urlViewMode === "calendar" ? "calendar"
    : urlViewMode === "library" ? "library"
    : urlViewMode === "people" ? "people"
    : urlViewMode === "system" || urlViewMode === "map" || urlViewMode === "local-apps" || urlViewMode === "stack" ? "system"
    : "bridge"; // fallback
  const systemMode = systemModeFromUrl(urlViewMode, scopePath);
  const stackScopePath = stackScopeFromSystemUrl(urlViewMode, scopePath);
  const graphScopePath = systemMode === "graph"
    ? scopePath.split("/").filter(Boolean).slice(1).join("/") // remainder after "graph"
    : "";

  // Unified setter
  const setViewMode = useCallback((mode: ViewMode) => {
    if (mode === "bridge") {
      setUrlViewMode("bridge");
    } else if (mode === "docs") {
      setUrlViewMode("docs");
    } else if (mode === "briefings") {
      setUrlViewMode("briefings");
    } else if (mode === "calendar") {
      navigateTo("calendar", "");
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
    // Open to Briefing when briefings exist, else Bridge (e.g. Electron app
    // startup with no view prefix). Falls back to Bridge on any failure.
    let cancelled = false;
    if (!urlViewMode) {
      chooseLandingView().then((view) => {
        if (!cancelled) replaceViewMode(view);
      });
    }

    setHudVisible(localStorage.getItem(HUD_VISIBILITY_STORAGE_KEY) === "true");

    const frame = window.requestAnimationFrame(() => setIsHydrated(true));
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [replaceViewMode, urlViewMode]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(HUD_VISIBILITY_STORAGE_KEY, String(hudVisible));
  }, [hudVisible, isHydrated]);

  useEffect(() => {
    if (!isHydrated || viewMode === "calendar") return undefined;
    return scheduleIdleWarmup(() => {
      if (shouldSkipCalendarWarmup()) return;
      void warmCalendarTabResources();
    });
  }, [isHydrated, viewMode]);

  // Persist view mode to server when it changes (skip during initial hydration)
  useEffect(() => {
    if (isHydrated) {
      fetch(withBasePath("/api/preferences"), {
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

    fetch(withBasePath("/api/folders"))
      .then((res) => res.json())
      .then((data) => {
        setWorkingFolder(data.workingFolder || data.homeDir);
      })
      .catch(console.error);
  }, [isHydrated, workingFolder]);
  const isMobile = useIsMobile();
  const { hasUnread: hasBriefingUnread } = useBriefingUnread();
  const { hasUnread: hasLibraryUnread } = useLibraryUnread();
  const unreadTabs = useMemo(() => {
    const tabs = new Set<string>();
    if (hasBriefingUnread) tabs.add("briefings");
    if (hasLibraryUnread) tabs.add("library");
    return tabs.size ? tabs : undefined;
  }, [hasBriefingUnread, hasLibraryUnread]);
  const usesWorkspaceGutter = !isMobile && (viewMode === "docs" || viewMode === "people" || viewMode === "system" || viewMode === "library" || viewMode === "calendar");
  const usesWorkspaceTopBorder = !isMobile && (viewMode === "docs" || viewMode === "people");

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [addTaskTrigger, setAddTaskTrigger] = useState(0);
  const [bridgeTaskOpenRequest, setBridgeTaskOpenRequest] = useState<BridgeTaskOpenRequest | null>(null);

  const openBridgeTaskFromHud = useCallback((taskId: string) => {
    setViewMode("bridge");
    setBridgeTaskOpenRequest((current) => ({
      taskId,
      token: (current?.token ?? 0) + 1,
    }));
  }, [setViewMode]);

  const openCalendarEventFromHud = useCallback((detail: CalendarEventOpenDetail) => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(PENDING_CALENDAR_EVENT_STORAGE_KEY, JSON.stringify(detail));
    }
    setViewMode("calendar");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(CALENDAR_EVENT_OPEN_EVENT, { detail }));
      });
    }
  }, [setViewMode]);

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
    <MobileChromeProvider resetKey={viewMode}>
    <div className="flex flex-col h-dvh bg-[var(--bg-primary)]">
      {/* NavBar: top bar on desktop, fixed bottom bar on mobile */}
      <NavBar
        viewMode={viewMode}
        setViewMode={setViewMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setAddTaskTrigger={setAddTaskTrigger}
        hudVisible={hudVisible}
        setHudVisible={setHudVisible}
        unreadTabs={unreadTabs}
      />

      <div
        className="flex min-h-0 flex-1 overflow-hidden"
        style={undefined}
      >
        {/* Main content column — wrapped in PullToRefresh on mobile */}
        {isMobile && <PullToRefresh onRefresh={handleRefresh}>
        <div className="flex-1 flex flex-col overflow-hidden">
        {/* Conditional View */}
        {viewMode === "bridge" ? (
          <BridgeView
            addTaskTrigger={addTaskTrigger}
            openTaskRequest={bridgeTaskOpenRequest}
            hudVisible={hudVisible}
            onOpenCalendarEvent={openCalendarEventFromHud}
            onHudVisibleChange={setHudVisible}
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
            scopePath={graphScopePath}
          />
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : viewMode === "calendar" ? (
          <CalendarView />
        ) : viewMode === "library" ? (
          <LibraryView searchQuery={searchQuery} />
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
            openTaskRequest={bridgeTaskOpenRequest}
            onOpenCalendarEvent={openCalendarEventFromHud}
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
            scopePath={graphScopePath}
          />
        ) : viewMode === "briefings" ? (
          <BriefingsView />
        ) : viewMode === "calendar" ? (
          <CalendarView />
        ) : viewMode === "library" ? (
          <LibraryView searchQuery={searchQuery} />
        ) : viewMode === "people" ? (
          <PeopleView searchQuery={searchQuery} />
        ) : null}
        </div>
        </div>}
      </div>
      {hudVisible && !isMobile && (
        <AppHud
          placement="bottom"
          onCollapse={() => setHudVisible(false)}
          onOpenCalendarEvent={openCalendarEventFromHud}
          onOpenTask={openBridgeTaskFromHud}
        />
      )}
    </div>
    </MobileChromeProvider>
  );
}
