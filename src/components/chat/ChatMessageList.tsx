"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage, ChatStatus, ChatTraceEvent } from "@/lib/chat/types";
import { ChatTracePanel } from "./ChatTracePanel";
import { ConversationTurn } from "./ConversationTurn";

export interface ChatMessageListProps {
  messages: ChatMessage[];
  status?: ChatStatus;
  liveTrace?: ChatTraceEvent[];
  liveDraft?: string;
  onOpenFile?: (relPath: string) => void;
  scrollable?: boolean;
  className?: string;
}

function MessageRow({ message, onOpenFile }: { message: ChatMessage; onOpenFile?: (relPath: string) => void }) {
  return (
    <ConversationTurn role={message.role} content={message.content} timestamp={message.timestamp}>
      {message.role === "assistant" ? (
        <ChatTracePanel
          trace={message.trace ?? []}
          filesTouched={message.filesTouched}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </ConversationTurn>
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
    <div
      className={`space-y-3.5 ${scrollable ? "overflow-y-auto" : ""} ${className}`}
      role="log"
      aria-live="polite"
      aria-busy={status === "sending"}
    >
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} onOpenFile={onOpenFile} />
      ))}

      {status === "sending" && (
        <ConversationTurn role="assistant" content={liveDraft}>
          {liveDraft.trim() ? (
            null
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]" role="status">
              <span className="flex items-center gap-0.5" aria-hidden="true">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/40 animate-pulse [animation-delay:300ms]" />
              </span>
              <span>Working</span>
            </div>
          )}
          <ChatTracePanel trace={liveTrace} onOpenFile={onOpenFile} />
        </ConversationTurn>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
