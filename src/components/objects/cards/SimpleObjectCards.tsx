"use client";

/**
 * Thin popover bodies for person / project / library (v3 unit B5). Meeting + task are the
 * v1 focus; these keep the kind dispatch total so their resolvers light up with real cards
 * the moment surfaces start emitting those refs. All pure props.
 */
import { ExternalLink } from "lucide-react";
import type { LibraryCardData, PersonCardData, ProjectCardData } from "@/lib/objects/types";
import { formatHiltMonthDay } from "@/lib/display-date";

function CardTitle({ title, onOpen }: { title: string; onOpen?: () => void }) {
  if (!onOpen) {
    return <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full truncate rounded text-left text-sm font-semibold text-[var(--text-primary)] transition-colors hover:text-[var(--interactive-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
      title={`Open ${title}`}
    >
      {title}
    </button>
  );
}

export function PersonObjectCard({ data, onOpen }: { data: PersonCardData; onOpen?: () => void }) {
  const lastMeeting = data.lastMeetingDate ? formatPlainDate(data.lastMeetingDate) : null;
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5" data-testid="person-object-card">
      <CardTitle title={data.name} onOpen={onOpen} />
      {data.description ? <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{data.description}</div> : null}
      {lastMeeting ? <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">Last meeting {lastMeeting}</div> : null}
    </div>
  );
}

export function ProjectObjectCard({ data, onOpen }: { data: ProjectCardData; onOpen?: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5" data-testid="project-object-card">
      <CardTitle title={data.title} onOpen={onOpen} />
      {data.status ? <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{data.status}</div> : null}
      {data.description ? <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{data.description}</div> : null}
    </div>
  );
}

export function LibraryObjectCard({ data, onOpen }: { data: LibraryCardData; onOpen?: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5" data-testid="library-object-card">
      <CardTitle title={data.title} onOpen={onOpen} />
      {data.sourceName ? <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{data.sourceName}</div> : null}
      {data.summary ? <div className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">{data.summary}</div> : null}
      {data.url ? (
        <div className="mt-2">
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            title={data.url}
          >
            <ExternalLink className="h-3 w-3" />
            Source
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** Format a YYYY-MM-DD without a UTC-midnight timezone shift (noon-local anchor). */
export function formatPlainDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return formatHiltMonthDay(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}
