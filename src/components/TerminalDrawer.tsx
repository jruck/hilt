"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Session } from "@/lib/types";
import { X, Terminal as TerminalIcon, Copy, Check, CheckCircle, Info, Folder, GitBranch, MessageSquare, Clock, FileText, Hash, FolderOpen, Save, Loader2 } from "lucide-react";

/**
 * Detect if running in Electron environment
 */
function isElectronEnv(): boolean {
  return typeof window !== "undefined" && (window as unknown as { electronAPI?: { isElectron: boolean } }).electronAPI?.isElectron === true;
}

/**
 * Hook to detect Electron environment after hydration
 * Returns false during SSR and initial render to avoid hydration mismatch
 */
function useIsElectron(): boolean {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    setIsElectron(isElectronEnv());
  }, []);

  return isElectron;
}

// Dynamic import to avoid SSR issues with xterm.js
const Terminal = dynamic(() => import("./Terminal").then((mod) => mod.Terminal), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
      Loading terminal...
    </div>
  ),
});

// Dynamic import for MDXEditor (doesn't support SSR)
const PlanEditor = dynamic(
  () => import("./PlanEditor").then((mod) => mod.PlanEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
        Loading editor...
      </div>
    ),
  }
);

interface TerminalDrawerProps {
  isOpen: boolean;
  sessions: Session[];
  activeSession: Session | null;
  planViewSession?: Session | null;  // Session being viewed in plan-only mode (no terminal)
  onClose: () => void;
  onOpen: () => void;
  onSelectSession: (session: Session) => void;
  onCloseSession: (sessionId: string) => void;
  onEngageSession?: (session: Session) => void;  // Called when switching from plan-only to terminal
  onStatusUpdate?: (sessionId: string, status: string) => void;
  onWidthChange?: (width: number) => void;
}

type ViewMode = "terminal" | "info" | "plan";

interface PlanData {
  exists: boolean;
  slug: string;
  content?: string;
  path?: string;
}

