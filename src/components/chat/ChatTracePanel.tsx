"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import type { ChatTraceEvent } from "@/lib/chat/types";

export interface ChatTracePanelProps {
  trace: ChatTraceEvent[];
  filesTouched?: string[];
  onOpenFile?: (relPath: string) => void;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function formatTraceInput(input: Record<string, unknown> | null | undefined): string | null {
  if (!input) return null;
  if (typeof input.query === "string") return truncate(input.query, 140);
  if (typeof input.prompt === "string") return truncate(input.prompt, 140);
  try {
    return truncate(JSON.stringify(input), 140);
  } catch {
    return null;
  }
}

function formatTraceDuration(durationMs: number | null | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: ChatTraceEvent["status"] }) {
  if (status === "running") return <Clock3 className="h-3.5 w-3.5 animate-pulse text-emerald-600" />;
  if (status === "complete") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  return (
    <AlertTriangle
      className={`h-3.5 w-3.5 ${status === "error" ? "text-red-500" : "text-amber-500"}`}
    />
  );
}

export function ChatTracePanel({ trace, filesTouched = [], onOpenFile }: ChatTracePanelProps) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => [...trace].sort((a, b) => a.timestamp - b.timestamp), [trace]);
  const running = sorted.filter((event) => event.status === "running").at(-1);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    const isRunning = Boolean(running);
    if (isRunning && !wasRunningRef.current) setOpen(true);
    wasRunningRef.current = isRunning;
  }, [running]);

  if (sorted.length === 0) return null;

  const warningCount = sorted.filter((event) => event.status === "warning" || event.status === "error").length;
  const countSummary = [
    plural(sorted.length, "step"),
    filesTouched.length > 0 ? `${plural(filesTouched.length, "file")} touched` : null,
    warningCount > 0 ? plural(warningCount, "warning") : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={`mt-2.5 overflow-hidden rounded-lg border text-[11px] ${
      running
        ? "border-emerald-500/25 bg-emerald-500/[0.035]"
        : "border-[var(--border-default)] bg-[var(--bg-secondary)]/55"
    }`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-8 w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)]/60"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
        <Activity className={`h-3.5 w-3.5 ${running ? "animate-pulse text-emerald-600" : "text-[var(--text-tertiary)]"}`} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {running ? <>Working: <span className="font-medium">{running.label}</span></> : "Activity trace"}
        </span>
        <span className={`shrink-0 text-[10px] font-medium ${warningCount > 0 ? "text-amber-600" : "text-[var(--text-tertiary)]"}`}>
          {countSummary}
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))]">
          <ol>
            {sorted.map((event) => {
              const input = formatTraceInput(event.input);
              const duration = formatTraceDuration(event.durationMs);
              return (
                <li
                  key={event.id}
                  className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2 border-t border-[var(--border-subtle)] px-2.5 py-2 first:border-t-0"
                >
                  <div className="pt-0.5">
                    <StatusIcon status={event.status} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-[var(--text-secondary)]">{event.label}</div>
                    {event.detail && (
                      <div className="mt-0.5 leading-[1.35] text-[var(--text-tertiary)]">{event.detail}</div>
                    )}
                    {input && (
                      <div className="mt-0.5 truncate text-[var(--text-tertiary)]">
                        <span className="font-medium text-[var(--text-secondary)]">Input:</span> {input}
                      </div>
                    )}
                    {event.outputSummary && (
                      <div className="mt-0.5 truncate text-[var(--text-tertiary)]">
                        <span className="font-medium text-[var(--text-secondary)]">Result:</span> {event.outputSummary}
                      </div>
                    )}
                  </div>
                  {(event.toolName || duration) ? (
                    <div className="flex max-w-28 flex-col items-end gap-0.5 text-[10px] tabular-nums text-[var(--text-tertiary)]">
                      {event.toolName ? <span className="max-w-full truncate">{event.toolName}</span> : null}
                      {duration ? <span>{duration}</span> : null}
                    </div>
                  ) : <span />}
                </li>
              );
            })}
          </ol>

          {filesTouched.length > 0 && (
            <div className="flex flex-wrap gap-1 border-t border-[var(--border-default)] px-2.5 py-2">
              {filesTouched.map((file) => onOpenFile ? (
                <button
                  key={file}
                  type="button"
                  onClick={() => onOpenFile(file)}
                  className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  title={file}
                >
                  {file}
                </button>
              ) : (
                <span
                  key={file}
                  className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]"
                  title={file}
                >
                  {file}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
