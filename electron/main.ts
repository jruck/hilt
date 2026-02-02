import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";

// Set DATA_DIR to Electron's userData path before anything else
const DATA_DIR = path.join(app.getPath("userData"), "data");
process.env.DATA_DIR = DATA_DIR;

// These modules are loaded dynamically at runtime after DATA_DIR is set
// They're outside the electron/ directory so we use require() instead of import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyManager: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getSessionById: any = null;

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

// Track which IPC clients are connected to which terminals
const ipcToTerminal = new Map<number, string>();
const terminalToIpc = new Map<string, Set<number>>();
// Track last known title per terminal
const terminalTitles = new Map<string, string>();
// Track last known context progress per terminal (0-100)
const terminalContextProgress = new Map<string, number>();

/**
 * Parse OSC sequences to extract terminal title changes
 */
function extractTitle(data: string): string | null {
  const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
  let lastTitle: string | null = null;
  let match;

  while ((match = oscRegex.exec(data)) !== null) {
    const code = match[1];
    const title = match[2].trim();
    if ((code === "0" || code === "2") && isClaudeStatusTitle(title)) {
      lastTitle = title;
    }
  }

  return lastTitle;
}

/**
 * Check if a title looks like a Claude Code status (not a shell command)
 */
function isClaudeStatusTitle(title: string): boolean {
  if (!title || title.length === 0) return false;
  if (title.startsWith("claude")) return false;
  if (title.startsWith("zsh")) return false;
  if (title.startsWith("bash")) return false;
  if (title.startsWith("/")) return false;
  if (title.startsWith("~")) return false;
  if (title.includes("--")) return false;
  if (/^[a-f0-9-]{20,}$/i.test(title)) return false;
  if (title.includes(" ") && title.length < 100) return true;
  if (title.length < 30 && /^[a-z][a-z\s]+$/i.test(title)) return true;
  return false;
}

/**
 * Extract context percentage from terminal output
 */
