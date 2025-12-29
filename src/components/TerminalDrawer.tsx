"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { Session } from "@/lib/types";
import { X, Terminal as TerminalIcon, Copy, Check, Info, Folder, GitBranch, MessageSquare, Clock } from "lucide-react";

// Dynamic import to avoid SSR issues with xterm.js
const Terminal = dynamic(() => import("./Terminal").then((mod) => mod.Terminal), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-500">
      Loading terminal...
    </div>
  ),
});

interface TerminalDrawerProps {
  isOpen: boolean;
  sessions: Session[];
  activeSession: Session | null;
  onClose: () => void;
  onSelectSession: (session: Session) => void;
  onCloseSession: (sessionId: string) => void;
  onStatusUpdate?: (sessionId: string, status: string) => void;
}

type ViewMode = "terminal" | "info";

export function TerminalDrawer({
  isOpen,
  sessions,
  activeSession,
  onClose,
  onSelectSession,
  onCloseSession,
  onStatusUpdate,
}: TerminalDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [terminalTitle, setTerminalTitle] = useState<string | null>(null);

  const copyCommand = useCallback(async () => {
    if (!activeSession) return;
    const command = `claude --resume ${activeSession.id}`;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeSession]);

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

  // Reset state when session changes
  useEffect(() => {
    setCopied(false);
    setTerminalTitle(null);
  }, [activeSession?.id]);

  if (!isOpen) return null;

  return (
    <div
      className={`
        fixed right-0 top-0 h-full bg-zinc-900 border-l border-zinc-800
        transition-all duration-300 ease-in-out z-50
        ${isOpen ? "w-[700px]" : "w-0"}
        flex flex-col
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">
            {viewMode === "terminal" ? "Terminal" : "Session Details"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex bg-zinc-800 rounded p-0.5">
            <button
              onClick={() => setViewMode("terminal")}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                viewMode === "terminal"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <TerminalIcon className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("info")}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                viewMode === "info"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Info className="w-3 h-3" />
            </button>
          </div>
          <div className="text-xs text-zinc-600">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} open
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {sessions.length > 0 && (
        <div className="flex border-b border-zinc-800 bg-zinc-950 overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`
                flex items-center gap-2 px-3 py-2 text-sm cursor-pointer
                border-r border-zinc-800 min-w-0 max-w-[200px]
                ${
                  activeSession?.id === session.id
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50"
                }
              `}
              onClick={() => onSelectSession(session)}
            >
              <span className="truncate flex-1">{session.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSession(session.id);
                }}
                className="p-0.5 hover:bg-zinc-700 rounded flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Session Status Bar - shown in terminal mode */}
      {activeSession && viewMode === "terminal" && (
        <div className="bg-zinc-950 border-b border-zinc-800 px-3 py-2 space-y-1.5">
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

          {/* Row 3: Metadata (folder, branch, messages, time) */}
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Folder className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{activeSession.project}</span>
            </span>
            {activeSession.gitBranch && (
              <span className="flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                <span className="truncate max-w-[100px]">{activeSession.gitBranch}</span>
              </span>
            )}
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

      {/* Content */}
      <div className="flex-1 bg-[#0a0a0a] overflow-hidden relative">
        {/* Render all terminals but only show the active one - prevents respawning on tab switch */}
        {viewMode === "terminal" && sessions.map((session) => (
          <div
            key={session.id}
            className={`absolute inset-0 ${session.id === activeSession?.id ? 'block' : 'hidden'}`}
          >
            <Terminal
              terminalId={session.id}
              sessionId={session.id}
              projectPath={session.projectPath}
              wsUrl="ws://localhost:3001"
              isNew={session.isNew}
              initialPrompt={session.initialPrompt}
              isActive={session.id === activeSession?.id}
              onExit={() => onCloseSession(session.id)}
              onTitleChange={handleTitleChange}
            />
          </div>
        ))}

        {activeSession && viewMode !== "terminal" && (
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
                  <p className="text-zinc-300">{activeSession.project}</p>
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
                {activeSession.slug && (
                  <div className="space-y-1">
                    <span className="text-zinc-500">Slug</span>
                    <p className="text-amber-500 font-mono text-xs">
                      {activeSession.slug}
                    </p>
                  </div>
                )}
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

        {/* No active session message */}
        {!activeSession && (
          <div className="flex items-center justify-center h-full text-zinc-600">
            Select a session to view details
          </div>
        )}
      </div>
    </div>
  );
}
