import type { RawArtifact } from "./types";

interface OpenGraphMetadata {
  canonicalUrl?: string;
  description?: string;
  image?: string;
  title?: string;
}

interface FetchOpenGraphOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

interface MediaEnrichmentOptions extends FetchOpenGraphOptions {
  disabled?: boolean;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function attributeValue(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`, "i"));
  if (!match) return null;
  const raw = match[1].trim();
  const unquoted = (raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))
    ? raw.slice(1, -1)
    : raw;
  return decodeHtmlEntities(unquoted.trim());
}

function resolveMaybeUrl(value: string | null | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  if (/^data:/i.test(value) || /^javascript:/i.test(value)) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isUsableImageUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (/^data:/i.test(url)) return false;
  if (/\.svg(?:[?#].*)?$/i.test(url)) return false;
  return /^https?:\/\//i.test(url);
}

function metaTags(html: string): Array<{ key: string; content: string }> {
  const tags: Array<{ key: string; content: string }> = [];
  const regex = /<meta\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const key = attributeValue(attrs, "property") || attributeValue(attrs, "name") || attributeValue(attrs, "itemprop");
    const content = attributeValue(attrs, "content");
    if (key && content) tags.push({ key: key.toLowerCase(), content });
  }
  return tags;
}

function firstMeta(tags: Array<{ key: string; content: string }>, keys: string[]): string | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  return tags.find((tag) => wanted.has(tag.key))?.content;
}

function canonicalUrlFromHtml(html: string, baseUrl: string): string | undefined {
  const regex = /<link\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const rel = attributeValue(attrs, "rel");
    if (!rel || !rel.toLowerCase().split(/\s+/).includes("canonical")) continue;
    const href = resolveMaybeUrl(attributeValue(attrs, "href"), baseUrl);
    if (href) return href;
  }
  return undefined;
}

function firstImageFromHtml(html: string, baseUrl: string): string | undefined {
  const regex = /<img\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const candidate = resolveMaybeUrl(
      attributeValue(attrs, "src") || attributeValue(attrs, "data-src") || attributeValue(attrs, "data-original"),
      baseUrl,
    );
    if (isUsableImageUrl(candidate)) return candidate;
  }
  return undefined;
}

export function parseOpenGraphHtml(html: string, baseUrl: string): OpenGraphMetadata {
  const tags = metaTags(html);
  const image = resolveMaybeUrl(firstMeta(tags, [
    "og:image:secure_url",
    "og:image:url",
    "og:image",
    "twitter:image:src",
    "twitter:image",
  ]), baseUrl) || firstImageFromHtml(html, baseUrl);
  const title = firstMeta(tags, ["og:title", "twitter:title"]);
  const description = firstMeta(tags, ["og:description", "twitter:description", "description"]);
  const canonicalUrl = canonicalUrlFromHtml(html, baseUrl);

  return {
    canonicalUrl,
    description,
    image: isUsableImageUrl(image) ? image : undefined,
    title,
  };
}

export async function fetchOpenGraphMetadata(url: string, options: FetchOpenGraphOptions = {}): Promise<OpenGraphMetadata | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || Number(process.env.LIBRARY_MEDIA_FETCH_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Hilt Reference Library media enricher",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }
    const html = (await response.text()).slice(0, options.maxBytes || 700_000);
    return parseOpenGraphHtml(html, response.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cheap liveness check for a remote image URL — HEAD (falling back to a 1-byte ranged GET for servers
 * that reject HEAD). Returns false on any non-2xx/206, a non-image content-type, or network failure,
 * so a broken hero (e.g. a screenshot-render service that now 500s) can be replaced by OpenGraph media.
 */
async function isReachableImage(url: string, options: FetchOpenGraphOptions = {}): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return true; // local/relative — leave it alone
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || Number(process.env.LIBRARY_MEDIA_FETCH_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "user-agent": "Hilt Reference Library media enricher" };
  try {
    let response = await fetchImpl(url, { method: "HEAD", redirect: "follow", headers, signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(url, { method: "GET", redirect: "follow", headers: { ...headers, range: "bytes=0-0" }, signal: controller.signal });
    }
    if (!response.ok && response.status !== 206) return false;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("image/")) return true;
    // No content-type header: trust only if the URL itself looks like an image file.
    if (!contentType) return isUsableImageUrl(url);
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function metadataMedia(raw: RawArtifact): Array<Record<string, unknown>> {
  return Array.isArray(raw.metadata.media)
    ? raw.metadata.media.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) as Array<Record<string, unknown>>
    : [];
}

function firstMetadataImage(raw: RawArtifact): string | undefined {
  return metadataMedia(raw).find((item) => {
    const link = typeof item.link === "string" ? item.link : "";
    const type = typeof item.type === "string" ? item.type : "image";
    return type === "image" && isUsableImageUrl(link);
  })?.link as string | undefined;
}

function shouldFetchOpenGraph(raw: RawArtifact): boolean {
  if (!/^https?:\/\//i.test(raw.url)) return false;
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts/i.test(raw.url)) return false;
  if (/\.(png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(raw.url)) return false;
  return true;
}

export async function enrichRawArtifactMedia(
  raw: RawArtifact,
  options: MediaEnrichmentOptions = {},
): Promise<{ raw: RawArtifact; notes: string[] }> {
  if (options.disabled || process.env.LIBRARY_MEDIA_ENRICHMENT_DISABLED === "1") {
    return { raw, notes: [] };
  }

  const notes: string[] = [];
  let working = raw;

  // A present-but-broken thumbnail used to short-circuit the OpenGraph fallback below. Validate a
  // remote thumbnail first and drop it if it's unreachable / not an image, so the fallbacks can
  // supply a real hero (e.g. a Raindrop screenshot-render URL that now 500s on a 360-viewer page).
  if (working.thumbnail && shouldFetchOpenGraph(working) && !(await isReachableImage(working.thumbnail, options))) {
    notes.push("Captured thumbnail was unreachable; replacing with Open Graph media if available.");
    working = { ...working, thumbnail: undefined };
  }

  const mediaImage = firstMetadataImage(working);
  if (!working.thumbnail && mediaImage) {
    notes.push("Used source-provided media image as thumbnail.");
    return { raw: { ...working, thumbnail: mediaImage }, notes };
  }
  if (working.thumbnail || !shouldFetchOpenGraph(working)) {
    return { raw: working, notes };
  }

  const metadata = await fetchOpenGraphMetadata(working.url, options);
  if (!metadata?.image) return { raw: working, notes };

  const media = metadataMedia(working);
  const nextRaw: RawArtifact = {
    ...working,
    thumbnail: metadata.image,
    metadata: {
      ...working.metadata,
      canonical_url: typeof raw.metadata.canonical_url === "string" ? raw.metadata.canonical_url : metadata.canonicalUrl,
      og_description: typeof raw.metadata.og_description === "string" ? raw.metadata.og_description : metadata.description,
      og_image: metadata.image,
      og_title: typeof raw.metadata.og_title === "string" ? raw.metadata.og_title : metadata.title,
      media: [
        { link: metadata.image, type: "image", source: "open_graph" },
        ...media,
      ],
    },
  };
  notes.push("Used Open Graph media as representative image.");
  return { raw: nextRaw, notes };
}
