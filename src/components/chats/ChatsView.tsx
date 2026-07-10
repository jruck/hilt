"use client";

// Top-level Chats view — ONE surface for every conversation in the system (Justin: chats
// "shouldn't be buried in the systems tab"; the accepted design unifies rather than
// relocates). Thread rows (feedback threads anchored to objects) render as the System
// Threads index rows did; free-chat rows render as the System Chats rows did; the merge,
// lens partition, and thread-attachment de-dupe live in ./conversations.ts.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import useSWR from "swr";
import {
  Archive,
  BookOpen,
  CalendarClock,
  FileText,
  Mail,
  MailOpen,
  MessageSquare,
  MessagesSquare,
  MoreVertical,
  Newspaper,
  Pencil,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  Sparkles,
  SquareCheck,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import {
  SECONDARY_CHROME_BODY_GUTTER_CLASS,
  SecondaryIconButton,
  SecondarySegmentedButton,
  SecondarySegmentedControl,
  SecondaryToolbar,
} from "@/components/layout/SecondaryToolbar";
import { ThreadDrawer } from "@/components/threads/ThreadDrawer";
import {
  resolutionStory,
  resolvedAt,
  resolvedRecently,
  targetIcon,
  targetLabel,
} from "@/components/threads/threadTargetHelpers";
import { useScope } from "@/contexts/ScopeContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { THREAD_SUMMARIES_KEY } from "@/hooks/useThreadCounts";
import { withBasePath } from "@/lib/base-path";
import type { ChatContextKind, ChatSessionSummary } from "@/lib/chat/types";
import type { CommentTarget } from "@/lib/comments/types";
import { runProcessAll, runThreadProcess, type ProcessAllProgress } from "@/lib/threads/process-client";
import type { ThreadSummary } from "@/lib/threads/types";
import {
  conversationKindCounts,
  mergeConversations,
  type ChatsLens,
  type ConversationKindFilter,
  type ConversationRow,
} from "./conversations";

interface ChatsViewProps {
  scopePath?: string;
  workingFolder?: string;
}

type Selection =
  | { type: "thread"; threadId: string; target: CommentTarget }
  | { type: "chat"; chatId: string };

type SessionPatch = { archivedAt?: number | null; unreadCount?: number; title?: string };

const SPLIT_STORAGE_KEY = "hilt-chats-split";
const DEFAULT_SPLIT = 0.38;
const MIN_SPLIT = 0.28;
const MAX_SPLIT = 0.72;

const LENS_OPTIONS: Array<{ id: ChatsLens; label: string }> = [
  { id: "needs-you", label: "Needs you" },
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
];

const CONTEXT_KIND_OPTIONS: Array<{ kind: ChatContextKind; label: string; icon: LucideIcon }> = [
  { kind: "library", label: "Library", icon: BookOpen },
  { kind: "doc", label: "Docs", icon: FileText },
  { kind: "person", label: "People", icon: User },
  { kind: "task", label: "Tasks", icon: SquareCheck },
  { kind: "meeting", label: "Meetings", icon: CalendarClock },
  { kind: "loop-item", label: "Loops", icon: Repeat },
  { kind: "briefing-line", label: "Briefings", icon: Newspaper },
  { kind: "none", label: "Other", icon: MessageSquare },
];

const CONTEXT_ICONS: Record<ChatContextKind, LucideIcon> = {
  library: BookOpen,
  doc: FileText,
  person: User,
  task: SquareCheck,
  meeting: CalendarClock,
  "loop-item": Repeat,
  "briefing-line": Newspaper,
  none: MessageSquare,
};

async function fetchThreads(url: string): Promise<{ threads: ThreadSummary[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ threads: ThreadSummary[] }>;
}

async function fetchChatSessions(url: string): Promise<{ sessions: ChatSessionSummary[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ sessions: ChatSessionSummary[] }>;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function clampSplit(value: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

function loadStoredSplit(): number {
  if (typeof window === "undefined") return DEFAULT_SPLIT;
  const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY);
  if (!raw) return DEFAULT_SPLIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SPLIT;
  return clampSplit(parsed);
}

function formatSessionAge(timestamp: number): string {
  if (!timestamp) return "New";
  const deltaMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return "Now";
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)}m`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h`;
  return `${Math.floor(deltaMs / day)}d`;
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unknown";
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) return `${Math.round(diff / minute)}m ago`;
  if (abs < hour * 24) return `${Math.round(diff / hour)}h ago`;
  return `${Math.round(diff / day)}d ago`;
}

