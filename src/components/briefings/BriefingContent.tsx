"use client";

import { useState, useMemo, useCallback, type FormEvent, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Check, MessageSquare, Send } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";
import { useScope } from "@/contexts/ScopeContext";
import { withBasePath } from "@/lib/base-path";
import { CopyReferenceButton } from "@/components/ui/CopyReferenceButton";
import {
  EscalationsBlock,
  FloatingAskControls,
  EscalationsFallbackFold,
  sectionIndexForLoop,
  type EscalatedLoopItem,
} from "./EscalationsPanel";
import {
  cleanLoopTokens,
  extractMeetingRelPath,
  extractTaskIds,
  isNextStepsHeading,
  isTaskIdOnlyLine,
  meetingLabelFromRelPath,
  parseBriefing,
  stripTaskTokens,
  type BriefingItem,
} from "@/lib/briefing/canvas";
import { MeetingCard } from "./MeetingCard";
import { TaskCard } from "@/components/tasks/TaskCard";
import { useTasksList } from "@/hooks/useTaskFile";
import { askToTaskFile, joinMeetingNextSteps } from "@/lib/tasks/meeting-next-steps";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
interface BriefingContentProps {
  content: string;
  date?: string;
  /** Absolute path to the briefing file — enables a Copy reference button per item. */
  absPath?: string;
  /** Render a feedback (comment) affordance on every item — scope §6: universal feedback capture. */
  feedbackable?: boolean;
  /** Escalated loop items to NEST inside their owning sections (meeting asks → Don't drop this,
   * runtime → System, …). Loops with no matching section render in a fallback fold above. */
  escalations?: EscalatedLoopItem[];
  onEscalationsChanged?: () => void;
}

/** Replace [^N] citation markers with superscript HTML */
function renderCitations(text: string): string {
  return text.replace(/\[\^(\d+)\]/g, '<sup><a href="#fn-$1" class="citation-link">$1</a></sup>');
}

function isAppOwnedHref(href: string | undefined): boolean {
  return Boolean(href && href.startsWith("/") && !href.startsWith("//"));
}

function isNativeBriefingHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const pathname = new URL(href, "http://hilt.local").pathname;
    return /(?:^|\/)api\/reports\/[a-z0-9][a-z0-9-]{0,63}$/i.test(pathname);
  } catch {
    return /(?:^|\/)api\/reports\/[a-z0-9][a-z0-9-]{0,63}$/i.test(href.split(/[?#]/)[0] || "");
  }
}

function BriefingLink({
  href,
  className,
  children,
  date,
}: {
  href?: string;
  className?: string;
  children: ReactNode;
  date?: string;
}) {
  const { navigateTo } = useScope();
  const isHash = href?.startsWith("#");
  const nativeHref = isNativeBriefingHref(href);
  const displayHref = href && isAppOwnedHref(href) ? withBasePath(href) : href;

  const handleClick = useCallback(async (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (!href || isHash || !nativeHref || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();

    const params = new URLSearchParams({ href });
    if (date) params.set("date", date);
    try {
      const response = await fetch(withBasePath(`/api/bridge/briefings/link-target?${params.toString()}`), { cache: "no-store" });
      if (!response.ok) throw new Error(`resolve failed: ${response.status}`);
      const payload = await response.json() as {
        target?: {
          view?: "docs" | "library";
          scope?: string;
        } | null;
      };
      const target = payload.target;
      if (target?.view && typeof target.scope === "string") {
        navigateTo(target.view, target.scope);
        return;
      }
    } catch (error) {
      console.warn("[briefings] failed to resolve native link", error);
    }

    if (displayHref) {
      window.open(displayHref, "_blank", "noopener,noreferrer");
    }
  }, [date, displayHref, href, isHash, nativeHref, navigateTo]);

  return (
    <a
      href={displayHref}
      className={className === "citation-link"
        ? "briefing-link briefing-citation-link"
        : "briefing-link"}
      target={isHash || nativeHref ? undefined : "_blank"}
      rel={isHash || nativeHref ? undefined : "noopener noreferrer"}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

/** Universal per-item feedback (scope §6: "a comment affordance on any briefing bullet"). Anchors
 * by (briefing date, section, bullet text) and routes to the briefing loop. */
function ItemFeedbackButton({ section, headline }: { section: string; headline: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withBasePath("/api/loops/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loop: "briefing",
          text: trimmed,
          target: { level: "item", anchor: { section, text: headline.slice(0, 200) } },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed: ${response.status}`);
      }
      setText("");
      setOpen(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex min-h-6 min-w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-secondary)] ${
          saved ? "text-emerald-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        }`}
        title={saved ? "Feedback saved" : "Leave feedback on this item"}
        aria-label={saved ? "Feedback saved" : "Leave feedback on this item"}
      >
        {saved ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="flex w-full items-center gap-2 py-1">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
            className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            placeholder="Feedback on this item"
            aria-label="Feedback on this item"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="inline-flex min-h-8 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
    </>
  );
}

/**
 * The B3 canvas context — the live task stores + the verdict wire, threaded down to every
 * bullet so a `t-…` id anywhere hydrates into a TaskCard. Proposals and accepted tasks share
 * one lookup (approve moves the file between stores; the id is stable across the move).
 */
interface CanvasContext {
  taskById: Map<string, TaskFile>;
  tasks: TaskFile[];
  proposals: TaskFile[];
  escalations: EscalatedLoopItem[];
  /** POSTs to the SAME /api/loops/verdicts endpoint every other surface uses (file effect +
   * ledger effect ride the task's origin). Undefined when the task has no verdict join. */
  makeVerdictHandler: (loop?: string, itemId?: string) => ((verdict: Verdict, note?: string) => Promise<void>) | undefined;
}

/** Display-text cleaning: join keys are not reading material. Loop tokens strip only when the
 * bullet has bound ask affordances (pre-B3 behavior, unchanged); task tokens strip only when
 * they hydrated into cards — an unresolved id stays visible as an honest inert chip. */
function stripDisplayTokens(text: string, stripLoop: boolean, stripTasks: boolean): string {
  let out = text;
  if (stripLoop) out = cleanLoopTokens(out);
  if (stripTasks) out = stripTaskTokens(out);
  return out;
}

/** One hydrated task card inside the briefing: proposals stay decidable, everything else is a
 * read-only card with its status badge (an id the editor stamped at 6:00 that got approved by
 * 8:00 shows "Accepted" — the canvas reflects the live object, not the morning snapshot). */
function CanvasTaskCard({ task, canvas }: { task: TaskFile; canvas: CanvasContext }) {
  const pending = task.status === "proposed";
  return (
    <TaskCard
      flush
      task={task}
      showStatus={!pending}
      onVerdict={pending ? canvas.makeVerdictHandler(task.origin?.loop, task.origin?.item_id) : undefined}
    />
  );
}

function CollapsibleItem({ item, section, date, absPath, feedbackable, boundLoopItems = [], onLoopItemsChanged = () => {}, canvas }: { item: BriefingItem; section: string; date?: string; absPath?: string; feedbackable?: boolean; boundLoopItems?: EscalatedLoopItem[]; onLoopItemsChanged?: () => void; canvas: CanvasContext }) {
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  // B3 canvas join: task ids in this bullet hydrate into TaskCards. Headline-bound cards render
  // under the headline (the bullet IS the object); detail-bound cards render inside the
  // expansion, replacing their id-only lines — same progressive disclosure as ask lists.
  const headlineTasks = extractTaskIds(item.headline)
    .map((id) => canvas.taskById.get(id))
    .filter((task): task is TaskFile => Boolean(task));
  const detailTaskIds = extractTaskIds(item.details);
  const hasDetailTasks = detailTaskIds.some((id) => canvas.taskById.has(id));
  // A loop item whose ask already renders as a task card must not ALSO bind ask controls —
  // one affordance per object (the card wins; it is the richer surface).
  const cardOriginIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of [...extractTaskIds(item.headline), ...detailTaskIds]) {
      const originId = canvas.taskById.get(id)?.origin?.item_id;
      if (originId) ids.add(originId);
    }
    return ids;
  }, [item.headline, detailTaskIds, canvas.taskById]);
  // Asks bound to this bullet: headline-bound get floating controls on the headline's line;
  // detail-bound render each ask's controls on ITS OWN sub-bullet line — never a parallel
  // control stack repeating the editor's list (rejected 2026-07-03). Ask lists expand/collapse
  // like any other briefing item — actions don't force visibility, the reader chooses.
  const headlineBound = boundLoopItems.filter((loopItem) => item.headline.includes(loopItem.id) && !cardOriginIds.has(loopItem.id));
  const detailBound = boundLoopItems.filter((loopItem) => item.details.includes(loopItem.id) && !cardOriginIds.has(loopItem.id));
  const hasAskList = detailBound.length > 0 || hasDetailTasks;
  const hasDetails = item.details.trim().length > 0;
  const escalatedHere = boundLoopItems.some((loopItem) => loopItem.escalated)
    || headlineTasks.some((task) => task.status === "proposed")
    || detailTaskIds.some((id) => canvas.taskById.get(id)?.status === "proposed");

  // Detect footnote items like "[1] Some text" and add anchor id
  const footnoteMatch = item.headline.match(/^\[(\d+)\]\s/);
  const footnoteId = footnoteMatch ? `fn-${footnoteMatch[1]}` : undefined;

  return (
    <li id={footnoteId} className={`${headlineBound.length ? "group/askrow " : ""}relative text-[var(--text-secondary)] ${item.prose ? "list-none py-1" : ""} ${hasDetails ? `briefing-expandable${expanded ? " briefing-expanded" : ""}` : ""} ${escalatedHere ? "briefing-escalated" : ""}`}>
      <div
        onClick={() => {
          if (!hasDetails) return;
          if (expanded) haptics.rigid();
          else haptics.soft();
          setExpanded(!expanded);
        }}
        className={`group flex flex-wrap items-start justify-between gap-2 py-0.5 ${hasDetails ? "cursor-pointer" : ""}`}
      >
        <span className="min-w-0 flex-1 text-[var(--text-secondary)] leading-relaxed briefing-inline-md" title={escalatedHere ? `Escalated: ${boundLoopItems.find((loopItem) => loopItem.escalated)?.escalated?.reason || "urgent"}` : undefined}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              p: ({ children }) => <>{children}</>,
              strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
              sup: ({ children }) => <sup className="text-xs">{children}</sup>,
              a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
            }}
          >
            {renderCitations(stripDisplayTokens(item.headline, hasAskList || headlineBound.length > 0, headlineTasks.length > 0))}
          </ReactMarkdown>
        </span>
        <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {feedbackable && <ItemFeedbackButton section={section} headline={item.headline} />}
          {absPath && (
            <CopyReferenceButton variant="icon" reference={{ kind: "briefing-item", absPath, headline: item.headline }} />
          )}
        </span>
      </div>
      {/* Headline-bound ask (the bullet IS the ask): floating controls on the headline's line. */}
      {headlineBound.map((loopItem) => (
        <FloatingAskControls key={loopItem.id} item={loopItem} onChanged={onLoopItemsChanged} />
      ))}
      {/* Headline-bound task cards (B3): the bullet IS the object — its live card renders right
          under the editor's line, always visible like the headline ask controls. */}
      {headlineTasks.length > 0 && (
        <div className="space-y-1.5 pb-1">
          {headlineTasks.map((task) => (
            <CanvasTaskCard key={task.id} task={task} canvas={canvas} />
          ))}
        </div>
      )}
      {/* Detail-bound asks + task cards: the editor's sub-bullets ARE the list — one structure.
          Expands and collapses like any briefing item; each ask's controls float on its own
          line; a `t-…` id line hydrates into its TaskCard in place (B3 canvas contract). */}
      {expanded && hasAskList && (
        <ul className="briefing-list pl-5 space-y-0.5 pb-1">
          {item.details.split("\n").map((line, li) => {
            const lineTasks = extractTaskIds(line)
              .map((id) => canvas.taskById.get(id))
              .filter((task): task is TaskFile => Boolean(task));
            if (lineTasks.length > 0) {
              const residue = isTaskIdOnlyLine(line)
                ? ""
                : stripTaskTokens(cleanLoopTokens(line)).replace(/^\s*-\s*/, "").trim();
              return (
                <li key={li} className="list-none -ml-4 space-y-1.5 py-0.5">
                  {residue && (
                    <span className="leading-relaxed briefing-inline-md">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          p: ({ children }) => <>{children}</>,
                          strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
                          a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
                        }}
                      >
                        {residue}
                      </ReactMarkdown>
                    </span>
                  )}
                  {lineTasks.map((task) => (
                    <CanvasTaskCard key={task.id} task={task} canvas={canvas} />
                  ))}
                </li>
              );
            }
            const bound = detailBound.find((loopItem) => line.includes(loopItem.id));
            const text = cleanLoopTokens(line).replace(/^\s*-\s*/, "").trim();
            if (!text) return null;
            return (
              <li key={li} className={`group/askrow relative text-[var(--text-secondary)] ${bound?.escalated ? "briefing-escalated" : ""}`}>
                <span className="leading-relaxed briefing-inline-md" title={bound?.escalated ? `Escalated: ${bound.escalated.reason || "urgent"}` : undefined}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      p: ({ children }) => <>{children}</>,
                      strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
                      a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
                    }}
                  >
                    {text}
                  </ReactMarkdown>
                </span>
                {bound && <FloatingAskControls item={bound} onChanged={onLoopItemsChanged} />}
              </li>
            );
          })}
        </ul>
      )}
      {expanded && !hasAskList && hasDetails && (
        <div className="pb-1 text-[var(--text-secondary)] leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
              a: ({ href, children }) => <BriefingLink href={href} date={date}>{children}</BriefingLink>,
              ul: ({ children }) => <ul className="briefing-list pl-5 space-y-0.5">{children}</ul>,
              li: ({ children }) => <li className="text-[var(--text-secondary)]">{children}</li>,
              p: ({ children }) => <p className="mb-0.5">{children}</p>,
            }}
          >
            {item.details}
          </ReactMarkdown>
        </div>
      )}
    </li>
  );
}

