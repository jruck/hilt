"use client";

/**
 * CommentBox — THE comment gesture (gate-B addition, pre-built ahead of Phase C).
 *
 * One component replaces the bespoke feedback inputs (briefing per-bullet, whole-briefing,
 * escalation rows): trigger → inline input → submit → check flash. Storage routes through
 * postComment (src/lib/comments/post.ts); in C2 the same box becomes "first message of a
 * thread" without any surface changing.
 *
 * Two visual forms, classes copied from the components this replaces:
 * - `compact` — the per-row idiom (BriefingContent's ItemFeedbackButton): hover-revealed
 *   MessageSquare icon; the form wraps to a full-width row inside the mount's flex-wrap
 *   container; toggling the icon closes it.
 * - default — the whole-object idiom (BriefingsView's BriefingFeedbackButton): a labeled
 *   bordered button; the form replaces it inline with Send + explicit close.
 *
 * W1 supersession: the standalone header/bullet usages (briefing bullets, escalation rows,
 * whole-briefing, meeting notes) now render CommentPopover — the floating universal
 * experience. CommentBox stays exported as the inline-input primitive (the VerdictNoteField
 * check-flash idiom derives from it); it has no remaining standalone call sites.
 */
import { useState, type FormEvent } from "react";
import { Check, MessageSquare, Send, X } from "lucide-react";
import { postComment } from "@/lib/comments/post";
import type { ImplementedCommentTarget } from "@/lib/comments/types";

export interface CommentBoxProps {
  target: ImplementedCommentTarget;
  placeholder?: string;
  /** Tooltip/aria-label on the trigger (pending state). */
  triggerTitle?: string;
  /** Labeled-variant button text. */
  label?: string;
  /** Per-row icon form (ItemFeedbackButton idiom) instead of the labeled button. */
  compact?: boolean;
  /** Observe open/close — hover-gated mounts persist their visibility while the box is open. */
  onOpenChange?: (open: boolean) => void;
  onPosted?: () => void;
}

export function CommentBox({
  target,
  placeholder = "Feedback",
  triggerTitle = "Leave feedback",
  label = "Feedback",
  compact = false,
  onPosted,
  onOpenChange,
}: CommentBoxProps) {
  const [open, setOpenState] = useState(false);
  const setOpen = (value: boolean | ((v: boolean) => boolean)) => {
    setOpenState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });
  };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(target, trimmed);
      setText("");
      setOpen(false);
      setSaved(true);
      onPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          className={`inline-flex min-h-6 min-w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-secondary)] ${
            saved ? "text-emerald-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
          title={saved ? "Feedback saved" : triggerTitle}
          aria-label={saved ? "Feedback saved" : triggerTitle}
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
        </button>
        {open && (
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="flex w-full items-center gap-2 py-1">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
              className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
              placeholder={placeholder}
              aria-label={placeholder}
            />
            <button
              type="submit"
              disabled={!text.trim() || busy}
              className="inline-flex min-h-8 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
        {error && <p className="w-full text-xs text-red-500">{error}</p>}
      </>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
            saved
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          {label}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center justify-end gap-2">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] sm:max-w-xs"
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <button
        type="submit"
        disabled={!text.trim() || busy}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
        title="Save feedback"
        aria-label="Save feedback"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        title="Close feedback"
        aria-label="Close feedback"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
