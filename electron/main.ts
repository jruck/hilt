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

// Set DATA_DIR to Electron's userData path before anything else
const DATA_DIR = path.join(app.getPath("userData"), "data");
process.env.DATA_DIR = DATA_DIR;

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
}

// Track active windows and server processes
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let nextServer: ChildProcess | null = null;
let wsServer: ChildProcess | null = null;
let serverPort: number | null = null;
const servers = new Map<string, ServerInstance>();

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
      endpoint = new URL("/api/ws-port", url);
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
 * Start a dev server for a specific source's folder
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

  // Ensure log directory exists
  const logDir = path.join(app.getPath("userData"), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logPath = path.join(logDir, `dev-server-${source.id}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n--- Dev server for ${source.name} starting at ${new Date().toISOString()} ---\n`);

  const env = {
    ...process.env,
    PORT: String(port),
    FORCE_COLOR: "0",
    DATA_DIR,
    ...(source.folder && {
      HILT_WORKING_FOLDER: source.folder,
      BRIDGE_VAULT_PATH: source.folder,
    }),
  };

  const serverProcess = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
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
    servers.delete(source.id);
  });

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
  };
  servers.set(source.id, instance);
  return instance;
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
    recoverFromTurbopackPanic(projectRoot);

    const port = await findAvailablePort(3000);
    console.log(`Starting dev server on port ${port}...`);

    sendStartupActivity({
      id: "server-start",
      label: "Starting dev server",
      status: "active",
      detail: `Launching on port ${port}...`,
    });

    // Ensure log directory exists
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, "dev-server.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n--- Dev server starting at ${new Date().toISOString()} ---\n`);

    // Get the project directory (where package.json lives)
    const projectDir = path.resolve(__dirname, "..");

    nextServer = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port), FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    // Pipe output to log file
    nextServer.stdout?.pipe(logStream);
    nextServer.stderr?.pipe(logStream);

    // Also log to console for debugging
    nextServer.stdout?.on("data", (data: Buffer) => {
      console.log("[Dev Server]", data.toString().trim());
    });
    nextServer.stderr?.on("data", (data: Buffer) => {
      console.error("[Dev Server Error]", data.toString().trim());
    });

    nextServer.on("error", (err) => {
      console.error("Failed to start dev server:", err);
    });

    nextServer.on("close", (code) => {
      console.log(`Dev server exited with code ${code}`);
      nextServer = null;
    });

    // Wait for server to be ready (up to 60 seconds)
    console.log("Waiting for dev server to be ready...");
    sendStartupActivity({
      id: "server-start",
      label: "Starting dev server",
      status: "active",
      detail: "Waiting for server to respond...",
    });

    const ready = await waitForServer(port, 60000);
    if (!ready) {
      console.error("Dev server failed to start within 60 seconds");
      sendStartupActivity({
        id: "server-start",
        label: "Starting dev server",
        status: "error",
        detail: "Server failed to start within 60 seconds",
        error: "Timeout waiting for server",
      });
      // Continue anyway - might work
    } else {
      console.log(`Dev server ready on port ${port}`);
      sendStartupActivity({
        id: "server-start",
        label: "Starting dev server",
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
        ...process.env,
        ...extraEnv,
        PORT: String(port),
        DATA_DIR,
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
    env: { ...process.env, FORCE_COLOR: "0", WS_PORT: String(wsPort) },
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
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
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
