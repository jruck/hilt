import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseTimedTranscript } from "./transcript";
import type { SourceCache } from "./types";
import { isoNow } from "./utils";

const execFileAsync = promisify(execFile);

export type EmbeddedVideoProvider = "html5" | "youtube" | "vimeo" | "loom" | "wistia" | "mux" | "other";
export type EmbeddedVideoSource = "hint" | "video" | "source" | "iframe" | "meta" | "serialized";

export interface EmbeddedVideoCandidate {
  url: string;
  page_url: string;
  provider: EmbeddedVideoProvider;
  source: EmbeddedVideoSource;
}

export interface EmbeddedVideoTranscriptResult {
  status: "captured" | "not_found" | "skipped_short" | "unavailable_no_audio" | "failed";
  method?: "subtitles" | "audio";
  candidate?: EmbeddedVideoCandidate;
  title?: string;
  duration_seconds?: number;
  cache?: SourceCache;
  notes: string[];
}

interface EmbeddedVideoRecoveryOptions {
  fetchImpl?: typeof fetch;
  hintedUrls?: string[];
  onTranscriptionStart?: (candidate: EmbeddedVideoCandidate) => void | Promise<void>;
}

interface VideoProbe {
  title?: string;
  duration_seconds?: number;
  has_audio: boolean;
}

function numericEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function durationToMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;
  const unit = (match[2] || "s").toLowerCase();
  if (unit === "ms") return Math.max(1, Math.round(amount));
  if (unit === "m") return Math.max(1, Math.round(amount * 60_000));
  return Math.max(1, Math.round(amount * 1_000));
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
  const match = source.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s\"'>]+)`, "i"));
  if (!match) return null;
  const raw = match[1].trim();
  const unquoted = (raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))
    ? raw.slice(1, -1)
    : raw;
  return decodeHtmlEntities(unquoted.trim());
}

