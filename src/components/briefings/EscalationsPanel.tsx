"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { CommentPopover } from "@/components/comments/CommentPopover";
import { mutateThreadsForTarget } from "@/components/threads/ThreadView";
import { useVerdictNote, VerdictNoteField, VerdictNoteTrigger } from "@/components/comments/VerdictNoteField";
import type { Citation, LoopItem, RegistryLoop, Verdict, VerdictRecord } from "@/lib/loops/types";
import { meetingLabelFromRelPath } from "@/lib/briefing/canvas";
import { askToTaskFile } from "@/lib/tasks/meeting-next-steps";
import { parseOwnerPrefix } from "@/lib/tasks/owner";
import { ObjectPill } from "@/components/objects/ObjectPill";
import { OwnerChip, TaskCard } from "@/components/tasks/TaskCard";
import { requestTaskOpen } from "@/lib/tasks/deeplink";
import type { TaskFile } from "@/lib/tasks/types";
import { MeetingCard, useExpandSignal, type ExpandSignal } from "./MeetingCard";

export type EscalatedLoopItem = LoopItem & {
  loop_phase: RegistryLoop["phase"];
  artifact_date: string;
  verdict?: Verdict;
};

/** BriefingContent's shared verdict wire (canvas.makeVerdictHandler) threaded down so the
 * unfeatured meeting cards post through the SAME /api/loops/verdicts handler as the featured
 * lane. Returns undefined when the object carries no verdict join (read-only card). */
export type MakeVerdictHandler = (
  loop?: string,
  itemId?: string,
) => ((verdict: Verdict, note?: string) => Promise<void>) | undefined;

interface EscalationsResponse {
  loops: Array<{ id: string; phase: RegistryLoop["phase"]; artifact_date: string }>;
  items: EscalatedLoopItem[];
  errors: Array<{ loop?: string; phase?: RegistryLoop["phase"]; message: string }>;
}

/** Which briefing section owns each loop's escalations — FALLBACK ONLY. The primary join is the
 * briefing's own `loop:<id>` citations (see BriefingContent); this map covers briefings that
 * don't cite an escalating loop. Entries may repeat per loop in PRIORITY order: since B3,
 * unfeatured meeting asks prefer the ⏭ Next steps section (the canvas home for pending meeting
 * proposals) and fall back to 🧠 for pre-B3 briefings that have no ⏭ section. */
const LOOP_SECTION_PATTERNS: Array<{ loop: string; pattern: RegExp }> = [
  { loop: "meeting-actions", pattern: /⏭/ },
  { loop: "meeting-actions", pattern: /don.?t\s+drop/i },
  { loop: "runtime", pattern: /system/i },
  { loop: "goals-areas", pattern: /work|goal/i },
  { loop: "library", pattern: /library/i },
];

/** First section (by the loop's pattern priority, then section order) that owns this loop's
 * unfeatured escalations. -1 = none → the fallback fold. */
export function sectionIndexForLoop(loopId: string, headings: string[]): number {
  for (const entry of LOOP_SECTION_PATTERNS) {
    if (entry.loop !== loopId) continue;
    const index = headings.findIndex((heading) => entry.pattern.test(heading));
    if (index !== -1) return index;
  }
  return -1;
}

