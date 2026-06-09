import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { findReweavePendingTargets } from "../src/lib/library/reweave-pending";

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
const includeCandidates = !args.includes("--saved-only");

interface RepairResult {
  path: string;
  status: "updated" | "skipped_error" | "rate_limited" | "error";
  reason?: string;
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
  const targets = findReweavePendingTargets(vaultPath, { includeCandidates, limit });
  const report = {
    write,
    vault: vaultPath,
    limit,
    timeout_ms: timeoutMs,
    include_candidates: includeCandidates,
    checked: targets.length,
    repaired: 0,
    failed: 0,
    targets,
    results: [] as RepairResult[],
  };

  if (!write) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const target of targets) {
    const result = await repairTarget(target.relative_path);
    report.results.push(result);
    if (result.status === "updated") report.repaired += 1;
    else report.failed += 1;
    if (result.status === "rate_limited") break;
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
