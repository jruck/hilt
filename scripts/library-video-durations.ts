import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { getVideoDurationSeconds, isLikelyVideoUrl } from "../src/lib/library/video-duration";

/**
 * Backfill `video_duration_seconds` into existing Reference Library notes (saved refs + candidates)
 * for video sources, using yt-dlp. Dry-run by default; pass --write to apply. Idempotent — items that
 * already carry a duration are skipped unless --force.
 *
 *   npx tsx scripts/library-video-durations.ts                 # dry run, report what would change
 *   npx tsx scripts/library-video-durations.ts --write         # apply
 *   npx tsx scripts/library-video-durations.ts --write --limit 5 --force
 */

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write");
const force = args.includes("--force");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

const vaultPath = argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();
const limit = Number(argValue("--limit") || 0);
const sleepMs = Number(argValue("--sleep") || 250);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function frontmatterUrl(data: Record<string, unknown>): string | null {
  if (typeof data.url === "string") return data.url;
  if (typeof data.source === "string" && /^https?:\/\//.test(data.source)) return data.source;
  return null;
}

async function main(): Promise<void> {
  const files = walkMarkdown(path.join(vaultPath, "references"));
  const results: Array<{ path: string; status: string; seconds?: number }> = [];
  let processed = 0;

  for (const filePath of files) {
    if (limit && processed >= limit) break;
    const parsed = parseMarkdownFile(filePath);
    const data = parsed.data as Record<string, unknown>;
    const url = frontmatterUrl(data);
    const isVideo = data.format === "video" || isLikelyVideoUrl(url);
    if (!isVideo || !url) continue;
    if (typeof data.video_duration_seconds === "number" && !force) {
      results.push({ path: filePath, status: "skip_has_duration", seconds: data.video_duration_seconds });
      continue;
    }

    processed += 1;
    const seconds = await getVideoDurationSeconds(url);
    if (seconds == null) {
      results.push({ path: filePath, status: "unresolved" });
      console.error(`  ? could not resolve duration: ${path.relative(vaultPath, filePath)}`);
      if (sleepMs) await sleep(sleepMs);
      continue;
    }

    if (write) {
      const nextData = { ...data, video_duration_seconds: seconds };
      fs.writeFileSync(filePath, stringifyMarkdown(nextData, parsed.body), "utf-8");
      results.push({ path: filePath, status: "written", seconds });
      console.error(`  ✓ ${seconds}s → ${path.relative(vaultPath, filePath)}`);
    } else {
      results.push({ path: filePath, status: "dry_run", seconds });
      console.error(`  · ${seconds}s (dry run) → ${path.relative(vaultPath, filePath)}`);
    }
    if (sleepMs) await sleep(sleepMs);
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ write, vault: vaultPath, scanned: files.length, processed, counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
