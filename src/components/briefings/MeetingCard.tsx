"use client";

/**
 * MeetingCard (v3 unit B3) — the light meeting entry for the briefing's "⏭ Next steps" canvas
 * section. PURE PROPS + layout only: the editor's own substance lead is the reading line
 * (already-rendered markdown comes in as `summary`), the meeting's TaskCards come in as
 * `children`. Follows the MeetingGroupRow idiom exactly (amber marker while something is
 * pending, click-to-expand chevron row, nested list) so canvas cards sit quietly in the
 * reading flow — no extra chrome, no parallel structure.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";

export function MeetingCard({ title, date, summary, pendingCount, defaultOpen = false, actions, children }: {
  /** Meeting title derived from the cited vault path — tooltip/fallback when no summary. */
  title: string;
  /** YYYY-MM-DD from the cited path (null when underivable). */
  date: string | null;
  /** The editor's substance lead for this meeting (rendered markdown) — the row's reading line. */
  summary?: ReactNode;
  /** Undecided proposals + asks for this meeting — drives the amber marker and the count. */
  pendingCount: number;
  defaultOpen?: boolean;
  /** Hover-revealed action cluster (feedback / copy-reference) — the CollapsibleItem idiom. */
  actions?: ReactNode;
  /** The meeting's cards (TaskCards; any leftover editorial sub-lines ride above them). */
  children: ReactNode;
}) {
  const haptics = useHaptics();
  const [open, setOpen] = useState(defaultOpen);
  const status = pendingCount > 0
    ? `${pendingCount} pending`
    : "decided";

  return (
    <li className={`text-[var(--text-secondary)] briefing-expandable${open ? " briefing-expanded" : ""}${pendingCount > 0 ? " briefing-escalated" : ""}`}>
      <div
        onClick={() => {
          if (open) haptics.rigid();
          else haptics.soft();
          setOpen((value) => !value);
        }}
        className="group flex flex-wrap items-start justify-between gap-2 py-0.5 cursor-pointer"
        title={date ? `${title} · ${date}` : title}
      >
        <span className="min-w-0 flex-1 leading-relaxed briefing-inline-md">
          {summary ?? <strong className="font-semibold text-[var(--text-primary)]">{title}</strong>}
        </span>
        {actions && (
          <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {actions}
          </span>
        )}
        <span className="mt-1 flex shrink-0 items-center gap-1.5 text-[var(--text-tertiary)]">
          <span className="text-xs whitespace-nowrap">{status}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </div>
      {open && (
        <div className="pl-5 pb-1.5 space-y-1.5">
          {children}
        </div>
      )}
    </li>
  );
}
