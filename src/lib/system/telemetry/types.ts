import type { MachineIdentity } from "@/lib/local-apps/types";

// Per-machine compute metrics — un-prefixed, identical shape on every machine.
// A new machine is a new machine_id value in the store, never new columns.
export interface ComputeMetrics {
  cpu_temp_c: number | null;
  gpu_temp_c: number | null;
  cpu_power_w: number | null;
  gpu_power_w: number | null;
  fan_rpm: number | null;
  mem_used_pct: number | null;
  mem_used_gb: number | null;
  load_1m: number | null;
  cpu_pct: number | null;
  gpu_pct: number | null;
  thermal_pressure: string | null;
}

// Closet sensor block — reported only by the machine holding the SmartThings token.
export interface ClosetMetrics {
  closet_temp_f: number | null;
  closet_humidity: number | null;
  closet_motion: string | null;
}

// Ambient (environment) row — closet (from the gateway machine) + outdoor (NWS,
// filled by the aggregator). Stored once per tick, not per machine.
export interface AmbientMetrics extends ClosetMetrics {
  outdoor_temp_f: number | null;
}

// What GET /api/system/metrics returns for the local machine.
export interface LocalMetricsResponse {
  machine: MachineIdentity;
  compute: ComputeMetrics;
  // Present only on the closet-sensor host (Hestia). Token never serialized.
  ambient?: ClosetMetrics;
}

// One aligned time-series sample served to the UI. Ambient stays flat (left axis);
// compute is keyed by machine_id (right axis, one series per machine).
export interface TelemetrySample {
  ts: number; // unix epoch seconds, UTC
  closet_temp_f: number | null;
  closet_humidity: number | null;
  closet_motion: string | null;
  outdoor_temp_f: number | null;
  machines: Record<string, ComputeMetrics>;
}

// Series catalog entry — one per machine, drives legend + chart color.
export interface MachineMeta {
  id: string;
  label: string;
  color: string;
}

export type TelemetryRange = "6h" | "24h" | "7d" | "all";
export const TELEMETRY_RANGES: TelemetryRange[] = ["6h", "24h", "7d", "all"];

export interface TelemetrySeriesResponse {
  columns: string[];
  machines: MachineMeta[];
  rows: TelemetrySample[];
  generatedAt?: string;
}

export interface TelemetryLatestResponse {
  sample: TelemetrySample | null;
  ageSeconds: number | null;
  machines: MachineMeta[];
}

// Real (REAL) compute columns + the single TEXT column. Order is stable so the
// SQLite insert/migration stay aligned.
export const COMPUTE_COLUMNS: (keyof ComputeMetrics)[] = [
  "cpu_temp_c",
  "gpu_temp_c",
  "cpu_power_w",
  "gpu_power_w",
  "fan_rpm",
  "mem_used_pct",
  "mem_used_gb",
  "load_1m",
  "cpu_pct",
  "gpu_pct",
  "thermal_pressure",
];
export const TEXT_COMPUTE_COLUMNS = new Set<keyof ComputeMetrics>(["thermal_pressure"]);

export function emptyCompute(): ComputeMetrics {
  return {
    cpu_temp_c: null,
    gpu_temp_c: null,
    cpu_power_w: null,
    gpu_power_w: null,
    fan_rpm: null,
    mem_used_pct: null,
    mem_used_gb: null,
    load_1m: null,
    cpu_pct: null,
    gpu_pct: null,
    thermal_pressure: null,
  };
}

// Deterministic palette for compute lines; assigned by stable machine_id sort so a
// machine keeps its hue across reloads and when peers drop offline.
// Index 0 = violet (Mercury today), 1 = magenta (Hestia today).
export const COMPUTE_PALETTE = [
  "#a855f7",
  "#ec4899",
  "#f59e0b",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
  "#f97316",
  "#06b6d4",
];