function extractContextProgress(data: string): number | null {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*%\s*context/i,
    /context[:\s]+(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*used/i,
  ];

  for (const pattern of patterns) {
    const match = data.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (value >= 0 && value <= 100) {
        return Math.round(value);
      }
    }
  }
  return null;
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
      { hostname: "localhost", port, method: "HEAD", timeout: 2000 },
      (res: { statusCode: number }) => {
        resolve(res.statusCode < 500);
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

  // Load modules - in development, tsx handles TypeScript compilation
  // In production, we need to use the bundled/compiled versions
  const isPackaged = app.isPackaged;

  sendStartupActivity({
    id: "load-modules",
    label: "Loading PTY manager",
    status: "active",
  });

  if (isPackaged) {
    // Production: use the standalone server's compiled modules
    // The pty-manager runs in the main electron process, so we need it here
    // For production, we inline a simple pty-manager implementation
    const ptyLib = require("node-pty");
    const { EventEmitter } = require("events");

    class PtyManager extends EventEmitter {
      private terminals: Map<string, { id: string; sessionId: string; pty: any; projectPath: string }> = new Map();
      private lastSpawnTime: Map<string, number> = new Map();

      spawn(terminalId: string, sessionId: string, projectPath: string, isNew?: boolean, initialPrompt?: string) {
        // Debounce rapid re-spawns (within 500ms)
        const now = Date.now();
        const lastSpawn = this.lastSpawnTime.get(terminalId);
        if (lastSpawn && now - lastSpawn < 500) {
          console.log(`Debouncing rapid spawn for ${terminalId} (last spawn ${now - lastSpawn}ms ago)`);
          const existing = this.terminals.get(terminalId);
          if (existing) {
            return existing;
          }
        }
        this.lastSpawnTime.set(terminalId, now);

        if (this.terminals.has(terminalId)) {
          this.kill(terminalId);
        }

        let cwd = projectPath || process.env.HOME || "/";
        try {
          if (!fs.existsSync(cwd)) {
            cwd = process.env.HOME || "/";
          }
        } catch {
          cwd = process.env.HOME || "/";
        }

        console.log(`Spawning terminal ${terminalId} for session ${sessionId} in ${cwd}`);

        const shell = process.env.SHELL || "/bin/zsh";
        const ptyProcess = ptyLib.spawn(shell, [], {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            FORCE_COLOR: "3",
          },
        });

        const session = { id: terminalId, sessionId, pty: ptyProcess, projectPath };
        this.terminals.set(terminalId, session);

        let promptSent = false;
        let watchingForReady = false;
        let outputBuffer = "";

        ptyProcess.onData((data: string) => {
          this.emit("data", terminalId, data);

          if (isNew && initialPrompt && !promptSent && watchingForReady) {
            outputBuffer += data;
            const hasClaudeCode = outputBuffer.includes("Claude") || outputBuffer.includes("claude");
            const hasBoxChars = outputBuffer.includes("╭") || outputBuffer.includes("╰") || outputBuffer.includes("│");
            const hasPromptChar = outputBuffer.includes(">") && outputBuffer.length > 100;
            const isReady = (hasClaudeCode && hasBoxChars) || (hasPromptChar && outputBuffer.length > 300) || outputBuffer.includes("Press Enter");

            if (isReady) {
              promptSent = true;
              setTimeout(() => {
                const usesBracketedPaste = initialPrompt.includes("\n") || initialPrompt.length > 200;
                if (usesBracketedPaste) {
                  ptyProcess.write("\x1b[200~");
                  ptyProcess.write(initialPrompt);
                  ptyProcess.write("\x1b[201~");
                } else {
                  ptyProcess.write(initialPrompt);
                }
                const enterDelay = Math.min(500, 100 + Math.floor(initialPrompt.length / 100) * 50);
                setTimeout(() => ptyProcess.write("\r"), enterDelay);
              }, 200);
            }
          }
        });

        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
          this.emit("exit", terminalId, exitCode);
          this.terminals.delete(terminalId);
        });

        setTimeout(() => {
          if (isNew && initialPrompt) {
            ptyProcess.write(`claude\r`);
            setTimeout(() => {
              outputBuffer = "";
              watchingForReady = true;
            }, 1500);
            setTimeout(() => {
              if (!promptSent) {
                promptSent = true;
                const usesBracketedPaste = initialPrompt.includes("\n") || initialPrompt.length > 200;
                if (usesBracketedPaste) {
                  ptyProcess.write("\x1b[200~");
                  ptyProcess.write(initialPrompt);
                  ptyProcess.write("\x1b[201~");
                } else {
                  ptyProcess.write(initialPrompt);
                }
                setTimeout(() => ptyProcess.write("\r"), 200);
              }
            }, 10000);
          } else {
            ptyProcess.write(`claude --resume ${sessionId}\r`);
          }
        }, 200);

        return session;
      }

      write(terminalId: string, data: string): boolean {
        const session = this.terminals.get(terminalId);
        if (!session) return false;
        try {
          session.pty.write(data);
          return true;
        } catch {
          return false;
        }
      }

      resize(terminalId: string, cols: number, rows: number): boolean {
        const session = this.terminals.get(terminalId);
        if (!session) return false;
        try {
          session.pty.resize(cols, rows);
          return true;
        } catch {
          return false;
        }
      }

      kill(terminalId: string): boolean {
        const session = this.terminals.get(terminalId);
        if (!session) return false;
        try {
          session.pty.kill();
        } catch {}
        this.terminals.delete(terminalId);
        return true;
      }

      get(terminalId: string) {
        return this.terminals.get(terminalId);
      }

      getAll() {
        return Array.from(this.terminals.values());
      }

      has(terminalId: string): boolean {
        return this.terminals.has(terminalId);
      }
    }

    ptyManager = new PtyManager();

    // For getSessionById, we read JSONL files directly in production
    getSessionById = async (sessionId: string) => {
      const claudeDir = path.join(process.env.HOME || "~", ".claude", "projects");
      try {
        const folders = fs.readdirSync(claudeDir, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const folder of folders) {
          const sessionFile = path.join(claudeDir, folder.name, `${sessionId}.jsonl`);
          if (fs.existsSync(sessionFile)) {
            // Decode the folder name to get projectPath
            const projectPath = decodeURIComponent(folder.name).replace(/-/g, "/");
            return { id: sessionId, projectPath: `/${projectPath}` };
          }
        }
      } catch {}
      return null;
    };
  } else {
    // Development: tsx handles TypeScript compilation
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptyModule = require("../src/lib/pty-manager.ts");
    ptyManager = ptyModule.ptyManager;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sessionsModule = require("../src/lib/claude-sessions.ts");
    getSessionById = sessionsModule.getSessionById;
  }

  sendStartupActivity({
    id: "load-modules",
    label: "Loading PTY manager",
    status: "complete",
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
      /* Hide Next.js dev indicator */
      [data-nextjs-dialog-overlay],
      [data-nextjs-toast],
      nextjs-portal { display: none !important; }

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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Setup IPC handlers
  setupIpcHandlers();

  // Setup plan file watcher
  setupPlanWatcher();
}

/**
 * Setup IPC handlers for PTY communication
 */
function setupIpcHandlers() {
  // Get window ID from sender
  const getWindowId = (event: Electron.IpcMainInvokeEvent): number => {
    return event.sender.id;
  };

  // Handle spawn requests
  ipcMain.handle("pty:spawn", async (event, data) => {
    const { terminalId, sessionId, projectPath, isNew, initialPrompt } = data;
    const windowId = getWindowId(event);

    if (!terminalId || !sessionId) {
      return { error: "Missing terminalId or sessionId" };
    }

    if (!ptyManager) {
      return { error: "PTY manager not initialized" };
    }

    let resolvedPath = projectPath;
    if (!resolvedPath && !isNew) {
      const session = await getSessionById(sessionId);
      resolvedPath = session?.projectPath || process.env.HOME || "/";
    }
    resolvedPath = resolvedPath || process.env.HOME || "/";

    ptyManager.spawn(terminalId, sessionId, resolvedPath, isNew, initialPrompt);

    ipcToTerminal.set(windowId, terminalId);
    if (!terminalToIpc.has(terminalId)) {
      terminalToIpc.set(terminalId, new Set());
    }
    terminalToIpc.get(terminalId)!.add(windowId);

    return { success: true, terminalId };
  });

  // Handle data writes
  ipcMain.handle("pty:write", async (_event, data) => {
    const { terminalId, data: inputData } = data;
    if (!terminalId || inputData === undefined) return { error: "Missing data" };
    ptyManager.write(terminalId, inputData);
    return { success: true };
  });

  // Handle resize
  ipcMain.handle("pty:resize", async (_event, data) => {
    const { terminalId, cols, rows } = data;
    if (!terminalId || !cols || !rows) return { error: "Missing dimensions" };
    ptyManager.resize(terminalId, cols, rows);
    return { success: true };
  });

  // Handle kill
  ipcMain.handle("pty:kill", async (event, data) => {
    const { terminalId } = data;
    const windowId = getWindowId(event);

    if (!terminalId) return { error: "Missing terminalId" };

    ptyManager.kill(terminalId);

    // Clean up tracking
    ipcToTerminal.delete(windowId);
    const ipcSet = terminalToIpc.get(terminalId);
    if (ipcSet) {
      ipcSet.delete(windowId);
      if (ipcSet.size === 0) {
        terminalToIpc.delete(terminalId);
      }
    }
    terminalTitles.delete(terminalId);
    terminalContextProgress.delete(terminalId);

    return { success: true };
  });

  // Forward PTY data to renderer
  if (!ptyManager) {
    return;
  }

  ptyManager.on("data", (terminalId: string, data: string) => {
    if (!mainWindow) return;

    // Check for title changes
    const newTitle = extractTitle(data);
    if (newTitle && newTitle !== terminalTitles.get(terminalId)) {
      terminalTitles.set(terminalId, newTitle);
      mainWindow.webContents.send("pty:title", { terminalId, title: newTitle });
    }

    // Check for context progress
    const newProgress = extractContextProgress(data);
    if (newProgress !== null && newProgress !== terminalContextProgress.get(terminalId)) {
      terminalContextProgress.set(terminalId, newProgress);
      mainWindow.webContents.send("pty:context", { terminalId, progress: newProgress });
    }

    // Forward data
    mainWindow.webContents.send("pty:data", { terminalId, data });
  });

  // Forward PTY exit events
  ptyManager.on("exit", (terminalId: string, exitCode: number) => {
    if (mainWindow) {
      mainWindow.webContents.send("pty:exit", { terminalId, exitCode });
    }
    terminalToIpc.delete(terminalId);
    terminalTitles.delete(terminalId);
    terminalContextProgress.delete(terminalId);
  });
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
          mainWindow.webContents.send("pty:plan", {
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
          mainWindow.webContents.send("pty:plan", {
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

  // Kill all terminals
  if (ptyManager) {
    ptyManager.getAll().forEach((session: { id: string }) => {
      ptyManager.kill(session.id);
    });
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
