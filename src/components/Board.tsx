"use client";

import { useState, useCallback, useEffect } from "react";
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
import { FolderPicker } from "./FolderPicker";
import { Loader2, X, Inbox, Loader2 as InProgressIcon, Bookmark, CheckCircle } from "lucide-react";

const COLUMNS: SessionStatus[] = ["inbox", "active", "inactive", "done"];

const COLUMN_CONFIG: Record<SessionStatus, { label: string; icon: React.ReactNode }> = {
  inbox: { label: "To Do", icon: <Inbox className="w-4 h-4" /> },
  active: { label: "In Progress", icon: <InProgressIcon className="w-4 h-4" /> },
  inactive: { label: "Saved", icon: <Bookmark className="w-4 h-4" /> },
  done: { label: "Done", icon: <CheckCircle className="w-4 h-4" /> },
};

interface InboxItem {
  id: string;
  prompt: string;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

const SCOPE_STORAGE_KEY = "claude-kanban-scope";

// Validate and clean a path (remove multiple consecutive slashes, etc.)
function cleanPath(path: string): string {
  // Replace multiple slashes with single slash
  return path.replace(/\/+/g, '/');
}

export function Board() {
  // Scope path for filtering sessions - initialized from localStorage
  const [scopePath, setScopePath] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(SCOPE_STORAGE_KEY) || "";
      // Clean up any malformed paths from previous bugs
      const cleaned = cleanPath(stored);
      if (cleaned !== stored && cleaned) {
        localStorage.setItem(SCOPE_STORAGE_KEY, cleaned);
      }
      return cleaned;
    }
    return "";
  });
  const [homeDir, setHomeDir] = useState<string>("");

  // Fetch home directory on mount and validate/set scope
  useEffect(() => {
    fetch("/api/folders")
      .then((res) => res.json())
      .then(async (data) => {
        setHomeDir(data.homeDir);

        // Validate current scope path
        if (scopePath && scopePath !== data.homeDir) {
          const validateRes = await fetch(`/api/folders?validate=${encodeURIComponent(scopePath)}`);
          const validateData = await validateRes.json();
          if (!validateData.valid) {
            // Invalid path stored, reset to home directory
            setScopePath(data.homeDir);
            localStorage.setItem(SCOPE_STORAGE_KEY, data.homeDir);
          }
        } else if (!scopePath) {
          // No scope set, default to home directory
          setScopePath(data.homeDir);
        }
      })
      .catch(console.error);
  }, []);

  // Persist scope to localStorage
  const handleScopeChange = useCallback((path: string) => {
    setScopePath(path);
    if (typeof window !== "undefined") {
      localStorage.setItem(SCOPE_STORAGE_KEY, path);
    }
  }, []);

  const { sessions, isLoading, updateStatus } = useSessions(scopePath || undefined);
  const { items: inboxItems, createItem, updateItem, deleteItem } = useInboxItems();

  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [draggingSession, setDraggingSession] = useState<Session | null>(null);
  const [openSessions, setOpenSessions] = useState<Session[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Track terminal status per session (from Claude Code's dynamic title)
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, string>>({});
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else if (isDrawerOpen) {
          setIsDrawerOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, selectedIds.size]);

  const getSessionsByStatus = useCallback(
    (status: SessionStatus) => {
      const realSessions = sessions.filter((s) => s.status === status);

      // Include pending "new" sessions in Active column
      if (status === "active") {
        const newSessions = openSessions.filter(
          (s) => s.isNew && !sessions.find((rs) => rs.id === s.id)
        );
        return [...newSessions, ...realSessions];
      }

      return realSessions;
    },
    [sessions, openSessions]
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

  const handleCloseSession = (sessionId: string) => {
    setOpenSessions((prev) => prev.filter((s) => s.id !== sessionId));

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

    // Mark as saved
    updateStatus(sessionId, "inactive");
  };

  const handleDeleteSession = (session: Session) => {
    // For now, just move to done - could add actual deletion later
    updateStatus(session.id, "done");
  };

  const handleCreateInboxItem = async (prompt: string) => {
    await createItem(prompt);
  };

  const handleCreateAndRunInboxItem = async (prompt: string) => {
    // Create a temporary session directly without saving to inbox
    const tempId = `new-${Date.now()}`;
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const newSession: Session = {
      id: tempId,
      title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
      firstPrompt: prompt,
      project: projectName,
      projectPath: scopePath || "/",
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: prompt,
      slug: null,
      gitBranch: null,
    };

    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);
  };

  const handleUpdateInboxItem = async (id: string, prompt: string) => {
    await updateItem(id, prompt);
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
    const tempId = `new-${Date.now()}`;
    // Use scopePath for new sessions, derive project name from folder
    const projectName = scopePath ? scopePath.split("/").pop() || "New Session" : "New Session";
    const newSession: Session = {
      id: tempId,
      title: item.prompt.slice(0, 50) + (item.prompt.length > 50 ? "..." : ""),
      firstPrompt: item.prompt,
      project: projectName,
      projectPath: scopePath || "/",
      messageCount: 0,
      lastActivity: new Date(),
      status: "active",
      isNew: true,
      initialPrompt: item.prompt,
      slug: null,
      gitBranch: null,
    };

    // Add to open sessions and open the drawer
    setOpenSessions((prev) => [...prev, newSession]);
    setActiveSession(newSession);
    setIsDrawerOpen(true);

    // Delete the inbox item since we're starting it
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      {/* Status Bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="text-xs text-zinc-500">Scope:</span>
        {scopePath && (
          <FolderPicker value={scopePath} onChange={handleScopeChange} />
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Board */}
          <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
            {COLUMNS.map((status) => (
              <Column
                key={status}
                status={status}
                sessions={getSessionsByStatus(status)}
                inboxItems={status === "inbox" ? inboxItems : undefined}
                onOpenSession={handleOpenSession}
                onDeleteSession={handleDeleteSession}
                onCreateInboxItem={status === "inbox" ? handleCreateInboxItem : undefined}
                onCreateAndRunInboxItem={status === "inbox" ? handleCreateAndRunInboxItem : undefined}
                onUpdateInboxItem={handleUpdateInboxItem}
                onDeleteInboxItem={handleDeleteInboxItem}
                onStartInboxItem={handleStartInboxItem}
                sessionStatuses={sessionStatuses}
                selectedIds={selectedIds}
                onSelectSession={handleSelectSession}
                onSelectInboxItem={handleSelectInboxItem}
              />
            ))}
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
          onClose={() => setIsDrawerOpen(false)}
          onSelectSession={setActiveSession}
          onCloseSession={handleCloseSession}
          onStatusUpdate={handleStatusUpdate}
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