export function useEscalations(): { items: EscalatedLoopItem[]; mutate: () => void } {
  const { data, mutate } = useSWR<EscalationsResponse>("/api/loops/escalations", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
  // SWR keeps `data` from the last good fetch on error — use it. Discarding to [] on a
  // transient poll failure made whole sections vanish for a refresh interval (the B2 meeting
  // Next-steps accordion flickered out for 60s on one failed poll) and re-appear.
  return { items: data?.items || [], mutate: () => void mutate() };
}

// Aligned with TaskCard's VERDICT_BUTTONS (B5): Approve / Assign to agent / Dismiss / Revise —
// one verdict vocabulary everywhere an ask renders. `assign_to_me` leaves the VISIBLE set only
// (approve already means "mine"); the API keeps accepting it and its badge still renders.
const visibleVerdicts: Array<{ verdict: Verdict; label: string }> = [
  { verdict: "approve", label: "Approve" },
  { verdict: "assign_to_agent", label: "Assign to agent" },
  { verdict: "dismiss", label: "Dismiss" },
];

const fetcher = async (url: string): Promise<EscalationsResponse> => {
  const response = await fetch(withBasePath(url), { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<EscalationsResponse>;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(withBasePath(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload as T;
}

/** Verdicts attach to ASKS (actions & proposals) — a property of the item's kind, NOT of
 * escalation. Any surface rendering an ask shows verdict controls, escalated or not. */
function isAsk(item: LoopItem): boolean {
  return item.kind === "action" || item.kind === "proposal";
}

function verdictLabel(verdict: Verdict): string {
  return visibleVerdicts.find((entry) => entry.verdict === verdict)?.label
    ?? verdict.replace(/_/g, " ");
}

/** Decided-state badge text — past tense. The imperative button labels ("Dismiss") on a badge
 * read as available ACTIONS ("the button itself says dismiss which suggests it wasn't
 * dismissed" — Justin, 2026-07-07). */
function verdictBadgeLabel(verdict: Verdict): string {
  if (verdict === "approve") return "Approved";
  if (verdict === "dismiss") return "Dismissed";
  if (verdict === "assign_to_me") return "Assigned to me";
  if (verdict === "assign_to_agent") return "Assigned to agent";
  if (verdict === "revise") return "Revision sent";
  return verdictLabel(verdict);
}

function verdictBadgeClass(verdict: Verdict): string {
  if (verdict === "approve") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (verdict === "dismiss") return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
  if (verdict === "revise") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300";
}

function formatCitation(citations: Citation[]): string | null {
  const first = citations[0];
  if (!first) return null;
  const parts = [first.source, first.date, first.anchor].filter(Boolean);
  const suffix = citations.length > 1 ? ` +${citations.length - 1}` : "";
  return `${parts.join(" - ")}${suffix}`;
}

/** First citation whose source is a vault meeting note path — that one renders as a meeting
 * ObjectPill (B5) instead of the raw path; anything else keeps the plain formatCitation text. */
function firstMeetingCitationSource(citations: Citation[]): string | null {
  const cite = citations.find((c) => /^meetings\/\d{4}-\d{2}-\d{2}\/[^\n]+\.md$/.test(c.source || ""));
  return cite?.source ?? null;
}

/** "meetings/2026-07-05/Floyds sync-….md" → "Floyds sync" (the pill's label). The DATED pill
 * renders its own integrated "· Jul 5" segment now — an ISO date in the label would double it. */
function meetingCitationLabel(rel: string): string {
  return meetingLabelFromRelPath(rel).title;
}

function DetailMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose max-w-none text-xs prose-p:my-1 prose-p:text-[var(--text-secondary)] prose-li:text-[var(--text-secondary)] prose-ul:my-1 prose-ol:my-1 prose-strong:text-[var(--text-primary)] prose-a:text-[var(--interactive-default)] [&_a:hover]:text-[var(--interactive-hover)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer" : undefined}
            >
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** Parse the source meeting out of an item's first citation ("meetings/<date>/<name>.md ...").
 * `rel` is the full vault-relative note path (the whole `meetings/….md` match, prefix-agnostic) —
 * the id a meeting ObjectPill needs, where `key` is only the dedupe/group key. */
function meetingKey(item: EscalatedLoopItem): { key: string; date: string; title: string; rel: string } | null {
  const source = item.citations?.[0]?.source || "";
  const match = source.match(/meetings\/(\d{4}-\d{2}-\d{2})\/([^/]+?)(?:-\d{4}-\d{2}-\d{2}[^/]*)?\.md/);
  if (!match) return null;
  return { key: `${match[1]}/${match[2]}`, date: match[1], title: match[2], rel: match[0] };
}

export function escalationsSummary(items: EscalatedLoopItem[]): string {
  const askCount = items.filter((item) => item.loop === "meeting-actions" && meetingKey(item)).length;
  const meetingCount = new Set(items.map((item) => item.loop === "meeting-actions" ? meetingKey(item)?.key : null).filter(Boolean)).size;
  const signalCount = items.length - askCount;
  return [
    askCount > 0 ? `${askCount} ${askCount === 1 ? "ask" : "asks"} from ${meetingCount} ${meetingCount === 1 ? "meeting" : "meetings"}` : null,
    signalCount > 0 ? `${signalCount} ${signalCount === 1 ? "signal" : "signals"}` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * The verdict affordance for one ASK — buttons while pending, badge once decided, inline revise
 * form. Exported so the SAME control attaches to an editor-written briefing bullet (id-stamped
 * line) or to a raw appended row: the affordance follows the item, not the rendering site.
 */
export function AskVerdictControls({ item, onChanged, vertical = false }: { item: EscalatedLoopItem; onChanged: () => void; vertical?: boolean }) {
  const [localVerdict, setLocalVerdict] = useState<Verdict | undefined>(item.verdict);
  const [busyVerdict, setBusyVerdict] = useState<Verdict | null>(null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  // The unified note (gate-B comment primitive): typed text rides ANY verdict click as its
  // note in the same POST; the field's own Send posts it as a pure comment (no decision).
  const noteControl = useVerdictNote();
  const allowed = useMemo(() => new Set(item.allowed_verdicts || []), [item.allowed_verdicts]);
  const verdictButtons = visibleVerdicts.filter((entry) => allowed.size === 0 || allowed.has(entry.verdict));

  useEffect(() => {
    setLocalVerdict(item.verdict);
  }, [item.id, item.verdict]);

  async function submitVerdict(verdict: Verdict, note?: string) {
    const previousVerdict = localVerdict;
    setBusyVerdict(verdict);
    setVerdictError(null);
    setLocalVerdict(verdict);
    try {
      const record = await postJson<VerdictRecord>("/api/loops/verdicts", {
        loop: item.loop,
        item_id: item.id,
        verdict,
        note,
      });
      setLocalVerdict(record.verdict);
      noteControl.reset();
      // A note riding the verdict lands in the thread store — refresh the row's count pill
      // (and any open popover) through the same mutate path posts use (W1).
      if (note?.trim()) {
        void mutateThreadsForTarget({ kind: "loop-item", loop: item.loop, itemId: item.id, artifactDate: item.artifact_date });
      }
      onChanged();
    } catch (error) {
      setLocalVerdict(previousVerdict);
      setVerdictError(error instanceof Error ? error.message : "Failed to save verdict");
    } finally {
      setBusyVerdict(null);
    }
  }

  if (!isAsk(item)) return null;

  const buttons = !localVerdict && verdictButtons.length > 0 && (
    <div className={vertical ? "flex flex-col items-stretch gap-1" : "flex flex-wrap items-center gap-1.5 pb-1"}>
      {verdictButtons.map((entry) => (
        <button
          key={entry.verdict}
          type="button"
          // Revise still needs its note; any OTHER verdict simply carries whatever is typed.
          onClick={() => void submitVerdict(entry.verdict, noteControl.noteText)}
          disabled={Boolean(busyVerdict)}
          className={`inline-flex min-h-6 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60 ${vertical ? "justify-start whitespace-nowrap" : ""}`}
        >
          {entry.label}
        </button>
      ))}
      <VerdictNoteTrigger control={noteControl} vertical={vertical} />
    </div>
  );

  const badge = localVerdict && (
    <div className={vertical ? "" : "pb-1"}>
      <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${verdictBadgeClass(localVerdict)}`}>
        {verdictBadgeLabel(localVerdict)}
      </span>
    </div>
  );

  const noteField = !localVerdict && (
    <VerdictNoteField
      control={noteControl}
      // task_id-bearing asks target their TASK so the comment dual-writes (drawer + visible
      // file note-line); pre-A6 asks without a file stay drawer-only.
      target={item.task_id
        ? { kind: "task", id: item.task_id }
        : { kind: "loop-item", loop: item.loop, itemId: item.id, artifactDate: item.artifact_date }}
      busy={Boolean(busyVerdict)}
      vertical={vertical}
      className={vertical ? undefined : "flex items-center gap-2 pb-1"}
      // Pure-comment Send threads on the origin loop-item (postComment routing) — refresh the
      // row's anchor so its count pill / open popover pick the note up (W1).
      onPosted={() => void mutateThreadsForTarget({ kind: "loop-item", loop: item.loop, itemId: item.id, artifactDate: item.artifact_date })}
    />
  );

  const error = verdictError && <p className={vertical ? "w-56 text-xs text-red-500" : "pb-1 text-xs text-red-500"}>{verdictError}</p>;

  return <>{buttons}{badge}{noteField}{error}</>;
}

/**
 * The floating placement (Justin, 2026-07-03): verdict controls live OFF the card on the canvas,
 * stacked vertically, vertically centered on the item's line, revealed on hover like the feedback
 * affordance — they never influence the body's width. Below lg (no canvas margin) they fall back
 * to the inline horizontal row so touch devices keep a working affordance.
 */
export function FloatingAskControls({ item, onChanged }: { item: EscalatedLoopItem; onChanged: () => void }) {
  if (!isAsk(item)) return null;
  return (
    <>
      <span className="absolute left-full top-1/2 z-10 hidden -translate-y-1/2 pl-6 lg:group-hover/askrow:block">
        <AskVerdictControls item={item} onChanged={onChanged} vertical />
      </span>
      <span className="lg:hidden">
        <AskVerdictControls item={item} onChanged={onChanged} />
      </span>
    </>
  );
}

/**
 * ONE item model, one rendering (Justin, 2026-07-02): a loop item is a bullet like any other
 * briefing bullet. Urgency (escalated) adds only an amber flag; verdict buttons follow ASK-ness
 * (kind), not escalation. Everything else (citation, confidence, loop, reason) lives behind the
 * same click-to-expand pattern as editorial bullets.
 */
function LoopItemRow({ item, onChanged, expandSignal }: { item: EscalatedLoopItem; onChanged: () => void; expandSignal?: ExpandSignal }) {
  const [expanded, setExpanded] = useState(false);
  useExpandSignal(expandSignal, setExpanded);
  const citation = formatCitation(item.citations);
  const meetingCitationRel = firstMeetingCitationSource(item.citations);
  const confidence = typeof item.confidence === "number"
    ? `${Math.round(item.confidence * 100)}%`
    : null;
  // The `[unclear] …` / `[other:Name] …` title prefix renders as a chip, matching TaskCard —
  // the raw artifact/briefing markdown keeps the bracket; only the app strips it.
  const { title: displayTitle, owner } = parseOwnerPrefix(item.title);

  return (
    <li className={`group/askrow relative text-[var(--text-secondary)] briefing-expandable${expanded ? " briefing-expanded" : ""}${item.escalated ? " briefing-escalated" : ""}`}>
      <div
        onClick={() => setExpanded((value) => !value)}
        className="group flex flex-wrap items-start justify-between gap-2 py-0.5 cursor-pointer"
      >
        <span className="min-w-0 flex-1 leading-relaxed" title={item.escalated ? `Escalated: ${item.escalated.reason || "urgent"}` : undefined}>
          {displayTitle}
          <OwnerChip owner={owner} className="ml-1.5 align-middle" />
        </span>
        <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-0.5">
          {/* The W1 comment gesture: floating popover — no full-width form row, no fade-while-
              typing hazard. Always the loop-item anchor: postComment routes a task target to its
              ORIGIN loop-item anyway (for minted asks origin === this item), so reading/counting
              on the loop-item keeps the popover's history and pill on the thread the write hits. */}
          <CommentPopover
            compact
            hoverReveal
            target={{ kind: "loop-item", loop: item.loop, itemId: item.id, artifactDate: item.artifact_date }}
            placeholder="Feedback"
            triggerTitle="Leave feedback"
          />
        </span>
      </div>

      {/* Asks carry their verdict controls — kind decides this, not escalation. Floating off the
          card's right edge on hover (lg+); inline row below lg. */}
      <FloatingAskControls item={item} onChanged={onChanged} />

      {expanded && (
        <div className="mb-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 space-y-1">
          {item.detail && <DetailMarkdown markdown={item.detail} />}
          {item.escalated?.reason && (
            <p className="text-xs leading-5 text-[var(--text-secondary)]">Escalated: {item.escalated.reason}</p>
          )}
          {citation && (
            meetingCitationRel ? (
              // The meeting citation is an object, not a path: pill (preview + click-through),
              // full formatCitation kept as the tooltip, extra citations as a plain "+N".
              <p className="text-xs text-[var(--text-tertiary)]" title={citation}>
                <ObjectPill refr={{ kind: "meeting", id: meetingCitationRel }}>
                  {meetingCitationLabel(meetingCitationRel)}
                </ObjectPill>
                {item.citations.length > 1 && (
                  <span className="ml-1.5 italic">+{item.citations.length - 1}</span>
                )}
              </p>
            ) : (
              <p className="text-xs italic text-[var(--text-tertiary)]" title={citation}>{citation}</p>
            )
          )}
          <p className="text-xs text-[var(--text-tertiary)]">
            {item.kind} · {item.loop} ({item.loop_phase}) · {item.artifact_date}{confidence ? ` · confidence ${confidence}` : ""}
          </p>
        </div>
      )}
    </li>
  );
}

/** One source meeting's asks: a collapsed bullet row that expands into nested ask bullets —
 * progressive disclosure inside the section's own list. */
function MeetingGroupRow({ date, title, items, defaultOpen, onChanged, expandSignal }: {
  date: string;
  title: string;
  items: EscalatedLoopItem[];
  defaultOpen: boolean;
  onChanged: () => void;
  expandSignal?: ExpandSignal;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useExpandSignal(expandSignal, setOpen);
  const decided = items.filter((item) => item.verdict).length;
  const status = decided > 0 ? `${decided}/${items.length} decided` : `${items.length} ${items.length === 1 ? "ask" : "asks"}`;
  return (
    <li className={`text-[var(--text-secondary)] briefing-escalated briefing-expandable${open ? " briefing-expanded" : ""}`}>
      <div
        onClick={() => setOpen((value) => !value)}
        className="group flex items-start justify-between gap-2 py-0.5 cursor-pointer"
      >
        <span className="min-w-0 flex-1 leading-relaxed" title="Awaiting your verdicts">
          <strong className="font-semibold text-[var(--text-primary)]">{title}</strong>
          {" — "}{status} <span className="text-xs text-[var(--text-tertiary)]">· {date}</span>
        </span>
        <span className="mt-1 shrink-0 text-[var(--text-tertiary)]">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </div>
      {open && (
        <ul className="briefing-list pl-5 space-y-0.5 pb-1">
          {items.map((item) => (
            <LoopItemRow
              key={`${item.loop}:${item.id}:${item.artifact_date}`}
              item={item}
              onChanged={onChanged}
              expandSignal={expandSignal}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** UNFEATURED meeting-ask group in the ⏭ Next steps section: the SAME MeetingCard shell the
 * editor-featured entries use, so the section reads as one list of meeting cards. No editor
 * substance lead exists for an unfeatured group, so the header is just the DATED meeting pill
 * (wrapped in <strong> — the heading-grade pill form the featured `**[pill]**` headlines get) +
 * the shell's own "N pending" count. The interior is the featured lane's, too: every ask is a
 * TaskCard — the live task FILE when the item's task_id resolves (openable, like the featured
 * join), the askToTaskFile synthesis when it doesn't (pre-A6 asks, or the tasks list still
 * hydrating — both stay decidable). LoopItemRow survives only for non-ask items. */
function MeetingGroupCard({ date, title, rel, items, defaultOpen, onChanged, expandSignal, taskById, makeVerdictHandler }: {
  date: string;
  title: string;
  rel: string;
  items: EscalatedLoopItem[];
  defaultOpen: boolean;
  onChanged: () => void;
  expandSignal?: ExpandSignal;
  taskById?: Map<string, TaskFile>;
  makeVerdictHandler?: MakeVerdictHandler;
}) {
  const asks = items.filter(isAsk);
  const rows = items.filter((item) => !isAsk(item));
  return (
    <MeetingCard
      title={title}
      date={date}
      pendingCount={items.filter((item) => !item.verdict).length}
      defaultOpen={defaultOpen}
      expandSignal={expandSignal}
      summary={(
        // ObjectPill stops its own click propagation, so the pill opens its popover without
        // toggling the card. NOT passing meetingRel: the summary IS the pill — the shell's
        // structural header pill would be a duplicate.
        <strong className="font-semibold text-[var(--text-primary)]">
          <ObjectPill refr={{ kind: "meeting", id: rel }}>{title}</ObjectPill>
        </strong>
      )}
    >
      {asks.map((item) => {
        const task = item.task_id ? taskById?.get(item.task_id) : undefined;
        return (
          <TaskCard
            key={`${item.loop}:${item.id}:${item.artifact_date}`}
            flush
            hideMeeting
            task={task ?? askToTaskFile(item, rel)}
            verdict={item.verdict}
            onVerdict={item.verdict ? undefined : makeVerdictHandler?.(item.loop, item.id)}
            onOpen={task ? () => requestTaskOpen(task.id) : undefined}
          />
        );
      })}
      {rows.length > 0 && (
        <ul className="briefing-list space-y-0.5">
          {rows.map((item) => (
            <LoopItemRow
              key={`${item.loop}:${item.id}:${item.artifact_date}`}
              item={item}
              onChanged={onChanged}
              expandSignal={expandSignal}
            />
          ))}
        </ul>
      )}
    </MeetingCard>
  );
}

/** Loop items for one section, rendered as <li> rows INSIDE the section's existing list —
 * standalone items flat, meeting asks grouped by source meeting. When the owning section is
 * ⏭ Next steps (`asMeetingCards`), each group renders in the MeetingCard shell instead of the
 * pre-pill MeetingGroupRow, matching the featured entries; other sections keep the row form. */
export function EscalationsBlock({ items, onChanged, asMeetingCards = false, expandSignal, taskById, makeVerdictHandler }: {
  items: EscalatedLoopItem[];
  onChanged: () => void;
  asMeetingCards?: boolean;
  /** The owning section's expand-all / collapse-all broadcast (BriefingContent header button). */
  expandSignal?: ExpandSignal;
  /** The canvas task join + verdict wire (BriefingContent) — meeting-card groups render their
   * asks as TaskCards through these; absent (fallback fold), groups keep the row form. */
  taskById?: Map<string, TaskFile>;
  makeVerdictHandler?: MakeVerdictHandler;
}) {
  const { standalone, meetingGroups } = useMemo(() => {
    const standaloneItems: EscalatedLoopItem[] = [];
    const groups = new Map<string, { date: string; title: string; rel: string; items: EscalatedLoopItem[] }>();
    for (const item of items) {
      const meeting = item.loop === "meeting-actions" ? meetingKey(item) : null;
      if (!meeting) {
        standaloneItems.push(item);
        continue;
      }
      const existing = groups.get(meeting.key);
      if (existing) existing.items.push(item);
      else groups.set(meeting.key, { date: meeting.date, title: meeting.title, rel: meeting.rel, items: [item] });
    }
    // Newest meeting first — mirrors "recent asks are the verdict-worthy ones".
    const sorted = [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
    return { standalone: standaloneItems, meetingGroups: sorted };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <>
      {standalone.map((item) => (
        <LoopItemRow
          key={`${item.loop}:${item.id}:${item.artifact_date}`}
          item={item}
          onChanged={onChanged}
          expandSignal={expandSignal}
        />
      ))}
      {meetingGroups.map((group, index) => {
        const defaultOpen = meetingGroups.length === 1 && index === 0 && group.items.length <= 5;
        return asMeetingCards ? (
          <MeetingGroupCard
            key={group.date + group.title}
            date={group.date}
            title={group.title}
            rel={group.rel}
            items={group.items}
            defaultOpen={defaultOpen}
            onChanged={onChanged}
            expandSignal={expandSignal}
            taskById={taskById}
            makeVerdictHandler={makeVerdictHandler}
          />
        ) : (
          <MeetingGroupRow
            key={group.date + group.title}
            date={group.date}
            title={group.title}
            items={group.items}
            defaultOpen={defaultOpen}
            onChanged={onChanged}
            expandSignal={expandSignal}
          />
        );
      })}
    </>
  );
}

/** Fallback fold: ONLY for escalations whose loop has no matching briefing section — nothing may
 * silently disappear. With every loop mapped, this usually renders nothing. */
export function EscalationsFallbackFold({ items, onChanged }: {
  items: EscalatedLoopItem[];
  onChanged: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-5 hilt-card hilt-card-static overflow-visible">
      <div className="rounded-t-lg border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">
              Needs you
            </h2>
          </div>
          <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{escalationsSummary(items)}</span>
        </div>
      </div>
      <ul className="briefing-list pl-9 pr-4 py-2 space-y-0 !m-0">
        <EscalationsBlock items={items} onChanged={onChanged} />
      </ul>
    </section>
  );
}
