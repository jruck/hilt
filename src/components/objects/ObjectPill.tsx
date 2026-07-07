"use client";

/**
 * ObjectPill (v3 unit B5) — the universal inline reference chip. Every surface that
 * name-drops a system object renders one of these; markdown reaches it through the
 * briefing's BriefingLink seam (`hilt:` URIs), other surfaces call it directly.
 *
 * Behavior contract:
 * - Render is ZERO network. The resolve fetch fires on OPEN (useObjectCard's enabled flag).
 * - Fine pointers: click toggles the popover (house ObjectPopover shell); the body is the
 *   resolved ObjectCard; the card's click-through navigates via useScope().navigateTo and
 *   closes. Loading = skeleton lines; failure = "Couldn't load this <kind>" (the pill keeps
 *   its label either way, and no nav = no click-through).
 * - Coarse pointers (checked at tap time via matchMedia): a tap resolves then navigates
 *   directly — no popover. nav:null or a failed resolve falls back to opening the popover
 *   so the tap never dead-ends silently.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { BookMarked, CalendarClock, FolderOpen, SquareCheck, UserRound, type LucideIcon } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import type { ObjectKind, ObjectNavTarget, ObjectRef, ResolvedObject } from "@/lib/objects/types";
import { meetingDateSegment } from "@/lib/briefing/canvas";
import { resolveObject, useObjectCard } from "@/hooks/useObjectCard";
import { ObjectPopover } from "./ObjectPopover";
import { ObjectCard } from "./ObjectCard";

const KIND_ICONS: Record<ObjectKind, LucideIcon> = {
  meeting: CalendarClock,
  task: SquareCheck,
  person: UserRound,
  project: FolderOpen,
  library: BookMarked,
};

export interface ObjectPillProps {
  refr: ObjectRef;
  /** Display label — the markdown link text. Falls back to the id's last segment. */
  children?: ReactNode;
  className?: string;
  /**
   * DATED vs DATELESS meeting pill (pill feedback, 2026-07-07): a meeting pill carries its
   * instance date INSIDE the chip ("Standup · Jul 7"; year appended when not the current year)
   * — an instance reference is the norm, so this defaults TRUE. Pass false for a series-level
   * reference (the meeting as a recurring thing, no specific note). Ignored for other kinds.
   * Derivation is pure + zero-fetch: the date comes from the ref id's `meetings/YYYY-MM-DD/…`
   * path segment (`meetingDateSegment`).
   */
  showDate?: boolean;
}

export function ObjectPill({ refr, children, className, showDate = true }: ObjectPillProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const { navigateTo } = useScope();
  const { resolved, error, isLoading } = useObjectCard(refr, open);
  const Icon = KIND_ICONS[refr.kind];
  const dateSegment = refr.kind === "meeting" && showDate ? meetingDateSegment(refr.id) : null;

  const navigate = useCallback((nav: ObjectNavTarget) => {
    navigateTo(nav.view, nav.scope);
    setOpen(false);
  }, [navigateTo]);

  const handleClick = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    // Coarse-pointer/mobile: plain tap navigates directly — no popover.
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      setBusy(true);
      try {
        const result = await resolveObject(refr);
        if (result.nav) {
          navigateTo(result.nav.view, result.nav.scope);
          return;
        }
      } catch {
        // Fall through — the popover renders the graceful error body.
      } finally {
        setBusy(false);
      }
    }
    setOpen(true);
  }, [open, refr, navigateTo]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={className ? `hilt-object-pill ${className}` : "hilt-object-pill"}
        // stopPropagation: pills render inside clickable containers (CollapsibleItem headlines,
        // MeetingCard summaries) — without it a pill click also toggles the parent expansion,
        // exactly what the anchor branch it replaces guarded against.
        onClick={(event) => { event.stopPropagation(); void handleClick(); }}
        aria-expanded={open}
        aria-busy={busy || undefined}
        data-object-kind={refr.kind}
        data-testid="object-pill"
      >
        <Icon className="hilt-object-pill-icon" aria-hidden />
        <span className="hilt-object-pill-label">{children ?? fallbackLabel(refr)}</span>
        {dateSegment ? (
          <span className="hilt-object-pill-date" data-testid="object-pill-date">· {dateSegment}</span>
        ) : null}
      </button>
      {open ? (
        <ObjectPopover anchorRef={anchorRef} onClose={() => setOpen(false)}>
          {resolved ? (
            <ResolvedCard resolved={resolved} onNavigate={navigate} />
          ) : isLoading ? (
            <PopoverSkeleton />
          ) : error ? (
            <div className="px-1 py-0.5 text-xs text-[var(--text-tertiary)]" data-testid="object-popover-error">
              Couldn&apos;t load this {refr.kind}
            </div>
          ) : (
            <PopoverSkeleton />
          )}
        </ObjectPopover>
      ) : null}
    </>
  );
}

function ResolvedCard({ resolved, onNavigate }: { resolved: ResolvedObject; onNavigate: (nav: ObjectNavTarget) => void }) {
  const nav = resolved.nav;
  return <ObjectCard card={resolved.card} onOpen={nav ? () => onNavigate(nav) : undefined} />;
}

/** Last id segment (minus a trailing .md) so a bare pill still says something human. */
function fallbackLabel(refr: ObjectRef): string {
  const segment = refr.id.split("/").filter(Boolean).pop() ?? refr.id;
  return segment.replace(/\.md$/i, "") || refr.kind;
}

function PopoverSkeleton() {
  return (
    <div className="space-y-2 px-1 py-0.5" aria-hidden data-testid="object-popover-loading">
      <div className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--bg-tertiary)]" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--bg-tertiary)]" />
    </div>
  );
}
