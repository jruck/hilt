import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, relativeVaultPath } from "../src/lib/library/markdown";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { captureFailed } from "../src/lib/library/capture-health";
import { walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const argValue = (name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};
const argValues = (name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
};

const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const write = args.includes("--write");
const force = args.includes("--force");
const limit = Number(argValue("--limit") || 50);
const X_VIDEO_RE = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/\s)'"<>]+\/status\/\d+\/video(?:\/\d+)?(?:[?#][^\s)'"<>]+)?/i;

interface XVideoTarget {
  relative_path: string;
  title: string;
  video_url: string;
  reason: string;
}

function isXVideoUrl(value: unknown): value is string {
  return typeof value === "string" && X_VIDEO_RE.test(value);
}

function rawContent(body: string): string {
  const section = body.split("## Raw Content")[1] || "";
  return section
    .replace(/\n## Source Notes[\s\S]*$/i, "")
    .replace(/<\/?details>|<summary>[\s\S]*?<\/summary>/gi, "")
    .trim();
}

function hasTranscriptMarkers(body: string): boolean {
  const raw = rawContent(body);
  return (raw.match(/^(?:-?\s*)?\[?\d{1,2}:\d{2}(?::\d{2})?\]?/gm) || []).length >= 5;
}

function findVideoUrl(data: Record<string, unknown>, body: string): string | null {
  if (isXVideoUrl(data.video_url)) return data.video_url.match(X_VIDEO_RE)?.[0] || data.video_url;
  if (isXVideoUrl(data.expanded_url)) return data.expanded_url.match(X_VIDEO_RE)?.[0] || data.expanded_url;
  return body.match(X_VIDEO_RE)?.[0] || null;
}

function needsTranscript(data: Record<string, unknown>, body: string): { needs: boolean; reason: string } {
  const extractor = typeof data.cached_source_extractor === "string" ? data.cached_source_extractor : "";
  const status = typeof data.x_video_transcript_status === "string" ? data.x_video_transcript_status : "";
  if (status === "unavailable_no_audio" || status === "unavailable_source") {
    return { needs: force, reason: force ? `forced_${status}` : status };
  }
  if (extractor === "x-video-subtitles" || extractor === "x-video-audio") {
    return { needs: force, reason: force ? "forced" : "already_transcribed" };
  }
  if (hasTranscriptMarkers(body)) return { needs: force, reason: force ? "forced_existing_timestamps" : "timestamped_raw_content" };
  return { needs: true, reason: extractor ? `cached_by_${extractor}` : "missing_cached_source" };
}

function scanTargets(): XVideoTarget[] {
  const pathArgs = argValues("--path");
  const files = pathArgs.length
    ? pathArgs.map((item) => path.isAbsolute(item) ? item : path.join(vaultPath, item))
    : [
      ...walkMarkdown(path.join(vaultPath, "references")),
      ...walkMarkdown(path.join(vaultPath, "references", ".archive"), { includeHidden: true }),
      ...walkMarkdown(path.join(vaultPath, CANDIDATE_CACHE_DIR), { includeHidden: true }),
    ];
  const seen = new Set<string>();
  const targets: XVideoTarget[] = [];
  for (const filePath of files) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let parsed: ReturnType<typeof parseMarkdownFile>;
    try {
      parsed = parseMarkdownFile(resolved);
    } catch {
      continue;
    }
    const { data, body } = parsed;
    if (data.type !== "reference" && data.type !== "reference-candidate") continue;
    if (data.type === "reference-candidate" && String(data.status || "candidate") !== "candidate") continue;
    const videoUrl = findVideoUrl(data, body);
    if (!videoUrl) continue;
    const need = needsTranscript(data, body);
    if (!need.needs) continue;
    targets.push({
      relative_path: relativeVaultPath(vaultPath, resolved),
      title: String(data.title || body.match(/^#\s+(.+)$/m)?.[1] || path.basename(resolved, ".md")),
      video_url: videoUrl,
      reason: need.reason,
    });
  }
  return targets.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

type XVideoOutcome = "transcribed" | "unavailable" | "still_missing" | "error";

async function redigestOne(target: XVideoTarget): Promise<XVideoOutcome> {
  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const prefix = tsxBin === "npx" ? ["tsx"] : [];
  try {
    await execFileAsync(tsxBin, [
      ...prefix,
      "scripts/library-redigest.ts",
      "--refetch",
      "--write",
      "--path",
      target.relative_path,
      "--limit",
      "1",
    ], {
      env: {
        ...process.env,
        BRIDGE_VAULT_PATH: vaultPath,
        LIBRARY_CONNECTIONS_DISABLED: "1",
      },
      timeout: Number(process.env.LIBRARY_X_VIDEO_BACKFILL_TIMEOUT_MS || 35 * 60_000),
      maxBuffer: 1024 * 1024 * 24,
    });
  } catch {
    return "error";
  }

  try {
    const after = parseMarkdownFile(path.join(vaultPath, target.relative_path));
    const extractor = typeof after.data.cached_source_extractor === "string" ? after.data.cached_source_extractor : "";
    if (extractor === "x-video-subtitles" || extractor === "x-video-audio") return "transcribed";
    const status = typeof after.data.x_video_transcript_status === "string" ? after.data.x_video_transcript_status : "";
    if (status === "unavailable_no_audio" || status === "unavailable_source") return "unavailable";
    if (captureFailed({ body: after.body, frontmatter: after.data })) return "still_missing";
    return "still_missing";
  } catch {
    return "error";
  }
}

async function main(): Promise<void> {
  const targets = scanTargets().slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  if (!write) {
    console.log(JSON.stringify({ dry_run: true, count: targets.length, targets }, null, 2));
    return;
  }

  let transcribed = 0;
  let unavailable = 0;
  let stillMissing = 0;
  let errors = 0;
  const results: Array<XVideoTarget & { outcome: string }> = [];
  for (const target of targets) {
    const outcome = await redigestOne(target);
    if (outcome === "transcribed") transcribed += 1;
    else if (outcome === "unavailable") unavailable += 1;
    else if (outcome === "still_missing") stillMissing += 1;
    else errors += 1;
    results.push({ ...target, outcome });
    console.error(`[x-video] ${outcome.toUpperCase().padEnd(14)} ${target.title.slice(0, 70)}`);
  }
  console.log(JSON.stringify({
    write,
    attempted: targets.length,
    transcribed,
    unavailable,
    still_missing: stillMissing,
    errors,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
