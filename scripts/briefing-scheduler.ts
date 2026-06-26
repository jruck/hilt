/**
 * Briefing launchd scheduler — registers the `com.hilt.briefing.*` jobs via the shared
 * `runScheduler` helper (scripts/launchd-scheduler.ts), same as the library/semantic schedulers.
 *
 *   npm run briefing:scheduler:plan                      # dry-run (shadow variant)
 *   npm run briefing:scheduler:install                   # install the SHADOW job (default)
 *   npm run briefing:scheduler:install -- --variant live # install the LIVE job (cutover)
 *   npm run briefing:scheduler:uninstall                 # bootout + remove
 *
 * Default variant is "shadow" (safe: writes to $DATA_DIR/briefing-shadow, never commits, runs
 * alongside Hermes). Pass `--variant live` only at cutover, after parity holds and Hermes's
 * briefing crons are disabled.
 */
import { briefingSchedulerJobs, briefingSchedulerLogDir, type BriefingSchedulerVariant } from "../src/lib/briefing/scheduler-jobs";
import { runScheduler } from "./launchd-scheduler";

const argv = process.argv.slice(2);
const vIdx = argv.indexOf("--variant");
const variant = (vIdx >= 0 ? argv[vIdx + 1] : "shadow") as BriefingSchedulerVariant;
if (variant !== "shadow" && variant !== "live") {
  console.error(`invalid --variant "${variant}" (want shadow|live)`);
  process.exit(2);
}

const logDir = briefingSchedulerLogDir();
runScheduler({ feature: "briefing", jobs: briefingSchedulerJobs(variant, logDir), logDir, argv });
