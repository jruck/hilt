"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
// Load .env file so Electron has access to the same env vars as Next.js
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1)
            continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key])
            process.env[key] = val;
    }
}
// Set DATA_DIR to Electron's userData path before anything else
const DATA_DIR = path.join(electron_1.app.getPath("userData"), "data");
process.env.DATA_DIR = DATA_DIR;
const PLANS_DIR = path.join(process.env.HOME || "~", ".claude", "plans");
// Track active windows and server processes
let mainWindow = null;
let isQuitting = false;
let nextServer = null;
let wsServer = null;
let serverPort = null;
const servers = new Map();
// Queue startup activities until window is ready
const pendingStartupActivities = [];
let windowReady = false;
function sendStartupActivity(activity) {
    if (mainWindow && windowReady) {
        mainWindow.webContents.send("startup:activity", activity);
    }
    else {
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
async function findAvailablePort(startPort) {
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
async function checkDevServer(port) {
    return new Promise((resolve) => {
        const http = require("http");
        const req = http.request({ hostname: "localhost", port, path: "/", method: "GET", timeout: 2000 }, (res) => {
            // Must be a 2xx response with HTML content (not just any HTTP server like the WS server)
            const contentType = res.headers["content-type"] || "";
            resolve(res.statusCode >= 200 && res.statusCode < 300 && contentType.includes("text/html"));
            res.resume(); // Drain the response
        });
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
async function isHiltServer(port) {
    return new Promise((resolve) => {
        const http = require("http");
        const req = http.request({ hostname: "localhost", port, path: "/api/ws-port", method: "GET", timeout: 2000 }, (res) => {
            const contentType = res.headers["content-type"] || "";
            // Hilt's route returns JSON for both success (200) and "WS not running yet" (503).
            // A different Next.js app would return HTML 404 for this path.
            const status = res.statusCode;
            const looksLikeHilt = contentType.includes("application/json") && (status === 200 || status === 503);
            resolve(looksLikeHilt);
            res.resume();
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}
/**
 * Find an existing Hilt dev server on common ports.
 * Uses isHiltServer so we don't accidentally attach to a different app (e.g. Loft)
 * that happens to be on port 3000.
 */
async function findExistingDevServer(ports) {
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
function recoverFromTurbopackPanic(projectRoot) {
    try {
        const os = require("os");
        const tmpDir = os.tmpdir();
        const panicLogs = fs.readdirSync(tmpDir)
            .filter((f) => f.startsWith("next-panic-") && f.endsWith(".log"));
        if (panicLogs.length === 0)
            return;
        // Only react to logs from the last 7 days; anything older was likely from a
        // long-resolved incident and we don't want to nuke a healthy cache.
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recent = panicLogs.filter((f) => {
            try {
                return fs.statSync(path.join(tmpDir, f)).mtimeMs >= cutoff;
            }
            catch {
                return false;
            }
        });
        if (recent.length === 0)
            return;
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
            try {
                fs.unlinkSync(path.join(tmpDir, f));
            }
            catch { /* ignore */ }
        }
        sendStartupActivity({
            id: "turbopack-recovery",
            label: "Recovering from Turbopack corruption",
            status: "complete",
            detail: "Dev cache cleared",
        });
    }
    catch (err) {
        console.error("Turbopack panic recovery failed:", err);
    }
}
/**
 * Wait for a server to be ready
 */
async function waitForServer(port, timeoutMs) {
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
function readSourcesConfig() {
    const candidates = [
        path.join(DATA_DIR, "sources.json"),
        path.join(path.resolve(__dirname, ".."), "data", "sources.json"),
    ];
    for (const sourcesPath of candidates) {
        try {
            if (fs.existsSync(sourcesPath)) {
                const data = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
                if (Array.isArray(data))
                    return data;
            }
        }
        catch {
            // Try next
        }
    }
    return [];
}
/**
 * Write sources configuration back to disk (Electron DATA_DIR)
 */
function writeSourcesConfig(sources) {
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
async function startServerForSource(source) {
    const projectDir = path.resolve(__dirname, "..");
    // Clean stale Next.js lock file that prevents startup after crashes
    const lockFile = path.join(projectDir, ".next", "dev", "lock");
    if (fs.existsSync(lockFile)) {
        try {
            fs.unlinkSync(lockFile);
        }
        catch { /* ignore */ }
    }
    const port = await findAvailablePort(3000);
    sendStartupActivity({
        id: `server-${source.id}`,
        label: `Starting server for ${source.name}`,
        status: "active",
        detail: `Launching on port ${port}...`,
    });
    // Ensure log directory exists
    const logDir = path.join(electron_1.app.getPath("userData"), "logs");
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
    const serverProcess = (0, child_process_1.spawn)("npm", ["run", "dev", "--", "--port", String(port)], {
        cwd: projectDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
    });
    serverProcess.stdout?.pipe(logStream);
    serverProcess.stderr?.pipe(logStream);
    serverProcess.stdout?.on("data", (data) => {
        console.log(`[Server:${source.name}]`, data.toString().trim());
    });
    serverProcess.stderr?.on("data", (data) => {
        console.error(`[Server:${source.name} Error]`, data.toString().trim());
    });
    serverProcess.on("error", (err) => {
        console.error(`Failed to start server for ${source.name}:`, err);
    });
    serverProcess.on("close", (code) => {
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
    }
    else {
        sendStartupActivity({
            id: `server-${source.id}`,
            label: `Starting server for ${source.name}`,
            status: "error",
            detail: "Timeout waiting for server",
        });
    }
    const instance = {
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
async function startNextServer() {
    const isPackaged = electron_1.app.isPackaged;
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
            try {
                fs.unlinkSync(lockFile);
            }
            catch { /* ignore */ }
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
        const logDir = path.join(electron_1.app.getPath("userData"), "logs");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logPath = path.join(logDir, "dev-server.log");
        const logStream = fs.createWriteStream(logPath, { flags: "a" });
        logStream.write(`\n--- Dev server starting at ${new Date().toISOString()} ---\n`);
        // Get the project directory (where package.json lives)
        const projectDir = path.resolve(__dirname, "..");
        nextServer = (0, child_process_1.spawn)("npm", ["run", "dev", "--", "--port", String(port)], {
            cwd: projectDir,
            env: { ...process.env, PORT: String(port), FORCE_COLOR: "0" },
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        });
        // Pipe output to log file
        nextServer.stdout?.pipe(logStream);
        nextServer.stderr?.pipe(logStream);
        // Also log to console for debugging
        nextServer.stdout?.on("data", (data) => {
            console.log("[Dev Server]", data.toString().trim());
        });
        nextServer.stderr?.on("data", (data) => {
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
        }
        else {
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
        const { execSync } = require("child_process");
        let nodeBin = process.execPath;
        let extraEnv = { ELECTRON_RUN_AS_NODE: "1" };
        try {
            const systemNode = execSync("which node", { encoding: "utf-8" }).trim();
            if (systemNode) {
                nodeBin = systemNode;
                extraEnv = {};
            }
        }
        catch {
            // No system node — fall back to Electron binary as Node
        }
        nextServer = (0, child_process_1.spawn)(nodeBin, [serverPath], {
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
        nextServer.stdout?.on("data", (data) => {
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
        nextServer.stderr?.on("data", (data) => {
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
function startWsServer() {
    const projectDir = path.resolve(__dirname, "..");
    // Ensure log directory exists
    const logDir = path.join(electron_1.app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, "ws-server.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n--- WS server starting at ${new Date().toISOString()} ---\n`);
    wsServer = (0, child_process_1.spawn)("npm", ["run", "ws-server"], {
        cwd: projectDir,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
    });
    wsServer.stdout?.pipe(logStream);
    wsServer.stderr?.pipe(logStream);
    wsServer.stdout?.on("data", (data) => {
        console.log("[WS Server]", data.toString().trim());
    });
    wsServer.stderr?.on("data", (data) => {
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
    const sources = readSourcesConfig();
    const localSourcesWithFolder = sources.filter(s => s.type === "local" && s.folder);
    let port;
    if (localSourcesWithFolder.length > 0 && !electron_1.app.isPackaged) {
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
                            process: null,
                            port: existingPort,
                            folder: src.folder || "",
                            sourceId: src.id,
                        });
                        continue;
                    }
                }
                catch { /* ignore URL parse errors */ }
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
        // Use first local source's port
        const firstInstance = servers.get(localSourcesWithFolder[0].id);
        port = firstInstance?.port ?? 3000;
        serverPort = port;
    }
    else {
        // No local sources with folders, or packaged: use existing single-server approach
        console.log("Starting Next.js server...");
        port = await startNextServer();
        serverPort = port;
    }
    console.log(`Next.js server running on port ${port}`);
    // Start the WS server (real-time events, file watching)
    if (!electron_1.app.isPackaged) {
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
    mainWindow = new electron_1.BrowserWindow({
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
        if (!mainWindow)
            return;
        if (input.meta && input.type === "keyDown") {
            if (input.key === "[") {
                event.preventDefault();
                mainWindow.webContents.executeJavaScript("window.history.back()");
            }
            else if (input.key === "]") {
                event.preventDefault();
                mainWindow.webContents.executeJavaScript("window.history.forward()");
            }
        }
    });
    // Trackpad swipe gestures for back/forward (macOS two-finger swipe)
    mainWindow.on("swipe", (_event, direction) => {
        if (!mainWindow)
            return;
        if (direction === "left") {
            mainWindow.webContents.executeJavaScript("window.history.back()");
        }
        else if (direction === "right") {
            mainWindow.webContents.executeJavaScript("window.history.forward()");
        }
    });
    // Open external links in the default browser instead of inside Electron
    // Build internal URL allowlist from configured sources
    const getSourceUrls = () => {
        // Merge URLs from all candidate files (Electron DATA_DIR + project-local)
        // so sources saved by either the dev server or Electron are recognized
        const candidates = [
            path.join(DATA_DIR, "sources.json"),
            path.join(path.resolve(__dirname, ".."), "data", "sources.json"),
        ];
        const urls = new Set();
        for (const sourcesPath of candidates) {
            try {
                if (fs.existsSync(sourcesPath)) {
                    const data = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
                    if (Array.isArray(data)) {
                        for (const s of data) {
                            if (s.url)
                                urls.add(s.url);
                        }
                    }
                }
            }
            catch {
                // Ignore read errors
            }
        }
        return Array.from(urls);
    };
    const isInternalUrl = (url) => {
        if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1"))
            return true;
        const sourceUrls = getSourceUrls();
        return sourceUrls.some(srcUrl => url.startsWith(srcUrl));
    };
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isInternalUrl(url)) {
            return { action: "allow" };
        }
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (isInternalUrl(url))
            return;
        event.preventDefault();
        electron_1.shell.openExternal(url);
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
}
/**
 * Setup plan file watcher
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plansWatcher = null;
async function setupPlanWatcher() {
    try {
        const chokidar = await Promise.resolve().then(() => __importStar(require("chokidar")));
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
        plansWatcher.on("add", (filePath) => {
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
            }
            catch (err) {
                console.error(`Error reading new plan ${filePath}:`, err);
            }
        });
        plansWatcher.on("change", (filePath) => {
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
            }
            catch (err) {
                console.error(`Error reading updated plan ${filePath}:`, err);
            }
        });
        console.log(`Watching for plans in: ${PLANS_DIR}`);
    }
    catch (err) {
        console.error("Error setting up plans watcher:", err);
    }
}
// IPC handlers
electron_1.ipcMain.on("window:focus", () => {
    if (mainWindow) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});
electron_1.ipcMain.handle("dialog:selectFolder", async () => {
    if (!mainWindow)
        return { cancelled: true };
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Select folder",
    });
    if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
    }
    return { path: result.filePaths[0] };
});
// Single-instance lock — focus existing window instead of spawning a duplicate
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.exit(0);
}
else {
    electron_1.app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
    // App lifecycle
    electron_1.app.whenReady().then(createWindow);
}
/** Kill a detached process and its entire process group. */
function killProcessGroup(proc) {
    if (!proc)
        return;
    try {
        // Kill the process group (negative PID) so all children die too
        if (proc.pid)
            process.kill(-proc.pid);
    }
    catch {
        // Process may already be dead — try direct kill as fallback
        try {
            proc.kill();
        }
        catch { /* ignore */ }
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
}
electron_1.app.on("window-all-closed", () => {
    // On macOS, windows hide instead of close, so this only fires on actual quit.
    // On other platforms, quit the app.
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
    else {
        createWindow();
    }
});
// Handle app quit — set flag so close handler allows destroy
electron_1.app.on("before-quit", () => {
    isQuitting = true;
    killAllServers();
});