function resolveUrl(value: string | null | undefined, pageUrl: string): string | null {
  if (!value || /^data:|^javascript:|^blob:/i.test(value)) return null;
  try {
    const url = new URL(value, pageUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function vimeoId(url: string): string | null {
  return url.match(/player\.vimeo\.com\/video\/(\d+)/i)?.[1]
    || url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1]
    || null;
}

function providerForUrl(url: string): EmbeddedVideoProvider | null {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(hostname)) return "youtube";
  if (/(^|\.)vimeo\.com$/.test(hostname)) return "vimeo";
  if (/(^|\.)loom\.com$/.test(hostname)) return "loom";
  if (/(^|\.)(?:wistia\.com|wistia\.net)$/.test(hostname)) return "wistia";
  if (/(^|\.)(?:mux\.com|muxed\.dev)$/.test(hostname)) return "mux";
  if (/\.(?:m3u8|mp4|m4v|webm|mov)(?:[?#].*)?$/i.test(new URL(url).pathname)) return "html5";
  if (/(^|\.)(?:dailymotion\.com|streamable\.com|twitch\.tv)$/.test(hostname)) return "other";
  return null;
}

function normalizeCandidateUrl(url: string, provider: EmbeddedVideoProvider): string {
  if (provider === "vimeo") {
    const id = vimeoId(url);
    if (id) return `https://player.vimeo.com/video/${id}`;
  }
  return url;
}

function sourcePriority(source: EmbeddedVideoSource): number {
  if (source === "hint") return 6;
  if (source === "video" || source === "source") return 5;
  if (source === "iframe") return 4;
  if (source === "meta") return 3;
  return 2;
}

function addCandidate(
  candidates: EmbeddedVideoCandidate[],
  rawUrl: string | null | undefined,
  pageUrl: string,
  source: EmbeddedVideoSource,
): void {
  const resolved = resolveUrl(rawUrl, pageUrl);
  if (!resolved) return;
  const provider = providerForUrl(resolved);
  if (!provider) return;
  const url = normalizeCandidateUrl(resolved, provider);
  const existing = candidates.find((candidate) => candidate.url === url);
  if (existing) {
    if (sourcePriority(source) > sourcePriority(existing.source)) existing.source = source;
    return;
  }
  candidates.push({ url, page_url: pageUrl, provider, source });
}

function metaVideoUrls(html: string): string[] {
  const urls: string[] = [];
  const regex = /<meta\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  const keys = new Set(["og:video", "og:video:url", "og:video:secure_url", "twitter:player", "twitter:player:stream"]);
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const key = (attributeValue(attrs, "property") || attributeValue(attrs, "name") || "").toLowerCase();
    const content = attributeValue(attrs, "content");
    if (keys.has(key) && content) urls.push(content);
  }
  return urls;
}

/**
 * Extract primary video candidates from server-rendered HTML. Tags and metadata lead; the serialized
 * fallback covers frameworks that encode a video directive in flight/page data but do not render an
 * iframe until Play is clicked (Notion's Ship OS page is the motivating Vimeo case).
 */
export function discoverEmbeddedVideoCandidatesFromHtml(
  html: string,
  pageUrl: string,
  hintedUrls: string[] = [],
): EmbeddedVideoCandidate[] {
  const candidates: EmbeddedVideoCandidate[] = [];
  for (const hint of hintedUrls) addCandidate(candidates, hint, pageUrl, "hint");

  const videoRegex = /<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi;
  let videoMatch: RegExpExecArray | null;
  while ((videoMatch = videoRegex.exec(html)) !== null) {
    const attrs = videoMatch[1];
    const decorative = /(?:^|\s)muted(?:\s|=|$)/i.test(attrs) && /(?:^|\s)loop(?:\s|=|$)/i.test(attrs);
    if (!decorative) addCandidate(candidates, attributeValue(attrs, "src") || attributeValue(attrs, "data-src"), pageUrl, "video");
    const sourceRegex = /<source\b([^>]*)>/gi;
    let sourceMatch: RegExpExecArray | null;
    while ((sourceMatch = sourceRegex.exec(videoMatch[2])) !== null) {
      if (!decorative) addCandidate(candidates, attributeValue(sourceMatch[1], "src") || attributeValue(sourceMatch[1], "data-src"), pageUrl, "source");
    }
  }

  const iframeRegex = /<iframe\b([^>]*)>/gi;
  let iframeMatch: RegExpExecArray | null;
  while ((iframeMatch = iframeRegex.exec(html)) !== null) {
    addCandidate(candidates, attributeValue(iframeMatch[1], "src") || attributeValue(iframeMatch[1], "data-src"), pageUrl, "iframe");
  }
  for (const url of metaVideoUrls(html)) addCandidate(candidates, url, pageUrl, "meta");

  const directVimeo = /https?:\\?\/\\?\/(?:player\.)?vimeo\.com\\?\/(?:video\\?\/)?(\d{6,})/gi;
  let directMatch: RegExpExecArray | null;
  while ((directMatch = directVimeo.exec(html)) !== null) {
    addCandidate(candidates, `https://player.vimeo.com/video/${directMatch[1]}`, pageUrl, "serialized");
  }

  const notionVimeo = /["']host["']\s*\]\s*,\s*\[0\s*,\s*["']vimeo["']\s*\][\s\S]{0,500}?["']videoId["']\s*\]\s*,\s*\[0\s*,\s*["'](\d{6,})["']/gi;
  let notionMatch: RegExpExecArray | null;
  while ((notionMatch = notionVimeo.exec(html)) !== null) {
    addCandidate(candidates, `https://player.vimeo.com/video/${notionMatch[1]}`, pageUrl, "serialized");
  }

  return candidates.sort((a, b) => sourcePriority(b.source) - sourcePriority(a.source));
}

function proseSentenceCount(text: string): number {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => (sentence.match(/\b[A-Za-z]{3,}\b/g) || []).length >= 5)
    .length;
}

/** Cost gate: probe video only when normal capture is thin and the user explicitly saved the item. */
export function shouldAttemptEmbeddedVideoFallback(input: {
  pageUrl: string;
  capturedText: string;
  explicitSave: boolean;
  studyMode: boolean;
  alreadyVideo: boolean;
}): boolean {
  if (process.env.LIBRARY_EMBEDDED_VIDEO_TRANSCRIPT_DISABLED === "1") return false;
  if (!input.studyMode || input.alreadyVideo || !/^https?:\/\//i.test(input.pageUrl)) return false;
  if (!input.explicitSave && process.env.LIBRARY_EMBEDDED_VIDEO_DISCOVERY !== "1") return false;
  const text = input.capturedText.replace(/\s+/g, " ").trim();
  if (!text) return true;
  const maxChars = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_MAX_PROSE_CHARS, 2400);
  const maxSentences = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_MAX_PROSE_SENTENCES, 8);
  return text.length < maxChars && proseSentenceCount(text) < maxSentences;
}

async function fetchPageHtml(pageUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  const controller = new AbortController();
  const timeoutMs = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_PAGE_TIMEOUT_MS, 10_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(pageUrl, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Hilt Reference Library embedded-video detector",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
    return (await response.text()).slice(0, numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_PAGE_MAX_BYTES, 2_000_000));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function ytDlpBaseArgs(candidate: EmbeddedVideoCandidate): string[] {
  const args = ["--no-warnings", "--no-playlist", "--referer", candidate.page_url];
  const cookies = process.env.LIBRARY_EMBEDDED_VIDEO_YTDLP_COOKIES_FROM_BROWSER || process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (cookies) args.push("--cookies-from-browser", cookies);
  return args;
}

async function probeVideo(candidate: EmbeddedVideoCandidate): Promise<VideoProbe | null> {
  const ytDlpBin = process.env.YT_DLP_PATH || "yt-dlp";
  const timeoutValue = process.env.LIBRARY_EMBEDDED_VIDEO_PROBE_TIMEOUT || "60s";
  try {
    const { stdout } = await execFileAsync(ytDlpBin, [
      ...ytDlpBaseArgs(candidate),
      "--skip-download",
      "--dump-single-json",
      candidate.url,
    ], {
      timeout: durationToMs(timeoutValue, 60_000),
      maxBuffer: 1024 * 1024 * 12,
    });
    const parsed = JSON.parse(String(stdout)) as {
      title?: unknown;
      duration?: unknown;
      formats?: Array<{ vcodec?: unknown; acodec?: unknown; resolution?: unknown }>;
    };
    const formats = Array.isArray(parsed.formats) ? parsed.formats : [];
    const hasAudio = formats.some((format) => {
      const acodec = typeof format.acodec === "string" ? format.acodec : "";
      const vcodec = typeof format.vcodec === "string" ? format.vcodec : "";
      const resolution = typeof format.resolution === "string" ? format.resolution : "";
      return (acodec && acodec !== "none") || vcodec === "none" || /audio/i.test(resolution);
    });
    const duration = Number(parsed.duration);
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined,
      duration_seconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
      has_audio: hasAudio,
    };
  } catch {
    return null;
  }
}

function cleanSubtitleContent(content: string): string {
  const decoded = decodeHtmlEntities(content)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim())
    .join("\n");
  const segments = parseTimedTranscript(decoded);
  if (!segments.length) {
    return decoded
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^WEBVTT\b/i.test(line) && !/^\d+$/.test(line))
      .filter((line) => !/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\s+-->\s+/i.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const lines: string[] = [];
  for (const segment of segments) {
    const line = `[${segment.timestamp}] ${segment.text.trim()}`;
    if (segment.text.trim() && lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines.join("\n").trim();
}

async function readSubtitleTranscript(candidate: EmbeddedVideoCandidate): Promise<string | null> {
  const ytDlpBin = process.env.YT_DLP_PATH || "yt-dlp";
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-embedded-video-subs-"));
  const timeoutValue = process.env.LIBRARY_EMBEDDED_VIDEO_SUBTITLE_TIMEOUT || "90s";
  const maxCharacters = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_TRANSCRIPT_MAX_CHARS, 200_000);
  const minCharacters = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_TRANSCRIPT_MIN_CHARS, 120);
  try {
    await execFileAsync(ytDlpBin, [
      ...ytDlpBaseArgs(candidate),
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      process.env.LIBRARY_EMBEDDED_VIDEO_SUB_LANGS || "en,en.*",
      "--sub-format",
      "vtt",
      "-o",
      path.join(dir, "video.%(id)s.%(ext)s"),
      candidate.url,
    ], {
      timeout: durationToMs(timeoutValue, 90_000),
      maxBuffer: 1024 * 1024 * 6,
    });
    const files = (await fs.promises.readdir(dir)).filter((name) => name.endsWith(".vtt")).sort();
    for (const file of files) {
      const transcript = cleanSubtitleContent(await fs.promises.readFile(path.join(dir, file), "utf-8"))
        .slice(0, maxCharacters)
        .trim();
      if (transcript.length >= minCharacters) return transcript;
    }
    return null;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readAudioTranscript(candidate: EmbeddedVideoCandidate): Promise<string | null> {
  if (process.env.LIBRARY_EMBEDDED_VIDEO_AUDIO_TRANSCRIPT_DISABLED === "1") return null;
  const ytDlpBin = process.env.YT_DLP_PATH || "yt-dlp";
  const summarizeBin = process.env.SUMMARIZE_BIN || "summarize";
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-embedded-video-audio-"));
  const downloadTimeout = process.env.LIBRARY_EMBEDDED_VIDEO_AUDIO_DOWNLOAD_TIMEOUT || "10m";
  const transcriptTimeout = process.env.LIBRARY_EMBEDDED_VIDEO_AUDIO_TRANSCRIPT_TIMEOUT || "20m";
  const maxCharacters = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_TRANSCRIPT_MAX_CHARS, 200_000);
  const minCharacters = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_TRANSCRIPT_MIN_CHARS, 120);
  try {
    await execFileAsync(ytDlpBin, [
      ...ytDlpBaseArgs(candidate),
      "-f",
      "ba/bestaudio/best",
      "--extract-audio",
      "--audio-format",
      process.env.LIBRARY_EMBEDDED_VIDEO_AUDIO_FORMAT || "m4a",
      "--audio-quality",
      process.env.LIBRARY_EMBEDDED_VIDEO_AUDIO_QUALITY || "5",
      "-o",
      path.join(dir, "audio.%(ext)s"),
      candidate.url,
    ], {
      timeout: durationToMs(downloadTimeout, 10 * 60_000),
      maxBuffer: 1024 * 1024 * 10,
    });
    const file = (await fs.promises.readdir(dir)).find((name) => /\.(m4a|mp3|mp4|webm|aac|opus|wav)$/i.test(name));
    if (!file) return null;
    const { stdout } = await execFileAsync(summarizeBin, [
      path.join(dir, file),
      "--extract",
      "--plain",
      "--no-color",
      "--video-mode",
      "transcript",
      "--timeout",
      transcriptTimeout,
    ], {
      timeout: durationToMs(transcriptTimeout, 20 * 60_000) + 5_000,
      maxBuffer: 1024 * 1024 * 20,
    });
    const transcript = String(stdout).trim().slice(0, maxCharacters);
    return transcript.length >= minCharacters ? transcript : null;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function recoverEmbeddedVideoTranscript(
  pageUrl: string,
  options: EmbeddedVideoRecoveryOptions = {},
): Promise<EmbeddedVideoTranscriptResult> {
  const html = await fetchPageHtml(pageUrl, options.fetchImpl || globalThis.fetch);
  if (!html) return { status: "not_found", notes: ["Embedded-video fallback could not read the source page HTML."] };
  const candidates = discoverEmbeddedVideoCandidatesFromHtml(html, pageUrl, options.hintedUrls || []);
  if (!candidates.length) return { status: "not_found", notes: ["No recoverable primary video was detected in the source page."] };

  const minSeconds = numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_MIN_SECONDS, 20);
  let firstReachable: { candidate: EmbeddedVideoCandidate; probe: VideoProbe } | null = null;
  let transcriptionStarted = false;
  for (const candidate of candidates.slice(0, numericEnv(process.env.LIBRARY_EMBEDDED_VIDEO_MAX_CANDIDATES, 3))) {
    const probe = await probeVideo(candidate);
    if (!probe) continue;
    if (!firstReachable) firstReachable = { candidate, probe };
    if (probe.duration_seconds && probe.duration_seconds < minSeconds) continue;
    if (!transcriptionStarted) {
      transcriptionStarted = true;
      await options.onTranscriptionStart?.(candidate);
    }

    const subtitles = await readSubtitleTranscript(candidate);
    if (subtitles) {
      return {
        status: "captured",
        method: "subtitles",
        candidate,
        title: probe.title,
        duration_seconds: probe.duration_seconds,
        notes: [`Captured embedded ${candidate.provider} video transcript from subtitles.`],
        cache: {
          kind: "transcript",
          extractor: "embedded-video-subtitles",
          captured_at: isoNow(),
          content: subtitles,
          chars: subtitles.length,
        },
      };
    }
    if (!probe.has_audio) continue;
    const audio = await readAudioTranscript(candidate);
    if (audio) {
      return {
        status: "captured",
        method: "audio",
        candidate,
        title: probe.title,
        duration_seconds: probe.duration_seconds,
        notes: [`Captured embedded ${candidate.provider} video transcript from downloaded audio.`],
        cache: {
          kind: "transcript",
          extractor: "embedded-video-audio",
          captured_at: isoNow(),
          content: audio,
          chars: audio.length,
        },
      };
    }
  }

  if (firstReachable?.probe.duration_seconds && firstReachable.probe.duration_seconds < minSeconds) {
    return {
      status: "skipped_short",
      candidate: firstReachable.candidate,
      title: firstReachable.probe.title,
      duration_seconds: firstReachable.probe.duration_seconds,
      notes: [`Skipped embedded video shorter than ${minSeconds} seconds.`],
    };
  }
  if (firstReachable && !firstReachable.probe.has_audio) {
    return {
      status: "unavailable_no_audio",
      candidate: firstReachable.candidate,
      title: firstReachable.probe.title,
      duration_seconds: firstReachable.probe.duration_seconds,
      notes: ["Detected embedded video, but it had no usable subtitle or audio track."],
    };
  }
  return {
    status: "failed",
    candidate: firstReachable?.candidate || candidates[0],
    title: firstReachable?.probe.title,
    duration_seconds: firstReachable?.probe.duration_seconds,
    notes: ["Detected embedded video, but transcript extraction failed."],
  };
}
