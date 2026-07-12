"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function RecommendationDismissPopover({ onDismiss }: { onDismiss: (note?: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      await onDismiss(note.trim() || undefined);
      setOpen(false);
      setNote("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss recommendation"
        title="Dismiss recommendation"
        aria-expanded={open}
      >
        <X className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-3 content-card-shadow">
          <div className="text-sm font-medium text-[var(--text-primary)]">Dismiss recommendation</div>
          <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">The Library item stays intact. Add feedback if the recommendation missed.</p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={busy}
            placeholder="Optional feedback"
            aria-label="Optional recommendation feedback"
            className="mt-2 min-h-16 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="min-h-8 rounded-md px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={busy} className="min-h-8 rounded-md bg-[var(--text-primary)] px-3 text-xs font-medium text-[var(--bg-primary)] disabled:opacity-60">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}
