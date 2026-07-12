"use client";

/**
 * MeetingCard (v3 unit B3) — the light meeting entry for the briefing's "⏭ Next steps" canvas
 * section. PURE PROPS + layout only: the editor's own substance lead is the reading line
 * (already-rendered markdown comes in as `summary`), the meeting's TaskCards come in as
 * `children`. Follows the MeetingGroupRow idiom exactly (amber marker while something is
 * pending, click-to-expand chevron row, nested list) so canvas cards sit quietly in the
 * reading flow — no extra chrome, no parallel structure.
 *
 * The header IS the meeting reference (title + date, via the summary lead + tooltip) — the
 * expansion suppresses the editor's own-meeting citation line as redundant (see
 * `isRedundantMeetingCitationLine`). When `meetingRel` is present the summary lead carries a
 * meeting ObjectPill (B5): the universal resolver maps the vault rel-path through frontmatter
 * `granola_id` to People's meeting inbox, closing the header-nav gap deferred at B3 (no
 * rel-path→granola-id resolver existed then).
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";
import { ObjectPill } from "@/components/objects/ObjectPill";

/** Section-level expand-all / collapse-all broadcast. A fresh object per click (version bumps)
 * so children re-apply it even if the reader toggled them locally in between; children keep
 * their own local open state — the signal is an event, not lifted state. */
export interface ExpandSignal {
  version: number;
  expanded: boolean;
}

/** Apply a section broadcast to a child's local open state. No-op until the first click
 * (signal undefined); re-applies on every version bump. */
export function useExpandSignal(signal: ExpandSignal | undefined, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (signal) setOpen(signal.expanded);
    // A new signal object is minted per click — object identity IS the version key.
  }, [signal, setOpen]);
}

export function MeetingCard({ title, date, summary, pendingCount, urgent, meetingFirst = false, defaultOpen = false, actions, children, meetingRel, suppressHeaderPill = false, expandSignal }: {
  /** Meeting title derived from the cited vault path — tooltip/fallback when no summary. */
  title: string;
  /** YYYY-MM-DD from the cited path (null when underivable). */
  date: string | null;
  /** The editor's substance lead for this meeting (rendered markdown) — the row's reading line. */
  summary?: ReactNode;
  /** Undecided proposals + asks for this meeting — drives the amber marker and the count. */
  pendingCount: number;
  /** Urgent groups receive the restrained amber marker. Legacy callers default to pending. */
  urgent?: boolean;
  /** Decisions queues lead with meeting identity, then editorial or stored meeting context. */
  meetingFirst?: boolean;
  defaultOpen?: boolean;
  /** Hover-revealed action cluster (feedback / copy-reference) — the CollapsibleItem idiom. */
  actions?: ReactNode;
  /** The meeting's cards (TaskCards; any leftover editorial sub-lines ride above them). */
  children: ReactNode;
  /** Vault-relative meeting note path — renders the header's meeting ObjectPill (B5). */
  meetingRel?: string | null;
  /** True when the summary already carries its own pill for this meeting (an editor-written
   * inline `hilt:` citation) — the structural header pill would be a duplicate. */
  suppressHeaderPill?: boolean;
  /** Section expand-all / collapse-all broadcast — applies over the local open state. */
  expandSignal?: ExpandSignal;
}) {
  const haptics = useHaptics();
  const [open, setOpen] = useState(defaultOpen);
  useExpandSignal(expandSignal, setOpen);
  const status = pendingCount > 0
    ? `${pendingCount} pending`
    : "decided";
  const highlighted = urgent ?? pendingCount > 0;
  const toggleOpen = () => {
    if (open) haptics.rigid();
    else haptics.soft();
    setOpen((value) => !value);
  };
  const statusNode = (
    <span
      data-decision-status={meetingFirst ? "true" : undefined}
      className={`${meetingFirst ? "col-start-2 row-start-1 justify-self-end" : ""} mt-1 flex shrink-0 items-center gap-1.5 text-[var(--text-tertiary)]`}
    >
      {actions && (
        // Children self-gate their hover reveal (W1: a pilled comment trigger must stay
        // visible without hover; see BriefingContent's action clusters).
        <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5">
          {actions}
        </span>
      )}
      <span className="text-xs whitespace-nowrap">{status}</span>
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </span>
  );

  return (
    <li
      data-briefing-meeting={meetingRel || undefined}
      data-pending-count={pendingCount}
      data-urgent={highlighted ? "true" : "false"}
      className={`text-[var(--text-secondary)] briefing-expandable${open ? " briefing-expanded" : ""}${highlighted ? " briefing-escalated" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggleOpen();
        }}
        className={meetingFirst
          ? "group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 py-0.5"
          : "group flex flex-wrap items-start justify-between gap-2 py-0.5 cursor-pointer"}
        data-decision-row={meetingFirst ? "true" : undefined}
        title={date ? `${title} · ${date}` : title}
      >
        {meetingFirst ? (
          <>
            <span
              data-decision-meeting-meta="true"
              className="col-start-1 row-start-1 min-w-0 overflow-hidden"
              onClick={meetingRel ? (event) => event.stopPropagation() : undefined}
            >
              {meetingRel ? (
                <ObjectPill refr={{ kind: "meeting", id: meetingRel }} showDate>{title}</ObjectPill>
              ) : (
                <strong className="font-semibold text-[var(--text-primary)]">{title}</strong>
              )}
            </span>
            {summary ? (
              <span
                data-decision-context="true"
                className="col-span-2 row-start-2 min-w-0 leading-relaxed briefing-inline-md"
              >
                {summary}
              </span>
            ) : null}
            {statusNode}
          </>
        ) : (
          <span className="min-w-0 flex-1 leading-relaxed briefing-inline-md">
            {summary ?? <strong className="font-semibold text-[var(--text-primary)]">{title}</strong>}
            {meetingRel && !suppressHeaderPill ? (
              // stopPropagation: the pill toggles its own popover, never the row's expansion.
              // showDate={false}: this structural pill renders ONLY when the editor did NOT put a
              // pill in the headline — i.e. the lead uses the old "meeting (date)" house form and
              // already carries the date in prose (every pre-B5 briefing does). A dated pill here
              // would double the date; the tooltip keeps the ISO date as metadata either way.
              <span className="ml-1.5" onClick={(e) => e.stopPropagation()}>
                <ObjectPill refr={{ kind: "meeting", id: meetingRel }} showDate={false}>{title}</ObjectPill>
              </span>
            ) : null}
          </span>
        )}
        {!meetingFirst ? statusNode : null}
      </div>
      {open && (
        <div className="pl-5 pb-1.5 space-y-1.5">
          {children}
        </div>
      )}
    </li>
  );
}
