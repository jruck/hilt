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

function relativeAgo(value: string | null): string {
  const relative = relativeTime(value);
  return relative === "now" || relative === "never" ? relative : `${relative} ago`;
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

type HealthStatus = "ok" | "warning" | "blocked" | "disabled" | "active";

function statusClass(status: HealthStatus) {
  if (status === "blocked") return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "active") return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (status === "disabled") return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function errorSummary(value: string | null): string | null {
  if (!value) return null;
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function healthCounts(health: LibraryOperationalHealth | null) {
  if (!health) return { blocked: 0, warnings: 0, notices: 0 };
  const blockedSources = health.sources.filter((source) => source.status === "blocked").length;
  const warningSources = health.sources.filter((source) => source.status === "warning").length;
  const blockedJobs = health.scheduler.jobs.filter((job) => job.status === "blocked").length;
  const warningJobs = health.scheduler.jobs.filter((job) => job.status === "warning").length;
  const notices = health.scheduler.jobs.filter((job) => job.stderr_current && job.stderr_bytes > 0 && job.status === "ok").length;
  const recommendationWarnings = health.recommendations.last_error ? 1 : 0;
  return {
    blocked: blockedSources + blockedJobs + health.intake.blocked,
    warnings: warningSources + warningJobs + health.dead_letters.unresolved + recommendationWarnings,
    notices,
  };
}

function RuntimeHealthRow({
  title,
  detail,
  status,
  statusLabel,
  error,
  testId,
  className = "",
}: {
  title: string;
  detail: string;
  status: HealthStatus;
  statusLabel: string;
  error?: string | null;
  testId?: string;
  className?: string;
}) {
  return (
    <div data-testid={testId} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-2.5 ${className}`}>
      <div className="min-w-0">
        <div className="font-medium text-[var(--text-primary)]">{title}</div>
        <div className="mt-0.5 text-[var(--text-tertiary)]">{detail}</div>
        {error && <div className="mt-1 text-amber-700 dark:text-amber-300">{error}</div>}
      </div>
      <span className={`self-start rounded-full border px-2 py-0.5 ${statusClass(status)}`}>{statusLabel}</span>
    </div>
  );
}

function summaryText(health: LibraryOperationalHealth | null): string {
  if (!health) return "Library health loading";
  const counts = healthCounts(health);
  const warningLabel = `${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`;
  if (counts.blocked && counts.warnings) return `${counts.blocked} blocked · ${warningLabel}`;
  if (counts.blocked) return `${counts.blocked} blocked`;
  if (counts.warnings) return warningLabel;
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
        <div>Stdout: {relativeAgo(job.stdout_updated_at)}</div>
        <div>Stderr: {relativeAgo(job.stderr_updated_at)} · {job.stderr_bytes}b</div>
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
  const issueBadge = counts.blocked + counts.warnings;
  const healthButtonClass = counts.blocked
    ? statusClass("blocked")
    : counts.warnings
      ? statusClass("warning")
      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]";
  const healthBadgeClass = counts.blocked ? "bg-red-500 text-white" : "bg-amber-500 text-white";
  const refreshInFlight = isManualRefresh || Boolean(isValidating && health);
  const recommendationError = errorSummary(health?.recommendations.last_error || null);
  const recommendationDetail = health ? [
    health.recommendations.last_success_at ? `Last success ${relativeAgo(health.recommendations.last_success_at)}` : "No successful run",
    health.recommendations.last_batch_id ? `${health.recommendations.last_batch_size} selected` : null,
    health.recommendations.pending ? "refresh pending" : null,
    health.recommendations.next_retry_at ? `retry at ${clockTime(health.recommendations.next_retry_at)}` : null,
  ].filter(Boolean).join(" · ") : "";
  const intakeStatus: HealthStatus = !health?.intake.enabled
    ? "disabled"
    : health.intake.blocked > 0
      ? "blocked"
      : health.intake.running || health.intake.active > 0
        ? "active"
        : "ok";
  const intakeStatusLabel = !health?.intake.enabled
    ? "disabled"
    : health.intake.blocked > 0
      ? `${health.intake.blocked} blocked`
      : health.intake.running
        ? "checking"
        : health.intake.active > 0
          ? `${health.intake.active} active`
          : "ok";
  const intakeDetail = health ? [
    health.intake.foreground ? "Foreground polling" : "Background polling",
    `last poll ${relativeAgo(health.intake.last_polled_at)}`,
    `queue ${health.intake.queue_depth}`,
    health.intake.active_item ? `working ${health.intake.active_item.title}` : null,
    health.intake.oldest_queued_at ? `oldest ${relativeAgo(health.intake.oldest_queued_at)}` : null,
  ].filter(Boolean).join(" · ") : "";
  const reweaveDetail = health ? [
    `${health.reweave.pending} pending`,
    `${health.reweave.version_behind} version${health.reweave.version_behind === 1 ? "" : "s"} behind`,
    `drained ${relativeAgo(health.reweave.last_drained_at)}`,
    health.reweave.last_throttled_at ? `last throttle ${relativeAgo(health.reweave.last_throttled_at)}` : null,
  ].filter(Boolean).join(" · ") : "";
  const deadLetterDetail = health ? [
    `${health.dead_letters.total} total`,
    health.dead_letters.unresolved > 0 ? `${health.dead_letters.unresolved} unresolved` : "all resolved",
    `${health.dead_letters.recent_24h} in the last 24h`,
    health.dead_letters.last_at ? `last ${relativeAgo(health.dead_letters.last_at)}` : null,
  ].filter(Boolean).join(" · ") : "";

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

          {health && (<>
            <section className="mb-3 overflow-hidden rounded-md border border-[var(--border-default)]">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
                <span className="font-medium text-[var(--text-primary)]">Runtime</span>
                <span className="text-[var(--text-tertiary)]">current operational state</span>
              </div>
              <div className="grid sm:grid-cols-2">
                <RuntimeHealthRow
                  title="Recommendations"
                  detail={recommendationDetail}
                  status={recommendationError ? "warning" : "ok"}
                  statusLabel={recommendationError ? "warning" : "ok"}
                  error={recommendationError}
                  testId="library-health-recommendations"
                  className="border-b border-[var(--border-default)] sm:border-r"
                />
                <RuntimeHealthRow
                  title="Dead letters"
                  detail={deadLetterDetail}
                  status={health.dead_letters.unresolved > 0 ? "warning" : "ok"}
                  statusLabel={health.dead_letters.unresolved > 0 ? `${health.dead_letters.unresolved} warning${health.dead_letters.unresolved === 1 ? "" : "s"}` : "ok"}
                  testId="library-health-dead-letters"
                  className="border-b border-[var(--border-default)]"
                />
                <RuntimeHealthRow
                  title="Intake"
                  detail={intakeDetail}
                  status={intakeStatus}
                  statusLabel={intakeStatusLabel}
                  testId="library-health-intake"
                  className="border-b border-[var(--border-default)] sm:border-b-0 sm:border-r"
                />
                <RuntimeHealthRow
                  title="Reweave"
                  detail={reweaveDetail}
                  status={health.reweave.backlog > 0 ? "active" : "ok"}
                  statusLabel={health.reweave.backlog > 0 ? `${health.reweave.backlog} queued` : "ok"}
                  testId="library-health-reweave"
                />
              </div>
            </section>

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
                  <span className="text-[var(--text-tertiary)]">{health.sources.length} configured</span>
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
          </>)}

          {health && !hasProblem && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Library runtime, schedulers, and sources are operational. Active queues and retained log notices are informational.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
