"use client";

import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";

export interface ChatComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  sending: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatComposer({
  onSend,
  onStop,
  sending,
  placeholder = "Message",
  disabled = false,
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [text]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    onSend(trimmed);
    setText("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending) submit();
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="flex items-end gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))] py-2 pl-3 pr-2 shadow-[var(--content-shadow-subtle)] transition-colors focus-within:border-[var(--interactive-default)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--interactive-default)_10%,transparent)]">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          name="chat-message"
          disabled={disabled}
          className="max-h-40 min-h-6 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-0.5 text-[13px] leading-[1.5] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {sending ? (
          <button
            type="button"
            onClick={onStop}
            disabled={disabled || !onStop}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/20 bg-red-500/5 text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-default disabled:opacity-40"
            title="Stop"
            aria-label="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || disabled}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--interactive-active)] text-[var(--text-inverted)] transition-colors hover:bg-[var(--interactive-hover)] disabled:cursor-default disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-tertiary)]"
            title="Send"
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </form>
  );
}
