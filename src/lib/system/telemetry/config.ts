import * as os from "os";
import * as path from "path";

// Telemetry / Performance configuration. All non-secret; SmartThings token stays
// in Hestia's local Homebridge config and is read in-process, never configured here.

export function getTelemetryDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getTelemetryDbPath(): string {
  return process.env.HILT_METRICS_DB_PATH || path.join(getTelemetryDataDir(), "metrics.sqlite");
}

export function getMetricsCollectorStatePath(): string {
  return process.env.HILT_METRICS_COLLECTOR_STATE_PATH || path.join(getTelemetryDataDir(), "metrics-collector.json");
}

export function getWeatherCachePath(): string {
  return process.env.HILT_METRICS_WEATHER_CACHE || path.join(getTelemetryDataDir(), "weather-cache.json");
}

// This machine runs the aggregating collector daemon + is the store-of-record.
// Set ONLY in Mercury's supervisor plist — never in the Electron app launch.
export function isMetricsCollectorEnabled(): boolean {
  return process.env.HILT_METRICS_COLLECTOR === "1";
}

// This machine holds the closet (SmartThings) sensor token — set only on Hestia.
export function isClosetSourceEnabled(): boolean {
  return process.env.HILT_METRICS_CLOSET === "1";
}

// Where a non-collector machine (a viewer running its own stack) reads the series
// from. Defaults to Mercury's Hilt over the tailnet (Tailscale Serve root).
export function getMetricsSourceUrl(): string {
  return (process.env.HILT_METRICS_SOURCE_URL || "https://mercury-v.tailc0acaa.ts.net").replace(/\/$/, "");
}

// When more than one machine could advertise a closet block, this picks the owner
// (machineId or label). Null = trust whichever machine advertises one.
export function getMetricsClosetMachine(): string | null {
  return process.env.HILT_METRICS_CLOSET_MACHINE || null;
}

export function getMetricsIntervalMs(): number {
  return boundedInt(process.env.HILT_METRICS_INTERVAL_S, 300, 60, 3600) * 1000;
}

export function getMetricsRetentionDays(): number {
  return boundedInt(process.env.HILT_METRICS_RETENTION_DAYS, 365, 1, 3650);
}

export function getMacmonBin(): string {
  // Absolute by default — non-interactive ssh / launchd have a minimal PATH.
  return process.env.HILT_MACMON_BIN || "/opt/homebrew/bin/macmon";
}

// macmon sample window for one `macmon pipe --samples 1` call.
export function getMacmonIntervalMs(): number {
  return boundedInt(process.env.HILT_MACMON_INTERVAL_MS, 500, 100, 5000);
}

export function getSourceTimeoutMs(): number {
  return boundedInt(process.env.HILT_METRICS_SOURCE_TIMEOUT_MS, 12_000, 1000, 60_000);
}

// Outdoor (NWS) — Atlanta, GA by default.
export const NWS_LAT = numEnv(process.env.HILT_METRICS_LAT, 33.749);
export const NWS_LON = numEnv(process.env.HILT_METRICS_LON, -84.388);
export const NWS_USER_AGENT = process.env.HILT_METRICS_NWS_UA || "hilt-performance (justin@pricelessmisc.com)";
export const WEATHER_CACHE_MS = 60 * 60 * 1000; // refresh outdoor at most hourly

// SmartThings closet sensor (token read locally from the Homebridge config).
export const SMARTTHINGS = {
  deviceId: process.env.HILT_METRICS_ST_DEVICE_ID || "b1896a97-28d6-4797-9e6d-1f3ae87f55f2",
  apiBase: process.env.HILT_METRICS_ST_API_BASE || "https://api.smartthings.com/v1",
  homebridgeConfigPath: process.env.HILT_METRICS_HOMEBRIDGE_CONFIG || path.join(os.homedir(), ".homebridge", "config.json"),
  platform: process.env.HILT_METRICS_ST_PLATFORM || "HomeBridgeSmartThings",
  tokenKey: "AccessToken",
};

// Test/CI fixture mode — readLocalMetrics returns deterministic values so agent
// parity checks don't drift on live macmon/NWS readings.
export function isMetricsFixture(): boolean {
  return process.env.HILT_METRICS_FIXTURE === "1";
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function numEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
