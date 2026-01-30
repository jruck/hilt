"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
import { Session, SessionStatus, ColumnId, RalphConfig } from "@/lib/types";
import { needsAttention } from "@/lib/session-status";
import { useSessions, useInboxItems } from "@/hooks/useSessions";
import { useTreeSessions } from "@/hooks/useTreeSessions";
import { useScope } from "@/contexts/ScopeContext";
import { Column } from "./Column";
import { SessionCard } from "./SessionCard";
import dynamic from "next/dynamic";
import { ScopeBreadcrumbs, BrowseButton, RecentScopesButton } from "./scope";
import { PinnedFoldersPopover } from "./scope/PinnedFoldersPopover";
import { ViewToggle, ViewMode, TaskViewModeToggle, getPrimaryView } from "./ViewToggle";

const TreeView = dynamic(() => import("./TreeView").then(m => ({ default: m.TreeView })), { ssr: false });
const DocsView = dynamic(() => import("./DocsView").then(m => ({ default: m.DocsView })), { ssr: false });
const StackView = dynamic(() => import("./stack").then(m => ({ default: m.StackView })), { ssr: false });
const BridgeView = dynamic(() => import("./bridge/BridgeView").then(m => ({ default: m.BridgeView })), { ssr: false });
const TerminalDrawer = dynamic(() => import("./TerminalDrawer").then(m => ({ default: m.TerminalDrawer })), { ssr: false });
import { RalphSetupModal } from "./RalphSetupModal";
import { QuickAddModal } from "./QuickAddModal";
import { usePinnedFolders } from "@/hooks/usePinnedFolders";
import { useInboxPath } from "@/hooks/useInboxPath";
import { generatePrdPrompt, generateRalphCommand } from "@/lib/ralph";
import { X, Inbox, Play, Clock, Search, Filter, FileText, Check, Archive, Eye, CheckCircle, Terminal } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { QuickAddButton } from "./QuickAddButton";

const COLUMNS: ColumnId[] = ["inbox", "active", "attention", "recent"];

