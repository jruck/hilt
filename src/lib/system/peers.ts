import { localAppsEnabledResponseSchema } from "@/lib/local-apps/contracts";
import { isLocalAppsEnabled } from "@/lib/local-apps/settings";
import { machineIdentityAsync, tailnetPeersAsync, type TailnetPeer } from "@/lib/local-apps/tailnet";
import { isLocalMapEnabled } from "@/lib/map/local-config";
import type { MachineIdentity } from "@/lib/local-apps/types";
import { getAppServerInfo } from "./app-server-info";
import { isSystemSyncEnabled } from "./sync-settings";
import type { SystemMachine, SystemMachineResponse, SystemMachineRole } from "./types";

const REMOTE_TIMEOUT_MS = 1_500;
const HILT_DEV_PORTS = [3000, 3001, 3002, 3003, 3004];

export function isSystemNetworkEnabled(): boolean {
  return process.env.HILT_SYSTEM_NETWORK_ENABLED !== "false";
}

export function machineId(machine: MachineIdentity): string {
  return (machine.tailscale_dns || machine.tailscale_ip4 || machine.hostname).replace(/\.$/, "");
}

export function machineLabel(machine: MachineIdentity): string {
  return (machine.tailscale_dns || machine.hostname || machine.tailscale_ip4 || "unknown")
    .replace(/\.$/, "")
    .split(".")[0]
    .replace(/-v$/i, "");
}

export async function localSystemMachineResponse(
  options: { role?: SystemMachineRole; includeAppServer?: boolean } = {},
): Promise<SystemMachineResponse> {
  return {
    app: "hilt-system",
    enabled: true,
    role: options.role ?? "full",
    machine: await machineIdentityAsync(),
    features: {
      map: isLocalMapEnabled(),
      apps: isLocalAppsEnabled(),
      stack: true,
      sync: isSystemSyncEnabled(),
    },
    app_server: options.includeAppServer === false ? null : getAppServerInfo(),
  };
}

export async function discoverSystemMachines(options: { includePeers?: boolean } = {}): Promise<SystemMachine[]> {
  const localResponse = await localSystemMachineResponse();
  const localMachine: SystemMachine = {
    id: machineId(localResponse.machine),
    self: true,
    reachable: true,
    source_url: null,
    machine: {
      ...localResponse.machine,
      origin: "local",
    },
    role: localResponse.role,
    features: localResponse.features,
    app_server: localResponse.app_server ?? null,
    error: null,
  };

  if (options.includePeers === false || !isSystemNetworkEnabled()) return [localMachine];

  const peers = await tailnetPeersAsync();
  const remoteMachines = await Promise.all(
    peers
      .filter((peer) => peer.online && peer.os !== "iOS")
      .filter((peer) => !isSelfPeer(peer, localMachine.machine))
      .map(fetchPeerSystemMachine),
  );

  return [
    localMachine,
    ...remoteMachines
      .filter((machine): machine is SystemMachine => !!machine)
      .sort((a, b) => machineLabel(a.machine).localeCompare(machineLabel(b.machine))),
  ];
}

export async function fetchPeerJson<T>(
  machine: SystemMachine,
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  if (!machine.source_url) {
    throw new Error(`No source URL for ${machine.id}`);
  }
  const response = await fetchWithTimeout(
    `${machine.source_url}${path}`,
    options.timeoutMs ?? REMOTE_TIMEOUT_MS,
    options.method || "GET",
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

/**
 * Accepts any responder identifying as a Hilt System endpoint and normalizes it
 * into a discovered SystemMachine. `role` is read additively: peers that predate
 * the field (full Hilt or System Agents) default to "full" — discovery never
 * gates on role, only on app/enabled/machine. Returns null for non-Hilt payloads.
 */
export function systemMachineFromResponse(
  data: Partial<SystemMachineResponse>,
  baseUrl: string,
): SystemMachine | null {
  if (data.app !== "hilt-system" || data.enabled !== true || !data.machine) return null;
  const machine: MachineIdentity = {
    ...data.machine,
    origin: "remote",
  };
  return {
    id: machineId(machine),
    self: false,
    reachable: true,
    source_url: baseUrl,
    machine,
    role: data.role ?? "full",
    features: normalizeFeatures(data.features),
    app_server: data.app_server ?? null,
    error: null,
  };
}

async function fetchPeerSystemMachine(peer: TailnetPeer): Promise<SystemMachine | null> {
  for (const baseUrl of candidateBaseUrls(peer)) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/system/machine?scope=local`, REMOTE_TIMEOUT_MS);
      if (!response.ok) continue;
      const data = (await response.json()) as Partial<SystemMachineResponse>;
      const parsed = systemMachineFromResponse(data, baseUrl);
      if (!parsed) continue;
      return parsed;
    } catch {
      // Non-Hilt devices and temporarily unavailable dev servers are expected.
    }

    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/local-apps?scope=local`, REMOTE_TIMEOUT_MS);
      if (!response.ok) continue;
      const parsed = localAppsEnabledResponseSchema.safeParse(await response.json());
      if (!parsed.success || !parsed.data.enabled) continue;
      const machine: MachineIdentity = {
        ...parsed.data.machine,
        origin: "remote",
      };
      return {
        id: machineId(machine),
        self: false,
        reachable: true,
        source_url: baseUrl,
        machine,
        features: {
          map: true,
          apps: true,
          stack: true,
          sync: false,
        },
        error: null,
      };
    } catch {
      // Older Hilt builds can still identify themselves through Local Apps.
    }
  }

  return null;
}

function normalizeFeatures(features: Partial<SystemMachineResponse["features"]> | undefined): SystemMachineResponse["features"] {
  return {
    map: features?.map === true,
    apps: features?.apps === true,
    stack: features?.stack === true,
    sync: features?.sync === true,
  };
}

function candidateBaseUrls(peer: TailnetPeer): string[] {
  const candidates: string[] = [];
  if (peer.dns_name) {
    candidates.push(`https://${peer.dns_name}`);
    candidates.push(...HILT_DEV_PORTS.map((port) => `http://${peer.dns_name}:${port}`));
  }
  if (peer.ip4) candidates.push(...HILT_DEV_PORTS.map((port) => `http://${peer.ip4}:${port}`));
  return [...new Set(candidates)];
}

async function fetchWithTimeout(url: string, timeoutMs: number, method = "GET"): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      method,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isSelfPeer(peer: TailnetPeer, local: MachineIdentity): boolean {
  const localDns = local.tailscale_dns?.replace(/\.$/, "");
  return (
    (!!localDns && peer.dns_name === localDns) ||
    (!!local.tailscale_ip4 && peer.ip4 === local.tailscale_ip4) ||
    peer.hostname === local.hostname
  );
}
