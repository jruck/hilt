/**
 * Hilt headless supervisor (docs/plans/supervisor-v1.md, Phase 2).
 *
 * A small launchd-supervised daemon that owns a machine's Hilt serving stack
 * (app-server + ws-server + event-server) so the server survives terminal
 * closes, crashes, and reboots — and stays remotely dev/prod-switchable via
 * the shared intent-file protocol (server/server-mode.ts):
 *
 *   any Hilt window → POST /api/system/app-mode → app-mode-intent.json →
 *   this daemon swaps the app-server child on its fixed port.
 *
 * launchd's KeepAlive supervises the supervisor; the supervisor supervises
 * the servers. Run directly with `npm run supervisor:run`; install the
 * LaunchAgent with `npm run supervisor:install`.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as path from "path";
import {
  HEARTBEAT_INTERVAL_MS,
  REBUILD_STAMP_RELPATH,
  appModeIntentPath,
  clearChildrenRecord,
  clearSupervisorHeartbeat,
  defaultDataDir,
  initialAppMode,
  isPidAlive,
  nextSpawnSpec,
  persistAppMode,
  readAppModeIntent,
  readChildrenRecord,
  writeChildrenRecord,
  writeSupervisorHeartbeat,
  type AppMode,
  type ChildrenRecord,
  type SupervisorState,
} from "./server-mode";

const PROJECT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = defaultDataDir();
const APP_PORT = parseInt(process.env.HILT_SUPERVISOR_PORT || "3000", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "3100", 10);
const DEV_TTL_HOURS = Number(process.env.HILT_SUPERVISOR_DEV_TTL_HOURS ?? "12");
const HEALTH_TICK_MS = 15_000;
const STANDBY_POLL_MS = 30_000;
const RESTART_BACKOFF_CAP_MS = 60_000;
const LOG_DIR = path.join(DATA_DIR, "logs", "supervisor");

type ChildName = "appServer" | "wsServer" | "eventServer";

/**
 * Which children this supervisor manages (default: the full serving stack).
 * Scratch instances (tests, a second supervisor on non-standard ports) set
 * HILT_SUPERVISOR_CHILDREN=appServer so they don't fight the machine's
 * singleton ws-server lock.
 */
const MANAGED_CHILDREN: ChildName[] = (process.env.HILT_SUPERVISOR_CHILDREN || "appServer,wsServer,eventServer")
  .split(",")
  .map((name) => name.trim())
  .filter((name): name is ChildName => name === "appServer" || name === "wsServer" || name === "eventServer");

interface ManagedChild {
  name: ChildName;
  pid: number;
  /** Present for children we spawned; adopted children are pid-only. */
  proc: ChildProcess | null;
  restartAttempts: number;
  lastSpawnAt: number;
  /** Consecutive failed HTTP probes (appServer wedge detection). */
  probeFailures?: number;
}

/** Don't HTTP-probe a fresh child — dev first-compiles are slow. */
const WEDGE_GRACE_MS = 90_000;
/** Alive pid + this many consecutive failed probes (~1 min of ticks) = wedged. */
const WEDGE_PROBE_THRESHOLD = 4;

const children = new Map<ChildName, ManagedChild>();
let currentMode: AppMode = initialAppMode(DATA_DIR);
let state: SupervisorState = "idle";
let stateDetail: string | undefined;
let transitionRunning = false;
let devModeSince: number | null = null;
let lastIntentTs = 0;
let shuttingDown = false;
const startedAt = new Date().toISOString();

function log(message: string): void {
  console.log(`[supervisor ${new Date().toISOString()}] ${message}`);
}

function logStreamFor(name: string): fs.WriteStream {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  return fs.createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: "a" });
}

function beat(): void {
  if (shuttingDown) return;
  const childPids: Record<string, number> = {};
  for (const child of children.values()) childPids[child.name] = child.pid;
  try {
    writeSupervisorHeartbeat(
      {
        kind: "daemon",
        pid: process.pid,
        started_at: startedAt,
        state,
        ...(stateDetail ? { detail: stateDetail } : {}),
        children: childPids,
      },
      DATA_DIR
    );
  } catch (err) {
    log(`heartbeat write failed: ${err}`);
  }
}

function setState(next: SupervisorState, detail?: string): void {
  state = next;
  stateDetail = detail;
  if (detail) log(`state: ${next} — ${detail}`);
  else log(`state: ${next}`);
  beat();
}

function persistChildrenRecord(): void {
  const record: ChildrenRecord = {};
  for (const child of children.values()) {
    record[child.name] = { pid: child.pid, ...(child.name === "appServer" ? { port: APP_PORT } : child.name === "wsServer" ? { port: WS_PORT } : {}) };
  }
  writeChildrenRecord(record, DATA_DIR);
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Already dead.
    }
  }
}

