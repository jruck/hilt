import os from "os";
import path from "path";
import type { SchedulerJobSchedule } from "@/lib/library/scheduler-jobs";

/**
 * launchd job definitions for the native briefing runner, fed to the shared `runScheduler`
 * (scripts/launchd-scheduler.ts) — same machinery as the library/semantic schedulers.
 *
 * One 06:00-ET daily job whose npm script picks the mode by weekday (`--mode auto`: daily Mon–Fri,
 * weekend Sat/Sun) — avoids seven separate weekday plists. Two variants:
 *   - "shadow": runs `briefing:shadow` → writes to $DATA_DIR/briefing-shadow, never commits, runs
 *     ALONGSIDE Hermes for the parallel parity comparison (the safe pre-cutover state).
 *   - "live": runs `briefing:daily` (real vault path + commit/push) + a 30-min retry-watch that
 *     regenerates a missing day. Installed only at cutover, when Hermes's crons are disabled.
 */
export interface BriefingSchedulerJobDefinition {
  id: string;
  label: string;
  script: string;
  schedule: SchedulerJobSchedule;
  stdout: string;
  stderr: string;
}

export type BriefingSchedulerVariant = "shadow" | "live";

export function briefingSchedulerLogDir(): string {
  return path.join(os.homedir(), "Library", "Logs", "hilt-briefing");
}

export function briefingSchedulerJobs(
  variant: BriefingSchedulerVariant,
  logDir = briefingSchedulerLogDir(),
): BriefingSchedulerJobDefinition[] {
  const log = (name: string) => ({
    stdout: path.join(logDir, `${name}.out.log`),
    stderr: path.join(logDir, `${name}.err.log`),
  });
  if (variant === "shadow") {
    return [
      {
        id: "shadow",
        label: "com.hilt.briefing.shadow",
        script: "briefing:shadow",
        schedule: { hour: 6, minute: 0 },
        ...log("shadow"),
      },
    ];
  }
  return [
    {
      id: "daily",
      label: "com.hilt.briefing.daily",
      script: "briefing:daily",
      schedule: { hour: 6, minute: 0 },
      ...log("daily"),
    },
    {
      id: "retry",
      label: "com.hilt.briefing.retry",
      script: "briefing:retry",
      schedule: { intervalSeconds: 1800 },
      ...log("retry"),
    },
  ];
}
