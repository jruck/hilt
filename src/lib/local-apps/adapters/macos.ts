import { execFile } from "child_process";
import { promisify } from "util";
import type { Listener, ObservedService, ProcessInfo } from "../types";

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[], timeout = 2500): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function parseEndpoint(value: string): [string, number] | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]:");
    if (end === -1) return null;
    const port = Number.parseInt(trimmed.slice(end + 2), 10);
    return Number.isFinite(port) ? [trimmed.slice(1, end), port] : null;
  }

  const idx = trimmed.lastIndexOf(":");
  if (idx === -1) return null;
  const port = Number.parseInt(trimmed.slice(idx + 1), 10);
  return Number.isFinite(port) ? [trimmed.slice(0, idx), port] : null;
}

export function parseLsof(raw: string): Listener[] {
  let pid: number | null = null;
  let command = "";
  let user: string | null = null;
  let protocol = "TCP";
  const seen = new Set<string>();
  const listeners: Listener[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (line.length < 2) continue;
    const field = line[0];
    const value = line.slice(1);

    if (field === "p") {
      pid = Number.parseInt(value, 10);
      command = "";
      user = null;
      protocol = "TCP";
      continue;
    }
    if (field === "c") {
      command = value;
      continue;
    }
    if (field === "L") {
      user = value;
      continue;
    }
    if (field === "P") {
      protocol = value;
      continue;
    }
    if (field !== "n" || pid === null || !Number.isFinite(pid)) continue;

    const parsed = parseEndpoint(value);
    if (!parsed) continue;
    const [host, port] = parsed;
    const key = `${command}:${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push({
      protocol,
      host,
      port,
      pid,
      command,
      user,
      parent_pid: null,
    });
  }

  return listeners;
}

async function readScalar(pid: number, field: string): Promise<string | null> {
  const value = await run("ps", ["-p", String(pid), "-o", `${field}=`], 1500);
  return value || null;
}

async function readCwd(pid: number): Promise<string | null> {
  const raw = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], 1500);
  if (!raw) return null;
  return raw
    .split(/\r?\n/)
    .find((line) => line.startsWith("n"))
    ?.slice(1)
    .trim() || null;
}

async function readParentChain(firstParent: number | null): Promise<number[]> {
  const chain: number[] = [];
  let current = firstParent;

  for (let i = 0; i < 8; i++) {
    if (!current || chain.includes(current)) break;
    chain.push(current);
    const next = await readScalar(current, "ppid");
    current = next ? Number.parseInt(next, 10) : null;
    if (!Number.isFinite(current)) current = null;
  }

  return chain;
}

async function readProcess(pid: number, fallbackCommand: string): Promise<ProcessInfo> {
  const [ppidRaw, elapsedRaw, executable, argsRaw, cwd] = await Promise.all([
    readScalar(pid, "ppid"),
    readScalar(pid, "etimes"),
    readScalar(pid, "comm"),
    readScalar(pid, "args"),
    readCwd(pid),
  ]);
  const parentPid = ppidRaw ? Number.parseInt(ppidRaw, 10) : null;
  const elapsed = elapsedRaw ? Number.parseInt(elapsedRaw, 10) : null;
  const startTime = elapsed && Number.isFinite(elapsed)
    ? new Date(Date.now() - elapsed * 1000).toISOString()
    : null;

  return {
    pid,
    parent_pid: Number.isFinite(parentPid) ? parentPid : null,
    parent_chain: await readParentChain(Number.isFinite(parentPid) ? parentPid : null),
    cwd,
    executable: executable || null,
    args: argsRaw || fallbackCommand,
    start_time: startTime,
  };
}

export async function collectMacosServices(): Promise<ObservedService[]> {
  const raw = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcLunPT"], 5000);
  if (!raw) return [];

  const listeners = parseLsof(raw);
  const observed: ObservedService[] = [];
  for (const listener of listeners) {
    const process = await readProcess(listener.pid, listener.command);
    observed.push({
      listener: {
        ...listener,
        parent_pid: process.parent_pid,
      },
      process,
    });
  }
  return observed;
}

