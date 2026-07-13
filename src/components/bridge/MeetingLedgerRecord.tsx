"use client";

import {
  Ban,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  Eye,
  History,
  UserRound,
} from "lucide-react";
import type { MeetingLedgerDetail } from "@/hooks/useMeetingLedger";
import type { LedgerSurfaceState } from "@/lib/loops/meeting-ledger-store";

export const LEDGER_SURFACE_COPY: Record<LedgerSurfaceState, string> = {
  pending: "Open meeting commitments waiting for your proposal decision.",
  accepted: "Commitments you accepted or assigned that are not yet complete.",
  latent: "Open Justin or unclear-owner observations that never became proposals.",
  observed: "Open commitments retained as evidence, usually owned by someone else.",
  dismissed: "Proposals you declined; preserved for inspection and recovery.",
  resolved: "Commitments completed or dropped for reasons other than your dismissal.",
};

export const LEDGER_STATE_META: Record<LedgerSurfaceState, {
  label: string;
  className: string;
  icon: typeof CircleDot;
}> = {
  pending: { label: "Pending", className: "text-amber-600 dark:text-amber-400", icon: CircleDot },
  accepted: { label: "Accepted", className: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  latent: { label: "Not surfaced", className: "text-[var(--text-tertiary)]", icon: CircleDot },
  observed: { label: "Observed only", className: "text-[var(--text-tertiary)]", icon: Eye },
  dismissed: { label: "Dismissed", className: "text-[var(--text-quaternary)]", icon: Ban },
  resolved: { label: "Resolved", className: "text-[var(--text-tertiary)]", icon: CheckCircle2 },
};

export function meetingLedgerMeetingLabel(value: string): string {
  return (value.split("/").pop() || value)
    .replace(/-\d{4}-\d{2}-\d{2}[^/]*\.md$/, "")
    .replace(/\.md$/, "");
}

export function meetingLedgerShortDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value.slice(0, 10)
    : parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      });
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface MeetingLedgerRecordProps {
  detail: MeetingLedgerDetail;
  className?: string;
  actionMode?: "heading" | "when-different";
  taskTitle?: string;
  showSurfaceDescription?: boolean;
  showTaskLink?: boolean;
  onOpenTask?: (id: string) => void;
}

/**
 * The canonical read-only rendering of one meeting-ledger record. The ledger browser and a
 * linked task use this same component so later sightings, evidence, and status history cannot
 * drift into two different UI summaries.
 */
export function MeetingLedgerRecord({
  detail,
  className = "",
  actionMode = "heading",
  taskTitle,
  showSurfaceDescription = true,
  showTaskLink = true,
  onOpenTask,
}: MeetingLedgerRecordProps) {
  const { entry } = detail;
  const showAction = actionMode === "heading"
    || !taskTitle
    || comparable(entry.action) !== comparable(taskTitle);

  return (
    <div className={className} data-testid="meeting-ledger-record">
      {showAction && (
        actionMode === "heading" ? (
          <h2 className="text-lg font-semibold leading-snug text-[var(--text-primary)]">{entry.action}</h2>
        ) : (
          <div>
            <div className="text-[11px] font-medium uppercase text-[var(--text-quaternary)]">Original commitment</div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{entry.action}</p>
          </div>
        )
      )}

      {showSurfaceDescription && (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-quaternary)]">
          {LEDGER_SURFACE_COPY[entry.surface]}
        </p>
      )}

      <div className={`${showAction || showSurfaceDescription ? "mt-3" : ""} flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--text-tertiary)]`}>
        <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{entry.owner}</span>
        <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Opened {meetingLedgerShortDate(entry.opened_at)}</span>
        {entry.due && <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Due {entry.due}</span>}
      </div>

      <div className="mt-4 border-t border-[var(--border-default)] pt-4">
        <div className="text-[11px] font-medium uppercase text-[var(--text-quaternary)]">Meeting</div>
        <div className="mt-1 text-sm font-medium text-[var(--text-secondary)]">{meetingLedgerMeetingLabel(entry.opened_from)}</div>
        {detail.meeting_summary?.summary && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-tertiary)]">{detail.meeting_summary.summary}</p>
        )}
      </div>

      {entry.context && (
        <div className="mt-5">
          <div className="text-[11px] font-medium uppercase text-[var(--text-quaternary)]">Context</div>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{entry.context}</p>
        </div>
      )}

      {showTaskLink && detail.task && (
        <button
          type="button"
          onClick={() => onOpenTask?.(detail.task!.id)}
          className="mt-5 flex w-full items-center gap-2 border-y border-[var(--border-default)] py-3 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <CircleDot className="h-4 w-4 flex-none" />
          <span className="min-w-0 flex-1 truncate">{detail.task.title}</span>
          <span className="flex-none whitespace-nowrap font-mono text-[10px] text-[var(--text-quaternary)]">{detail.task.id}</span>
        </button>
      )}

      {entry.citations.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-medium uppercase text-[var(--text-quaternary)]">Source evidence</div>
          <div className="mt-2 space-y-2">
            {entry.citations.map((citation, index) => (
              <blockquote
                key={`${citation.source}:${index}`}
                className="border-l-2 border-[var(--border-strong)] pl-3 text-sm leading-relaxed text-[var(--text-tertiary)]"
              >
                {citation.anchor ? `“${citation.anchor}”` : citation.source}
              </blockquote>
            ))}
          </div>
        </div>
      )}

      {entry.sightings.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] font-medium uppercase text-[var(--text-quaternary)]">Sightings · {entry.sightings.length}</div>
          <p className="mt-1 text-xs text-[var(--text-quaternary)]">Later meetings that referred to this same underlying commitment.</p>
          <div className="mt-2 divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
            {[...entry.sightings].reverse().map((sighting, index) => (
              <div key={`${sighting.at}:${index}`} className="py-2.5 text-xs">
                <div className="text-[var(--text-secondary)]">{meetingLedgerMeetingLabel(sighting.meeting)}</div>
                <div className="mt-0.5 text-[var(--text-quaternary)]">
                  {meetingLedgerShortDate(sighting.at)}{sighting.quote ? ` · “${sighting.quote}”` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-[var(--text-quaternary)]">
          <History className="h-3.5 w-3.5" />Record history
        </div>
        <div className="mt-2 space-y-2">
          {entry.status_history.slice().reverse().map((history, index) => (
            <div key={`${history.at}:${index}`} className="text-xs text-[var(--text-tertiary)]">
              <span className="text-[var(--text-secondary)]">{history.from ?? "created"} → {history.to}</span>
              {` · ${meetingLedgerShortDate(history.at)}`}
              {history.evidence ? <div className="mt-0.5 text-[var(--text-quaternary)]">{history.evidence}</div> : null}
            </div>
          ))}
          {detail.events
            .filter((event) => event.event_type !== "status-transition")
            .slice(0, 12)
            .map((event) => (
              <div key={event.event_id} className="text-xs text-[var(--text-quaternary)]">
                {event.event_type.replaceAll("-", " ")} · {meetingLedgerShortDate(event.occurred_at)}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