export function ChatsView({ scopePath = "", workingFolder = "" }: ChatsViewProps) {
  const isMobile = useIsMobile();
  const { navigateTo } = useScope();
  const [lensChoice, setLensChoice] = useState<ChatsLens | null>(null);
  const [filter, setFilter] = useState<ConversationKindFilter>("all");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<ProcessAllProgress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [split, setSplit] = useState(() => loadStoredSplit());
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitAreaRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef(split);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const lastAppliedScopeIdRef = useRef<string | null>(null);
  const suppressAutoReadIdRef = useRef<string | null>(null);

  const {
    data: threadsData,
    error: threadsError,
    isValidating: threadsValidating,
    mutate: mutateThreads,
  } = useSWR<{ threads: ThreadSummary[] }, Error>(THREAD_SUMMARIES_KEY, fetchThreads, {
    keepPreviousData: true,
    refreshInterval: 15_000,
  });
  const {
    data: sessionsData,
    error: sessionsError,
    isValidating: sessionsValidating,
    mutate: mutateSessions,
  } = useSWR<{ sessions: ChatSessionSummary[] }, Error>("/api/chat/sessions", fetchChatSessions, {
    keepPreviousData: true,
    refreshInterval: 15_000,
  });

  const threads = useMemo(() => threadsData?.threads ?? [], [threadsData]);
  const sessions = useMemo(() => sessionsData?.sessions ?? [], [sessionsData]);
  const bothLoaded = Boolean(threadsData) && Boolean(sessionsData);

  const needsYouRows = useMemo(() => mergeConversations(threads, sessions, "needs-you"), [threads, sessions]);
  // Default lens: Needs you when non-empty, else All — auto-derived until the user picks.
  const lens: ChatsLens = lensChoice ?? (!bothLoaded || needsYouRows.length > 0 ? "needs-you" : "all");

  const lensRows = useMemo(() => mergeConversations(threads, sessions, lens), [threads, sessions, lens]);
  const rows = useMemo(
    () => (filter === "all" ? lensRows : mergeConversations(threads, sessions, lens, filter)),
    [filter, lens, lensRows, threads, sessions],
  );

  const kindCounts = useMemo(() => conversationKindCounts(lensRows), [lensRows]);
  const kindTabs = useMemo(
    () => CONTEXT_KIND_OPTIONS.filter((option) => (kindCounts.get(option.kind) ?? 0) > 0),
    [kindCounts],
  );

  const openThreadCount = useMemo(
    () => threads.reduce((count, thread) => count + (thread.status === "open" ? 1 : 0), 0),
    [threads],
  );

  const sendingChatIds = useMemo(() => {
    const set = new Set<string>();
    for (const session of sessions) {
      if (session.status === "sending") set.add(session.id);
    }
    return set;
  }, [sessions]);

  const selectedSession = useMemo(
    () => (selected?.type === "chat" ? sessions.find((session) => session.id === selected.chatId) ?? null : null),
    [selected, sessions],
  );

  // Deep link: /chats/<id> — the id may be a thread id or a chat id. Threads win ties, so a
  // chat match is only trusted after the thread store has answered.
  useEffect(() => {
    const scopeId = scopePath?.split("/").filter(Boolean)[0] ?? null;
    if (!scopeId || scopeId === lastAppliedScopeIdRef.current) return;
    const thread = threads.find((candidate) => candidate.id === scopeId);
    if (thread) {
      lastAppliedScopeIdRef.current = scopeId;
      setSelected({ type: "thread", threadId: thread.id, target: thread.target });
      return;
    }
    if (!threadsData) return;
    const session = sessions.find((candidate) => candidate.id === scopeId);
    if (session) {
      lastAppliedScopeIdRef.current = scopeId;
      setSelected({ type: "chat", chatId: scopeId });
      return;
    }
    // Both stores answered and neither knows the id — stop probing.
    if (sessionsData) lastAppliedScopeIdRef.current = scopeId;
  }, [scopePath, threads, sessions, threadsData, sessionsData]);

  const patchSession = useCallback(async (id: string, patch: SessionPatch) => {
    setActionError(null);
    try {
      const response = await fetch(withBasePath(`/api/chat/sessions/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed: ${response.status}`);
      }
      void mutateSessions();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Chat action failed");
    }
  }, [mutateSessions]);

  const selectedChatId = selected?.type === "chat" ? selected.chatId : null;

  useEffect(() => {
    if (suppressAutoReadIdRef.current !== selectedChatId) {
      suppressAutoReadIdRef.current = null;
    }
  }, [selectedChatId]);

  useEffect(() => {
    if (!selectedChatId || !selectedSession || selectedSession.unreadCount <= 0) return;
    if (suppressAutoReadIdRef.current === selectedChatId) return;
    void patchSession(selectedChatId, { unreadCount: 0 });
  }, [patchSession, selectedChatId, selectedSession]);

  const handleSelectChat = useCallback((id: string) => {
    const wasSuppressed = suppressAutoReadIdRef.current === id;
    if (wasSuppressed) suppressAutoReadIdRef.current = null;
    setSelected({ type: "chat", chatId: id });
    if (wasSuppressed && selectedChatId === id) {
      void patchSession(id, { unreadCount: 0 });
    }
  }, [patchSession, selectedChatId]);

  const markRead = useCallback((id: string) => {
    if (suppressAutoReadIdRef.current === id) suppressAutoReadIdRef.current = null;
    void patchSession(id, { unreadCount: 0 });
  }, [patchSession]);

  const markUnread = useCallback((id: string) => {
    suppressAutoReadIdRef.current = id;
    void patchSession(id, { unreadCount: 1 });
  }, [patchSession]);

  const archive = useCallback((id: string) => {
    void patchSession(id, { archivedAt: Date.now() });
  }, [patchSession]);

  const unarchive = useCallback((id: string) => {
    void patchSession(id, { archivedAt: null });
  }, [patchSession]);

  const rename = useCallback((id: string, title: string) => {
    void patchSession(id, { title });
  }, [patchSession]);

  const refresh = useCallback(() => {
    setActionError(null);
    void mutateThreads();
    void mutateSessions();
  }, [mutateSessions, mutateThreads]);

  const handleOpenFile = useCallback((relPath: string) => {
    // filesTouched are vault-relative, but outside-vault edits stay absolute (message route) —
    // pass those through untouched instead of double-joining onto workingFolder.
    if (relPath.startsWith("/")) {
      navigateTo("docs", relPath);
      return;
    }
    if (!workingFolder) return;
    navigateTo("docs", `${workingFolder}/${relPath}`);
  }, [navigateTo, workingFolder]);

  // Loft parity (AIEditWorkspace handleSend): sending a message in a manually-marked-unread chat
  // is explicit engagement — clear the suppression and mark it read, otherwise the server-side
  // unread bump on turn completion leaves a growing badge on the chat the user is typing in.
  const handleSendStart = useCallback(() => {
    if (!selectedChatId || suppressAutoReadIdRef.current !== selectedChatId) return;
    suppressAutoReadIdRef.current = null;
    void patchSession(selectedChatId, { unreadCount: 0 });
  }, [patchSession, selectedChatId]);

  async function processAllOpenThreads() {
    if (batchRunning) {
      batchAbortControllerRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    batchAbortControllerRef.current = controller;
    setBatchRunning(true);
    setBatchProgress({ index: 0, total: openThreadCount });
    setBatchError(null);
    try {
      await runProcessAll(setBatchProgress, controller.signal);
      await mutateThreads();
    } catch (err) {
      if (isAbortError(err)) {
        setBatchError(null);
        await mutateThreads();
      } else {
        setBatchError(err instanceof Error ? err.message : "Thread batch processing failed");
      }
    } finally {
      if (batchAbortControllerRef.current === controller) batchAbortControllerRef.current = null;
      setBatchRunning(false);
      setBatchProgress(null);
    }
  }

  async function processThread(threadId: string) {
    if (processingId) return;
    setProcessingId(threadId);
    setErrorById((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    try {
      await runThreadProcess(threadId);
      await mutateThreads();
    } catch (err) {
      setErrorById((current) => ({
        ...current,
        [threadId]: err instanceof Error ? err.message : "Thread processing failed",
      }));
    } finally {
      setProcessingId(null);
    }
  }

  const handleSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const splitArea = splitAreaRef.current;
    if (!splitArea) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingSplit(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rect = splitArea.getBoundingClientRect();
      if (rect.width <= 0) return;
      const nextSplit = clampSplit((moveEvent.clientX - rect.left) / rect.width);
      splitRef.current = nextSplit;
      setSplit(nextSplit);
    };

    const handlePointerUp = () => {
      setIsResizingSplit(false);
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(splitRef.current));
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  const emptyLabel = !bothLoaded
    ? "Loading conversations"
    : lens === "needs-you"
      ? "Nothing needs you"
      : lens === "done"
        ? "Nothing done yet"
        : "No conversations yet";

  const listPane = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-default)] px-3 py-1.5">
        <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterTab>
        {kindTabs.map((tab) => (
          <FilterTab key={tab.kind} active={filter === tab.kind} onClick={() => setFilter(tab.kind)}>
            <span>{tab.label}</span>
            <span className="text-[var(--text-quaternary)]">{kindCounts.get(tab.kind) ?? 0}</span>
          </FilterTab>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--text-tertiary)]">
            <MessagesSquare className="h-6 w-6" />
            <span>{emptyLabel}</span>
          </div>
        ) : (
          rows.map((row) =>
            row.type === "thread" ? (
              <ThreadRow
                key={`thread-${row.thread.id}`}
                thread={row.thread}
                selected={selected?.type === "thread" && selected.threadId === row.thread.id}
                working={
                  processingId === row.thread.id
                  || batchProgress?.threadId === row.thread.id
                  || Boolean(row.thread.chat_ids?.some((chatId) => sendingChatIds.has(chatId)))
                }
                processDisabled={Boolean(processingId) || batchRunning}
                error={errorById[row.thread.id] ?? null}
                onSelect={() => setSelected({ type: "thread", threadId: row.thread.id, target: row.thread.target })}
                onProcess={() => void processThread(row.thread.id)}
              />
            ) : (
              <ChatSessionRow
                key={`chat-${row.session.id}`}
                session={row.session}
                selectedId={selectedChatId}
                onSelect={handleSelectChat}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onArchive={archive}
                onUnarchive={unarchive}
                onRename={rename}
              />
            ),
          )
        )}
      </div>
    </div>
  );

  const detailPane = selected?.type === "thread" ? (
    // Keyed per thread: switching rows remounts the drawer, so an in-flight process
    // stream aborts (unmount cleanup) instead of bleeding into another thread.
    <ThreadDrawer
      key={selected.threadId}
      threadId={selected.threadId}
      target={selected.target}
      onClose={() => setSelected(null)}
      onProcessingChange={(active) => setProcessingId(active ? selected.threadId : null)}
      onFollowThread={(id) => setSelected({ type: "thread", threadId: id, target: selected.target })}
    />
  ) : selected?.type === "chat" ? (
    <ChatPanel
      key={selected.chatId}
      chatId={selected.chatId}
      autoMarkRead={false}
      onClose={() => setSelected(null)}
      onSendStart={handleSendStart}
      onTurnEnd={() => void mutateSessions()}
      onOpenFile={handleOpenFile}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <SecondaryToolbar
        left={
          <SecondarySegmentedControl>
            {LENS_OPTIONS.map((option) => (
              <SecondarySegmentedButton
                key={option.id}
                active={lens === option.id}
                onClick={() => setLensChoice(option.id)}
              >
                {option.label}
              </SecondarySegmentedButton>
            ))}
          </SecondarySegmentedControl>
        }
        right={
          <>
            <div className="hidden items-center gap-1.5 text-xs text-[var(--text-tertiary)] md:flex">
              <span>{needsYouRows.length} need you</span>
              <span className="text-[var(--text-quaternary)]">·</span>
              <span>{mergeConversations(threads, sessions, "all").length} total</span>
            </div>
            {openThreadCount > 0 || batchRunning ? (
              <>
                {batchRunning ? (
                  <span className="hidden text-xs font-medium text-emerald-600 sm:inline">
                    Processing {batchProgress?.index ?? 0}/{batchProgress?.total ?? openThreadCount}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void processAllOpenThreads()}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${
                    batchRunning
                      ? "text-red-500 hover:text-red-600"
                      : batchError
                        ? "text-red-500"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {batchRunning ? <X className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span>{batchRunning ? "Cancel" : "Process all"}</span>
                </button>
              </>
            ) : null}
            <SecondaryIconButton
              onClick={refresh}
              disabled={threadsValidating || sessionsValidating}
              title="Refresh conversations"
              aria-label="Refresh conversations"
            >
              <RefreshCw className={`h-4 w-4 ${threadsValidating || sessionsValidating ? "animate-spin" : ""}`} />
            </SecondaryIconButton>
          </>
        }
      />
      {batchError ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {batchError}
        </div>
      ) : null}
      {actionError ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {actionError}
        </div>
      ) : null}
      {threadsError ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {threadsError.message}
        </div>
      ) : null}
      {sessionsError ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {sessionsError.message}
        </div>
      ) : null}

      {isMobile ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div data-mobile-scroll-chrome="bottom" className={`hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 h-full min-w-0 overflow-hidden px-4 pb-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))]">
              {listPane}
            </div>
          </div>
          {detailPane ? (
            <div className="absolute inset-0 z-10 bg-[var(--content-surface,var(--bg-primary))]">
              {detailPane}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          ref={splitAreaRef}
          style={{ gridTemplateColumns: `minmax(280px, ${split}fr) 1px minmax(320px, ${1 - split}fr)` }}
          className={`grid min-h-0 flex-1 overflow-hidden px-4 pb-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS} ${isResizingSplit ? "select-none" : ""}`}
        >
          <div className="min-h-0 min-w-0 flex flex-col overflow-hidden border-y border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))]">
            {listPane}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={handleSplitPointerDown}
            className="relative cursor-col-resize bg-[var(--border-default)] transition-colors hover:bg-[var(--border-strong)]"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
          <div className="min-h-0 min-w-0 flex flex-col overflow-hidden border-y border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))]">
            {detailPane ?? <EmptyDetailPane />}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function ThreadRow({
  thread,
  selected,
  working,
  processDisabled,
  error,
  onSelect,
  onProcess,
}: {
  thread: ThreadSummary;
  selected: boolean;
  working: boolean;
  processDisabled: boolean;
  error: string | null;
  onSelect: () => void;
  onProcess: () => void;
}) {
  const Icon = targetIcon(thread.target);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        className={`group flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2 transition-colors ${
          selected
            ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
            : "border-transparent hover:bg-[var(--bg-secondary)]"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[var(--text-primary)]">{targetLabel(thread.target)}</div>
          {thread.last_message_snippet ? (
            <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{thread.last_message_snippet}</div>
          ) : null}
        </div>
        {thread.dev_item ? (
          <span
            className="hidden shrink-0 items-center rounded border border-amber-500/20 bg-amber-500/5 px-1.5 text-[11px] leading-5 text-amber-600 md:inline-flex"
            title={`Diagnosed ${thread.dev_item.diagnosed_at}`}
          >
            Dev item
          </span>
        ) : null}
        <ThreadStatus thread={thread} working={working} />
        <div className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-quaternary)]">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{thread.message_count}</span>
        </div>
        <time
          className="hidden shrink-0 text-xs text-[var(--text-quaternary)] sm:inline"
          dateTime={thread.updated_at}
          title={thread.updated_at}
        >
          {relativeTime(thread.updated_at)}
        </time>
        {thread.status === "open" && !working ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onProcess();
            }}
            disabled={processDisabled}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium opacity-0 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-within:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-0"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Process</span>
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="pb-2 pl-10 pr-3 text-xs text-red-500">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ThreadStatus({ thread, working }: { thread: ThreadSummary; working: boolean }) {
  if (working) {
    return (
      <div className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-600 md:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Processing</span>
      </div>
    );
  }

  return (
    <div className="hidden shrink-0 items-center gap-1.5 text-xs text-[var(--text-tertiary)] md:flex">
      {thread.status === "open" ? (
        <span>Open</span>
      ) : (
        <>
          {/* House unread idiom (ViewToggle/Library blue dot): resolved in the last 24h =
              news you likely haven't seen — "the loop handled this overnight". */}
          {resolvedRecently(thread) ? (
            <span
              className="h-1.5 w-1.5 rounded-full bg-blue-500"
              title="Resolved in the last 24 hours"
            />
          ) : null}
          <span className="text-[var(--text-quaternary)]" title={resolvedAt(thread)}>
            {resolutionStory(thread)}
          </span>
        </>
      )}
    </div>
  );
}

