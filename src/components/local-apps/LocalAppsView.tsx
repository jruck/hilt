"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Database,
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Server,
  ShieldOff,
} from "lucide-react";
import { openExternal } from "@/lib/openExternal";
import type { LocalAppsMachineSnapshot, LocalAppsResponse, Service, ServiceGroup } from "@/lib/local-apps/types";

interface LocalAppsViewProps {
  searchQuery?: string;
}

const METADATA_POLL_INTERVAL_MS = 5_000;
const PREVIEW_REFRESH_INTERVAL_MS = 2 * 60_000;

interface AppTile {
  machine: LocalAppsMachineSnapshot;
  group: ServiceGroup;
}

export function LocalAppsView({ searchQuery = "" }: LocalAppsViewProps) {
  const [snapshot, setSnapshot] = useState<LocalAppsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const lastPreviewRefreshAt = useRef(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/local-apps", { cache: "no-store" });
      const data = await res.json();
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load local apps");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async (options: { force?: boolean } = {}) => {
    if (!options.force && Date.now() - lastPreviewRefreshAt.current < PREVIEW_REFRESH_INTERVAL_MS) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      setRefreshing(true);
      setError(null);
      const res = await fetch("/api/local-apps/refresh", { method: "POST", cache: "no-store" });
      const data = await res.json();
      setSnapshot(data);
      lastPreviewRefreshAt.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh local apps");
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const isVisible = () => document.visibilityState === "visible";
    const loadIfVisible = () => {
      if (isVisible()) void load();
    };
    const refreshIfVisible = () => {
      if (isVisible()) void refresh();
    };

    if (isVisible()) {
      void refresh();
    } else {
      void load();
    }

    const metadataInterval = window.setInterval(loadIfVisible, METADATA_POLL_INTERVAL_MS);
    const previewInterval = window.setInterval(refreshIfVisible, PREVIEW_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);

    return () => {
      window.clearInterval(metadataInterval);
      window.clearInterval(previewInterval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, [load, refresh]);

  const query = searchQuery.trim().toLowerCase();
  const machines = useMemo(() => {
    if (!snapshot?.enabled) return [];
    return machinesForSnapshot(snapshot).map((machine) => ({
      ...machine,
      groups: filterGroups(machine.groups, machine, query),
    })).filter((machine) => !query || machine.groups.length > 0);
  }, [snapshot, query]);

  const apps = useMemo(() => {
    return machines.flatMap((machine) => machine.groups.map((group) => ({ machine, group })));
  }, [machines]);

  if (loading && !snapshot) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Scanning local apps
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!snapshot?.enabled) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <ShieldOff className="h-4 w-4" />
            Local Apps disabled
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {snapshot?.reason || "Set HILT_LOCAL_APPS_ENABLED=true to inspect this machine's local services."}
          </p>
        </div>
      </div>
    );
  }

  const diagnostics = snapshot.diagnostics;
  const serviceCount = apps.reduce((sum, app) => sum + app.group.services.filter((service) => service.visible).length, 0);

  return (
    <div className="flex-1 overflow-hidden bg-[var(--bg-primary)]">
      <div className="flex h-full flex-col">
        <div className="flex min-h-12 items-center justify-between border-b border-[var(--border-default)] px-4 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <Server className="h-4 w-4 text-[var(--text-secondary)]" />
              <span className="truncate">Local Apps</span>
              {diagnostics.is_scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
              <span>{machines.length} {machines.length === 1 ? "machine" : "machines"}</span>
              <span>{apps.length} apps</span>
              <span>{serviceCount} services</span>
              {diagnostics.scanned_at ? <span>{relativeTime(diagnostics.scanned_at)}</span> : null}
              {snapshot.machine.tailscale_ip4 ? <span>{snapshot.machine.tailscale_ip4}</span> : null}
            </div>
          </div>
          <button
            onClick={() => void refresh({ force: true })}
            disabled={refreshing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Refresh local apps and screenshots"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {diagnostics.errors.length > 0 ? (
          <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
            {diagnostics.errors.join(" · ")}
          </div>
        ) : null}

        <div className="flex-1 overflow-auto p-4">
          {apps.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
              No matching local apps
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {apps.map((app) => (
                <AppCard key={`${app.machine.id}:${app.group.id}`} app={app} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppCard({ app }: { app: AppTile }) {
  const { group, machine } = app;
  const previewService = group.services.find((service) => service.preview?.path && !service.preview.error)
    || group.services.find((service) => service.visible && service.health.status === "up" && bestServiceUrl(service))
    || group.services[0];
  const previewUrl = previewService ? previewUrlForService(previewService, machine) : null;
  const fallback = previewFallback(group);
  const pathLabel = displayPath(group.path);
  const freshness = previewService?.preview?.captured_at
    ? relativeTime(previewService.preview.captured_at)
    : null;

  return (
    <article className="group overflow-hidden rounded-2xl bg-[var(--bg-secondary)] shadow-[0_22px_55px_rgba(15,23,42,0.24)]">
      <button
        className="relative block aspect-[16/9] w-full overflow-hidden bg-zinc-950 text-left"
        onClick={() => group.primary_url && openExternal(group.primary_url)}
        disabled={!group.primary_url}
        title={group.primary_url || "No URL available"}
      >
        {previewUrl ? (
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(63,63,70,0.35),rgba(9,9,11,0.98))] px-4 text-xs text-zinc-300">
            {fallback.icon}
            <span className="ml-2">{fallback.label}</span>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 via-black/45 to-transparent p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-white drop-shadow">{group.title}</h2>
              <p className="mt-0.5 truncate text-[11px] text-zinc-200/85 drop-shadow">{pathLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="max-w-28 truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100 ring-1 ring-white/10">
                {machineShortLabel(machine)}
              </span>
              {group.primary_url ? (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-zinc-100 ring-1 ring-white/10 transition-colors group-hover:bg-black/70">
                  <ExternalLink className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-3">
          <div className="flex min-w-0 items-end justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5">
                {group.services.map((service) => (
                  <ServiceChip key={service.id} service={service} />
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right text-[10px] font-medium text-zinc-200/90">
              {freshness || `${group.services.filter((service) => service.visible).length}/${group.services.length} visible`}
            </div>
          </div>
        </div>
      </button>
    </article>
  );
}

function machinesForSnapshot(snapshot: Extract<LocalAppsResponse, { enabled: true }>): LocalAppsMachineSnapshot[] {
  return snapshot.machines?.length
    ? snapshot.machines
    : [{
        id: snapshot.machine.tailscale_dns || snapshot.machine.tailscale_ip4 || snapshot.machine.hostname,
        self: true,
        reachable: true,
        source_url: null,
        machine: snapshot.machine,
        groups: snapshot.groups,
        diagnostics: snapshot.diagnostics,
        error: null,
      }];
}

function filterGroups(
  groups: ServiceGroup[],
  machine: LocalAppsMachineSnapshot,
  query: string,
): ServiceGroup[] {
  if (!query) return groups;
  return groups.filter((group) => {
    const haystack = [
      machine.machine.hostname,
      machine.machine.tailscale_dns,
      machine.machine.tailscale_ip4,
      group.title,
      group.path,
      group.branch,
      group.package_name,
      group.description,
      ...group.ports.map((port) => String(port)),
      ...group.services.flatMap((service) => [service.title, service.listener.command, service.process.cwd, service.process.args]),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function previewUrlForService(service: Service, machine: LocalAppsMachineSnapshot): string | null {
  if (!service.preview?.path || service.preview.error) return null;
  const filename = service.preview.path.split("/").pop() || "";
  if (!filename) return null;
  const route = `/api/local-apps/previews/${encodeURIComponent(filename)}`;
  if (!machine.source_url) return route;
  return `/api/local-apps/remote-preview?machine=${encodeURIComponent(machine.id)}&filename=${encodeURIComponent(filename)}`;
}

function ServiceChip({ service }: { service: Service }) {
  const healthClass = service.health.status === "up"
    ? "border-emerald-300/25 bg-emerald-500/20 text-emerald-100"
    : service.health.status === "down"
      ? "border-red-300/25 bg-red-500/20 text-red-100"
      : "border-white/15 bg-black/35 text-zinc-200";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] shadow-sm backdrop-blur ${healthClass}`} title={service.health.label}>
      :{service.listener.port} {serviceRole(service)}
    </span>
  );
}

function machineShortLabel(machine: LocalAppsMachineSnapshot): string {
  const label = machine.machine.tailscale_dns || machine.machine.hostname || machine.id;
  return label.replace(/\.$/, "").split(".")[0].replace(/-v$/i, "");
}

function serviceRole(service: Service): string {
  const args = `${service.listener.command} ${service.process.args}`.toLowerCase();
  if (service.kind === "fullstack") return "web app";
  if (service.kind === "frontend" && service.health.http_status !== 404) return "web";
  if (args.includes("ws-server") || args.includes("websocket") || args.includes("/events")) return "websocket";
  if (service.kind === "backend") return "backend";
  if (service.kind === "infra") return "infra";
  if (service.kind === "database") return "database";
  if (service.kind === "queue") return "queue";
  return service.kind.replace("_", " ");
}

function previewFallback(group: ServiceGroup): { label: string; icon: ReactNode } {
  if (group.services.every((service) => ["backend", "database", "infra", "queue", "unknown"].includes(service.kind))) {
    return { label: "No web UI", icon: <Database className="h-4 w-4" /> };
  }
  const previewError = group.services.find((service) => service.preview?.error)?.preview?.error;
  if (previewError) return { label: previewError, icon: <AlertCircle className="h-4 w-4" /> };
  const down = group.services.find((service) => service.health.status === "down");
  if (down) return { label: down.health.label, icon: <AlertCircle className="h-4 w-4" /> };
  return { label: "Preview disabled", icon: <Monitor className="h-4 w-4" /> };
}

function bestServiceUrl(service: Service): string | null {
  return service.preview_url || service.health.url || service.url_candidates[0] || null;
}

function displayPath(pathValue?: string | null): string {
  if (!pathValue) return "process group";
  return pathValue.replace(/^\/Users\/[^/]+/, "~");
}

function relativeTime(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return "";
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}