const COLUMN_CONFIG: Record<ColumnId, { label: string; icon: React.ReactNode }> = {
  inbox: { label: "To Do", icon: <Inbox className="w-4 h-4" /> },
  attention: { label: "Review", icon: <Eye className="w-4 h-4" /> },
  active: { label: "Active", icon: <Play className="w-4 h-4" /> },
  recent: { label: "Done", icon: <CheckCircle className="w-4 h-4" /> },
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

const HOME_DIR_STORAGE_KEY = "hilt-home-dir";
const VIEW_MODE_STORAGE_KEY = "hilt-view-mode";

export function Board() {
  // Scope path from context - no more router.push, pure client-side state
  const { scopePath, setScopePath } = useScope();

  // Track if we've hydrated from localStorage (to prevent hydration mismatch)
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize with empty/default values for SSR, then hydrate from localStorage
  const [homeDir, setHomeDir] = useState<string>("");
  // undefined = not yet loaded, null = loaded but not configured, string = configured path
  const [workingFolder, setWorkingFolder] = useState<string | null | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>("docs");
  const [docsInitialFile, setDocsInitialFile] = useState<string | null>(null);

  // Hydrate from localStorage (for homeDir) and server (for viewMode) after mount
  useEffect(() => {
    const cachedHomeDir = localStorage.getItem(HOME_DIR_STORAGE_KEY) || "";

    if (cachedHomeDir) {
      setHomeDir(cachedHomeDir);
    }

    // Fetch view mode from server-side preferences
    fetch("/api/preferences?key=viewMode")
      .then((res) => res.json())
      .then((data) => {
        if (data.value === "board" || data.value === "tree" || data.value === "docs" || data.value === "stack" || data.value === "bridge") {
          setViewMode(data.value);
        }
      })
      .catch(() => {
        // Fall back to localStorage for backward compatibility
        const cachedViewMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (cachedViewMode === "kanban" || cachedViewMode === "board") {
          setViewMode("board");
        } else if (cachedViewMode === "tree") {
          setViewMode("tree");
        } else if (cachedViewMode === "docs") {
          setViewMode("docs");
        } else if (cachedViewMode === "stack") {
          setViewMode("stack");
        } else if (cachedViewMode === "bridge") {
          setViewMode("bridge");
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
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
            setWorkingFolder(data.workingFolder || null);
          })
          .catch(() => setWorkingFolder(null));
      }
      // Only validate if scope looks suspicious (not empty and not under cached homeDir)
      if (scopePath && !scopePath.startsWith(homeDir)) {
        fetch(`/api/folders?validate=${encodeURIComponent(scopePath)}`)
          .then((res) => res.json())
          .then((data) => {
            if (!data.valid) {
              setScopePath(homeDir);
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
        setWorkingFolder(data.workingFolder || null);

        // Validate current scope path if set
        if (scopePath && scopePath !== data.homeDir) {
          const validateRes = await fetch(`/api/folders?validate=${encodeURIComponent(scopePath)}`);
          const validateData = await validateRes.json();
          if (!validateData.valid) {
            setScopePath(data.homeDir);
          }
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  // Track if we've done the initial redirect (to prevent re-redirecting when user navigates to root)
  const hasInitialRedirected = useRef(false);

  // Default to workingFolder (or homeDir) only on initial load when at root URL
  useEffect(() => {
    // Wait for workingFolder to be loaded (undefined = still loading)
    if (workingFolder === undefined) return;
    // Only redirect once, on initial hydration, if URL is at root
    if (isHydrated && homeDir && !scopePath && !hasInitialRedirected.current) {
      hasInitialRedirected.current = true;
      setScopePath(workingFolder ?? homeDir);
    }
  }, [isHydrated, homeDir, workingFolder, scopePath, setScopePath]);

  // Filter state for showing archived sessions
  const [showArchived, setShowArchived] = useState(false);

  const { sessions, counts, isLoading, updateStatus, toggleStarred, archiveSession, unarchiveSession } = useSessions(scopePath || undefined, 1, 100, showArchived);
  const { items: inboxItems, sections: todoSections, createItem, updateItem, deleteItem, reorderSections, reorderItem } = useInboxItems(scopePath || undefined);
  const { tree, isLoading: isTreeLoading } = useTreeSessions(scopePath, showArchived, viewMode === "tree");
  const pinnedFolders = usePinnedFolders();
  const { inboxPath, setInboxPath } = useInboxPath();

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

  // Ralph Wiggum loop state
  const [isRalphModalOpen, setIsRalphModalOpen] = useState(false);
  const [ralphSeedPrompt, setRalphSeedPrompt] = useState("");
  const [pendingRalphItemId, setPendingRalphItemId] = useState<string | null>(null);

  // QuickAdd modal state
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Handlers for archive/unarchive
  const handleArchiveSession = async (sessionId: string) => {
    await archiveSession(sessionId);
  };

  const handleUnarchiveSession = async (sessionId: string) => {
    await unarchiveSession(sessionId);
  };
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // Track when sessions were first seen (for "new" effect)
  const [firstSeenAt, setFirstSeenAt] = useState<Record<string, number>>({});
  const knownSessionIds = useRef<Set<string>>(new Set());
  // Track temp session creation times and project paths for matching with real sessions
  const tempSessionInfo = useRef<Record<string, { createdAt: number; projectPath: string }>>({});

  // Register a session in the Hilt registry (POST /api/sessions)
  const registerSession = useCallback(async (session: {
    id: string;
    projectPath: string;
    title: string;
    firstPrompt: string | null;
    initialPrompt?: string;
    terminalId?: string;
  }) => {
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      });
    } catch (err) {
      console.error("Failed to register session:", err);
    }
  }, []);

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
      // QuickAdd shortcut: Cmd/Ctrl+I
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        setIsQuickAddOpen(true);
        return;
      }

      if (e.key === "Escape") {
        if (isQuickAddOpen) {
          // Let the modal handle its own escape
          return;
        } else if (isFilterOpen) {
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
  }, [isDrawerOpen, selectedIds.size, isFilterOpen, isQuickAddOpen]);

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
      // - Not already claimed by another temp session in this matching pass
      const match = sessions.find(s => {
        // Must be same project
        if (s.projectPath !== info.projectPath) return false;

        // Must have activity within 60 seconds of temp session creation
        const realActivityTime = new Date(s.lastActivity).getTime();
        const timeDiff = realActivityTime - info.createdAt;
        if (timeDiff < -5000 || timeDiff > 60000) return false;

        // Must not already be in openSessions (except as this temp session)
        if (openSessions.some(os => os.id === s.id && os.id !== tempSession.id)) return false;

        // Must not already be claimed by another temp session in this matching pass
        if (Object.values(updates).includes(s.id)) return false;

        return true;
      });

      if (match) {
        updates[tempSession.id] = match.id;
        hasUpdates = true;
      }
    }

    if (hasUpdates) {
      // Update openSessions to replace temp IDs with real IDs
      // IMPORTANT: Preserve terminalId to avoid terminal reload
      setOpenSessions(prev => prev.map(session => {
        const realId = updates[session.id];
        if (realId) {
          // Clean up temp session tracking
          delete tempSessionInfo.current[session.id];
          // Replace ID but preserve terminalId to keep terminal connected
          return { ...session, id: realId, isNew: false, terminalId: session.terminalId };
        }
        return session;
      }));

      // Update activeSession if it was a temp session
      setActiveSession(prev => {
        if (prev && updates[prev.id]) {
          return { ...prev, id: updates[prev.id], isNew: false, terminalId: prev.terminalId };
        }
        return prev;
      });

      // Resolve temp→real IDs in the registry
      for (const [tempId, realId] of Object.entries(updates)) {
        fetch("/api/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: tempId, realId }),
        }).catch(err => console.error("Failed to resolve session ID:", err));
      }
    }
  }, [sessions, openSessions]);

  // Filter function for search
  const matchesSearch = useCallback((text: string | null | undefined) => {
    if (!searchQuery.trim()) return true;
    if (!text) return false;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  }, [searchQuery]);

  // Check if any filters are active
  const hasActiveFilters = filters.hasPlan || showArchived;

  const getSessionsByColumn = useCallback(
    (columnId: ColumnId) => {
      // Helper to check if a session needs attention (based on derived state)
      const sessionNeedsAttention = (s: Session) =>
        s.derivedState && needsAttention(s.derivedState.status);

      // For "attention" column: show active sessions that need attention
      if (columnId === "attention") {
        let attentionSessions = sessions.filter(
          (s) => s.status === "active" && sessionNeedsAttention(s)
        );

        // Apply search filter
        if (searchQuery.trim()) {
          attentionSessions = attentionSessions.filter((s) =>
            matchesSearch(s.title) ||
            matchesSearch(s.firstPrompt) ||
            matchesSearch(s.slug) ||
            matchesSearch(s.project) ||
            matchesSearch(s.gitBranch)
          );
        }

        // Apply filters
        if (filters.hasPlan) {
          attentionSessions = attentionSessions.filter((s) => s.planSlugs && s.planSlugs.length > 0);
        }

        // Deduplicate by ID
        const seen = new Set<string>();
        return attentionSessions.filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
      }

      // For other columns: use the status field, but filter out attention sessions from active
      let realSessions = sessions.filter((s) => s.status === columnId);

      // For "active" column, exclude sessions that should be in attention column
      if (columnId === "active") {
        realSessions = realSessions.filter((s) => !sessionNeedsAttention(s));
      }

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
      if (columnId === "active") {
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
        // Deduplicate by ID to prevent duplicate key errors
        const seen = new Set<string>();
        return [...newSessions, ...realSessions].filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
      }

      // Deduplicate by ID to prevent duplicate key errors
      const seen = new Set<string>();
      return realSessions.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
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

    // Can't drop on "attention" column - it's auto-populated
    if (overId === "attention") return;

    // Check if dropped on a column (must be a valid SessionStatus)
    const validStatuses: SessionStatus[] = ["inbox", "active", "recent"];
    if (validStatuses.includes(overId as SessionStatus)) {
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
      lastMessage: prompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: prompt,
      terminalId: tempId, // Stable terminal ID - won't change when session gets real ID
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath,
      title: newSession.title,
      firstPrompt: prompt,
      initialPrompt: prompt,
      terminalId: tempId,
    });

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
      lastMessage: item.prompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: item.prompt,
      terminalId: tempId, // Stable terminal ID - won't change when session gets real ID
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath,
      title: newSession.title,
      firstPrompt: item.prompt,
      initialPrompt: item.prompt,
      terminalId: tempId,
    });

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting it
    await deleteItem(item.id);
  };

  const handleRefineInboxItem = async (item: { id: string; prompt: string }) => {
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
      lastMessage: refinementPrompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: refinementPrompt,
      terminalId: tempId, // Stable terminal ID - won't change when session gets real ID
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath,
      title: newSession.title,
      firstPrompt: refinementPrompt,
      initialPrompt: refinementPrompt,
      terminalId: tempId,
    });

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting a session
    await deleteItem(item.id);
  };

  // Helper to extract domain from URL for display
  const extractDomain = (content: string): string => {
    try {
      const url = new URL(content.trim().split('\n')[0]);
      return url.hostname.replace('www.', '');
    } catch {
      return content.slice(0, 30) + (content.length > 30 ? '...' : '');
    }
  };

  // Helper to detect YouTube URLs
  const isYouTubeUrl = (content: string): boolean => {
    const firstLine = content.trim().split('\n')[0];
    return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(firstLine);
  };

  const handleProcessReference = async (item: { id: string; prompt: string }) => {
    const isYouTube = isYouTubeUrl(item.prompt);

    // Build fetch strategy based on content type
    const fetchStrategy = isYouTube
      ? `FETCH STRATEGY (YouTube video):
1. First, fetch the transcript using: http://localhost:3000/api/youtube-transcript?url=VIDEO_URL
   - This returns the full transcript text and timestamped segments
   - If transcript fails, proceed to fallback options below
2. Use WebFetch on the video page to get title, description, channel info
3. If both fail, ask me to choose a fallback method (see FALLBACK OPTIONS below)`
      : `FETCH STRATEGY:
1. Use WebFetch tool first to get the content
2. If WebFetch fails (paywall, blocked, incomplete), ask me to choose a fallback method

FALLBACK OPTIONS (ask me to choose one):
a) Firecrawl - best for paywalled/dynamic content, requires API key
b) Claude-in-Chrome browser automation - interactive but slower
c) Paste the content manually - I'll copy/paste it myself

If I choose Firecrawl:
1. Check status: GET http://localhost:3000/api/firecrawl
   - Returns { configured: true/false }
2. If not configured, tell me:
   "Firecrawl requires an API key. Get one at https://firecrawl.dev
    Then I'll configure it with: POST /api/firecrawl { action: 'configure', apiKey: 'your-key' }"
3. If configured, scrape: POST http://localhost:3000/api/firecrawl { url: 'THE_URL' }
   - Returns { success: true, content: '...markdown...', title: '...' }`;

    // Wrap the prompt with reference processing instructions
    const referencePrompt = `Process this as a reference for the Process knowledge base.

SOURCE:
---
${item.prompt}
---

${fetchStrategy}

PROCESSING:
Follow References/index.md instructions exactly:
- Create file: References/YYYY-MM-DD-slug.md
- Include: metadata, video embed (if applicable), summary, key insights, implications for Process
- For YouTube videos: extract video ID, create iframe embed, include transcript summary
- Update the Catalog table in References/index.md

MINIMAL INTERACTION:
Only ask for input when absolutely necessary (choosing fallback method, missing content).
Proceed autonomously otherwise.`;

    // Create a temporary session for reference processing
    const now = Date.now();
    const tempId = `new-${now}`;
    // Always use Process project for references
    const projectPath = "/Users/jruck/Bridge/Libraries/Personal/Process";
    const newSession: Session = {
      id: tempId,
      title: `Reference: ${extractDomain(item.prompt)}`,
      firstPrompt: referencePrompt,
      lastPrompt: referencePrompt,
      lastMessage: referencePrompt,
      project: "Process",
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: referencePrompt,
      terminalId: tempId, // Stable terminal ID - won't change when session gets real ID
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath,
      title: newSession.title,
      firstPrompt: referencePrompt,
      initialPrompt: referencePrompt,
      terminalId: tempId,
    });

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting a session
    await deleteItem(item.id);
  };

  // QuickAdd handlers - save/run items to a destination folder
  const handleQuickAddSave = async (prompt: string, destinationPath: string) => {
    // Save to the destination folder's Todo.md via /api/inbox
    const response = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        section: "New",
        scope: destinationPath,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save: ${response.statusText}`);
    }

    // Navigate to the destination folder
    if (destinationPath !== scopePath) {
      setScopePath(destinationPath);
    }
  };

  const handleQuickAddRun = async (prompt: string, destinationPath: string) => {
    // Create a session in the destination folder
    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = destinationPath.split("/").pop() || "New Session";
    const newSession: Session = {
      id: tempId,
      title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
      firstPrompt: prompt,
      lastPrompt: prompt,
      lastMessage: prompt,
      project: projectName,
      projectPath: destinationPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: prompt,
      terminalId: tempId,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    tempSessionInfo.current[tempId] = { createdAt: now, projectPath: destinationPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath: destinationPath,
      title: newSession.title,
      firstPrompt: prompt,
      initialPrompt: prompt,
      terminalId: tempId,
    });

    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Navigate to the destination folder
    if (destinationPath !== scopePath) {
      setScopePath(destinationPath);
    }
  };

  const handleQuickAddRefine = async (prompt: string, destinationPath: string) => {
    const refinementPrompt = `I have a rough idea that needs refinement before implementation:

---
${prompt}
---

Please help me refine this by:
1. Understanding what I'm trying to accomplish
2. Identifying any ambiguities or missing context
3. Suggesting 2-3 possible directions we could take
4. Asking clarifying questions to help narrow down the approach

IMPORTANT: Do NOT begin implementing or writing code yet. This is a refinement phase - wait for my direction before any implementation.`;

    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = destinationPath.split("/").pop() || "New Session";
    const newSession: Session = {
      id: tempId,
      title: `Refining: ${prompt.slice(0, 40)}${prompt.length > 40 ? "..." : ""}`,
      firstPrompt: refinementPrompt,
      lastPrompt: refinementPrompt,
      lastMessage: refinementPrompt,
      project: projectName,
      projectPath: destinationPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: refinementPrompt,
      terminalId: tempId,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    tempSessionInfo.current[tempId] = { createdAt: now, projectPath: destinationPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath: destinationPath,
      title: newSession.title,
      firstPrompt: refinementPrompt,
      initialPrompt: refinementPrompt,
      terminalId: tempId,
    });

    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Navigate to the destination folder
    if (destinationPath !== scopePath) {
      setScopePath(destinationPath);
    }
  };

  const handleQuickAddReference = async (prompt: string, destinationPath: string) => {
    const isYouTube = isYouTubeUrl(prompt);

    const fetchStrategy = isYouTube
      ? `FETCH STRATEGY (YouTube video):
1. First, fetch the transcript using: http://localhost:3000/api/youtube-transcript?url=VIDEO_URL
   - This returns the full transcript text and timestamped segments
   - If transcript fails, proceed to fallback options below
2. Use WebFetch on the video page to get title, description, channel info
3. If both fail, ask me to choose a fallback method`
      : `FETCH STRATEGY:
1. Use WebFetch tool first to get the content
2. If WebFetch fails (paywall, blocked, incomplete), ask me to choose a fallback method`;

    const referencePrompt = `Process this as a reference for the knowledge base.

SOURCE:
---
${prompt}
---

${fetchStrategy}

PROCESSING:
- Create appropriate reference file with metadata and summary
- Extract key insights and implications

MINIMAL INTERACTION:
Only ask for input when absolutely necessary. Proceed autonomously otherwise.`;

    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = destinationPath.split("/").pop() || "New Session";
    const newSession: Session = {
      id: tempId,
      title: `Reference: ${extractDomain(prompt)}`,
      firstPrompt: referencePrompt,
      lastPrompt: referencePrompt,
      lastMessage: referencePrompt,
      project: projectName,
      projectPath: destinationPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: referencePrompt,
      terminalId: tempId,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    tempSessionInfo.current[tempId] = { createdAt: now, projectPath: destinationPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath: destinationPath,
      title: newSession.title,
      firstPrompt: referencePrompt,
      initialPrompt: referencePrompt,
      terminalId: tempId,
    });

    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Navigate to the destination folder
    if (destinationPath !== scopePath) {
      setScopePath(destinationPath);
    }
  };

  // Ralph Wiggum loop handlers
  const handleRalphInboxItem = (item: { id: string; prompt: string }) => {
    setRalphSeedPrompt(item.prompt);
    setPendingRalphItemId(item.id);
    setIsRalphModalOpen(true);
  };

  const handleRalphStartPrdRefinement = async (seedPrompt: string) => {
    // Generate the PRD refinement prompt
    const prdPrompt = generatePrdPrompt(seedPrompt);

    // Create a temporary session for PRD refinement
    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const projectPath = scopePath || "/";
    const newSession: Session = {
      id: tempId,
      title: `PRD: ${seedPrompt.slice(0, 40)}${seedPrompt.length > 40 ? "..." : ""}`,
      firstPrompt: prdPrompt,
      lastPrompt: prdPrompt,
      lastMessage: prdPrompt,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: prdPrompt,
      terminalId: tempId,
      slug: null,
      slugs: [],
      gitBranch: null,
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath,
      title: newSession.title,
      firstPrompt: prdPrompt,
      initialPrompt: prdPrompt,
      terminalId: tempId,
    });

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting a session
    if (pendingRalphItemId) {
      await deleteItem(pendingRalphItemId);
      setPendingRalphItemId(null);
    }
  };

  const handleRalphStartLoop = async (config: RalphConfig) => {
    // Generate the Ralph loop command
    const ralphCommand = generateRalphCommand(config);

    // Create a temporary session that will run the Ralph loop
    const now = Date.now();
    const tempId = `new-${now}`;
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const projectPath = scopePath || "/";
    const newSession: Session = {
      id: tempId,
      title: `Ralph: ${config.prompt.slice(0, 35)}${config.prompt.length > 35 ? "..." : ""}`,
      firstPrompt: ralphCommand,
      lastPrompt: ralphCommand,
      lastMessage: ralphCommand,
      project: projectName,
      projectPath,
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: ralphCommand,
      terminalId: tempId,
      slug: null,
      slugs: [],
      gitBranch: null,
      // Mark as Ralph loop session
      ralphLoop: {
        active: true,
        currentIteration: 0,
        maxIterations: config.maxIterations,
        completionPromise: config.completionPromise,
        startedAt: new Date().toISOString(),
      },
    };

    // Track temp session for matching with real session later
    tempSessionInfo.current[tempId] = { createdAt: now, projectPath };

    // Register in Hilt session registry
    registerSession({
      id: tempId,
      projectPath,
      title: newSession.title,
      firstPrompt: ralphCommand,
      initialPrompt: ralphCommand,
      terminalId: tempId,
    });

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting a session
    if (pendingRalphItemId) {
      await deleteItem(pendingRalphItemId);
      setPendingRalphItemId(null);
    }
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

  // Don't render until viewMode preference is loaded to prevent flash
  if (!isHydrated) {
    return <div className="flex flex-col h-dvh bg-[var(--bg-primary)]" />;
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-primary)]">
      {/* Top Toolbar */}
      <div
        data-statusbar
        className="relative flex items-center px-4 h-11 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: session controls, search, theme, terminal */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {getPrimaryView(viewMode) === "sessions" && (
            <TaskViewModeToggle view={viewMode} onChange={setViewMode} />
          )}
          {getPrimaryView(viewMode) === "sessions" && (
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`p-1.5 rounded transition-colors ${
                  hasActiveFilters
                    ? "text-[var(--interactive-default)] bg-[var(--status-todo-bg)] hover:bg-[var(--status-todo-bg)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                }`}
                title="Filters"
              >
                <Filter className="w-4 h-4" />
              </button>
              {isFilterOpen && (
                <div className="absolute left-0 top-full mt-1 w-48 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl z-50 py-1">
                  <button
                    onClick={() => {
                      setFilters(prev => ({ ...prev, hasPlan: !prev.hasPlan }));
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <FileText className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="flex-1">Plans</span>
                    {filters.hasPlan && <Check className="w-4 h-4 text-[var(--interactive-default)]" />}
                  </button>
                  <button
                    onClick={() => setShowArchived(!showArchived)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <Archive className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="flex-1">Archived</span>
                    {counts.archived > 0 && (
                      <span className="text-xs text-[var(--text-tertiary)]">{counts.archived}</span>
                    )}
                    {showArchived && <Check className="w-4 h-4 text-[var(--interactive-default)]" />}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Search */}
          {searchQuery ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={(e) => {
                  if (!e.target.value) setSearchQuery("");
                }}
                autoFocus
                className="w-40 pl-8 pr-7 py-1.5 text-sm bg-[var(--bg-tertiary)] rounded text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
              />
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchQuery(" ")}
              className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              title="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Terminal Drawer Toggle */}
          {openSessions.length > 0 && (
            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isDrawerOpen
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title={isDrawerOpen ? 'Hide terminal drawer' : 'Show terminal drawer'}
            >
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>{openSessions.length}</span>
            </button>
          )}
        </div>

        {/* Center: View toggle (absolute center) */}
        <div className="absolute left-1/2 -translate-x-1/2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ViewToggle view={viewMode} onChange={setViewMode} />
        </div>

        {/* Right: QuickAdd */}
        <div className="flex items-center ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <QuickAddButton onClick={() => setIsQuickAddOpen(true)} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content column */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {/* Conditional View: Bridge, Docs, Tree, Stack, or Board */}
        {viewMode === "bridge" ? (
          <BridgeView onNavigateToProject={(project, vaultPath) => {
            setScopePath(vaultPath);
            setDocsInitialFile(project.path + "/index.md");
            setViewMode("docs");
          }} />
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
        ) : viewMode === "tree" ? (
          <div
            className="flex-1 flex flex-col p-4 transition-[padding] duration-300"
            style={{ paddingRight: isDrawerOpen ? `${drawerWidth + 16}px` : undefined }}
          >
            <TreeView
              tree={tree}
              scopePath={scopePath}
              onNavigate={setScopePath}
              onOpenSession={handleOpenSession}
              isLoading={isTreeLoading}
              searchQuery={searchQuery}
              filters={filters}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
              onArchiveSession={handleArchiveSession}
              onUnarchiveSession={showArchived ? handleUnarchiveSession : undefined}
              selectedSessionIds={selectedIds}
            />
          </div>
        ) : (
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
              {COLUMNS.map((columnId) => {
                const filteredSessions = getSessionsByColumn(columnId);
                // Use filtered count when filters are active, otherwise use API count
                // "attention" column doesn't have API count, always use filtered
                const displayCount = columnId === "attention" || hasActiveFilters
                  ? filteredSessions.length
                  : counts[columnId as SessionStatus];
                return (
                <Column
                  key={columnId}
                  columnId={columnId}
                  sessions={filteredSessions}
                  totalCount={displayCount}
                  isLoading={isLoading}
                  locked={columnId === "attention"}
                  inboxItems={columnId === "inbox" ? filteredInboxItems : undefined}
                  todoSections={columnId === "inbox" ? todoSections : undefined}
                  scopePath={scopePath}
                  onReorderSections={columnId === "inbox" ? reorderSections : undefined}
                  onReorderItem={columnId === "inbox" ? reorderItem : undefined}
                  onOpenSession={handleOpenSession}
                  onOpenPlan={handleOpenPlan}
                  onDeleteSession={handleDeleteSession}
                  onToggleStarred={toggleStarred}
                  onArchiveSession={columnId === "recent" ? handleArchiveSession : undefined}
                  onUnarchiveSession={columnId === "recent" && showArchived ? handleUnarchiveSession : undefined}
                  onCreateInboxItem={columnId === "inbox" ? handleCreateInboxItem : undefined}
                  onCreateAndRunInboxItem={columnId === "inbox" ? handleCreateAndRunInboxItem : undefined}
                  onUpdateInboxItem={handleUpdateInboxItem}
                  onDeleteInboxItem={handleDeleteInboxItem}
                  onStartInboxItem={handleStartInboxItem}
                  onRefineInboxItem={handleRefineInboxItem}
                  onProcessReference={handleProcessReference}
                  onRalphInboxItem={handleRalphInboxItem}
                  sessionStatuses={sessionStatuses}
                  firstSeenAt={firstSeenAt}
                  selectedIds={selectedIds}
                  onSelectSession={handleSelectSession}
                  onSelectInboxItem={handleSelectInboxItem}
                  onBackgroundClick={() => isDrawerOpen && setIsDrawerOpen(false)}
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
        )}

        {/* Bottom toolbar — scope controls (hidden on Bridge view) */}
        {getPrimaryView(viewMode) !== "bridge" && (
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
        </div>{/* end main content column */}

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
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--status-todo-bg)] border-t border-[var(--status-todo-border)]">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--interactive-default)]">
              {selectedIds.size} selected
            </span>
            <button
              onClick={clearSelection}
              className="p-1 text-[var(--interactive-default)] hover:text-[var(--interactive-hover)] hover:bg-[var(--status-todo-bg)] rounded transition-colors"
              title="Clear selection (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--interactive-default)] mr-2">Move to:</span>
            {/* Only show moveable columns (not attention which is auto-populated) */}
            {(["inbox", "active", "recent"] as const).map((status) => (
              <button
                key={status}
                onClick={() => moveSelectedTo(status)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] text-[var(--text-primary)] rounded transition-colors"
              >
                {COLUMN_CONFIG[status].icon}
                <span>{COLUMN_CONFIG[status].label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ralph Wiggum Setup Modal */}
      <RalphSetupModal
        isOpen={isRalphModalOpen}
        onClose={() => {
          setIsRalphModalOpen(false);
          setPendingRalphItemId(null);
        }}
        seedPrompt={ralphSeedPrompt}
        onStartLoop={handleRalphStartLoop}
        onStartPrdRefinement={handleRalphStartPrdRefinement}
      />

      {/* QuickAdd Modal */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        inboxPath={inboxPath}
        pinnedFolders={pinnedFolders.folders}
        onSetInboxPath={setInboxPath}
        onSave={handleQuickAddSave}
        onSaveAndRun={handleQuickAddRun}
        onRefine={handleQuickAddRefine}
        onProcessReference={handleQuickAddReference}
      />
    </div>
  );
}
