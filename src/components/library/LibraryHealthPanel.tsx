"use client";

import { useState } from "react";
import { Activity, AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
import { useLibraryHealth } from "@/hooks/useLibrary";
import type { LibraryOperationalHealth } from "@/lib/library/types";

function relativeTime(value: string | null): string {
  if (!value) return "never";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value.slice(0, 10);
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 2) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function statusClass(status: "ok" | "warning" | "blocked" | "disabled") {
  if (status === "blocked") return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "disabled") return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function summaryText(health: LibraryOperationalHealth | null): string {
  if (!health) return "Health";
  const blockedSources = health.sources.filter((source) => source.status === "blocked").length;
  const warningSources = health.sources.filter((source) => source.status === "warning").length;
  const blockedJobs = health.scheduler.jobs.filter((job) => job.status === "blocked").length;
  if (blockedSources || blockedJobs) return `${blockedSources + blockedJobs} blocked`;
  if (warningSources || health.dead_letters.recent_24h) return `${warningSources + health.dead_letters.recent_24h} warnings`;
  return `${health.scheduler.loaded}/${health.scheduler.expected} jobs`;
}

export function LibraryHealthPanel() {
  const { health, isLoading, mutate } = useLibraryHealth();
  const [open, setOpen] = useState(false);
  const hasProblem = Boolean(health && !health.ok);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${hasProblem ? statusClass("warning") : "border-[var(--border-default)] bg-[var(--content-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
        title="Library source and scheduler health"
      >
        {hasProblem ? <AlertTriangle className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
        <span>{isLoading ? "Checking" : summaryText(health)}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-[min(620px,70vh)] w-[min(92vw,720px)] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-3 text-xs content-card-shadow">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-[var(--text-primary)]">Library Health</div>
              <div className="text-[var(--text-tertiary)]">Checked {relativeTime(health?.checked_at || null)} ago</div>
            </div>
            <button
              onClick={() => mutate()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              title="Refresh library health"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {!health && (
            <div className="rounded-md border border-[var(--border-default)] p-3 text-[var(--text-tertiary)]">Health status is loading.</div>
          )}

          {health && (
            <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr]">
              <section className="space-y-2">
                <div className="font-medium text-[var(--text-primary)]">Scheduler</div>
                {health.scheduler.jobs.map((job) => (
                  <div key={job.id} className="rounded-md border border-[var(--border-default)] p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{job.id}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${statusClass(job.status)}`}>{job.status}</span>
                    </div>
                    <div className="mt-1 text-[var(--text-tertiary)]">{job.schedule} · exit {job.last_exit_code ?? "unknown"}</div>
                    <div className="mt-1 text-[var(--text-tertiary)]">err {job.stderr_bytes}b · {relativeTime(job.stderr_updated_at)}</div>
                  </div>
                ))}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">Sources</span>
                  <span className="text-[var(--text-tertiary)]">dead letters {health.dead_letters.total} total / {health.dead_letters.recent_24h} recent</span>
                </div>
                <div className="max-h-[360px] overflow-y-auto rounded-md border border-[var(--border-default)]">
                  {health.sources.map((source) => (
                    <div key={source.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[var(--border-default)] p-2 last:border-b-0">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--text-primary)]">{source.name}</div>
                        <div className="text-[var(--text-tertiary)]">{source.artifact_count} saved · {source.candidate_count} candidates · {relativeTime(source.last_fetched)} success</div>
                        {source.last_error && <div className="mt-1 line-clamp-2 text-amber-700 dark:text-amber-300">{source.last_error}</div>}
                        {source.blocked && <div className="mt-1 line-clamp-2 text-red-700 dark:text-red-300">{source.blocked}</div>}
                      </div>
                      <span className={`self-start rounded-full border px-2 py-0.5 ${statusClass(source.status)}`}>{source.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
