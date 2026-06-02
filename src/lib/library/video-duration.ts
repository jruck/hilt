import { execFile } from "child_process";

/**
 * Video duration capture via the locally-installed `yt-dlp` (no API key required). Server-only —
 * this module shells out, so it must never be imported into a client bundle. Callers gate on
 * `isLikelyVideoUrl` (or a known `format: video`) and treat a `null` result as "unknown".
 */

const YT_DLP_BIN = process.env.YT_DLP_PATH || "yt-dlp";
const DEFAULT_TIMEOUT_MS = Number(process.env.LIBRARY_VIDEO_DURATION_TIMEOUT_MS || 30_000);

const VIDEO_HOST_RE = /(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv)$/i;

/** True for URLs whose host is a known video platform — the gate for attempting a duration fetch. */
export function isLikelyVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return VIDEO_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve a video's total duration in whole seconds via `yt-dlp --print duration`. Returns null on
 * any failure (binary missing, private/geo-blocked video, network error, non-numeric output, or
 * timeout) so the caller degrades gracefully to "no duration shown".
 */
export function getVideoDurationSeconds(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      YT_DLP_BIN,
      ["--no-warnings", "--no-playlist", "--skip-download", "--print", "%(duration)s", url],
      { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const first = String(stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        const seconds = Number(first);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          resolve(null);
          return;
        }
        resolve(Math.round(seconds));
      },
    );
  });
}
