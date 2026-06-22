import { execFile } from "child_process";
import * as fs from "fs/promises";
import { machineIdentityAsync } from "@/lib/local-apps/tailnet";
import {
  SMARTTHINGS,
  getMacmonBin,
  getMacmonIntervalMs,
  getSourceTimeoutMs,
  isClosetSourceEnabled,
  isMetricsFixture,
} from "./config";
import { emptyCompute, type ClosetMetrics, type ComputeMetrics, type LocalMetricsResponse } from "./types";

// readLocalMetrics() — the single shared sampler the System Agent route AND the
// full-Hilt self route call, so agent output is byte-identical to full Hilt's.
// Compute (macmon die temps/power + sysctl/vm_stat/top) is sampled on every
// machine; the closet block is added only on the machine holding the SmartThings
// token (Hestia, HILT_METRICS_CLOSET=1). The token is read and used in-process and
// never returned. Ported from mercury-observability lib/sources/{thermal,localMetrics,smartthings}.mjs.

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}
// A running die is never ≤1°C; macmon returns 0.0 when a sensor isn't exposed.
function dieTemp(v: unknown): number | null {
  const n = num(v);
  return n === null || n <= 1 ? null : round1(n);
}

// macmon (and the sysctl-based host metrics) shell out to system tools — notably
// `sysctl` in /usr/sbin. A launchd-supervised process can have a minimal PATH that
// omits /usr/sbin:/sbin, which made macmon exit with "Os NotFound" and the sysctl
// probes ENOENT. Run every probe with those dirs guaranteed on PATH so the sampler
// is self-sufficient regardless of the parent process's environment.
function probeEnv(): NodeJS.ProcessEnv {
  const dirs = (process.env.PATH || "").split(":").filter(Boolean);
  for (const d of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
    if (!dirs.includes(d)) dirs.push(d);
  }
  return { ...process.env, PATH: dirs.join(":") };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 1 << 20, env: probeEnv() }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// --- pure parsers (exported for tests) ---

