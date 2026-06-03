/**
 * Shared launchd plist + launchctl install/uninstall/plan logic (ruling R10).
 *
 * Both `scripts/library-scheduler.ts` and `scripts/semantic-scheduler.ts` call `runScheduler()`
 * with their own `{ id, label, script, schedule, stdout, stderr }` job array (the
 * `LibrarySchedulerJobDefinition` shape from src/lib/library/scheduler-jobs.ts). This is the
 * single place that knows how to render a launchd plist, bootstrap/bootout via launchctl, and
 * print the dry-run plan — extracted verbatim from the original `library-scheduler.ts` so the
 * two feature families stay byte-identical except for their job lists, labels, and log dirs.
 *
 * Contract preserved from the Library scheduler: `--install` / `--uninstall`, dry-run by
 * default (neither flag → only print the plan), and `RunAtLoad=false` unless a job's schedule
 * is `{ runAtLoad: true }` (the cold-start one-shot). Weekly jobs set `Weekday` in the
 * calendar-interval dict (launchd has no native weekly key).
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  schedulerJobScheduleLabel,
  type LibrarySchedulerJobDefinition,
  type SchedulerJobSchedule,
} from "../src/lib/library/scheduler-jobs";

interface ResolvedJob {
  id: string;
  label: string;
  command: string;
  schedule: SchedulerJobSchedule;
  stdout: string;
  stderr: string;
}

export interface RunSchedulerOptions {
  /** Human family name for the plan output (e.g. "library", "semantic"). */
  feature: string;
  /** The job definitions (the per-family scheduler-jobs array). */
  jobs: LibrarySchedulerJobDefinition[];
  /** Log dir these jobs write to (printed in the plan; the jobs already encode it in stdout/stderr). */
  logDir: string;
  /** CLI args (default process.argv.slice(2)). */
  argv?: string[];
}

const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function plistEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistPath(job: ResolvedJob): string {
  return path.join(launchAgentsDir, `${job.label}.plist`);
}

function command(script: string): string {
  return `cd ${shellQuote(process.cwd())} && /usr/bin/env npm run ${script}`;
}

function schedulePlist(schedule: SchedulerJobSchedule): string {
  if ("runAtLoad" in schedule) {
    // No interval/calendar key — RunAtLoad (below) is what fires it. (No-op placeholder.)
    return "";
  }
  if ("intervalSeconds" in schedule) {
    return `  <key>StartInterval</key>\n  <integer>${schedule.intervalSeconds}</integer>`;
  }
  const lines = [
    "  <key>StartCalendarInterval</key>",
    "  <dict>",
    "    <key>Hour</key>",
    `    <integer>${schedule.hour}</integer>`,
    "    <key>Minute</key>",
    `    <integer>${schedule.minute}</integer>`,
  ];
  if (schedule.weekday !== undefined) {
    lines.push("    <key>Weekday</key>", `    <integer>${schedule.weekday}</integer>`);
  }
  lines.push("  </dict>");
  return lines.join("\n");
}

function plist(job: ResolvedJob): string {
  const runAtLoad = "runAtLoad" in job.schedule ? "true" : "false";
  const scheduleBlock = schedulePlist(job.schedule);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistEscape(job.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${plistEscape(job.command)}</string>
  </array>
${scheduleBlock ? `${scheduleBlock}\n` : ""}  <key>StandardOutPath</key>
  <string>${plistEscape(job.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${plistEscape(job.stderr)}</string>
  <key>RunAtLoad</key>
  <${runAtLoad}/>
</dict>
</plist>
`;
}

function launchctl(...launchArgs: string[]): void {
  execFileSync("launchctl", launchArgs, { stdio: "inherit" });
}

function installJobs(jobs: ResolvedJob[], logDir: string): void {
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  for (const job of jobs) {
    const filePath = plistPath(job);
    fs.writeFileSync(filePath, plist(job), "utf-8");
    try {
      launchctl("bootout", `gui/${process.getuid?.()}`, filePath);
    } catch {
      // launchctl exits nonzero when replacing a job that is not already loaded.
    }
    launchctl("bootstrap", `gui/${process.getuid?.()}`, filePath);
    launchctl("enable", `gui/${process.getuid?.()}/${job.label}`);
  }
}

function uninstallJobs(jobs: ResolvedJob[]): void {
  for (const job of jobs) {
    const filePath = plistPath(job);
    try {
      launchctl("bootout", `gui/${process.getuid?.()}`, filePath);
    } catch {
      // launchctl exits nonzero when a job is not loaded; uninstall should keep going.
    }
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  }
}

function printPlan(feature: string, jobs: ResolvedJob[], logDir: string, mode: string): void {
  console.log(
    JSON.stringify(
      {
        feature,
        mode,
        hilt_root: process.cwd(),
        launch_agents_dir: launchAgentsDir,
        log_dir: logDir,
        jobs: jobs.map((job) => ({
          id: job.id,
          label: job.label,
          command: job.command,
          cadence: schedulerJobScheduleLabel(job.schedule),
          schedule: job.schedule,
          plist: plistPath(job),
          stdout: job.stdout,
          stderr: job.stderr,
        })),
        note: "Dry-run only unless --install or --uninstall is supplied.",
      },
      null,
      2,
    ),
  );
}

/** Render the plan and (when flagged) install/uninstall the launchd plists. */
export function runScheduler(opts: RunSchedulerOptions): void {
  const args = new Set(opts.argv ?? process.argv.slice(2));
  const install = args.has("--install");
  const uninstall = args.has("--uninstall");
  if (install && uninstall) throw new Error("Use only one of --install or --uninstall.");

  const jobs: ResolvedJob[] = opts.jobs.map((job) => ({
    id: job.id,
    label: job.label,
    command: command(job.script),
    schedule: job.schedule,
    stdout: job.stdout,
    stderr: job.stderr,
  }));

  printPlan(opts.feature, jobs, opts.logDir, install ? "install" : uninstall ? "uninstall" : "dry-run");
  if (install) installJobs(jobs, opts.logDir);
  if (uninstall) uninstallJobs(jobs);
}
