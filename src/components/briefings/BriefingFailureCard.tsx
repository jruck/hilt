"use client";

import { AlertTriangle, Clock3, RefreshCw } from "lucide-react";
import type { BriefingRunFailure } from "@/hooks/useBriefings";

interface BriefingFailureCardProps {
  run: BriefingRunFailure;
  onRetry: () => void;
  retryStatus: "idle" | "queued" | "error";
  retryMessage: string | null;
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readableError(error: string): string {
  const doubleQuoted = error.match(/['"]message['"]\s*:\s*"([^"]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1];
  const singleQuoted = error.match(/['"]message['"]\s*:\s*'([^']+)'/);
  if (singleQuoted?.[1]) return singleQuoted[1];
  return error.replace(/^RuntimeError:\s*/, "");
}

export function BriefingFailureCard({
  run,
  onRetry,
  retryStatus,
  retryMessage,
}: BriefingFailureCardProps) {
  const runAt = formatDateTime(run.runAt);
  const nextRunAt = formatDateTime(run.nextRunAt);
  const autoRetryNextRunAt = formatDateTime(run.autoRetryNextRunAt);
  const error = readableError(run.error);
  const retryQueued = retryStatus === "queued";

  return (
    <div className="hilt-card hilt-card-warning overflow-hidden">
      <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Briefing failed</h2>
            <p className="text-xs text-[var(--text-tertiary)]">
              {runAt ? `Hermes ran ${runAt}` : "Hermes reported a failed run"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={retryQueued}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-70"
          title="Retry briefing generation"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retryQueued ? "animate-spin" : ""}`} />
          {retryQueued ? "Queued" : "Retry"}
        </button>
      </div>

      <div className="space-y-3 px-4 py-3 text-sm">
        <p className="text-[var(--text-secondary)]">{error}</p>

        <div className="flex flex-wrap gap-2 text-xs text-[var(--text-tertiary)]">
          <span className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1">
            {run.kind === "quota" ? "Quota or usage limit" : "Generation error"}
          </span>
          {autoRetryNextRunAt && (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1">
              <Clock3 className="h-3 w-3" />
              Auto retry {autoRetryNextRunAt}
            </span>
          )}
          {nextRunAt && (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1">
              <Clock3 className="h-3 w-3" />
              Daily run {nextRunAt}
            </span>
          )}
        </div>

        {retryMessage && (
          <p className={`text-xs ${retryStatus === "error" ? "text-red-400" : "text-[var(--text-tertiary)]"}`}>
            {retryMessage}
          </p>
        )}
      </div>
    </div>
  );
}
