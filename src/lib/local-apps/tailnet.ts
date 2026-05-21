import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { MachineIdentity } from "./types";

let cachedPreviewHost: string | null | undefined;
let cachedTailscaleIp4: string | null | undefined;
let cachedTailscaleDns: string | null | undefined;
let cachedTailnetStatus: TailnetStatus | null | undefined;

export interface TailnetPeer {
  id: string;
  hostname: string;
  dns_name: string | null;
  ip4: string | null;
  online: boolean;
  os?: string | null;
  self: boolean;
}

interface TailnetStatus {
  self: TailnetPeer | null;
  peers: TailnetPeer[];
}

function commandOutput(command: string, args: string[]): string | null {
  try {
    return execFileSync(commandPath(command), args, {
      encoding: "utf-8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function firstLine(value: string | null): string | null {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function commandPath(command: string): string {
  const candidates: Record<string, string[]> = {
    tailscale: [
      "/opt/homebrew/bin/tailscale",
      "/usr/local/bin/tailscale",
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ],
    "tailnet-preview": [
      path.join(os.homedir(), ".local/bin/tailnet-preview"),
      "/opt/homebrew/bin/tailnet-preview",
      "/usr/local/bin/tailnet-preview",
    ],
  };

  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(dir, command);
    if (candidate && fileExists(candidate)) return candidate;
  }
  return candidates[command]?.find(fileExists) || command;
}

function fileExists(candidate: string): boolean {
  try {
    return !!candidate && fs.existsSync(candidate);
  } catch {
    return false;
  }
}

export function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}

export function tailscaleIp4(): string | null {
  if (cachedTailscaleIp4 === undefined) {
    cachedTailscaleIp4 = firstLine(commandOutput("tailscale", ["ip", "-4"]));
  }
  return cachedTailscaleIp4;
}

export function previewHostFromStatus(): string | null {
  if (cachedTailscaleDns !== undefined) return cachedTailscaleDns;
  const status = tailnetStatus();
  if (!status?.self) {
    cachedTailscaleDns = null;
    return null;
  }
  cachedTailscaleDns = status.self.dns_name;
  return cachedTailscaleDns;
}

export function previewHostFromHelper(): string | null {
  const output = firstLine(commandOutput("tailnet-preview", ["1"]));
  if (!output) return null;
  const rest = output.includes("://") ? output.split("://")[1] : output;
  return rest.split(/[:/?#]/)[0]?.trim().replace(/\.$/, "") || null;
}

export function previewHost(): string | null {
  if (cachedPreviewHost !== undefined) return cachedPreviewHost;
  cachedPreviewHost = (
    process.env.HILT_LOCAL_APPS_PREVIEW_HOST?.trim().replace(/\.$/, "") ||
    process.env.PORT_AUTHORITY_PREVIEW_HOST?.trim().replace(/\.$/, "") ||
    previewHostFromHelper() ||
    previewHostFromStatus()
  );
  return cachedPreviewHost;
}

export function previewUrlForPort(port: number): string | null {
  const host = previewHost();
  return host ? previewUrlForHost(host, port) : null;
}

export function previewUrlForHost(host: string, port: number): string {
  return `http://${urlHost(host)}:${port}`;
}

export function publicHostForListener(host: string): string {
  const ip4 = tailscaleIp4();
  if (ip4 && host === ip4) return previewHost() || host;
  if (host === "*" || host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

export function machineIdentity(): MachineIdentity {
  return {
    hostname: os.hostname(),
    tailscale_dns: previewHostFromStatus(),
    tailscale_ip4: tailscaleIp4(),
    origin: "local",
  };
}

export function tailnetStatus(): TailnetStatus | null {
  if (cachedTailnetStatus !== undefined) return cachedTailnetStatus;
  const raw = commandOutput("tailscale", ["status", "--json"]);
  cachedTailnetStatus = raw ? parseTailnetStatus(raw) : null;
  return cachedTailnetStatus;
}

export function tailnetPeers(): TailnetPeer[] {
  return tailnetStatus()?.peers || [];
}

export function parseTailnetStatus(raw: string): TailnetStatus | null {
  try {
    const parsed = JSON.parse(raw) as {
      Self?: TailscaleNode;
      Peer?: Record<string, TailscaleNode>;
    };
    const self = parsed.Self ? nodeToPeer("self", parsed.Self, true) : null;
    const peers = Object.entries(parsed.Peer || {}).map(([id, peer]) => nodeToPeer(id, peer, false));
    return { self, peers };
  } catch {
    return null;
  }
}

interface TailscaleNode {
  HostName?: string;
  DNSName?: string;
  Online?: boolean;
  OS?: string;
  TailscaleIPs?: string[];
}

function nodeToPeer(id: string, node: TailscaleNode, self: boolean): TailnetPeer {
  return {
    id,
    hostname: node.HostName || node.DNSName?.replace(/\.$/, "") || id,
    dns_name: node.DNSName?.trim().replace(/\.$/, "") || null,
    ip4: node.TailscaleIPs?.find((ip) => ip.includes(".") && !ip.includes(":")) || null,
    online: self || node.Online === true,
    os: node.OS || null,
    self,
  };
}
