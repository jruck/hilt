"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useScope } from "@/contexts/ScopeContext";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import dynamic from "next/dynamic";
import type { ViewPrefix } from "@/lib/url-utils";
import { chooseLandingView } from "@/lib/landing-view";
import { ViewMode } from "./ViewToggle";
import { NavBar } from "./NavBar";
import { HowItWorksDoc } from "./system/HowItWorksDoc";
import { AppHud } from "./AppHud";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBriefingUnread } from "@/hooks/useBriefingUnread";
import { prefetchCalendarCaches } from "@/hooks/useCalendar";
import { intakeLibrarySources, useLibraryUnread } from "@/hooks/useLibrary";
import { prefetchWeatherForecast } from "@/hooks/useWeather";
import { PullToRefresh } from "./PullToRefresh";
import { MobileChromeProvider } from "@/contexts/MobileChromeContext";
import { CALENDAR_EVENT_OPEN_EVENT, PENDING_CALENDAR_EVENT_STORAGE_KEY, type CalendarEventOpenDetail } from "@/lib/calendar/deeplink";
import { TASK_OPEN_EVENT, type TaskOpenDetail } from "@/lib/tasks/deeplink";
import { isSystemMode, stackScopeFromSystemUrl, systemModeFromUrl, systemScopeForMode, type SystemMode } from "@/lib/system/navigation";
import { withBasePath } from "@/lib/base-path";
import type { BridgeMode } from "./bridge/BridgeModeToggle";

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
const HOW_IT_WORKS_STORAGE_KEY = "hilt-how-it-works-open";
const BRIDGE_MODE_STORAGE_KEY = "hilt-bridge-mode";
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

function isBridgeMode(value: string | null): value is BridgeMode {
  return value === "briefing" || value === "priorities";
}

function bridgePrefixForMode(mode: BridgeMode): ViewPrefix {
  return mode === "priorities" ? "bridge" : "briefings";
}

function getStoredBridgeMode(): BridgeMode {
  if (typeof window === "undefined") return "briefing";
  const stored = localStorage.getItem(BRIDGE_MODE_STORAGE_KEY);
  return isBridgeMode(stored) ? stored : "briefing";
}

function storeBridgeMode(mode: BridgeMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BRIDGE_MODE_STORAGE_KEY, mode);
}

