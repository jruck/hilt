"use client";

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
  ChevronDown,
  ChevronRight,
  FileText,
  Mail,
  MailOpen,
  MessageSquare,
  MessagesSquare,
  MoreVertical,
  Newspaper,
  Pencil,
  RefreshCw,
  Repeat,
  RotateCcw,
  SquareCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import {
  SECONDARY_CHROME_BODY_GUTTER_CLASS,
  SecondaryIconButton,
  SecondaryToolbar,
} from "@/components/layout/SecondaryToolbar";
import { useScope } from "@/contexts/ScopeContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { withBasePath } from "@/lib/base-path";
import type { ChatContextKind, ChatSessionSummary } from "@/lib/chat/types";

interface ChatsViewProps {
  modeSwitcher: ReactNode;
  scopePath?: string;
  workingFolder?: string;
}

type ChatFilter = "all" | ChatContextKind;
type SessionPatch = { archivedAt?: number | null; unreadCount?: number; title?: string };

const SPLIT_STORAGE_KEY = "hilt-chats-split";
const DEFAULT_SPLIT = 0.38;
const MIN_SPLIT = 0.28;
const MAX_SPLIT = 0.72;
const ARCHIVED_PAGE_SIZE = 20;

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

async function fetchChatSessions(url: string): Promise<{ sessions: ChatSessionSummary[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ sessions: ChatSessionSummary[] }>;
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

function updatedDesc(a: ChatSessionSummary, b: ChatSessionSummary): number {
  return b.updatedAt - a.updatedAt;
}

export function ChatsView({ modeSwitcher, scopePath = "", workingFolder = "" }: ChatsViewProps) {
  const isMobile = useIsMobile();
  const { navigateTo } = useScope();
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => scopePath?.split("/").filter(Boolean)[0] ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [split, setSplit] = useState(() => loadStoredSplit());
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitAreaRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef(split);
  const lastAppliedScopeIdRef = useRef<string | null>(selectedId);
  const suppressAutoReadIdRef = useRef<string | null>(null);

  const { data, error, isLoading, isValidating, mutate } = useSWR<{ sessions: ChatSessionSummary[] }, Error>(
    "/api/chat/sessions",
    fetchChatSessions,
    { keepPreviousData: true, refreshInterval: 15_000 },
  );

  const sessions = data?.sessions ?? [];
  const counts = useMemo(() => {
    let open = 0;
    let archived = 0;
    for (const session of sessions) {
      if (session.archivedAt == null) open += 1;
      else archived += 1;
    }
    return { open, archived };
  }, [sessions]);

  const kindCounts = useMemo(() => {
    const next = new Map<ChatContextKind, number>();
    for (const session of sessions) {
      next.set(session.context.kind, (next.get(session.context.kind) ?? 0) + 1);
    }
    return next;
  }, [sessions]);

  const kindTabs = useMemo(
    () => CONTEXT_KIND_OPTIONS.filter((option) => (kindCounts.get(option.kind) ?? 0) > 0),
    [kindCounts],
  );

  const filteredSessions = useMemo(
    () => filter === "all" ? sessions : sessions.filter((session) => session.context.kind === filter),
    [filter, sessions],
  );

  const groupedSessions = useMemo(() => {
    const sorted = [...filteredSessions].sort(updatedDesc);
    const attention = sorted.filter((session) => session.status === "sending" || session.unreadCount > 0);
    const open = sorted.filter((session) => session.status !== "sending" && session.unreadCount === 0 && session.archivedAt == null);
    const archived = sorted.filter((session) => session.status !== "sending" && session.unreadCount === 0 && session.archivedAt != null);
    return { attention, open, archived };
  }, [filteredSessions]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions],
  );

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
      void mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Chat action failed");
    }
  }, [mutate]);

  useEffect(() => {
    const scopeId = scopePath?.split("/").filter(Boolean)[0] ?? null;
    if (!scopeId || scopeId === lastAppliedScopeIdRef.current) return;
    lastAppliedScopeIdRef.current = scopeId;
    setSelectedId(scopeId);
  }, [scopePath]);

  useEffect(() => {
    if (suppressAutoReadIdRef.current !== selectedId) {
      suppressAutoReadIdRef.current = null;
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !selectedSession || selectedSession.unreadCount <= 0) return;
    if (suppressAutoReadIdRef.current === selectedId) return;
    void patchSession(selectedId, { unreadCount: 0 });
  }, [patchSession, selectedId, selectedSession]);

  const handleSelect = useCallback((id: string) => {
    const wasSuppressed = suppressAutoReadIdRef.current === id;
    if (wasSuppressed) suppressAutoReadIdRef.current = null;
    setSelectedId(id);
    if (wasSuppressed && selectedId === id) {
      void patchSession(id, { unreadCount: 0 });
    }
  }, [patchSession, selectedId]);

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
    void mutate();
  }, [mutate]);

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
    if (!selectedId || suppressAutoReadIdRef.current !== selectedId) return;
    suppressAutoReadIdRef.current = null;
    void patchSession(selectedId, { unreadCount: 0 });
  }, [patchSession, selectedId]);

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

  const listPane = (
    <ChatListPane
      filter={filter}
      kindTabs={kindTabs}
      kindCounts={kindCounts}
      emptyLabel={isLoading && !data ? "Loading chats" : "No chats yet"}
      groupedSessions={groupedSessions}
      selectedId={selectedId}
      onFilterChange={setFilter}
      onSelect={handleSelect}
      onMarkRead={markRead}
      onMarkUnread={markUnread}
      onArchive={archive}
      onUnarchive={unarchive}
      onRename={rename}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <SecondaryToolbar
        left={modeSwitcher}
        right={
          <>
            <div className="hidden items-center gap-1.5 text-xs text-[var(--text-tertiary)] md:flex">
              <span>{counts.open} open</span>
              <span className="text-[var(--text-quaternary)]">·</span>
              <span>{counts.archived} archived</span>
            </div>
            <SecondaryIconButton
              onClick={refresh}
              disabled={isValidating}
              title="Refresh chats"
              aria-label="Refresh chats"
            >
              <RefreshCw className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} />
            </SecondaryIconButton>
          </>
        }
      />
      {actionError ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {actionError}
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {error.message}
        </div>
      ) : null}

      {isMobile ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div data-mobile-scroll-chrome="bottom" className={`hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 h-full min-w-0 overflow-hidden px-4 pb-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))]">
              {listPane}
            </div>
          </div>
          {selectedId ? (
            <div className="absolute inset-0 z-10 bg-[var(--content-surface,var(--bg-primary))]">
              <ChatPanel
                key={selectedId}
                chatId={selectedId}
                autoMarkRead={false}
                onClose={() => setSelectedId(null)}
                onSendStart={handleSendStart}
                onTurnEnd={() => void mutate()}
                onOpenFile={handleOpenFile}
              />
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
            {selectedId ? (
              <ChatPanel
                key={selectedId}
                chatId={selectedId}
                autoMarkRead={false}
                onClose={() => setSelectedId(null)}
                onSendStart={handleSendStart}
                onTurnEnd={() => void mutate()}
                onOpenFile={handleOpenFile}
              />
            ) : (
              <EmptyChatPane />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatListPane({
  filter,
  kindTabs,
  kindCounts,
  emptyLabel,
  groupedSessions,
  selectedId,
  onFilterChange,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onUnarchive,
  onRename,
}: {
  filter: ChatFilter;
  kindTabs: Array<{ kind: ChatContextKind; label: string; icon: LucideIcon }>;
  kindCounts: Map<ChatContextKind, number>;
  emptyLabel: string;
  groupedSessions: {
    attention: ChatSessionSummary[];
    open: ChatSessionSummary[];
    archived: ChatSessionSummary[];
  };
  selectedId: string | null;
  onFilterChange: (filter: ChatFilter) => void;
  onSelect: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const empty = groupedSessions.attention.length === 0
    && groupedSessions.open.length === 0
    && groupedSessions.archived.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-default)] px-3 py-1.5">
        <FilterTab active={filter === "all"} onClick={() => onFilterChange("all")}>
          All
        </FilterTab>
        {kindTabs.map((tab) => (
          <FilterTab key={tab.kind} active={filter === tab.kind} onClick={() => onFilterChange(tab.kind)}>
            <span>{tab.label}</span>
            <span className="text-[var(--text-quaternary)]">{kindCounts.get(tab.kind) ?? 0}</span>
          </FilterTab>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--text-tertiary)]">
            <MessagesSquare className="h-6 w-6" />
            <span>{emptyLabel}</span>
          </div>
        ) : (
          <>
            <ChatSessionGroup
              title="Active"
              sessions={groupedSessions.attention}
              selectedId={selectedId}
              onSelect={onSelect}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              onRename={onRename}
            />
            <ChatSessionGroup
              title="Open"
              sessions={groupedSessions.open}
              selectedId={selectedId}
              onSelect={onSelect}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              onRename={onRename}
            />
            <ArchivedChatGroup
              sessions={groupedSessions.archived}
              selectedId={selectedId}
              onSelect={onSelect}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              onRename={onRename}
            />
          </>
        )}
      </div>
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

function ChatSessionGroup({
  title,
  sessions,
  ...rowProps
}: {
  title: string;
  sessions: ChatSessionSummary[];
} & ChatRowActions) {
  if (sessions.length === 0) return null;

  return (
    <section>
      <h2 className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        {title}
      </h2>
      <div>
        {sessions.map((session) => (
          <ChatSessionRow key={session.id} session={session} {...rowProps} />
        ))}
      </div>
    </section>
  );
}

function ArchivedChatGroup({
  sessions,
  ...rowProps
}: {
  sessions: ChatSessionSummary[];
} & ChatRowActions) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(ARCHIVED_PAGE_SIZE);
  const visibleSessions = sessions.slice(0, visibleCount);
  const remainingCount = Math.max(0, sessions.length - visibleSessions.length);

  useEffect(() => {
    if (!isExpanded) {
      setVisibleCount(ARCHIVED_PAGE_SIZE);
    }
  }, [isExpanded]);

  if (sessions.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-1">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Archived
        </span>
        <span>{sessions.length}</span>
      </button>
      {isExpanded ? (
        <>
          <div>
            {visibleSessions.map((session) => (
              <ChatSessionRow key={session.id} session={session} {...rowProps} />
            ))}
          </div>
          {remainingCount > 0 ? (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + ARCHIVED_PAGE_SIZE)}
              className="ml-3 mt-1 pb-3 text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Show {Math.min(ARCHIVED_PAGE_SIZE, remainingCount)} more
            </button>
          ) : null}
        </>
      ) : null}
    </section>
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
      className={`group relative flex cursor-pointer items-start gap-2.5 border-l-2 px-3 py-2 transition-colors ${
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

function EmptyChatPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--text-tertiary)]">
      <MessagesSquare className="h-7 w-7" />
      <span>Select a chat</span>
    </div>
  );
}
