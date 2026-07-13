"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MeetingLedgerDetail } from "@/hooks/useMeetingLedger";
import {
  LEDGER_STATE_META,
  MeetingLedgerRecord,
  meetingLedgerShortDate,
} from "./MeetingLedgerRecord";

interface TaskMeetingActionSectionProps {
  detail: MeetingLedgerDetail;
  taskTitle: string;
}

/**
 * The canonical meeting-action record joined into task detail. This is ordinary document flow,
 * not a second drawer: task notes and their evolving source record share one scroll position.
 */
export function TaskMeetingActionSection({ detail, taskTitle }: TaskMeetingActionSectionProps) {
  const [open, setOpen] = useState(true);
  const entry = detail.entry;
  const meta = LEDGER_STATE_META[entry.surface];
  const StateIcon = meta.icon;
  const latestAt = [entry.opened_at, ...entry.sightings.map((sighting) => sighting.at)]
    .sort()
    .at(-1) ?? entry.opened_at;
  const sightings = entry.sightings.length;

  return (
    <section
      className="border-t border-[var(--border-strong)]"
      data-testid="task-meeting-action-section"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 bg-[var(--bg-secondary)] px-6 py-3.5 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-[var(--text-primary)]">Meeting action</span>
            <span className={`flex shrink-0 items-center gap-1 text-[11px] ${meta.className}`}>
              <StateIcon className="h-3 w-3" />{meta.label}
            </span>
          </span>
          <span className="mt-0.5 block text-[11px] text-[var(--text-quaternary)]">
            Last seen {meetingLedgerShortDate(latestAt)}
            {sightings > 0 ? ` · ${sightings} ${sightings === 1 ? "sighting" : "sightings"}` : ""}
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 flex-none text-[var(--text-quaternary)]" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-none text-[var(--text-quaternary)]" />
        )}
      </button>
      {open && (
        <MeetingLedgerRecord
          detail={detail}
          actionMode="when-different"
          taskTitle={taskTitle}
          showSurfaceDescription={false}
          showTaskLink={false}
          className="px-6 py-5 pb-[var(--hilt-mobile-nav-clearance)]"
        />
      )}
    </section>
  );
}
