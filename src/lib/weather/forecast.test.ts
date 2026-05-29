import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { getWeatherForecast, getWeatherLocation, normalizeOpenMeteoForecast, weatherConditionForCode } from "./forecast";
import type { WeatherLocation } from "./types";

const envKeys = [
  "HILT_WEATHER_FIXTURE_MODE",
  "HILT_WEATHER_POSTAL_CODE",
  "HILT_WEATHER_LATITUDE",
  "HILT_WEATHER_LONGITUDE",
  "HILT_WEATHER_LOCATION_LABEL",
  "HILT_WEATHER_TIMEZONE",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("weather forecast", () => {
  test("uses the 30310 Atlanta defaults", () => {
    for (const key of envKeys) delete process.env[key];
    const location = getWeatherLocation();

    assert.equal(location.postalCode, "30310");
    assert.equal(location.label, "Atlanta, GA");
    assert.equal(location.timezone, "America/New_York");
    assert.equal(location.latitude, 33.7269);
    assert.equal(location.longitude, -84.4289);
  });

  test("normalizes Open-Meteo daily forecast values", () => {
    const location: WeatherLocation = {
      postalCode: "30310",
      label: "Atlanta, GA",
      latitude: 33.7269,
      longitude: -84.4289,
      timezone: "America/New_York",
    };

    const forecast = normalizeOpenMeteoForecast(location, {
      daily: {
        time: ["2026-05-29", "bad-date"],
        weather_code: [61, 0],
        temperature_2m_max: [81.4, 82],
        temperature_2m_min: [67.2, 63],
        precipitation_probability_max: [55, null],
      },
    });

    assert.equal(forecast.days.length, 1);
    assert.equal(forecast.days[0].date, "2026-05-29");
    assert.equal(forecast.days[0].condition, "Rain");
    assert.equal(forecast.days[0].icon, "rain");
    assert.equal(forecast.days[0].highF, 81.4);
    assert.equal(forecast.days[0].lowF, 67.2);
    assert.equal(forecast.days[0].precipitationProbability, 55);
    assert.equal(forecast.days[0].detailsUrl.startsWith("https://forecast.weather.gov/MapClick.php"), true);
  });

  test("maps common WMO weather codes to compact calendar conditions", () => {
    assert.deepEqual(weatherConditionForCode(0), { label: "Clear sky", shortLabel: "Clear", icon: "sun" });
    assert.deepEqual(weatherConditionForCode(3), { label: "Overcast", shortLabel: "Cloudy", icon: "cloud" });
    assert.deepEqual(weatherConditionForCode(51), { label: "Drizzle", shortLabel: "Drizzle", icon: "drizzle" });
    assert.deepEqual(weatherConditionForCode(95), { label: "Thunderstorm", shortLabel: "Storms", icon: "storm" });
  });

  test("can return deterministic fixture days for app verification", async () => {
    process.env.HILT_WEATHER_FIXTURE_MODE = "1";
    const forecast = await getWeatherForecast("2026-05-24", "2026-05-30");

    assert.equal(forecast.days.length, 7);
    assert.deepEqual(forecast.days.map((day) => day.date), [
      "2026-05-24",
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ]);
    assert.equal(forecast.days.every((day) => day.detailsUrl.includes("forecast.weather.gov")), true);
  });
});
