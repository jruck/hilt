"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useTheme } from "@/hooks/useTheme";

function rewriteWikilinks(markdown: string): string {
  return markdown
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
      const src = target.trim();
      const alt = (label || src).trim().replace(/]/g, "\\]");
      return `![${alt}](${src})`;
    })
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
      const display = (label || target).trim().replace(/]/g, "\\]");
      return `[${display}](#wikilink:${encodeURIComponent(target.trim())})`;
    });
}

export function LibraryMarkdown({ markdown, className = "" }: { markdown: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const proseInvert = resolvedTheme === "dark" ? "prose-invert" : "";
  const proseClass = `prose ${proseInvert} max-w-none leading-normal font-[family-name:var(--font-geist-sans)]
    prose-headings:font-semibold prose-headings:text-[var(--text-primary)]
    prose-p:text-[var(--text-secondary)] prose-li:text-[var(--text-secondary)]
    prose-strong:text-[var(--text-primary)]
    prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:before:content-none prose-code:after:content-none
    prose-pre:rounded-lg prose-pre:bg-[var(--bg-tertiary)]
    prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
    prose-img:rounded-lg prose-img:border prose-img:border-[var(--border-default)]
    prose-table:border-collapse prose-table:bg-[var(--bg-primary)]
    prose-thead:bg-[var(--bg-secondary)]
    prose-th:border prose-th:border-[var(--border-default)] prose-th:px-3 prose-th:py-2
    prose-td:border prose-td:border-[var(--border-default)] prose-td:px-3 prose-td:py-2 prose-td:bg-[var(--bg-primary)]`;

  const components: Components = {
    a({ href, children, ...props }) {
      if (href?.startsWith("#wikilink:")) {
        return <span className="font-medium text-blue-600 dark:text-blue-400">{children}</span>;
      }
      return <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noreferrer" : undefined} {...props}>{children}</a>;
    },
    iframe({ src, title, ...props }) {
      return (
        <div className="my-4 aspect-video w-full overflow-hidden rounded-lg border border-[var(--border-default)] bg-black">
          <iframe
            src={src}
            title={title || "Embedded media"}
            className="h-full w-full"
            loading="lazy"
            allowFullScreen
            {...props}
          />
        </div>
      );
    },
    details({ children, ...props }) {
      return <details className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3" {...props}>{children}</details>;
    },
    summary({ children, ...props }) {
      return <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]" {...props}>{children}</summary>;
    },
  };

  return (
    <div className={`${proseClass} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {rewriteWikilinks(markdown)}
      </ReactMarkdown>
    </div>
  );
}
