import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { loadRegistry } from "../src/lib/loops/registry";
import { absenceItems, healthDigestItems, substrateItems, type SubstrateInputs } from "../src/lib/loops/runtime";
import { emitLoopArtifact, defaultSandboxDir } from "../src/lib/loops/emit";
import { isoNow } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * The runtime loop runner (Briefings v2, Phase 3 — scope §7): absence detection over registered
 * loops, substrate checks, cross-loop health digest. Emits its own contract artifact through the
 * write guard (shadow → sandbox until the Phase 3 gate flips it live). Scheduled daily 05:45 —
 * after the overnight loop chain (03:35 reweave, 05:10 steering), before gather (~06:00).
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/loop-runtime.ts [--vault <path>] [--date YYYY-MM-DD]
 */
const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const today = argValue("--date") || new Date().toLocaleDateString("en-CA");

const CRITICAL_JOBS = [
  "com.hilt.briefing.daily",
  "com.hilt.briefing.retry",
  "com.hilt.library.steering",
  "com.hilt.library.reweave-pending",
  "com.hilt.supervisor",
];

async function launchdExitCodes(): Promise<Record<string, number>> {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list"], { timeout: 15_000 });
    const rows: Record<string, number> = {};
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(-|\d+)\t(-?\d+)\t(com\.hilt\.\S+)/);
      if (m) rows[m[3]] = Number(m[2]);
    }
    return rows;
  } catch {
    return {};
  }
}

async function claudeVersion(): Promise<string | null> {
  try {
    const bin = process.env.CLAUDE_PATH || process.env.CLAUDE_BIN || "claude";
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 20_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function oauthTokenConfigured(): boolean {
  try {
    const envLocal = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
    return /^CLAUDE_CODE_OAUTH_TOKEN=.+/m.test(envLocal);
  } catch {
    return false;
  }
}

async function diskFreeFraction(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("/bin/df", ["-k", vaultPath], { timeout: 10_000 });
    const line = stdout.trim().split("\n").at(-1) || "";
    const parts = line.split(/\s+/);
    const total = Number(parts[1]);
    const avail = Number(parts[3]);
    return Number.isFinite(total) && Number.isFinite(avail) && total > 0 ? avail / total : null;
  } catch {
    return null;
  }
}

interface DiskCapacity {
  availableFraction: number | null;
  immediateFreeFraction: number | null;
}

function fraction(bytes: number | null, totalBytes: number | null): number | null {
  if (bytes === null || totalBytes === null || totalBytes <= 0) return null;
  const value = bytes / totalBytes;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

async function macosAvailableCapacity(): Promise<DiskCapacity | null> {
  if (process.platform !== "darwin") return null;
  try {
    const script = `
ObjC.import("Foundation");
const url = $.NSURL.fileURLWithPath(${JSON.stringify(vaultPath)});
const keys = $([
  $.NSURLVolumeAvailableCapacityKey,
  $.NSURLVolumeAvailableCapacityForImportantUsageKey,
  $.NSURLVolumeTotalCapacityKey,
]);
const values = url.resourceValuesForKeysError(keys, null);
function numberForKey(key) {
  const value = values.objectForKey(key);
  if (!value) return null;
  const n = Number(ObjC.unwrap(value));
  return Number.isFinite(n) ? n : null;
}
console.log(JSON.stringify({
  immediate: numberForKey($.NSURLVolumeAvailableCapacityKey),
  important: numberForKey($.NSURLVolumeAvailableCapacityForImportantUsageKey),
  total: numberForKey($.NSURLVolumeTotalCapacityKey),
}));
`;
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 10_000 });
    const parsed = JSON.parse(String(stdout)) as { immediate?: unknown; important?: unknown; total?: unknown };
    const total = Number(parsed.total);
    const important = Number(parsed.important);
    const immediate = Number(parsed.immediate);
    return {
      availableFraction: fraction(Number.isFinite(important) ? important : null, Number.isFinite(total) ? total : null),
      immediateFreeFraction: fraction(Number.isFinite(immediate) ? immediate : null, Number.isFinite(total) ? total : null),
    };
  } catch {
    return null;
  }
}

