import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { markLibraryArtifactsRead } from "../src/lib/library/read-state";
import { hashId } from "../src/lib/library/utils";
import { PIPELINE_VERSION, CURRENT_PIPELINE_VERSIONS } from "../src/lib/library/pipeline";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";

/**
 * Full-library backfill orchestrator: reanalyze every durable reference up to the current published
 * PIPELINE_VERSION (tracked from src/lib/library/pipeline). Parallel, resumable, and rate-limit-aware.
 *
 *   DATA_DIR=/Users/jruck/.hilt/data npx tsx scripts/library-backfill.ts --vault /Users/jruck/work/bridge
 *   ... --dry-run            # enumerate only, change nothing
 *   ... --limit 2            # reweave just N (smoke test)
 *   ... --concurrency 4      # starting worker count (auto-drops on limits, climbs back when clean)
 *   ... --include-candidates # also reweave references/.cache/library-candidates/ (the onion sweep)
 *
 * Worklist = every `type: reference` not yet at TARGET_VERSION, recomputed from disk — so it is
 * idempotent and a re-run resumes wherever it stopped. Items already at the prior decimal (v1.4) are
 * re-stamped without a reweave (identical protocol); everything else is reweaved via the tested
 * per-file path in library-reweave.ts (one prebuilt KB index shared via --kb-index-file). A worker that
 * hits a Claude usage limit exits 75; the pool pauses (exponential backoff, honoring a parsed reset
 * time), drops concurrency by one, and climbs back after a clean streak. Read-state baseline is
 * advanced at the end so the mass rewrite does not flood the New lane.
 */

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const has = (name: string): boolean => args.includes(name);
// Fail closed on garbage numbers: NaN fails every comparison, which silently disables the safety
// cap, the circuit breaker, and (for --concurrency) hangs the worker pool. Each item is a full
// agentic Claude run — a typo must not fall open into an unbounded burst.
const finiteArg = (name: string, fallback: number): number => {
  const raw = argValue(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) { console.error(`Invalid ${name}: "${raw}" — pass a number.`); process.exit(64); }
  return parsed;
};

const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const TARGET_VERSION = PIPELINE_VERSION; // tracks the live published version (was hardcoded "v2"); fresh reweaves are stamped with this.
// "Current" versions live in pipeline.ts now (shared with the health backlog metric so they never
// drift). An item at any of these is NOT re-reweaved when the live version bumps a decimal — the digest
// protocol is identical; v2.1 only adds the candidate path. Only versions outside this set get reweaved,
// so --include-candidates never mass-re-reweaves saved refs.
const CURRENT_VERSIONS = CURRENT_PIPELINE_VERSIONS;
const RESTAMP_FROM = "v1.4"; // same protocol as the target → re-stamp, do not reweave
// Default concurrency 1 (was 4): one agentic reweave at a time so a backfill can't burst the shared
// Claude Max window. Raise with --concurrency only against a known-idle window.
const startConcurrency = Math.max(1, finiteArg("--concurrency", 1));
const minConcurrency = Math.max(1, finiteArg("--min-concurrency", 1));
const limit = finiteArg("--limit", 0);
// Safety cap on items reweaved per run, so no single run dumps hundreds of calls into one window.
// --limit (smoke test) overrides it; pass a large --max-items for an explicit full sweep.
const maxItems = Math.max(1, finiteArg("--max-items", 50));
const dryRun = has("--dry-run");
const includeCandidates = has("--include-candidates");
const baseWaitMs = finiteArg("--base-wait-ms", 60_000);
const maxWaitMs = finiteArg("--max-wait-ms", 1_800_000);
const reweaveTimeoutMs = Number(process.env.LIBRARY_REWEAVE_TIMEOUT_MS || 600_000);
const RAMP_UP_STREAK = 10;

function relOf(file: string): string {
  return path.relative(vaultPath, file).split(path.sep).join("/");
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".cache") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * Returns the pipeline_version of a durable reference OR a reference-candidate (both are reweave
 * targets), "(unstamped)" if none, or null if the file is neither.
 */
function refVersion(file: string): string | null {
  let text: string;
  try { text = fs.readFileSync(file, "utf-8"); } catch { return null; }
  const fm = text.split(/^---$/m)[1] || "";
  if (!/^type:\s*reference(-candidate)?\s*$/m.test(fm)) return null;
  return (fm.match(/^pipeline_version:\s*(\S+)/m) || [])[1] || "(unstamped)";
}

/**
 * A study item that got only the L1 digest carries `reweave_pending: true` — it must be reweaved
 * regardless of its version stamp (it's "current" in version but missing its connections).
 */
