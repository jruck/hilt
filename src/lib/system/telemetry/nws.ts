import * as fs from "fs";
import * as path from "path";
import {
  NWS_LAT,
  NWS_LON,
  NWS_USER_AGENT,
  WEATHER_CACHE_MS,
  getSourceTimeoutMs,
  getWeatherCachePath,
} from "./config";

// Outdoor temperature via the keyless NWS API (api.weather.gov). Aggregator-only —
// never travels an agent wire. Ported from mercury-observability lib/sources/weather.mjs:
// resolve the nearest observation station once (cached on disk), then poll its latest
// observation at most hourly, serving the cached value in between. Never throws.

interface WeatherCache {
  stationId?: string;
  outdoor_temp_f?: number;
  fetchedAt?: number;
}

const cToF = (c: number): number => (c * 9) / 5 + 32;

function readCache(): WeatherCache {
  try {
    return JSON.parse(fs.readFileSync(getWeatherCachePath(), "utf8")) as WeatherCache;
  } catch {
    return {};
  }
}

function writeCache(cache: WeatherCache): void {
  try {
    const p = getWeatherCachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn(`[telemetry] weather cache write failed: ${(err as Error)?.message ?? err}`);
  }
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json, application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function resolveStationId(signal: AbortSignal): Promise<string> {
  const points = (await getJson(`https://api.weather.gov/points/${NWS_LAT},${NWS_LON}`, signal)) as {
    properties?: { observationStations?: string };
  };
  const stationsUrl = points?.properties?.observationStations;
  if (!stationsUrl) throw new Error("no observationStations URL");
  const stations = (await getJson(stationsUrl, signal)) as {
    features?: Array<{ properties?: { stationIdentifier?: string } }>;
    observationStations?: string[];
  };
  const id = stations?.features?.[0]?.properties?.stationIdentifier ?? stations?.observationStations?.[0]?.split("/").pop();
  if (!id) throw new Error("no station id");
  return id;
}

async function fetchTempF(stationId: string, signal: AbortSignal): Promise<number | null> {
  const obs = (await getJson(`https://api.weather.gov/stations/${stationId}/observations/latest`, signal)) as {
    properties?: { temperature?: { value?: number | null } };
  };
  const tempC = obs?.properties?.temperature?.value;
  if (tempC == null) return null;
  return Math.round(cToF(tempC) * 10) / 10;
}

export async function readOutdoorTempF(nowMs = Date.now()): Promise<number | null> {
  const cache = readCache();
  if (typeof cache.outdoor_temp_f === "number" && typeof cache.fetchedAt === "number" && nowMs - cache.fetchedAt < WEATHER_CACHE_MS) {
    return cache.outdoor_temp_f;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getSourceTimeoutMs());
  try {
    let stationId = typeof cache.stationId === "string" ? cache.stationId : null;
    if (!stationId) stationId = await resolveStationId(controller.signal);

    let tempF = await fetchTempF(stationId, controller.signal);
    // Re-resolve once if a cached station id went stale.
    if (tempF === null && cache.stationId) {
      const freshId = await resolveStationId(controller.signal);
      if (freshId !== stationId) {
        stationId = freshId;
        tempF = await fetchTempF(stationId, controller.signal);
      }
    }

    if (tempF === null) {
      writeCache({ ...cache, stationId });
      return typeof cache.outdoor_temp_f === "number" ? cache.outdoor_temp_f : null;
    }
    writeCache({ stationId, outdoor_temp_f: tempF, fetchedAt: nowMs });
    return tempF;
  } catch (err) {
    console.warn(`[telemetry] outdoor fetch failed: ${(err as Error)?.message ?? err}`);
    return typeof cache.outdoor_temp_f === "number" ? cache.outdoor_temp_f : null;
  } finally {
    clearTimeout(timer);
  }
}
