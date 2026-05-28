import { execFile, execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { MachineIdentity } from "./types";

const execFileAsync = promisify(execFile);

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
    try {
      return execFileSync("/bin/zsh", ["-lc", shellCommand(command, args)], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
    } catch {
      return null;
    }
  }
}

async function commandOutputAsync(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(commandPath(command), args, {
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() || null;
  } catch {
    try {
      const { stdout } = await execFileAsync("/bin/zsh", ["-lc", shellCommand(command, args)], {
        encoding: "utf-8",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
  if (cachedTailscaleIp4) return cachedTailscaleIp4;
  const ip4 = firstLine(commandOutput("tailscale", ["ip", "-4"]));
  if (ip4) cachedTailscaleIp4 = ip4;
  return ip4;
}

export async function tailscaleIp4Async(): Promise<string | null> {
  if (cachedTailscaleIp4) return cachedTailscaleIp4;
  const ip4 = firstLine(await commandOutputAsync("tailscale", ["ip", "-4"]));
  if (ip4) cachedTailscaleIp4 = ip4;
  return ip4;
}

export function previewHostFromStatus(): string | null {
  if (cachedTailscaleDns) return cachedTailscaleDns;
  const status = tailnetStatus();
  const dns = status?.self?.dns_name || null;
  if (dns) cachedTailscaleDns = dns;
  return dns;
}

export async function previewHostFromStatusAsync(): Promise<string | null> {
  if (cachedTailscaleDns) return cachedTailscaleDns;
  const status = await tailnetStatusAsync();
  const dns = status?.self?.dns_name || null;
  if (dns) cachedTailscaleDns = dns;
  return dns;
}

export function previewHostFromHelper(): string | null {
  const output = firstLine(commandOutput("tailnet-preview", ["1"]));
  if (!output) return null;
  const rest = output.includes("://") ? output.split("://")[1] : output;
  return rest.split(/[:/?#]/)[0]?.trim().replace(/\.$/, "") || null;
}

export function previewHost(): string | null {
  if (cachedPreviewHost) return cachedPreviewHost;
  const host = (
    process.env.HILT_LOCAL_APPS_PREVIEW_HOST?.trim().replace(/\.$/, "") ||
    process.env.PORT_AUTHORITY_PREVIEW_HOST?.trim().replace(/\.$/, "") ||
    previewHostFromHelper() ||
    previewHostFromStatus()
  );
  if (host) cachedPreviewHost = host;
  return host;
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
  const override = machineIdentityOverride();
  if (override) return override;

  return {
    hostname: os.hostname(),
    tailscale_dns: previewHostFromStatus(),
    tailscale_ip4: tailscaleIp4(),
    origin: "local",
  };
}

export async function machineIdentityAsync(): Promise<MachineIdentity> {
  const override = machineIdentityOverride();
  if (override) return override;

  const [status, ip4] = await Promise.all([
    tailnetStatusAsync(),
    tailscaleIp4Async(),
  ]);

  const dns = status?.self?.dns_name || null;
  if (dns) cachedTailscaleDns = dns;

  return {
    hostname: os.hostname(),
    tailscale_dns: dns,
    tailscale_ip4: ip4,
    origin: "local",
  };
}

function machineIdentityOverride(): MachineIdentity | null {
  const hostname = process.env.HILT_SYSTEM_MACHINE_HOSTNAME?.trim();
  const dns = process.env.HILT_SYSTEM_MACHINE_DNS?.trim().replace(/\.$/, "");
  const ip4 = process.env.HILT_SYSTEM_MACHINE_IP4?.trim();
  if (!hostname && !dns && !ip4) return null;

  return {
    hostname: hostname || dns?.split(".")[0] || ip4 || "hilt-demo",
    tailscale_dns: dns || null,
    tailscale_ip4: ip4 || null,
    origin: "local",
  };
}

export function tailnetStatus(): TailnetStatus | null {
  if (cachedTailnetStatus) return cachedTailnetStatus;
  const raw = commandOutput("tailscale", ["status", "--json"]);
  const status = raw ? parseTailnetStatus(raw) : null;
  if (status) cachedTailnetStatus = status;
  return status;
}

export async function tailnetStatusAsync(): Promise<TailnetStatus | null> {
  if (cachedTailnetStatus) return cachedTailnetStatus;
  const raw = await commandOutputAsync("tailscale", ["status", "--json"]);
  const status = raw ? parseTailnetStatus(raw) : null;
  if (status) cachedTailnetStatus = status;
  return status;
}

export function tailnetPeers(): TailnetPeer[] {
  return tailnetStatus()?.peers || [];
}

export async function tailnetPeersAsync(): Promise<TailnetPeer[]> {
  return (await tailnetStatusAsync())?.peers || [];
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
