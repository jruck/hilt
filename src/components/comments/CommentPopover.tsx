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
 *   pushes content around. Inside: the target's thread history (shared ThreadBlock rows —
 *   edit/delete/Process affordances work here too) above a composer.
 * - Composer: Enter = send, Shift+Enter = newline; posting keeps the popover OPEN and the
 *   new message appears via the shared SWR key (Figma behavior). Empty thread → composer only.
 * - hoverReveal: bullet rows hide the trigger until row hover — but a nonzero count or an
 *   open popover forces visibility (commented bullets stay discoverable without hover).
 *
 * Supersedes CommentBox's standalone inline forms on header/bullet surfaces; CommentBox
 * remains the inline-input primitive under VerdictNoteField.
 */
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import useSWR from "swr";
import { MessageSquare, Send } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { postComment } from "@/lib/comments/post";
import type { ImplementedCommentTarget } from "@/lib/comments/types";
import type { Thread } from "@/lib/threads/types";
import { useThreadCounts } from "@/hooks/useThreadCounts";
import { ObjectPopover } from "@/components/objects/ObjectPopover";
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
  const setOpen = (value: boolean | ((v: boolean) => boolean)) => {
    setOpenState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
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
        <ObjectPopover anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <CommentPopoverPanel target={target} placeholder={placeholder} />
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
 * the popover and any under-body Comments section can never disagree. */
function CommentPopoverPanel({ target, placeholder }: { target: ImplementedCommentTarget; placeholder: string }) {
  const { data } = useSWR<{ threads: Thread[] }>(threadsUrlForTarget(target), fetchThreads, { keepPreviousData: true });
  const threads = data?.threads ?? [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(target, trimmed);
      setText("");
      // Stays OPEN: the revalidated transcript key shows the new message in place.
      void mutateThreadsForTarget(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div>
      {threads.length > 0 && (
        <div className="divide-y divide-[var(--border-default)]">
          {threads.map((thread) => (
            <ThreadBlock key={thread.id} thread={thread} onChanged={() => void mutateThreadsForTarget(target)} />
          ))}
        </div>
      )}
      <form onSubmit={submit} className={threads.length > 0 ? "mt-2 border-t border-[var(--border-default)] pt-2" : ""}>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onComposerKeyDown}
          autoFocus
          rows={2}
          disabled={busy}
          className="min-h-14 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <div className="mt-1.5 flex items-center justify-end">
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
            title="Send comment"
            aria-label="Send comment"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </form>
    </div>
  );
}
