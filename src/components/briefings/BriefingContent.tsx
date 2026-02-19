"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
interface BriefingContentProps {
  content: string;
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
function parseBriefing(content: string): { sections: BriefingSection[]; footnotes: string } {
  // Strip leading h1
  const body = content.replace(/^\s*#\s+.+\n*/, "");
  const lines = body.split("\n");

  const sections: BriefingSection[] = [];
  let currentSection: BriefingSection | null = null;
  let currentItem: BriefingItem | null = null;
  const footnoteLines: string[] = [];
  let inFootnotes = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect footnotes section (starts with [^1]:)
    if (line.match(/^\[\^\d+\]:/)) {
      inFootnotes = true;
    }

    if (inFootnotes) {
      footnoteLines.push(line);
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

  return { sections, footnotes: footnoteLines.join("\n") };
}

function CollapsibleItem({ item }: { item: BriefingItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = item.details.trim().length > 0;

  return (
    <li className="text-[var(--text-primary)]">
      <div
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`py-0.5 transition-colors ${
          hasDetails ? "cursor-pointer" : ""
        }`}
      >
        <span className="text-sm text-[var(--text-primary)] leading-snug briefing-inline-md">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <>{children}</>,
              strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="text-blue-400 no-underline hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {children}
                </a>
              ),
            }}
          >
            {item.headline}
          </ReactMarkdown>
        </span>
      </div>
      {expanded && hasDetails && (
        <div className="pb-1 text-sm text-[var(--text-secondary)] leading-snug">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
              a: ({ href, children }) => (
                <a href={href} className="text-blue-400 no-underline hover:underline" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
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

export function BriefingContent({ content }: BriefingContentProps) {
  const { sections, footnotes } = useMemo(() => parseBriefing(content), [content]);

  // If parsing didn't find structured sections, fall back to plain markdown
  if (sections.length === 0) {
    const displayContent = content.replace(/^\s*#\s+.+\n*/, "");
    return (
      <div className="briefing-content prose prose-invert max-w-none
        prose-headings:text-[var(--text-primary)] prose-headings:font-semibold
        prose-h2:text-lg prose-h2:mb-3 prose-h2:mt-6
        prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:mb-3
        prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
        prose-strong:text-[var(--text-primary)]
        prose-li:text-[var(--text-secondary)] prose-li:leading-relaxed
        prose-ul:mb-3 prose-ol:mb-3
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map((section, si) => (
        <div key={si}>
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">
            {section.heading}
          </h2>
          <ul className="list-disc pl-5 space-y-0">
            {section.items.map((item, ii) => (
              <CollapsibleItem key={ii} item={item} />
            ))}
          </ul>
        </div>
      ))}

      {/* Footnotes / Sources */}
      {footnotes.trim() && (
        <details className="text-xs text-[var(--text-tertiary)]">
          <summary className="cursor-pointer hover:text-[var(--text-secondary)] transition-colors py-2">
            Sources
          </summary>
          <div className="pl-2 pt-1 space-y-0.5 briefing-footnotes">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="text-xs text-[var(--text-tertiary)] mb-0.5">{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} className="text-blue-400/70 no-underline hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {footnotes}
            </ReactMarkdown>
          </div>
        </details>
      )}
    </div>
  );
}