function reweavePending(file: string): boolean {
  try {
    const fm = fs.readFileSync(file, "utf-8").split(/^---$/m)[1] || "";
    return /^reweave_pending:\s*true\s*$/m.test(fm);
  } catch { return false; }
}

const log = (msg: string): void => console.error(`[backfill ${new Date().toISOString()}] ${msg}`);

async function main(): Promise<void> {
  if (!process.env.DATA_DIR) {
    log("WARNING: DATA_DIR is not set — read-state will be written under cwd/data, not the live app dir. Set DATA_DIR.");
  }

  // 1. Enumerate + partition. walkMarkdown skips .cache, so candidates are collected separately and
  // only when --include-candidates is set (the v2.1 onion sweep). The ~5 unstamped saved refs that
  // never reached the saved backfill are folded in here too, since they fail the TARGET_VERSION check.
  const refs = walkMarkdown(path.join(vaultPath, "references")).filter((f) => refVersion(f) !== null);
  const candidates = includeCandidates
    ? walkMarkdown(path.join(vaultPath, CANDIDATE_CACHE_DIR)).filter((f) => refVersion(f) !== null)
    : [];
  const worklist = [...refs, ...candidates];
  const restampList: string[] = [];
  let reweaveList: string[] = [];
  let alreadyDone = 0;
  for (const f of worklist) {
    const v = refVersion(f);
    const pending = reweavePending(f); // current-version study items still missing connections
    if (v && CURRENT_VERSIONS.has(v) && !pending) alreadyDone++;
    else if (v === RESTAMP_FROM && !pending) restampList.push(f);
    else reweaveList.push(f);
  }
  const eligibleCount = reweaveList.length;
  const cap = limit > 0 ? limit : maxItems;
  if (reweaveList.length > cap) reweaveList = reweaveList.slice(0, cap);
  const deferred = eligibleCount - reweaveList.length;

  log(`durable refs: ${refs.length}${includeCandidates ? ` | candidates: ${candidates.length}` : ""} | already current (${[...CURRENT_VERSIONS].join("/")}): ${alreadyDone} | re-stamp ${RESTAMP_FROM}: ${restampList.length} | reweave: ${reweaveList.length}${deferred > 0 ? ` (cap ${cap}; ${deferred} deferred to next run)` : ""}`);

  if (dryRun) {
    log("dry-run: no changes. Sample reweave targets:");
    reweaveList.slice(0, 8).forEach((f) => console.error("   - " + relOf(f)));
    return;
  }

  const touchedIds: string[] = [];

  // 2. Re-stamp v1.4 → v2 (no reweave).
  for (const f of restampList) {
    const text = fs.readFileSync(f, "utf-8");
    fs.writeFileSync(f, text.replace(/^pipeline_version:\s*\S+\s*$/m, `pipeline_version: ${TARGET_VERSION}`), "utf-8");
    touchedIds.push(hashId(relOf(f)));
  }
  if (restampList.length) log(`re-stamped ${restampList.length} ${RESTAMP_FROM} → ${TARGET_VERSION}`);

  if (!reweaveList.length) {
    log("nothing to reweave.");
    finalize(touchedIds);
    return;
  }

  // 3. Shared KB index (built once).
  const kbFile = path.join(os.tmpdir(), `hilt-backfill-kb-${process.pid}.txt`);
  fs.writeFileSync(kbFile, buildKbIndex(vaultPath, { noWrite: true }), "utf-8");

  const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
  const tsxPrefix = tsxBin === "npx" ? ["tsx"] : [];

  // 4. Adaptive, rate-limit-aware worker pool.
  const queue = [...reweaveList];
  const retries = new Map<string, number>();
  const failed: string[] = [];
  let maxActive = startConcurrency;
  let active = 0;
  let pausedUntil = 0;
  let backoffMs = baseWaitMs;
  let okStreak = 0;
  let okCount = 0;
  // Circuit breaker: this many consecutive rate-limit pauses with ZERO successes in between means
  // the window is genuinely closed — stop cleanly instead of thrashing (each retry burns a full
  // agentic run). Resets on any success.
  const maxRateLimitPauses = Math.max(1, finiteArg("--max-rate-limit-pauses", 4));
  let consecutiveRateLimits = 0;
  let aborted = false;
  const total = reweaveList.length;

  function onRateLimit(resetAt: string | null): void {
    // Only escalate once per pause window — concurrent workers all hitting the wall shouldn't stack it.
    if (Date.now() < pausedUntil) return;
    consecutiveRateLimits += 1;
    backoffMs = Math.min(backoffMs * 2, maxWaitMs);
    let wait = backoffMs;
    if (resetAt) {
      const until = Date.parse(resetAt);
      if (Number.isFinite(until)) wait = Math.min(Math.max(until - Date.now() + 5_000, baseWaitMs), maxWaitMs);
    }
    pausedUntil = Date.now() + wait;
    maxActive = Math.max(minConcurrency, maxActive - 1);
    okStreak = 0;
    log(`RATE LIMIT ${consecutiveRateLimits}/${maxRateLimitPauses} — pausing ${Math.round(wait / 1000)}s, concurrency → ${maxActive}${resetAt ? ` (reset ${resetAt})` : ""}`);
  }

  async function runReweave(file: string): Promise<{ code: number; stderr: string }> {
    try {
      await execFileAsync(
        tsxBin,
        [...tsxPrefix, "scripts/library-reweave.ts", "--write", "--vault", vaultPath, "--path", file, "--kb-index-file", kbFile],
        {
          env: { ...process.env, LIBRARY_REWEAVE_RETHROW_RATELIMIT: "1", LIBRARY_REWEAVE_TIMEOUT_MS: String(reweaveTimeoutMs) },
          maxBuffer: 1024 * 1024 * 16,
          timeout: reweaveTimeoutMs + 30_000,
        },
      );
      return { code: 0, stderr: "" };
    } catch (error) {
      const e = error as { code?: number; stderr?: string };
      return { code: typeof e.code === "number" ? e.code : 1, stderr: e.stderr || "" };
    }
  }

  async function processOne(file: string): Promise<void> {
    const { code, stderr } = await runReweave(file);
    if (code === 75) {
      const resetAt = (stderr.match(/RESET_AT=(\S+)/) || [])[1] || null;
      onRateLimit(resetAt);
      queue.push(file); // requeue — not a failure
      return;
    }
    if (refVersion(file) === TARGET_VERSION) {
      okCount++; okStreak++;
      consecutiveRateLimits = 0;
      touchedIds.push(hashId(relOf(file)));
      if (okCount % 5 === 0 || okCount === total) {
        log(`progress: ${okCount}/${total} reweaved · ${failed.length} failed · conc ${maxActive}`);
      }
      if (okStreak >= RAMP_UP_STREAK && maxActive < startConcurrency) {
        maxActive += 1; backoffMs = baseWaitMs; okStreak = 0;
        log(`clean streak — concurrency → ${maxActive}`);
      }
    } else {
      const r = (retries.get(file) || 0) + 1;
      retries.set(file, r);
      if (r <= 2) { queue.push(file); }
      else { failed.push(file); log(`FAILED (gave up after ${r}): ${relOf(file)}`); }
    }
  }

  await new Promise<void>((resolve) => {
    const tick = async (): Promise<void> => {
      const now = Date.now();
      // Breaker tripped: let in-flight workers finish, schedule nothing new, stop cleanly.
      if (consecutiveRateLimits >= maxRateLimitPauses) {
        if (active === 0) {
          aborted = true;
          log(`CIRCUIT BREAKER: ${consecutiveRateLimits} consecutive rate-limit pauses with no successes — the window is closed. Stopping with ${queue.length} item(s) unprocessed; re-run against an idle window or let the nightly drain pick them up.`);
          resolve();
          return;
        }
      } else {
        while (active < maxActive && now >= pausedUntil && queue.length) {
          const file = queue.shift()!;
          active++;
          void processOne(file).finally(() => { active--; });
        }
      }
      if (!queue.length && active === 0) { resolve(); return; }
      setTimeout(() => void tick(), 250);
    };
    void tick();
  });

  fs.rmSync(kbFile, { force: true });
  log(`reweave ${aborted ? "aborted (window closed)" : "complete"}: ${okCount}/${total} succeeded · ${failed.length} failed${aborted ? ` · ${queue.length} unprocessed` : ""}`);
  if (failed.length) failed.forEach((f) => console.error("   FAILED: " + relOf(f)));
  finalize(touchedIds);
  if (aborted) process.exitCode = 75;
}

function finalize(touchedIds: string[]): void {
  const unique = Array.from(new Set(touchedIds));
  if (unique.length) {
    const { marked } = markLibraryArtifactsRead(vaultPath, unique);
    log(`marked ${marked} backfilled items read (so the rewrite doesn't flood the New lane).`);
  }
  log("done.");
}

main().catch((error) => { console.error(error); process.exit(1); });
