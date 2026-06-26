import path from "path";
import { loadEnvConfig } from "@next/env";
import { generateBriefing } from "../src/lib/briefing/generate";
import type { BriefingMode } from "../src/lib/briefing/target-file";

loadEnvConfig(process.cwd());

/**
 * Native Hilt briefing generator — the runtime that replaces the Hestia/Hermes cron.
 * Runs the vault gatherer, synthesizes via the `claude` CLI against the vault SKILL.md, validates
 * structure, writes the briefing, and commits+pushes it.
 *
 *   npm run briefing:generate -- --mode daily
 *   npm run briefing:generate -- --mode weekend --date 2026-06-27
 *   npm run briefing:generate -- --mode daily --output /tmp/shadow.md   # scratch, no commit
 */
const args = process.argv.slice(2);
const argVal = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};

const mode = (argVal("--mode") || "daily") as BriefingMode;
if (mode !== "daily" && mode !== "weekend") {
  console.error(`invalid --mode "${mode}" (want daily|weekend)`);
  process.exit(2);
}

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(process.env.HOME || "", "work/bridge");
const hiltRepoPath = process.env.BRIEFING_HILT_REPO_PATH || process.cwd();

async function main(): Promise<void> {
  const result = await generateBriefing({
    vaultPath,
    hiltRepoPath,
    mode,
    date: argVal("--date") || undefined,
    outputOverride: argVal("--output"),
    commit: !args.includes("--no-commit"),
    model: argVal("--model") || undefined,
  });

  console.log(JSON.stringify(result, (k, v) => (k === "validation" && v ? { pass: v.pass, bytes: v.bytes, failures: v.failures, warnings: v.warnings } : v), 2));

  if (result.status === "rate_limited") process.exit(3); // transient — retry-watch will pick it up
  if (result.status === "invalid") process.exit(1); // structural failure — do not treat as success
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