interface ChatRowActions {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function ChatSessionRow({
  session,
  selectedId,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onUnarchive,
  onRename,
}: {
  session: ChatSessionSummary;
} & ChatRowActions) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const selected = selectedId === session.id;
  const title = session.title || "New chat";
  const contextLabel = session.contextLabel.trim();
  const preview = session.status === "sending" ? "Claude is working" : (session.lastMessageSnippet || "No messages yet");
  const KindIcon = CONTEXT_ICONS[session.context.kind] ?? MessageSquare;

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      setIsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.select();
  }, [isRenaming]);

  const commitRename = useCallback(() => {
    const nextTitle = renameInputRef.current?.value.trim() ?? "";
    setIsRenaming(false);
    if (nextTitle && nextTitle !== title) {
      onRename(session.id, nextTitle);
    }
  }, [onRename, session.id, title]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(session.id);
        }
      }}
      className={`group relative flex cursor-pointer items-start gap-3 border-l-2 px-3 py-2 transition-colors ${
        selected
          ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
          : "border-transparent hover:bg-[var(--bg-secondary)]"
      }`}
    >
      <KindIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            autoFocus
            defaultValue={title}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setIsRenaming(false);
              }
            }}
            className="w-full border-b border-[var(--border-strong)] bg-transparent text-[13px] text-[var(--text-primary)] focus:outline-none"
          />
        ) : (
          <div className={`flex min-w-0 items-center text-[13px] text-[var(--text-primary)] ${session.unreadCount > 0 ? "font-medium" : ""}`}>
            <span className="truncate">{title}</span>
            {session.unreadCount > 0 ? (
              <span className="ml-1.5 inline-flex shrink-0 items-center rounded bg-blue-500/15 px-1 text-[10px] font-semibold leading-4 text-blue-500">
                {session.unreadCount > 9 ? "9+" : String(session.unreadCount)}
              </span>
            ) : null}
          </div>
        )}
        {contextLabel ? (
          <div className="truncate text-[11px] text-[var(--text-tertiary)]">{contextLabel}</div>
        ) : null}
        <div className={`truncate text-xs ${session.status === "sending" ? "text-emerald-600" : "text-[var(--text-quaternary)]"}`}>
          {preview}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] text-[var(--text-quaternary)]">{formatSessionAge(session.updatedAt)}</span>
        <ChatRowStatus session={session} />
        <button
          ref={menuTriggerRef}
          type="button"
          title="Chat actions"
          aria-label="Chat actions"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setIsMenuOpen((open) => !open);
          }}
          className={`inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--text-primary)] focus:opacity-100 group-hover:opacity-100 ${isMenuOpen ? "opacity-100" : ""}`}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      {isMenuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-2 top-8 z-20 w-44 rounded-md border border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))] py-1 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <MenuItem
            icon={session.unreadCount > 0 ? MailOpen : Mail}
            onClick={() => {
              setIsMenuOpen(false);
              if (session.unreadCount > 0) onMarkRead(session.id);
              else onMarkUnread(session.id);
            }}
          >
            {session.unreadCount > 0 ? "Mark read" : "Mark unread"}
          </MenuItem>
          <MenuItem
            icon={Pencil}
            onClick={() => {
              setIsMenuOpen(false);
              setIsRenaming(true);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={session.archivedAt ? RotateCcw : Archive}
            onClick={() => {
              setIsMenuOpen(false);
              if (session.archivedAt) onUnarchive(session.id);
              else onArchive(session.id);
            }}
          >
            {session.archivedAt ? "Unarchive" : "Archive"}
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{children}</span>
    </button>
  );
}

function ChatRowStatus({ session }: { session: ChatSessionSummary }) {
  if (session.status === "sending") {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Running
      </span>
    );
  }

  if (session.unreadCount > 0) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-blue-500">
        <Mail className="h-3 w-3" />
        Unread
      </span>
    );
  }

  if (session.archivedAt) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-[var(--text-quaternary)]">
        <Archive className="h-3 w-3" />
        Archived
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
      Open
    </span>
  );
}

function EmptyDetailPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--text-tertiary)]">
      <MessagesSquare className="h-7 w-7" />
      <span>Select a conversation</span>
    </div>
  );
}
