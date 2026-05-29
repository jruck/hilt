export type WeatherIconKey = "sun" | "cloud-sun" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export interface WeatherLocation {
  postalCode: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface WeatherForecastDay {
  date: string;
  weatherCode: number;
  condition: string;
  shortCondition: string;
  icon: WeatherIconKey;
  highF: number;
  lowF: number;
  precipitationProbability: number | null;
  detailsUrl: string;
}

export interface WeatherForecastResponse {
  location: WeatherLocation;
  provider: {
    name: string;
    url: string;
  };
  generatedAt: string;
  days: WeatherForecastDay[];
}
