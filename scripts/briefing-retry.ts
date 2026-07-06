import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { generateBriefing } from "../src/lib/briefing/generate";
import { resolveBriefingTarget } from "../src/lib/briefing/target-file";

loadEnvConfig(process.cwd());

/**
 * Retry-watch — the safety net that mirrors Hermes's 30-min watcher. Runs every 30 min via launchd
 * (live variant only). If it's a weekday within the 06:30–17:00 ET window and TODAY's daily briefing
 * is still missing from the vault (the 06:00 run failed — token expiry, rate limit, crash), it
 * regenerates it. Silent no-op otherwise. Weekends are out of scope (the weekend file is the 06:00
 * job's job and is allowed to lag).
 */
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(process.env.HOME || "", "work/bridge");
const hiltRepoPath = process.env.BRIEFING_HILT_REPO_PATH || process.cwd();

async function main(): Promise<void> {
  const now = new Date(); // runner tz = ET
  const day = now.getDay();
  if (day === 0 || day === 6) return; // weekday-only
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 6 * 60 + 30 || minutes > 17 * 60) return; // 06:30–17:00 ET

  const date = now.toLocaleDateString("en-CA");
  let failed = false;

  const target = resolveBriefingTarget(vaultPath, "daily", date);
  if (!fs.existsSync(target.absPath)) {
    console.error(`[briefing-retry] ${date} daily (v1) missing — regenerating`);
    const result = await generateBriefing({ vaultPath, hiltRepoPath, mode: "daily", date });
    console.log(JSON.stringify({ retried: `${date} v1`, status: result.status }, null, 2));
    if (result.status === "invalid") failed = true;
  }

  // v2 shadow gets the same net (2026-07-06: v1 failed at 06:00 and was healed by 10:54 while
  // v2's identical failure sat dead all day — no toggle, no asks, no Compare).
  const dataDir = process.env.DATA_DIR || path.join(process.env.HOME || "", ".hilt", "data");
  const shadowPath = path.join(dataDir, "briefing-shadow", `${date}.md`);
  if (!fs.existsSync(shadowPath)) {
    console.error(`[briefing-retry] ${date} shadow (v2) missing — regenerating`);
    const result = await generateBriefing({
      vaultPath, hiltRepoPath, mode: "daily", date,
      outputOverride: shadowPath, loops: true,
    });
    console.log(JSON.stringify({ retried: `${date} v2`, status: result.status }, null, 2));
    if (result.status === "invalid") failed = true;
  }

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
