import { localAppsEnabledResponseSchema } from "./contracts";
import { isPeerDiscoveryEnabled } from "./settings";
import { tailnetPeers, type TailnetPeer } from "./tailnet";
import type { LocalAppsEnabledResponse, LocalAppsMachineSnapshot, LocalAppsSummary, MachineIdentity } from "./types";

const REMOTE_TIMEOUT_MS = 1_500;

export async function buildMachineSnapshots(local: LocalAppsEnabledResponse): Promise<LocalAppsMachineSnapshot[]> {
  const localMachine = machineSnapshot(local, {
    self: true,
    source_url: null,
    origin: "local",
  });

  if (!isPeerDiscoveryEnabled()) return [localMachine];

  const remoteSnapshots = await Promise.all(
    tailnetPeers()
      .filter((peer) => peer.online && peer.os !== "iOS")
      .filter((peer) => !isSelfPeer(peer, local.machine))
      .map((peer) => fetchPeerSnapshot(peer)),
  );

  return [
    localMachine,
    ...remoteSnapshots
      .filter((snapshot): snapshot is LocalAppsMachineSnapshot => !!snapshot)
      .sort((a, b) => machineLabel(a.machine).localeCompare(machineLabel(b.machine))),
  ];
}

export function summarizeMachines(machines: LocalAppsMachineSnapshot[]): LocalAppsSummary {
  return {
    machine_count: machines.length,
    group_count: machines.reduce((sum, machine) => sum + machine.groups.length, 0),
    service_count: machines.reduce((sum, machine) => (
      sum + machine.groups.reduce((groupSum, group) => groupSum + group.services.length, 0)
    ), 0),
    visible_group_count: machines.reduce((sum, machine) => (
      sum + machine.groups.filter((group) => group.visible).length
    ), 0),
  };
}

export function machineSnapshot(
  snapshot: LocalAppsEnabledResponse,
  options: { self: boolean; source_url?: string | null; origin: MachineIdentity["origin"] },
): LocalAppsMachineSnapshot {
  const machine: MachineIdentity = {
    ...snapshot.machine,
    origin: options.origin,
  };

  return {
    id: machineKey(machine),
    self: options.self,
    reachable: true,
    source_url: options.source_url ?? null,
    machine,
    groups: snapshot.groups,
    diagnostics: snapshot.diagnostics,
    error: null,
  };
}

async function fetchPeerSnapshot(peer: TailnetPeer): Promise<LocalAppsMachineSnapshot | null> {
  for (const baseUrl of candidateBaseUrls(peer)) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/local-apps?scope=local`, REMOTE_TIMEOUT_MS);
      if (!response.ok) continue;
      const parsed = localAppsEnabledResponseSchema.safeParse(await response.json());
      if (!parsed.success || !parsed.data.enabled) continue;
      return machineSnapshot(parsed.data, {
        self: false,
        source_url: baseUrl,
        origin: "remote",
      });
    } catch {
      // Try the next candidate URL. Non-Hilt devices are expected to fail quietly.
    }
  }

  return null;
}

function candidateBaseUrls(peer: TailnetPeer): string[] {
  const candidates: string[] = [];
  if (peer.dns_name) {
    candidates.push(`https://${peer.dns_name}`);
    candidates.push(`http://${peer.dns_name}:3000`);
  }
  if (peer.ip4) candidates.push(`http://${peer.ip4}:3000`);
  return [...new Set(candidates)];
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
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

function machineKey(machine: MachineIdentity): string {
  return machine.tailscale_dns || machine.tailscale_ip4 || machine.hostname;
}

function machineLabel(machine: MachineIdentity): string {
  return machine.tailscale_dns || machine.hostname;
}