/**
 * A "⏭ Next steps" meeting entry (B3): the editor's substance lead becomes a MeetingCard that
 * expands into the meeting's LIVE task cards — the same joinMeetingNextSteps join the meeting
 * view (B2) uses, so a verdict given in either place is reflected in both. The editor's id-only
 * sub-bullet lines are consumed by their cards; every other sub-line renders above the cards.
 */
function NextStepsMeetingItem({ item, meetingRel, section, date, absPath, feedbackable, canvas, boundLoopItems = [], defaultOpen }: {
  item: BriefingItem;
  meetingRel: string;
  section: string;
  date?: string;
  absPath?: string;
  feedbackable?: boolean;
  canvas: CanvasContext;
  boundLoopItems?: EscalatedLoopItem[];
  defaultOpen?: boolean;
}) {
  const { title, date: meetingDate } = meetingLabelFromRelPath(meetingRel);
  const join = useMemo(
    () => joinMeetingNextSteps({
      meetingRelPath: meetingRel,
      tasks: canvas.tasks,
      proposals: canvas.proposals,
      escalations: canvas.escalations,
    }),
    [meetingRel, canvas.tasks, canvas.proposals, canvas.escalations],
  );
  const stampedIds = useMemo(
    () => extractTaskIds(`${item.headline}\n${item.details}`),
    [item.headline, item.details],
  );
  // Landed lane: ONLY ids the editor stamped this morning — an id approved between 6:00 and
  // reading shows as a read-only "Accepted" card (live feedback), but the meeting's whole
  // historical task list stays in the meeting view, not the briefing.
  const landedStamped = join.tasks.filter((task) => stampedIds.includes(task.id));
  // Never-drop insurance: an ask the editor bound to THIS bullet that the citation join missed
  // still renders (shaped as a card like the meeting view's unminted lane).
  const joined = new Set([
    ...join.unmintedAsks.map((ask) => `${ask.loop}:${ask.id}`),
    ...[...join.proposals, ...join.tasks].map((task) => `${task.origin?.loop ?? ""}:${task.origin?.item_id ?? ""}`),
  ]);
  const extraBoundAsks = boundLoopItems.filter(
    (loopItem) => (loopItem.kind === "action" || loopItem.kind === "proposal") && !joined.has(`${loopItem.loop}:${loopItem.id}`),
  );
  const pendingCount = join.proposals.length
    + join.unmintedAsks.filter((ask) => !ask.verdict).length
    + extraBoundAsks.filter((ask) => !ask.verdict).length;

  // Sub-lines that survive hydration: id-only lines whose ids are known objects are consumed by
  // their cards; everything else (the meeting citation, editorial sub-bullets, unknown ids)
  // stays visible — nothing silently disappears.
  const knownTaskIds = useMemo(() => {
    const ids = new Set(canvas.taskById.keys());
    for (const escalation of canvas.escalations) {
      if (escalation.task_id) ids.add(escalation.task_id);
    }
    return ids;
  }, [canvas.taskById, canvas.escalations]);
  const leftoverLines = item.details
    .split("\n")
    .map((line) => {
      const ids = extractTaskIds(line);
      if (isTaskIdOnlyLine(line) && ids.every((id) => knownTaskIds.has(id))) return null;
      // A line whose id is UNKNOWN (task file deleted out-of-band) keeps its raw token as an
      // inert chip — stripping it left an empty residue that vanished, violating never-drop.
      const keepTokens = ids.some((id) => !knownTaskIds.has(id));
      const cleaned = keepTokens ? cleanLoopTokens(line) : stripTaskTokens(cleanLoopTokens(line));
      const text = cleaned.replace(/^\s*-\s*/, "").trim();
      return text || null;
    })
    .filter((text): text is string => Boolean(text));

  const markdownComponents = {
    p: ({ children }: { children?: ReactNode }) => <>{children}</>,
    strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
    a: ({ href, children, className }: { href?: string; children?: ReactNode; className?: string }) => (
      <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>
    ),
  };

  return (
    <MeetingCard
      title={title}
      date={meetingDate}
      pendingCount={pendingCount}
      defaultOpen={defaultOpen}
      actions={(
        <>
          {feedbackable && <ItemFeedbackButton section={section} headline={item.headline} />}
          {absPath && (
            <CopyReferenceButton variant="icon" reference={{ kind: "briefing-item", absPath, headline: item.headline }} />
          )}
        </>
      )}
      summary={(
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
          {renderCitations(stripTaskTokens(cleanLoopTokens(item.headline)))}
        </ReactMarkdown>
      )}
    >
      {leftoverLines.map((line, index) => (
        <div key={`line-${index}`} className="leading-relaxed briefing-inline-md text-[var(--text-secondary)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
            {line}
          </ReactMarkdown>
        </div>
      ))}
      {join.proposals.map((task) => (
        <TaskCard
          key={task.id}
          flush
          hideMeeting
          task={task}
          onVerdict={canvas.makeVerdictHandler(task.origin?.loop, task.origin?.item_id)}
        />
      ))}
      {[...join.unmintedAsks, ...extraBoundAsks].map((ask) => (
        <TaskCard
          key={`${ask.loop}:${ask.id}`}
          flush
          hideMeeting
          task={askToTaskFile(ask, meetingRel)}
          verdict={ask.verdict}
          onVerdict={ask.verdict ? undefined : canvas.makeVerdictHandler(ask.loop, ask.id)}
        />
      ))}
      {landedStamped.map((task) => (
        <TaskCard key={task.id} flush hideMeeting showStatus task={task} />
      ))}
    </MeetingCard>
  );
}

