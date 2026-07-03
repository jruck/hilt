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
  loopMatchesSection,
  type EscalatedLoopItem,
} from "./EscalationsPanel";
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

interface BriefingItem {
  headline: string; // top-level bullet text (markdown)
  details: string; // sub-bullets as markdown
  /** True when this "item" is a paragraph/standalone-link line, not a bullet (renders unmarked). */
  prose?: boolean;
}

interface BriefingSection {
  heading: string; // ## heading text
  items: BriefingItem[];
}

/**
 * Parse briefing markdown into a lede + sections with collapsible items.
 * Handles the briefing shape:
 *   **Day-thesis lede paragraph.**
 *   ## Section Heading
 *   - Top-level headline
 *     - Detail sub-bullet
 *   Prose paragraph (sections may be prose-styled — e.g. Library)
 *   [Full library report](/api/reports/morning)
 * Paragraph lines and standalone link lines are PRESERVED as unmarked items — the first
 * renderer dropped every non-bullet line, which silently emptied prose-styled sections and
 * hid the lede entirely. Parsing stops at a `---` horizontal rule (the generation footer).
 */
function parseBriefing(content: string): { lede: string; sections: BriefingSection[] } {
  // Strip leading h1
  const body = content.replace(/^\s*#\s+.+\n*/, "");
  const lines = body.split("\n");

  const sections: BriefingSection[] = [];
  const ledeLines: string[] = [];
  let currentSection: BriefingSection | null = null;
  let currentItem: BriefingItem | null = null;

  const flushItem = () => {
    if (currentItem && currentSection) currentSection.items.push(currentItem);
    currentItem = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Horizontal rule — everything after it is the generation footer; stop.
    if (line.match(/^\s*(-{3,}|\*{3,})\s*$/)) break;

    // Footnote definition lines — treat as top-level items in current section
    const footnoteMatch = line.match(/^\[\^(\d+)\]:\s*(.*)/);
    if (footnoteMatch) {
      flushItem();
      currentItem = {
        headline: `[${footnoteMatch[1]}] ${footnoteMatch[2]}`,
        details: "",
      };
      continue;
    }

    // ## Section heading
    if (line.match(/^##\s+/)) {
      flushItem();
      if (currentSection) sections.push(currentSection);
      currentSection = {
        heading: line.replace(/^##\s+/, "").trim(),
        items: [],
      };
      continue;
    }

    // Top-level bullet: "- " at start (no indent)
    if (line.match(/^- /)) {
      flushItem();
      currentItem = {
        headline: line.replace(/^- /, "").trim(),
        details: "",
      };
      continue;
    }

    // Indented line (sub-bullet or continuation) — belongs to current item. Prose items absorb
    // them too: a paragraph-styled meeting entry with indented ask sub-bullets must keep its
    // asks as details, not have them smashed into the paragraph text.
    if (currentItem && line.match(/^\s{2,}/)) {
      currentItem.details += (currentItem.details ? "\n" : "") + line;
      continue;
    }

    // Paragraph / standalone-link line (unindented, non-bullet, non-heading)
    if (line.trim() !== "") {
      if (!currentSection) {
        // Before the first section heading = the day-thesis lede.
        ledeLines.push(line.trim());
        continue;
      }
      // Merge consecutive paragraph lines into one prose item.
      if (currentItem?.prose) {
        currentItem.headline += ` ${line.trim()}`;
      } else {
        flushItem();
        currentItem = { headline: line.trim(), details: "", prose: true };
      }
      continue;
    }

    // Empty line — paragraph boundary for prose; spacing for bullet details.
    if (currentItem?.prose) {
      flushItem();
    } else if (currentItem && currentItem.details) {
      currentItem.details += "\n";
    }
  }

  // Save final item and section
  flushItem();
  if (currentSection) {
    sections.push(currentSection);
  }

  return { lede: ledeLines.join(" "), sections };
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

/** Join keys are not reading material: strip loop item ids + loop citations from display text. */
function cleanLoopTokens(text: string): string {
  return text
    .replace(/`[a-z]{2,8}-\d{4}-\d{2}-\d{2}-\d{3}`/g, "")
    .replace(/\b[a-z]{2,8}-\d{4}-\d{2}-\d{2}-\d{3}\b/g, "")
    .replace(/\*loop:[^*]+\*/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/ {2,}/g, " ");
}

function CollapsibleItem({ item, section, date, absPath, feedbackable, boundLoopItems = [], onLoopItemsChanged = () => {} }: { item: BriefingItem; section: string; date?: string; absPath?: string; feedbackable?: boolean; boundLoopItems?: EscalatedLoopItem[]; onLoopItemsChanged?: () => void }) {
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  // Asks bound to this bullet: headline-bound get floating controls on the headline's line;
  // detail-bound render each ask's controls on ITS OWN sub-bullet line — never a parallel
  // control stack repeating the editor's list (rejected 2026-07-03). Ask lists expand/collapse
  // like any other briefing item — actions don't force visibility, the reader chooses.
  const headlineBound = boundLoopItems.filter((loopItem) => item.headline.includes(loopItem.id));
  const detailBound = boundLoopItems.filter((loopItem) => item.details.includes(loopItem.id));
  const hasAskList = detailBound.length > 0;
  const hasDetails = item.details.trim().length > 0;
  const escalatedHere = boundLoopItems.some((loopItem) => loopItem.escalated);

  // Detect footnote items like "[1] Some text" and add anchor id
  const footnoteMatch = item.headline.match(/^\[(\d+)\]\s/);
  const footnoteId = footnoteMatch ? `fn-${footnoteMatch[1]}` : undefined;

  return (
    <li id={footnoteId} className={`${headlineBound.length ? "group/askrow " : ""}relative text-[var(--text-secondary)] ${item.prose ? "list-none -ml-4 py-1" : ""} ${hasDetails ? `briefing-expandable${expanded ? " briefing-expanded" : ""}` : ""} ${escalatedHere ? "briefing-escalated" : ""}`}>
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
            {renderCitations(hasAskList || headlineBound.length ? cleanLoopTokens(item.headline) : item.headline)}
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
      {/* Detail-bound asks: the editor's sub-bullets ARE the ask list — one structure. Expands
          and collapses like any briefing item; each ask's controls float on its own line. */}
      {expanded && hasAskList && (
        <ul className="briefing-list pl-5 space-y-0.5 pb-1">
          {item.details.split("\n").map((line, li) => {
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

export function BriefingContent({ content, date, absPath, feedbackable = true, escalations = [], onEscalationsChanged = () => {} }: BriefingContentProps) {
  const { lede, sections } = useMemo(() => parseBriefing(content), [content]);

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
          if (`${bullet.headline}\n${bullet.details}`.includes(item.id)) {
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
      // Next: the section that cites the loop; then the heading name-map; then the fallback fold.
      let sectionIndex = sectionTexts.findIndex((text) => text.includes(`loop:${item.loop}`));
      if (sectionIndex === -1) {
        sectionIndex = sections.findIndex((section) => loopMatchesSection(item.loop, section.heading));
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
        prose-a:text-[var(--interactive-default)] hover:prose-a:text-[var(--interactive-hover)]
        prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-2
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
    <div className="briefing-content prose max-w-none prose-headings:text-[var(--text-primary)] prose-headings:font-semibold prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-strong:text-[var(--text-primary)] prose-a:text-[var(--interactive-default)] hover:prose-a:text-[var(--interactive-hover)] prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-2 prose-li:text-[var(--text-secondary)] prose-li:leading-relaxed prose-code:text-[var(--text-secondary)] prose-code:bg-[var(--bg-tertiary)] space-y-5">
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
                {section.items.map((item, ii) => (
                  <CollapsibleItem key={ii} item={item} section={section.heading} date={date} absPath={absPath} feedbackable={feedbackable} boundLoopItems={byBullet.get(`${si}:${ii}`)} onLoopItemsChanged={onEscalationsChanged} />
                ))}
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
