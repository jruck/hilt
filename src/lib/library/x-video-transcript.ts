import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { SourceCache } from "./types";
import { parseTimedTranscript } from "./transcript";
import { isoNow } from "./utils";

const execFileAsync = promisify(execFile);

export interface XVideoTranscriptResult {
  cache?: SourceCache;
  method?: "subtitles" | "audio";
  status: "captured" | "unavailable_no_audio" | "unavailable_source" | "failed";
  notes: string[];
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

function numericEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function ytDlpBaseArgs(): string[] {
  const args = ["--no-warnings", "--no-playlist"];
  const cookiesFromBrowser = process.env.LIBRARY_X_YTDLP_COOKIES_FROM_BROWSER || process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (cookiesFromBrowser) args.push("--cookies-from-browser", cookiesFromBrowser);
  return args;
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

function stripCaptionMarkup(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function cleanXVideoSubtitleContent(content: string): string {
  const withoutMarkup = content
    .replace(/\r/g, "")
    .split("\n")
    .map(stripCaptionMarkup)
    .join("\n");
  const segments = parseTimedTranscript(withoutMarkup);
  if (!segments.length) {
    return withoutMarkup
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
    const text = segment.text.trim();
    const previous = lines[lines.length - 1] || "";
    if (!text || previous.endsWith(`] ${text}`)) continue;
    lines.push(`[${segment.timestamp}] ${text}`);
  }
  return lines.join("\n").trim();
}

async function readSubtitleTranscript(url: string): Promise<string | null> {
  const ytDlpBin = process.env.YT_DLP_PATH || "yt-dlp";
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-x-video-subs-"));
  const timeoutValue = process.env.LIBRARY_X_VIDEO_SUBTITLE_TIMEOUT || "90s";
  const maxCharacters = numericEnv(process.env.LIBRARY_X_VIDEO_TRANSCRIPT_MAX_CHARS, 200000);
  try {
    await execFileAsync(ytDlpBin, [
      ...ytDlpBaseArgs(),
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      process.env.LIBRARY_X_VIDEO_SUB_LANGS || "en,en.*",
      "--sub-format",
      "vtt",
      "-o",
      path.join(dir, "x-video.%(id)s.%(ext)s"),
      url,
    ], {
      timeout: durationToMs(timeoutValue, 90_000),
      maxBuffer: 1024 * 1024 * 4,
    });

    const files = (await fs.promises.readdir(dir))
      .filter((name) => name.endsWith(".vtt"))
      .sort();
    for (const file of files) {
      const cleaned = cleanXVideoSubtitleContent(await fs.promises.readFile(path.join(dir, file), "utf-8"))
        .slice(0, maxCharacters)
        .trim();
      if (cleaned.length >= numericEnv(process.env.LIBRARY_X_VIDEO_TRANSCRIPT_MIN_CHARS, 120)) {
        return cleaned;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function inspectVideo(url: string): Promise<{ hasAudio: boolean; unavailableReason?: string } | null> {
  const ytDlpBin = process.env.YT_DLP_PATH || "yt-dlp";
  const timeoutValue = process.env.LIBRARY_X_VIDEO_PROBE_TIMEOUT || "60s";
  try {
    const { stdout } = await execFileAsync(ytDlpBin, [
      ...ytDlpBaseArgs(),
      "--skip-download",
      "--dump-single-json",
      url,
    ], {
      timeout: durationToMs(timeoutValue, 60_000),
      maxBuffer: 1024 * 1024 * 8,
    });
    const parsed = JSON.parse(String(stdout)) as {
      formats?: Array<{ vcodec?: string; acodec?: string; resolution?: string }>;
      subtitles?: Record<string, unknown>;
      automatic_captions?: Record<string, unknown>;
    };
    const formats = parsed.formats || [];
    const hasAudio = formats.some((format) => {
      const acodec = typeof format.acodec === "string" ? format.acodec : "";
      const vcodec = typeof format.vcodec === "string" ? format.vcodec : "";
      const resolution = typeof format.resolution === "string" ? format.resolution : "";
      return (acodec && acodec !== "none") || vcodec === "none" || /audio/i.test(resolution);
    });
    return { hasAudio };
  } catch (error) {
    const detail = `${(error as { stderr?: string }).stderr || ""} ${(error as Error).message || ""}`.trim();
    if (/suspended|unavailable|private|not available|deleted/i.test(detail)) {
      return { hasAudio: false, unavailableReason: detail.replace(/\s+/g, " ").slice(0, 240) };
    }
    return null;
  }
}

async function runSummarize(args: string[], timeoutValue: string, maxBuffer: number): Promise<string | null> {
  const summarizeBin = process.env.SUMMARIZE_BIN || "summarize";
  try {
    const { stdout } = await execFileAsync(summarizeBin, args, {
      timeout: durationToMs(timeoutValue, 15 * 60_000) + 5000,
      maxBuffer,
    });
    const content = stdout.trim();
    return content || null;
  } catch {
    return null;
  }
}

async function readAudioTranscript(url: string): Promise<string | null> {
  if (process.env.LIBRARY_X_VIDEO_AUDIO_TRANSCRIPT_DISABLED === "1") return null;
  const ytDlpBin = process.env.YT_DLP_PATH || "yt-dlp";
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-x-video-audio-"));
  const downloadTimeout = process.env.LIBRARY_X_VIDEO_AUDIO_DOWNLOAD_TIMEOUT || "10m";
  const transcriptTimeout = process.env.LIBRARY_X_VIDEO_AUDIO_TRANSCRIPT_TIMEOUT || "20m";
  const maxCharacters = String(numericEnv(process.env.LIBRARY_X_VIDEO_TRANSCRIPT_MAX_CHARS, 200000));
  try {
    await execFileAsync(ytDlpBin, [
      ...ytDlpBaseArgs(),
      "-f",
      "ba/bestaudio/best",
      "--extract-audio",
      "--audio-format",
      process.env.LIBRARY_X_VIDEO_AUDIO_FORMAT || "m4a",
      "--audio-quality",
      process.env.LIBRARY_X_VIDEO_AUDIO_QUALITY || "5",
      "-o",
      path.join(dir, "x-video-audio.%(ext)s"),
      url,
    ], {
      timeout: durationToMs(downloadTimeout, 10 * 60_000),
      maxBuffer: 1024 * 1024 * 8,
    });

    const files = (await fs.promises.readdir(dir))
      .filter((name) => /\.(m4a|mp3|mp4|webm|aac|opus|wav)$/i.test(name))
      .sort();
    const audioPath = files[0] ? path.join(dir, files[0]) : null;
    if (!audioPath) return null;

    const transcript = await runSummarize([
      audioPath,
      "--extract",
      "--plain",
      "--no-color",
      "--video-mode",
      "transcript",
      "--timestamps",
      "--transcriber",
      process.env.LIBRARY_X_VIDEO_TRANSCRIBER || process.env.SUMMARIZE_TRANSCRIBER || "auto",
      "--max-extract-characters",
      maxCharacters,
      "--timeout",
      transcriptTimeout,
    ], transcriptTimeout, 1024 * 1024 * 16);
    if (!transcript || transcript.length < numericEnv(process.env.LIBRARY_X_VIDEO_TRANSCRIPT_MIN_CHARS, 120)) return null;
    return transcript.trim();
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractXVideoTranscript(url: string): Promise<XVideoTranscriptResult | null> {
  if (process.env.LIBRARY_X_VIDEO_TRANSCRIPT_DISABLED === "1") return null;

  const subtitleTranscript = await readSubtitleTranscript(url);
  if (subtitleTranscript) {
    return {
      status: "captured",
      method: "subtitles",
      notes: ["Captured X video transcript from yt-dlp subtitles."],
      cache: {
        kind: "transcript",
        extractor: "x-video-subtitles",
        captured_at: isoNow(),
        content: subtitleTranscript,
        chars: subtitleTranscript.length,
      },
    };
  }

  const inspected = await inspectVideo(url);
  if (inspected && !inspected.hasAudio) {
    const reason = inspected.unavailableReason
      ? `X video transcript unavailable: ${inspected.unavailableReason}`
      : "X video has no subtitle or audio track available to transcribe.";
    return {
      status: inspected.unavailableReason ? "unavailable_source" : "unavailable_no_audio",
      notes: [reason],
    };
  }

  const audioTranscript = await readAudioTranscript(url);
  if (audioTranscript) {
    return {
      status: "captured",
      method: "audio",
      notes: ["Captured X video transcript from downloaded audio transcription."],
      cache: {
        kind: "transcript",
        extractor: "x-video-audio",
        captured_at: isoNow(),
        content: audioTranscript,
        chars: audioTranscript.length,
      },
    };
  }

  return {
    status: "failed",
    notes: ["X video transcript was unavailable; capture remains video-metadata-limited."],
  };
}
