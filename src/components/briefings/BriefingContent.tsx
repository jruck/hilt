"use client";

import { useState, useEffect, useMemo, useCallback, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Activity, ArrowRight, BookOpenText, ChevronRight, ChevronsUpDown, ChevronsDownUp, RotateCcw, Sparkles } from "lucide-react";
import { CommentPopover } from "@/components/comments/CommentPopover";
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
  extractRecommendationEpisodeIds,
  extractTaskIds,
  isConsumedTaskId,
  isDecisionsHeading,
  isNextStepsHeading,
  isRedundantMeetingCitationLine,
  isTaskIdOnlyLine,
  meetingLabelFromRelPath,
  stampedIdLineDisposition,
  normalizeHiltLinks,
  parseBriefing,
  partitionBriefingLibrarySection,
  stripDateAfterMeetingPill,
  stripTaskTokens,
  type BriefingItem,
  type BriefingLibraryPartition,
} from "@/lib/briefing/canvas";
import { BriefingRecommendationRow } from "./BriefingRecommendationRow";
import { MeetingCard, useExpandSignal, type ExpandSignal } from "./MeetingCard";
import { ObjectPill } from "@/components/objects/ObjectPill";
import { parseHiltUri } from "@/lib/objects/uri";
import { TaskCard } from "@/components/tasks/TaskCard";
import { DismissedProposalRows } from "@/components/tasks/DismissedProposalRows";
import { PROPOSAL_LOOP } from "@/components/tasks/ProposalsSection";
import { useDismissed, useTasksList } from "@/hooks/useTaskFile";
import { askToTaskFile, joinMeetingNextSteps, mergeDismissed } from "@/lib/tasks/meeting-next-steps";
import { requestTaskOpen } from "@/lib/tasks/deeplink";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import { dismissLibraryRecommendation, restoreLibraryRecommendation, useRecommendationEpisodes } from "@/hooks/useLibrary";
import { buildLibraryUrl, defaultLibraryUrlControls } from "@/lib/library/url";
import type { RecommendedArtifact } from "@/lib/library/types";
import {
  activeDecisionMeetingGroups,
  decisionDismissedHistory,
  decisionPendingProposals as selectDecisionPendingProposals,
  isDecisionQueueSummary,
} from "@/lib/briefing/decision-presentation";
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
  /** Only the current daily or current weekend briefing may append newly-created proposals. */
  activeBriefing?: boolean;
}

/** Replace [^N] citation markers with superscript HTML */
/** react-markdown's defaultUrlTransform allowlists http/https/mailto/… and strips everything
 * else to "" BEFORE the `a` component runs — the same sanitizer that ate open:// links in the
 * v2 era. hilt: object URIs must pass through or the pill seam is dead code and the link
 * degrades to <a href=""> (opens a duplicate app tab — B5 adversarial finding). */
const briefingUrlTransform = (url: string): string =>
  url.startsWith("hilt:") ? url : defaultUrlTransform(url);

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

  // B5: a `hilt:kind/id` href IS an object reference — render the universal pill (popover
  // preview + native-view click-through) instead of an anchor. parseHiltUri is the single
  // injection seam: it returns null for every other href (hash citations, /api/reports/…,
  // external links), so non-hilt links — i.e. every pre-B5 briefing — render exactly as before.
  const objectRef = href ? parseHiltUri(href) : null;
  if (objectRef) {
    return <ObjectPill refr={objectRef}>{children}</ObjectPill>;
  }

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

