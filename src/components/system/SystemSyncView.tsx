"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileWarning, FolderSync, HardDrive, Loader2, RefreshCw, ServerOff } from "lucide-react";
import { SecondaryIconButton, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import type { SystemSyncDiskSummary, SystemSyncMachineResult, SystemSyncMachineSnapshot, SystemSyncResponse } from "@/lib/system/sync";

interface SystemSyncViewProps {
  modeSwitcher: ReactNode;
}

let cachedSystemSyncSnapshot: SystemSyncResponse | null = null;

export function SystemSyncView({ modeSwitcher }: SystemSyncViewProps) {
  const [snapshot, setSnapshot] = useState<SystemSyncResponse | null>(() => cachedSystemSyncSnapshot);
  const [loading, setLoading] = useState(() => !cachedSystemSyncSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastForcedRefreshAt, setLastForcedRefreshAt] = useState<string | null>(null);

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    try {
      if (options.force) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (options.force) params.set("force", "true");
      const response = await fetch(`/api/system/sync${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      cachedSystemSyncSnapshot = data as SystemSyncResponse;
      setSnapshot(cachedSystemSyncSnapshot);
      if (options.force) setLastForcedRefreshAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const loadIfVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    const interval = window.setInterval(loadIfVisible, 15_000);
    document.addEventListener("visibilitychange", loadIfVisible);
    window.addEventListener("focus", loadIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", loadIfVisible);
      window.removeEventListener("focus", loadIfVisible);
    };
  }, [load]);

  const summary = useMemo(() => {
    if (!snapshot) return null;
    return (
      <div className="hidden min-w-0 items-center justify-end gap-3 text-xs text-[var(--text-tertiary)] md:flex">
        <span>{snapshot.summary.machine_count} {snapshot.summary.machine_count === 1 ? "machine" : "machines"}</span>
        <span>{snapshot.summary.needed_files} needed</span>
        <span>{snapshot.summary.pull_errors} errors</span>
        <span>{snapshot.summary.conflict_count} conflicts</span>
        {lastForcedRefreshAt ? <span>refreshed {relativeTime(lastForcedRefreshAt)}</span> : null}
      </div>
    );
  }, [lastForcedRefreshAt, snapshot]);

  if (loading && !snapshot) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <SyncToolbar modeSwitcher={modeSwitcher} summary={summary} loading={loading} refreshing={refreshing} onRefresh={() => void load({ force: true })} />
        <LoadingState label="Loading sync status" />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <SyncToolbar modeSwitcher={modeSwitcher} summary={summary} loading={loading} refreshing={refreshing} onRefresh={() => void load({ force: true })} />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        </div>
      </div>
    );
  }

  const machines = snapshot?.machines || [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <SyncToolbar modeSwitcher={modeSwitcher} summary={summary} loading={loading} refreshing={refreshing} onRefresh={() => void load({ force: true })} />
      {error ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {error}
        </div>
      ) : null}
      <div data-mobile-scroll-chrome="bottom" className="hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 flex-1 overflow-auto px-4 pt-[13px]">
        {machines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
            No sync machines
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {machines.map((machine) => (
              <SyncMachineCard key={machine.machine.id} result={machine} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SyncToolbar({
  modeSwitcher,
  summary,
  loading,
  refreshing,
  onRefresh,
}: {
  modeSwitcher: ReactNode;
  summary: ReactNode;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <SecondaryToolbar
      left={modeSwitcher}
      right={
        <>
          {summary}
          {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-tertiary)]" /> : null}
          <SecondaryIconButton
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh sync status"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </SecondaryIconButton>
        </>
      }
    />
  );
}

function SyncMachineCard({ result }: { result: SystemSyncMachineResult }) {
  const title = machineTitle(result);
  if (!result.enabled) {
    return (
      <div className="hilt-card hilt-card-elevated p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
            <div className="mt-1 text-xs text-[var(--text-tertiary)]">{result.refreshedAt ? relativeTime(result.refreshedAt) : "not refreshed"}</div>
          </div>
          <StateBadge tone="neutral" label="disabled" />
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
          <ServerOff className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          <span>{result.reason}</span>
        </div>
      </div>
    );
  }

  const health = syncHealth(result);
  const folder = result.folder;

  return (
    <div className="hilt-card hilt-card-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          <div className="mt-1 truncate text-xs text-[var(--text-tertiary)]">
            {result.daemon.version || "Syncthing"} · {relativeTime(result.refreshedAt)}
          </div>
        </div>
        <StateBadge tone={health.tone} label={health.label} />
      </div>

      {result.error ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.error}</span>
        </div>
      ) : null}

      {folder ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="in sync" value={String(folder.inSyncFiles)} detail={formatBytes(folder.inSyncBytes)} />
            <Metric label="needed" value={String(folder.needFiles)} detail={formatBytes(folder.needBytes)} tone={folder.needFiles > 0 ? "amber" : undefined} />
            <Metric label="conflicts" value={String(folder.conflicts.count)} detail={folder.conflicts.truncated ? "truncated" : "visible"} tone={folder.conflicts.count > 0 ? "amber" : undefined} />
            <Metric
              label="ignored"
              value={formatBytes(folder.disk.ignoredBytes ?? 0)}
              detail={`${folder.disk.ignoredPathCount} paths`}
              tone={(folder.disk.ignoredBytes ?? 0) > 0 ? "amber" : undefined}
            />
          </div>

          <div className="mt-4 space-y-2 text-xs">
            <InfoRow icon={<FolderSync className="h-3.5 w-3.5" />} label={folder.id} value={`${folder.type} · ${folder.state}${folder.paused ? " · paused" : ""}`} />
            <InfoRow icon={<RefreshCw className="h-3.5 w-3.5" />} label="refreshed" value={relativeTime(result.refreshedAt)} />
            <InfoRow icon={<Clock3 className="h-3.5 w-3.5" />} label="state changed" value={folder.stateChanged ? relativeTime(folder.stateChanged) : "unknown"} />
            <InfoRow icon={<Clock3 className="h-3.5 w-3.5" />} label="last scan" value={folder.lastScan ? relativeTime(folder.lastScan) : "unknown"} />
            {folder.lastFile?.filename ? (
              <InfoRow
                icon={<FileWarning className="h-3.5 w-3.5" />}
                label="last file"
                value={`${folder.lastFile.deleted ? "deleted " : ""}${folder.lastFile.filename}`}
              />
            ) : null}
            <InfoRow icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="versioning" value={folder.versioning.enabled ? `${folder.versioning.type || "enabled"} · ${folder.versioning.maxAgeDays ?? "?"}d` : "off"} />
            <InfoRow icon={<FileWarning className="h-3.5 w-3.5" />} label="ignore parity" value={folder.ignore.includePresent && folder.ignore.sharedHash ? "shared include present" : "missing shared include"} tone={folder.ignore.includePresent && folder.ignore.sharedHash ? undefined : "amber"} />
            <InfoRow icon={<HardDrive className="h-3.5 w-3.5" />} label="local disk" value={diskSummary(folder.disk)} tone={(folder.disk.ignoredBytes ?? 0) > folder.inSyncBytes ? "amber" : undefined} />
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {result.peers.length === 0 ? (
              <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">no peers</span>
            ) : result.peers.map((peer) => (
              <span
                key={peer.deviceId}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  peer.connected
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                }`}
                title={peer.address || peer.deviceId}
              >
                {peer.label} {peer.connected ? "connected" : "offline"}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "amber" }) {
  return (
    <div className={`rounded-md bg-[var(--bg-secondary)] px-2 py-2 ${tone === "amber" ? "ring-1 ring-amber-500/20" : ""}`}>
      <div className={`font-mono text-sm ${tone === "amber" ? "text-amber-600" : "text-[var(--text-primary)]"}`}>{value}</div>
      <div className="truncate text-[10px] text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">{detail}</div>
    </div>
  );
}

function InfoRow({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: "amber" }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)]">
      <span className={tone === "amber" ? "text-amber-600" : "text-[var(--text-tertiary)]"}>{icon}</span>
      <span className="shrink-0 text-[var(--text-tertiary)]">{label}</span>
      <span className={`min-w-0 truncate ${tone === "amber" ? "text-amber-600" : "text-[var(--text-secondary)]"}`}>{value}</span>
    </div>
  );
}

