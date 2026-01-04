"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import { Session, SessionStatus } from "@/lib/types";
import { useSessions, useInboxItems } from "@/hooks/useSessions";
import { Column } from "./Column";
import { SessionCard } from "./SessionCard";
import { TerminalDrawer } from "./TerminalDrawer";
import { Sidebar } from "./sidebar";
import { ScopeBreadcrumbs, BrowseButton, RecentScopesButton } from "./scope";
import { recordScopeVisit } from "@/lib/recent-scopes";
import { usePinnedFolders } from "@/hooks/usePinnedFolders";
import { Loader2, X, Inbox, Loader2 as InProgressIcon, Clock, Search, Filter, FileText, Check } from "lucide-react";

const COLUMNS: SessionStatus[] = ["inbox", "active", "recent"];

const COLUMN_CONFIG: Record<SessionStatus, { label: string; icon: React.ReactNode }> = {
  inbox: { label: "To Do", icon: <Inbox className="w-4 h-4" /> },
  active: { label: "In Progress", icon: <InProgressIcon className="w-4 h-4" /> },
  recent: { label: "Recent", icon: <Clock className="w-4 h-4" /> },
};

interface InboxItem {
  id: string;
  prompt: string;
  completed: boolean;
  section: string | null;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

const SCOPE_STORAGE_KEY = "claude-kanban-scope";
const HOME_DIR_STORAGE_KEY = "claude-kanban-home-dir";

interface BoardProps {
  initialScope?: string;
}

// Get cached homeDir synchronously to prevent breadcrumb flash
function getCachedHomeDir(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(HOME_DIR_STORAGE_KEY) || "";
}

export function Board({ initialScope = "" }: BoardProps) {
  const router = useRouter();

  // Scope path for filtering sessions - controlled by URL via initialScope
  const [scopePath, setScopePath] = useState<string>(initialScope);
  // Initialize homeDir from cache to prevent breadcrumb disappearing on navigation
  const [homeDir, setHomeDir] = useState<string>(getCachedHomeDir);

  // Sync scopePath with URL changes (initialScope prop)
  useEffect(() => {
    setScopePath(initialScope);
  }, [initialScope]);

  // Persist scope to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined" && scopePath !== undefined) {
      localStorage.setItem(SCOPE_STORAGE_KEY, scopePath);
    }
  }, [scopePath]);

  // Fetch home directory on mount and validate scope if set
  useEffect(() => {
    fetch("/api/folders")
      .then((res) => res.json())
      .then(async (data) => {
        setHomeDir(data.homeDir);
        // Cache for future navigations to prevent breadcrumb flash
        localStorage.setItem(HOME_DIR_STORAGE_KEY, data.homeDir);

        // Validate current scope path (if one is set)
        // Empty scope is valid - it means "all projects" (root view)
        if (scopePath && scopePath !== data.homeDir) {
          const validateRes = await fetch(`/api/folders?validate=${encodeURIComponent(scopePath)}`);
          const validateData = await validateRes.json();
          if (!validateData.valid) {
            // Invalid path, reset to root (all projects)
            setScopePath("");
            localStorage.setItem(SCOPE_STORAGE_KEY, "");
          }
        }
      })
      .catch(console.error);
  }, []);

  // Navigate to a new scope - URL is the source of truth
  const handleScopeChange = useCallback((path: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SCOPE_STORAGE_KEY, path);
      recordScopeVisit(path);
    }
    // Navigate via URL - the initialScope prop will sync scopePath state
    router.push(path || "/", { scroll: false });
  }, [router]);

  const { sessions, counts, isLoading, updateStatus, toggleStarred } = useSessions(scopePath || undefined);
  const { items: inboxItems, sections: todoSections, createItem, updateItem, deleteItem, reorderSections, reorderItem } = useInboxItems(scopePath || undefined);
  const pinnedFolders = usePinnedFolders();

  // The most recent session would be resumed by `claude --continue`
  const continuableSessionId = useMemo(() => {
    if (sessions.length === 0) return undefined;
    const mostRecent = sessions.reduce((latest, session) =>
      new Date(session.lastActivity) > new Date(latest.lastActivity) ? session : latest
    );
    return mostRecent.id;
  }, [sessions]);

  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [draggingSession, setDraggingSession] = useState<Session | null>(null);
  const [openSessions, setOpenSessions] = useState<Session[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(700); // Default, will be updated by TerminalDrawer
  // Plan-only view: session shown for plan viewing without starting terminal
  const [planViewSession, setPlanViewSession] = useState<Session | null>(null);

  // Track if we've restored session from URL (to avoid double-triggering)
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  // Track terminal status per session (from Claude Code's dynamic title)
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, string>>({});
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Filter state
  const [filters, setFilters] = useState<{ hasPlan: boolean }>({ hasPlan: false });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // Track when sessions were first seen (for "new" effect)
  const [firstSeenAt, setFirstSeenAt] = useState<Record<string, number>>({});
  const knownSessionIds = useRef<Set<string>>(new Set());
  // Track temp session creation times and project paths for matching with real sessions
  const tempSessionInfo = useRef<Record<string, { createdAt: number; projectPath: string }>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Mark session restoration as complete on mount
  useEffect(() => {
    setHasRestoredSession(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFilterOpen) {
          setIsFilterOpen(false);
        } else if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else if (isDrawerOpen) {
          setIsDrawerOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, selectedIds.size, isFilterOpen]);

  // Click outside to close filter dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    if (isFilterOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isFilterOpen]);

  // Reset known sessions and "new" effect when scope changes
  useEffect(() => {
    knownSessionIds.current.clear();
    setFirstSeenAt({});
  }, [scopePath]);

  // Track when new sessions first appear (for "new" highlight effect)
  useEffect(() => {
    if (sessions.length === 0) return;

    const now = Date.now();
    const newFirstSeen: Record<string, number> = {};
    let hasNew = false;

    // Count how many sessions we already knew about
    const previouslyKnownCount = knownSessionIds.current.size;

    for (const session of sessions) {
      if (!knownSessionIds.current.has(session.id)) {
        // New session detected
        knownSessionIds.current.add(session.id);
        // Only mark as "new" if this isn't the initial load
        // (i.e., we already knew about some sessions before this one appeared)
        if (previouslyKnownCount > 0) {
          newFirstSeen[session.id] = now;
          hasNew = true;
        }
      }
    }

    if (hasNew) {
      setFirstSeenAt(prev => ({ ...prev, ...newFirstSeen }));
    }
  }, [sessions]);

  // Match real sessions to temp sessions when they appear
  // This handles the case where a temp session (new-xxx) needs to be replaced
  // with the real session UUID once Claude Code creates the JSONL file
  useEffect(() => {
    // Get all temp sessions that need matching
    const tempSessions = openSessions.filter(s => s.id.startsWith("new-") && s.isNew);
    if (tempSessions.length === 0) return;

    let hasUpdates = false;
    const updates: Record<string, string> = {}; // tempId -> realId

    for (const tempSession of tempSessions) {
      const info = tempSessionInfo.current[tempSession.id];
      if (!info) continue;

      // Find a real session that matches:
      // - Same project path
      // - Activity timestamp within 60 seconds of temp session creation
      // - Not already an open session
      const match = sessions.find(s => {
        // Must be same project
        if (s.projectPath !== info.projectPath) return false;

        // Must have activity within 60 seconds of temp session creation
        const realActivityTime = new Date(s.lastActivity).getTime();
        const timeDiff = realActivityTime - info.createdAt;
        if (timeDiff < -5000 || timeDiff > 60000) return false;

        // Must not already be in openSessions (except as this temp session)
        if (openSessions.some(os => os.id === s.id && os.id !== tempSession.id)) return false;

        return true;
      });

      if (match) {
        updates[tempSession.id] = match.id;
        hasUpdates = true;
      }
    }

    if (hasUpdates) {
      // Update openSessions to replace temp IDs with real IDs
      setOpenSessions(prev => prev.map(session => {
        const realId = updates[session.id];
        if (realId) {
          // Clean up temp session tracking
          delete tempSessionInfo.current[session.id];
          // Replace ID, keep other session data (preserve terminal connection)
          return { ...session, id: realId, isNew: false };
        }
        return session;
      }));

      // Update activeSession if it was a temp session
      setActiveSession(prev => {
        if (prev && updates[prev.id]) {
          return { ...prev, id: updates[prev.id], isNew: false };
        }
        return prev;
      });
    }
  }, [sessions, openSessions]);

  // Filter function for search
  const matchesSearch = useCallback((text: string | null | undefined) => {
    if (!searchQuery.trim()) return true;
    if (!text) return false;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  }, [searchQuery]);

  // Check if any filters are active
  const hasActiveFilters = filters.hasPlan;

  const getSessionsByStatus = useCallback(
    (status: SessionStatus) => {
      let realSessions = sessions.filter((s) => s.status === status);

      // Apply search filter
      if (searchQuery.trim()) {
        realSessions = realSessions.filter((s) =>
          matchesSearch(s.title) ||
          matchesSearch(s.firstPrompt) ||
          matchesSearch(s.slug) ||
          matchesSearch(s.project) ||
          matchesSearch(s.gitBranch)
        );
      }

      // Apply filters
      if (filters.hasPlan) {
        realSessions = realSessions.filter((s) => s.planSlugs && s.planSlugs.length > 0);
      }

      // Include pending "new" sessions in Active column
      if (status === "active") {
        let newSessions = openSessions.filter(
          (s) => s.isNew && !sessions.find((rs) => rs.id === s.id)
        );
        // Apply search filter to new sessions too
        if (searchQuery.trim()) {
          newSessions = newSessions.filter((s) =>
            matchesSearch(s.title) ||
            matchesSearch(s.firstPrompt) ||
            matchesSearch(s.slug)
          );
        }
        return [...newSessions, ...realSessions];
      }

      return realSessions;
    },
    [sessions, openSessions, searchQuery, matchesSearch, filters]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const session = sessions.find((s) => s.id === active.id);
    if (session) {
      setDraggingSession(session);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Could add preview functionality here
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggingSession(null);

    if (!over) return;

    const sessionId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    if (COLUMNS.includes(overId as SessionStatus)) {
      const newStatus = overId as SessionStatus;
      const session = sessions.find((s) => s.id === sessionId);
      if (session && session.status !== newStatus) {
        updateStatus(sessionId, newStatus);
      }
    }
  };

  const handleOpenSession = (session: Session) => {
    // Add to open sessions if not already open
    if (!openSessions.find((s) => s.id === session.id)) {
      setOpenSessions((prev) => [...prev, session]);
    }
    setActiveSession(session);
    setIsDrawerOpen(true);

    // Mark as in progress
    if (session.status !== "active") {
      updateStatus(session.id, "active");
    }
  };

  const handleOpenPlan = (session: Session) => {
    // Open in plan-only view mode - don't start terminal or change status
    // This is just for inspecting the plan without engaging the session
    const sessionWithPlanMode = { ...session, planMode: true };
    setPlanViewSession(sessionWithPlanMode);
    setActiveSession(sessionWithPlanMode);
    setIsDrawerOpen(true);
    // Note: We don't add to openSessions or update status - terminal won't start
  };

  // Called when user switches from plan-only view to terminal mode
  const handleEngageSession = (session: Session) => {
    // Clear plan-only view since we're now engaging the terminal
    setPlanViewSession(null);

    // Add to open sessions if not already open
    if (!openSessions.find((s) => s.id === session.id)) {
      setOpenSessions((prev) => [...prev, session]);
    }
    setActiveSession(session);

    // Mark as in progress
    if (session.status !== "active") {
      updateStatus(session.id, "active");
    }
  };

  const handleCloseSession = (sessionId: string) => {
    setOpenSessions((prev) => prev.filter((s) => s.id !== sessionId));

    // Clear the terminal status for this session
    setSessionStatuses((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });

    // If closing the active session, switch to another or close drawer
    if (activeSession?.id === sessionId) {
      const remaining = openSessions.filter((s) => s.id !== sessionId);
      if (remaining.length > 0) {
        setActiveSession(remaining[remaining.length - 1]);
      } else {
        setActiveSession(null);
        setIsDrawerOpen(false);
      }
    }

    // Mark as recent
    updateStatus(sessionId, "recent");
  };

  const handleDeleteSession = (session: Session) => {
    // Close the terminal window for this session
    setOpenSessions((prev) => prev.filter((s) => s.id !== session.id));

    // Clear the terminal status for this session
    setSessionStatuses((prev) => {
      const next = { ...prev };
      delete next[session.id];
      return next;
    });

    // If this was the active session, switch to another or close drawer
    if (activeSession?.id === session.id) {
      const remaining = openSessions.filter((s) => s.id !== session.id);
      if (remaining.length > 0) {
        setActiveSession(remaining[remaining.length - 1]);
      } else {
        setActiveSession(null);
        setIsDrawerOpen(false);
      }
    }

    // Move to recent
    updateStatus(session.id, "recent");
  };

  const handleCreateInboxItem = async (prompt: string, section?: string | null) => {
    await createItem(prompt, section);
  };

  const handleCreateAndRunInboxItem = async (prompt: string) => {
    // Create a temporary session directly without saving to inbox
    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const projectPath = scopePath || "/";
    const newSession: Session = {
      id: tempId,
      title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
      firstPrompt: prompt,
      lastPrompt: prompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: prompt,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);
  };

  const handleUpdateInboxItem = async (id: string, prompt: string) => {
    await updateItem(id, prompt);
  };

  const handleMoveItemToSection = async (id: string, section: string | null) => {
    await updateItem(id, undefined, undefined, section);
  };

  const handleDeleteInboxItem = async (id: string) => {
    await deleteItem(id);
  };

  // Handle terminal status updates from active sessions
  const handleStatusUpdate = useCallback((sessionId: string, status: string) => {
    setSessionStatuses((prev) => ({ ...prev, [sessionId]: status }));
  }, []);

  const handleStartInboxItem = async (item: { id: string; prompt: string }) => {
    // Create a temporary session for the new Claude Code instance
    const now = Date.now();
    const tempId = `new-${now}`;
    // Use scopePath for new sessions, derive project name from folder
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const projectPath = scopePath || "/";
    const newSession: Session = {
      id: tempId,
      title: item.prompt.slice(0, 50) + (item.prompt.length > 50 ? "..." : ""),
      firstPrompt: item.prompt,
      lastPrompt: item.prompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: item.prompt,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting it
    await deleteItem(item.id);
  };

  const handleRefineInboxItem = (item: { id: string; prompt: string }) => {
    // Wrap the prompt with refinement instructions
    const refinementPrompt = `I have a rough idea that needs refinement before implementation:

---
${item.prompt}
---

Please help me refine this by:
1. Understanding what I'm trying to accomplish
2. Identifying any ambiguities or missing context
3. Suggesting 2-3 possible directions we could take
4. Asking clarifying questions to help narrow down the approach

IMPORTANT: Do NOT begin implementing or writing code yet. This is a refinement phase - wait for my direction before any implementation.`;

    // Create a temporary session for refinement
    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const projectPath = scopePath || "/";
    const newSession: Session = {
      id: tempId,
      title: `Refining: ${item.prompt.slice(0, 40)}${item.prompt.length > 40 ? "..." : ""}`,
      firstPrompt: refinementPrompt,
      lastPrompt: refinementPrompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: refinementPrompt,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Add to open sessions and open the drawer
    // NOTE: We don't delete the inbox item - user can run it after refining
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);
  };

  // Selection handlers
  const handleSelectSession = useCallback((session: Session, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(session.id);
      } else {
        next.delete(session.id);
      }
      return next;
    });
  }, []);

  const handleSelectInboxItem = useCallback((item: InboxItem, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const id = `inbox-${item.id}`;
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const moveSelectedTo = useCallback(async (targetStatus: SessionStatus) => {
    for (const id of selectedIds) {
      if (id.startsWith("inbox-")) {
        // Inbox items can't be moved to columns directly (they need to be started)
        continue;
      }
      await updateStatus(id, targetStatus);
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateStatus]);

  // Filter inbox items by search query
  const filteredInboxItems = searchQuery.trim()
    ? inboxItems.filter((item) => matchesSearch(item.prompt))
    : inboxItems;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      {/* Status Bar - fixed height for drawer alignment */}
      <div
        className="flex items-center gap-4 px-4 h-11 bg-zinc-900 border-b border-zinc-800"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left side: Scope controls (breadcrumbs, recent, browse) */}
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {homeDir && (
            <>
              <ScopeBreadcrumbs
                  value={scopePath}
                  homeDir={homeDir}
                  onChange={handleScopeChange}
                  isPinned={pinnedFolders.isPinned(scopePath)}
                  onTogglePin={() => pinnedFolders.togglePin(scopePath)}
                />
              <RecentScopesButton
                currentPath={scopePath}
                homeDir={homeDir}
                onSelect={handleScopeChange}
              />
            </>
          )}
          <BrowseButton onSelect={handleScopeChange} />
        </div>

        {/* Right side: Filter & Search */}
        <div className="ml-auto flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Filter dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`p-1.5 rounded transition-colors ${
                hasActiveFilters
                  ? "text-blue-400 bg-blue-900/30 hover:bg-blue-900/50"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
              title="Filters"
            >
              <Filter className="w-4 h-4" />
            </button>
            {isFilterOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={() => {
                    setFilters(prev => ({ ...prev, hasPlan: !prev.hasPlan }));
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 transition-colors"
                >
                  <FileText className="w-4 h-4 text-zinc-400" />
                  <span className="flex-1">Plans</span>
                  {filters.hasPlan && <Check className="w-4 h-4 text-blue-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Search */}
          {searchQuery ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={(e) => {
                  if (!e.target.value) setSearchQuery("");
                }}
                autoFocus
                className="w-40 pl-8 pr-7 py-1.5 text-sm bg-zinc-800 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none"
              />
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchQuery(" ")}
              className="p-1.5 rounded transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              title="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          sessions={sessions}
          inboxItems={inboxItems}
          currentScope={scopePath}
          onScopeChange={handleScopeChange}
          pinnedFolders={pinnedFolders}
        />

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Board */}
          <div
            className="flex-1 flex gap-4 p-4 overflow-x-auto transition-[padding] duration-300"
            style={{ paddingRight: isDrawerOpen ? `${drawerWidth + 16}px` : undefined }}
            onClick={(e) => {
              // Close drawer when clicking on board background (not on cards/columns)
              if (e.target === e.currentTarget && isDrawerOpen) {
                setIsDrawerOpen(false);
              }
            }}
          >
            {COLUMNS.map((status) => {
              const filteredSessions = getSessionsByStatus(status);
              // Use filtered count when filters are active, otherwise use API count
              const displayCount = hasActiveFilters ? filteredSessions.length : counts[status];
              return (
              <Column
                key={status}
                status={status}
                sessions={filteredSessions}
                totalCount={displayCount}
                inboxItems={status === "inbox" ? filteredInboxItems : undefined}
                todoSections={status === "inbox" ? todoSections : undefined}
                scopePath={status === "inbox" ? scopePath : undefined}
                onReorderSections={status === "inbox" ? reorderSections : undefined}
                onReorderItem={status === "inbox" ? reorderItem : undefined}
                onOpenSession={handleOpenSession}
                onOpenPlan={handleOpenPlan}
                onDeleteSession={handleDeleteSession}
                onToggleStarred={toggleStarred}
                onCreateInboxItem={status === "inbox" ? handleCreateInboxItem : undefined}
                onCreateAndRunInboxItem={status === "inbox" ? handleCreateAndRunInboxItem : undefined}
                onUpdateInboxItem={handleUpdateInboxItem}
                onDeleteInboxItem={handleDeleteInboxItem}
                onStartInboxItem={handleStartInboxItem}
                onRefineInboxItem={handleRefineInboxItem}
                sessionStatuses={sessionStatuses}
                firstSeenAt={firstSeenAt}
                selectedIds={selectedIds}
                onSelectSession={handleSelectSession}
                onSelectInboxItem={handleSelectInboxItem}
                onBackgroundClick={() => isDrawerOpen && setIsDrawerOpen(false)}
                openSessionCount={status === "active" ? openSessions.length : undefined}
                isDrawerOpen={status === "active" ? isDrawerOpen : undefined}
                onToggleDrawer={status === "active" ? () => setIsDrawerOpen(!isDrawerOpen) : undefined}
                continuableSessionId={continuableSessionId}
              />
              );
            })}
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {draggingSession && (
              <div className="opacity-80">
                <SessionCard session={draggingSession} />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Terminal Drawer */}
        <TerminalDrawer
          isOpen={isDrawerOpen}
          sessions={openSessions}
          activeSession={activeSession}
          planViewSession={planViewSession}
          onClose={() => {
            setIsDrawerOpen(false);
            setPlanViewSession(null);
          }}
          onOpen={() => setIsDrawerOpen(true)}
          onSelectSession={setActiveSession}
          onCloseSession={handleCloseSession}
          onEngageSession={handleEngageSession}
          onStatusUpdate={handleStatusUpdate}
          onWidthChange={setDrawerWidth}
        />
      </div>

      {/* Selection Action Bar - Bottom */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-950/50 border-t border-blue-800/50">
          <div className="flex items-center gap-3">
            <span className="text-sm text-blue-300">
              {selectedIds.size} selected
            </span>
            <button
              onClick={clearSelection}
              className="p-1 text-blue-400 hover:text-blue-200 hover:bg-blue-800/50 rounded transition-colors"
              title="Clear selection (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-400 mr-2">Move to:</span>
            {COLUMNS.map((status) => (
              <button
                key={status}
                onClick={() => moveSelectedTo(status)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
              >
                {COLUMN_CONFIG[status].icon}
                <span>{COLUMN_CONFIG[status].label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
