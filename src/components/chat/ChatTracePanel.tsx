"use client";

import { useMemo, useState } from "react";
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
  if (sorted.length === 0) return null;

  const running = sorted.filter((event) => event.status === "running").at(-1);
  const warningCount = sorted.filter((event) => event.status === "warning" || event.status === "error").length;
  const summary = running
    ? <>Working: <span className="text-[var(--text-secondary)]">{running.label}</span></>
    : (
      <>
        {plural(sorted.length, "step")}
        {filesTouched.length > 0 && <> · {plural(filesTouched.length, "file")} touched</>}
        {warningCount > 0 && <span className="text-amber-500"> · {plural(warningCount, "warning")}</span>}
      </>
    );

  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Activity className={`h-3.5 w-3.5 ${running ? "animate-pulse text-emerald-600" : ""}`} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>

      {open && (
        <div className="mt-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5">
          <ol className="space-y-1">
            {sorted.map((event) => {
              const input = formatTraceInput(event.input);
              const duration = formatTraceDuration(event.durationMs);
              return (
                <li key={event.id} className="flex gap-2">
                  <div className="pt-0.5">
                    <StatusIcon status={event.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)]">
                        {event.label}
                      </span>
                      {(event.toolName || duration) && (
                        <span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
                          {[event.toolName, duration].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </div>
                    {event.detail && (
                      <div className="mt-0.5 text-[var(--text-tertiary)]">{event.detail}</div>
                    )}
                    {input && (
                      <div className="mt-0.5 truncate text-[var(--text-quaternary)]">
                        <span className="text-[var(--text-tertiary)]">Input:</span> {input}
                      </div>
                    )}
                    {event.outputSummary && (
                      <div className="mt-0.5 truncate text-[var(--text-quaternary)]">
                        <span className="text-[var(--text-tertiary)]">Result:</span> {event.outputSummary}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {filesTouched.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {filesTouched.map((file) => onOpenFile ? (
                <button
                  key={file}
                  type="button"
                  onClick={() => onOpenFile(file)}
                  className="rounded border border-transparent bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] hover:ring-1 hover:ring-[var(--border-strong)]"
                  title={file}
                >
                  {file}
                </button>
              ) : (
                <span
                  key={file}
                  className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]"
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
