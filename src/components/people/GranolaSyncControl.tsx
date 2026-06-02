"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { runGranolaSync, useGranolaSyncStatus } from "@/hooks/useGranolaSync";
import type { GranolaSyncStatus } from "@/lib/granola/types";

const STALE_SYNC_MS = 10 * 60 * 1000;

interface SyncIssue {
  label: string;
  detail: string;
  title?: string;
}

export function GranolaSyncControl({ compact }: { compact?: boolean }) {
  const { data, error: statusError, isLoading, mutate } = useGranolaSyncStatus();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const blocked = data ? !data.handoff.safeForProductionWrites : false;
  const syncIssue = data && !blocked ? granolaSyncIssue(data) : null;
  const hasError = Boolean(statusError || actionError);
  const hasWarning = blocked || Boolean(syncIssue);
  const statusText = statusError
    ? "Status unavailable"
    : actionError
      ? actionError
      : blocked
        ? "Blocked: Obsidian sync still on"
        : syncIssue
          ? `${syncIssue.label}: ${syncIssue.detail}`
        : data?.lastRun?.finishedAt
          ? `Synced ${formatAge(data.lastRun.finishedAt)}`
          : "Ready";
  const title = syncIssue?.title;

  async function runSync() {
    setPending(true);
    setActionError(null);
    try {
      await runGranolaSync("incremental", { dryRun: false });
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Granola sync failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={`px-1 ${compact ? "py-0.5" : "py-1"}`}
      title={title}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-tertiary)]">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : hasWarning || hasError ? (
            <AlertTriangle className={`h-3.5 w-3.5 ${hasError ? "text-red-500" : "text-amber-500"}`} />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[11px] font-medium ${hasError ? "text-red-500" : hasWarning ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-tertiary)]"}`}>
            {statusText}
          </div>
        </div>
        <button
          type="button"
          className="calendar-icon-button h-7 w-7 flex-shrink-0"
          title="Sync Granola"
          disabled={pending || blocked}
          onClick={() => void runSync()}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function granolaSyncIssue(data: GranolaSyncStatus): SyncIssue | null {
  if (!data.daemonConfigured && !data.daemonHeartbeat.active) {
    return {
      label: "Daemon off",
      detail: "Background sync disabled",
      title: "HILT_GRANOLA_SYNC_DAEMON is not enabled for this Hilt process.",
    };
  }
  if (data.lastRun && data.lastRun.status !== "ok") {
    return {
      label: "Sync failed",
      detail: data.lastRun.error || data.lastRun.status,
    };
  }
  if (data.daemonConfigured && data.daemonHeartbeat.error) {
    return {
      label: "Daemon stale",
      detail: data.daemonHeartbeat.error,
      title: daemonHeartbeatTitle(data),
    };
  }
  if (data.daemonConfigured && data.daemonHeartbeat.stale) {
    return {
      label: "Daemon stale",
      detail: data.daemonHeartbeat.updatedAt ? `Heartbeat ${formatAge(data.daemonHeartbeat.updatedAt)}` : "No daemon heartbeat",
      title: daemonHeartbeatTitle(data),
    };
  }
  if (data.daemonEnabled && data.lastRun?.finishedAt && isOlderThan(data.lastRun.finishedAt, STALE_SYNC_MS)) {
    return {
      label: "Sync stale",
      detail: `Last sync ${formatAge(data.lastRun.finishedAt)}`,
    };
  }
  return null;
}

function daemonHeartbeatTitle(data: GranolaSyncStatus): string {
  const updated = data.daemonHeartbeat.updatedAt ? `updated ${formatAge(data.daemonHeartbeat.updatedAt)}` : "no heartbeat file";
  const pid = data.daemonHeartbeat.pid ? `pid ${data.daemonHeartbeat.pid}` : "no pid";
  return `Granola daemon heartbeat is stale (${updated}, ${pid}).`;
}

function isOlderThan(value: string, ms: number): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Date.now() - parsed > ms;
}

function formatAge(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
