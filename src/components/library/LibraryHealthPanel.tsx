"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useLibraryHealth } from "@/hooks/useLibrary";
import { LoadingState } from "@/components/ui/LoadingState";
import type { LibraryOperationalHealth, LibrarySchedulerJobSummary } from "@/lib/library/types";

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

function clockTime(value: string | null): string {
  if (!value) return "never";
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return value.slice(0, 19);
  return time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function checkedLabel(value: string | null): string {
  if (!value) return "checked never";
  const relative = relativeTime(value);
  const exact = clockTime(value);
  return relative === "now" ? `checked now (${exact})` : `checked ${relative} ago (${exact})`;
}

function statusClass(status: "ok" | "warning" | "blocked" | "disabled") {
  if (status === "blocked") return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "disabled") return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function healthCounts(health: LibraryOperationalHealth | null) {
  if (!health) return { blocked: 0, warnings: 0, notices: 0 };
  const blockedSources = health.sources.filter((source) => source.status === "blocked").length;
  const warningSources = health.sources.filter((source) => source.status === "warning").length;
  const blockedJobs = health.scheduler.jobs.filter((job) => job.status === "blocked").length;
  const warningJobs = health.scheduler.jobs.filter((job) => job.status === "warning").length;
  const notices = health.scheduler.jobs.filter((job) => job.stderr_bytes > 0 && job.status === "ok").length;
  return {
    blocked: blockedSources + blockedJobs,
    warnings: warningSources + warningJobs + health.dead_letters.unresolved,
    notices,
  };
}

function summaryText(health: LibraryOperationalHealth | null): string {
  if (!health) return "Library health loading";
  const counts = healthCounts(health);
  if (counts.blocked) return `${counts.blocked} blocked`;
  if (counts.warnings) return `${counts.warnings} warnings`;
  if (counts.notices) return `${health.scheduler.loaded}/${health.scheduler.expected} jobs loaded, ${counts.notices} log notices`;
  return `${health.scheduler.loaded}/${health.scheduler.expected} jobs loaded`;
}

function JobDetails({ job }: { job: LibrarySchedulerJobSummary }) {
  return (
    <div className="mt-2 space-y-2 border-t border-[var(--border-default)] pt-2 text-[var(--text-tertiary)]">
      <div>{job.message}</div>
      <div className="grid gap-1 sm:grid-cols-2">
        <div>Last exit: {job.last_exit_code ?? "unknown"}</div>
        <div>Schedule: {job.schedule}</div>
        <div>Stdout: {relativeTime(job.stdout_updated_at)} ago</div>
        <div>Stderr: {relativeTime(job.stderr_updated_at)} ago · {job.stderr_bytes}b</div>
      </div>
      {job.stderr_excerpt && (
        <pre className="max-h-36 overflow-auto rounded-md bg-[var(--bg-tertiary)] p-2 font-mono text-[11px] leading-4 text-[var(--text-secondary)] whitespace-pre-wrap">
          {job.stderr_excerpt}
        </pre>
      )}
      {!job.stderr_excerpt && job.stdout_excerpt && (
        <pre className="max-h-36 overflow-auto rounded-md bg-[var(--bg-tertiary)] p-2 font-mono text-[11px] leading-4 text-[var(--text-secondary)] whitespace-pre-wrap">
          {job.stdout_excerpt}
        </pre>
      )}
    </div>
  );
}

export function LibraryHealthPanel({
  onCheckSources,
  isCheckingSources = false,
}: {
  onCheckSources?: () => void | Promise<void>;
  isCheckingSources?: boolean;
} = {}) {
  const { health, error, isLoading, isValidating, refresh } = useLibraryHealth();
  const [open, setOpen] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, right: 12 });
  const counts = healthCounts(health);
  const hasProblem = Boolean(counts.blocked || counts.warnings);
  const issueBadge = counts.blocked || counts.warnings;
  const healthButtonClass = counts.blocked
    ? statusClass("blocked")
    : counts.warnings
      ? statusClass("warning")
      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]";
  const healthBadgeClass = counts.blocked ? "bg-red-500 text-white" : "bg-amber-500 text-white";
  const refreshInFlight = isManualRefresh || Boolean(isValidating && health);

  const updatePanelPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button || typeof window === "undefined") return;
    const rect = button.getBoundingClientRect();
    setPanelPosition({
      top: Math.round(rect.bottom + 8),
      right: Math.max(12, Math.round(window.innerWidth - rect.right)),
    });
  }, []);

  const handleRefresh = async () => {
    setIsManualRefresh(true);
    setRefreshError(null);
    try {
      await refresh();
    } catch (refreshFailure) {
      setRefreshError(refreshFailure instanceof Error ? refreshFailure.message : "Refresh failed");
    } finally {
      setIsManualRefresh(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();

    const handleMouseDown = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  return (
    <div ref={panelRef} className="relative">
      <button
        ref={buttonRef}
        data-testid="library-health-button"
        onClick={() => {
          updatePanelPosition();
          setOpen((value) => !value);
        }}
        className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${healthButtonClass}`}
        title={isLoading ? "Checking Library health" : summaryText(health)}
        aria-label={isLoading ? "Checking Library health" : summaryText(health)}
      >
        <Activity className="h-4 w-4" />
        {issueBadge > 0 && (
          <span className={`absolute -right-1 -top-1 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 ${healthBadgeClass}`}>
            {issueBadge}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed z-50 max-h-[min(680px,76vh)] w-[min(94vw,760px)] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] p-3 text-xs content-card-shadow"
          style={{ top: `${panelPosition.top}px`, right: `${panelPosition.right}px` }}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-[var(--text-primary)]">Library Health</div>
              <div data-testid="library-health-checked" className="text-[var(--text-tertiary)]">{health ? `${summaryText(health)} · ${checkedLabel(health.checked_at)}` : "Loading status"}</div>
              {health && (
                <div data-testid="library-health-reweave" className="mt-0.5 text-[var(--text-tertiary)]">
                  Reweave backlog {health.reweave.backlog}
                  {health.reweave.backlog > 0 ? ` (${health.reweave.pending} pending · ${health.reweave.version_behind} behind)` : ""}
                  {" · drained "}{health.reweave.last_drained_at ? `${relativeTime(health.reweave.last_drained_at)} ago` : "never"}
                  {health.reweave.last_throttled_at ? ` · last throttle ${relativeTime(health.reweave.last_throttled_at)} ago` : ""}
                </div>
              )}
              {health && (
                <div data-testid="library-health-intake" className="mt-0.5 text-[var(--text-tertiary)]">
                  Intake {health.intake.enabled ? (health.intake.foreground ? "foreground" : "background") : "disabled"}
                  {health.intake.running ? " · checking now" : ""}
                  {` · last poll ${health.intake.last_polled_at ? `${relativeTime(health.intake.last_polled_at)} ago` : "never"}`}
                  {` · queue ${health.intake.queue_depth}`}
                  {health.intake.active ? ` (${health.intake.active} active)` : ""}
                  {health.intake.active_item ? ` · working ${health.intake.active_item.title}` : ""}
                  {health.intake.blocked ? ` · ${health.intake.blocked} blocked` : ""}
                  {health.intake.oldest_queued_at ? ` · oldest ${relativeTime(health.intake.oldest_queued_at)}` : ""}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onCheckSources && (
                <button
                  data-testid="library-check-sources"
                  type="button"
                  onClick={() => { void onCheckSources(); }}
                  disabled={isCheckingSources}
                  aria-busy={isCheckingSources}
                  className="inline-flex h-8 min-w-[112px] items-center justify-center gap-1.5 rounded-md px-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:text-[var(--text-tertiary)]"
                  title={isCheckingSources ? "Checking live Library sources" : "Check live Library sources now"}
                >
                  {isCheckingSources ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {isCheckingSources ? "Checking" : "Check sources"}
                </button>
              )}
              <button
                data-testid="library-health-refresh"
                type="button"
                onClick={handleRefresh}
                disabled={refreshInFlight}
                aria-busy={refreshInFlight}
                className="inline-flex h-8 min-w-[104px] items-center justify-center gap-1.5 rounded-md px-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:text-[var(--text-tertiary)]"
                title={refreshInFlight ? "Refreshing library health status" : "Refresh library health status"}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshInFlight ? "motion-safe:animate-spin" : ""}`} />
                {refreshInFlight ? "Refreshing" : "Refresh status"}
              </button>
            </div>
          </div>

          {(refreshError || error) && (
            <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-red-700 dark:text-red-300">
              {refreshError || "Could not refresh library health."}
            </div>
          )}

          {!health && (
            <LoadingState label="Loading health status" className="min-h-32" />
          )}

          {health && (
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="flex min-h-[360px] flex-col overflow-hidden rounded-md border border-[var(--border-default)]">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
                  <span className="font-medium text-[var(--text-primary)]">Scheduler</span>
                  <span className="text-[var(--text-tertiary)]">{health.scheduler.loaded}/{health.scheduler.expected} loaded</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {health.scheduler.jobs.map((job) => (
                    <div key={job.id} className="border-b border-[var(--border-default)] p-2 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setExpandedJob((value) => value === job.id ? null : job.id)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2 rounded-md p-1 text-left hover:bg-[var(--bg-secondary)]"
                        title={job.message || undefined}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--text-primary)]">{job.id}</span>
                          <span className="mt-0.5 block text-[var(--text-tertiary)]">{job.schedule} · {job.message}</span>
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 ${statusClass(job.status)}`}>
                          {job.status}
                        </span>
                        <ChevronDown className={`mt-0.5 h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${expandedJob === job.id ? "rotate-180" : ""}`} />
                      </button>
                      {expandedJob === job.id && <JobDetails job={job} />}
                    </div>
                  ))}
                </div>
              </section>

              <section className="flex min-h-[360px] flex-col overflow-hidden rounded-md border border-[var(--border-default)]">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
                  <span className="font-medium text-[var(--text-primary)]">Sources</span>
                  <span className="text-[var(--text-tertiary)]">
                    dead letters {health.dead_letters.total} total
                    {health.dead_letters.unresolved > 0
                      ? ` · ${health.dead_letters.unresolved} unresolved`
                      : " · all resolved"}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
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

          {health && !hasProblem && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Schedulers and sources are operational. Log notices are shown for transparency but do not count as failures.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
