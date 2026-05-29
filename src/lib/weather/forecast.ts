import type { WeatherForecastDay, WeatherForecastResponse, WeatherIconKey, WeatherLocation } from "./types";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const WEATHER_CACHE_MS = 30 * 60 * 1000;
const DEFAULT_POSTAL_CODE = "30310";
const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  postalCode: DEFAULT_POSTAL_CODE,
  label: "Atlanta, GA",
  latitude: 33.7269,
  longitude: -84.4289,
  timezone: "America/New_York",
};

interface CacheEntry {
  expiresAt: number;
  value: WeatherForecastResponse;
}

interface OpenMeteoDailyResponse {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: Array<number | null>;
  };
}

const forecastCache = new Map<string, CacheEntry>();

export async function getWeatherForecast(startDate: string, endDate: string): Promise<WeatherForecastResponse> {
  const location = getWeatherLocation();
  const cacheKey = `${location.latitude}:${location.longitude}:${location.timezone}:${startDate}:${endDate}`;
  const cached = forecastCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = process.env.HILT_WEATHER_FIXTURE_MODE === "1"
    ? fixtureForecast(location, startDate, endDate)
    : await fetchOpenMeteoForecast(location, startDate, endDate);

  forecastCache.set(cacheKey, { expiresAt: Date.now() + WEATHER_CACHE_MS, value });
  return value;
}

export function getWeatherLocation(): WeatherLocation {
  const postalCode = process.env.HILT_WEATHER_POSTAL_CODE?.trim() || DEFAULT_POSTAL_CODE;
  const latitude = parseCoordinate(process.env.HILT_WEATHER_LATITUDE) ?? DEFAULT_WEATHER_LOCATION.latitude;
  const longitude = parseCoordinate(process.env.HILT_WEATHER_LONGITUDE) ?? DEFAULT_WEATHER_LOCATION.longitude;
  return {
    postalCode,
    label: process.env.HILT_WEATHER_LOCATION_LABEL?.trim() || DEFAULT_WEATHER_LOCATION.label,
    latitude,
    longitude,
    timezone: process.env.HILT_WEATHER_TIMEZONE?.trim() || DEFAULT_WEATHER_LOCATION.timezone,
  };
}

export function normalizeOpenMeteoForecast(
  location: WeatherLocation,
  payload: OpenMeteoDailyResponse,
): WeatherForecastResponse {
  const daily = payload.daily;
  const times = daily?.time ?? [];
  const codes = daily?.weather_code ?? [];
  const highs = daily?.temperature_2m_max ?? [];
  const lows = daily?.temperature_2m_min ?? [];
  const precipitation = daily?.precipitation_probability_max ?? [];

  return {
    location,
    provider: {
      name: "Open-Meteo",
      url: "https://open-meteo.com/",
    },
    generatedAt: new Date().toISOString(),
    days: times.flatMap((date, index) => {
      const highF = highs[index];
      const lowF = lows[index];
      const weatherCode = codes[index];
      if (!isPlainDate(date) || typeof highF !== "number" || typeof lowF !== "number" || typeof weatherCode !== "number") {
        return [];
      }
      const condition = weatherConditionForCode(weatherCode);
      return [{
        date,
        weatherCode,
        condition: condition.label,
        shortCondition: condition.shortLabel,
        icon: condition.icon,
        highF,
        lowF,
        precipitationProbability: typeof precipitation[index] === "number" ? precipitation[index] : null,
        detailsUrl: weatherDetailsUrl(location),
      }];
    }),
  };
}

export function weatherConditionForCode(code: number): { label: string; shortLabel: string; icon: WeatherIconKey } {
  if (code === 0) return { label: "Clear sky", shortLabel: "Clear", icon: "sun" };
  if (code === 1) return { label: "Mainly clear", shortLabel: "Clear", icon: "cloud-sun" };
  if (code === 2) return { label: "Partly cloudy", shortLabel: "Partly", icon: "cloud-sun" };
  if (code === 3) return { label: "Overcast", shortLabel: "Cloudy", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", shortLabel: "Fog", icon: "fog" };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "Drizzle", shortLabel: "Drizzle", icon: "drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Rain", shortLabel: "Rain", icon: "rain" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Snow", shortLabel: "Snow", icon: "snow" };
  if ([95, 96, 99].includes(code)) return { label: "Thunderstorm", shortLabel: "Storms", icon: "storm" };
  return { label: "Forecast", shortLabel: "Forecast", icon: "cloud" };
}

export function isPlainDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function comparePlainDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function fetchOpenMeteoForecast(location: WeatherLocation, startDate: string, endDate: string): Promise<WeatherForecastResponse> {
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    return normalizeOpenMeteoForecast(location, await response.json() as OpenMeteoDailyResponse);
  } finally {
    clearTimeout(timeout);
  }
}

function fixtureForecast(location: WeatherLocation, startDate: string, endDate: string): WeatherForecastResponse {
  const codes = [0, 2, 51, 3, 61, 80, 1];
  const days: WeatherForecastDay[] = [];
  let date = startDate;
  let index = 0;
  while (comparePlainDates(date, endDate) <= 0) {
    const weatherCode = codes[index % codes.length];
    const condition = weatherConditionForCode(weatherCode);
    days.push({
      date,
      weatherCode,
      condition: condition.label,
      shortCondition: condition.shortLabel,
      icon: condition.icon,
      highF: 78 + (index % 5),
      lowF: 62 + (index % 4),
      precipitationProbability: weatherCode >= 51 ? 45 : 10,
      detailsUrl: weatherDetailsUrl(location),
    });
    date = addPlainDateDays(date, 1);
    index += 1;
  }

  return {
    location,
    provider: {
      name: "Open-Meteo fixture",
      url: "https://open-meteo.com/",
    },
    generatedAt: new Date().toISOString(),
    days,
  };
}

function weatherDetailsUrl(location: WeatherLocation): string {
  const url = new URL("https://forecast.weather.gov/MapClick.php");
  url.searchParams.set("lat", location.latitude.toFixed(4));
  url.searchParams.set("lon", location.longitude.toFixed(4));
  return url.toString();
}

function addPlainDateDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseCoordinate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
