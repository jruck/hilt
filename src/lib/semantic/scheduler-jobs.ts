/**
 * Semantic launchd job family (`com.hilt.semantic.*`) — a near-clone of
 * `src/lib/library/scheduler-jobs.ts` (ruling R10). Reuses the Library job-definition shape
 * and the shared plist/launchctl helper (`scripts/launchd-scheduler.ts`); only the labels,
 * scripts, schedules, and log dir differ. Three cadences from the plan §4:
 *
 *   cold-start  — one-time / RunAtLoad (not periodic): the initial backfill.
 *   refit       — BALANCED weekly global re-fit (default Sunday 03:30; weekday env-tunable).
 *   gc          — drop rows whose version != active_version after a blessing (daily 04:30).
 *
 * Every job runs an npm script that dispatches into `scripts/semantic-backfill.ts <mode>`,
 * and each short-circuits when `HILT_SEMANTIC_ENABLED` is off (so a stray installed plist is
 * a no-op when the feature is disabled).
 */

import os from "os";
import path from "path";
import type { LibrarySchedulerJobDefinition } from "@/lib/library/scheduler-jobs";
import { boundedInt } from "./config";

export function semanticSchedulerLogDir(): string {
  return path.join(os.homedir(), "Library", "Logs", "hilt-semantic");
}

/** Weekday (0=Sunday..6=Saturday) the BALANCED weekly re-fit runs on. */
export function semanticRefitWeekday(): number {
  return boundedInt(process.env.SEMANTIC_REFIT_WEEKDAY, 0, 0, 6);
}

export function semanticSchedulerJobs(logDir = semanticSchedulerLogDir()): LibrarySchedulerJobDefinition[] {
  return [
    {
      id: "cold-start",
      label: "com.hilt.semantic.cold-start",
      script: "semantic:backfill:cold",
      // Not periodic — fires once on load (the initial corpus embed). Idempotent + resumable,
      // so a re-load that finds an already-built cache is a near-no-op.
      schedule: { runAtLoad: true },
      stdout: path.join(logDir, "cold-start.out.log"),
      stderr: path.join(logDir, "cold-start.err.log"),
    },
    {
      id: "refit",
      label: "com.hilt.semantic.refit",
      script: "semantic:refit",
      // Weekly low-traffic slot — nightly is too churny for a BALANCED posture (plan §4).
      schedule: { hour: 3, minute: 30, weekday: semanticRefitWeekday() },
      stdout: path.join(logDir, "refit.out.log"),
      stderr: path.join(logDir, "refit.err.log"),
    },
    {
      id: "gc",
      label: "com.hilt.semantic.gc",
      script: "semantic:gc",
      // Daily sweep of superseded-version rows (only acts after a blessing flip).
      schedule: { hour: 4, minute: 30 },
      stdout: path.join(logDir, "gc.out.log"),
      stderr: path.join(logDir, "gc.err.log"),
    },
  ];
}