function BriefingModuleMarkdown({ markdown, date, className = "" }: { markdown: string; date?: string; className?: string }) {
  return (
    <div className={`briefing-inline-md text-sm leading-6 text-[var(--text-secondary)] ${className}`}>
      <ReactMarkdown
        urlTransform={briefingUrlTransform}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => <p className="!my-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
          a: ({ href, children, className: linkClassName }) => <BriefingLink href={href} className={linkClassName} date={date}>{children}</BriefingLink>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function BriefingRecommendationPlacement({
  episodeId,
  artifact,
  dismissed,
  unavailable,
  onDismiss,
  onRestore,
}: {
  episodeId: string;
  artifact?: RecommendedArtifact;
  dismissed: boolean;
  unavailable: boolean;
  onDismiss: (note?: string) => void | Promise<void>;
  onRestore: () => void | Promise<void>;
}) {
  if (dismissed) {
    return (
      <div data-recommendation-episode-id={episodeId} className="hilt-card hilt-card-static mx-3 my-2 flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-[var(--text-tertiary)]">
        <span>Recommendation dismissed</span>
        <button
          type="button"
          onClick={() => { void onRestore(); }}
          className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          title="Restore recommendation"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Undo
        </button>
      </div>
    );
  }
  if (artifact) return <BriefingRecommendationRow artifact={artifact} onDismiss={onDismiss} />;
  return (
    <div data-recommendation-episode-id={episodeId} className="hilt-card hilt-card-static mx-3 my-2 px-3 py-3 text-xs text-[var(--text-tertiary)]">
      {unavailable ? "Recommendation no longer available" : "Loading recommendation…"}
    </div>
  );
}

function BriefingLibraryModules({
  partition,
  recommendationByEpisode,
  dismissedEpisodeIds,
  missingEpisodeIds,
  recommendationError,
  locallyDismissedEpisodes,
  date,
  onDismiss,
  onRestore,
  onOpenForYou,
  healthActions,
}: {
  partition: BriefingLibraryPartition;
  recommendationByEpisode: Map<string, RecommendedArtifact>;
  dismissedEpisodeIds: Set<string>;
  missingEpisodeIds: Set<string>;
  recommendationError: unknown;
  locallyDismissedEpisodes: Set<string>;
  date?: string;
  onDismiss: (episodeId: string, note?: string) => void | Promise<void>;
  onRestore: (episodeId: string) => void | Promise<void>;
  onOpenForYou: () => void;
  healthActions?: ReactNode;
}) {
  const recommendationItems = partition.modules.recommendations?.items || [];
  const recommendationIds = [...new Set(recommendationItems.flatMap((item) => (
    extractRecommendationEpisodeIds(`${item.headline}\n${item.details}`)
  )))];
  const leadItems = recommendationItems.filter((item) => extractRecommendationEpisodeIds(`${item.headline}\n${item.details}`).length === 0);
  const memoItems = partition.modules.memo?.items || [];
  const healthItems = partition.modules.health?.items || [];
  const renderItems = (items: BriefingItem[]) => items.map((item, index) => (
    <BriefingModuleMarkdown key={`${item.headline}-${index}`} markdown={[item.headline, item.details].filter(Boolean).join("\n")} date={date} />
  ));

  return (
    <div data-briefing-library-modules>
      <section data-briefing-library-module="recommendations" aria-label="Recommended for you">
        <div className="flex items-center gap-2 px-4 pt-3 text-xs font-medium text-[var(--text-tertiary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden />
          Recommended for you
        </div>
        <div data-briefing-recommendation-lead className="space-y-2 px-4 pb-1 pt-2">
          {leadItems.length ? renderItems(leadItems) : (
            <p className="text-sm leading-6 text-[var(--text-secondary)]">Nothing new was selected for this briefing.</p>
          )}
        </div>
        <div className="pb-1">
          {recommendationIds.map((episodeId) => (
            <BriefingRecommendationPlacement
              key={episodeId}
              episodeId={episodeId}
              artifact={recommendationByEpisode.get(episodeId)}
              dismissed={locallyDismissedEpisodes.has(episodeId) || dismissedEpisodeIds.has(episodeId)}
              unavailable={missingEpisodeIds.has(episodeId) || Boolean(recommendationError)}
              onDismiss={(note) => onDismiss(episodeId, note)}
              onRestore={() => onRestore(episodeId)}
            />
          ))}
        </div>
        <div className="flex items-center border-t border-[var(--border-default)] px-4 py-2">
          <button
            type="button"
            onClick={onOpenForYou}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          >
            View all <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {partition.modules.memo && (
        <section data-briefing-library-module="memo" aria-label="Editor's memo" className="border-t border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--text-tertiary)]">
            <BookOpenText className="h-3.5 w-3.5" aria-hidden />
            Weekly editor&apos;s memo
          </div>
          <div className="space-y-2">{renderItems(memoItems)}</div>
        </section>
      )}

      <section data-briefing-library-module="health" aria-label="Library health" className="border-t border-[var(--border-default)] px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--text-tertiary)]">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          Library health
        </div>
        <div className="space-y-2">
          {healthItems.length ? renderItems(healthItems) : (
            <p className="text-sm leading-6 text-amber-600 dark:text-amber-300">Daily library report unavailable for this briefing.</p>
          )}
          {healthActions}
        </div>
      </section>

      {partition.ungrouped.length > 0 && (
        <div className="border-t border-[var(--border-default)] px-4 py-3 space-y-2">
          {renderItems(partition.ungrouped)}
        </div>
      )}
    </div>
  );
}

/** Universal per-item feedback (scope §6: "a comment affordance on any briefing bullet"). Anchors
 * by (briefing date, section, bullet text) — now the W1 CommentPopover: floating composer +
 * history; the count pill forces trigger visibility on commented bullets. */
function ItemFeedbackButton({ section, headline, date }: { section: string; headline: string; date?: string }) {
  return (
    <CommentPopover
      compact
      hoverReveal
      target={{
        kind: "briefing-anchor",
        ...(date ? { date } : {}),
        anchor: { section, text: headline.slice(0, 200) },
      }}
      placeholder="Feedback on this item"
      triggerTitle="Comment on this item"
    />
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
  /** Task ids whose proposals were verdict-DISMISSED: the file is deleted but the ledger (and,
   * in the pre-stamp limbo window, the escalations feed) remembers the minted `task_id`. These
   * ids are CONSUMED — represented by the "Dismissed · N" tails, never by raw-token chips. */
  dismissedTaskIds: ReadonlySet<string>;
  /** Revalidate task, dismissal, and escalation state after a recovery action. */
  refreshTaskState: () => Promise<void>;
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
      // B5: the meeting attribution renders as an object pill (preview + click-through) —
      // canvas cards sit outside their meeting's entry, so the attribution earns navigation.
      meetingRef={task.origin?.meeting ? { kind: "meeting", id: task.origin.meeting } : undefined}
      onVerdict={pending ? canvas.makeVerdictHandler(task.origin?.loop, task.origin?.item_id) : undefined}
      // Clicking the card body opens the task's detail pane in Priorities (cross-view channel).
      onOpen={() => requestTaskOpen(task.id)}
    />
  );
}

function CollapsibleItem({ item, section, date, absPath, feedbackable, boundLoopItems = [], onLoopItemsChanged = () => {}, canvas, expandSignal }: { item: BriefingItem; section: string; date?: string; absPath?: string; feedbackable?: boolean; boundLoopItems?: EscalatedLoopItem[]; onLoopItemsChanged?: () => void; canvas: CanvasContext; expandSignal?: ExpandSignal }) {
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  useExpandSignal(expandSignal, setExpanded);
  // B3 canvas join: task ids in this bullet hydrate into TaskCards. Headline-bound cards render
  // under the headline (the bullet IS the object); detail-bound cards render inside the
  // expansion, replacing their id-only lines — same progressive disclosure as ask lists.
  // Consumed = hydrated (live card via taskById) or verdict-dismissed (ledger-remembered, no
  // card, no chip). An id that is neither is an out-of-band deletion and keeps its raw token.
  const isConsumed = (id: string) => canvas.taskById.has(id) || canvas.dismissedTaskIds.has(id);
  const headlineIds = extractTaskIds(item.headline);
  const headlineTasks = headlineIds
    .map((id) => canvas.taskById.get(id))
    .filter((task): task is TaskFile => Boolean(task));
  // Headline task tokens strip when a card hydrates below, or when EVERY stamped id is
  // consumed (all dismissed → no card, but each id is ledger-remembered, not lost).
  const stripHeadlineTaskTokens = headlineTasks.length > 0
    || (headlineIds.length > 0 && headlineIds.every(isConsumed));
  const detailTaskIds = extractTaskIds(item.details);
  // Dismissed detail ids count: their lines must route through the structured renderer below so
  // they drop/strip instead of leaking raw tokens via the plain-markdown details branch.
  const hasDetailTasks = detailTaskIds.some(isConsumed);
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
    <li id={footnoteId} className={`${headlineBound.length ? "group/askrow " : ""}relative text-[var(--text-secondary)] ${item.prose ? "!list-none py-1 [&::marker]:content-none" : ""} ${hasDetails ? `briefing-expandable${expanded ? " briefing-expanded" : ""}` : ""} ${escalatedHere ? "briefing-escalated" : ""}`}>
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
            urlTransform={briefingUrlTransform}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              p: ({ children }) => <>{children}</>,
              strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
              sup: ({ children }) => <sup className="text-xs">{children}</sup>,
              a: ({ href, children, className }) => <BriefingLink href={href} className={className} date={date}>{children}</BriefingLink>,
            }}
          >
            {renderCitations(stripDisplayTokens(item.headline, hasAskList || headlineBound.length > 0, stripHeadlineTaskTokens))}
          </ReactMarkdown>
        </span>
        <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-0.5">
          {feedbackable && <ItemFeedbackButton section={section} headline={item.headline} date={date} />}
          {/* CommentPopover self-gates via hoverReveal so a commented bullet's count pill stays
              visible; the copy button stays hover-revealed. */}
          {absPath && (
            <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <CopyReferenceButton variant="icon" reference={{ kind: "briefing-item", absPath, headline: item.headline }} />
            </span>
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
            urlTransform={briefingUrlTransform}
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
            // No card hydrated on this line (lineTasks was empty): a dismissed id drops its
            // id-only line / strips from prose exactly like a known id would have; an
            // unknown+undismissed id keeps its raw token as an inert chip (never-drop).
            const disposition = stampedIdLineDisposition(line, isConsumed);
            if (disposition === "drop") return null;
            const cleanedLine = disposition === "keep" ? cleanLoopTokens(line) : stripTaskTokens(cleanLoopTokens(line));
            const text = cleanedLine.replace(/^\s*-\s*/, "").trim();
            if (!text) return null;
            return (
              <li key={li} className={`group/askrow relative text-[var(--text-secondary)] ${bound?.escalated ? "briefing-escalated" : ""}`}>
                <span className="leading-relaxed briefing-inline-md" title={bound?.escalated ? `Escalated: ${bound.escalated.reason || "urgent"}` : undefined}>
                  <ReactMarkdown
            urlTransform={briefingUrlTransform}
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
            urlTransform={briefingUrlTransform}
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
function NextStepsMeetingItem({ item, meetingRel, section, date, absPath, feedbackable, canvas, boundLoopItems = [], decisionQueue = false, activeBriefing = false, defaultOpen, expandSignal }: {
  item: BriefingItem;
  meetingRel: string;
  section: string;
  date?: string;
  absPath?: string;
  feedbackable?: boolean;
  canvas: CanvasContext;
  boundLoopItems?: EscalatedLoopItem[];
  decisionQueue?: boolean;
  activeBriefing?: boolean;
  defaultOpen?: boolean;
  expandSignal?: ExpandSignal;
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
  const stampedIdSet = useMemo(() => new Set(stampedIds), [stampedIds]);
  const pendingProposals = useMemo(
    () => decisionQueue
      ? selectDecisionPendingProposals(join.proposals, stampedIdSet, activeBriefing)
      : join.proposals,
    [activeBriefing, decisionQueue, join.proposals, stampedIdSet],
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
    (loopItem) =>
      (loopItem.kind === "action" || loopItem.kind === "proposal")
      // A dismissed ask never renders as a card — not even in the limbo window before the
      // loop stamps its ledger. It lands in the dismissed tail below instead.
      && loopItem.verdict !== "dismiss"
      && !joined.has(`${loopItem.loop}:${loopItem.id}`),
  );
  const pendingCount = pendingProposals.length
    + (decisionQueue ? 0 : join.unmintedAsks.filter((ask) => !ask.verdict).length)
    + (decisionQueue ? 0 : extraBoundAsks.filter((ask) => !ask.verdict).length);
  const urgent = decisionQueue && pendingProposals.some((task) => {
    if (task.due && task.due <= new Date().toLocaleDateString("en-CA")) return true;
    return canvas.escalations.some((item) => (
      item.loop === task.origin?.loop
      && (item.task_id === task.id || item.id === task.origin?.item_id)
      && Boolean(item.escalated)
    ));
  });

  // Dismissed-but-never-gone (gate-B), the same "Dismissed · N" tail as the meeting view (B2):
  // this meeting's ledger-backed dismissals merged with limbo ones from the escalations feed
  // (verdict recorded, ledger stamp pending; deduped by ledger id once it lands).
  const haptics = useHaptics();
  const { dismissed, mutate: mutateDismissed } = useDismissed(PROPOSAL_LOOP);
  const meetingDismissed = useMemo(
    () => mergeDismissed(dismissed, canvas.escalations.filter((e) => e.loop === PROPOSAL_LOOP), meetingRel),
    [dismissed, canvas.escalations, meetingRel],
  );
  const visibleDismissed = useMemo(
    () => decisionQueue
      ? decisionDismissedHistory(meetingDismissed, stampedIdSet, activeBriefing)
      : meetingDismissed,
    [activeBriefing, decisionQueue, meetingDismissed, stampedIdSet],
  );
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [dismissedExpanded, setDismissedExpanded] = useState(false);
  const toggleResolved = useCallback(() => {
    setResolvedExpanded((prev) => {
      const next = !prev;
      next ? haptics.soft() : haptics.rigid();
      return next;
    });
  }, [haptics]);
  const toggleDismissed = useCallback(() => {
    setDismissedExpanded((prev) => {
      const next = !prev;
      next ? haptics.soft() : haptics.rigid();
      return next;
    });
  }, [haptics]);
  const handleRestored = useCallback(async () => {
    await Promise.all([mutateDismissed(), canvas.refreshTaskState()]);
  }, [canvas, mutateDismissed]);

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
      // The card's own citation is a join key, not reading material: the header already names
      // and dates this meeting, so a sub-line that is JUST that citation is suppressed. Lines
      // citing a different source (or carrying any other prose) still render below.
      if (isRedundantMeetingCitationLine(line, meetingRel)) return null;
      // Consumed ids strip: known ids render as cards; DISMISSED ids (verdict-dismissal — file
      // deleted, ledger remembers) are represented by the "Dismissed · N" tail below. Only an
      // id that is neither — a task file deleted out-of-band — keeps its raw token as an inert
      // chip: stripping it left an empty residue that vanished, violating never-drop.
      const disposition = stampedIdLineDisposition(
        line,
        (id) => isConsumedTaskId(id, knownTaskIds, canvas.dismissedTaskIds),
      );
      if (disposition === "drop") return null;
      const cleaned = disposition === "keep" ? cleanLoopTokens(line) : stripTaskTokens(cleanLoopTokens(line));
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
  const summaryMarkdown = decisionQueue && isRedundantMeetingCitationLine(item.headline, meetingRel)
    ? ""
    : renderCitations(stripTaskTokens(cleanLoopTokens(item.headline)));

  return (
    <MeetingCard
      title={title}
      date={meetingDate}
      meetingRel={meetingRel}
      suppressHeaderPill={item.headline.includes(`hilt:meeting/${meetingRel}`)}
      pendingCount={pendingCount}
      urgent={decisionQueue ? urgent : undefined}
      meetingFirst={decisionQueue}
      defaultOpen={defaultOpen}
      expandSignal={expandSignal}
      actions={(
        <>
          {feedbackable && <ItemFeedbackButton section={section} headline={item.headline} date={date} />}
          {/* CommentPopover self-gates via hoverReveal so a commented bullet's count pill stays
              visible; the copy button stays hover-revealed. */}
          {absPath && (
            <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <CopyReferenceButton variant="icon" reference={{ kind: "briefing-item", absPath, headline: item.headline }} />
            </span>
          )}
        </>
      )}
      summary={summaryMarkdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents} urlTransform={briefingUrlTransform}>
          {summaryMarkdown}
        </ReactMarkdown>
      ) : undefined}
    >
      {leftoverLines.map((line, index) => (
        <div key={`line-${index}`} className="leading-relaxed briefing-inline-md text-[var(--text-secondary)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents} urlTransform={briefingUrlTransform}>
            {line}
          </ReactMarkdown>
        </div>
      ))}
      {pendingProposals.map((task) => (
        <TaskCard
          key={task.id}
          flush
          hideMeeting
          task={task}
          onVerdict={canvas.makeVerdictHandler(task.origin?.loop, task.origin?.item_id)}
          onOpen={() => requestTaskOpen(task.id)}
        />
      ))}
      {!decisionQueue && [...join.unmintedAsks, ...extraBoundAsks].map((ask) => (
        <TaskCard
          key={`${ask.loop}:${ask.id}`}
          flush
          hideMeeting
          task={askToTaskFile(ask, meetingRel)}
          verdict={ask.verdict}
          onVerdict={ask.verdict ? undefined : canvas.makeVerdictHandler(ask.loop, ask.id)}
        />
      ))}
      {!decisionQueue && landedStamped.map((task) => (
        <TaskCard key={task.id} flush hideMeeting showStatus task={task} onOpen={() => requestTaskOpen(task.id)} />
      ))}
      {decisionQueue && landedStamped.length > 0 && (
        <div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border-default)]" />
            <button
              type="button"
              onClick={toggleResolved}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"
              title={resolvedExpanded ? "Hide resolved decisions" : "View resolved decisions"}
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${resolvedExpanded ? "rotate-90" : ""}`} />
              Resolved · {landedStamped.length}
            </button>
            <div className="h-px flex-1 bg-[var(--border-default)]" />
          </div>
          {resolvedExpanded && (
            <div className="mt-2 space-y-0.5">
              {landedStamped.map((task) => (
                <TaskCard key={task.id} flush hideMeeting showStatus task={task} onOpen={() => requestTaskOpen(task.id)} />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Dismissed asks FROM THIS MEETING — the quiet reveal-tail idiom, classes copied exactly
          from the meeting view (B2) / Proposals section (A6). Renders only when N > 0. */}
      {visibleDismissed.length > 0 && (
        <div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border-default)]" />
            <button
              onClick={toggleDismissed}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
              title={dismissedExpanded ? "Hide dismissed items" : "View dismissed items"}
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${dismissedExpanded ? "rotate-90" : ""}`} />
              Dismissed · {visibleDismissed.length}
            </button>
            <div className="h-px flex-1 bg-[var(--border-default)]" />
          </div>
          {dismissedExpanded && (
            <div className="mt-2">
              <DismissedProposalRows
                items={visibleDismissed}
                loop={PROPOSAL_LOOP}
                allowRestore={activeBriefing}
                onRestored={handleRestored}
              />
            </div>
          )}
        </div>
      )}
    </MeetingCard>
  );
}

