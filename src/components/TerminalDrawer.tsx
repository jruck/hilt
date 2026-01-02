"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Session } from "@/lib/types";
import { X, Terminal as TerminalIcon, Copy, Check, CheckCircle, Info, Folder, GitBranch, MessageSquare, Clock, FileText, Hash, FolderOpen, Save, Loader2 } from "lucide-react";

// Dynamic import to avoid SSR issues with xterm.js
const Terminal = dynamic(() => import("./Terminal").then((mod) => mod.Terminal), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-500">
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
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading editor...
      </div>
    ),
  }
);

interface TerminalDrawerProps {
  isOpen: boolean;
  sessions: Session[];
  activeSession: Session | null;
  onClose: () => void;
  onOpen: () => void;
  onSelectSession: (session: Session) => void;
  onCloseSession: (sessionId: string) => void;
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
  onClose,
  onOpen,
  onSelectSession,
  onCloseSession,
  onStatusUpdate,
  onWidthChange,
}: TerminalDrawerProps) {
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

  // Get plan data for active session (computed early for use in callbacks)
  // Check ALL slugs since the plan may have been created with a different slug
  const activePlan = (() => {
    if (!activeSession) return null;
    const slugs = activeSession.slugs || (activeSession.slug ? [activeSession.slug] : []);
    for (const slug of slugs) {
      const plan = planCache.get(slug);
      if (plan?.exists && plan.content) {
        return plan;
      }
    }
    return null;
  })();
  const hasPlan = activePlan?.exists && activePlan.content;

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
    setEditedPlanContent(content);
    setPlanSaveError(null);
  }, []);

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

      // Clear edited content since it's now saved
      setEditedPlanContent(null);
    } catch (error) {
      console.error('Error saving plan:', error);
      setPlanSaveError('Failed to save plan');
    } finally {
      setIsSavingPlan(false);
    }
  }, [activePlan?.slug, editedPlanContent, activePlan]);

  // Reset edited content when switching sessions
  useEffect(() => {
    setEditedPlanContent(null);
    setPlanSaveError(null);
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

  // Fetch plans for active session - check ALL slugs since they can change mid-session
  // Poll periodically to detect newly created plans
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

    // Initial fetch
    fetchPlans();

    // Poll every 3 seconds to detect new plans
    const interval = setInterval(fetchPlans, 3000);

    return () => clearInterval(interval);
  }, [activeSession?.slug, activeSession?.slugs]);

  // If no sessions, don't render anything
  if (sessions.length === 0 && !isOpen) return null;

  return (
    <>
      {/* Main drawer - always rendered when sessions exist to keep terminals alive */}
      <div
        className={`
          fixed right-0 top-[45px] h-[calc(100%-45px)] bg-zinc-900
          transition-transform duration-300 ease-in-out z-50
          flex flex-col shadow-2xl shadow-black/50
          ${isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
        `}
        style={{ width: drawerWidth, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Resize handle - border lightens on hover */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 border-l border-zinc-700 hover:border-zinc-500 active:border-zinc-400 transition-colors"
          onMouseDown={handleResizeMouseDown}
        />
      {/* Session Tabs Row */}
      <div className="flex border-b border-zinc-800 bg-zinc-950">
        <div className="flex flex-1 overflow-x-auto">
          {sessions.map((session) => {
            const progress = contextProgress.get(session.id) ?? 0;
            // Color based on progress: green → yellow → orange → red
            const progressColor = progress < 50
              ? 'bg-emerald-500'
              : progress < 75
                ? 'bg-yellow-500'
                : progress < 90
                  ? 'bg-orange-500'
                  : 'bg-red-500';

            return (
              <div
                key={session.id}
                className={`
                  relative flex items-center gap-2 px-3 py-2 text-sm cursor-pointer
                  border-r border-zinc-800 min-w-0 max-w-[200px]
                  ${
                    activeSession?.id === session.id
                      ? "bg-zinc-900 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50"
                  }
                `}
                onClick={() => onSelectSession(session)}
              >
                <span className="truncate flex-1" title={session.title}>{session.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(session.id);
                  }}
                  className="p-0.5 text-zinc-500 hover:text-emerald-400 rounded flex-shrink-0 transition-colors"
                  title="Mark as done"
                >
                  <CheckCircle className="w-3 h-3" />
                </button>
                {/* Context progress bar underline */}
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-800">
                  <div
                    className={`h-full ${progressColor} transition-all duration-300`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {/* Close button */}
        <button
          onClick={onClose}
          className="px-3 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors border-l border-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>


      {/* Main content area with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mode Sidebar */}
        <div className="flex flex-col items-center py-2 px-1 bg-zinc-950 border-r border-zinc-800 gap-1">
          <button
            onClick={() => setViewMode("terminal")}
            title="Terminal"
            className={`p-2 rounded transition-colors ${
              viewMode === "terminal"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <TerminalIcon className="w-4 h-4" />
          </button>
          {hasPlan && (
            <button
              onClick={() => setViewMode("plan")}
              title="Plan"
              className={`p-2 rounded transition-colors ${
                viewMode === "plan"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setViewMode("info")}
            title="Info"
            className={`p-2 rounded transition-colors ${
              viewMode === "info"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col bg-[#0a0a0a] overflow-hidden">
          {/* Session Status Bar - shown in terminal mode */}
          {activeSession && viewMode === "terminal" && (
            <div className="bg-zinc-950 border-b border-zinc-800 px-3 py-2 space-y-1.5 shrink-0">
              {/* Row 1: Title and Status */}
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-zinc-600 shrink-0">Title:</span>
                  <span className="text-zinc-300 font-medium truncate">{activeSession.title}</span>
                </div>
                {terminalTitle && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-zinc-600">Status:</span>
                    <span className="text-green-400 font-medium">{terminalTitle}</span>
                  </div>
                )}
              </div>

              {/* Row 2: Prompt (if different from title) */}
              {activeSession.firstPrompt && activeSession.firstPrompt !== activeSession.title && (
                <div className="flex items-start gap-1.5 text-xs">
                  <span className="text-zinc-600 shrink-0">Prompt:</span>
                  <span className="text-zinc-400 line-clamp-1">{activeSession.firstPrompt}</span>
                </div>
              )}

              {/* Row 3: Metadata (folder, branch, slug, messages, time) */}
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <button
                  onClick={() => {
                    fetch('/api/reveal', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ path: activeSession.projectPath })
                    }).catch(console.error);
                  }}
                  className="flex items-center gap-1 hover:text-zinc-300 transition-colors"
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
                  className="flex items-center gap-1 hover:text-zinc-300 transition-colors"
                  title="Click to copy resume command"
                >
                  {copiedSlug ? <Check className="w-3 h-3 text-green-400" /> : <Hash className="w-3 h-3" />}
                  <span className={`truncate max-w-[180px] font-mono ${copiedSlug ? "text-green-400" : ""}`}>{activeSession.id.slice(0, 8)}</span>
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
            {/* Render all terminals - use visibility instead of display to preserve dimensions */}
            {sessions.map((session) => {
              const isVisible = viewMode === "terminal" && session.id === activeSession?.id;
              return (
              <div
                key={session.id}
                className={`absolute inset-0 p-3 ${isVisible ? 'visible' : 'invisible pointer-events-none'}`}
              >
            <Terminal
              terminalId={session.id}
              sessionId={session.id}
              projectPath={session.projectPath}
              wsUrl="ws://localhost:3001"
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
                <h2 className="text-xl font-semibold text-zinc-100 mb-2">
                  {activeSession.title}
                </h2>
                <p className="text-zinc-400 text-sm line-clamp-3">
                  {activeSession.firstPrompt}
                </p>
              </div>

              {/* Session Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-zinc-500">Project</span>
                  <button
                    onClick={() => {
                      fetch('/api/reveal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: activeSession.projectPath })
                      }).catch(console.error);
                    }}
                    className="text-zinc-300 hover:text-blue-400 transition-colors text-left"
                    title="Open in Finder"
                  >
                    {activeSession.project}
                  </button>
                </div>
                <div className="space-y-1">
                  <span className="text-zinc-500">Messages</span>
                  <p className="text-zinc-300">{activeSession.messageCount}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-zinc-500">Last Activity</span>
                  <p className="text-zinc-300">
                    {new Date(activeSession.lastActivity).toLocaleString()}
                  </p>
                </div>
                {activeSession.gitBranch && (
                  <div className="space-y-1">
                    <span className="text-zinc-500">Git Branch</span>
                    <p className="text-zinc-300 font-mono text-xs">
                      {activeSession.gitBranch}
                    </p>
                  </div>
                )}
                <div className="space-y-1">
                  <span className="text-zinc-500">Session ID</span>
                  <p className="text-zinc-300 font-mono text-xs">
                    {activeSession.id}
                  </p>
                </div>
              </div>

              {/* Resume Command */}
              <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-400">Resume Command</span>
                  <button
                    onClick={copyCommand}
                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-green-500" />
                        <span className="text-green-500">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code className="block font-mono text-sm text-green-400 bg-zinc-950 px-3 py-2 rounded">
                  claude --resume {activeSession.id}
                </code>
              </div>

              {/* Instructions */}
              <div className="text-sm text-zinc-500 space-y-2">
                <p>
                  To resume this session externally, open a terminal in the project directory
                  and run the command above.
                </p>
                <p className="text-zinc-600 text-xs">
                  Project path: {activeSession.projectPath}
                </p>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2">
                <button
                  onClick={copyCommand}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg transition-colors text-sm"
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
            {/* Plan Details Bar */}
            <div className="bg-zinc-950 border-b border-zinc-800 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="text-xs text-zinc-400 font-mono truncate">
                    {activePlan!.path}
                  </span>
                  {hasPlanChanges && (
                    <span className="text-xs text-amber-500 shrink-0">(unsaved)</span>
                  )}
                  {planSaveError && (
                    <span className="text-xs text-red-500 shrink-0">{planSaveError}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Save button */}
                  <button
                    onClick={savePlan}
                    disabled={!hasPlanChanges || isSavingPlan}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                      hasPlanChanges
                        ? 'text-green-400 hover:text-green-300 hover:bg-green-900/30'
                        : 'text-zinc-600 cursor-not-allowed'
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
                    className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                    title="Reveal in Finder"
                  >
                    <FolderOpen className="w-3 h-3" />
                  </button>
                  <button
                    onClick={copyPlanPath}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                    title="Copy path"
                  >
                    {copiedPlanPath ? (
                      <Check className="w-3 h-3 text-green-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
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
          <div className="flex items-center justify-center h-full text-zinc-600">
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
