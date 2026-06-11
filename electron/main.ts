import { app, BrowserWindow, shell, ipcMain, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as os from "os";
import { spawn, ChildProcess, execSync } from "child_process";

// The dev .app launches the generic Electron binary, whose default app name is
// "Electron". Set this before reading userData so the app uses Hilt's config.
app.setName("Hilt");

// Load .env file so Electron has access to the same env vars as Next.js
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// In dev, keep Electron-launched servers on the same shared Hilt data dir used
// by CLI scripts and background jobs. Packaged builds can keep Electron userData.
const DATA_DIR = process.env.DATA_DIR || (
  app.isPackaged ? path.join(app.getPath("userData"), "data") : path.join(os.homedir(), ".hilt", "data")
);
process.env.DATA_DIR = DATA_DIR;
// Inherited PATH FIRST: the .app launcher curates it (homebrew, then /usr/local,
// then an nvm prepend that wins when present). The hardcoded dirs are only
// fallbacks for minimal Finder environments — putting them first let a stale
// /usr/local/bin/node (v18 on Mercury) shadow the launcher's modern pick and
// crash every spawned tsx server.
const CHILD_PATH = [process.env.PATH || "", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: CHILD_PATH,
    DATA_DIR,
    ...extra,
  };
}

// ─── App server mode ───
// The server mode (dev = hot reload, prod = production build served from
// .next-prod) is RUNTIME state, switchable from the Hilt UI without
// relaunching the Electron wrapper. Resolution order: persisted state file
// (the UI's durable choice) > HILT_APP_MODE launcher env (initial default
// baked by `npm run app` / `app:prod`) > dev. The prod build lives in its own
// dist dir so builds never fight a dev server over `.next`. After `npm run
// rebuild`, the stamp file triggers a restart of the owned Next.js children +
// a window reload — the Electron wrapper itself keeps running.
const PROD_DIST_DIR = ".next-prod";
const REBUILD_STAMP = path.join(PROD_DIST_DIR, ".hilt-rebuild-stamp");
const APP_MODE_STATE_FILE = path.join(DATA_DIR, "app-mode.json");

type AppMode = "dev" | "prod";

function readPersistedAppMode(): AppMode | null {
  try {
    const data = JSON.parse(fs.readFileSync(APP_MODE_STATE_FILE, "utf-8"));
    if (data?.mode === "prod" || data?.mode === "dev") return data.mode;
  } catch {
    // No persisted mode yet.
  }
  return null;
}

function persistAppMode(mode: AppMode): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(APP_MODE_STATE_FILE, JSON.stringify({ mode, updated_at: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.error("Failed to persist app mode:", err);
  }
}

let currentAppMode: AppMode =
  readPersistedAppMode() ?? (process.env.HILT_APP_MODE === "prod" ? "prod" : "dev");

function prodBuildAvailable(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, PROD_DIST_DIR, "BUILD_ID"));
}

/** Effective server mode: prod requires a completed `npm run rebuild` build. */
function resolveServerMode(projectDir: string): AppMode {
  if (currentAppMode !== "prod") return "dev";
  if (prodBuildAvailable(projectDir)) return "prod";
  console.warn(
    `App mode is prod but ${PROD_DIST_DIR}/BUILD_ID is missing — run \`npm run rebuild\`. Falling back to the dev server.`
  );
  return "dev";
}

function nextSpawnSpec(projectDir: string, port: number): { args: string[]; env: Record<string, string>; label: string } {
  if (resolveServerMode(projectDir) === "prod") {
    return {
      args: ["run", "start", "--", "--port", String(port)],
      env: { HILT_DIST_DIR: PROD_DIST_DIR, NODE_ENV: "production" },
      label: "production",
    };
  }
  return { args: ["run", "dev", "--", "--port", String(port)], env: {}, label: "dev" };
}

const PLANS_DIR = path.join(process.env.HOME || "~", ".claude", "plans");
const NAVIGATE_FILE = path.join(process.env.HOME || "~", ".hilt-pending-navigate.json");

// Source type (mirrors src/lib/types.ts for Electron's use)
interface SourceConfig {
  id: string;
  name: string;
  type: "local" | "remote";
  url: string;
  folder?: string;
  rank: number;
}

// Server instance tracking for multi-source orchestration
interface ServerInstance {
  process: ChildProcess;
  port: number;
  folder: string;
  sourceId: string;
  name: string;
}

// Track active windows and server processes
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let nextServer: ChildProcess | null = null;
let wsServer: ChildProcess | null = null;
let serverPort: number | null = null;
const servers = new Map<string, ServerInstance>();
const IPHONE_SE_VIEWPORT = {
  width: 375,
  height: 667,
};

// Startup activity tracking for loading screen
interface StartupActivity {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
  error?: string;
}

// Queue startup activities until window is ready
const pendingStartupActivities: StartupActivity[] = [];
let windowReady = false;

function sendStartupActivity(activity: StartupActivity) {
  if (mainWindow && windowReady) {
    mainWindow.webContents.send("startup:activity", activity);
  } else {
    // Queue for later when window is ready
    pendingStartupActivities.push(activity);
  }
}

function flushPendingStartupActivities() {
  if (mainWindow) {
    windowReady = true;
    for (const activity of pendingStartupActivities) {
      mainWindow.webContents.send("startup:activity", activity);
    }
    pendingStartupActivities.length = 0;
  }
}

function sortSourcesByRank(sources: SourceConfig[]): SourceConfig[] {
  return [...sources].sort((a, b) => a.rank - b.rank);
}

