"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Check, ChevronDown, ChevronRight, MessageSquare, PencilLine, Send, X } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { Citation, LoopItem, RegistryLoop, Verdict, VerdictRecord, FeedbackRecord } from "@/lib/loops/types";

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

/** Which briefing section owns each loop's escalations (Justin, 2026-07-02: escalations nest in
 * their sections — the top fold survives only as a fallback for loops with no matching section). */
const LOOP_SECTION_PATTERNS: Array<{ loop: string; pattern: RegExp }> = [
  { loop: "meeting-actions", pattern: /don.?t\s+drop/i },
  { loop: "runtime", pattern: /system/i },
  { loop: "goals-areas", pattern: /work|goal/i },
  { loop: "library", pattern: /library/i },
];

export function loopMatchesSection(loopId: string, heading: string): boolean {
  const entry = LOOP_SECTION_PATTERNS.find((candidate) => candidate.loop === loopId);
  return entry ? entry.pattern.test(heading) : false;
}

export function useEscalations(): { items: EscalatedLoopItem[]; mutate: () => void } {
  const { data, error, mutate } = useSWR<EscalationsResponse>("/api/loops/escalations", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
  return { items: error ? [] : (data?.items || []), mutate: () => void mutate() };
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

function isAsk(item: LoopItem): boolean {
  return item.kind === "action" || item.kind === "proposal";
}

function verdictLabel(verdict: Verdict): string {
  return visibleVerdicts.find((entry) => entry.verdict === verdict)?.label
    ?? verdict.replace(/_/g, " ");
}

function verdictBadgeClass(verdict: Verdict): string {
  if (verdict === "approve") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (verdict === "dismiss") return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
  if (verdict === "revise") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300";
}

function kindBadgeClass(kind: LoopItem["kind"]): string {
  if (kind === "action") return "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300";
  if (kind === "proposal") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
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
    <div className="prose max-w-none text-xs prose-p:my-1 prose-p:text-[var(--text-secondary)] prose-li:text-[var(--text-secondary)] prose-ul:my-1 prose-ol:my-1 prose-strong:text-[var(--text-primary)] prose-a:text-[var(--interactive-default)] hover:prose-a:text-[var(--interactive-hover)]">
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

function EscalationItemCard({ item, onChanged }: { item: EscalatedLoopItem; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [localVerdict, setLocalVerdict] = useState<Verdict | undefined>(item.verdict);
  const [busyVerdict, setBusyVerdict] = useState<Verdict | null>(null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const hasDetail = Boolean(item.detail?.trim());
  const citation = formatCitation(item.citations);
  const ask = isAsk(item);
  const confidence = typeof item.confidence === "number"
    ? `${Math.round(item.confidence * 100)}%`
    : null;
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
        text,
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
    <article className="border-t border-[var(--border-default)] first:border-t-0">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none ${kindBadgeClass(item.kind)}`}>
            {item.kind}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h3 className="min-w-0 text-sm font-semibold leading-5 text-[var(--text-primary)]">
                {item.title}
              </h3>
              <button
                type="button"
                onClick={() => setFeedbackOpen((value) => !value)}
                className={`inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-secondary)] ${
                  feedbackSaved ? "text-emerald-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
                title={feedbackSaved ? "Feedback saved" : "Leave feedback"}
                aria-label={feedbackSaved ? "Feedback saved" : "Leave feedback"}
              >
                {feedbackSaved ? <Check className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-tertiary)]">
              <span>{item.loop}</span>
              <span>{item.loop_phase}</span>
              <span>{item.artifact_date}</span>
              {confidence && <span>confidence {confidence}</span>}
            </div>

            {citation && (
              <p className="truncate text-xs italic text-[var(--text-tertiary)]" title={citation}>
                {citation}
              </p>
            )}

            {item.escalated?.reason && (
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                {item.escalated.reason}
              </p>
            )}

            {hasDetail && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="inline-flex min-h-6 items-center gap-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Detail
              </button>
            )}

            {expanded && item.detail && (
              <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
                <DetailMarkdown markdown={item.detail} />
              </div>
            )}

            {ask && localVerdict && (
              <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${verdictBadgeClass(localVerdict)}`}>
                {verdictLabel(localVerdict)}
              </span>
            )}

            {ask && !localVerdict && verdictButtons.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {verdictButtons.map((entry) => (
                  entry.verdict === "revise" ? (
                    <button
                      key={entry.verdict}
                      type="button"
                      onClick={() => setReviseOpen((value) => !value)}
                      disabled={Boolean(busyVerdict)}
                      className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60"
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      {entry.label}
                    </button>
                  ) : (
                    <button
                      key={entry.verdict}
                      type="button"
                      onClick={() => void submitVerdict(entry.verdict)}
                      disabled={Boolean(busyVerdict)}
                      className="inline-flex min-h-7 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60"
                    >
                      {entry.label}
                    </button>
                  )
                ))}
              </div>
            )}

            {reviseOpen && !localVerdict && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const note = reviseNote.trim();
                  if (!note) return;
                  void submitVerdict("revise", note);
                }}
                className="flex items-center gap-2 pt-1"
              >
                <input
                  value={reviseNote}
                  onChange={(event) => setReviseNote(event.target.value)}
                  className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
                  placeholder="Revision note"
                  aria-label="Revision note"
                />
                <button
                  type="submit"
                  disabled={!reviseNote.trim() || Boolean(busyVerdict)}
                  className="inline-flex min-h-8 items-center rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-50 dark:text-amber-300"
                >
                  Revise
                </button>
              </form>
            )}

            {verdictError && (
              <p className="text-xs text-red-500">{verdictError}</p>
            )}

            {feedbackOpen && (
              <form onSubmit={submitFeedback} className="flex items-center gap-2 border-t border-[var(--border-default)] pt-3">
                <input
                  value={feedbackText}
                  onChange={(event) => setFeedbackText(event.target.value)}
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

            {feedbackError && (
              <p className="text-xs text-red-500">{feedbackError}</p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Parse the source meeting out of an item's first citation ("meetings/<date>/<name>.md ..."). */
function meetingKey(item: EscalatedLoopItem): { key: string; date: string; title: string } | null {
  const source = item.citations?.[0]?.source || "";
  const match = source.match(/meetings\/(\d{4}-\d{2}-\d{2})\/([^/]+?)(?:-\d{4}-\d{2}-\d{2}[^/]*)?\.md/);
  if (!match) return null;
  return { key: `${match[1]}/${match[2]}`, date: match[1], title: match[2] };
}

/** One source meeting's asks, collapsed behind a count until opened. */
function MeetingGroup({ date, title, items, defaultOpen, onChanged }: {
  date: string;
  title: string;
  items: EscalatedLoopItem[];
  defaultOpen: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const decided = items.filter((item) => item.verdict).length;
  return (
    <div className="border-t border-[var(--border-default)] first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />}
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</span>
          <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{date}</span>
        </span>
        <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
          {decided > 0 ? `${decided}/${items.length} decided` : `${items.length} ${items.length === 1 ? "ask" : "asks"}`}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--bg-primary)]/40">
          {items.map((item) => (
            <EscalationItemCard
              key={`${item.loop}:${item.id}:${item.artifact_date}`}
              item={item}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
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

/** The presentational escalations body: standalone signals flat, meeting asks grouped by SOURCE
 * MEETING with progressive disclosure. Renders nested inside a briefing section card (`embedded`)
 * or inside the fallback fold. */
export function EscalationsBlock({ items, onChanged, embedded }: {
  items: EscalatedLoopItem[];
  onChanged: () => void;
  embedded?: boolean;
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
    <div className={embedded ? "border-t border-[var(--border-default)]" : ""}>
      {embedded && (
        <div className="flex items-center gap-2 bg-[var(--bg-secondary)]/60 px-4 py-2 text-xs font-medium text-[var(--text-tertiary)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>Needs you · {escalationsSummary(items)}</span>
        </div>
      )}
      {standalone.map((item) => (
        <EscalationItemCard
          key={`${item.loop}:${item.id}:${item.artifact_date}`}
          item={item}
          onChanged={onChanged}
        />
      ))}
      {meetingGroups.map((group, index) => (
        <MeetingGroup
          key={group.date + group.title}
          date={group.date}
          title={group.title}
          items={group.items}
          defaultOpen={meetingGroups.length === 1 && index === 0 && group.items.length <= 5}
          onChanged={onChanged}
        />
      ))}
    </div>
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
    <section className="mb-5 hilt-card hilt-card-static overflow-hidden">
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
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
      <EscalationsBlock items={items} onChanged={onChanged} />
    </section>
  );
}