export function TerminalDrawer({
  isOpen,
  sessions,
  activeSession,
  planViewSession,
  onClose,
  onOpen,
  onSelectSession,
  onCloseSession,
  onEngageSession,
  onStatusUpdate,
  onWidthChange,
}: TerminalDrawerProps) {
  // Detect Electron environment (must be done via hook to avoid hydration mismatch)
  const isElectron = useIsElectron();

  // Check if we're in plan-only view mode (viewing plan without terminal)
  const isPlanOnlyView = planViewSession && activeSession?.id === planViewSession.id;
  const [copied, setCopied] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);
  const [copiedPlanPath, setCopiedPlanPath] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [terminalTitle, setTerminalTitle] = useState<string | null>(null);
  // Track context progress for each session (0-100)
  const [contextProgress, setContextProgress] = useState<Map<string, number>>(new Map());
  // Track plan data for each session by slug
  const [planCache, setPlanCache] = useState<Map<string, PlanData>>(new Map());
  // Track edited plan content (separate from cache so we can detect changes)
  const [editedPlanContent, setEditedPlanContent] = useState<string | null>(null);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planSaveError, setPlanSaveError] = useState<string | null>(null);
  // Track the initial content MDXEditor outputs after parsing (used as baseline for change detection)
  const editorBaselineRef = useRef<{ slug: string; content: string } | null>(null);
  // WebSocket port (dynamically discovered)
  const [wsPort, setWsPort] = useState<number | null>(null);

  // Fetch WebSocket port on mount
  useEffect(() => {
    async function fetchPort() {
      try {
        const res = await fetch("/api/ws-port");
        if (res.ok) {
          const data = await res.json();
          setWsPort(data.port);
        }
      } catch (err) {
        console.error("Failed to fetch WS port:", err);
      }
    }
    fetchPort();
    // Re-fetch periodically in case the server restarts on a different port
    const interval = setInterval(fetchPort, 30000);
    return () => clearInterval(interval);
  }, []);

  // Drawer resize state
  const MIN_WIDTH = 400;
  const MAX_WIDTH = 1200;
  const DEFAULT_WIDTH = 700;
  const STORAGE_KEY = "terminal-drawer-width";

  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Load persisted width on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const width = parseInt(stored, 10);
      if (!isNaN(width) && width >= MIN_WIDTH && width <= MAX_WIDTH) {
        setDrawerWidth(width);
        onWidthChange?.(width);
      }
    } else {
      // Notify with default width
      onWidthChange?.(DEFAULT_WIDTH);
    }
  }, []);

  // Handle resize drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = drawerWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [drawerWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;

      // Dragging left increases width, dragging right decreases
      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartWidth.current + delta));
      setDrawerWidth(newWidth);
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Persist width
        localStorage.setItem(STORAGE_KEY, drawerWidth.toString());
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drawerWidth, onWidthChange]);

  // Track which plan is currently selected (by slug)
  const [selectedPlanSlug, setSelectedPlanSlug] = useState<string | null>(null);

  // Get ALL plans for the active session
  const sessionPlans = (() => {
    if (!activeSession) return [];
    const slugs = activeSession.slugs || (activeSession.slug ? [activeSession.slug] : []);
    const plans: PlanData[] = [];
    for (const slug of slugs) {
      const plan = planCache.get(slug);
      if (plan?.exists && plan.content) {
        plans.push(plan);
      }
    }
    return plans;
  })();

  // The currently active/selected plan
  const activePlan = selectedPlanSlug
    ? sessionPlans.find(p => p.slug === selectedPlanSlug) || sessionPlans[0]
    : sessionPlans[0];
  const hasPlan = sessionPlans.length > 0;

  const copyCommand = useCallback(async () => {
    if (!activeSession) return;
    const command = `claude --resume ${activeSession.id}`;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeSession]);

  const copyPlanPath = useCallback(async () => {
    if (!activePlan?.path) return;
    await navigator.clipboard.writeText(activePlan.path);
    setCopiedPlanPath(true);
    setTimeout(() => setCopiedPlanPath(false), 2000);
  }, [activePlan?.path]);

  const openPlanInFinder = useCallback(() => {
    if (!activePlan?.path) return;
    // Use the reveal API endpoint
    fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: activePlan.path })
    }).catch(console.error);
  }, [activePlan?.path]);

  // Handle plan content changes from editor
  const handlePlanChange = useCallback((content: string) => {
    const currentSlug = activePlan?.slug;
    if (!currentSlug) return;

    // MDXEditor fires onChange on mount with parsed/normalized content.
    // Use that first onChange as our baseline for detecting actual user changes.
    if (!editorBaselineRef.current || editorBaselineRef.current.slug !== currentSlug) {
      // First onChange for this plan - store as baseline, not an edit
      editorBaselineRef.current = { slug: currentSlug, content };
      setEditedPlanContent(null);
    } else if (content === editorBaselineRef.current.content) {
      // Content matches baseline - no changes
      setEditedPlanContent(null);
    } else {
      // Content differs from baseline - user made changes
      setEditedPlanContent(content);
    }
    setPlanSaveError(null);
  }, [activePlan?.slug]);

  // Check if plan has unsaved changes
  const hasPlanChanges = editedPlanContent !== null && editedPlanContent !== activePlan?.content;

  // Save plan to file
  const savePlan = useCallback(async () => {
    if (!activePlan?.slug || !editedPlanContent) return;

    setIsSavingPlan(true);
    setPlanSaveError(null);

    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(activePlan.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedPlanContent }),
      });

      if (!res.ok) {
        throw new Error('Failed to save plan');
      }

      // Update the cache with the new content
      setPlanCache(prev => {
        const next = new Map(prev);
        next.set(activePlan.slug, {
          ...activePlan,
          content: editedPlanContent,
        });
        return next;
      });

      // Update baseline to saved content and clear edited state
      editorBaselineRef.current = { slug: activePlan.slug, content: editedPlanContent };
      setEditedPlanContent(null);
    } catch (error) {
      console.error('Error saving plan:', error);
      setPlanSaveError('Failed to save plan');
    } finally {
      setIsSavingPlan(false);
    }
  }, [activePlan?.slug, editedPlanContent, activePlan]);

  // Reset edited content, baseline, and selected plan when switching sessions
  useEffect(() => {
    setEditedPlanContent(null);
    setPlanSaveError(null);
    setSelectedPlanSlug(null);
    editorBaselineRef.current = null;
  }, [activeSession?.id]);

  // Stable callback for terminal exit - use sessionId to avoid recreating on every render
  const handleTerminalExit = useCallback(() => {
    if (activeSession) {
      onCloseSession(activeSession.id);
    }
  }, [activeSession?.id, onCloseSession]);

  // Stable callback for terminal title changes - accepts sessionId to support multiple terminals
  const handleTitleChange = useCallback((sessionId: string, title: string) => {
    // Only update local state if it's the active session
    if (activeSession?.id === sessionId) {
      setTerminalTitle(title);
    }
    // Always notify parent to update status on card
    onStatusUpdate?.(sessionId, title);
  }, [activeSession?.id, onStatusUpdate]);

  // Stable callback for context progress updates
  const handleContextProgress = useCallback((sessionId: string, progress: number) => {
    setContextProgress(prev => {
      const next = new Map(prev);
      next.set(sessionId, progress);
      return next;
    });
  }, []);

  // Stable callback for plan events from WebSocket (real-time plan detection)
  const handlePlanEvent = useCallback((plan: { event: string; slug: string; path: string; content: string }) => {
    setPlanCache(prev => {
      const next = new Map(prev);
      next.set(plan.slug, {
        exists: true,
        slug: plan.slug,
        content: plan.content,
        path: plan.path,
      });
      return next;
    });
  }, []);

  // Reset state when session changes
  useEffect(() => {
    setCopied(false);
    setTerminalTitle(null);
  }, [activeSession?.id]);

  // Switch to plan view when session is opened with planMode
  useEffect(() => {
    if (activeSession?.planMode) {
      setViewMode("plan");
    }
  }, [activeSession?.id, activeSession?.planMode]);

  // Fetch plans for active session on initial load
  // New plans are detected via WebSocket events (handlePlanEvent callback)
  useEffect(() => {
    const slugs = activeSession?.slugs || (activeSession?.slug ? [activeSession.slug] : []);
    if (slugs.length === 0) return;

    const fetchPlans = async () => {
      for (const slug of slugs) {
        try {
          const res = await fetch(`/api/plans/${encodeURIComponent(slug)}`);
          const data: PlanData = await res.json();

          setPlanCache(prev => {
            const existing = prev.get(slug);
            // Only update if something changed
            if (existing?.exists === data.exists && existing?.content === data.content) {
              return prev;
            }
            const next = new Map(prev);
            next.set(slug, data);
            return next;
          });
        } catch (error) {
          console.error(`Error fetching plan for ${slug}:`, error);
        }
      }
    };

    // Initial fetch only - real-time updates come via WebSocket
    fetchPlans();
  }, [activeSession?.slug, activeSession?.slugs]);

  // If no sessions and no plan-only view, don't render anything
  if (sessions.length === 0 && !planViewSession && !isOpen) return null;

  return (
    <>
      {/* Main drawer - always rendered when sessions exist to keep terminals alive */}
      <div
        className={`
          fixed right-0 top-11 h-[calc(100%-44px)] bg-[var(--bg-secondary)]
          transition-transform duration-300 ease-in-out z-50
          flex flex-col shadow-2xl shadow-black/50
          ${isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
        `}
        style={{ width: drawerWidth, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Resize handle - border lightens on hover */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 border-l border-[var(--border-default)] hover:border-[var(--border-hover)] active:border-[var(--text-secondary)] transition-colors"
          onMouseDown={handleResizeMouseDown}
        />
      {/* Session Tabs Row */}
      <div className="relative flex items-end h-11 px-4 gap-2 bg-[var(--bg-primary)]">
        {/* Bottom border line - goes under inactive tabs, active tab covers it */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-[var(--border-default)]" />
        <div className="flex flex-1 items-end gap-2 overflow-x-auto overflow-y-hidden">
          {/* Plan-only session tab (not yet engaged) */}
          {planViewSession && !sessions.find(s => s.id === planViewSession.id) && (
            <div
              className={`
                flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm cursor-pointer
                rounded-t-lg min-w-0 max-w-[200px] border-t border-x transition-colors flex-shrink-0
                bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-primary)] z-10
              `}
              style={{ marginBottom: '-1px', paddingBottom: 'calc(0.375rem + 1px)' }}
            >
              <FileText className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
              <span className="truncate flex-1" title={planViewSession.title}>{planViewSession.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded flex-shrink-0 transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Regular engaged session tabs */}
          {sessions.map((session) => {
            const isActive = activeSession?.id === session.id && !isPlanOnlyView;

            return (
              <div
                key={session.id}
                className={`
                  flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm cursor-pointer
                  rounded-t-lg min-w-0 max-w-[200px] border-t border-x transition-colors flex-shrink-0
                  ${
                    isActive
                      ? "bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-primary)] z-10"
                      : "bg-[var(--bg-secondary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }
                `}
                style={isActive ? { marginBottom: '-1px', paddingBottom: 'calc(0.375rem + 1px)' } : undefined}
                onClick={() => onSelectSession(session)}
              >
                <span className="truncate flex-1" title={session.title}>{session.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(session.id);
                  }}
                  className="p-0.5 text-[var(--text-tertiary)] hover:text-emerald-400 rounded flex-shrink-0 transition-colors"
                  title="Mark as done"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        {/* Close drawer button */}
        <button
          onClick={onClose}
          className="p-1.5 self-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors relative z-10"
          title="Close drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>


      {/* Main content area with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mode Sidebar */}
        <div className="flex flex-col items-center w-11 py-2 bg-[var(--bg-primary)] border-r border-[var(--border-default)] gap-1">
          <button
            onClick={() => {
              if (isPlanOnlyView && activeSession) {
                // Switching from plan-only to terminal - engage the session
                onEngageSession?.(activeSession);
              }
              setViewMode("terminal");
            }}
            title={isPlanOnlyView ? "Start session" : "Terminal"}
            className={`p-1.5 rounded transition-colors ${
              viewMode === "terminal"
                ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <TerminalIcon className="w-4 h-4" />
          </button>
          {hasPlan && (
            <button
              onClick={() => setViewMode("plan")}
              title="Plan"
              className={`p-1.5 rounded transition-colors ${
                viewMode === "plan"
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              }`}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setViewMode("info")}
            title="Info"
            className={`p-1.5 rounded transition-colors ${
              viewMode === "info"
                ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden">
          {/* Session Status Bar - shown in terminal mode (not plan-only) */}
          {activeSession && viewMode === "terminal" && !isPlanOnlyView && (
            <div className="bg-[var(--bg-primary)] border-b border-[var(--border-default)] px-3 py-2 space-y-1.5 shrink-0">
              {/* Row 1: Title and Status */}
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[var(--text-tertiary)] shrink-0">Title:</span>
                  <span className="text-[var(--text-secondary)] font-medium truncate">{activeSession.title}</span>
                </div>
                {terminalTitle && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[var(--text-tertiary)]">Status:</span>
                    <span className="text-emerald-400 font-medium">{terminalTitle}</span>
                  </div>
                )}
              </div>

              {/* Row 2: Prompt (if different from title) */}
              {activeSession.firstPrompt && activeSession.firstPrompt !== activeSession.title && (
                <div className="flex items-start gap-1.5 text-xs">
                  <span className="text-[var(--text-tertiary)] shrink-0">Prompt:</span>
                  <span className="text-[var(--text-secondary)] line-clamp-1">{activeSession.firstPrompt}</span>
                </div>
              )}

              {/* Row 3: Metadata (folder, branch, slug, messages, time) */}
              <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
                <button
                  onClick={() => {
                    fetch('/api/reveal', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ path: activeSession.projectPath })
                    }).catch(console.error);
                  }}
                  className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
                  title="Open in Finder"
                >
                  <Folder className="w-3 h-3" />
                  <span className="truncate max-w-[120px]">{activeSession.project}</span>
                </button>
                {activeSession.gitBranch && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    <span className="truncate max-w-[100px]">{activeSession.gitBranch}</span>
                  </span>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`claude --resume ${activeSession.id}`);
                    setCopiedSlug(true);
                    setTimeout(() => setCopiedSlug(false), 1500);
                  }}
                  className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
                  title="Click to copy resume command"
                >
                  {copiedSlug ? <Check className="w-3 h-3 text-emerald-400" /> : <Hash className="w-3 h-3" />}
                  <span className={`truncate max-w-[180px] font-mono ${copiedSlug ? "text-emerald-400" : ""}`}>{activeSession.id.slice(0, 8)}</span>
                </button>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {activeSession.messageCount}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(activeSession.lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          )}

          {/* Terminal/Info/Plan content area */}
          <div className="flex-1 overflow-hidden relative">
            {/* Plan-only mode: show "Start Session" prompt instead of terminal */}
            {isPlanOnlyView && viewMode === "terminal" && activeSession && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[var(--text-tertiary)]">
                <TerminalIcon className="w-12 h-12 text-[var(--text-tertiary)]" />
                <p className="text-sm">Session not started</p>
                <button
                  onClick={() => onEngageSession?.(activeSession)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <TerminalIcon className="w-4 h-4" />
                  Start Session
                </button>
              </div>
            )}

            {/* Render all terminals - use visibility instead of display to preserve dimensions */}
            {/* Use stable terminalId for key to prevent remounting when session gets real ID */}
            {/* In Electron mode, Terminal uses IPC. In browser mode, we wait for wsPort */}
            {(isElectron || wsPort) && sessions.map((session) => {
              const stableTerminalId = session.terminalId || session.id;
              const isVisible = viewMode === "terminal" && session.id === activeSession?.id && !isPlanOnlyView;
              return (
                <div
                  key={stableTerminalId}
                  className={`absolute inset-0 p-3 ${isVisible ? 'visible' : 'invisible pointer-events-none'}`}
                >
                  <Terminal
                    terminalId={stableTerminalId}
                    sessionId={session.id}
                    projectPath={session.projectPath}
                    wsUrl={wsPort ? `ws://localhost:${wsPort}` : undefined}
                    isNew={session.isNew}
                    initialPrompt={session.initialPrompt}
                    isActive={session.id === activeSession?.id}
                    isDrawerOpen={isOpen}
                    onExit={() => onCloseSession(session.id)}
                    onTitleChange={handleTitleChange}
                    onContextProgress={handleContextProgress}
                    onPlanEvent={handlePlanEvent}
                  />
                </div>
              );
            })}

        {activeSession && viewMode === "info" && (
            <div className="p-6 space-y-6 overflow-auto h-full">
              {/* Session Title */}
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                  {activeSession.title}
                </h2>
                <p className="text-[var(--text-secondary)] text-sm line-clamp-3">
                  {activeSession.firstPrompt}
                </p>
              </div>

              {/* Session Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-[var(--text-tertiary)]">Project</span>
                  <button
                    onClick={() => {
                      fetch('/api/reveal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: activeSession.projectPath })
                      }).catch(console.error);
                    }}
                    className="text-[var(--text-secondary)] hover:text-blue-400 transition-colors text-left"
                    title="Open in Finder"
                  >
                    {activeSession.project}
                  </button>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-tertiary)]">Messages</span>
                  <p className="text-[var(--text-secondary)]">{activeSession.messageCount}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-tertiary)]">Last Activity</span>
                  <p className="text-[var(--text-secondary)]">
                    {new Date(activeSession.lastActivity).toLocaleString()}
                  </p>
                </div>
                {activeSession.gitBranch && (
                  <div className="space-y-1">
                    <span className="text-[var(--text-tertiary)]">Git Branch</span>
                    <p className="text-[var(--text-secondary)] font-mono text-xs">
                      {activeSession.gitBranch}
                    </p>
                  </div>
                )}
                <div className="space-y-1">
                  <span className="text-[var(--text-tertiary)]">Session ID</span>
                  <p className="text-[var(--text-secondary)] font-mono text-xs">
                    {activeSession.id}
                  </p>
                </div>
              </div>

              {/* Resume Command */}
              <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-default)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[var(--text-secondary)]">Resume Command</span>
                  <button
                    onClick={copyCommand}
                    className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span className="text-emerald-500">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code className="block font-mono text-sm text-emerald-400 bg-[var(--bg-primary)] px-3 py-2 rounded">
                  claude --resume {activeSession.id}
                </code>
              </div>

              {/* Instructions */}
              <div className="text-sm text-[var(--text-tertiary)] space-y-2">
                <p>
                  To resume this session externally, open a terminal in the project directory
                  and run the command above.
                </p>
                <p className="text-[var(--text-tertiary)] text-xs">
                  Project path: {activeSession.projectPath}
                </p>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2">
                <button
                  onClick={copyCommand}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-lg transition-colors text-sm"
                >
                  <Copy className="w-4 h-4" />
                  Copy Resume Command
                </button>
              </div>
            </div>
        )}

        {/* Plan View */}
        {activeSession && viewMode === "plan" && hasPlan && (
          <div className="flex flex-col h-full">
            {/* Plan Details Bar(s) - one row per plan */}
            <div className="bg-[var(--bg-primary)] border-b border-[var(--border-default)]">
              {sessionPlans.map((plan) => {
                const isActive = plan.slug === activePlan?.slug;
                return (
                  <div
                    key={plan.slug}
                    onClick={!isActive ? () => {
                      setSelectedPlanSlug(plan.slug);
                      setEditedPlanContent(null);
                    } : undefined}
                    className={`flex items-center justify-between gap-2 px-3 py-2 ${
                      !isActive ? 'opacity-50 hover:opacity-80 cursor-pointer' : ''
                    } ${sessionPlans.length > 1 && !isActive ? 'border-b border-[var(--border-default)]/50' : ''} transition-opacity`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-tertiary)]'}`} />
                      <span className={`text-xs font-mono truncate ${isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}`}>
                        {plan.path}
                      </span>
                      {isActive && hasPlanChanges && (
                        <span className="text-xs text-amber-500 shrink-0">(unsaved)</span>
                      )}
                      {isActive && planSaveError && (
                        <span className="text-xs text-red-500 shrink-0">{planSaveError}</span>
                      )}
                    </div>
                    {/* Action buttons - always rendered but invisible on inactive rows to prevent layout shift */}
                    <div className={`flex items-center gap-1 shrink-0 ${!isActive ? 'invisible' : ''}`}>
                      {/* Save button */}
                      <button
                        onClick={savePlan}
                        disabled={!hasPlanChanges || isSavingPlan}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                          hasPlanChanges
                            ? 'text-[var(--status-active)] hover:bg-[var(--status-active-bg)]'
                            : 'text-[var(--text-tertiary)] cursor-not-allowed'
                        }`}
                        title={hasPlanChanges ? "Save changes (Cmd+S)" : "No changes to save"}
                      >
                        {isSavingPlan ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Save className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        onClick={openPlanInFinder}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                        title="Reveal in Finder"
                      >
                        <FolderOpen className="w-3 h-3" />
                      </button>
                      <button
                        onClick={copyPlanPath}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                        title="Copy path"
                      >
                        {copiedPlanPath ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Plan Editor */}
            <div className="flex-1 overflow-hidden min-h-0 p-3">
              <PlanEditor
                markdown={activePlan!.content!}
                onChange={handlePlanChange}
              />
            </div>
          </div>
        )}

        {/* No active session message */}
        {!activeSession && (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
            Select a session to view details
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
