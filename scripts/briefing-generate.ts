import os from "os";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { generateBriefing } from "../src/lib/briefing/generate";
import { resolveBriefingTarget, type BriefingMode } from "../src/lib/briefing/target-file";

loadEnvConfig(process.cwd());

/**
 * Native Hilt briefing generator — the runtime that replaces the Hestia/Hermes cron.
 * Runs the vault gatherer, synthesizes via the `claude` CLI against the vault SKILL.md, validates
 * structure, writes the briefing, and (unless shadow/scratch) commits+pushes it.
 *
 *   npm run briefing:generate -- --mode daily
 *   npm run briefing:generate -- --mode weekend --date 2026-06-27
 *   npm run briefing:generate -- --mode auto            # daily Mon–Fri, weekend Sat/Sun
 *   npm run briefing:generate -- --mode auto --shadow   # write to $DATA_DIR/briefing-shadow, no commit
 *   npm run briefing:generate -- --mode daily --output /tmp/x.md   # explicit scratch path, no commit
 */
const args = process.argv.slice(2);
const argVal = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};

// --mode auto picks by today's weekday (local tz = ET on the runner), mirroring Hermes's two crons.
function resolveMode(raw: string): BriefingMode {
  if (raw === "auto") {
    const day = new Date().getDay(); // 0=Sun..6=Sat
    return day === 0 || day === 6 ? "weekend" : "daily";
  }
  return raw as BriefingMode;
}

const mode = resolveMode(argVal("--mode") || "daily");
if (mode !== "daily" && mode !== "weekend") {
  console.error(`invalid --mode "${argVal("--mode")}" (want daily|weekend|auto)`);
  process.exit(2);
}

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(process.env.HOME || "", "work/bridge");
const hiltRepoPath = process.env.BRIEFING_HILT_REPO_PATH || process.cwd();
const baseDate = argVal("--date") || new Date().toLocaleDateString("en-CA");

// --shadow: write the briefing under $DATA_DIR/briefing-shadow/ (mirroring the vault layout), never
// commit — the parallel "shadow run" that proves parity on live data before cutover, touching
// nothing real. An explicit --output also disables commit.
let outputOverride = argVal("--output");
if (!outputOverride && args.includes("--shadow")) {
  const dataDir = process.env.DATA_DIR || path.join(os.homedir(), ".hilt", "data");
  const rel = resolveBriefingTarget(vaultPath, mode, baseDate).relPath.replace(/^briefings\//, "");
  outputOverride = path.join(dataDir, "briefing-shadow", rel);
}

async function main(): Promise<void> {
  const result = await generateBriefing({
    vaultPath,
    hiltRepoPath,
    mode,
    date: baseDate,
    outputOverride,
    commit: !args.includes("--no-commit"),
    model: argVal("--model") || undefined,
    // --loops: the Briefings v2 reader variant (gather includes loop artifacts; SKILL's per-loop
    // rule activates on their presence). Shadow-v2 nightly uses this; live flips at Phase 8 cutover.
    loops: args.includes("--loops"),
    asOf: args.includes("--as-of-mode"),
  });

  console.log(JSON.stringify(result, (k, v) => (k === "validation" && v ? { pass: v.pass, bytes: v.bytes, failures: v.failures, warnings: v.warnings } : v), 2));

  if (result.status === "rate_limited") process.exit(3); // transient — retry-watch will pick it up
  if (result.status === "invalid") process.exit(1); // structural failure — do not treat as success
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