function probeHttp(port: number, pathName = "/api/ws-port", timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: pathName, method: "GET", timeout: timeoutMs },
      (res) => {
        // Any HTTP response means a server is alive on the port — /api/ws-port
        // legitimately answers 200 (WS up) or 503 (WS still starting).
        res.resume();
        resolve(typeof res.statusCode === "number");
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** A Hilt server is answering on the app port. */
function appServerHealthy(): Promise<boolean> {
  return probeHttp(APP_PORT);
}

function portFree(port: number): Promise<boolean> {
  // Bind-probes are NOT enough (learned live during the Mini cutover): an
  // IPv4-wildcard (0.0.0.0) owner collides with neither a bare listen(port)
  // (IPv6 dual-stack — separate stack on macOS) nor a 127.0.0.1 listen (a
  // more-specific bind never conflicts with a wildcard one). So:
  // 1. If anything ACCEPTS a loopback connection, the port is taken.
  // 2. Otherwise an explicit IPv4-wildcard bind must also succeed.
  const canConnect = new Promise<boolean>((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1", timeout: 750 });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
  return canConnect.then((occupied) => {
    if (occupied) return false;
    return new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "0.0.0.0", () => server.close(() => resolve(true)));
    });
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portFree(port)) return true;
    await sleep(250);
  }
  return false;
}

async function waitForAppReady(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await appServerHealthy()) return true;
    await sleep(500);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, DATA_DIR, FORCE_COLOR: "0", ...extra };
}

function track(name: ChildName, proc: ChildProcess): void {
  if (!proc.pid) return;
  children.set(name, { name, pid: proc.pid, proc, restartAttempts: 0, lastSpawnAt: Date.now() });
  persistChildrenRecord();
}

