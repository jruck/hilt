"use client";

import { useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ChatStatus, ChatTraceEvent } from "@/lib/chat/types";
import { formatRelativeDate } from "@/components/tasks/ProposalsSection";
import { ChatTracePanel } from "./ChatTracePanel";

export interface ChatMessageListProps {
  messages: ChatMessage[];
  status?: ChatStatus;
  liveTrace?: ChatTraceEvent[];
  liveDraft?: string;
  onOpenFile?: (relPath: string) => void;
  scrollable?: boolean;
  className?: string;
}

function timestampLabel(timestamp: number): string {
  return formatRelativeDate(new Date(timestamp).toISOString());
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
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
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-relaxed text-[var(--text-secondary)]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-[3px] border-[var(--border-strong)] pl-3 text-[var(--text-tertiary)]">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const block = Boolean(className);
    if (block) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[12px] text-[var(--text-secondary)]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">
      {children}
    </pre>
  ),
};

function AssistantMarkdown({ children }: { children: ReactNode }) {
  return (
    <div className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {String(children)}
      </ReactMarkdown>
    </div>
  );
}

function MessageRow({ message, onOpenFile }: { message: ChatMessage; onOpenFile?: (relPath: string) => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-1.5">
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
            {message.content}
          </div>
          <div className="mt-1 text-right text-[11px] text-[var(--text-quaternary)]">
            {timestampLabel(message.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md px-1 py-1.5">
      <ChatTracePanel trace={message.trace ?? []} filesTouched={message.filesTouched} onOpenFile={onOpenFile} />
      {message.content.trim() && (
        <div className={message.trace?.length ? "mt-1.5" : ""}>
          <AssistantMarkdown>{message.content}</AssistantMarkdown>
        </div>
      )}
      <div className="mt-1 text-[11px] text-[var(--text-quaternary)]">
        {timestampLabel(message.timestamp)}
      </div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  status = "idle",
  liveTrace = [],
  liveDraft = "",
  onOpenFile,
  scrollable = true,
  className = "",
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Non-scrollable embeds (drawer transcripts) must not hijack their ancestor's scroll on
  // mount/load — autoscroll only while a turn is streaming, or when this list owns its scroll.
  useEffect(() => {
    if (status !== "sending" && !scrollable) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, status, liveDraft, liveTrace.length, scrollable]);

  return (
    <div className={`space-y-3 ${scrollable ? "overflow-y-auto" : ""} ${className}`}>
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} onOpenFile={onOpenFile} />
      ))}

      {status === "sending" && (
        <div className="rounded-md px-1 py-1.5">
          <ChatTracePanel trace={liveTrace} onOpenFile={onOpenFile} />
          {liveDraft.trim() ? (
            <div className={liveTrace.length ? "mt-1.5" : ""}>
              <AssistantMarkdown>{liveDraft}</AssistantMarkdown>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Working</span>
            </div>
          )}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
