import os from "os";
import path from "path";

export interface LibrarySchedulerJobDefinition {
  id: string;
  label: string;
  script: string;
  schedule: { intervalSeconds: number } | { hour: number; minute: number };
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
      id: "cleanup",
      label: "com.hilt.library.cleanup",
      script: "library:candidates:cleanup",
      schedule: { hour: 4, minute: 15 },
      stdout: path.join(logDir, "cleanup.out.log"),
      stderr: path.join(logDir, "cleanup.err.log"),
    },
    {
      id: "recommendations",
      label: "com.hilt.library.recommendations",
      script: "library:recommendations",
      schedule: { hour: 7, minute: 25 },
      stdout: path.join(logDir, "recommendations.out.log"),
      stderr: path.join(logDir, "recommendations.err.log"),
    },
  ];
}

export function schedulerJobScheduleLabel(schedule: LibrarySchedulerJobDefinition["schedule"]): string {
  if ("intervalSeconds" in schedule) {
    const hours = schedule.intervalSeconds / 3600;
    return hours === 1 ? "hourly" : `every ${hours}h`;
  }
  return `daily ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
}
