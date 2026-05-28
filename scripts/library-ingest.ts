import { loadEnvConfig } from "@next/env";
import { expireCandidates } from "../src/lib/library/candidate-cache";
import { readDeadLetters } from "../src/lib/library/dead-letter";
import { getRecommendations } from "../src/lib/library/recommendations";
import { runIngestion } from "../src/lib/library/runner";
import { loadSources } from "../src/lib/library/source-config";
import { verifyLibraryAuth } from "../src/lib/library/auth";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const useSummarize = !args.includes("--no-summarize");
const dryRun = args.includes("--dry-run");
const ignoreState = args.includes("--ignore-state") || dryRun;

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function positionals(): string[] {
  const valueOptions = new Set(["--mode", "--limit"]);
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (valueOptions.has(arg) && index + 1 < args.length && !args[index + 1].startsWith("--")) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function mode(): string {
  const explicit = argValue("--mode");
  if (explicit) return explicit;
  const first = positionals()[0];
  return first && ["ingest", "hourly", "daily-newsletters", "backfill", "cleanup", "retry", "recommendations", "auth"].includes(first)
    ? first
    : "ingest";
}

function sourceIds(): string[] {
  const selectedMode = mode();
  return positionals().filter((arg) => arg !== selectedMode);
}

async function main() {
  const selectedMode = mode();

  if (selectedMode === "cleanup") {
    const expired = expireCandidates(vaultPath);
    console.log(JSON.stringify({ expired: expired.length, candidates: expired.map((candidate) => candidate.path) }, null, 2));
    return;
  }

  if (selectedMode === "recommendations") {
    const limit = Number(argValue("--limit") || 25);
    const recommendations = getRecommendations(vaultPath, limit);
    console.log(JSON.stringify(recommendations, null, 2));
    return;
  }

  if (selectedMode === "auth") {
    const limit = Number(argValue("--limit") || 1);
    const report = await verifyLibraryAuth(vaultPath, {
      sourceIds: sourceIds().length ? sourceIds() : undefined,
      live: !args.includes("--no-live"),
      limit,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (selectedMode === "retry") {
    const retrySourceIds = Array.from(new Set(readDeadLetters(vaultPath).map((entry) => entry.source_id))).filter(Boolean);
    if (!retrySourceIds.length) {
      console.log(JSON.stringify({ checked: 0, message: "No dead-letter sources to replay." }, null, 2));
      return;
    }
    const report = await runIngestion(vaultPath, { sourceIds: retrySourceIds, useSummarize, dryRun, ignoreState });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.blocked.length || report.errors.length ? 1 : 0;
    return;
  }

  let selectedSourceIds = sourceIds();
  if (selectedMode === "hourly") {
    selectedSourceIds = loadSources(vaultPath).filter((source) => source.enabled && source.cadence === "hourly").map((source) => source.id);
  } else if (selectedMode === "daily-newsletters") {
    selectedSourceIds = loadSources(vaultPath).filter((source) => source.enabled && source.channel === "email").map((source) => source.id);
  } else if (selectedMode === "backfill" && !selectedSourceIds.length) {
    selectedSourceIds = loadSources(vaultPath).filter((source) => source.enabled && source.backfill.enabled).map((source) => source.id);
  }

  const report = await runIngestion(vaultPath, {
    sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
    useSummarize,
    dryRun,
    ignoreState,
    useCursor: selectedMode === "backfill",
    limit: argValue("--limit") ? Number(argValue("--limit")) : undefined,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.blocked.length || report.errors.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
