"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Check, ChevronDown, ChevronRight, MessageSquare, Send, X } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { Citation, LoopItem, RegistryLoop, Verdict, VerdictRecord, FeedbackRecord } from "@/lib/loops/types";
import { parseOwnerPrefix } from "@/lib/tasks/owner";
import { OwnerChip } from "@/components/tasks/TaskCard";

export type EscalatedLoopItem = LoopItem & {
  loop_phase: RegistryLoop["phase"];
  artifact_date: string;
  verdict?: Verdict;
};

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

const visibleVerdicts: Array<{ verdict: Verdict; label: string }> = [
  { verdict: "approve", label: "Approve" },
  { verdict: "dismiss", label: "Dismiss" },
  { verdict: "assign_to_me", label: "Assign to me" },
  { verdict: "revise", label: "Revise" },
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

/** Parse the source meeting out of an item's first citation ("meetings/<date>/<name>.md ..."). */
function meetingKey(item: EscalatedLoopItem): { key: string; date: string; title: string } | null {
  const source = item.citations?.[0]?.source || "";
  const match = source.match(/meetings\/(\d{4}-\d{2}-\d{2})\/([^/]+?)(?:-\d{4}-\d{2}-\d{2}[^/]*)?\.md/);
  if (!match) return null;
  return { key: `${match[1]}/${match[2]}`, date: match[1], title: match[2] };
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
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState("");
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
      setReviseOpen(false);
      setReviseNote("");
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
          onClick={() => entry.verdict === "revise" ? setReviseOpen((value) => !value) : void submitVerdict(entry.verdict)}
          disabled={Boolean(busyVerdict)}
          className={`inline-flex min-h-6 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60 ${vertical ? "justify-start whitespace-nowrap" : ""}`}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  const badge = localVerdict && (
    <div className={vertical ? "" : "pb-1"}>
      <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${verdictBadgeClass(localVerdict)}`}>
        {verdictBadgeLabel(localVerdict)}
      </span>
    </div>
  );

  const reviseForm = reviseOpen && !localVerdict && (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const note = reviseNote.trim();
        if (!note) return;
        void submitVerdict("revise", note);
      }}
      className={vertical ? "flex w-56 flex-col gap-1" : "flex items-center gap-2 pb-1"}
    >
      <input
        value={reviseNote}
        onChange={(event) => setReviseNote(event.target.value)}
        autoFocus
        className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
        placeholder="Revision note"
        aria-label="Revision note"
      />
      <button
        type="submit"
        disabled={!reviseNote.trim() || Boolean(busyVerdict)}
        className="inline-flex min-h-8 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-50 dark:text-amber-300"
      >
        Revise
      </button>
    </form>
  );

  const error = verdictError && <p className={vertical ? "w-56 text-xs text-red-500" : "pb-1 text-xs text-red-500"}>{verdictError}</p>;

  return <>{buttons}{badge}{reviseForm}{error}</>;
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
function LoopItemRow({ item, onChanged }: { item: EscalatedLoopItem; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const citation = formatCitation(item.citations);
  const confidence = typeof item.confidence === "number"
    ? `${Math.round(item.confidence * 100)}%`
    : null;
  // The `[unclear] …` / `[other:Name] …` title prefix renders as a chip, matching TaskCard —
  // the raw artifact/briefing markdown keeps the bracket; only the app strips it.
  const { title: displayTitle, owner } = parseOwnerPrefix(item.title);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = feedbackText.trim();
    if (!text) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      await postJson<FeedbackRecord>("/api/loops/feedback", {
        loop: item.loop,
        target: {
          level: "item",
          item_id: item.id,
          artifact_date: item.artifact_date,
        },
        text: feedbackText.trim(),
      });
      setFeedbackText("");
      setFeedbackOpen(false);
      setFeedbackSaved(true);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Failed to save feedback");
    } finally {
      setFeedbackBusy(false);
    }
  }

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
        <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => setFeedbackOpen((value) => !value)}
            className={`inline-flex min-h-6 min-w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-secondary)] ${
              feedbackSaved ? "text-emerald-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
            title={feedbackSaved ? "Feedback saved" : "Leave feedback"}
            aria-label={feedbackSaved ? "Feedback saved" : "Leave feedback"}
          >
            {feedbackSaved ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          </button>
        </span>
      </div>

      {/* Asks carry their verdict controls — kind decides this, not escalation. Floating off the
          card's right edge on hover (lg+); inline row below lg. */}
      <FloatingAskControls item={item} onChanged={onChanged} />

      {feedbackOpen && (
        <form onSubmit={submitFeedback} className="flex items-center gap-2 pb-1">
          <input
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            autoFocus
            className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            placeholder="Feedback"
            aria-label="Feedback"
          />
          <button
            type="submit"
            disabled={!feedbackText.trim() || feedbackBusy}
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
            title="Save feedback"
            aria-label="Save feedback"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFeedbackOpen(false)}
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            title="Close feedback"
            aria-label="Close feedback"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}

      {feedbackError && <p className="pb-1 text-xs text-red-500">{feedbackError}</p>}

      {expanded && (
        <div className="mb-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 space-y-1">
          {item.detail && <DetailMarkdown markdown={item.detail} />}
          {item.escalated?.reason && (
            <p className="text-xs leading-5 text-[var(--text-secondary)]">Escalated: {item.escalated.reason}</p>
          )}
          {citation && (
            <p className="text-xs italic text-[var(--text-tertiary)]" title={citation}>{citation}</p>
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
function MeetingGroupRow({ date, title, items, defaultOpen, onChanged }: {
  date: string;
  title: string;
  items: EscalatedLoopItem[];
  defaultOpen: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Loop items for one section, rendered as <li> rows INSIDE the section's existing list —
 * standalone items flat, meeting asks grouped by source meeting. */
export function EscalationsBlock({ items, onChanged }: {
  items: EscalatedLoopItem[];
  onChanged: () => void;
}) {
  const { standalone, meetingGroups } = useMemo(() => {
    const standaloneItems: EscalatedLoopItem[] = [];
    const groups = new Map<string, { date: string; title: string; items: EscalatedLoopItem[] }>();
    for (const item of items) {
      const meeting = item.loop === "meeting-actions" ? meetingKey(item) : null;
      if (!meeting) {
        standaloneItems.push(item);
        continue;
      }
      const existing = groups.get(meeting.key);
      if (existing) existing.items.push(item);
      else groups.set(meeting.key, { date: meeting.date, title: meeting.title, items: [item] });
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
        />
      ))}
      {meetingGroups.map((group, index) => (
        <MeetingGroupRow
          key={group.date + group.title}
          date={group.date}
          title={group.title}
          items={group.items}
          defaultOpen={meetingGroups.length === 1 && index === 0 && group.items.length <= 5}
          onChanged={onChanged}
        />
      ))}
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
