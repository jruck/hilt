"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatRelativeDate } from "@/components/tasks/ProposalsSection";

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-[1.55]">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--interactive-default)] underline-offset-2 transition-colors hover:text-[var(--interactive-hover)] hover:underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-[1.55] text-[var(--text-secondary)]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--border-strong)] pl-3 text-[var(--text-tertiary)]">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const block = Boolean(className);
    if (block) return <code className={className}>{children}</code>;
    return (
      <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[12px] text-[var(--text-secondary)]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-[var(--bg-secondary)] px-2.5 py-2 text-xs text-[var(--text-secondary)]">
      {children}
    </pre>
  ),
};

export function ConversationMarkdown({ content }: { content: string }) {
  return (
    <div className="text-[13px] leading-[1.55] text-[var(--text-secondary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export interface ConversationTurnProps {
  role: "user" | "assistant";
  content?: string;
  timestamp?: number | string;
  edited?: boolean;
  statusLabel?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

function timeLabel(timestamp: number | string): { relative: string; exact: string } {
  const exact = typeof timestamp === "number"
    ? new Date(timestamp).toISOString()
    : timestamp;
  return { relative: formatRelativeDate(exact), exact };
}

/** Shared visual grammar for free chats and object-anchored feedback conversations. */
export function ConversationTurn({
  role,
  content = "",
  timestamp,
  edited = false,
  statusLabel,
  actions,
  children,
  className = "",
}: ConversationTurnProps) {
  const time = timestamp === undefined ? null : timeLabel(timestamp);

  if (role === "user") {
    return (
      <article className={`group flex justify-end ${statusLabel ? "pb-4" : ""} ${className}`} data-conversation-role="user">
        <div className="relative min-w-0 max-w-[85%]">
          <div className="rounded-2xl rounded-br-[5px] bg-[var(--interactive-active)] px-3 py-2 text-[var(--text-inverted)] shadow-[0_1px_1px_rgba(0,0,0,0.06)]">
            <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.5]">{content}</div>
            {children}
          </div>
          {(time || statusLabel || actions) && (
            <div className="absolute right-0 top-full z-10 mt-1 flex items-center justify-end gap-1.5 whitespace-nowrap text-[10px] text-[var(--text-tertiary)]">
              {statusLabel ? <span>{statusLabel}</span> : null}
              {time ? (
                <time
                  dateTime={time.exact}
                  title={`${time.exact}${edited ? " · edited" : ""}`}
                  className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  {edited ? "edited · " : ""}{time.relative}
                </time>
              ) : null}
              {actions}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className={`group relative max-w-[min(720px,92%)] ${statusLabel ? "pb-4" : ""} ${className}`} data-conversation-role="assistant">
      {content.trim() ? <ConversationMarkdown content={content} /> : null}
      {children}
      {(time || statusLabel || actions) && (
        <div className="absolute left-0 top-full z-10 mt-1 flex items-center gap-1.5 whitespace-nowrap text-[10px] text-[var(--text-tertiary)]">
          {statusLabel ? <span>{statusLabel}</span> : null}
          {time ? (
            <time
              dateTime={time.exact}
              title={time.exact}
              className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {time.relative}
            </time>
          ) : null}
          {actions}
        </div>
      )}
    </article>
  );
}
