// Config + server-side fetch helper for the Mercury observability dashboard.
//
// Mercury runs a standalone collector + web server on its tailnet IP (port 8787)
// that exposes /api/series and /api/latest. Hilt proxies those server-side (this
// module) so the renderer never makes a cross-origin call and the host stays off
// the client. The Mercury backend is owned by /Users/jruck/projects/mercury-observability
// and is NOT modified by Hilt.

const DEFAULT_MERCURY_API_URL = "http://mercury-v.tailc0acaa.ts.net:8787";
const MERCURY_TIMEOUT_MS = 8000;

/** Base URL of the Mercury dashboard API (override via MERCURY_API_URL). */
export function getMercuryApiBase(): string {
  return (process.env.MERCURY_API_URL || DEFAULT_MERCURY_API_URL).replace(/\/$/, "");
}

/**
 * Server-side GET against the Mercury API with a hard timeout. Returns parsed
 * JSON. Throws on non-2xx or transport failure (the API route maps to 502).
 */
export async function fetchMercuryJson<T>(path: string): Promise<T> {
  const url = `${getMercuryApiBase()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MERCURY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Mercury returned ${response.status}`;
      throw new Error(message);
    }
    if (data === null) throw new Error("Mercury returned no JSON");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export type MercuryRange = "6h" | "24h" | "7d" | "all";

export function isMercuryRange(value: string | null | undefined): value is MercuryRange {
  return value === "6h" || value === "24h" || value === "7d" || value === "all";
}
