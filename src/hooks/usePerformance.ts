"use client";

import useSWR from "swr";
import { withBasePath } from "@/lib/base-path";
import type {
  TelemetryLatestResponse,
  TelemetryRange,
  TelemetrySeriesResponse,
} from "@/lib/system/telemetry/types";

export type {
  ComputeMetrics,
  MachineMeta,
  TelemetryLatestResponse,
  TelemetryRange,
  TelemetrySample,
  TelemetrySeriesResponse,
} from "@/lib/system/telemetry/types";
export { TELEMETRY_RANGES } from "@/lib/system/telemetry/types";

const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(withBasePath(url), { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed with ${response.status}`);
  return data as T;
};

export function usePerformanceSeries(range: TelemetryRange) {
  return useSWR<TelemetrySeriesResponse>(
    `/api/system/performance/series?range=${encodeURIComponent(range)}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true },
  );
}

export function usePerformanceLatest() {
  return useSWR<TelemetryLatestResponse>("/api/system/performance/latest", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
}
