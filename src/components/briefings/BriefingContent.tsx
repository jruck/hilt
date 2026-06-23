"use client";

import { useState, useMemo, useCallback, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useHaptics } from "@/hooks/useHaptics";
import { useScope } from "@/contexts/ScopeContext";
import { withBasePath } from "@/lib/base-path";
import { CopyReferenceButton } from "@/components/ui/CopyReferenceButton";
interface BriefingContentProps {
  content: string;
  date?: string;
  /** Absolute path to the briefing file — enables a Copy reference button per item. */
  absPath?: string;
}

interface BriefingItem {
  headline: string; // top-level bullet text (markdown)
  details: string; // sub-bullets as markdown
}

interface BriefingSection {
  heading: string; // ## heading text
  items: BriefingItem[];
}

/**
 * Parse briefing markdown into sections with collapsible items.
 * Expects format:
 *   ## Section Heading
 *   - Top-level headline
 *     - Detail sub-bullet
 *     - Another detail
 */
function parseBriefing(content: string): { sections: BriefingSection[] } {
  // Strip leading h1
  const body = content.replace(/^\s*#\s+.+\n*/, "");
  const lines = body.split("\n");

  const sections: BriefingSection[] = [];
  let currentSection: BriefingSection | null = null;
  let currentItem: BriefingItem | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Footnote definition lines — treat as top-level items in current section
    const footnoteMatch = line.match(/^\[\^(\d+)\]:\s*(.*)/);
    if (footnoteMatch) {
      if (currentItem && currentSection) {
        currentSection.items.push(currentItem);
      }
      currentItem = {
        headline: `[${footnoteMatch[1]}] ${footnoteMatch[2]}`,
        details: "",
      };
      continue;
    }

    // ## Section heading
    if (line.match(/^##\s+/)) {
      // Save previous item
      if (currentItem && currentSection) {
        currentSection.items.push(currentItem);
        currentItem = null;
      }
      // Save previous section
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: line.replace(/^##\s+/, "").trim(),
        items: [],
      };
      continue;
    }

    // Top-level bullet: "- " at start (no indent)
    if (line.match(/^- /)) {
      // Save previous item
      if (currentItem && currentSection) {
        currentSection.items.push(currentItem);
      }
      currentItem = {
        headline: line.replace(/^- /, "").trim(),
        details: "",
      };
      continue;
    }

    // Indented line (sub-bullet or continuation) — belongs to current item
    if (currentItem && line.match(/^\s{2,}/)) {
      currentItem.details += (currentItem.details ? "\n" : "") + line;
      continue;
    }

    // Empty line — preserve for spacing
    if (line.trim() === "" && currentItem) {
      if (currentItem.details) {
        currentItem.details += "\n";
      }
      continue;
    }
  }

  // Save final item and section
  if (currentItem && currentSection) {
    currentSection.items.push(currentItem);
  }
  if (currentSection) {
    sections.push(currentSection);
  }

  return { sections };
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

function CollapsibleItem({ item, date, absPath }: { item: BriefingItem; date?: string; absPath?: string }) {
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  const hasDetails = item.details.trim().length > 0;

  // Detect footnote items like "[1] Some text" and add anchor id
  const footnoteMatch = item.headline.match(/^\[(\d+)\]\s/);
  const footnoteId = footnoteMatch ? `fn-${footnoteMatch[1]}` : undefined;

  return (
    <li id={footnoteId} className={`text-[var(--text-secondary)] ${hasDetails ? `briefing-expandable${expanded ? " briefing-expanded" : ""}` : ""}`}>
      <div
        onClick={() => {
          if (!hasDetails) return;
          if (expanded) haptics.rigid();
          else haptics.soft();
          setExpanded(!expanded);
        }}
        className={`group flex items-start justify-between gap-2 py-0.5 ${hasDetails ? "cursor-pointer" : ""}`}
      >
        <span className="text-[var(--text-secondary)] leading-relaxed briefing-inline-md">
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
            {renderCitations(item.headline)}
          </ReactMarkdown>
        </span>
        {absPath && (
          <span onClick={(e) => e.stopPropagation()} className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <CopyReferenceButton variant="icon" reference={{ kind: "briefing-item", absPath, headline: item.headline }} />
          </span>
        )}
      </div>
      {expanded && hasDetails && (
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

export function BriefingContent({ content, date, absPath }: BriefingContentProps) {
  const { sections } = useMemo(() => parseBriefing(content), [content]);

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
      {sections.map((section, si) => {
        const isSourcesSection = /sources/i.test(section.heading);
        return (
          <div key={si} className="hilt-card hilt-card-static overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
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
                  <CollapsibleItem key={ii} item={item} date={date} absPath={absPath} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

    </div>
  );
}
