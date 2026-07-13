"use client";

// ChatPanel — the shared chat surface (chat-v1 Workstream 2). One component for every
// host: System → Chats renders it in the split's right pane; the Library artifact
// drawer renders it as an overlay. Two modes: { chatId } opens an existing session;
// { context, contextLabel } is first-turn mode — the server creates the session when
// the first message is sent. Hosts key the panel (by chatId or a nonce) so switching
// conversations remounts and aborts any in-flight stream.

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { mutate as globalMutate } from "swr";
import { X } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import { withBasePath } from "@/lib/base-path";
import type { ChatContextRef } from "@/lib/chat/types";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { useChat } from "./useChat";

export interface ChatPanelProps {
  /** Open an existing session. Omit (and pass `context`) for first-turn mode. */
  chatId?: string | null;
  /** First-turn context — sent with the first message so the server can create the session. */
  context?: ChatContextRef;
  /** Subtitle while no session exists yet (first-turn mode); session.contextLabel wins after. */
  contextLabel?: string;
  /** Header slot rendered between the title block and the close X (e.g. a "New chat" action). */
  headerActions?: ReactNode;
  /** Renders the header close X when provided. */
  onClose?: () => void;
  /** Files-touched chip resolver — overrides the default `workingFolder` join. */
  onOpenFile?: (relPath: string) => void;
  /**
   * Root joined onto vault-relative files-touched chips for the default Docs resolver
   * (absolute paths — outside-vault edits — pass through untouched, ChatsView idiom).
   */
  workingFolder?: string;
  /**
   * Unread ownership: by default the panel PATCHes {unreadCount: 0} when it sees the open
   * session carrying unread (covers both open and turn-complete-while-open). Hosts that own
   * suppression-aware read state (ChatsView's manual-unread nuance) pass false.
   */
  autoMarkRead?: boolean;
  onSendStart?: () => void;
  /** Fires after a turn settles (complete, error, or user Stop) — hosts refresh their lists. */
  onTurnEnd?: () => void;
  placeholder?: string;
  className?: string;
}

export function ChatPanel({
  chatId: initialChatId,
  context,
  contextLabel,
  headerActions,
  onClose,
  onOpenFile,
  workingFolder = "",
  autoMarkRead = true,
  onSendStart,
  onTurnEnd,
  placeholder = "Message Claude",
  className = "",
}: ChatPanelProps) {
  const { navigateTo } = useScope();
  const { session, liveTrace, liveDraft, status, error, send, stop, chatId } = useChat({ chatId: initialChatId ?? null });
  // Re-PATCHing while a mark-read request is already in flight would hammer the route on
  // every SWR revalidation; latch per observed unread state instead.
  const markingReadRef = useRef(false);

  const markRead = useCallback(async (id: string) => {
    if (markingReadRef.current) return;
    markingReadRef.current = true;
    try {
      await fetch(withBasePath(`/api/chat/sessions/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unreadCount: 0 }),
      });
      await globalMutate(`/api/chat/sessions/${id}`);
      await globalMutate("/api/chat/sessions");
    } catch {
      // Mark-read is best-effort; the badge just survives until the next open.
    } finally {
      markingReadRef.current = false;
    }
  }, []);

  // Mark-read on open AND on turn-complete-while-open: both surface as the fetched
  // session carrying unreadCount > 0 while this panel has it open.
  useEffect(() => {
    if (!autoMarkRead || !session || session.unreadCount <= 0) return;
    void markRead(session.id);
  }, [autoMarkRead, markRead, session]);

  const handleOpenFile = useCallback((relPath: string) => {
    if (onOpenFile) {
      onOpenFile(relPath);
      return;
    }
    if (relPath.startsWith("/")) {
      navigateTo("docs", relPath);
      return;
    }
    if (!workingFolder) return;
    navigateTo("docs", `${workingFolder}/${relPath}`);
  }, [navigateTo, onOpenFile, workingFolder]);

  const handleSend = useCallback((text: string) => {
    onSendStart?.();
    // Context only matters before the session exists; the server ignores it once
    // a chatId rides along.
    void send(text, chatId ? undefined : context).then(() => onTurnEnd?.());
  }, [chatId, context, onSendStart, onTurnEnd, send]);

  const title = session?.title ?? (initialChatId ? "Chat" : "New chat");
  const subtitle = (session?.contextLabel ?? contextLabel ?? "").trim();

  return (
    <div className={`flex h-full min-h-0 flex-col bg-[var(--content-surface,var(--bg-primary))] ${className}`}>
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          {subtitle ? (
            <div className="truncate text-[11px] text-[var(--text-tertiary)]">{subtitle}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="inline-flex h-6 w-6 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      <ChatMessageList
        messages={session?.messages ?? []}
        status={status}
        liveTrace={liveTrace}
        liveDraft={liveDraft}
        onOpenFile={onOpenFile || workingFolder ? handleOpenFile : undefined}
        className="min-h-0 flex-1 px-4 py-4"
      />
      {error ? (
        <div className="border-t border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      ) : null}
      <div className="border-t border-[var(--border-default)] px-3 py-3">
        <ChatComposer
          onSend={handleSend}
          onStop={stop}
          sending={status === "sending"}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
