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
import { Session, SessionStatus } from "@/lib/types";
import { useSessions, useInboxItems } from "@/hooks/useSessions";
import { useTreeSessions } from "@/hooks/useTreeSessions";
import { useScope } from "@/contexts/ScopeContext";
import { Column } from "./Column";
import { SessionCard } from "./SessionCard";
import { TerminalDrawer } from "./TerminalDrawer";
import { Sidebar } from "./sidebar";
import { ScopeBreadcrumbs, BrowseButton, RecentScopesButton } from "./scope";
import { ViewToggle, ViewMode } from "./ViewToggle";
import { TreeView } from "./TreeView";
import { usePinnedFolders } from "@/hooks/usePinnedFolders";
import { X, Inbox, Loader2 as InProgressIcon, Clock, Search, Filter, FileText, Check } from "lucide-react";
import * as tauri from "@/lib/tauri";

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

const HOME_DIR_STORAGE_KEY = "claude-kanban-home-dir";
const VIEW_MODE_STORAGE_KEY = "claude-kanban-view-mode";

// Get cached homeDir synchronously to prevent breadcrumb flash
function getCachedHomeDir(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(HOME_DIR_STORAGE_KEY) || "";
}

// Get cached view mode preference
function getCachedViewMode(): ViewMode {
  if (typeof window === "undefined") return "board";
  const cached = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  // Migrate old "kanban" value to "board"
  if (cached === "kanban" || cached === "board") return "board";
  if (cached === "tree") return "tree";
  if (cached === "docs") return "docs";
  return "board";
}

export function Board() {
  // Scope path from context - no more router.push, pure client-side state
  const { scopePath, setScopePath } = useScope();

  // Initialize homeDir from cache to prevent breadcrumb disappearing on navigation
  const [homeDir, setHomeDir] = useState<string>(getCachedHomeDir);
  // View mode: board (columns) or tree (treemap)
  const [viewMode, setViewMode] = useState<ViewMode>(getCachedViewMode);

  // Persist view mode to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    }
  }, [viewMode]);

  // Fetch home directory on mount (if not cached) and validate scope if set
  useEffect(() => {
    // homeDir is already initialized from cache via lazy initializer
    // Only fetch from API if we don't have it
    if (homeDir) {
      // Only validate if scope looks suspicious (not empty and not under cached homeDir)
      if (scopePath && !scopePath.startsWith(homeDir)) {
        tauri.pathExists(scopePath)
          .then((valid) => {
            if (!valid) {
              setScopePath("");
            }
          })
          .catch(console.error);
      }
      return;
    }

    // No cache, need to fetch homeDir from Tauri
    tauri.getHomeDir()
      .then(async (fetchedHomeDir) => {
        setHomeDir(fetchedHomeDir);
        localStorage.setItem(HOME_DIR_STORAGE_KEY, fetchedHomeDir);

        // Validate current scope path if set
        if (scopePath && scopePath !== fetchedHomeDir) {
          const valid = await tauri.pathExists(scopePath);
          if (!valid) {
            setScopePath("");
          }
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { sessions, counts, isLoading, updateStatus, toggleStarred } = useSessions(scopePath || undefined);
  const { items: inboxItems, sections: todoSections, createItem, updateItem, deleteItem, reorderSections, reorderItem } = useInboxItems(scopePath || undefined);
  const { tree, isLoading: isTreeLoading } = useTreeSessions(scopePath);
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
      terminalId: tempId, // Stable terminal ID - won't change when session gets real ID
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
      terminalId: tempId, // Stable terminal ID - won't change when session gets real ID
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

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting a session
    await deleteItem(item.id);
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

  // No longer block render with full-screen spinner - columns show skeleton cards instead
  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      {/* Status Bar - fixed height for drawer alignment */}
      <div
        className="relative flex items-center justify-between px-4 h-11 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left side: Scope controls (breadcrumbs, recent, browse) */}
        <div className="flex items-center gap-1 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
        </div>

        {/* Right side: Filter, Search, View Toggle */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Filter dropdown */}
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
              <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl z-50 py-1">
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
              </div>
            )}
          </div>

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

          {/* View Toggle */}
          <ViewToggle view={viewMode} onChange={setViewMode} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          currentScope={scopePath}
          onScopeChange={setScopePath}
          pinnedFolders={pinnedFolders}
        />

        {/* Conditional View: Docs, Tree, or Board */}
        {viewMode === "docs" ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-2xl text-[var(--text-tertiary)] font-medium">Coming Soon</p>
              <p className="text-sm text-[var(--text-tertiary)] mt-2">Documentation view is under development</p>
            </div>
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
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
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
                  isLoading={isLoading}
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
                  onProcessReference={handleProcessReference}
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
        )}

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
            {COLUMNS.map((status) => (
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

    </div>
  );
}