export function BriefingContent({ content, date, absPath, feedbackable = true, escalations = [], onEscalationsChanged = () => {}, activeBriefing = false }: BriefingContentProps) {
  // Repair bare hilt: destinations (spaces/parens break CommonMark link parsing) BEFORE parse
  // so every downstream render site sees pill-able links — then strip any literal date token
  // bolted on after a meeting pill (the DATED pill carries the date inside the chip now; this
  // covers already-written briefings and model slips).
  const { lede, sections } = useMemo(
    () => parseBriefing(stripDateAfterMeetingPill(normalizeHiltLinks(content))),
    [content],
  );
  const recommendationEpisodeIds = useMemo(
    () => [...new Set(sections.flatMap((section) => section.items.flatMap((item) => (
      extractRecommendationEpisodeIds(`${item.headline}\n${item.details}`)
    ))))],
    [sections],
  );
  const recommendationPreviews = useRecommendationEpisodes(recommendationEpisodeIds);
  const recommendationByEpisode = useMemo(() => new Map(
    recommendationPreviews.items
      .filter((artifact) => artifact.recommendation?.episode_id)
      .map((artifact) => [artifact.recommendation!.episode_id, artifact]),
  ), [recommendationPreviews.items]);
  const [locallyDismissedEpisodes, setLocallyDismissedEpisodes] = useState<Set<string>>(new Set());
  useEffect(() => setLocallyDismissedEpisodes(new Set()), [content]);
  const dismissRecommendation = useCallback(async (episodeId: string, note?: string) => {
    setLocallyDismissedEpisodes((previous) => new Set(previous).add(episodeId));
    try {
      await dismissLibraryRecommendation(episodeId, note, "briefing");
      void recommendationPreviews.mutate();
    } catch (error) {
      setLocallyDismissedEpisodes((previous) => {
        const next = new Set(previous);
        next.delete(episodeId);
        return next;
      });
      console.warn("[briefings] failed to dismiss recommendation", error);
    }
  }, [recommendationPreviews]);
  const restoreRecommendationEpisode = useCallback(async (episodeId: string) => {
    setLocallyDismissedEpisodes((previous) => {
      const next = new Set(previous);
      next.delete(episodeId);
      return next;
    });
    await restoreLibraryRecommendation(episodeId);
    void recommendationPreviews.mutate();
  }, [recommendationPreviews]);
  const { navigateTo } = useScope();
  const openForYou = useCallback(() => {
    navigateTo("library", "");
    window.history.replaceState(
      { scope: "" },
      "",
      buildLibraryUrl("", { ...defaultLibraryUrlControls, ranking: "for-you" }),
    );
  }, [navigateTo]);

  // ── Per-section expand-all / collapse-all ─────────────────────────────────────────────────
  // One header button per section broadcasts an ExpandSignal to every expandable child
  // (CollapsibleItem, MeetingCard entries, EscalationsBlock rows). It is an ACTION toggle, not
  // a computed all-state: the icon reflects the NEXT action and flips only on its own clicks —
  // local child toggles never move it. Children keep their local open state; a fresh signal
  // object per click re-applies over any local toggling in between.
  const haptics = useHaptics();
  const [expandSignals, setExpandSignals] = useState<Record<number, ExpandSignal>>({});
  // Section indices are only meaningful for the briefing they were minted against.
  useEffect(() => setExpandSignals({}), [content]);
  const toggleSectionExpand = useCallback((si: number) => {
    setExpandSignals((prev) => {
      const current = prev[si];
      const expanded = !(current?.expanded ?? false);
      return { ...prev, [si]: { version: (current?.version ?? 0) + 1, expanded } };
    });
  }, []);

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
  // Verdict-dismissals are IN-BAND: dismiss deletes the proposal file, but the ledger keeps the
  // minted task_id (surfaced via useDismissed) and the escalations feed carries it through the
  // pre-stamp limbo window. Both sources merge here so a dismissed stamped id stays consumed
  // across the whole lifecycle — never rendered as a dead raw-token chip. (SWR dedupes this
  // fetch with NextStepsMeetingItem's own useDismissed call for the tails.)
  const { dismissed: dismissedLedger } = useDismissed(PROPOSAL_LOOP);
  const dismissedTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of dismissedLedger) {
      if (record.task_id) ids.add(record.task_id);
    }
    for (const item of escalations) {
      if ((item.kind === "action" || item.kind === "proposal") && item.verdict === "dismiss" && item.task_id) {
        ids.add(item.task_id);
      }
    }
    return ids;
  }, [dismissedLedger, escalations]);
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
  const refreshTaskState = useCallback(async () => {
    await mutateTasks();
    onEscalationsChanged();
  }, [mutateTasks, onEscalationsChanged]);
  const canvas = useMemo<CanvasContext>(
    () => ({ taskById, tasks, proposals, escalations, dismissedTaskIds, refreshTaskState, makeVerdictHandler }),
    [taskById, tasks, proposals, escalations, dismissedTaskIds, refreshTaskState, makeVerdictHandler],
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
      // A dismissed ask never renders as a row anywhere — it lives in the Dismissed tails
      // (bound bullets keep their small badge; UNFEATURED dismissed asks otherwise landed as
      // badge rows in the section blocks AND the tail — double presence, reviewer-confirmed).
      if ((item.kind === "action" || item.kind === "proposal") && item.verdict === "dismiss") continue;
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
            urlTransform={briefingUrlTransform}
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
            urlTransform={briefingUrlTransform}
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
        const isLibrarySection = section.heading.includes("📚") || /library/i.test(section.heading);
        const libraryPartition = isLibrarySection ? partitionBriefingLibrarySection(section) : null;
        const sectionRecommendationIds = isLibrarySection
          ? [...new Set(section.items.flatMap((item) => extractRecommendationEpisodeIds(`${item.headline}\n${item.details}`)))]
          : [];
        const sectionEscalations = bySection.get(si) || [];
        // B3: inside ⏭ Next steps, a bullet carrying a meeting citation renders as a
        // MeetingCard (expandable to that meeting's live task cards). Keyed on the ⏭ marker +
        // the citation — pre-B3 briefings have neither, so they render exactly as before.
        const isNextSteps = isNextStepsHeading(section.heading);
        const isDecisionQueue = isDecisionsHeading(section.heading);
        const meetingRels = section.items.map((item) =>
          isNextSteps && !item.prose ? extractMeetingRelPath(`${item.headline}\n${item.details}`) : null);
        const meetingEntryCount = meetingRels.filter(Boolean).length;
        const stampedDecisionIds = new Set(section.items.flatMap((item) => extractTaskIds(`${item.headline}\n${item.details}`)));
        const decisionPending = isDecisionQueue
          ? selectDecisionPendingProposals(proposals, stampedDecisionIds, activeBriefing)
          : [];
        const activeDecisionGroups = isDecisionQueue
          ? activeDecisionMeetingGroups(
              proposals,
              new Set(meetingRels.filter((rel): rel is string => Boolean(rel))),
              activeBriefing,
            )
          : [];
        // Escalation rows the block will actually render (⏭ filters out already-featured
        // meetings) — computed here so the header knows whether ANYTHING is expandable.
        const blockItems = isDecisionQueue
          ? []
          : isNextSteps
          ? sectionEscalations.filter((it) => {
              const src = it.citations?.[0]?.source || "";
              return !meetingRels.some((rel) => rel && src.includes(rel));
            })
          : sectionEscalations;
        // All-prose sections get no button — a control that can't do anything is dead chrome.
        const hasExpandable = !isSourcesSection && (
          meetingEntryCount > 0
          || activeDecisionGroups.length > 0
          || blockItems.length > 0
          || section.items.some((item, ii) => !meetingRels[ii] && item.details.trim().length > 0)
        );
        const signal = expandSignals[si];
        const nextExpand = !(signal?.expanded ?? false);
        if (libraryPartition?.structured) {
          return (
            <div
              key={si}
              data-briefing-decisions={isDecisionQueue ? "true" : undefined}
              data-briefing-work={section.heading.includes("💼") ? "true" : undefined}
              className="hilt-card hilt-card-static overflow-visible"
            >
              <div className="rounded-t-lg px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-[var(--text-primary)] !m-0">{section.heading}</h2>
                {hasExpandable && (
                  <button
                    type="button"
                    onClick={() => {
                      nextExpand ? haptics.soft() : haptics.rigid();
                      toggleSectionExpand(si);
                    }}
                    title={nextExpand ? "Expand all" : "Collapse all"}
                    className="shrink-0 rounded-md p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    {nextExpand ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
                  </button>
                )}
              </div>
              <BriefingLibraryModules
                partition={libraryPartition}
                recommendationByEpisode={recommendationByEpisode}
                dismissedEpisodeIds={recommendationPreviews.dismissedEpisodeIds}
                missingEpisodeIds={recommendationPreviews.missingEpisodeIds}
                recommendationError={recommendationPreviews.error}
                locallyDismissedEpisodes={locallyDismissedEpisodes}
                date={date}
                onDismiss={dismissRecommendation}
                onRestore={restoreRecommendationEpisode}
                onOpenForYou={openForYou}
                healthActions={blockItems.length > 0 ? (
                  <ul className="briefing-list !m-0 pl-5 pt-1">
                    <EscalationsBlock
                      items={blockItems}
                      onChanged={onEscalationsChanged}
                      expandSignal={signal}
                      taskById={canvas.taskById}
                      makeVerdictHandler={canvas.makeVerdictHandler}
                    />
                  </ul>
                ) : undefined}
              />
            </div>
          );
        }
        return (
          <div
            key={si}
            data-briefing-decisions={isDecisionQueue ? "true" : undefined}
            data-briefing-work={section.heading.includes("💼") ? "true" : undefined}
            className="hilt-card hilt-card-static overflow-visible"
          >
            <div className="rounded-t-lg px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)] !m-0">
                {section.heading}
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                {isDecisionQueue && (
                  <span data-decision-pending-count className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-xs tabular-nums text-[var(--text-tertiary)]">
                    {decisionPending.length} pending
                  </span>
                )}
                {hasExpandable && (
                  <button
                    type="button"
                    onClick={() => {
                      nextExpand ? haptics.soft() : haptics.rigid();
                      toggleSectionExpand(si);
                    }}
                    title={nextExpand ? "Expand all" : "Collapse all"}
                    className="shrink-0 rounded-md p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    {nextExpand ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
            {isSourcesSection ? (
              <div className="px-4 py-2 space-y-0.5 !m-0 text-sm text-[var(--text-secondary)]">
                {section.items.map((item, ii) => {
                  if (isDecisionQueue && item.prose && isDecisionQueueSummary(item.headline)) return null;
                  const fnMatch = item.headline.match(/^\[(\d+)\]\s/);
                  return (
                    <div key={ii} id={fnMatch ? `fn-${fnMatch[1]}` : undefined} className="py-0.5 leading-relaxed">
                      <ReactMarkdown
            urlTransform={briefingUrlTransform}
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
                  if (isDecisionQueue && item.prose && isDecisionQueueSummary(item.headline)) return null;
                  const isRecommendationReportLink = isLibrarySection
                    && sectionRecommendationIds.length > 0
                    && `${item.headline}\n${item.details}`.includes("/api/reports/morning");
                  if (isRecommendationReportLink) return null;
                  const recommendationIds = isLibrarySection
                    ? extractRecommendationEpisodeIds(`${item.headline}\n${item.details}`)
                    : [];
                  if (recommendationIds.length > 0) {
                    return recommendationIds.map((episodeId) => {
                      const artifact = recommendationByEpisode.get(episodeId);
                      const dismissed = locallyDismissedEpisodes.has(episodeId)
                        || recommendationPreviews.dismissedEpisodeIds.has(episodeId);
                      if (dismissed) {
                        return (
                          <li key={episodeId} className="-ml-9 -mr-4 !list-none [&::marker]:content-none">
                            <div className="hilt-card hilt-card-static mx-3 my-2 flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-[var(--text-tertiary)]">
                              <span>Recommendation dismissed</span>
                              <button
                                type="button"
                                onClick={() => void restoreRecommendationEpisode(episodeId)}
                                className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                                title="Restore recommendation"
                              >
                                <RotateCcw className="h-3.5 w-3.5" /> Undo
                              </button>
                            </div>
                          </li>
                        );
                      }
                      if (artifact) {
                        return (
                          <li key={episodeId} className="-ml-9 -mr-4 !list-none [&::marker]:content-none">
                            <BriefingRecommendationRow
                              artifact={artifact}
                              onDismiss={(note) => dismissRecommendation(episodeId, note)}
                            />
                          </li>
                        );
                      }
                      const unavailable = recommendationPreviews.missingEpisodeIds.has(episodeId) || recommendationPreviews.error;
                      return (
                        <li key={episodeId} className="-ml-9 -mr-4 !list-none [&::marker]:content-none">
                          <div className="hilt-card hilt-card-static mx-3 my-2 px-3 py-3 text-xs text-[var(--text-tertiary)]">
                            {unavailable ? "Recommendation no longer available" : "Loading recommendation…"}
                          </div>
                        </li>
                      );
                    });
                  }
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
                        decisionQueue={isDecisionQueue}
                        activeBriefing={activeBriefing}
                        defaultOpen={isDecisionQueue ? false : meetingEntryCount === 1}
                        expandSignal={signal}
                      />
                    );
                  }
                  return (
                    <CollapsibleItem key={ii} item={item} section={section.heading} date={date} absPath={absPath} feedbackable={feedbackable} boundLoopItems={byBullet.get(`${si}:${ii}`)} onLoopItemsChanged={onEscalationsChanged} canvas={canvas} expandSignal={signal} />
                  );
                })}
                {activeDecisionGroups.map((group) => {
                  const syntheticItem: BriefingItem = {
                    headline: `*${group.meeting}*`,
                    details: group.tasks.map((task) => `- \`${task.id}\``).join("\n"),
                  };
                  return (
                    <NextStepsMeetingItem
                      key={`active-decision:${group.meeting}`}
                      item={syntheticItem}
                      meetingRel={group.meeting}
                      section={section.heading}
                      date={date}
                      absPath={absPath}
                      feedbackable={feedbackable}
                      canvas={canvas}
                      decisionQueue
                      activeBriefing
                      defaultOpen={false}
                      expandSignal={signal}
                    />
                  );
                })}
                {/* Loop items the editor did NOT feature: bullets in the SAME list — urgency is
                    a flag, verdicts follow ask-ness (one item model). Inside ⏭ Next steps the
                    meeting groups take the same MeetingCard shell as the featured entries —
                    EXCEPT asks whose meeting is already featured above: the featured card's
                    citation join (joinMeetingNextSteps) renders those, so a group here would be
                    a second identical card for the same meeting (adversarial finding). */}
                <EscalationsBlock
                  items={blockItems}
                  onChanged={onEscalationsChanged}
                  asMeetingCards={isNextSteps}
                  expandSignal={signal}
                  taskById={canvas.taskById}
                  makeVerdictHandler={canvas.makeVerdictHandler}
                />
              </ul>
            )}
            {sectionRecommendationIds.length > 0 && (
              <div className="flex flex-col items-start gap-1 border-t border-[var(--border-default)] px-4 py-2.5">
                <button
                  type="button"
                  onClick={openForYou}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                >
                  View all <ArrowRight className="h-4 w-4" />
                </button>
                <BriefingLink href="/api/reports/morning" date={date} className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]">
                  Full library report
                </BriefingLink>
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}
