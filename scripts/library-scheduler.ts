import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { librarySchedulerJobs, schedulerJobScheduleLabel } from "../src/lib/library/scheduler-jobs";

interface SchedulerJob {
  id: string;
  label: string;
  command: string;
  schedule: { intervalSeconds: number } | { hour: number; minute: number };
  stdout: string;
  stderr: string;
}

const hiltRoot = process.cwd();
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const logDir = path.join(os.homedir(), "Library", "Logs", "hilt-library");
const args = new Set(process.argv.slice(2));
const install = args.has("--install");
const uninstall = args.has("--uninstall");

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function plistEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plistPath(job: SchedulerJob): string {
  return path.join(launchAgentsDir, `${job.label}.plist`);
}

function command(script: string): string {
  return `cd ${shellQuote(hiltRoot)} && /usr/bin/env npm run ${script}`;
}

const jobs: SchedulerJob[] = librarySchedulerJobs(logDir).map((job) => ({
  id: job.id,
  label: job.label,
  command: command(job.script),
  schedule: job.schedule,
  stdout: job.stdout,
  stderr: job.stderr,
}));

function schedulePlist(schedule: SchedulerJob["schedule"]): string {
  if ("intervalSeconds" in schedule) {
    return `  <key>StartInterval</key>\n  <integer>${schedule.intervalSeconds}</integer>`;
  }
  return [
    "  <key>StartCalendarInterval</key>",
    "  <dict>",
    "    <key>Hour</key>",
    `    <integer>${schedule.hour}</integer>`,
    "    <key>Minute</key>",
    `    <integer>${schedule.minute}</integer>`,
    "  </dict>",
  ].join("\n");
}

function plist(job: SchedulerJob): string {
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
${schedulePlist(job.schedule)}
  <key>StandardOutPath</key>
  <string>${plistEscape(job.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${plistEscape(job.stderr)}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

function launchctl(...launchArgs: string[]) {
  execFileSync("launchctl", launchArgs, { stdio: "inherit" });
}

function installJobs() {
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

function uninstallJobs() {
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

function printPlan() {
  console.log(JSON.stringify({
    mode: install ? "install" : uninstall ? "uninstall" : "dry-run",
    hilt_root: hiltRoot,
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
  }, null, 2));
}

if (install && uninstall) {
  throw new Error("Use only one of --install or --uninstall.");
}

printPlan();
if (install) installJobs();
if (uninstall) uninstallJobs();
