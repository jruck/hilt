import * as fs from "fs";
import * as path from "path";
import { discoverSystemMachines, fetchPeerJson } from "@/lib/system/peers";
import {
  getMetricsClosetMachine,
  getMetricsCollectorStatePath,
  getMetricsIntervalMs,
  getSourceTimeoutMs,
  isMetricsCollectorEnabled,
} from "./config";
import { pruneTelemetry, writeTick } from "./db";
import { readLocalMetrics } from "./local";
import { readOutdoorTempF } from "./nws";
import type { AmbientMetrics, LocalMetricsResponse } from "./types";

// Aggregating collector — runs ONLY on the store-of-record machine (Mercury) when
// HILT_METRICS_COLLECTOR=1 (set in its supervisor plist, never in the Electron app).
// Each tick: discover machines, read self via the shared lib + each peer via its
// /api/system/metrics, fetch outdoor (NWS), pick closet from the owner, upsert one
// aligned tick (N machine rows + one ambient row), prune. Modeled on granola/daemon.ts.

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const startedAt = new Date().toISOString();

export function startMetricsCollectorDaemon(): void {
  if (!isMetricsCollectorEnabled() || timer || running) return;
  const intervalMs = getMetricsIntervalMs();
  const tick = async () => {
    running = true;
    try {
      await collectOnce();
    } catch (error) {
      console.error("[MetricsCollector] tick failed:", error);
    } finally {
      running = false;
      writeState({ running: false, intervalMs });
      timer = setTimeout(tick, intervalMs);
    }
  };
  writeState({ running: false, intervalMs });
  console.log(`[MetricsCollector] enabled; collecting every ${intervalMs / 1000}s`);
  timer = setTimeout(tick, 3_000); // first tick shortly after boot
}

export function stopMetricsCollectorDaemon(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  writeState({ running: false, enabled: false });
}

export async function collectOnce(nowMs = Date.now()): Promise<{ ts: number; machineIds: string[] }> {
  const ts = Math.floor(nowMs / 1000);
  const machines = await discoverSystemMachines({ includePeers: true });

  // Self via the shared lib; peers via their (agent or full-Hilt) metrics route.
  const readings = await Promise.all(
    machines.map(async (m) => {
      try {
        const data = m.self
          ? await readLocalMetrics()
          : await fetchPeerJson<LocalMetricsResponse>(m, "/api/system/metrics", { timeoutMs: getSourceTimeoutMs() });
        return { id: m.id, data };
      } catch (error) {
        console.warn(`[MetricsCollector] ${m.id} unreachable: ${(error as Error)?.message ?? error}`);
        return { id: m.id, data: null as LocalMetricsResponse | null };
      }
    }),
  );

  // One compute row per machine that responded (a miss → no row → the line gaps).
  const machineRows = readings
    .filter((r): r is { id: string; data: LocalMetricsResponse } => !!r.data)
    .map((r) => ({ machineId: r.id, compute: r.data.compute }));

  // Closet: from the configured owner if set, else whichever machine advertises one.
  const closetOwner = getMetricsClosetMachine();
  const closetReading =
    (closetOwner
      ? readings.find((r) => r.data?.ambient && (r.id === closetOwner || r.id.split(".")[0] === closetOwner))
      : readings.find((r) => r.data?.ambient))?.data?.ambient ?? null;

  const outdoor = await readOutdoorTempF(nowMs);
  const ambient: Partial<AmbientMetrics> = {
    closet_temp_f: closetReading?.closet_temp_f ?? null,
    closet_humidity: closetReading?.closet_humidity ?? null,
    closet_motion: closetReading?.closet_motion ?? null,
    outdoor_temp_f: outdoor,
  };

  writeTick({ ts, machines: machineRows, ambient });
  pruneTelemetry(undefined, nowMs);
  return { ts, machineIds: machineRows.map((m) => m.machineId) };
}

function writeState(input: { running: boolean; intervalMs?: number; enabled?: boolean }): void {
  try {
    const statePath = getMetricsCollectorStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const now = new Date();
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          kind: "metrics-collector",
          enabled: input.enabled ?? true,
          running: input.running,
          pid: process.pid,
          startedAt,
          updatedAt: now.toISOString(),
          nextRunAt: input.intervalMs ? new Date(now.getTime() + input.intervalMs).toISOString() : null,
          intervalMs: input.intervalMs ?? null,
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch (error) {
    console.error("[MetricsCollector] failed to write state:", error);
  }
}
