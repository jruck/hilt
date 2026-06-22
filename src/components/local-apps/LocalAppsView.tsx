"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertCircle,
  Database,
  Loader2,
  Monitor,
  RefreshCw,
  Server,
  ShieldOff,
} from "lucide-react";
import { openExternal } from "@/lib/openExternal";
import { SECONDARY_CHROME_BODY_GUTTER_CLASS, SecondaryIconButton, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import { preserveLocalAppsPreviews } from "@/lib/local-apps/preview-merge";
import type { LocalAppsMachineSnapshot, LocalAppsResponse, Service, ServiceGroup } from "@/lib/local-apps/types";
import { withBasePath } from "@/lib/base-path";

interface LocalAppsViewProps {
  searchQuery?: string;
  modeSwitcher?: ReactNode;
}

const METADATA_POLL_INTERVAL_MS = 5_000;
const PREVIEW_REFRESH_INTERVAL_MS = 2 * 60_000;
const TOP_OVERLAY_MATERIAL_STYLE = {
  backdropFilter: "blur(18px) saturate(1.18)",
  WebkitBackdropFilter: "blur(18px) saturate(1.18)",
} satisfies CSSProperties;
const BOTTOM_OVERLAY_MATERIAL_STYLE = {
  backdropFilter: "blur(13px) saturate(1.5)",
  WebkitBackdropFilter: "blur(13px) saturate(1.5)",
} satisfies CSSProperties;

let cachedLocalAppsSnapshot: LocalAppsResponse | null = null;

interface AppTile {
  machine: LocalAppsMachineSnapshot;
  group: ServiceGroup;
}

export function LocalAppsView({ searchQuery = "", modeSwitcher }: LocalAppsViewProps) {
  const [snapshot, setSnapshot] = useState<LocalAppsResponse | null>(() => cachedLocalAppsSnapshot);
  const [loading, setLoading] = useState(() => !cachedLocalAppsSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const lastPreviewRefreshAt = useRef(0);

  const applySnapshot = useCallback((data: LocalAppsResponse) => {
    setSnapshot((previous) => {
      const merged = preserveLocalAppsPreviews(data, previous || cachedLocalAppsSnapshot);
      cachedLocalAppsSnapshot = merged;
      return merged;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(withBasePath("/api/local-apps"), { cache: "no-store" });
      const data = await res.json();
      applySnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load local apps");
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  const refresh = useCallback(async (options: { force?: boolean } = {}) => {
    if (!options.force && Date.now() - lastPreviewRefreshAt.current < PREVIEW_REFRESH_INTERVAL_MS) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      setRefreshing(true);
      setError(null);
      const res = await fetch(withBasePath("/api/local-apps/refresh"), { method: "POST", cache: "no-store" });
      const data = await res.json();
      applySnapshot(data);
      lastPreviewRefreshAt.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh local apps");
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  }, [applySnapshot]);

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
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        {modeSwitcher ? <SecondaryToolbar left={modeSwitcher} /> : null}
        <LoadingState label="Scanning local apps" />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        {modeSwitcher ? <SecondaryToolbar left={modeSwitcher} /> : null}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot?.enabled) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        {modeSwitcher ? <SecondaryToolbar left={modeSwitcher} /> : null}
        <div className="flex flex-1 items-center justify-center p-6">
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
      </div>
    );
  }

  const diagnostics = snapshot.diagnostics;
  const serviceCount = apps.reduce((sum, app) => sum + app.group.services.filter((service) => service.visible).length, 0);
  const summary = (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
      <span>{machines.length} {machines.length === 1 ? "machine" : "machines"}</span>
      <span>{apps.length} apps</span>
      <span>{serviceCount} services</span>
      {diagnostics.scanned_at ? <span>{relativeTime(diagnostics.scanned_at)}</span> : null}
      {snapshot.machine.tailscale_ip4 ? <span>{snapshot.machine.tailscale_ip4}</span> : null}
    </div>
  );

  return (
    <div className="flex-1 overflow-hidden bg-[var(--bg-primary)]">
      <div className="flex h-full flex-col">
        <SecondaryToolbar
          left={
            modeSwitcher ? (
              modeSwitcher
            ) : (
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                  <Server className="h-4 w-4 text-[var(--text-secondary)]" />
                  <span className="truncate">Local Apps</span>
                  {diagnostics.is_scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
                </div>
                <div className="mt-0.5">
                  {summary}
                </div>
              </div>
            )
          }
          right={
            <>
              {modeSwitcher ? <div className="hidden min-w-0 md:block">
                {summary}
              </div> : null}
              {diagnostics.is_scanning ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-tertiary)]" /> : null}
              <SecondaryIconButton
                onClick={() => void refresh({ force: true })}
                disabled={refreshing}
                title="Refresh local apps and screenshots"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </SecondaryIconButton>
            </>
          }
        />

        {diagnostics.errors.filter((message) => !isPreviewCaptureError(message)).length > 0 ? (
          <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
            {diagnostics.errors.filter((message) => !isPreviewCaptureError(message)).join(" · ")}
          </div>
        ) : null}

        {error ? (
          <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        <div data-mobile-scroll-chrome="bottom" className={`hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 flex-1 overflow-auto px-4 pb-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
          {machines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
              No matching local apps
            </div>
          ) : (
            <div className="space-y-6 pb-2">
              {machines.map((machine) => (
                <section key={machine.id} className="pb-2">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{machineTitle(machine)}</h2>
                      <p className="truncate text-xs text-[var(--text-tertiary)]">
                        {machine.groups.length} apps · {machineServiceCount(machine)} services
                        {machine.machine.tailscale_ip4 ? ` · ${machine.machine.tailscale_ip4}` : ""}
                      </p>
                      {machineStatusMessage(machine) ? (
                        <p className="mt-1 truncate text-xs text-red-500">
                          {machineStatusMessage(machine)}
                        </p>
                      ) : null}
                    </div>
                    {machine.diagnostics.is_scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
                  </div>
                  {machine.groups.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-xs text-[var(--text-tertiary)]">
                      {machine.diagnostics.is_scanning ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Scanning…
                        </>
                      ) : (
                        "No visible apps found"
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 pb-2 md:grid-cols-3 2xl:grid-cols-4">
                      {machine.groups.map((group) => (
                        <AppCard key={`${machine.id}:${group.id}`} app={{ machine, group }} />
                      ))}
                    </div>
                  )}
                </section>
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
  const previewService = group.services.find((service) => service.preview?.path)
    || group.services.find((service) => service.visible && service.health.status === "up" && bestServiceUrl(service))
    || group.services[0];
  const previewUrl = previewService ? previewUrlForService(previewService, machine) : null;
  const fallback = previewFallback(group);
  const evidence = groupEvidence(group);
  const pathLabel = displayPath(group.path);
  const previewStatus = previewStatusLabel(previewService);

  return (
    <article className="hilt-card hilt-card-elevated group overflow-visible">
      <button
        className="relative block aspect-[16/9] w-full overflow-hidden rounded-[calc(0.5rem-1px)] bg-[var(--content-surface)] text-left"
        onClick={() => group.primary_url && openExternal(group.primary_url)}
        disabled={!group.primary_url}
        title={group.primary_url || "No URL available"}
      >
        {previewUrl ? (
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-full w-full object-cover object-top" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--content-surface)] px-4 text-xs text-[var(--text-secondary)]">
            {fallback.icon}
            <div className="ml-2 hidden min-w-0 text-left sm:block">
              <div className="truncate">{fallback.label}</div>
              {evidence.length > 0 ? (
                <div className="mt-1 max-w-full truncate text-[11px] text-[var(--text-tertiary)]">
                  {evidence.slice(0, 3).join(" · ")}
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="local-apps-overlay-top absolute inset-x-0 top-0 p-2 sm:p-3">
          <div className="local-apps-overlay-material" style={TOP_OVERLAY_MATERIAL_STYLE} aria-hidden="true" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="local-apps-overlay-title truncate text-xs font-semibold sm:text-sm">{group.title}</h2>
              <p className="local-apps-overlay-path mt-0.5 hidden truncate text-[11px] sm:block">{pathLabel}</p>
            </div>
          </div>
        </div>

        <div className="local-apps-overlay-bottom absolute inset-x-0 bottom-0 p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 sm:p-3">
          <div className="local-apps-overlay-material" style={BOTTOM_OVERLAY_MATERIAL_STYLE} aria-hidden="true" />
          <div className="flex min-w-0 items-end justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5">
                {group.services.map((service) => (
                  <ServiceChip key={service.id} service={service} />
                ))}
                {evidence.slice(0, 2).map((item) => (
                  <EvidenceChip key={item} label={item} />
                ))}
              </div>
            </div>
            <div
              className="local-apps-overlay-status shrink-0 max-w-[45%] truncate text-right text-[10px] font-medium"
              title={previewService?.preview?.error || undefined}
            >
              {previewStatus || `${group.services.filter((service) => service.visible).length}/${group.services.length} visible`}
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
      ...groupEvidence(group),
      ...group.ports.map((port) => String(port)),
      ...group.services.flatMap((service) => [service.title, service.listener.command, service.process.cwd, service.process.args]),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function machineServiceCount(machine: LocalAppsMachineSnapshot): number {
  return machine.groups.reduce((sum, group) => sum + group.services.filter((service) => service.visible).length, 0);
}

// Screenshot/preview-capture failures (e.g. a missing Playwright browser binary)
// are not machine-health problems — they surface per-card via previewFallback.
// Keep them out of the red machine-level banner so a broken thumbnail never reads
// as "this machine is down". Reachability/transport errors (machine.error) still show.
function isPreviewCaptureError(message: string): boolean {
  return /browsertype\.launch|chrome-headless|playwright|executable doesn't exist|page\.(goto|screenshot)|screenshot/i.test(message);
}

function machineStatusMessage(machine: LocalAppsMachineSnapshot): string | null {
  if (machine.error) return machine.error;
  return machine.diagnostics.errors.find((message) => !isPreviewCaptureError(message)) || null;
}

function machineTitle(machine: LocalAppsMachineSnapshot): string {
  return machine.self ? `${machineShortLabel(machine)} · this machine` : machineShortLabel(machine);
}

function previewUrlForService(service: Service, machine: LocalAppsMachineSnapshot): string | null {
  if (!service.preview?.path) return null;
  const filename = service.preview.path.split("/").pop() || "";
  if (!filename) return null;
  const route = withBasePath(`/api/local-apps/previews/${encodeURIComponent(filename)}`);
  if (!machine.source_url) return route;
  return withBasePath(`/api/local-apps/remote-preview?machine=${encodeURIComponent(machine.id)}&filename=${encodeURIComponent(filename)}`);
}

function ServiceChip({ service }: { service: Service }) {
  return (
    <span className="local-apps-service-chip inline-flex items-center rounded-md border px-1 py-0.5 text-[10px] shadow-sm backdrop-blur backdrop-saturate-150 sm:px-1.5 sm:text-[11px]" title={service.health.label}>
      :{service.listener.port}<span className="ml-1 hidden sm:inline">{serviceRole(service)}</span>
    </span>
  );
}

function EvidenceChip({ label }: { label: string }) {
  return (
    <span className="local-apps-evidence-chip hidden items-center rounded-md border px-1.5 py-0.5 text-[11px] shadow-sm backdrop-blur backdrop-saturate-150 sm:inline-flex">
      {label}
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
  const previewError = group.services.find((service) => service.preview?.error && !service.preview.path)?.preview?.error;
  if (previewError) return { label: previewError, icon: <AlertCircle className="h-4 w-4" /> };
  const down = group.services.find((service) => service.health.status === "down");
  if (down) return { label: down.health.label, icon: <AlertCircle className="h-4 w-4" /> };
  return { label: "Preview disabled", icon: <Monitor className="h-4 w-4" /> };
}

function previewStatusLabel(service?: Service): string | null {
  const preview = service?.preview;
  if (!preview) return null;
  const age = relativeTime(preview.captured_at);
  if (preview.path && preview.error) return `refresh failed · ${age}`;
  if (preview.path) return age;
  return preview.error || null;
}

function bestServiceUrl(service: Service): string | null {
  return service.preview_url || service.health.url || service.url_candidates[0] || null;
}

function groupEvidence(group: ServiceGroup): string[] {
  const services = group.services;
  if (services.length === 0) return [];

  const items: string[] = [];
  const allText = services.map(serviceText).join("\n").toLowerCase();
  const product = infrastructureProductLabel(group, allText);

  if (isHomebrewGroup(group)) {
    items.push(`Homebrew ${product}`);
  }

  const role = infrastructureRole(group, allText);
  if (role) items.push(role);

  if (services.every((service) => isLoopbackListenerHost(service.listener.host))) {
    items.push("loopback only");
  }

  const dataDir = services.map((service) => extractArgValue(service.process.args, "--datadir")).find(Boolean);
  if (dataDir) items.push(`data ${displayPath(dataDir)}`);

  return [...new Set(items)].slice(0, 4);
}

function serviceText(service: Service): string {
  return [
    service.listener.command,
    service.process.cwd,
    service.process.executable,
    service.process.args,
    service.title,
  ].filter(Boolean).join(" ");
}

function isHomebrewGroup(group: ServiceGroup): boolean {
  if (isHomebrewPath(group.path) || isHomebrewPath(group.git_root)) return true;
  if (group.git_root || group.package_name) return false;
  return group.services.some((service) => (
    isHomebrewPath(service.process.cwd)
    || isHomebrewPath(service.process.executable)
    || service.process.args.includes("/opt/homebrew/")
    || service.process.args.includes("/usr/local/Homebrew/")
    || service.process.args.includes("/usr/local/Cellar/")
  ));
}

function isHomebrewPath(pathValue?: string | null): boolean {
  if (!pathValue) return false;
  return pathValue.startsWith("/opt/homebrew")
    || pathValue.startsWith("/usr/local/Homebrew")
    || pathValue.startsWith("/usr/local/Cellar")
    || pathValue.startsWith("/usr/local/opt")
    || pathValue.startsWith("/usr/local/var");
}

function infrastructureProductLabel(group: ServiceGroup, text: string): string {
  if (text.includes("mysqld") || text.includes("/mysql")) return "MySQL";
  if (text.includes("ollama")) return "Ollama";
  if (text.includes("nginx")) return "nginx";
  if (text.includes("redis-server") || text.includes("/redis")) return "Redis";
  if (text.includes("postgres") || text.includes("/postgresql")) return "Postgres";
  return group.title;
}

function infrastructureRole(group: ServiceGroup, text: string): string | null {
  if (text.includes("ollama")) return "local LLM runner";
  if (text.includes("mysqld") || group.services.every((service) => service.kind === "database")) return "database server";
  if (text.includes("nginx")) return "local web server";
  if (group.services.every((service) => service.kind === "queue")) return "queue service";
  if (group.services.every((service) => service.kind === "infra")) return "local infrastructure";
  return null;
}

function isLoopbackListenerHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
}

function extractArgValue(args: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = args.match(new RegExp(`${escaped}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(\\S+))`));
  return match?.[1] || match?.[2] || match?.[3] || null;
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
