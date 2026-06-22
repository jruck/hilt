/**
 * Install/uninstall/status for the com.hilt.system-agent LaunchAgent
 * (docs/plans/system-agent-mode.md). A single-process KeepAlive daemon that runs
 * the read-only System Agent — modeled on scripts/supervisor-launchd.ts, but with
 * NO Granola/daemon env, a tailscale-aware PATH, and its own heartbeat file.
 *
 *   npm run system-agent:install     write plist + bootstrap (starts now + at login)
 *   npm run system-agent:uninstall   bootout + remove plist
 *   npm run system-agent:status      launchctl state + heartbeat + liveness probe
 *   (no flag)                        print the plan / current state
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { defaultDataDir, HEARTBEAT_FRESH_MS } from "../server/server-mode";
import { systemAgentHeartbeatPath } from "../server/system-agent";

const LABEL = "com.hilt.system-agent";
const PROJECT_DIR = path.resolve(__dirname, "..");
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const WRAPPER = path.join(PROJECT_DIR, "scripts", "hilt-system-agent.sh");
const LOG_DIR = path.join(os.homedir(), ".hilt", "logs", "system-agent");
const PORT = process.env.HILT_SYSTEM_AGENT_PORT || "3200";
// Homebrew + system bin/sbin (sysctl etc. for macmon) + standalone CLI + Tailscale.app
// bundle so machine identity can shell to `tailscale`.
const AGENT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Tailscale.app/Contents/MacOS";

function plistEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Opt-in telemetry env baked into the plist at install time, so only the machine
// holding the closet sensor (Hestia) advertises it:
//   HILT_METRICS_CLOSET=1 npm run system-agent:install
function metricsEnvLines(): string {
  const lines: string[] = [];
  if (process.env.HILT_METRICS_CLOSET === "1") {
    lines.push("        <key>HILT_METRICS_CLOSET</key>\n        <string>1</string>");
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
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
        <key>HILT_SYSTEM_AGENT_PORT</key>
        <string>${plistEscape(PORT)}</string>
        <key>PATH</key>
        <string>${AGENT_PATH}</string>${metricsEnvLines()}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${plistEscape(path.join(LOG_DIR, "system-agent.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${plistEscape(path.join(LOG_DIR, "system-agent.err"))}</string>
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
  console.log(`  logs:  ${path.join(LOG_DIR, "system-agent.log")}`);
  console.log(`  port:  ${PORT} (expose via: tailscale serve --bg ${PORT})`);
  if (out.trim()) console.log(`  launchctl: ${out.trim()}`);
}

function uninstall(): void {
  launchctl(["bootout", gui(), PLIST_PATH]);
  try {
    fs.unlinkSync(PLIST_PATH);
  } catch {
    // Already gone.
  }
  console.log(`uninstalled ${LABEL}`);
}

interface AgentHeartbeat {
  kind?: unknown;
  pid?: unknown;
  port?: unknown;
  started_at?: unknown;
  beat_at?: unknown;
}

function readAgentHeartbeat(): AgentHeartbeat | null {
  try {
    return JSON.parse(fs.readFileSync(systemAgentHeartbeatPath(), "utf-8"));
  } catch {
    return null;
  }
}

async function probeResponds(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/system/machine?scope=local`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { app?: unknown; role?: unknown };
    return data.app === "hilt-system" && data.role === "agent";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function status(): Promise<void> {
  const printout = launchctl(["print", `${gui()}/${LABEL}`]);
  const stateLine = printout.split("\n").find((line) => line.includes("state ="));
  const pidLine = printout.split("\n").find((line) => /\bpid = /.test(line));
  console.log(`launchctl: ${stateLine?.trim() || "not loaded"}${pidLine ? ` (${pidLine.trim()})` : ""}`);

  const heartbeat = readAgentHeartbeat();
  if (!heartbeat) {
    console.log(`heartbeat: none (${systemAgentHeartbeatPath()})`);
  } else {
    const beatAt = typeof heartbeat.beat_at === "string" ? heartbeat.beat_at : null;
    const beatMs = beatAt ? Date.parse(beatAt) : NaN;
    const fresh = Number.isFinite(beatMs) && Date.now() - beatMs <= HEARTBEAT_FRESH_MS;
    console.log(
      `heartbeat: pid ${heartbeat.pid ?? "?"} port ${heartbeat.port ?? "?"}, beat ${beatAt ?? "never"} — ${fresh ? "FRESH" : "STALE"}`,
    );
  }

  const responds = await probeResponds();
  console.log(`probe:     GET /api/system/machine?scope=local on :${PORT} -> ${responds ? "role:agent OK" : "no response"}`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "--install") {
    install();
  } else if (arg === "--uninstall") {
    uninstall();
  } else if (arg === "--status") {
    await status();
  } else {
    console.log(`plan: ${LABEL} (KeepAlive daemon, read-only System Agent)`);
    console.log(`  wrapper: ${WRAPPER}`);
    console.log(`  plist:   ${PLIST_PATH}${fs.existsSync(PLIST_PATH) ? " (installed)" : " (not installed)"}`);
    console.log(`  port:    ${PORT}`);
    console.log("  flags:   --install | --uninstall | --status");
    await status();
  }
}

void main();