export function parseLoadAvg(out: string): number | null {
  const m = out.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

export function parseCpuUsage(out: string): number | null {
  const line = out.split("\n").find((l) => /CPU usage:/i.test(l));
  if (!line) return null;
  const user = line.match(/([\d.]+)%\s*user/i);
  const sys = line.match(/([\d.]+)%\s*sys/i);
  if (!user || !sys) return null;
  const v = Number(user[1]) + Number(sys[1]);
  return Number.isFinite(v) ? round1(v) : null;
}

export function parseVmStat(out: string, totalBytes: number): { mem_used_gb: number | null; mem_used_pct: number | null } {
  const pageMatch = out.match(/page size of (\d+) bytes/i);
  const pageSize = pageMatch ? Number(pageMatch[1]) : 4096;
  const pagesFor = (label: string): number | null => {
    const m = out.match(new RegExp(`${label}:\\s+(\\d+)\\.`, "i"));
    return m ? Number(m[1]) : null;
  };
  const active = pagesFor("Pages active");
  const wired = pagesFor("Pages wired down");
  const compressed = pagesFor("Pages occupied by compressor");
  if (active == null || wired == null || compressed == null) return { mem_used_gb: null, mem_used_pct: null };
  const usedBytes = (active + wired + compressed) * pageSize;
  return {
    mem_used_gb: round1(usedBytes / 1024 ** 3),
    mem_used_pct: totalBytes ? round1((usedBytes / totalBytes) * 100) : null,
  };
}

// --- compute sources ---

async function sampleMacmon(timeoutMs: number): Promise<Partial<ComputeMetrics>> {
  try {
    const stdout = await run(getMacmonBin(), ["pipe", "--samples", "1", "--interval", String(getMacmonIntervalMs())], timeoutMs);
    const line = stdout.trim().split("\n").filter(Boolean).pop();
    if (!line) return {};
    const d = JSON.parse(line) as {
      temp?: { cpu_temp_avg?: number; gpu_temp_avg?: number };
      cpu_power?: number;
      gpu_power?: number;
      gpu_usage?: [number, number];
    };
    const gpuFrac = Array.isArray(d.gpu_usage) ? d.gpu_usage[1] : null;
    return {
      cpu_temp_c: dieTemp(d.temp?.cpu_temp_avg),
      gpu_temp_c: dieTemp(d.temp?.gpu_temp_avg),
      cpu_power_w: round1(num(d.cpu_power)),
      gpu_power_w: round1(num(d.gpu_power)),
      gpu_pct: gpuFrac == null ? null : round1(Number(gpuFrac) * 100),
    };
  } catch (err) {
    console.warn(`[telemetry] macmon failed: ${(err as Error)?.message ?? err}`);
    return {};
  }
}

async function sampleLocalHost(timeoutMs: number): Promise<Partial<ComputeMetrics>> {
  const [memRes, loadRes, cpuRes] = await Promise.allSettled([
    (async () => {
      const [memsizeOut, vmstatOut] = await Promise.all([
        run("sysctl", ["-n", "hw.memsize"], timeoutMs),
        run("vm_stat", [], timeoutMs),
      ]);
      const totalBytes = Number(memsizeOut.trim());
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw new Error("bad hw.memsize");
      return parseVmStat(vmstatOut, totalBytes);
    })(),
    (async () => parseLoadAvg(await run("sysctl", ["-n", "vm.loadavg"], timeoutMs)))(),
    (async () => parseCpuUsage(await run("top", ["-l", "1", "-n", "0"], timeoutMs)))(),
  ]);
  const out: Partial<ComputeMetrics> = {};
  if (memRes.status === "fulfilled") {
    out.mem_used_pct = memRes.value.mem_used_pct;
    out.mem_used_gb = memRes.value.mem_used_gb;
  }
  if (loadRes.status === "fulfilled") out.load_1m = loadRes.value;
  if (cpuRes.status === "fulfilled") out.cpu_pct = cpuRes.value;
  return out;
}

// --- closet (SmartThings) — token read locally, never returned ---

async function readCloset(timeoutMs: number): Promise<ClosetMetrics | null> {
  if (!isClosetSourceEnabled()) return null;
  const nullCloset: ClosetMetrics = { closet_temp_f: null, closet_humidity: null, closet_motion: null };
  try {
    const raw = await fs.readFile(SMARTTHINGS.homebridgeConfigPath, "utf8");
    const cfg = JSON.parse(raw) as { platforms?: Array<Record<string, unknown>> };
    const platform = cfg.platforms?.find((p) => p.platform === SMARTTHINGS.platform);
    const token = platform?.[SMARTTHINGS.tokenKey];
    if (typeof token !== "string" || !token) {
      console.warn("[telemetry] closet: no SmartThings token in Homebridge config");
      return nullCloset;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${SMARTTHINGS.apiBase}/devices/${SMARTTHINGS.deviceId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[telemetry] closet: SmartThings ${res.status}`);
        return nullCloset;
      }
      const status = (await res.json()) as {
        components?: { main?: Record<string, { [k: string]: { value?: unknown } }> };
      };
      const main = status?.components?.main;
      const motionRaw = main?.motionSensor?.motion?.value;
      return {
        closet_temp_f: num(main?.temperatureMeasurement?.temperature?.value),
        closet_humidity: num(main?.relativeHumidityMeasurement?.humidity?.value),
        closet_motion: motionRaw == null ? null : String(motionRaw),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[telemetry] closet read failed: ${(err as Error)?.message ?? err}`);
    return nullCloset;
  }
}

function fixtureResponse(machine: Awaited<ReturnType<typeof machineIdentityAsync>>): LocalMetricsResponse {
  const compute: ComputeMetrics = {
    ...emptyCompute(),
    cpu_temp_c: 50,
    gpu_temp_c: 40,
    cpu_power_w: 5,
    gpu_power_w: 1,
    mem_used_pct: 50,
    mem_used_gb: 8,
    load_1m: 2,
    cpu_pct: 25,
    gpu_pct: 5,
  };
  const resp: LocalMetricsResponse = { machine, compute };
  if (isClosetSourceEnabled()) resp.ambient = { closet_temp_f: 85, closet_humidity: 42, closet_motion: "inactive" };
  return resp;
}

export async function readLocalMetrics(): Promise<LocalMetricsResponse> {
  const machine = await machineIdentityAsync();
  if (isMetricsFixture()) return fixtureResponse(machine);

  const timeoutMs = getSourceTimeoutMs();
  const [macmon, host, closet] = await Promise.all([
    sampleMacmon(timeoutMs),
    sampleLocalHost(timeoutMs),
    readCloset(timeoutMs),
  ]);
  const compute: ComputeMetrics = { ...emptyCompute(), ...host, ...macmon };
  const resp: LocalMetricsResponse = { machine, compute };
  if (closet) resp.ambient = closet;
  return resp;
}