export function Board() {
  // Scope path and view mode from context — URL-based routing
  const { scopePath, setScopePath, viewMode: urlViewMode, setViewMode: setUrlViewMode, replaceViewMode, navigateTo } = useScope();

  const { on } = useEventSocketContext();

  // Track if we've hydrated from localStorage (to prevent hydration mismatch)
  const [isHydrated, setIsHydrated] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  // The ⓘ reference view: swaps the content area for docs/HOW-IT-WORKS.md (rendered).
  // Persists across refresh like the HUD — a mode of the app, not ephemeral chrome.
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  // Any navigation (doc links opening files in Docs, HUD jumps, etc.) closes the reference —
  // structural, so it can't depend on individual click handlers remembering to do it.
  useEffect(() => {
    setHowItWorksOpen(false);
  }, [scopePath, urlViewMode]);
  // Hydrate HUD + ⓘ pane visibility ONCE at mount. These reads previously lived in the
  // view-prefs effect whose deps include urlViewMode — every navigation re-ran them and
  // re-opened the ⓘ pane from stale storage, defeating both close paths (found 2026-07-04).
  useEffect(() => {
    setHudVisible(localStorage.getItem(HUD_VISIBILITY_STORAGE_KEY) === "true");
    setHowItWorksOpen(localStorage.getItem(HOW_IT_WORKS_STORAGE_KEY) === "true");
  }, []);

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
      navigateTo(bridgePrefixForMode(getStoredBridgeMode()), "");
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

  const setBridgeMode = useCallback((mode: BridgeMode) => {
    storeBridgeMode(mode);
    navigateTo(bridgePrefixForMode(mode), "");
  }, [navigateTo]);

  const openPriorities = useCallback(() => {
    storeBridgeMode("priorities");
    navigateTo("bridge", "");
  }, [navigateTo]);

  const setSystemMode = useCallback((mode: SystemMode) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SYSTEM_MODE_STORAGE_KEY, mode);
    }
    navigateTo("system", systemScopeForMode(mode, mode === "stack" ? (stackScopePath || workingFolder || "") : ""));
  }, [navigateTo, stackScopePath, workingFolder]);

  // Hydrate after mount
  useEffect(() => {
    // Open to Bridge > Briefing when startup has no view prefix.
    let cancelled = false;
    if (!urlViewMode) {
      chooseLandingView().then((view) => {
        if (!cancelled) replaceViewMode(view);
      });
    }

    // RAF for anti-flash, with a timeout fallback: a frame-starved context (occluded window,
    // background tab, headless) never fires RAF, which left the whole app rendering null
    // (found 2026-07-06 — blank page whenever no frames are produced).
    const frame = window.requestAnimationFrame(() => setIsHydrated(true));
    const timer = window.setTimeout(() => setIsHydrated(true), 80);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [replaceViewMode, urlViewMode]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(HUD_VISIBILITY_STORAGE_KEY, String(hudVisible));
  }, [hudVisible, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(HOW_IT_WORKS_STORAGE_KEY, String(howItWorksOpen));
  }, [howItWorksOpen, isHydrated]);

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

  useEffect(() => {
    if (!isHydrated) return;
    if (urlViewMode === "briefings") {
      storeBridgeMode("briefing");
    } else if (urlViewMode === "bridge") {
      storeBridgeMode("priorities");
    }
  }, [isHydrated, urlViewMode]);


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
  const { hasUnread: hasLibraryUnread, markVisited: markLibraryVisited } = useLibraryUnread();
  const [libraryActivationToken, setLibraryActivationToken] = useState(0);
  // Opening the Library tab clears its nav dot: stamp the visit so the dot only returns when NEW
  // items arrive afterward (not just because unread items still exist). It also bumps an activation
  // token so LibraryView revalidates its cached feed when switching back from another tab.
  useEffect(() => {
    if (viewMode !== "library") return;
    void markLibraryVisited();
    setLibraryActivationToken((token) => token + 1);
  }, [viewMode, markLibraryVisited]);
  const unreadTabs = useMemo(() => {
    const tabs = new Set<string>();
    if (hasBriefingUnread) tabs.add("bridge");
    if (hasLibraryUnread) tabs.add("library");
    return tabs.size ? tabs : undefined;
  }, [hasBriefingUnread, hasLibraryUnread]);
  const usesWorkspaceGutter = !isMobile && (viewMode === "bridge" || viewMode === "briefings" || viewMode === "docs" || viewMode === "people" || viewMode === "system" || viewMode === "library" || viewMode === "calendar");
  const usesWorkspaceTopBorder = !isMobile && (viewMode === "docs" || viewMode === "people");

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [addTaskTrigger, setAddTaskTrigger] = useState(0);
  const [bridgeTaskOpenRequest, setBridgeTaskOpenRequest] = useState<BridgeTaskOpenRequest | null>(null);

  // The universal task-open entry point: switches Bridge to Priorities and hands the id to
  // BridgeView as an open-request. Accepts weekly ids ("task-3", the HUD) AND task-file ids
  // ("t-…", every other surface) — BridgeView resolves either into the right pane.
  const openBridgeTask = useCallback((taskId: string) => {
    storeBridgeMode("priorities");
    navigateTo("bridge", "");
    setBridgeTaskOpenRequest((current) => ({
      taskId,
      token: (current?.token ?? 0) + 1,
    }));
  }, [navigateTo]);

  // Cross-view channel: any surface that knows a task id (briefing canvas cards, meeting
  // Next-steps cards, task object pills) dispatches TASK_OPEN_EVENT (the calendar-deeplink
  // idiom) instead of threading a callback through every layer.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TaskOpenDetail>).detail;
      if (detail?.taskId) openBridgeTask(detail.taskId);
    };
    window.addEventListener(TASK_OPEN_EVENT, handler);
    return () => window.removeEventListener(TASK_OPEN_EVENT, handler);
  }, [openBridgeTask]);

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

  const handleRefresh = useCallback(async () => {
    if (viewMode === "library") {
      try {
        await intakeLibrarySources({ limit: 25 });
      } finally {
        setLibraryActivationToken((token) => token + 1);
      }
      return;
    }
    window.location.reload();
    // Return a promise that never resolves — page will reload
    return new Promise<void>(() => {});
  }, [viewMode]);

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
      // Task deep-link: {view:"bridge", path:"/task/t-…"} opens the task detail pane
      // (weekly row's panel or the file-addressable pane) instead of a bare view switch.
      const taskMatch = view === "bridge" ? path.match(/^\/task\/([^/]+)$/) : null;
      if (taskMatch) {
        openBridgeTask(taskMatch[1]);
      } else {
        navigateTo(view as ViewPrefix, path || "");
      }
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
  }, [navigateTo, on, openBridgeTask]);

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
        openPriorities={openPriorities}
        hudVisible={hudVisible}
        setHudVisible={setHudVisible}
        howItWorksOpen={howItWorksOpen}
        setHowItWorksOpen={setHowItWorksOpen}
        unreadTabs={unreadTabs}
      />

      {howItWorksOpen && <HowItWorksDoc onNavigated={() => setHowItWorksOpen(false)} />}

      <div
        className={`flex min-h-0 flex-1 overflow-hidden${howItWorksOpen ? " hidden" : ""}`}
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
            onBridgeModeChange={setBridgeMode}
            onNavigateToArea={(area) => {
              navigateTo("docs", area.indexPath);
            }}
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
          <BriefingsView
            hudVisible={hudVisible}
            onHudVisibleChange={setHudVisible}
            onOpenCalendarEvent={openCalendarEventFromHud}
            onOpenTask={openBridgeTask}
            onBridgeModeChange={setBridgeMode}
          />
        ) : viewMode === "calendar" ? (
          <CalendarView />
        ) : viewMode === "library" ? (
          <LibraryView searchQuery={searchQuery} activationToken={libraryActivationToken} />
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
            onBridgeModeChange={setBridgeMode}
            onNavigateToArea={(area) => {
              navigateTo("docs", area.indexPath);
            }}
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
          <BriefingsView
            onOpenCalendarEvent={openCalendarEventFromHud}
            onOpenTask={openBridgeTask}
            onBridgeModeChange={setBridgeMode}
          />
        ) : viewMode === "calendar" ? (
          <CalendarView />
        ) : viewMode === "library" ? (
          <LibraryView searchQuery={searchQuery} activationToken={libraryActivationToken} />
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
          onOpenTask={openBridgeTask}
        />
      )}
    </div>
    </MobileChromeProvider>
  );
}
