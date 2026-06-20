"use client";

import useSWR from "swr";
import { withBasePath } from "@/lib/base-path";
import type { MercuryRange } from "@/lib/system/mercury";

// One sample row from the Mercury collector. All metric fields may be null.
export interface MercurySample {
  ts: number; // unix epoch seconds
  closet_temp_f: number | null;
  closet_humidity: number | null;
  closet_motion: string | null;
  room_temp_f: number | null;
  outdoor_temp_f: number | null;
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

export interface MercurySeriesResponse {
  columns: string[];
  rows: MercurySample[];
  generatedAt?: string | number;
}

export interface MercuryLatestResponse {
  sample: MercurySample | null;
  ageSeconds: number | null;
}

const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(withBasePath(url), { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed with ${response.status}`);
  return data as T;
};

export function useMercurySeries(range: MercuryRange) {
  return useSWR<MercurySeriesResponse>(
    `/api/system/mercury/series?range=${encodeURIComponent(range)}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true },
  );
}

export function useMercuryLatest() {
  return useSWR<MercuryLatestResponse>("/api/system/mercury/latest", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
}
