"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

export function LocalAppsView({ searchQuery = "" }: LocalAppsViewProps) {
  const [snapshot, setSnapshot] = useState<LocalAppsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const refresh = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const res = await fetch("/api/local-apps/refresh", { method: "POST", cache: "no-store" });
      const data = await res.json();
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh local apps");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  const query = searchQuery.trim().toLowerCase();
  const machines = useMemo(() => {
    if (!snapshot?.enabled) return [];
    return machinesForSnapshot(snapshot).map((machine) => ({
      ...machine,
      groups: filterGroups(machine.groups, machine, query),
    })).filter((machine) => !query || machine.groups.length > 0);
  }, [snapshot, query]);

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
  const appCount = machines.reduce((sum, machine) => sum + machine.groups.length, 0);
  const serviceCount = machines.reduce((sum, machine) => sum + machineServiceCount(machine), 0);

  return (
    <div className="flex-1 overflow-hidden bg-[var(--bg-primary)]">
      <div className="flex h-full flex-col">
        <div className="flex min-h-12 items-center justify-between border-b border-[var(--border-default)] px-4 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <Server className="h-4 w-4 text-[var(--text-secondary)]" />
              <span className="truncate">{snapshot.machine.tailscale_dns || snapshot.machine.hostname}</span>
              {diagnostics.is_scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
              <span>{machines.length} {machines.length === 1 ? "machine" : "machines"}</span>
              <span>{appCount} apps</span>
              <span>{serviceCount} services</span>
              {diagnostics.scanned_at ? <span>{relativeTime(diagnostics.scanned_at)}</span> : null}
              {snapshot.machine.tailscale_ip4 ? <span>{snapshot.machine.tailscale_ip4}</span> : null}
            </div>
          </div>
          <button
            onClick={() => void refresh()}
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
          {machines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
              No matching local apps
            </div>
          ) : (
            <div className="space-y-5">
              {machines.map((machine) => (
                <section key={machine.id}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{machineTitle(machine)}</h2>
                      <p className="truncate text-xs text-[var(--text-tertiary)]">
                        {machine.groups.length} apps · {machineServiceCount(machine)} services
                        {machine.machine.tailscale_ip4 ? ` · ${machine.machine.tailscale_ip4}` : ""}
                      </p>
                    </div>
                    {machine.diagnostics.is_scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {machine.groups.map((group) => (
                      <AppCard key={`${machine.id}:${group.id}`} group={group} machine={machine} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppCard({ group, machine }: { group: ServiceGroup; machine: LocalAppsMachineSnapshot }) {
  const previewService = group.services.find((service) => service.preview?.path && !service.preview.error)
    || group.services.find((service) => service.visible && service.health.status === "up" && bestServiceUrl(service))
    || group.services[0];
  const previewUrl = previewService ? previewUrlForService(previewService, machine) : null;
  const visibleServices = group.services.filter((service) => service.visible);
  const fallback = previewFallback(group);

  return (
    <article className="overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <button
        className="relative block aspect-[16/9] w-full bg-[var(--bg-tertiary)] text-left"
        onClick={() => group.primary_url && openExternal(group.primary_url)}
        disabled={!group.primary_url}
        title={group.primary_url || "No URL available"}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            {previewService?.preview?.captured_at ? (
              <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {relativeTime(previewService.preview.captured_at)}
              </span>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-xs text-[var(--text-tertiary)]">
            {fallback.icon}
            <span className="ml-2">{fallback.label}</span>
          </div>
        )}
      </button>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{group.title}</h2>
            <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{displayPath(group.path)}</p>
          </div>
          <button
            onClick={() => group.primary_url && openExternal(group.primary_url)}
            disabled={!group.primary_url}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title={group.primary_url || "No URL available"}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {group.services.map((service) => (
            <ServiceChip key={service.id} service={service} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-muted)] pt-2 text-xs text-[var(--text-tertiary)]">
          <span>{visibleServices.length}/{group.services.length} visible</span>
          <span>{group.branch && group.branch !== "HEAD" ? group.branch : group.ports.map((port) => `:${port}`).join(" ")}</span>
        </div>
      </div>
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

function machineServiceCount(machine: LocalAppsMachineSnapshot): number {
  return machine.groups.reduce((sum, group) => sum + group.services.filter((service) => service.visible).length, 0);
}

function machineTitle(machine: LocalAppsMachineSnapshot): string {
  const label = machine.machine.tailscale_dns || machine.machine.hostname;
  return machine.self ? `${label} · this machine` : label;
}

function previewUrlForService(service: Service, machine: LocalAppsMachineSnapshot): string | null {
  if (!service.preview?.path || service.preview.error) return null;
  const filename = service.preview.path.split("/").pop() || "";
  if (!filename) return null;
  const route = `/api/local-apps/previews/${encodeURIComponent(filename)}`;
  return machine.source_url ? `${machine.source_url}${route}` : route;
}

function ServiceChip({ service }: { service: Service }) {
  const healthClass = service.health.status === "up"
    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
    : service.health.status === "down"
      ? "border-red-500/20 bg-red-500/5 text-red-300"
      : "border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] ${healthClass}`} title={service.health.label}>
      :{service.listener.port} {serviceRole(service)}
    </span>
  );
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