/**
 * Find an available port.
 *
 * Two collision modes we have to avoid:
 *  1. Wildcard probe missing IPv4-only listeners — Node's default
 *     `listen(port)` binds the IPv6 dual-stack wildcard, which does NOT collide
 *     with an IPv4-only listener (e.g. OrbStack forwarding `127.0.0.1:3001`).
 *     Hilt would think the port was free, bind IPv6, then Electron's
 *     `loadURL("localhost:3001")` resolves to IPv4 first and lands on the other
 *     app — Hilt window shows BrowserSync.
 *  2. Loopback-only probe missing wildcard listeners — `listen(port, "127.0.0.1")`
 *     succeeds even when another process owns the IPv6 dual-stack wildcard
 *     (because a more-specific bind doesn't conflict with a wildcard one in
 *     the kernel's routing table). Hilt would think the port was free, then
 *     `next dev` does the wildcard listen and crashes with EADDRINUSE.
 *
 * The probe must mirror what `next dev` actually does: a wildcard listen.
 * Combine that with an IPv4 loopback check to also catch case 1.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const probe = (port: number, host?: string): Promise<boolean> =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      const cb = () => server.close(() => resolve(true));
      if (host) server.listen(port, host, cb);
      else server.listen(port, cb);
    });

  let port = startPort;
  while (true) {
    const wildcardFree = await probe(port);
    const ipv4Free = await probe(port, "127.0.0.1");
    if (wildcardFree && ipv4Free) return port;
    port++;
  }
}

/**
 * Check if a dev server is running on a given port
 */
