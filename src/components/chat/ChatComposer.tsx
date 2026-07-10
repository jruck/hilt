"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
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
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        disabled={disabled}
        className="min-h-14 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="mt-1.5 flex items-center justify-end">
        {sending ? (
          <button
            type="button"
            onClick={onStop}
            disabled={disabled || !onStop}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:text-red-500 disabled:cursor-default disabled:opacity-50"
            title="Stop"
            aria-label="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || disabled}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
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
