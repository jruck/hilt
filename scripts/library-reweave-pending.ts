import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { findReweavePendingTargets } from "../src/lib/library/reweave-pending";
import { hashId } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const write = args.includes("--write");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

const vaultPath = argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();
const limit = Number(argValue("--limit") || process.env.LIBRARY_REWEAVE_PENDING_LIMIT || 3);
const timeoutMs = Number(argValue("--timeout-ms") || process.env.LIBRARY_REWEAVE_TIMEOUT_MS || 900_000);
// Fail closed on garbage: every backlog item is a full agentic Claude run, so a typo'd --limit must
// not silently fall open into an unbounded drain (NaN fails every numeric comparison).
if (!Number.isFinite(limit) || !Number.isFinite(timeoutMs)) {
  console.error(`Invalid --limit/--timeout-ms (${argValue("--limit")}, ${argValue("--timeout-ms")}) — pass numbers.`);
  process.exit(64);
}
const includeCandidates = !args.includes("--saved-only");
const includeVersionBehind = args.includes("--include-version-behind");

interface RepairResult {
  path: string;
  status: "updated" | "skipped_error" | "rate_limited" | "error";
  reason?: string;
  attempts?: number;
}

/**
 * Per-item failure counts, persisted in DATA_DIR (operational state, like read-state — never the
 * vault). Items that keep failing sink to the back of the worklist so a deterministic failure can
 * never permanently occupy the front slots of a bounded drain. rate_limited does NOT count against
 * an item — the window being closed is a global condition, not the item's fault.
 */
const attemptsDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-reweave-attempts");
const attemptsPath = path.join(attemptsDir, `${hashId(path.resolve(vaultPath), 16)}.json`);

function readAttempts(): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(attemptsPath, "utf-8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, count]) => typeof count === "number")) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeAttempts(map: Record<string, number>): void {
  fs.mkdirSync(attemptsDir, { recursive: true });
  fs.writeFileSync(attemptsPath, `${JSON.stringify(map, null, 2)}\n`, "utf-8");
}

function tsxCommand(): { bin: string; prefix: string[] } {
  if (fs.existsSync("node_modules/.bin/tsx")) return { bin: "node_modules/.bin/tsx", prefix: [] };
  return { bin: "npx", prefix: ["tsx"] };
}

function parseStatus(stdout: string): RepairResult["status"] {
  try {
    const parsed = JSON.parse(stdout.trim()) as { results?: Array<{ status?: string }> };
    const status = parsed.results?.[0]?.status;
    if (status === "updated") return "updated";
    return "skipped_error";
  } catch {
    return "skipped_error";
  }
}

async function repairTarget(relativePath: string): Promise<RepairResult> {
  const { bin, prefix } = tsxCommand();
  try {
    const { stdout } = await execFileAsync(
      bin,
      [...prefix, "scripts/library-reweave.ts", "--write", "--vault", vaultPath, "--path", relativePath],
      {
        env: {
          ...process.env,
          LIBRARY_REWEAVE_RETHROW_RATELIMIT: "1",
          LIBRARY_REWEAVE_TIMEOUT_MS: String(timeoutMs),
        },
        timeout: timeoutMs + 30_000,
        maxBuffer: 1024 * 1024 * 16,
      },
    );
    const status = parseStatus(stdout);
    return { path: relativePath, status, reason: status === "updated" ? undefined : "Reweave did not update the file." };
  } catch (error) {
    const err = error as { code?: number; stderr?: string; message?: string };
    const stderr = err.stderr || err.message || String(error);
    if (err.code === 75 || /RATE_LIMITED/.test(stderr)) {
      return { path: relativePath, status: "rate_limited", reason: stderr.trim() };
    }
    return { path: relativePath, status: "error", reason: stderr.trim() };
  }
}

async function main(): Promise<void> {
  // Fetch the FULL backlog, then order fresh-first by failure count (stable sort keeps the
  // oldest-first order within equal counts) BEFORE applying the limit — so a repeat-failing item
  // can't hog one of a bounded run's slots ahead of items that have never been tried.
  const attempts = readAttempts();
  const allTargets = findReweavePendingTargets(vaultPath, { includeCandidates, includeVersionBehind });
  const targets = allTargets
    .slice()
    .sort((a, b) => (attempts[a.relative_path] || 0) - (attempts[b.relative_path] || 0))
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  const report = {
    write,
    vault: vaultPath,
    limit,
    timeout_ms: timeoutMs,
    include_candidates: includeCandidates,
    include_version_behind: includeVersionBehind,
    backlog: allTargets.length,
    checked: targets.length,
    repaired: 0,
    failed: 0,
    attempts_path: attemptsPath,
    targets,
    results: [] as RepairResult[],
  };

  if (!write) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const target of targets) {
    const result = await repairTarget(target.relative_path);
    if (result.status === "updated") {
      report.repaired += 1;
      delete attempts[target.relative_path];
    } else {
      report.failed += 1;
      // rate_limited is a global window condition, not the item's fault — don't count it.
      if (result.status !== "rate_limited") {
        attempts[target.relative_path] = (attempts[target.relative_path] || 0) + 1;
      }
    }
    result.attempts = attempts[target.relative_path];
    report.results.push(result);
    // A real usage limit means the window is closed for EVERYTHING — stop cleanly, never thrash.
    // Per-item failures keep going; the next target may well succeed.
    if (result.status === "rate_limited") break;
  }

  // Prune counts for items that left the backlog some other way (completed elsewhere, muted, deleted).
  // Always prune against the WIDEST backlog scope — a narrower invocation (--saved-only, no
  // --include-version-behind) must not wipe counts for items it merely isn't looking at.
  const widestTargets = includeCandidates && includeVersionBehind
    ? allTargets
    : findReweavePendingTargets(vaultPath, { includeCandidates: true, includeVersionBehind: true });
  const live = new Set(widestTargets.map((target) => target.relative_path));
  for (const key of Object.keys(attempts)) {
    if (!live.has(key)) delete attempts[key];
  }
  writeAttempts(attempts);

  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
