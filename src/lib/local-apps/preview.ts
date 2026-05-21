import fs from "fs";
import path from "path";
import { isPreviewCaptureEnabled, previewDir } from "./settings";
import type { Preview, Service } from "./types";

const AUTO_PREVIEW_LIMIT = 12;
const DEFAULT_CACHE_MS = 2 * 60 * 1000;

type PlaywrightChromium = {
  launch: (options: { headless: boolean }) => Promise<{
    newPage: (options: unknown) => Promise<{
      addStyleTag: (options: { content: string }) => Promise<unknown>;
      goto: (url: string, options: unknown) => Promise<unknown>;
      screenshot: (options: { path: string; fullPage: boolean }) => Promise<unknown>;
      close: () => Promise<unknown>;
    }>;
    close: () => Promise<unknown>;
  }>;
};

export function previewPathForService(serviceId: string): string {
  return path.join(previewDir(), `${serviceId}.png`);
}

export function isSafePreviewFilename(filename: string): boolean {
  return !filename.includes("/") && !filename.includes("\\") && filename.endsWith(".png");
}

export function attachCachedPreviews(services: Service[]): void {
  for (const service of services) {
    const preview = cachedPreview(previewPathForService(service.id));
    if (preview) service.preview = preview;
  }
}

export async function capturePreviewsNow(
  services: Service[],
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isPreviewCaptureEnabled()) return;
  const candidates = previewCandidates(services, !!options.force);
  if (candidates.length === 0) return;
  await capturePreviews(candidates);
}

function previewCandidates(services: Service[], force: boolean): Service[] {
  const candidates = services
    .filter((service) => service.visible && isPreviewableService(service) && (force || !service.preview))
    .slice(0, AUTO_PREVIEW_LIMIT);
  return candidates;
}

async function capturePreviews(services: Service[]): Promise<void> {
  const chromium = await loadChromium();
  if (!chromium) {
    for (const service of services) {
      writePreviewError(service, "Playwright is not installed");
    }
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const service of services) {
      const urls = previewCaptureUrls(service);
      if (urls.length === 0) continue;
      const outPath = previewPathForService(service.id);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      let lastError: unknown = null;
      try {
        for (const url of urls) {
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 8000 });
          } catch (error) {
            lastError = error;
            try {
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 });
            } catch (fallbackError) {
              lastError = fallbackError;
              continue;
            }
          }
          await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" }).catch(() => {});
          await page.screenshot({ path: outPath, fullPage: false });
          writePreviewSuccess(service, outPath);
          lastError = null;
          break;
        }
      } finally {
        await page.close();
      }
      if (lastError) writePreviewError(service, previewErrorMessage(lastError));
    }
  } finally {
    await browser.close();
  }
}

function cachedPreview(filePath: string): Preview | null {
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > previewCacheMs()) return null;
    return {
      path: filePath,
      captured_at: stat.mtime.toISOString(),
      error: null,
    };
  } catch {
    return null;
  }
}

function writePreviewError(service: Service, error: string): void {
  service.preview = {
    path: previewPathForService(service.id),
    captured_at: new Date().toISOString(),
    error,
  };
}

function writePreviewSuccess(service: Service, filePath: string): void {
  service.preview = {
    path: filePath,
    captured_at: new Date().toISOString(),
    error: null,
  };
}

export function isPreviewableService(service: Service): boolean {
  return (
    service.health.status === "up" &&
    service.health.http_status != null &&
    service.health.http_status >= 200 &&
    service.health.http_status < 400 &&
    previewCaptureUrls(service).length > 0
  );
}

export function previewCaptureUrls(service: Service): string[] {
  return [
    service.preview_url,
    service.health.url,
    ...service.url_candidates,
  ].filter((url): url is string => !!url && isHttpUrl(url))
    .filter(unique);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function unique(value: string, index: number, array: string[]): boolean {
  return array.indexOf(value) === index;
}

function previewCacheMs(): number {
  const raw = process.env.HILT_LOCAL_APPS_PREVIEW_CACHE_MS;
  if (!raw) return DEFAULT_CACHE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_MS;
}

function previewErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Preview capture failed";
  if (/executable doesn't exist|browser.*not found/i.test(error.message)) return "Playwright browser is not installed";
  if (/timeout/i.test(error.message)) return "Preview capture timed out";
  return "Preview capture failed";
}

async function loadChromium(): Promise<PlaywrightChromium | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ chromium?: unknown }>;
    const mod = await importer("playwright");
    return (mod.chromium || null) as PlaywrightChromium | null;
  } catch {
    return null;
  }
}
