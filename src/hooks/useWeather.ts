"use client";

import useSWR, { mutate as mutateCache } from "swr";
import type { WeatherForecastResponse } from "@/lib/weather/types";
import { withBasePath } from "@/lib/base-path";

export interface WeatherForecastQuery {
  start: string;
  end: string;
}

const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(withBasePath(url));
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
};

export function useWeatherForecast(query: WeatherForecastQuery | null) {
  return useSWR<WeatherForecastResponse>(query ? weatherForecastKey(query) : null, fetcher, {
    dedupingInterval: 30 * 60 * 1000,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
}

export async function prefetchWeatherForecast(query: WeatherForecastQuery): Promise<void> {
  const key = weatherForecastKey(query);
  await mutateCache(key, fetcher<WeatherForecastResponse>(key), { revalidate: false });
}

function weatherForecastKey(query: WeatherForecastQuery): string {
  const search = new URLSearchParams({
    start: query.start,
    end: query.end,
  });
  return `/api/weather/forecast?${search.toString()}`;
}
