import { collectMacosServices } from "./adapters/macos";
import { classify, groupServices } from "./classifier";
import { localAppsEnabledResponseSchema } from "./contracts";
import { probeServices } from "./probe";
import { buildMachineSnapshots, summarizeMachines } from "./remotes";
import { redactSensitiveArgs } from "./redact";
import { isLocalAppsEnabled, loadSettings } from "./settings";
import { machineIdentityAsync } from "./tailnet";
import { attachCachedPreviews, capturePreviewsNow } from "./preview";
import type { LocalAppsDisabledResponse, LocalAppsEnabledResponse, ScanDiagnostics, ServiceGroup } from "./types";

let latest: LocalAppsEnabledResponse | null = null;
let inFlight: Promise<LocalAppsEnabledResponse> | null = null;
let inFlightWaitsForPreviews = false;

interface ScanOptions {
  forcePreviews?: boolean;
  waitForPreviews?: boolean;
}

export function disabledResponse(): LocalAppsDisabledResponse {
  return {
    app: "hilt-local-apps",
    enabled: false,
    reason: "HILT_LOCAL_APPS_ENABLED is not true",
  };
}

export async function getLocalAppsResponse(
  options: { includePeers?: boolean } = {},
): Promise<LocalAppsEnabledResponse | LocalAppsDisabledResponse> {
  if (!isLocalAppsEnabled()) return disabledResponse();

  const includePeers = options.includePeers ?? true;
  const settings = loadSettings();
  const stale = !latest || !latest.diagnostics.scanned_at ||
    Date.now() - Date.parse(latest.diagnostics.scanned_at) >= settings.scan_interval_ms;

  let snapshot: LocalAppsEnabledResponse;
  if (!latest) {
    snapshot = withScanningFlag(await ensureScan());
  } else {
    if (stale && !inFlight) {
      void ensureScan().catch((error) => {
        console.error("[local-apps/scanner] background scan failed:", error);
      });
    }
    snapshot = withScanningFlag(latest);
  }

  if (!includePeers) return snapshot;

  try {
    const machines = await buildMachineSnapshots(snapshot);
    return {
      ...snapshot,
      machines,
      summary: summarizeMachines(machines),
    };
  } catch (error) {
    return {
      ...snapshot,
      diagnostics: {
        ...snapshot.diagnostics,
        errors: [
          ...snapshot.diagnostics.errors,
          `tailnet peer discovery failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
    };
  }
}

export async function refreshLocalApps(
  options: ScanOptions & { includePeers?: boolean } = {},
): Promise<LocalAppsEnabledResponse | LocalAppsDisabledResponse> {
  if (!isLocalAppsEnabled()) return disabledResponse();
  const includePeers = options.includePeers ?? true;
  const snapshot = await ensureScan(options);
  if (!includePeers) return withScanningFlag(snapshot);
  const machines = await buildMachineSnapshots(snapshot, {
    refreshPeers: !!options.waitForPreviews && !!options.forcePreviews,
  });
  return {
    ...snapshot,
    machines,
    summary: summarizeMachines(machines),
  };
}

export async function ensureScan(options: ScanOptions = {}): Promise<LocalAppsEnabledResponse> {
  if (inFlight && options.waitForPreviews && !inFlightWaitsForPreviews) {
    await inFlight.catch(() => null);
  }

  if (!inFlight) {
    inFlightWaitsForPreviews = !!options.waitForPreviews;
    inFlight = scanLocalApps(options)
      .then((snapshot) => {
        latest = snapshot;
        return snapshot;
      })
      .finally(() => {
        inFlight = null;
        inFlightWaitsForPreviews = false;
      });
  }
  return inFlight;
}

export async function scanLocalApps(options: ScanOptions = {}): Promise<LocalAppsEnabledResponse> {
  const started = Date.now();
  const errors: string[] = [];
  const settings = loadSettings();
  let listenerCount = 0;
  let groups: ServiceGroup[] = [];

  try {
    const observed = process.platform === "darwin" ? await collectMacosServices() : [];
    if (process.platform !== "darwin") errors.push(`unsupported platform: ${process.platform}`);
    listenerCount = observed.length;
    const services = observed.map((service) => classify(service, settings));
    await probeServices(services);
    if (!options.forcePreviews) attachCachedPreviews(services);
    if (options.waitForPreviews) {
      await capturePreviewsNow(services, { force: options.forcePreviews });
    }
    groups = redactGroups(groupServices(services, settings));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const diagnostics: ScanDiagnostics = {
    scanned_at: new Date().toISOString(),
    is_scanning: false,
    duration_ms: Date.now() - started,
    listener_count: listenerCount,
    group_count: groups.length,
    visible_group_count: groups.filter((group) => group.visible).length,
    errors,
  };

  return localAppsEnabledResponseSchema.parse({
    app: "hilt-local-apps",
    enabled: true,
    machine: await machineIdentityAsync(),
    groups: groups.filter((group) => group.visible),
    diagnostics,
  });
}

function withScanningFlag(snapshot: LocalAppsEnabledResponse): LocalAppsEnabledResponse {
  return {
    ...snapshot,
    diagnostics: {
      ...snapshot.diagnostics,
      is_scanning: !!inFlight,
    },
  };
}

function redactGroups(groups: ServiceGroup[]): ServiceGroup[] {
  return groups.map((group) => ({
    ...group,
    services: group.services.map((service) => ({
      ...service,
      process: {
        ...service.process,
        args: redactSensitiveArgs(service.process.args),
      },
    })),
  }));
}
