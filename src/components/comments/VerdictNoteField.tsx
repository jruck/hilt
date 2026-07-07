"use client";

/**
 * VerdictNoteField — the note that rides a verdict (gate-B addition, pre-built ahead of C).
 *
 * ONE implementation replaces the bespoke revise-only inputs in TaskCard, TaskFilePanel, and
 * AskVerdictControls. The gesture: a MessageSquare trigger sits WITH the verdict buttons;
 * opening it reveals the note input (the same input the revise form used — classes copied).
 * From there, two exits:
 *
 * - Type a note + click ANY verdict button → the surface reads `control.noteText` and posts
 *   `{verdict, note}` in ONE request to /api/loops/verdicts — exactly what revise did; now
 *   every verdict can carry the why (the ledger persists it; dismiss reasons ride the A7
 *   dismissed digest so the extractor learns).
 * - Type a note + press the field's own Send (no verdict) → postComment to the item — a pure
 *   comment, no decision. This is what Revise semantically WAS; the Revise button stays
 *   (posts verdict:revise + note) until C2 retires it into threads.
 *
 * The surface owns the verdict buttons and the POST; this file owns the note state (the
 * `useVerdictNote` control), the trigger, and the field — so the three surfaces can't drift.
 */
import { useCallback, useState, type FormEvent } from "react";
import { Check, MessageSquare, Send } from "lucide-react";
import { postComment } from "@/lib/comments/post";
import type { ImplementedCommentTarget } from "@/lib/comments/types";

export interface VerdictNoteControl {
  open: boolean;
  note: string;
  setNote: (value: string) => void;
  /** Trimmed note or undefined — what a verdict click carries as `note`. */
  noteText: string | undefined;
  toggle: () => void;
  /** Clear after a successful verdict or comment post. */
  reset: () => void;
  /** Check-flash state after a pure-comment post (the CommentBox idiom). */
  saved: boolean;
  setSaved: (value: boolean) => void;
}

export function useVerdictNote(): VerdictNoteControl {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const trimmed = note.trim();
  // Stable identities: consumers put reset/setSaved in effect dep arrays (TaskFilePanel's
  // re-target reset) — inline closures there would re-fire the effect every render.
  // (Revise was retired at consolidation, 2026-07-07 evening — Enter always posts the
  // comment; a note plus a verdict CLICK rides that verdict. One gesture, no mode traps.)
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const reset = useCallback(() => {
    setOpen(false);
    setNote("");
  }, []);
  return {
    open,
    note,
    setNote,
    noteText: trimmed ? trimmed : undefined,
    toggle,
    reset,
    saved,
    setSaved,
  };
}

/** The trigger — mounts INSIDE the surface's verdict-button row, styled as one of them. */
export function VerdictNoteTrigger({ control, vertical = false }: { control: VerdictNoteControl; vertical?: boolean }) {
  const title = control.saved
    ? "Comment saved"
    : "Add a note — it rides your next verdict, or Send posts it as a comment";
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); control.toggle(); }}
      className={`inline-flex min-h-6 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium shadow-sm transition-colors disabled:cursor-default disabled:opacity-60 ${
        control.saved
          ? "text-emerald-500"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      } ${vertical ? "justify-start" : ""}`}
      title={title}
      aria-label={title}
    >
      {control.saved ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
    </button>
  );
}

export interface VerdictNoteFieldProps {
  control: VerdictNoteControl;
  /** Where a NO-verdict submit posts the pure comment. */
  target: ImplementedCommentTarget;
  /** Disable while the surface has a verdict in flight. */
  busy?: boolean;
  /** The AskVerdictControls floating-stack form factor. */
  vertical?: boolean;
  onPosted?: () => void;
  placeholder?: string;
  /** Layout override for the form container — surfaces keep their exact pre-refit spacing. */
  className?: string;
}

/** The input — renders when the control is open. Verdict clicks live in the surface and read
 * `control.noteText`; the field's own Send is the pure-comment path. */
export function VerdictNoteField({
  control,
  target,
  busy = false,
  vertical = false,
  onPosted,
  placeholder = "Add a note",
  className,
}: VerdictNoteFieldProps) {
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layout = className ?? (vertical ? "flex w-56 flex-col gap-1" : "mt-1.5 flex items-center gap-2");

  if (!control.open) {
    return error ? <p className={vertical ? "w-56 text-xs text-red-500" : "mt-1 text-xs text-red-500"}>{error}</p> : null;
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = control.noteText;
    if (!text) return;
    setPosting(true);
    setError(null);
    try {
      await postComment(target, text);
      control.reset();
      control.setSaved(true);
      onPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save comment");
    } finally {
      setPosting(false);
    }
  }

  return (
    <form
      onClick={(event) => event.stopPropagation()}
      onSubmit={submitComment}
      className={layout}
    >
      <input
        value={control.note}
        onChange={(event) => control.setNote(event.target.value)}
        autoFocus
        className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <button
        type="submit"
        disabled={!control.noteText || posting || busy}
        className="inline-flex min-h-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
        title="Post as a comment (no decision)"
        aria-label="Post as a comment (no decision)"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
      {error && <p className={vertical ? "w-56 text-xs text-red-500" : "text-xs text-red-500"}>{error}</p>}
    </form>
  );
}