function spawnAppServer(): void {
  // Test hook (plan T4): force the dev spawn to fail so auto-revert is testable.
  const breakDev = process.env.HILT_SUPERVISOR_TEST_BREAK_DEV === "1" && currentMode === "dev";
  const spec = breakDev
    ? { args: ["run", "__supervisor-test-broken__"], env: {}, label: "dev (test-broken)" }
    : nextSpawnSpec(PROJECT_DIR, APP_PORT, currentMode);
  log(`spawning app-server (${spec.label}) on :${APP_PORT}`);
  const stream = logStreamFor("app-server");
  stream.write(`\n--- ${spec.label} app-server starting at ${new Date().toISOString()} ---\n`);
  const proc = spawn("npm", spec.args, {
    cwd: PROJECT_DIR,
    env: childEnv({ PORT: String(APP_PORT), ...spec.env }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  proc.stdout?.pipe(stream);
  proc.stderr?.pipe(stream);
  proc.on("error", (err) => log(`app-server spawn error: ${err}`));
  track("appServer", proc);
}

function spawnWsServer(): void {
  log(`spawning ws-server on :${WS_PORT}`);
  const stream = logStreamFor("ws-server");
  stream.write(`\n--- ws-server starting at ${new Date().toISOString()} ---\n`);
  const proc = spawn("npm", ["run", "ws-server"], {
    cwd: PROJECT_DIR,
    env: childEnv({ WS_PORT: String(WS_PORT) }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  proc.stdout?.pipe(stream);
  proc.stderr?.pipe(stream);
  proc.on("error", (err) => log(`ws-server spawn error: ${err}`));
  track("wsServer", proc);
}

function spawnEventServer(): void {
  log("spawning event-server");
  const stream = logStreamFor("event-server");
  stream.write(`\n--- event-server starting at ${new Date().toISOString()} ---\n`);
  const proc = spawn("npm", ["run", "event-server"], {
    cwd: PROJECT_DIR,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  proc.stdout?.pipe(stream);
  proc.stderr?.pipe(stream);
  proc.on("error", (err) => log(`event-server spawn error: ${err}`));
  track("eventServer", proc);
}

const SPAWNERS: Record<ChildName, () => void> = {
  appServer: spawnAppServer,
  wsServer: spawnWsServer,
  eventServer: spawnEventServer,
};

/**
 * Adopt still-healthy children from a previous supervisor incarnation
 * (launchd restarted us). Conservative: pid must be alive, and the app-server
 * must also answer HTTP; anything else gets cleaned and respawned.
 */
async function adoptOrClean(): Promise<void> {
  const record = readChildrenRecord(DATA_DIR);
  for (const name of MANAGED_CHILDREN) {
    const entry = record[name];
    if (!entry?.pid || !isPidAlive(entry.pid)) continue;
    if (name === "appServer" && !(await appServerHealthy())) {
      log(`previous app-server pid ${entry.pid} alive but not serving — cleaning`);
      killGroup(entry.pid);
      await waitForPortFree(APP_PORT, 10_000);
      continue;
    }
    log(`adopted ${name} from previous supervisor (pid ${entry.pid})`);
    children.set(name, { name, pid: entry.pid, proc: null, restartAttempts: 0, lastSpawnAt: Date.now() });
  }
  persistChildrenRecord();
}

/** True while some OTHER process serves a healthy Hilt on the app port. */
async function externallyOwned(): Promise<boolean> {
  const ours = children.get("appServer");
  if (ours && isPidAlive(ours.pid)) return false;
  if (await portFree(APP_PORT)) return false;
  return appServerHealthy();
}

async function ensureChildren(): Promise<void> {
  for (const name of MANAGED_CHILDREN) {
    const child = children.get(name);
    if (child && isPidAlive(child.pid)) {
      // Wedged-server detection (appServer only): a live pid that stopped
      // answering HTTP would otherwise never self-recover on a headless
      // machine. Grace period covers slow startups; the failure streak
      // covers transient stalls.
      if (name !== "appServer" || Date.now() - child.lastSpawnAt <= WEDGE_GRACE_MS) continue;
      if (await appServerHealthy()) {
        child.probeFailures = 0;
        continue;
      }
      child.probeFailures = (child.probeFailures ?? 0) + 1;
      if (child.probeFailures < WEDGE_PROBE_THRESHOLD) continue;
      log(`appServer (pid ${child.pid}) alive but unresponsive after ${child.probeFailures} probes — restarting as wedged`);
      killGroup(child.pid);
      await sleep(1000);
      // Fall through to the dead-child respawn path.
    }
    if (child) {
      const attempts = child.restartAttempts + 1;
      const elapsed = Date.now() - child.lastSpawnAt;
      // Healthy for 5+ minutes resets the backoff counter.
      const effectiveAttempts = elapsed > 5 * 60_000 ? 1 : attempts;
      const effectiveDelay = Math.min(2 ** effectiveAttempts * 1000, RESTART_BACKOFF_CAP_MS);
      log(`${name} (pid ${child.pid}) died — respawning in ${effectiveDelay / 1000}s (attempt ${effectiveAttempts})`);
      children.delete(name);
      persistChildrenRecord();
      await sleep(effectiveDelay);
      if (shuttingDown) return;
      if (name === "appServer") await waitForPortFree(APP_PORT, 10_000);
      SPAWNERS[name]();
      const replacement = children.get(name);
      if (replacement) replacement.restartAttempts = effectiveAttempts;
    } else {
      if (name === "appServer") await waitForPortFree(APP_PORT, 10_000);
      SPAWNERS[name]();
    }
  }
}

/**
 * Stamp watermark — module-scoped so a switch can mark its own rebuild's
 * stamp as seen the moment the build finishes (closing the race where the
 * 2s poll only fires after the transition ends).
 */
let lastStampMtime = 0;

function syncStampWatermark(): void {
  try {
    lastStampMtime = fs.statSync(path.join(PROJECT_DIR, REBUILD_STAMP_RELPATH)).mtimeMs;
  } catch {
    // No build yet.
  }
}

/** Run `npm run rebuild` while the current server keeps serving. */
function runRebuild(): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = logStreamFor("rebuild");
    stream.write(`\n--- rebuild starting at ${new Date().toISOString()} ---\n`);
    const proc = spawn("npm", ["run", "rebuild"], {
      cwd: PROJECT_DIR,
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    proc.stdout?.pipe(stream);
    proc.stderr?.pipe(stream);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

async function swapAppServer(): Promise<boolean> {
  const existing = children.get("appServer");
  if (existing) {
    killGroup(existing.pid);
    children.delete("appServer");
    persistChildrenRecord();
  }
  await waitForPortFree(APP_PORT, 15_000);
  spawnAppServer();
  return waitForAppReady(90_000);
}

async function switchMode(target: AppMode, reason: string): Promise<void> {
  if (transitionRunning) {
    log(`switch to ${target} ignored — transition already running`);
    return;
  }
  if (target === currentMode) return;

  transitionRunning = true;
  const previous = currentMode;
  try {
    log(`mode switch requested: ${previous} → ${target} (${reason})`);

    if (target === "prod") {
      setState("rebuilding", "Building production bundle (~30s)");
      const built = await runRebuild();
      syncStampWatermark();
      if (!built) {
        setState("idle", "Build failed — staying on current mode (see rebuild.log)");
        return;
      }
    }

    currentMode = target;
    setState("switching", `Restarting server in ${target} mode`);
    const ready = await swapAppServer();

    if (!ready) {
      log(`switch to ${target} failed — reverting to ${previous}`);
      currentMode = previous;
      setState("reverting", `${target} server failed — restoring ${previous}`);
      const reverted = await swapAppServer();
      persistAppMode(previous, DATA_DIR);
      setState("idle", reverted ? `Switch to ${target} failed — reverted` : `Revert to ${previous} also failed — health loop will keep retrying`);
      return;
    }

    persistAppMode(target, DATA_DIR);
    devModeSince = target === "dev" ? Date.now() : null;
    setState("idle");
    log(`mode switched: ${previous} → ${target}`);
  } finally {
    transitionRunning = false;
  }
}

function setupIntentWatcher(): void {
  const intentPath = appModeIntentPath(DATA_DIR);
  const existing = readAppModeIntent(DATA_DIR);
  if (existing) lastIntentTs = existing.ts;

  // Poll instead of fs-watch: chokidar would be another dependency surface in
  // a process whose whole job is staying simple, and 2s latency is invisible
  // next to a 30s rebuild. (Deviation from the Electron supervisor, which
  // already had chokidar loaded.)
  setInterval(() => {
    if (shuttingDown || transitionRunning) return;
    const intent = readAppModeIntent(DATA_DIR);
    if (!intent || intent.ts === lastIntentTs) return;
    lastIntentTs = intent.ts;
    log(`intent received: ${intent.mode} (from ${intent.requested_by || "unknown"})`);
    void switchMode(intent.mode, "intent file");
  }, 2_000);
  log(`watching mode intents at ${intentPath}`);
}

function setupStampWatcher(): void {
  const stampPath = path.join(PROJECT_DIR, REBUILD_STAMP_RELPATH);
  syncStampWatermark();
  setInterval(() => {
    if (shuttingDown) return;
    let mtime = 0;
    try {
      mtime = fs.statSync(stampPath).mtimeMs;
    } catch {
      return;
    }
    if (mtime <= lastStampMtime) return;
    lastStampMtime = mtime;
    if (transitionRunning) {
      // A switch's own `npm run rebuild` writes the stamp — ABSORB it (spec:
      // ignored, not deferred) so the freshly-swapped server isn't restarted
      // a second time the moment the transition ends.
      log("rebuild stamp changed during a transition — absorbing (the switch already serves this build)");
      return;
    }
    if (currentMode !== "prod") {
      log("rebuild stamp changed while in dev mode — ignoring (picked up on next prod switch)");
      return;
    }
    log("rebuild stamp changed — restarting app-server on the new build");
    void (async () => {
      if (transitionRunning) return;
      transitionRunning = true;
      try {
        setState("switching", "Restarting on the new build");
        await swapAppServer();
        setState("idle");
      } finally {
        transitionRunning = false;
      }
    })();
  }, 2_000);
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received — shutting down children`);
  for (const child of children.values()) killGroup(child.pid);
  clearSupervisorHeartbeat(DATA_DIR);
  clearChildrenRecord(DATA_DIR);
  process.exit(0);
}

async function main(): Promise<void> {
  log(`starting (mode: ${currentMode}, port: ${APP_PORT}, data: ${DATA_DIR}, project: ${PROJECT_DIR})`);
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Standby: never fight an externally-owned healthy Hilt (e.g. a terminal
  // dev session) over the port. Claim it when it goes away.
  await adoptOrClean();
  while (await externallyOwned()) {
    log(`port :${APP_PORT} is served by a Hilt this supervisor doesn't own — standing by`);
    await sleep(STANDBY_POLL_MS);
    if (shuttingDown) return;
  }

  if (currentMode === "dev") devModeSince = Date.now();
  await ensureChildren();
  beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS);
  setupIntentWatcher();
  setupStampWatcher();

  // Health loop + dev TTL.
  setInterval(() => {
    if (shuttingDown || transitionRunning) return;
    void (async () => {
      await ensureChildren();
      if (
        currentMode === "dev" &&
        devModeSince !== null &&
        DEV_TTL_HOURS > 0 &&
        Date.now() - devModeSince > DEV_TTL_HOURS * 3_600_000
      ) {
        log(`dev mode TTL (${DEV_TTL_HOURS}h) expired — returning to prod`);
        await switchMode("prod", "dev TTL");
      }
    })();
  }, HEALTH_TICK_MS);

  log("supervising");
}

void main();
