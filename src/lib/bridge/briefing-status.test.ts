import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getEasternDate, getHermesBriefingFailureForDate } from "./briefing-status";

const tempDirs: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hilt-briefing-status-"));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("briefing status", () => {
  it("formats dates in Eastern time", () => {
    assert.equal(getEasternDate(new Date("2026-06-02T03:30:00Z")), "2026-06-01");
    assert.equal(getEasternDate(new Date("2026-06-02T10:00:00Z")), "2026-06-02");
  });

  it("detects a failed Hermes briefing run for a date", async () => {
    const homeDir = await makeHome();
    const cronDir = path.join(homeDir, ".hermes", "cron");
    const outputDir = path.join(cronDir, "output", "job-1");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "2026-06-02_06-01-15.md"), "# Cron Job: Morning Briefing (FAILED)\n");
    await fs.writeFile(
      path.join(cronDir, "jobs.json"),
      JSON.stringify({
        jobs: [
          {
            id: "job-1",
            name: "Morning Briefing",
            skill: "briefing",
            script: "briefing-gather.sh",
            last_status: "error",
            last_error: "RuntimeError: You're out of extra usage.",
            last_run_at: "2026-06-02T06:01:15.678189-04:00",
            next_run_at: "2026-06-03T06:00:00-04:00",
          },
          {
            id: "retry-1",
            name: "Morning Briefing Retry Watch",
            script: "briefing-retry-watch.sh",
            next_run_at: "2026-06-02T06:30:00-04:00",
          },
        ],
      })
    );

    const failure = await getHermesBriefingFailureForDate("2026-06-02", { homeDir });
    assert.deepEqual(failure && {
      status: failure.status,
      kind: failure.kind,
      date: failure.date,
      jobId: failure.jobId,
      jobName: failure.jobName,
      runAt: failure.runAt,
      nextRunAt: failure.nextRunAt,
      autoRetryNextRunAt: failure.autoRetryNextRunAt,
      error: failure.error,
      outputPath: path.basename(failure.outputPath ?? ""),
    }, {
      status: "failed",
      kind: "quota",
      date: "2026-06-02",
      jobId: "job-1",
      jobName: "Morning Briefing",
      runAt: "2026-06-02T06:01:15.678189-04:00",
      nextRunAt: "2026-06-03T06:00:00-04:00",
      autoRetryNextRunAt: "2026-06-02T06:30:00-04:00",
      error: "RuntimeError: You're out of extra usage.",
      outputPath: "2026-06-02_06-01-15.md",
    });
  });

  it("does not treat the retry watcher as the failed briefing run", async () => {
    const homeDir = await makeHome();
    const cronDir = path.join(homeDir, ".hermes", "cron");
    await fs.mkdir(cronDir, { recursive: true });
    await fs.writeFile(
      path.join(cronDir, "jobs.json"),
      JSON.stringify({
        jobs: [
          {
            id: "retry-1",
            name: "Morning Briefing Retry Watch",
            script: "briefing-retry-watch.sh",
            last_status: "error",
            last_error: "watcher failed",
            last_run_at: "2026-06-02T06:30:00-04:00",
            next_run_at: "2026-06-02T07:00:00-04:00",
          },
        ],
      })
    );

    const failure = await getHermesBriefingFailureForDate("2026-06-02", { homeDir });
    assert.equal(failure, null);
  });

  it("does not treat the weekend briefing job as the daily morning briefing run", async () => {
    const homeDir = await makeHome();
    const cronDir = path.join(homeDir, ".hermes", "cron");
    await fs.mkdir(cronDir, { recursive: true });
    await fs.writeFile(
      path.join(cronDir, "jobs.json"),
      JSON.stringify({
        jobs: [
          {
            id: "weekend-1",
            name: "Weekend Briefing",
            skill: "briefing",
            script: "briefing-weekend-gather.sh",
            last_status: "error",
            last_error: "weekend failed",
            last_run_at: "2026-06-06T06:00:00-04:00",
            next_run_at: "2026-06-07T06:00:00-04:00",
          },
        ],
      })
    );

    const failure = await getHermesBriefingFailureForDate("2026-06-06", { homeDir });
    assert.equal(failure, null);
  });
});
