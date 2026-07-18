import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "../src/lib/library/markdown";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { isoNow, walkMarkdown } from "../src/lib/library/utils";
import { captureFailed, NO_SOURCE_MARKER } from "../src/lib/library/capture-health";
import { LIBRARY_REFETCH_MAX_ATTEMPTS, libraryRefetchAttemptsPath } from "../src/lib/library/attention";
import { assertLibrarySummarizeInvocation } from "../src/lib/library/summarize-policy";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * The needs_refetch drain (Library v2, steering round 1 follow-through): a bounded daily pass that
 * retries the source capture for study items stuck in the needs_refetch bucket (the explicit
 * "No cached source content available" marker). Per item it runs the proven repair path
 * (scripts/library-redigest.ts --refetch) with LIBRARY_CONNECTIONS_DISABLED=1 — fetch + pinned-Claude
 * digest only, with the Connections pass deferred — and lets the degradation machinery flag `reweave_pending`, so the 03:35
 * nightly drain weaves recovered items inside its own budget. Attempts are capped per item (sidecar in
 * DATA_DIR): a permanently-paywalled source stops consuming fetches after the cap but stays visibly in
 * the bucket (honest state, no silent churn).
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/library-refetch.ts [--max-items 10] [--max-attempts 2] [--dry-run]
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const finiteArg = (name: string, fallback: number): number => {
  const raw = argValue(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) { console.error(`Invalid ${name}: "${raw}" — pass a number.`); process.exit(64); }
  return parsed;
};

const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const maxItems = Math.max(1, finiteArg("--max-items", 10));
const maxAttempts = Math.max(1, finiteArg("--max-attempts", LIBRARY_REFETCH_MAX_ATTEMPTS));
const dryRun = args.includes("--dry-run");


