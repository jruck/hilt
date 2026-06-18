"use client";

import { NotebookPen } from "lucide-react";
import type { PersonMeeting } from "@/lib/types";
import { useHaptics } from "@/hooks/useHaptics";
import { formatHiltMonthDay } from "@/lib/display-date";

interface MeetingRowProps {
  meeting: PersonMeeting;
  selected: boolean;
  onClick: () => void;
  inboxMode?: boolean;
}

function formatDateTime(meeting: PersonMeeting): string {
  const date = new Date(`${meeting.date}T00:00:00`);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  const datePart = formatHiltMonthDay(date, { includeYear: !sameYear });

  if (meeting.time) {
    const time = new Date(meeting.time);
    const timePart = time.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${datePart} · ${timePart}`;
  }

  return datePart;
}

function selectedCalendarTitle(meeting: PersonMeeting): string | null {
  const candidate = meeting.calendarCandidates?.find((item) =>
    item.seriesKey === meeting.calendarSeriesKey || item.eventId === meeting.hiltCalendarEventId
  ) ?? meeting.calendarCandidates?.[0] ?? null;
  return candidate?.title ?? null;
}

export default function MeetingRow({ meeting, selected, onClick, inboxMode }: MeetingRowProps) {
  const haptics = useHaptics();
  const isNext = meeting.source === "next";
  const nextSubtitle = isNext ? selectedCalendarTitle(meeting) : null;

  const formattedDate = isNext
    ? meeting.date
      ? `Next · ${formatHiltMonthDay(new Date(`${meeting.date}T00:00:00`))}`
      : "Next"
    : formatDateTime(meeting);

  // Only show title for granola meetings with a real title (not generic "Notes")
  const subtitle = isNext ? nextSubtitle : meeting.title;
  const showTitle = Boolean((isNext && nextSubtitle) || (!isNext && meeting.source === "granola" && meeting.title));
  const hasMatchedPeople = meeting.matchedPeople && meeting.matchedPeople.length > 0;
  const hasWrittenNotes = !!meeting.notes;

  return (
    <button
      type="button"
      onClick={() => { haptics.selection(); onClick(); }}
      className={`w-full text-left px-3 py-2.5 cursor-pointer border-b border-[var(--border-default)] transition-colors flex items-center ${
        selected
          ? "bg-[var(--bg-tertiary)] border-l-2 border-l-amber-500"
          : "hover:bg-[var(--bg-secondary)]"
      }`}
    >
      <div className="flex-1 min-w-0">
        {inboxMode ? (
          // Inbox mode: title is primary, date+time is secondary
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {meeting.title || formattedDate}
              </span>
              {hasWrittenNotes && (
                <NotebookPen className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
              )}
            </div>
            <div className="text-xs text-[var(--text-tertiary)] truncate">{formattedDate}</div>
          </>
        ) : (
          // Person mode: date+time is primary, title is secondary
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)]">{formattedDate}</span>
              {hasWrittenNotes && (
                <NotebookPen className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
              )}
            </div>
            {showTitle && (
              <div className="text-xs truncate text-[var(--text-tertiary)]">{subtitle}</div>
            )}
          </>
        )}
        {hasMatchedPeople && (
          <div className="flex flex-wrap gap-1 mt-1">
            {meeting.matchedPeople!.map((name) => (
              <span
                key={name}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
