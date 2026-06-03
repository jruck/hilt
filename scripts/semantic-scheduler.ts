/**
 * Semantic launchd scheduler — registers the `com.hilt.semantic.*` jobs (cold-start / refit /
 * gc). Reuses the shared `scripts/launchd-scheduler.ts` helper (ruling R10) that the Library
 * scheduler also uses; this file only supplies the semantic job list + log dir.
 *
 *   npm run semantic:scheduler:plan       # dry-run (print the cold-start / refit / gc jobs)
 *   npm run semantic:scheduler:install    # write + bootstrap the plists
 *   npm run semantic:scheduler:uninstall  # bootout + remove the plists
 *
 * Dry-run by default; the jobs themselves short-circuit when HILT_SEMANTIC_ENABLED is off.
 */

import { semanticSchedulerJobs, semanticSchedulerLogDir } from "../src/lib/semantic/scheduler-jobs";
import { runScheduler } from "./launchd-scheduler";

const logDir = semanticSchedulerLogDir();
runScheduler({ feature: "semantic", jobs: semanticSchedulerJobs(logDir), logDir });