export function BriefingContent({ content, date, absPath, feedbackable = true, escalations = [], onEscalationsChanged = () => {} }: BriefingContentProps) {
  const { lede, sections } = useMemo(() => parseBriefing(content), [content]);

  // ── B3 canvas: the live task stores + the shared verdict wire ────────────────────────────
  // useTasksList revalidates on the `tasks-changed` WS event; POSTing a verdict goes to the
  // SAME /api/loops/verdicts endpoint as ProposalsSection and the meeting view — the route
  // applies the file effect synchronously, the ledger effect lands at the loop's next run.
  const { tasks, proposals, mutate: mutateTasks } = useTasksList();
  const taskById = useMemo(() => {
    const map = new Map<string, TaskFile>();
    for (const task of [...tasks, ...proposals]) map.set(task.id, task);
    return map;
  }, [tasks, proposals]);
  const makeVerdictHandler = useCallback(
    (loop?: string, itemId?: string) => {
      // Only loop-minted objects carry the verdict join — anything else is read-only rather
      // than posting a broken verdict (the A6 guard, carried over).
      if (!loop || !itemId) return undefined;
      return async (verdict: Verdict, note?: string) => {
        const response = await fetch(withBasePath("/api/loops/verdicts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loop, item_id: itemId, verdict, ...(note ? { note } : {}) }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || `Request failed: ${response.status}`);
        }
        mutateTasks();
        onEscalationsChanged();
      };
    },
    [mutateTasks, onEscalationsChanged],
  );
  const canvas = useMemo<CanvasContext>(
    () => ({ taskById, tasks, proposals, escalations, makeVerdictHandler }),
    [taskById, tasks, proposals, escalations, makeVerdictHandler],
  );

  // Nest each loop's escalations inside its owning section. The join key is the briefing's OWN
  // loop citations (`*loop:<id>, <date>*` — the generator stamps which section drew from which
  // loop), so the generator's editorial placement decides ownership; the heading name-map is only
  // a fallback for briefings that don't cite an escalating loop. Anything still unmatched goes to
  // the fallback fold above (nothing silently disappears).
  const { bySection, byBullet, unmatched } = useMemo(() => {
    const sectionTexts = sections.map((section) =>
      /sources/i.test(section.heading)
        ? "" // a Sources/footnotes section may quote loop ids without owning the domain
        : section.items.map((item) => `${item.headline}\n${item.details}`).join("\n"));
    const perSection = new Map<number, EscalatedLoopItem[]>();
    const perBullet = new Map<string, EscalatedLoopItem[]>(); // "si:ii" → bound loop items
    const leftovers: EscalatedLoopItem[] = [];
    for (const item of escalations) {
      // Strongest join first: an editor bullet that carries this item's ID owns it — the
      // affordance attaches to the editor's own line (its placement, its phrasing).
      let bound = false;
      outer: for (let si = 0; si < sections.length; si++) {
        if (!sectionTexts[si]) continue;
        for (let ii = 0; ii < sections[si].items.length; ii++) {
          const bullet = sections[si].items[ii];
          // Featured = the editor placed EITHER id form: the ma- ledger id (pre-B3 contract) or
          // the minted t- task id (B3 ⏭ contract). Binding only on ma- classified every
          // ⏭-featured proposal as unfeatured — the whole meeting group re-rendered below the
          // MeetingCard that already carried its TaskCards (adversarial finding, 2026-07-07).
          const boundText = `${bullet.headline}\n${bullet.details}`;
          if (boundText.includes(item.id) || (item.task_id && boundText.includes(item.task_id))) {
            const key = `${si}:${ii}`;
            const bucket = perBullet.get(key);
            if (bucket) bucket.push(item);
            else perBullet.set(key, [item]);
            bound = true;
            break outer;
          }
        }
      }
      if (bound) continue;
      // Next: the section that cites the loop; then the heading name-map (priority-ordered —
      // unfeatured meeting asks prefer ⏭ Next steps, falling back to 🧠 for pre-B3 briefings);
      // then the fallback fold.
      let sectionIndex = sectionTexts.findIndex((text) => text.includes(`loop:${item.loop}`));
      if (sectionIndex === -1) {
        sectionIndex = sectionIndexForLoop(item.loop, sections.map((section) => section.heading));
      }
      if (sectionIndex === -1) {
        leftovers.push(item);
        continue;
      }
      const bucket = perSection.get(sectionIndex);
      if (bucket) bucket.push(item);
      else perSection.set(sectionIndex, [item]);
    }
    return { bySection: perSection, byBullet: perBullet, unmatched: leftovers };
  }, [escalations, sections]);

  // Fall back to plain markdown if no sections found
  if (sections.length === 0) {
    const displayContent = content.replace(/^\s*#\s+.+\n*/, "");
    return (
      <div className="briefing-content hilt-card hilt-card-static prose max-w-none px-4 py-3
        prose-headings:text-[var(--text-primary)] prose-headings:font-semibold
        prose-h2:text-lg prose-h2:mb-3 prose-h2:mt-6
        prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:mb-3
        prose-a:text-[var(--interactive-default)] [&_a:hover]:text-[var(--interactive-hover)]
        prose-a:no-underline [&_a:hover]:underline prose-a:underline-offset-2
        prose-strong:text-[var(--text-primary)]
        prose-li:text-[var(--text-secondary)] prose-li:leading-relaxed
        prose-ul:mb-3 prose-ol:mb-3
        prose-code:text-[var(--text-secondary)] prose-code:bg-[var(--bg-tertiary)]
      ">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="briefing-content prose max-w-none prose-headings:text-[var(--text-primary)] prose-headings:font-semibold prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-strong:text-[var(--text-primary)] prose-a:text-[var(--interactive-default)] [&_a:hover]:text-[var(--interactive-hover)] prose-a:no-underline [&_a:hover]:underline prose-a:underline-offset-2 prose-li:text-[var(--text-secondary)] prose-li:leading-relaxed prose-code:text-[var(--text-secondary)] prose-code:bg-[var(--bg-tertiary)] space-y-5">
      {lede && (
        <div className="px-1 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="!my-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
              a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
            }}
          >
            {lede}
          </ReactMarkdown>
        </div>
      )}
      <EscalationsFallbackFold items={unmatched} onChanged={onEscalationsChanged} />
      {sections.map((section, si) => {
        const isSourcesSection = /sources/i.test(section.heading);
        const sectionEscalations = bySection.get(si) || [];
        // B3: inside ⏭ Next steps, a bullet carrying a meeting citation renders as a
        // MeetingCard (expandable to that meeting's live task cards). Keyed on the ⏭ marker +
        // the citation — pre-B3 briefings have neither, so they render exactly as before.
        const isNextSteps = isNextStepsHeading(section.heading);
        const meetingRels = section.items.map((item) =>
          isNextSteps && !item.prose ? extractMeetingRelPath(`${item.headline}\n${item.details}`) : null);
        const meetingEntryCount = meetingRels.filter(Boolean).length;
        return (
          <div key={si} className="hilt-card hilt-card-static overflow-visible">
            <div className="rounded-t-lg px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
              <h2 className="text-base font-semibold text-[var(--text-primary)] !m-0">
                {section.heading}
              </h2>
            </div>
            {isSourcesSection ? (
              <div className="px-4 py-2 space-y-0.5 !m-0 text-sm text-[var(--text-secondary)]">
                {section.items.map((item, ii) => {
                  const fnMatch = item.headline.match(/^\[(\d+)\]\s/);
                  return (
                    <div key={ii} id={fnMatch ? `fn-${fnMatch[1]}` : undefined} className="py-0.5 leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          p: ({ children }) => <>{children}</>,
                          a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
                        }}
                      >
                        {item.headline}
                      </ReactMarkdown>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="briefing-list pl-9 pr-4 py-2 space-y-0 !m-0">
                {section.items.map((item, ii) => {
                  const meetingRel = meetingRels[ii];
                  if (meetingRel) {
                    return (
                      <NextStepsMeetingItem
                        key={ii}
                        item={item}
                        meetingRel={meetingRel}
                        section={section.heading}
                        date={date}
                        absPath={absPath}
                        feedbackable={feedbackable}
                        canvas={canvas}
                        boundLoopItems={byBullet.get(`${si}:${ii}`)}
                        defaultOpen={meetingEntryCount === 1}
                      />
                    );
                  }
                  return (
                    <CollapsibleItem key={ii} item={item} section={section.heading} date={date} absPath={absPath} feedbackable={feedbackable} boundLoopItems={byBullet.get(`${si}:${ii}`)} onLoopItemsChanged={onEscalationsChanged} canvas={canvas} />
                  );
                })}
                {/* Loop items the editor did NOT feature: bullets in the SAME list — urgency is
                    a flag, verdicts follow ask-ness (one item model). */}
                <EscalationsBlock items={sectionEscalations} onChanged={onEscalationsChanged} />
              </ul>
            )}
          </div>
        );
      })}

    </div>
  );
}
