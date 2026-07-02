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
  ];
}

runScheduler({ feature: "loops", jobs: jobs(), logDir: logDir() });
