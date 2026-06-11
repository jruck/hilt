/**
 * Install/uninstall/status for the com.hilt.supervisor LaunchAgent
 * (docs/plans/supervisor-v1.md). A KeepAlive daemon plist — deliberately NOT
 * the calendar-job shape that scripts/launchd-scheduler.ts renders, so this
 * is its own small script (modeled on the com.hilt.dev-server plist it
 * supersedes).
 *
 *   npm run supervisor:install     write plist + bootstrap (starts now + at login)
 *   npm run supervisor:uninstall   bootout + remove plist
 *   npm run supervisor:status      launchctl state + heartbeat summary
 *   (no flag)                      print the plan / current state
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isHeartbeatFresh,
  readSupervisorHeartbeat,
  defaultDataDir,
} from "../server/server-mode";

const LABEL = "com.hilt.supervisor";
const PROJECT_DIR = path.resolve(__dirname, "..");
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const WRAPPER = path.join(PROJECT_DIR, "scripts", "hilt-supervisor.sh");
const LOG_DIR = path.join(os.homedir(), ".hilt", "logs");

function plistEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${plistEscape(WRAPPER)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${plistEscape(PROJECT_DIR)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${plistEscape(os.homedir())}</string>
        <key>DATA_DIR</key>
        <string>${plistEscape(defaultDataDir())}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${plistEscape(path.join(LOG_DIR, "supervisor.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${plistEscape(path.join(LOG_DIR, "supervisor.err"))}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[]): string {
  try {
    return execFileSync("launchctl", args, { encoding: "utf-8" });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function gui(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

function install(): void {
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, renderPlist());
  launchctl(["bootout", gui(), PLIST_PATH]);
  const out = launchctl(["bootstrap", gui(), PLIST_PATH]);
  console.log(`installed ${LABEL}`);
  console.log(`  plist: ${PLIST_PATH}`);
  console.log(`  logs:  ${path.join(LOG_DIR, "supervisor.log")}`);
  if (out.trim()) console.log(`  launchctl: ${out.trim()}`);
}

function uninstall(): void {
  launchctl(["bootout", gui(), PLIST_PATH]);
  try {
    fs.unlinkSync(PLIST_PATH);
  } catch {
    // Already gone.
  }
  console.log(`uninstalled ${LABEL} (servers it spawned were SIGTERMed by the daemon's shutdown handler)`);
}

function status(): void {
  const printout = launchctl(["print", `${gui()}/${LABEL}`]);
  const stateLine = printout.split("\n").find((line) => line.includes("state ="));
  const pidLine = printout.split("\n").find((line) => /\bpid = /.test(line));
  console.log(`launchctl: ${stateLine?.trim() || "not loaded"}${pidLine ? ` (${pidLine.trim()})` : ""}`);

  const heartbeat = readSupervisorHeartbeat();
  if (!heartbeat) {
    console.log("heartbeat: none");
    return;
  }
  const fresh = isHeartbeatFresh(heartbeat);
  console.log(
    `heartbeat: ${heartbeat.kind} pid ${heartbeat.pid}, state ${heartbeat.state}${heartbeat.detail ? ` (${heartbeat.detail})` : ""}, beat ${heartbeat.beat_at} — ${fresh ? "FRESH" : "STALE"}`
  );
  if (heartbeat.children) {
    for (const [name, pid] of Object.entries(heartbeat.children)) {
      console.log(`  child ${name}: pid ${pid}`);
    }
  }
}

const arg = process.argv[2];
if (arg === "--install") install();
else if (arg === "--uninstall") uninstall();
else if (arg === "--status") status();
else {
  console.log(`plan: ${LABEL} (KeepAlive daemon)`);
  console.log(`  wrapper: ${WRAPPER}`);
  console.log(`  plist:   ${PLIST_PATH}${fs.existsSync(PLIST_PATH) ? " (installed)" : " (not installed)"}`);
  console.log("  flags:   --install | --uninstall | --status");
  status();
}
