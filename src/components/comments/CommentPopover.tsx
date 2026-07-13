"use client";

/**
 * CommentPopover (v3 W1) — the universal comment experience: ONE trigger + ONE floating
 * composer, identical on every surface (Justin's Figma-comment model).
 *
 * - Trigger: MessageSquare icon button; a quiet count pill appears once the target's
 *   thread has messages (total messages incl. agent replies — activity visibility, fed by
 *   the app-wide useThreadCounts summaries fetch).
 * - Popover: the house ObjectPopover shell (portal, fixed-position anchor + viewport clamp,
 *   outside-mousedown + Escape dismissal) — floats OVER the canvas; feedback UI never
 *   pushes content around. It begins as compact capture, then `Chat now` grows the same
 *   shell into a live ThreadDrawer without leaving the source artifact.
 * - Composer: Enter = send, Shift+Enter = newline; posting keeps the popover OPEN and the
 *   new queued message appears via the shared SWR key (Figma behavior). Empty thread → composer only.
 * - hoverReveal: bullet rows hide the trigger until row hover — but a nonzero count or an
 *   open popover forces visibility (commented bullets stay discoverable without hover).
 *
 * Supersedes CommentBox's standalone inline forms on header/bullet surfaces; CommentBox
 * remains the inline-input primitive under VerdictNoteField.
 */
import { useRef, useState } from "react";
import useSWR from "swr";
import { MessageSquare, MessagesSquare, Play } from "lucide-react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { withBasePath } from "@/lib/base-path";
import { postComment } from "@/lib/comments/post";
import type { ImplementedCommentTarget } from "@/lib/comments/types";
import type { Thread } from "@/lib/threads/types";
import { useThreadCounts } from "@/hooks/useThreadCounts";
import { ObjectPopover } from "@/components/objects/ObjectPopover";
import { ThreadDrawer } from "@/components/threads/ThreadDrawer";
import { ThreadBlock, mutateThreadsForTarget, threadsUrlForTarget } from "@/components/threads/ThreadView";

export interface CommentPopoverProps {
  target: ImplementedCommentTarget;
  placeholder?: string;
  /** Tooltip/aria-label on the trigger. */
  triggerTitle?: string;
  /** Per-row size (briefing-bullet idiom) instead of the header icon-button size. */
  compact?: boolean;
  /** Row-hover reveal (needs an ancestor `group`); a nonzero count or an open popover forces visibility. */
  hoverReveal?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommentPopover({
  target,
  placeholder = "Comment",
  triggerTitle = "Comment",
  compact = false,
  hoverReveal = false,
  onOpenChange,
}: CommentPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpenState] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const setOpen = (value: boolean | ((v: boolean) => boolean)) => {
    setOpenState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (!next) setConversationMode(false);
      if (next !== prev) onOpenChange?.(next);
      return next;
    });
  };
  const { countFor } = useThreadCounts();
  const count = countFor(target);

  const sizeClasses = compact
    ? "min-h-6 min-w-6 rounded-md px-1 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
    : "rounded p-1 hover:text-[var(--text-secondary)]";
  const revealClasses = hoverReveal && count === 0 && !open
    ? " opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
    : "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center justify-center gap-1 text-[var(--text-tertiary)] transition-colors ${sizeClasses}${revealClasses}`}
        title={triggerTitle}
        aria-label={triggerTitle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MessageSquare className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {count > 0 && (
          <span className="rounded-full bg-[var(--bg-secondary)] px-1 text-[10px] font-medium leading-4 tabular-nums text-[var(--text-secondary)]">
            {count}
          </span>
        )}
      </button>
      {open && (
        <ObjectPopover
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
          variant={conversationMode ? "conversation" : "comment"}
        >
          <CommentPopoverPanel
            target={target}
            placeholder={placeholder}
            onClose={() => setOpen(false)}
            onConversationModeChange={setConversationMode}
          />
        </ObjectPopover>
      )}
    </>
  );
}

async function fetchThreads(url: string): Promise<{ threads: Thread[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<{ threads: Thread[] }>;
}

/** Mounted only while open — the transcript fetch is lazy; the SWR key is ThreadView's, so
 * capture mode, live mode, and any under-body Comments section can never disagree. */
function CommentPopoverPanel({
  target,
  placeholder,
  onClose,
  onConversationModeChange,
}: {
  target: ImplementedCommentTarget;
  placeholder: string;
  onClose: () => void;
  onConversationModeChange: (active: boolean) => void;
}) {
  const { data } = useSWR<{ threads: Thread[] }>(threadsUrlForTarget(target), fetchThreads, { keepPreviousData: true });
  const threads = data?.threads ?? [];
  const latestThread = threads.at(-1) ?? null;
  const pendingCount = latestThread?.messages.filter((message) => (
    (message.author === "justin" || message.author === "claude-sim") && !message.handled_at
  )).length ?? 0;
  const [liveThreadId, setLiveThreadId] = useState<string | null>(null);
  const [autoProcess, setAutoProcess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(target, trimmed);
      // Stays OPEN: the revalidated transcript key shows the new message in place.
      await mutateThreadsForTarget(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  function openConversation(threadId: string, process: boolean) {
    setLiveThreadId(threadId);
    setAutoProcess(process);
    onConversationModeChange(true);
  }

  if (liveThreadId) {
    return (
      <ThreadDrawer
        threadId={liveThreadId}
        target={target}
        onClose={onClose}
        onFollowThread={(threadId) => {
          setLiveThreadId(threadId);
          setAutoProcess(true);
        }}
        autoProcess={autoProcess}
        onAutoProcessConsumed={() => setAutoProcess(false)}
        displayMode="popover"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
          <MessagesSquare className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span>Comments</span>
        </div>
        {pendingCount > 0 ? (
          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
            {pendingCount} queued
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {threads.length > 0 ? (
          <div className="divide-y divide-[var(--border-default)]">
          {threads.map((thread) => (
            <ThreadBlock
              key={thread.id}
              thread={thread}
              processAffordance="none"
              onChanged={() => void mutateThreadsForTarget(target)}
            />
          ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-[11px] text-[var(--text-quaternary)]">
            Leave a comment now. Start a chat only when you want a live response.
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-3">
        {latestThread?.status === "open" && pendingCount > 0 ? (
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="min-w-0 text-[11px] text-[var(--text-tertiary)]">
              Leave these for later, or talk them through now.
            </span>
            <button
              type="button"
              onClick={() => openConversation(latestThread.id, true)}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[var(--interactive-active)] px-2.5 text-xs font-medium text-[var(--text-inverted)] transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <Play className="h-3 w-3 fill-current" />
              Chat now
            </button>
          </div>
        ) : latestThread?.chat_ids?.length ? (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => openConversation(latestThread.id, false)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              Open chat
            </button>
          </div>
        ) : null}
        <ChatComposer
          onSend={(text) => void submit(text)}
          sending={false}
          disabled={busy}
          autoFocus
          placeholder={placeholder}
        />
        <p className="mt-1.5 text-[10px] text-[var(--text-quaternary)]">
          Comments stay queued until you start a chat or the background processor picks them up.
        </p>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
