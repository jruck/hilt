"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface BriefingContentProps {
  content: string;
}

export function BriefingContent({ content }: BriefingContentProps) {
  // Strip leading h1 — redundant with the header we display above
  const displayContent = content.replace(/^\s*#\s+.+\n*/, "");

  return (
    <div className="briefing-content prose prose-invert max-w-none
      prose-headings:text-[var(--text-primary)] prose-headings:font-semibold
      prose-h1:text-xl prose-h1:mb-4 prose-h1:mt-6 first:prose-h1:mt-0
      prose-h2:text-lg prose-h2:mb-3 prose-h2:mt-6
      prose-h3:text-base prose-h3:mb-2 prose-h3:mt-4
      prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:mb-3
      prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
      prose-strong:text-[var(--text-primary)]
      prose-li:text-[var(--text-secondary)] prose-li:leading-relaxed
      prose-ul:mb-3 prose-ol:mb-3
      prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-[var(--bg-tertiary)] prose-pre:rounded-lg prose-pre:border prose-pre:border-[var(--border-default)] prose-pre:overflow-x-auto prose-pre:max-w-full
      prose-table:border-collapse prose-table:block prose-table:overflow-x-auto prose-table:max-w-full
      prose-th:border prose-th:border-[var(--border-default)] prose-th:px-3 prose-th:py-2 prose-th:bg-[var(--bg-tertiary)] prose-th:text-[var(--text-primary)] prose-th:text-sm prose-th:font-medium prose-th:whitespace-nowrap
      prose-td:border prose-td:border-[var(--border-default)] prose-td:px-3 prose-td:py-2 prose-td:text-[var(--text-secondary)] prose-td:text-sm
      prose-hr:border-[var(--border-default)] prose-hr:my-6
      prose-blockquote:border-l-[var(--border-default)] prose-blockquote:text-[var(--text-tertiary)]
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
    </div>
  );
}
