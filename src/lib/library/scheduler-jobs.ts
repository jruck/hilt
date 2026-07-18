import os from "os";
import path from "path";

/**
 * A launchd job schedule. `weekday` (0=Sunday..6=Saturday) on a calendar interval makes the
 * job WEEKLY — launchd `StartCalendarInterval` has no native "weekly" key, so the day-of-week
 * is set in the calendar dict (the semantic re-fit uses this; spec "Versioning, Scheduling").
 */
export type SchedulerJobSchedule =
  | { intervalSeconds: number }
  | { hour: number; minute: number; weekday?: number }
  | { runAtLoad: true };

export interface LibrarySchedulerJobDefinition {
  id: string;
  label: string;
  script: string;
  schedule: SchedulerJobSchedule;
  stdout: string;
  stderr: string;
}

export function librarySchedulerLogDir(): string {
  return path.join(os.homedir(), "Library", "Logs", "hilt-library");
}

export function libraryLaunchAgentsDir(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

export function librarySchedulerJobs(logDir = librarySchedulerLogDir()): LibrarySchedulerJobDefinition[] {
  return [
    {
      id: "hourly-ingest",
      label: "com.hilt.library.hourly-ingest",
      script: "library:ingest:hourly",
      schedule: { intervalSeconds: 3600 },
      stdout: path.join(logDir, "hourly-ingest.out.log"),
      stderr: path.join(logDir, "hourly-ingest.err.log"),
    },
    {
      id: "daily-newsletters",
      label: "com.hilt.library.daily-newsletters",
      script: "library:ingest:newsletters",
      schedule: { hour: 7, minute: 10 },
      stdout: path.join(logDir, "daily-newsletters.out.log"),
      stderr: path.join(logDir, "daily-newsletters.err.log"),
    },
    {
      id: "retry",
      label: "com.hilt.library.retry",
      script: "library:retry",
      schedule: { intervalSeconds: 3600 },
      stdout: path.join(logDir, "retry.out.log"),
      stderr: path.join(logDir, "retry.err.log"),
    },
    {
      id: "reweave-pending",
      label: "com.hilt.library.reweave-pending",
      // The SINGLE automated reweave mechanism: a bounded nightly drain (sequential, capped at 40/run)
      // that sweeps version-behind, reweave_pending, and missing-connection study items overnight without
      // bursting the shared Claude Max window. Replaces ad-hoc daytime backfills, which collide with
      // interactive sessions on the same OAuth (library-backfill.ts stays for explicit manual sweeps).
      script: "library:reweave:nightly",
      schedule: { hour: 3, minute: 35 },
      stdout: path.join(logDir, "reweave-pending.out.log"),
      stderr: path.join(logDir, "reweave-pending.err.log"),
    },
    {
      id: "cleanup",
      label: "com.hilt.library.cleanup",
      script: "library:candidates:cleanup",
      schedule: { hour: 4, minute: 15 },
      stdout: path.join(logDir, "cleanup.out.log"),
      stderr: path.join(logDir, "cleanup.err.log"),
    },
    {
      id: "refetch",
      label: "com.hilt.library.refetch",
      // The needs_refetch drain (steering round 1): bounded daily retry of failed source captures —
      // fetch + pinned-Claude digest only (Connections pass deferred; recovered items get reweave_pending and the
      // 03:35 drain weaves them next night). Attempt-capped so dead sources stop consuming fetches.
      script: "library:refetch",
      schedule: { hour: 4, minute: 45 },
      stdout: path.join(logDir, "refetch.out.log"),
      stderr: path.join(logDir, "refetch.err.log"),
    },
    {
      id: "steering",
      label: "com.hilt.library.steering",
      // The Library v2 steering loop: scorecard + feedback clustering + judge/formula disagreements →
      // the morning report (the references loop artifact at meta/loops/references/reports/). Proposals only — never applies changes. Runs after
      // the nightly drain + cleanup so it reports on their results, before the morning briefing.
      script: "library:steering",
      schedule: { hour: 5, minute: 10 },
      stdout: path.join(logDir, "steering.out.log"),
      stderr: path.join(logDir, "steering.err.log"),
    },
    {
      id: "weekly-memo",
      label: "com.hilt.library.weekly-memo",
      // The editor's memo (Library v2 Workstream 3): Saturday synthesis of the week's intake into
      // cross-item through-lines tied to active projects, before the first weekend briefing.
      script: "library:memo",
      schedule: { hour: 5, minute: 30, weekday: 6 },
      stdout: path.join(logDir, "weekly-memo.out.log"),
      stderr: path.join(logDir, "weekly-memo.err.log"),
    },
    {
      id: "recommendations",
      label: "com.hilt.library.recommendations",
      script: "library:recommendations",
      // The attention feed must settle before the 06:00 briefing freezes its top episodes.
      schedule: { hour: 5, minute: 20 },
      stdout: path.join(logDir, "recommendations.out.log"),
      stderr: path.join(logDir, "recommendations.err.log"),
    },
  ];
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function schedulerJobScheduleLabel(schedule: SchedulerJobSchedule): string {
  if ("runAtLoad" in schedule) return "manual / run-at-load";
  if ("intervalSeconds" in schedule) {
    const hours = schedule.intervalSeconds / 3600;
    return hours === 1 ? "hourly" : `every ${hours}h`;
  }
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (schedule.weekday !== undefined) {
    return `weekly ${WEEKDAY_NAMES[schedule.weekday] ?? `day${schedule.weekday}`} ${time}`;
  }
  return `daily ${time}`;
}