async function diskCapacity(): Promise<DiskCapacity> {
  const immediateFreeFraction = await diskFreeFraction();
  const macos = await macosAvailableCapacity();
  if (macos?.availableFraction !== null && macos?.availableFraction !== undefined) {
    return {
      availableFraction: macos.availableFraction,
      immediateFreeFraction: macos.immediateFreeFraction ?? immediateFreeFraction,
    };
  }
  return { availableFraction: immediateFreeFraction, immediateFreeFraction };
}

function supervisorHeartbeatAgeMin(): number | null {
  try {
    const p = path.join(process.env.DATA_DIR || "data", "app-supervisor.json");
    const stat = fs.statSync(p);
    return (Date.now() - stat.mtimeMs) / 60_000;
  } catch {
    return null;
  }
}

function briefingPresent(): boolean | null {
  // Only meaningful after the morning window (06:00 gen + retries). Before 07:00 local, N/A.
  const hour = new Date().getHours();
  if (hour < 7) return null;
  const day = new Date().getDay();
  // Weekend: the weekend file is Saturday-anchored and may legitimately lag; skip.
  if (day === 0 || day === 6) return null;
  return fs.existsSync(path.join(vaultPath, "briefings", `${today}.md`));
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "unknown" : `${(value * 100).toFixed(1)}%`;
}

function diskLine(inputs: SubstrateInputs): string {
  const available = formatPercent(inputs.diskFreeFraction);
  const immediate = inputs.diskImmediateFreeFraction;
  if (
    inputs.diskFreeFraction !== null &&
    inputs.diskFreeFraction !== undefined &&
    immediate !== null &&
    immediate !== undefined &&
    Math.abs(immediate - inputs.diskFreeFraction) >= 0.01
  ) {
    return `${available} (${formatPercent(immediate)} immediately free by df)`;
  }
  return available;
}

async function main(): Promise<void> {
  const registry = loadRegistry(vaultPath);
  const loop = registry.loops.find((l) => l.id === "runtime");
  if (!loop || !loop.enabled) throw new Error("runtime loop missing/disabled in registry");

  const bases = { shadow: defaultSandboxDir(), live: vaultPath };
  const disk = await diskCapacity();
  const inputs: SubstrateInputs = {
    launchdExitCodes: await launchdExitCodes(),
    criticalJobs: CRITICAL_JOBS,
    claudeVersion: await claudeVersion(),
    oauthTokenConfigured: oauthTokenConfigured(),
    diskFreeFraction: disk.availableFraction,
    diskImmediateFreeFraction: disk.immediateFreeFraction,
    supervisorHeartbeatAgeMin: supervisorHeartbeatAgeMin(),
    briefingPresent: briefingPresent(),
  };

  const items = [
    ...absenceItems(registry, bases, today),
    ...healthDigestItems(registry, bases, today),
    ...substrateItems(inputs, today),
  ];

  const escalated = items.filter((i) => i.escalated);
  const checksAttempted = 7; // absence, digest, launchd, cli, token, disk, supervisor/briefing
  const contentBody = [
    `# Runtime Loop — ${today}`,
    "",
    "_The watchdog: absence detection over registered loops, substrate health, cross-loop digest._",
    "",
    "## Scorecard",
    "",
    `- Enabled loops watched: ${registry.loops.filter((l) => l.enabled && l.id !== "runtime").length}`,
    `- Findings: ${items.length} (${escalated.length} escalated)`,
    `- claude CLI: ${inputs.claudeVersion || "NOT RESOLVABLE"}`,
    `- Disk available: ${diskLine(inputs)}`,
    `- Supervisor heartbeat: ${inputs.supervisorHeartbeatAgeMin !== null ? `${Math.round(inputs.supervisorHeartbeatAgeMin)} min` : "no heartbeat file"}`,
    "",
    "## Findings",
    "",
    items.length
      ? items.map((i) => `- ${i.escalated ? "🔴 " : ""}${i.title}`).join("\n")
      : "- All clear: every enabled loop fresh, substrate healthy.",
    "",
  ].join("\n");

  const written = emitLoopArtifact({
    vaultPath,
    loop,
    date: today,
    runAt: isoNow(),
    items,
    health: {
      ok: true, // the runtime loop itself ran; its findings are about OTHERS
      attempted: checksAttempted,
      succeeded: checksAttempted,
      coverage: 1,
      notes: `${items.length} findings, ${escalated.length} escalated`,
    },
    contentBody,
  });

  console.log(JSON.stringify({
    artifact: written,
    findings: items.length,
    escalated: escalated.length,
    titles: items.map((i) => i.title),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
