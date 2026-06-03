/**
 * Library launchd scheduler — registers the `com.hilt.library.*` jobs. The plist/launchctl
 * install/uninstall/plan logic lives in the shared `scripts/launchd-scheduler.ts` helper
 * (ruling R10) which the semantic scheduler also uses; this file only supplies the Library
 * job list + log dir.
 *
 *   npm run library:scheduler:plan       # dry-run (print the plan)
 *   npm run library:scheduler:install    # write + bootstrap the plists
 *   npm run library:scheduler:uninstall  # bootout + remove the plists
 */

import { librarySchedulerJobs, librarySchedulerLogDir } from "../src/lib/library/scheduler-jobs";
import { runScheduler } from "./launchd-scheduler";

const logDir = librarySchedulerLogDir();
runScheduler({ feature: "library", jobs: librarySchedulerJobs(logDir), logDir });
