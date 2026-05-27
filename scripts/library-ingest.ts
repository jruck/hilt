import { expireCandidates } from "../src/lib/library/candidate-cache";
import { readDeadLetters } from "../src/lib/library/dead-letter";
import { getRecommendations } from "../src/lib/library/recommendations";
import { runIngestion } from "../src/lib/library/runner";
import { loadSources } from "../src/lib/library/source-config";

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const useSummarize = !args.includes("--no-summarize");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function mode(): string {
  const explicit = argValue("--mode");
  if (explicit) return explicit;
  const first = args.find((arg) => !arg.startsWith("--"));
  return first && ["ingest", "hourly", "daily-newsletters", "cleanup", "retry", "recommendations"].includes(first)
    ? first
    : "ingest";
}

function sourceIds(): string[] {
  const selectedMode = mode();
  return args.filter((arg) => !arg.startsWith("--") && arg !== selectedMode);
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

  if (selectedMode === "retry") {
    const retrySourceIds = Array.from(new Set(readDeadLetters(vaultPath).map((entry) => entry.source_id))).filter(Boolean);
    if (!retrySourceIds.length) {
      console.log(JSON.stringify({ checked: 0, message: "No dead-letter sources to replay." }, null, 2));
      return;
    }
    const report = await runIngestion(vaultPath, { sourceIds: retrySourceIds, useSummarize });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.blocked.length || report.errors.length ? 1 : 0;
    return;
  }

  let selectedSourceIds = sourceIds();
  if (selectedMode === "hourly") {
    selectedSourceIds = loadSources(vaultPath).filter((source) => source.enabled && source.cadence === "hourly").map((source) => source.id);
  } else if (selectedMode === "daily-newsletters") {
    selectedSourceIds = loadSources(vaultPath).filter((source) => source.enabled && source.channel === "email").map((source) => source.id);
  }

  const report = await runIngestion(vaultPath, {
    sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
    useSummarize,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.blocked.length || report.errors.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
