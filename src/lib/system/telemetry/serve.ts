import { machineIdentityAsync } from "@/lib/local-apps/tailnet";
import { machineId } from "@/lib/system/peers";
import { buildMachineCatalog } from "./catalog";
import { getMetricsSourceUrl, getSourceTimeoutMs } from "./config";
import { latestTelemetry, listMachineIds, queryTelemetry } from "./db";
import {
  COMPUTE_COLUMNS,
  type TelemetryLatestResponse,
  type TelemetryRange,
  type TelemetrySeriesResponse,
} from "./types";

const RANGE_SECONDS: Record<TelemetryRange, number> = {
  "6h": 6 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 86400,
  all: 0,
};

export function isTelemetryRange(value: string | null | undefined): value is TelemetryRange {
  return value === "6h" || value === "24h" || value === "7d" || value === "all";
}

async function selfMachineId(): Promise<string | null> {
  try {
    return machineId(await machineIdentityAsync());
  } catch {
    return null;
  }
}

// Catalog is built from ALL known machines (not the range-limited set) so a
// machine keeps its color across range switches; the collector/self sorts first
// so it holds index 0 (Mercury=violet) regardless of which peers are present.
async function catalog() {
  return buildMachineCatalog(listMachineIds(0), await selfMachineId());
}

export async function buildSeriesResponse(range: TelemetryRange, nowMs = Date.now()): Promise<TelemetrySeriesResponse> {
  const window = RANGE_SECONDS[range];
  const since = window === 0 ? 0 : Math.floor(nowMs / 1000) - window;
  const { rows } = queryTelemetry(since);
  return {
    columns: [...COMPUTE_COLUMNS],
    machines: await catalog(),
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildLatestResponse(nowMs = Date.now()): Promise<TelemetryLatestResponse> {
  const { sample, latestTs } = latestTelemetry();
  const ageSeconds = latestTs == null ? null : Math.max(0, Math.floor(nowMs / 1000) - latestTs);
  return { sample, ageSeconds, machines: await catalog() };
}

// Viewer path: proxy to the aggregator (Mercury's Hilt) over the tailnet.
export async function fetchAggregatorJson<T>(path: string): Promise<T> {
  const url = `${getMetricsSourceUrl()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getSourceTimeoutMs());
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Aggregator returned ${res.status}`;
      throw new Error(message);
    }
    if (data === null) throw new Error("Aggregator returned no JSON");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
