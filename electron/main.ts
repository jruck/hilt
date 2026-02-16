import { app, BrowserWindow, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";

// Set DATA_DIR to Electron's userData path before anything else
const DATA_DIR = path.join(app.getPath("userData"), "data");
process.env.DATA_DIR = DATA_DIR;

const PLANS_DIR = path.join(process.env.HOME || "~", ".claude", "plans");

// Track active windows and server processes
let mainWindow: BrowserWindow | null = null;
let nextServer: ChildProcess | null = null;
let wsServer: ChildProcess | null = null;
let serverPort: number | null = null;

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

/**
 * Find an available port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const net = require("net");
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * Check if a dev server is running on a given port
 */
async function checkDevServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const http = require("http");
    const req = http.request(
      { hostname: "localhost", port, path: "/", method: "GET", timeout: 2000 },
      (res: { statusCode: number; headers: Record<string, string>; resume: () => void }) => {
        // Must be a 2xx response with HTML content (not just any HTTP server like the WS server)
        const contentType = res.headers["content-type"] || "";
        resolve(res.statusCode >= 200 && res.statusCode < 300 && contentType.includes("text/html"));
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
 * Find an existing dev server on common ports
 */
async function findExistingDevServer(ports: number[]): Promise<number | null> {
  for (const port of ports) {
    if (await checkDevServer(port)) {
      return port;
    }
  }
  return null;
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
      detached: false, // Dies when Electron dies
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

    nextServer = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(port),
        DATA_DIR,
        NODE_ENV: "production",
      },
      cwd: standaloneDir,
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

  wsServer = spawn("npm", ["run", "ws-server"], {
    cwd: projectDir,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
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

  // Start the Next.js server
  console.log("Starting Next.js server...");
  const port = await startNextServer();
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

  // Load the Next.js app
  sendStartupActivity({
    id: "load-app",
    label: "Loading application",
    status: "active",
    detail: `Connecting to localhost:${port}...`,
  });

  mainWindow.loadURL(`http://localhost:${port}`);

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
  const isInternalUrl = (url: string) =>
    url.startsWith("http://localhost") ||
    url.startsWith("http://127.0.0.1") ||
    url.startsWith("https://xochipilli.tailc0acaa.ts.net");

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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Setup plan file watcher
  setupPlanWatcher();
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

// App lifecycle
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  // Kill the Next.js server
  if (nextServer) {
    nextServer.kill();
    nextServer = null;
  }

  // Kill the WS server
  if (wsServer) {
    wsServer.kill();
    wsServer = null;
  }

  // Clean up plan watcher
  if (plansWatcher) {
    plansWatcher.close();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle app quit
app.on("before-quit", () => {
  if (nextServer) {
    nextServer.kill();
  }
  if (wsServer) {
    wsServer.kill();
  }
  if (plansWatcher) {
    plansWatcher.close();
  }
});