function StateBadge({ tone, label }: { tone: "green" | "amber" | "red" | "neutral"; label: string }) {
  const classes = {
    green: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-600",
    red: "bg-red-500/10 text-red-600",
    neutral: "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
  }[tone];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${classes}`}>{label}</span>;
}

function syncHealth(snapshot: SystemSyncMachineSnapshot): { tone: "green" | "amber" | "red"; label: string } {
  if (!snapshot.daemon.reachable || snapshot.error) return { tone: "red", label: "unreachable" };
  if (!snapshot.folder) return { tone: "red", label: "missing folder" };
  if (snapshot.folder.pullErrors > 0) return { tone: "red", label: "pull errors" };
  if (snapshot.folder.conflicts.count > 0) return { tone: "amber", label: "conflicts" };
  if (snapshot.folder.needFiles > 0 || snapshot.folder.needDeletes > 0) return { tone: "amber", label: "syncing" };
  if (snapshot.peers.some((peer) => !peer.connected)) return { tone: "amber", label: "peer offline" };
  return { tone: "green", label: "in sync" };
}

function machineTitle(result: SystemSyncMachineResult): string {
  const label = result.machine.machine.tailscale_dns || result.machine.machine.hostname || result.machine.id;
  const short = label.replace(/\.$/, "").split(".")[0].replace(/-v$/i, "");
  return result.machine.self ? `${short} · this machine` : short;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next >= 10 || unit === 0 ? Math.round(next) : next.toFixed(1)} ${units[unit]}`;
}

function diskSummary(disk: SystemSyncDiskSummary): string {
  const total = disk.totalBytes === null ? "unknown" : formatBytes(disk.totalBytes);
  const ignored = disk.ignoredBytes === null ? "unknown ignored" : `${formatBytes(disk.ignoredBytes)} ignored`;
  return `${total} total · ${ignored}`;
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unknown";
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) return `${Math.round(diff / minute)}m ago`;
  if (abs < day) return `${Math.round(diff / hour)}h ago`;
  return `${Math.round(diff / day)}d ago`;
}
