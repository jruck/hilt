"use client";

/**
 * MeetingObjectCard (v3 unit B5) — THE canonical meeting card, extracted from
 * ActiveMeetingsSection in src/components/people/PersonMeetingList.tsx (the per-meeting
 * card JSX), parameterized as a pure view-model so two callers feed it:
 *
 * - The object popover (frontmatter-derived MeetingCardData): title, "date · time range"
 *   as timeLabel, attendees as metaLabel, Granola/Notes chips as actions, header title
 *   click-through navigating to the meeting.
 * - People's Active meetings section (PersonActiveMeeting): title, formatted start–end as
 *   timeLabel, the "iCal UID · 87% · 4 recordings" line as metaLabel, the open-in-calendar
 *   icon as headerAction, join/resource/provider links as actions.
 *
 * Pure props — no fetching, no navigation; callers wire the callbacks.
 */
import type { ReactNode } from "react";

export type MeetingCardAction =
  | { type: "link"; href: string; icon: ReactNode; label: string; primary?: boolean; title?: string }
  | { type: "button"; onClick: () => void; icon: ReactNode; label: string; primary?: boolean; title?: string };

export interface MeetingObjectCardProps {
  title: string;
  /** Second line — human time ("Jul 3, 2:00 PM - 2:30 PM"). */
  timeLabel?: string | null;
  /** Faint third line — attendees (popover) or match metadata (People). */
  metaLabel?: string | null;
  /** Right-aligned icon button in the header row (People's open-in-calendar). */
  headerAction?: { icon: ReactNode; onClick: () => void; title: string } | null;
  /** Wrapped action chips under the header (join links, resources, Granola, Notes). */
  actions?: MeetingCardAction[];
  /** When present the title renders as the card's click-through. */
  onTitleClick?: () => void;
}

export function MeetingObjectCard({ title, timeLabel, metaLabel, headerAction, actions, onTitleClick }: MeetingObjectCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5" data-testid="meeting-object-card">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              className="block w-full truncate text-left text-sm font-semibold text-[var(--text-primary)] transition-colors hover:text-[var(--interactive-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)] rounded"
              title={`Open ${title}`}
            >
              {title}
            </button>
          ) : (
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          )}
          {timeLabel ? <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{timeLabel}</div> : null}
          {metaLabel ? <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{metaLabel}</div> : null}
        </div>
        {headerAction ? (
          <button
            type="button"
            onClick={headerAction.onClick}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            title={headerAction.title}
          >
            {headerAction.icon}
          </button>
        ) : null}
      </div>
      {actions && actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actions.map((action, index) => (
            <MeetingActionChip key={actionKey(action, index)} action={action} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function actionKey(action: MeetingCardAction, index: number): string {
  // Label rides in the key: a join link and a resource link can share one URL (the old
  // PersonMeetingList keys carried the kind prefix for the same reason).
  return action.type === "link" ? `link:${action.label}:${action.href}` : `button:${action.label}:${index}`;
}

/** The PeopleActionLink chip classes from PersonMeetingList, covering link + button actions. */
function MeetingActionChip({ action }: { action: MeetingCardAction }) {
  const className = action.primary
    ? "inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--interactive-default)] px-2 text-xs font-medium text-white hover:bg-[var(--interactive-hover)]"
    : "inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]";

  if (action.type === "link") {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" className={className} title={action.title ?? action.href}>
        {action.icon}
        {action.label}
      </a>
    );
  }

  return (
    <button type="button" onClick={action.onClick} className={className} title={action.title}>
      {action.icon}
      {action.label}
    </button>
  );
}
