/**
 * Loops launchd scheduler — registers the `com.hilt.loops.*` jobs via the shared `runScheduler`
 * helper (ruling R10 pattern: same shape as library/semantic/briefing schedulers).
 *
 * Currently one job: the runtime loop (watchdog) at 05:45 — after the overnight chain
 * (03:35 reweave, 05:10 steering) and before gather (~06:00), so its artifact reflects the
 * night's outcomes in this morning's briefing.
 *
 *   npm run loops:scheduler:plan        # dry-run
 *   npm run loops:scheduler:install
 *   npm run loops:scheduler:uninstall
 */
import os from "os";
import path from "path";
import type { LibrarySchedulerJobDefinition } from "../src/lib/library/scheduler-jobs";
import { runScheduler } from "./launchd-scheduler";

function logDir(): string {
  return path.join(os.homedir(), "Library", "Logs", "hilt-loops");
}

function jobs(): LibrarySchedulerJobDefinition[] {
  const dir = logDir();
  return [
    {
      id: "runtime",
      label: "com.hilt.loops.runtime",
      script: "loops:runtime",
      schedule: { hour: 5, minute: 45 },
      stdout: path.join(dir, "runtime.out.log"),
      stderr: path.join(dir, "runtime.err.log"),
    },
    {
      // Meeting-actions extractor: after the day's meetings have landed + before the evening.
      // Runs again implicitly next morning for late transcripts (processed-set is idempotent).
      id: "meetings",
      label: "com.hilt.loops.meetings",
      script: "loops:meetings",
      schedule: { hour: 19, minute: 30 },
      stdout: path.join(dir, "meetings.out.log"),
      stderr: path.join(dir, "meetings.err.log"),
    },
    {
      // Goals/areas alignment: derived loop; runs after meetings loop, before the morning chain.
      id: "goals",
      label: "com.hilt.loops.goals",
      script: "loops:goals",
      schedule: { hour: 5, minute: 40 },
      stdout: path.join(dir, "goals.out.log"),
      stderr: path.join(dir, "goals.err.log"),
    },
  ];
}

runScheduler({ feature: "loops", jobs: jobs(), logDir: logDir() });