function attemptsPath(): string {
  const filePath = libraryRefetchAttemptsPath(vaultPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}

interface AttemptRecord { count: number; last_at: string }

function readAttempts(): Record<string, AttemptRecord> {
  try { return JSON.parse(fs.readFileSync(attemptsPath(), "utf-8")); } catch { return {}; }
}

interface RefetchTarget { relative_path: string; title: string }

/** Study items (saved + candidates) positively marked as having no captured source. */
function findBucket(): RefetchTarget[] {
  const targets: RefetchTarget[] = [];
  const roots = [path.join(vaultPath, "references"), path.join(vaultPath, CANDIDATE_CACHE_DIR)];
  for (const root of roots) {
    for (const filePath of walkMarkdown(root, { includeHidden: root.includes(".cache") })) {
      let parsed: ReturnType<typeof parseMarkdownFile>;
      try { parsed = parseMarkdownFile(filePath); } catch { continue; }
      const { data, body } = parsed;
      if (data.type !== "reference" && data.type !== "reference-candidate") continue;
      if (data.library_mode === "keep") continue;
      if (data.type === "reference-candidate" && String(data.status || "candidate") !== "candidate") continue;
      if (!captureFailed({ body, frontmatter: data })) continue;
      if (!data.url || !/^https?:\/\//.test(String(data.url))) continue;
      targets.push({ relative_path: relativeVaultPath(vaultPath, filePath), title: String(data.title || path.basename(filePath, ".md")) });
    }
  }
  return targets.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

/**
 * Wayback fallback (proven manually on the openai harness-engineering 403, 2026-06-10): when the
 * live fetch fails — paywall, bot-block, dead page — try the most recent archive.org snapshot.
 * The Wayback Machine doesn't bot-block, so this recovers exactly the class the live path can't.
 * On success the extract is cached into Raw Content with a `source_recovered_from` provenance
 * stamp, then a cache-preferring redigest rebuilds the digest from it.
 */
async function waybackRecover(relativePath: string): Promise<boolean> {
  const filePath = path.join(vaultPath, relativePath);
  let parsed: ReturnType<typeof parseMarkdownFile>;
  try { parsed = parseMarkdownFile(filePath); } catch { return false; }
  const { data, body } = parsed;
  const url = String(data.url || "");
  if (!/^https?:\/\//.test(url) || !body.includes(NO_SOURCE_MARKER)) return false;

  let snapshotUrl: string | null = null;
  try {
    const response = await fetch(`http://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) });
    const closest = ((await response.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } })?.archived_snapshots?.closest;
    if (closest?.available && typeof closest.url === "string") snapshotUrl = closest.url;
  } catch { return false; }
  if (!snapshotUrl) return false;

  const summarizeBin = process.env.SUMMARIZE_BIN || "summarize";
  let extract = "";
  try {
    const summarizeArgs = [snapshotUrl, "--extract", "--format", "md", "--plain", "--no-color", "--timeout", "90s"];
    assertLibrarySummarizeInvocation(summarizeArgs);
    const { stdout } = await execFileAsync(
      summarizeBin,
      summarizeArgs,
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 16 },
    );
    extract = stdout.trim();
  } catch { return false; }
  // A thin extract is usually the archive's own chrome or a captured error page — don't cache junk.
  if (extract.length < 800) return false;

  fs.writeFileSync(filePath, stringifyMarkdown(
    { ...data, source_recovered_from: snapshotUrl },
    body.replace(/No cached source content available\.?/, extract),
  ), "utf-8");

  // Cache-preferring redigest (no --refetch): rebuild the digest from the recovered text.
  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const prefix = tsxBin === "npx" ? ["tsx"] : [];
  try {
    await execFileAsync(
      tsxBin,
      [...prefix, "scripts/library-redigest.ts", "--write", "--path", relativePath, "--limit", "1"],
      { env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, LIBRARY_CONNECTIONS_DISABLED: "1" }, maxBuffer: 1024 * 1024 * 16, timeout: 420_000 },
    );
  } catch { return false; }
  return true;
}

async function refetchOne(relativePath: string): Promise<"recovered" | "still_failed" | "error"> {
  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const prefix = tsxBin === "npx" ? ["tsx"] : [];
  try {
    await execFileAsync(
      tsxBin,
      [...prefix, "scripts/library-redigest.ts", "--refetch", "--write", "--path", relativePath, "--limit", "1"],
      {
        env: {
          ...process.env,
          BRIDGE_VAULT_PATH: vaultPath,
          // Fetch + pinned-Claude digest only. The Connections pass is DEFERRED: digestion flags reweave_pending and
          // the 03:35 nightly drain weaves recovered items inside its own Claude budget.
          LIBRARY_CONNECTIONS_DISABLED: "1",
        },
        maxBuffer: 1024 * 1024 * 16,
        timeout: 420_000,
      },
    );
  } catch {
    return "error";
  }
  // Ground truth is the file itself: marker gone ⇒ a real source cache landed.
  try {
    const filePath = path.join(vaultPath, relativePath);
    let { data, body } = parseMarkdownFile(filePath);
    if (captureFailed({ body, frontmatter: data })) {
      // Live fetch failed — the wayback fallback gets one shot before this counts as a failure.
      if (!(await waybackRecover(relativePath))) return "still_failed";
      ({ data, body } = parseMarkdownFile(filePath));
      if (captureFailed({ body, frontmatter: data })) return "still_failed";
    }
    // A recovered item's existing connections were judged from STUB content — flag it for the
    // nightly weave drain so the connection pass reruns against the real source. (redigest's
    // mergeFrontmatter preserves old reconnected_at, which would otherwise hide it from the drain.)
    if (data.library_mode !== "keep") {
      data.reweave_pending = true;
      fs.writeFileSync(filePath, stringifyMarkdown(data, body), "utf-8");
    }
    return "recovered";
  } catch {
    return "error";
  }
}

async function main(): Promise<void> {
  const bucket = findBucket();
  const attempts = readAttempts();
  // Fresh items first (same rule as the reweave drain): a repeat-failer never hogs a bounded run.
  const eligible = bucket
    .filter((t) => (attempts[t.relative_path]?.count || 0) < maxAttempts)
    .sort((a, b) => (attempts[a.relative_path]?.count || 0) - (attempts[b.relative_path]?.count || 0));
  const exhausted = bucket.length - eligible.length;
  const worklist = eligible.slice(0, maxItems);

  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, bucket: bucket.length, eligible: eligible.length, exhausted, worklist }, null, 2));
    return;
  }

  let recovered = 0;
  let stillFailed = 0;
  let errors = 0;
  for (const target of worklist) {
    const outcome = await refetchOne(target.relative_path);
    if (outcome === "recovered") {
      recovered += 1;
      delete attempts[target.relative_path];
    } else {
      if (outcome === "still_failed") stillFailed += 1;
      else errors += 1;
      attempts[target.relative_path] = { count: (attempts[target.relative_path]?.count || 0) + 1, last_at: isoNow() };
    }
    console.error(`[refetch] ${outcome.toUpperCase().padEnd(12)} ${target.title.slice(0, 60)}`);
    fs.writeFileSync(attemptsPath(), `${JSON.stringify(attempts, null, 2)}\n`, "utf-8");
  }

  console.log(JSON.stringify({
    bucket: bucket.length,
    attempted: worklist.length,
    recovered,
    still_failed: stillFailed,
    errors,
    exhausted_skipped: exhausted,
    remaining_bucket: bucket.length - recovered,
    attempts_path: attemptsPath(),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
