"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  MapPin,
  NotebookPen,
  UserRound,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { mutate } from "swr";
import { useScope } from "@/contexts/ScopeContext";
import { prepareCalendarDescription, type CalendarDescriptionDisplay } from "@/lib/calendar/description";
import type { CalendarEvent, CalendarEventNoteTarget } from "@/lib/calendar/types";

const TIME_ZONE = "America/New_York";
const JOIN_LABELS: Record<CalendarEvent["joinLinks"][number]["kind"], string> = {
  teams: "Teams",
  meet: "Meet",
  zoom: "Zoom",
  web: "Link",
};

interface CalendarEventPopoverContentProps {
  availabilityWarning?: boolean;
  calendarLabel?: string | null;
  event: CalendarEvent | null;
  onClose: () => void;
  sourceLabel?: string | null;
}

export function CalendarEventPopoverContent({
  availabilityWarning,
  calendarLabel,
  event,
  onClose,
  sourceLabel,
}: CalendarEventPopoverContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);

  useLayoutEffect(() => {
    const wrapper = contentRef.current?.closest(".sx__event-modal, .hilt-calendar-event-popover-wrapper, .hilt-hud-event-popover-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const margin = 12;
    const clamp = () => {
      wrapper.style.maxHeight = `${Math.min(520, window.innerHeight - margin * 2)}px`;
      const rect = wrapper.getBoundingClientRect();
      const top = Math.min(Math.max(rect.top, margin), Math.max(margin, window.innerHeight - rect.height - margin));
      const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - rect.width - margin));
      wrapper.style.top = `${Math.round(top)}px`;
      wrapper.style.left = `${Math.round(left)}px`;
    };
    const frame = requestAnimationFrame(clamp);
    window.addEventListener("resize", clamp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", clamp);
    };
  }, [event?.id]);

  useEffect(() => {
    setShowFullDescription(false);
  }, [event?.id]);

  if (!event) return null;

  const description = prepareCalendarDescription(event.description);

  return (
    <div
      ref={contentRef}
      className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-2xl"
      data-testid="calendar-event-popover"
    >
      <div className="flex min-h-[52px] shrink-0 items-start gap-2 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold leading-5">
            {availabilityWarning ? (
              <span className="mr-1.5 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white" title="Not blocked on EverCommerce">!</span>
            ) : null}
            {event.title}
          </div>
        </div>
        <button type="button" aria-label="Close event details" className="calendar-icon-button h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <CalendarEventActions event={event} onClose={onClose} sourceLabel={sourceLabel} />

          <DetailRow
            icon={<Clock className="h-4 w-4" />}
            label={(
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span>{formatEventTime(event)}</span>
                {event.recurrence.recurring ? (
                  <span
                    className="rounded-md border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                    data-testid="calendar-event-recurring"
                  >
                    Recurring
                  </span>
                ) : null}
              </div>
            )}
          />
          <DetailRow icon={<CalendarDays className="h-4 w-4" />} label={calendarLabel || sourceLabel || "Calendar"} />
          {availabilityWarning ? <DetailRow icon={<Clock className="h-4 w-4" />} label="Not blocked on EverCommerce" /> : null}
          {event.location ? <DetailRow icon={<MapPin className="h-4 w-4" />} label={event.location} /> : null}
          {event.organizer ? <DetailRow icon={<UserRound className="h-4 w-4" />} label={event.organizer.name || event.organizer.email || "Organizer"} /> : null}
          {event.attendees.length ? <DetailRow icon={<UsersRound className="h-4 w-4" />} label={`${event.attendees.length} attendees`} /> : null}
          {event.duplicateSourceCount > 1 ? <DetailRow icon={<Check className="h-4 w-4" />} label={`${event.duplicateSourceCount} sources`} /> : null}

          {description.full ? (
            <DescriptionSection
              description={description}
              showFull={showFullDescription}
              onToggleFull={() => setShowFullDescription((current) => !current)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface CalendarEventActionsProps {
  accentColor?: string;
  className?: string;
  event: CalendarEvent;
  onClose?: () => void;
  sourceLabel?: string | null;
  stopPropagation?: boolean;
  variant?: "default" | "compact";
}

export function CalendarEventActions({
  accentColor,
  className,
  event,
  onClose,
  sourceLabel,
  stopPropagation = false,
  variant = "default",
}: CalendarEventActionsProps) {
  const { navigateTo } = useScope();
  const [openingNoteTarget, setOpeningNoteTarget] = useState<string | null>(null);
  const eventNoteTargets = event.meetingNotes?.length ? [] : event.noteTargets ?? [];
  const hasActions = event.joinLinks.length > 0 || Boolean(event.meetingNotes?.length) || eventNoteTargets.length > 0 || Boolean(event.providerUrl);
  if (!hasActions) return null;

  const isCompact = variant === "compact";
  const compactAccentColor = isCompact && accentColor ? accentColor : null;
  const primaryStyle: CSSProperties | undefined = compactAccentColor
    ? {
        backgroundColor: compactAccentColor,
        borderColor: compactAccentColor,
        color: "var(--text-inverted)",
      }
    : undefined;
  const secondaryStyle: CSSProperties | undefined = compactAccentColor
    ? {
        backgroundColor: `color-mix(in oklab, ${compactAccentColor} 18%, var(--content-surface))`,
        borderColor: `color-mix(in oklab, ${compactAccentColor} 44%, var(--border-default))`,
        color: `color-mix(in oklab, ${compactAccentColor} 86%, var(--text-primary))`,
      }
    : undefined;
  const iconClassName = isCompact ? "h-3 w-3" : "h-3.5 w-3.5";
  const primaryClassName = isCompact
    ? compactAccentColor
      ? "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-opacity hover:opacity-90"
      : "inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--interactive-default)] px-2 text-xs font-medium text-[var(--text-inverted)] hover:bg-[var(--interactive-hover)]"
    : "inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--interactive-default)] px-3 text-sm font-medium text-[var(--text-inverted)] hover:bg-[var(--interactive-hover)]";
  const secondaryClassName = isCompact
    ? compactAccentColor
      ? "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-opacity hover:opacity-90"
      : "inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
    : "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]";
  const actionRowClassName = `${isCompact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"} ${className ?? ""}`.trim();
  const stopIfNeeded = (event: SyntheticEvent<HTMLElement>) => {
    if (stopPropagation) event.stopPropagation();
  };
  const openPeopleNoteTarget = async (target: CalendarEventNoteTarget) => {
    setOpeningNoteTarget(target.slug);
    try {
      const response = await fetch(`/api/bridge/people/${encodeURIComponent(target.slug)}/next`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preserveContent: true,
          keepCalendarOnEmpty: true,
          calendarCandidate: target.candidate,
        }),
      });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      await Promise.all([
        mutate(`/api/bridge/people/${target.slug}`),
        mutate("/api/bridge/people"),
      ]);
      navigateTo("people", `/${target.slug}/next`);
      onClose?.();
    } catch (error) {
      console.warn("[calendar] Failed to open People notes target", error);
    } finally {
      setOpeningNoteTarget(null);
    }
  };

  return (
    <div className={actionRowClassName} data-testid={variant === "compact" ? "hud-event-actions" : "calendar-event-actions"}>
      {event.joinLinks.map((link, index) => (
        <a
          key={`${link.kind}:${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className={index === 0 ? primaryClassName : secondaryClassName}
          style={index === 0 ? primaryStyle : secondaryStyle}
          onKeyDown={stopIfNeeded}
          onClick={stopIfNeeded}
        >
          {link.kind === "web" ? <LinkIcon className={iconClassName} /> : <Video className={iconClassName} />}
          {JOIN_LABELS[link.kind]}
        </a>
      ))}
      {event.meetingNotes?.map((note) => (
        <button
          key={note.granolaId}
          type="button"
          className={secondaryClassName}
          style={secondaryStyle}
          onKeyDown={stopIfNeeded}
          onClick={(clickEvent) => {
            stopIfNeeded(clickEvent);
            navigateTo("people", `/__inbox__/meeting/${encodeURIComponent(note.granolaId)}`);
            onClose?.();
          }}
          title={note.calendarMatchMethod
            ? `Linked notes · ${note.calendarMatchMethod}${note.calendarMatchConfidence != null ? ` · ${Math.round(note.calendarMatchConfidence * 100)}%` : ""}`
            : "Linked meeting notes"}
        >
          <NotebookPen className={iconClassName} />
          Notes
        </button>
      ))}
      {eventNoteTargets.map((target) => (
        <button
          key={`${target.kind}:${target.slug}:${target.candidate.eventId}`}
          type="button"
          className={`${secondaryClassName} disabled:cursor-wait disabled:opacity-70`}
          disabled={openingNoteTarget === target.slug}
          style={secondaryStyle}
          onKeyDown={stopIfNeeded}
          onClick={(clickEvent) => {
            stopIfNeeded(clickEvent);
            void openPeopleNoteTarget(target);
          }}
          title={`${target.reason} · ${Math.round(target.confidence * 100)}%`}
        >
          {openingNoteTarget === target.slug ? (
            <Loader2 className={`${iconClassName} animate-spin`} />
          ) : (
            <NotebookPen className={iconClassName} />
          )}
          {eventNoteTargets.length > 1 ? `Notes: ${target.name}` : "Notes"}
        </button>
      ))}
      {event.providerUrl ? (
        <a
          href={event.providerUrl}
          target="_blank"
          rel="noreferrer"
          className={secondaryClassName}
          style={secondaryStyle}
          onKeyDown={stopIfNeeded}
          onClick={stopIfNeeded}
        >
          <ExternalLink className={iconClassName} />
          {providerLinkLabel(event.providerUrl, sourceLabel)}
        </a>
      ) : null}
    </div>
  );
}

function DescriptionSection({
  description,
  onToggleFull,
  showFull,
}: {
  description: CalendarDescriptionDisplay;
  onToggleFull: () => void;
  showFull: boolean;
}) {
  const hasHiddenDetails = Boolean(description.hidden);
  const text = showFull ? description.full : description.visible;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Description</div>
      <div
        className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-sm leading-6 text-[var(--text-secondary)]"
        data-testid="calendar-event-description"
      >
        {text ? <div className="whitespace-pre-wrap break-words">{text}</div> : null}
        {hasHiddenDetails ? (
          <button
            type="button"
            className={`${text ? "mt-3" : ""} inline-flex text-xs font-medium leading-5 text-[var(--interactive-default)] hover:text-[var(--interactive-hover)]`}
            onClick={onToggleFull}
          >
            {showFull ? "Hide full description" : "Show full description"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ icon, label }: { icon: ReactNode; label: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="mt-0.5 shrink-0 text-[var(--text-tertiary)]">{icon}</div>
      <div className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">{label}</div>
    </div>
  );
}

function providerLinkLabel(url: string, sourceLabel?: string | null): string {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)google\./.test(host)) return "Google";
    if (/(^|\.)(outlook|office|live|microsoft)\./.test(host)) return "Outlook";
  } catch {
    // Fall through to the source label.
  }
  return sourceLabel || "Link";
}

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  const day = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
  return `${day}, ${time.format(start)} - ${time.format(end)}`;
}
