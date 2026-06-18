import http from "http";
import https from "https";
import { applyHttpSignal, defaultHealth, probeUrls } from "./classifier";
import type { Service } from "./types";

interface HttpProbeResult {
  statusCode: number;
  statusMessage: string;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  latencyMs: number;
}

export async function probeServices(services: Service[]): Promise<void> {
  for (const service of services) {
    if (["database", "queue", "infra"].includes(service.kind)) {
      service.health = {
        ...defaultHealth(),
        status: "up",
        label: "Listening",
        checked_at: new Date().toISOString(),
      };
      continue;
    }

    if (service.url_candidates.length === 0 || (!service.visible && service.confidence < 20)) continue;
    await probeHttp(service);
    applyHttpSignal(service);
  }
}

async function probeHttp(service: Service): Promise<void> {
  let lastError: string | null = null;
  let lastResult: HttpProbeResult | null = null;
  for (const url of serviceProbeUrls(service)) {
    try {
      const result = await requestUrl(url);
      lastResult = result;
      if (result.statusCode >= 200 && result.statusCode < 400) {
        applyProbeResult(service, result, "up");
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      service.health = {
        ...defaultHealth(),
        status: "down",
        label: "No HTTP response",
        checked_at: new Date().toISOString(),
        error: lastError,
      };
    }
  }

  if (lastResult) {
    applyProbeResult(service, lastResult, "down");
  }
}

function serviceProbeUrls(service: Service): string[] {
  const urls = probeUrls(service);
  if (service.kind !== "backend") return urls;

  const expanded: string[] = [];
  for (const url of urls) {
    expanded.push(url);
    for (const pathName of ["/health", "/api/health"]) {
      try {
        expanded.push(new URL(pathName, url).toString());
      } catch {
        // Ignore malformed candidates; requestUrl will report the original.
      }
    }
  }
  return [...new Set(expanded)];
}

function applyProbeResult(service: Service, result: HttpProbeResult, status: "up" | "down"): void {
  service.health = {
    status,
    label: `${result.statusCode} ${result.statusMessage}`.trim(),
    http_status: result.statusCode,
    latency_ms: result.latencyMs,
    checked_at: new Date().toISOString(),
    error: null,
    url: result.finalUrl,
  };
  service.page_title = extractTitle(result.body);
  service.favicon_url = extractFavicon(result.body, result.finalUrl);
  service.framework_hints = frameworkHints(result.body, headerValue(result.headers["x-powered-by"]));
}

function requestUrl(url: string, redirects = 0): Promise<HttpProbeResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const started = Date.now();
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: "GET",
        timeout: 1500,
        rejectUnauthorized: false,
        headers: { "User-Agent": "Hilt Local Apps" },
      },
      (res) => {
        const location = headerValue(res.headers.location);
        if (location && [301, 302, 303, 307, 308].includes(res.statusCode || 0) && redirects < 5) {
          res.resume();
          const nextUrl = new URL(location, parsed).toString();
          requestUrl(nextUrl, redirects + 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          if (total >= 256 * 1024) return;
          chunks.push(chunk);
          total += chunk.length;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            statusMessage: res.statusMessage || "",
            finalUrl: parsed.toString(),
            headers: res.headers,
            body: Buffer.concat(chunks).subarray(0, 256 * 1024).toString("utf-8"),
            latencyMs: Date.now() - started,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("probe timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

export function extractTitle(body: string): string | null {
  const match = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlUnescape(match[1]).trim() || null : null;
}

export function extractFavicon(body: string, finalUrl: string): string | null {
  const link = body.match(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]*>/i)?.[0];
  const href = link?.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, finalUrl).toString();
  } catch {
    return null;
  }
}

export function frameworkHints(body: string, poweredBy?: string | null): string[] {
  const lower = body.toLowerCase();
  const hints = new Set<string>();
  if (poweredBy) hints.add(poweredBy);
  if (lower.includes("__next_data__")) hints.add("Next.js");
  if (lower.includes("/@vite/client") || lower.includes("vite")) hints.add("Vite");
  if (lower.includes("astro")) hints.add("Astro");
  if (lower.includes("remix")) hints.add("Remix");
  if (lower.includes("sveltekit")) hints.add("SvelteKit");
  if (lower.includes("storybook")) hints.add("Storybook");
  if (lower.includes("webpack")) hints.add("Webpack");
  if (lower.includes("rails")) hints.add("Rails");
  if (lower.includes("django")) hints.add("Django");
  if (lower.includes("flask")) hints.add("Flask");
  return [...hints].sort();
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function headerValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}
