import fs from "fs";
import path from "path";
import { isPreviewCaptureEnabled, previewDir } from "./settings";
import type { Preview, Service } from "./types";

const AUTO_PREVIEW_LIMIT = 12;
const CACHE_MS = 10 * 60 * 1000;

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

export function startPreviewCapture(services: Service[]): void {
  if (!isPreviewCaptureEnabled()) return;
  const candidates = services
    .filter((service) => service.visible && service.health.status === "up" && service.health.url && !service.preview)
    .slice(0, AUTO_PREVIEW_LIMIT);
  if (candidates.length === 0) return;

  void capturePreviews(candidates).catch((error) => {
    console.error("[local-apps/preview] capture failed:", error);
  });
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
      const url = service.health.url || service.url_candidates[0];
      if (!url) continue;
      const outPath = previewPathForService(service.id);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" }).catch(() => {});
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 8000 });
      } catch {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 });
      }
      await page.screenshot({ path: outPath, fullPage: false });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function cachedPreview(filePath: string): Preview | null {
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_MS) return null;
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

async function loadChromium(): Promise<PlaywrightChromium | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ chromium?: unknown }>;
    const mod = await importer("playwright");
    return (mod.chromium || null) as PlaywrightChromium | null;
  } catch {
    return null;
  }
}