async function checkDevServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "localhost", port, path: "/", method: "GET", timeout: 2000 },
      (res) => {
        // Must be a 2xx response with HTML content (not just any HTTP server like the WS server)
        const contentType = res.headers["content-type"] || "";
        const status = res.statusCode || 0;
        resolve(status >= 200 && status < 300 && String(contentType).includes("text/html"));
        res.resume(); // Drain the response
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

/**
 * Check if the server on a given port is a Hilt dev server (not some other Next.js app).
 * Identifies Hilt by hitting /api/ws-port — a Hilt-specific route that returns JSON.
 * Other Next.js apps (e.g. Loft) return HTML 404 for unknown paths.
 */
async function isHiltServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "localhost", port, path: "/api/ws-port", method: "GET", timeout: 2000 },
      (res) => {
        const contentType = res.headers["content-type"] || "";
        // Hilt's route returns JSON for both success (200) and "WS not running yet" (503).
        // A different Next.js app would return HTML 404 for this path.
        const status = res.statusCode || 0;
        const looksLikeHilt = String(contentType).includes("application/json") && (status === 200 || status === 503);
        resolve(looksLikeHilt);
        res.resume();
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

/**
 * Probe any configured source URL for Hilt's /api/ws-port route.
 * Accepts 200 (WS available) and 503 (Hilt route exists, WS still starting).
 */
async function isHiltSourceUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let endpoint: URL;
    try {
      // Append to the source's path instead of root-resolving so a
      // path-prefixed gateway source (e.g. https://host/hilt) probes
      // /hilt/api/ws-port, not /api/ws-port. Origin-only URLs unchanged.
      const base = new URL(url);
      const basePath = base.pathname.replace(/\/+$/, "");
      endpoint = new URL(`${basePath}/api/ws-port`, base);
    } catch {
      resolve(false);
      return;
    }

    const client = endpoint.protocol === "https:" ? https : http;
    const req = client.request(
      endpoint,
      { method: "GET", timeout: 2000 },
      (res: { statusCode?: number; headers: Record<string, string | string[] | undefined>; resume: () => void }) => {
        const contentType = String(res.headers["content-type"] || "");
        const status = res.statusCode;
        const looksLikeHilt = contentType.includes("application/json") && (status === 200 || status === 503);
        resolve(looksLikeHilt);
        res.resume();
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

async function resolveStartupUrl(sources: SourceConfig[], fallbackPort: number): Promise<string> {
  for (const source of sortSourcesByRank(sources)) {
    if (source.type === "local") {
      if (source.url) {
        try {
          const port = parseInt(new URL(source.url).port || "3000", 10);
          if (await isHiltServer(port)) return source.url;
        } catch {
          // Try the local server started for this launch.
        }
      }
      if (await isHiltServer(fallbackPort)) return `http://localhost:${fallbackPort}`;
      continue;
    }

    if (!source.url) continue;
    if (await isHiltSourceUrl(source.url)) {
      return source.url;
    }
  }

  return `http://localhost:${fallbackPort}`;
}

/**
 * Find an existing Hilt dev server on common ports.
 * Uses isHiltServer so we don't accidentally attach to a different app (e.g. Loft)
 * that happens to be on port 3000.
 */
async function findExistingDevServer(ports: number[]): Promise<number | null> {
  for (const port of ports) {
    if (await isHiltServer(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Detect recent Turbopack panic logs and clear .next/dev/cache if found.
 * Turbopack writes next-panic-*.log files to the OS tmpdir when its on-disk
 * task database gets corrupt. The corruption persists across launches and
 * causes routes to return HTTP 500 forever — which silently breaks features
 * like the week-recycle endpoint.
 */
function recoverFromTurbopackPanic(projectRoot: string): void {
  try {
    const tmpDir = os.tmpdir();
    const panicLogs = fs.readdirSync(tmpDir)
      .filter((f: string) => f.startsWith("next-panic-") && f.endsWith(".log"));
    if (panicLogs.length === 0) return;

    // Only react to logs from the last 7 days; anything older was likely from a
    // long-resolved incident and we don't want to nuke a healthy cache.
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = panicLogs.filter((f: string) => {
      try {
        return fs.statSync(path.join(tmpDir, f)).mtimeMs >= cutoff;
      } catch {
        return false;
      }
    });
    if (recent.length === 0) return;

    sendStartupActivity({
      id: "turbopack-recovery",
      label: "Recovering from Turbopack corruption",
      status: "active",
      detail: `Found ${recent.length} recent panic log(s); clearing dev cache`,
    });

    const cachePath = path.join(projectRoot, ".next", "dev", "cache");
    if (fs.existsSync(cachePath)) {
      console.log(`Clearing corrupt Turbopack cache at ${cachePath}`);
      fs.rmSync(cachePath, { recursive: true, force: true });
    }

    for (const f of recent) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    }

    sendStartupActivity({
      id: "turbopack-recovery",
      label: "Recovering from Turbopack corruption",
      status: "complete",
      detail: "Dev cache cleared",
    });
  } catch (err) {
    console.error("Turbopack panic recovery failed:", err);
  }
}

/**
 * Wait for a server to be ready
 */
async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await checkDevServer(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Read sources configuration from disk (tries Electron DATA_DIR then project-local)
 */
function readSourcesConfig(): SourceConfig[] {
  const candidates = [
    path.join(DATA_DIR, "sources.json"),
    path.join(path.resolve(__dirname, ".."), "data", "sources.json"),
  ];
  for (const sourcesPath of candidates) {
    try {
      if (fs.existsSync(sourcesPath)) {
        const data = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
        if (Array.isArray(data)) return data;
      }
    } catch {
      // Try next
    }
  }
  return [];
}

/**
 * Write sources configuration back to disk (Electron DATA_DIR)
 */
function writeSourcesConfig(sources: SourceConfig[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(DATA_DIR, "sources.json"), JSON.stringify(sources, null, 2));
  // Also write to project-local for dev server compatibility
  const projectDataDir = path.join(path.resolve(__dirname, ".."), "data");
  if (fs.existsSync(projectDataDir)) {
    fs.writeFileSync(path.join(projectDataDir, "sources.json"), JSON.stringify(sources, null, 2));
  }
}

/**
 * Spawn the Next.js child process for a source (dev or production per
 * resolveServerMode). Shared by initial startup and rebuild restarts.
 */
function spawnSourceServerProcess(
  source: { id: string; name: string; folder?: string },
  port: number
): ChildProcess {
  const projectDir = path.resolve(__dirname, "..");
  const spec = nextSpawnSpec(projectDir, port);

  // Ensure log directory exists
  const logDir = path.join(app.getPath("userData"), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logPath = path.join(logDir, `dev-server-${source.id}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n--- ${spec.label} server for ${source.name} starting at ${new Date().toISOString()} ---\n`);

  const env = childEnv({
    PORT: String(port),
    FORCE_COLOR: "0",
    ...spec.env,
    ...(source.folder && {
      HILT_WORKING_FOLDER: source.folder,
      BRIDGE_VAULT_PATH: source.folder,
    }),
  });

  const serverProcess = spawn("npm", spec.args, {
    cwd: projectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  serverProcess.stdout?.pipe(logStream);
  serverProcess.stderr?.pipe(logStream);

  serverProcess.stdout?.on("data", (data: Buffer) => {
    console.log(`[Server:${source.name}]`, data.toString().trim());
  });
  serverProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[Server:${source.name} Error]`, data.toString().trim());
  });

  serverProcess.on("error", (err: Error) => {
    console.error(`Failed to start server for ${source.name}:`, err);
  });

  serverProcess.on("close", (code: number | null) => {
    console.log(`Server for ${source.name} exited with code ${code}`);
    // Only clear the registry entry if it still points at this process — a
    // rebuild restart may already have replaced it with a fresh child.
    if (servers.get(source.id)?.process === serverProcess) {
      servers.delete(source.id);
    }
  });

  return serverProcess;
}

/**
 * Start a server for a specific source's folder
 */
async function startServerForSource(source: SourceConfig): Promise<ServerInstance> {
  const projectDir = path.resolve(__dirname, "..");

  // Clean stale Next.js lock file that prevents startup after crashes
  const lockFile = path.join(projectDir, ".next", "dev", "lock");
  if (fs.existsSync(lockFile)) {
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }

  const port = await findAvailablePort(3000);

  sendStartupActivity({
    id: `server-${source.id}`,
    label: `Starting server for ${source.name}`,
    status: "active",
    detail: `Launching on port ${port}...`,
  });

  const serverProcess = spawnSourceServerProcess(source, port);

  // Wait for server to be ready
  const ready = await waitForServer(port, 60000);
  if (ready) {
    sendStartupActivity({
      id: `server-${source.id}`,
      label: `Starting server for ${source.name}`,
      status: "complete",
      detail: `Ready on port ${port}`,
    });
  } else {
    sendStartupActivity({
      id: `server-${source.id}`,
      label: `Starting server for ${source.name}`,
      status: "error",
      detail: "Timeout waiting for server",
    });
  }

  const instance: ServerInstance = {
    process: serverProcess,
    port,
    folder: source.folder || "",
    sourceId: source.id,
    name: source.name,
  };
  servers.set(source.id, instance);
  return instance;
}

/**
 * Spawn the single-server Next.js child (dev or production per
 * resolveServerMode). Shared by initial startup and rebuild restarts.
 */
function spawnPrimaryServerProcess(port: number): ChildProcess {
  const projectDir = path.resolve(__dirname, "..");
  const spec = nextSpawnSpec(projectDir, port);

  // Ensure log directory exists
  const logDir = path.join(app.getPath("userData"), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logPath = path.join(logDir, "dev-server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n--- ${spec.label} server starting at ${new Date().toISOString()} ---\n`);

  const child = spawn("npm", spec.args, {
    cwd: projectDir,
    env: childEnv({ PORT: String(port), FORCE_COLOR: "0", ...spec.env }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  // Pipe output to log file
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  // Also log to console for debugging
  child.stdout?.on("data", (data: Buffer) => {
    console.log("[Server]", data.toString().trim());
  });
  child.stderr?.on("data", (data: Buffer) => {
    console.error("[Server Error]", data.toString().trim());
  });

  child.on("error", (err) => {
    console.error(`Failed to start ${spec.label} server:`, err);
  });

  child.on("close", (code) => {
    console.log(`${spec.label} server exited with code ${code}`);
    // Only clear the reference if it still points at this process — a rebuild
    // restart may already have replaced it with a fresh child.
    if (nextServer === child) {
      nextServer = null;
    }
  });

  return child;
}

/**
 * Start the embedded Next.js server (production) or manage dev server
 */
async function startNextServer(): Promise<number> {
  const isPackaged = app.isPackaged;

  // In development, check for existing server or start one
  if (!isPackaged) {
    // Check if a dev server is already running (e.g., from npm run dev in terminal)
    sendStartupActivity({
      id: "server-check",
      label: "Checking for dev server",
      status: "active",
      detail: "Scanning ports 3000-3004...",
    });

    const existingPort = await findExistingDevServer([3000, 3001, 3002, 3003, 3004]);
    if (existingPort) {
      console.log(`Found existing dev server on port ${existingPort}`);
      sendStartupActivity({
        id: "server-check",
        label: "Checking for dev server",
        status: "complete",
        detail: `Found existing server on port ${existingPort}`,
      });
      serverPort = existingPort;
      return existingPort;
    }

    sendStartupActivity({
      id: "server-check",
      label: "Checking for dev server",
      status: "complete",
      detail: "No existing server found",
    });

    // No server running - start one as a background child process
    // Clean stale Next.js lock file that prevents startup after crashes
    const projectRoot = path.join(__dirname, "..");
    const lockFile = path.join(projectRoot, ".next", "dev", "lock");
    if (fs.existsSync(lockFile)) {
      console.log("Removing stale .next/dev/lock file");
      try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
    }

    // If Turbopack panicked recently (corrupt cache), wipe .next/dev/cache so the
    // dev server can rebuild cleanly. Otherwise the corruption persists across
    // sessions and routes silently 500 (which silently fails recycle, etc.).
    // Only relevant in dev mode — production serves a prebuilt bundle.
    const modeLabel = resolveServerMode(projectRoot) === "prod" ? "production" : "dev";
    if (modeLabel === "dev") {
      recoverFromTurbopackPanic(projectRoot);
    }

    const port = await findAvailablePort(3000);
    console.log(`Starting ${modeLabel} server on port ${port}...`);

    sendStartupActivity({
      id: "server-start",
      label: `Starting ${modeLabel} server`,
      status: "active",
      detail: `Launching on port ${port}...`,
    });

    nextServer = spawnPrimaryServerProcess(port);

    // Wait for server to be ready (up to 60 seconds)
    console.log(`Waiting for ${modeLabel} server to be ready...`);
    sendStartupActivity({
      id: "server-start",
      label: `Starting ${modeLabel} server`,
      status: "active",
      detail: "Waiting for server to respond...",
    });

    const ready = await waitForServer(port, 60000);
    if (!ready) {
      console.error(`${modeLabel} server failed to start within 60 seconds`);
      sendStartupActivity({
        id: "server-start",
        label: `Starting ${modeLabel} server`,
        status: "error",
        detail: "Server failed to start within 60 seconds",
        error: "Timeout waiting for server",
      });
      // Continue anyway - might work
    } else {
      console.log(`${modeLabel} server ready on port ${port}`);
      sendStartupActivity({
        id: "server-start",
        label: `Starting ${modeLabel} server`,
        status: "complete",
        detail: `Server ready on port ${port}`,
      });
    }

    serverPort = port;
    return port;
  }

  // Production: start the standalone server
  sendStartupActivity({
    id: "server-start",
    label: "Starting production server",
    status: "active",
    detail: "Finding available port...",
  });

  const port = await findAvailablePort(3000);
  serverPort = port;

  sendStartupActivity({
    id: "server-start",
    label: "Starting production server",
    status: "active",
    detail: `Launching on port ${port}...`,
  });

  return new Promise((resolve, reject) => {
    const standaloneDir = path.join(process.resourcesPath, "app", ".next", "standalone");
    const serverPath = path.join(standaloneDir, "server.js");

    // Use system node + detached process group to prevent a second dock icon.
    // macOS shows dock icons for child processes in the same process group as
    // a .app bundle, so we detach into a new group and kill on exit.
    let nodeBin = process.execPath;
    let extraEnv: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
    try {
      const systemNode = execSync("which node", { encoding: "utf-8" }).trim();
      if (systemNode) {
        nodeBin = systemNode;
        extraEnv = {};
      }
    } catch {
      // No system node — fall back to Electron binary as Node
    }

    nextServer = spawn(nodeBin, [serverPath], {
      env: {
        ...childEnv(),
        ...extraEnv,
        PORT: String(port),
        NODE_ENV: "production",
      },
      cwd: standaloneDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let started = false;

    nextServer.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      console.log("[Next.js]", output);

      // Check if server has started
      if (!started && (output.includes("Ready") || output.includes(`localhost:${port}`))) {
        started = true;
        sendStartupActivity({
          id: "server-start",
          label: "Starting production server",
          status: "complete",
          detail: `Server ready on port ${port}`,
        });
        resolve(port);
      }
    });

    nextServer.stderr?.on("data", (data: Buffer) => {
      console.error("[Next.js Error]", data.toString());
    });

    nextServer.on("error", (err) => {
      console.error("Failed to start Next.js server:", err);
      sendStartupActivity({
        id: "server-start",
        label: "Starting production server",
        status: "error",
        detail: "Failed to start server",
        error: err.message,
      });
      reject(err);
    });

    nextServer.on("close", (code) => {
      console.log(`Next.js server exited with code ${code}`);
      nextServer = null;
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!started) {
        // Try to connect anyway - server might be ready
        started = true;
        resolve(port);
      }
    }, 30000);
  });
}

/**
 * Start the WebSocket server (handles real-time events + file watching)
 * The WS server has its own lock file (~/.hilt-server.lock) to prevent duplicates,
 * so if one is already running (e.g. from terminal dev:all), this will gracefully exit.
 */
function startWsServer(): void {
  const projectDir = path.resolve(__dirname, "..");

  // Ensure log directory exists
  const logDir = path.join(app.getPath("userData"), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logPath = path.join(logDir, "ws-server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n--- WS server starting at ${new Date().toISOString()} ---\n`);

  // Pin WS to a port range that can't collide with the Next.js dev server.
  // findAvailablePort(3000) for Next.js can return 3001+ when 3000 is taken
  // by another app (e.g. Loft). Without WS_PORT, the WS server defaults to
  // 3001 too, and whichever process binds first wins — leaving the other to
  // crash. Using nextPort + 100 leaves room for several Next.js shifts before
  // we'd ever collide.
  const nextPort = serverPort ?? 3000;
  const wsPort = nextPort + 100;

  wsServer = spawn("npm", ["run", "ws-server"], {
    cwd: projectDir,
    env: childEnv({ FORCE_COLOR: "0", WS_PORT: String(wsPort) }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  wsServer.stdout?.pipe(logStream);
  wsServer.stderr?.pipe(logStream);

  wsServer.stdout?.on("data", (data: Buffer) => {
    console.log("[WS Server]", data.toString().trim());
  });
  wsServer.stderr?.on("data", (data: Buffer) => {
    console.error("[WS Server Error]", data.toString().trim());
  });

  wsServer.on("error", (err) => {
    console.error("Failed to start WS server:", err);
  });

  wsServer.on("close", (code) => {
    console.log(`WS server exited with code ${code}`);
    wsServer = null;
  });
}

/**
 * Create the main application window
 */
async function createWindow() {
  // Ensure data directory exists
  sendStartupActivity({
    id: "init-data",
    label: "Initializing data directory",
    status: "active",
  });

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  sendStartupActivity({
    id: "init-data",
    label: "Initializing data directory",
    status: "complete",
    detail: DATA_DIR,
  });

  // Read sources and start servers
  const sources = sortSourcesByRank(readSourcesConfig());
  const localSourcesWithFolder = sources.filter(s => s.type === "local" && s.folder);
  let port: number;

  if (localSourcesWithFolder.length > 0 && !app.isPackaged) {
    // Multi-source: spawn one server per local source with folder
    sendStartupActivity({
      id: "server-check",
      label: "Starting source servers",
      status: "active",
      detail: `${localSourcesWithFolder.length} local source(s)...`,
    });

    // Check if any source already has a running server
    for (const src of localSourcesWithFolder) {
      if (src.url) {
        try {
          const existingPort = parseInt(new URL(src.url).port || "3000");
          if (await isHiltServer(existingPort)) {
            console.log(`Found existing server for ${src.name} on port ${existingPort}`);
            servers.set(src.id, {
              process: null as unknown as ChildProcess,
              port: existingPort,
              folder: src.folder || "",
              sourceId: src.id,
              name: src.name,
            });
            continue;
          }
        } catch { /* ignore URL parse errors */ }
      }
      const instance = await startServerForSource(src);
      // Write assigned URL back to source config
      src.url = `http://localhost:${instance.port}`;
    }

    // Write updated URLs back
    writeSourcesConfig(sources);

    sendStartupActivity({
      id: "server-check",
      label: "Starting source servers",
      status: "complete",
      detail: `${servers.size} server(s) running`,
    });

    // Keep a local port available even when startup opens a higher-priority remote.
    const firstInstance = servers.get(localSourcesWithFolder[0].id);
    port = firstInstance?.port ?? 3000;
    serverPort = port;
  } else {
    // No local sources with folders, or packaged: use existing single-server approach
    console.log("Starting Next.js server...");
    port = await startNextServer();
    serverPort = port;
  }
  console.log(`Next.js server running on port ${port}`);

  // Start the WS server (real-time events, file watching)
  if (!app.isPackaged) {
    sendStartupActivity({
      id: "ws-server",
      label: "Starting WebSocket server",
      status: "active",
    });
    startWsServer();
    sendStartupActivity({
      id: "ws-server",
      label: "Starting WebSocket server",
      status: "complete",
      detail: "WS server launched",
    });
  }

  sendStartupActivity({
    id: "create-window",
    label: "Creating application window",
    status: "active",
  });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: IPHONE_SE_VIEWPORT.width,
    minHeight: IPHONE_SE_VIEWPORT.height,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 22 },
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  sendStartupActivity({
    id: "create-window",
    label: "Creating application window",
    status: "complete",
  });

  // Load the first available source by configured order.
  const startupUrl = await resolveStartupUrl(sources, port);
  sendStartupActivity({
    id: "load-app",
    label: "Loading application",
    status: "active",
    detail: `Connecting to ${new URL(startupUrl).host}...`,
  });

  mainWindow.loadURL(startupUrl);

  // Log any load errors
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Failed to load: ${errorCode} - ${errorDescription}`);
    sendStartupActivity({
      id: "load-app",
      label: "Loading application",
      status: "error",
      detail: `Error ${errorCode}`,
      error: errorDescription,
    });
  });

  // Inject Electron-specific CSS and flush startup events
  mainWindow.webContents.on("did-finish-load", () => {
    sendStartupActivity({
      id: "load-app",
      label: "Loading application",
      status: "complete",
      detail: "Application loaded",
    });

    // Now that renderer is ready, flush any pending startup activities
    flushPendingStartupActivities();

    mainWindow?.webContents.insertCSS(`
      /* Add left padding to status bar for macOS traffic light buttons */
      [data-statusbar] { padding-left: 80px; }
    `);
  });

  // Keyboard shortcuts for back/forward navigation (Cmd+[ / Cmd+])
  // Uses history.back()/forward() for SPA-style popstate navigation, not full page nav
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!mainWindow) return;
    if (input.meta && input.type === "keyDown") {
      if (input.key === "[") {
        event.preventDefault();
        mainWindow.webContents.executeJavaScript("window.history.back()");
      } else if (input.key === "]") {
        event.preventDefault();
        mainWindow.webContents.executeJavaScript("window.history.forward()");
      }
    }
  });

  // Trackpad swipe gestures for back/forward (macOS two-finger swipe)
  mainWindow.on("swipe", (_event, direction) => {
    if (!mainWindow) return;
    if (direction === "left") {
      mainWindow.webContents.executeJavaScript("window.history.back()");
    } else if (direction === "right") {
      mainWindow.webContents.executeJavaScript("window.history.forward()");
    }
  });

  // Open external links in the default browser instead of inside Electron
  // Build internal URL allowlist from configured sources
  const getSourceUrls = (): string[] => {
    // Merge URLs from all candidate files (Electron DATA_DIR + project-local)
    // so sources saved by either the dev server or Electron are recognized
    const candidates = [
      path.join(DATA_DIR, "sources.json"),
      path.join(path.resolve(__dirname, ".."), "data", "sources.json"),
    ];
    const urls = new Set<string>();
    for (const sourcesPath of candidates) {
      try {
        if (fs.existsSync(sourcesPath)) {
          const data = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
          if (Array.isArray(data)) {
            for (const s of data) {
              if (s.url) urls.add(s.url);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
    return Array.from(urls);
  };

  const isInternalUrl = (url: string) => {
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) return true;
    const sourceUrls = getSourceUrls();
    return sourceUrls.some(srcUrl => url.startsWith(srcUrl));
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Hide on close instead of destroying (Slack-style) — keeps renderer alive
  // so WebSocket connections persist and navigate commands always work
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Setup plan file watcher
  setupPlanWatcher();

  // Setup navigate file watcher — main-process path that survives renderer
  // throttling (backgrounded windows pause setTimeout, breaking WS reconnect).
  setupNavigateWatcher();

  // In prod mode, watch for `npm run rebuild` completions and hot-swap the
  // Next.js children without restarting the Electron wrapper.
  setupRebuildWatcher();
}

/**
 * Rebuild watcher (prod mode only).
 *
 * `npm run rebuild` runs `next build` into .next-prod and then touches
 * .next-prod/.hilt-rebuild-stamp as the build-complete signal (BUILD_ID alone
 * is written mid-build, so it can't be trusted as a completion marker). On
 * stamp change we restart the owned Next.js children on their existing ports
 * and reload the window — the tweak → rebuild → see-it loop without ever
 * relaunching the app.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rebuildWatcher: any = null;
// Single-flight guard shared by rebuild restarts and mode switches — only one
// server transition (kill + respawn) may run at a time.
let serverTransitionRunning = false;

/** Wait until nothing is listening on the port (mirrors findAvailablePort's probes). */
async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const probe = (host?: string): Promise<boolean> =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      const cb = () => server.close(() => resolve(true));
      if (host) server.listen(port, host, cb);
      else server.listen(port, cb);
    });

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await probe()) && (await probe("127.0.0.1"))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** Whether this Electron instance spawned (and therefore can restart) any Next.js server. */
function hasOwnedServers(): boolean {
  if (nextServer) return true;
  for (const instance of servers.values()) {
    if (instance.process) return true;
  }
  return false;
}

/**
 * Kill and respawn every owned Next.js child on its existing port, using the
 * CURRENT app mode's spawn spec. Returns true when all servers came back.
 */
async function restartOwnedServers(): Promise<boolean> {
  let allReady = true;

  // Multi-source servers (skip entries attached to external servers we don't own)
  for (const instance of Array.from(servers.values())) {
    if (!instance.process) continue;
    killProcessGroup(instance.process);
    await waitForPortFree(instance.port, 15000);
    instance.process = spawnSourceServerProcess(
      { id: instance.sourceId, name: instance.name, folder: instance.folder || undefined },
      instance.port
    );
    servers.set(instance.sourceId, instance);
    // 90s: a cold dev server compiles its first route inside this wait.
    const ready = await waitForServer(instance.port, 90000);
    if (!ready) allReady = false;
    console.log(`Server for ${instance.name} restarted on port ${instance.port}${ready ? "" : " (not ready)"}`);
  }

  // Single-server path
  if (nextServer && serverPort !== null) {
    const port = serverPort;
    killProcessGroup(nextServer);
    nextServer = null;
    await waitForPortFree(port, 15000);
    nextServer = spawnPrimaryServerProcess(port);
    const ready = await waitForServer(port, 90000);
    if (!ready) allReady = false;
    console.log(`Server restarted on port ${port}${ready ? "" : " (not ready)"}`);
  }

  return allReady;
}

async function restartServersAfterRebuild(): Promise<void> {
  if (serverTransitionRunning) return;
  // A rebuild during a dev session must not restart the dev server — the stamp
  // only matters to a server that serves the prod build.
  if (currentAppMode !== "prod") {
    console.log("Rebuild stamp changed while in dev mode — ignoring (prod build refreshed for later).");
    return;
  }
  serverTransitionRunning = true;
  try {
    console.log("Rebuild detected — restarting Next.js server(s) on the new build...");
    await restartOwnedServers();
    mainWindow?.webContents.reloadIgnoringCache();
    console.log("Rebuild restart complete — window reloaded.");
  } finally {
    serverTransitionRunning = false;
  }
}

async function setupRebuildWatcher() {
  if (app.isPackaged) return;
  try {
    const chokidar = await import("chokidar");
    const stampPath = path.join(path.resolve(__dirname, ".."), REBUILD_STAMP);
    rebuildWatcher = chokidar.watch(stampPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    rebuildWatcher.on("add", () => void restartServersAfterRebuild());
    rebuildWatcher.on("change", () => void restartServersAfterRebuild());
    console.log(`Watching for production rebuilds at: ${stampPath}`);
  } catch (err) {
    console.error("Error setting up rebuild watcher:", err);
  }
}

// ─── Runtime mode switch (UI-driven via IPC) ───

interface AppModeStatus {
  state: "idle" | "rebuilding" | "switching" | "reverting";
  mode: AppMode;
  target?: AppMode;
  detail?: string;
}

let appModeStatus: AppModeStatus = { state: "idle", mode: currentAppMode };
let rebuildChild: ChildProcess | null = null;

function sendAppModeStatus(status: AppModeStatus): void {
  appModeStatus = status;
  mainWindow?.webContents.send("app-mode:status", status);
}

/** Run `npm run rebuild` (build into .next-prod + touch the stamp). */
function runRebuild(): Promise<boolean> {
  return new Promise((resolve) => {
    const projectDir = path.resolve(__dirname, "..");
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logStream = fs.createWriteStream(path.join(logDir, "rebuild.log"), { flags: "a" });
    logStream.write(`\n--- rebuild starting at ${new Date().toISOString()} ---\n`);

    rebuildChild = spawn("npm", ["run", "rebuild"], {
      cwd: projectDir,
      env: childEnv({ FORCE_COLOR: "0" }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    rebuildChild.stdout?.pipe(logStream);
    rebuildChild.stderr?.pipe(logStream);
    rebuildChild.on("error", (err) => {
      console.error("Rebuild failed to start:", err);
      rebuildChild = null;
      resolve(false);
    });
    rebuildChild.on("close", (code) => {
      rebuildChild = null;
      resolve(code === 0);
    });
  });
}

/**
 * Hot-swap the server mode under the running window. Switching to prod
 * rebuilds FIRST (the old server keeps serving — zero downtime), then swaps.
 * If the new mode's server fails to come up, revert to the previous mode so
 * the window never ends up dead.
 */
async function switchAppMode(target: AppMode): Promise<{ ok: boolean; mode: AppMode; error?: string }> {
  if (target === currentAppMode) return { ok: true, mode: currentAppMode };
  if (serverTransitionRunning) return { ok: false, mode: currentAppMode, error: "Another server transition is already running" };
  if (!hasOwnedServers()) {
    return { ok: false, mode: currentAppMode, error: "Hilt is attached to an external server it doesn't manage — switch modes where that server runs" };
  }

  serverTransitionRunning = true;
  const previous = currentAppMode;
  try {
    if (target === "prod") {
      // The build always runs on switch-to-prod: after a dev session the prod
      // build is stale by definition. The current server serves throughout.
      sendAppModeStatus({ state: "rebuilding", mode: previous, target, detail: "Building production bundle (~30s)" });
      const built = await runRebuild();
      if (!built) {
        sendAppModeStatus({ state: "idle", mode: previous, detail: "Build failed — see rebuild.log" });
        return { ok: false, mode: previous, error: "Production build failed — staying in dev mode" };
      }
    }

    currentAppMode = target;
    sendAppModeStatus({ state: "switching", mode: previous, target, detail: "Restarting server" });
    const ready = await restartOwnedServers();

    if (!ready) {
      console.error(`Mode switch to ${target} failed — reverting to ${previous}`);
      currentAppMode = previous;
      sendAppModeStatus({ state: "reverting", mode: previous, target, detail: `${target} server failed — restoring ${previous}` });
      await restartOwnedServers();
      persistAppMode(previous);
      sendAppModeStatus({ state: "idle", mode: previous, detail: `Switch to ${target} failed — reverted` });
      mainWindow?.webContents.reloadIgnoringCache();
      return { ok: false, mode: previous, error: `The ${target} server failed to start — reverted to ${previous}` };
    }

    persistAppMode(target);
    sendAppModeStatus({ state: "idle", mode: target });
    mainWindow?.webContents.reloadIgnoringCache();
    console.log(`App mode switched: ${previous} → ${target}`);
    return { ok: true, mode: target };
  } finally {
    serverTransitionRunning = false;
  }
}

/**
 * Setup plan file watcher
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plansWatcher: any = null;

async function setupPlanWatcher() {
  try {
    const chokidar = await import("chokidar");

    if (!fs.existsSync(PLANS_DIR)) {
      console.log(`Plans directory doesn't exist yet: ${PLANS_DIR}`);
      return;
    }

    plansWatcher = chokidar.watch(path.join(PLANS_DIR, "*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    plansWatcher.on("add", (filePath: string) => {
      const slug = path.basename(filePath, ".md");
      console.log(`New plan detected: ${slug}`);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (mainWindow) {
          mainWindow.webContents.send("plan:created", {
            event: "created",
            slug,
            path: filePath,
            content,
          });
        }
      } catch (err) {
        console.error(`Error reading new plan ${filePath}:`, err);
      }
    });

    plansWatcher.on("change", (filePath: string) => {
      const slug = path.basename(filePath, ".md");
      console.log(`Plan updated: ${slug}`);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (mainWindow) {
          mainWindow.webContents.send("plan:updated", {
            event: "updated",
            slug,
            path: filePath,
            content,
          });
        }
      } catch (err) {
        console.error(`Error reading updated plan ${filePath}:`, err);
      }
    });

    console.log(`Watching for plans in: ${PLANS_DIR}`);
  } catch (err) {
    console.error("Error setting up plans watcher:", err);
  }
}

/**
 * Setup navigate file watcher.
 *
 * The WS server's POST /navigate writes to ~/.hilt-pending-navigate.json. We
 * watch that file from the main process (never throttled) and forward via
 * webContents IPC, so navigate works even when the renderer's WS reconnect
 * timer is paused by a backgrounded window.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let navigateWatcher: any = null;
let lastNavigateTs = 0;

async function setupNavigateWatcher() {
  try {
    const chokidar = await import("chokidar");
    navigateWatcher = chokidar.watch(NAVIGATE_FILE, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });

    const handleChange = () => {
      try {
        if (!fs.existsSync(NAVIGATE_FILE)) return;
        const raw = fs.readFileSync(NAVIGATE_FILE, "utf-8");
        const intent = JSON.parse(raw) as { view: string; path?: string; ts: number };
        // Dedupe: identical timestamps mean we already handled this write.
        if (intent.ts === lastNavigateTs) return;
        lastNavigateTs = intent.ts;
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("navigate:goto", {
          view: intent.view,
          path: intent.path || "",
        });
      } catch (err) {
        console.error("Error handling navigate file:", err);
      }
    };

    navigateWatcher.on("add", handleChange);
    navigateWatcher.on("change", handleChange);

    console.log(`Watching for navigate intents at: ${NAVIGATE_FILE}`);
  } catch (err) {
    console.error("Error setting up navigate watcher:", err);
  }
}

// IPC handlers
ipcMain.on("window:focus", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle("app-mode:get", () => ({
  mode: currentAppMode,
  supervised: hasOwnedServers(),
  prodBuildAvailable: prodBuildAvailable(path.resolve(__dirname, "..")),
  status: appModeStatus,
}));

ipcMain.handle("app-mode:switch", async (_event, mode: unknown) => {
  if (mode !== "dev" && mode !== "prod") {
    return { ok: false, mode: currentAppMode, error: "Invalid mode" };
  }
  return switchAppMode(mode);
});

ipcMain.handle("dialog:selectFolder", async () => {
  if (!mainWindow) return { cancelled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select folder",
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }
  return { path: result.filePaths[0] };
});

// Single-instance lock — focus existing window instead of spawning a duplicate
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // App lifecycle
  app.whenReady().then(createWindow);
}

/** Kill a detached process and its entire process group. */
function killProcessGroup(proc: ChildProcess | null): void {
  if (!proc) return;
  try {
    // Kill the process group (negative PID) so all children die too
    if (proc.pid) process.kill(-proc.pid);
  } catch {
    // Process may already be dead — try direct kill as fallback
    try { proc.kill(); } catch { /* ignore */ }
  }
}

function killAllServers() {
  killProcessGroup(rebuildChild);
  rebuildChild = null;
  killProcessGroup(nextServer);
  nextServer = null;
  for (const [id, instance] of servers) {
    killProcessGroup(instance.process);
    servers.delete(id);
  }
  killProcessGroup(wsServer);
  wsServer = null;
  if (plansWatcher) {
    plansWatcher.close();
  }
  if (navigateWatcher) {
    navigateWatcher.close();
  }
  if (rebuildWatcher) {
    rebuildWatcher.close();
  }
}

app.on("window-all-closed", () => {
  // On macOS, windows hide instead of close, so this only fires on actual quit.
  // On other platforms, quit the app.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

// Handle app quit — set flag so close handler allows destroy
app.on("before-quit", () => {
  isQuitting = true;
  killAllServers();
});
