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
// Set DATA_DIR to Electron's userData path before anything else
const DATA_DIR = path.join(electron_1.app.getPath("userData"), "data");
process.env.DATA_DIR = DATA_DIR;
// These modules are loaded dynamically at runtime after DATA_DIR is set
// They're outside the electron/ directory so we use require() instead of import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyManager = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getSessionById = null;
const PLANS_DIR = path.join(process.env.HOME || "~", ".claude", "plans");
// Track active windows and server process
let mainWindow = null;
let nextServer = null;
let serverPort = null;
// Track which IPC clients are connected to which terminals
const ipcToTerminal = new Map();
const terminalToIpc = new Map();
// Track last known title per terminal
const terminalTitles = new Map();
// Track last known context progress per terminal (0-100)
const terminalContextProgress = new Map();
/**
 * Parse OSC sequences to extract terminal title changes
 */
function extractTitle(data) {
    const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let lastTitle = null;
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
function isClaudeStatusTitle(title) {
    if (!title || title.length === 0)
        return false;
    if (title.startsWith("claude"))
        return false;
    if (title.startsWith("zsh"))
        return false;
    if (title.startsWith("bash"))
        return false;
    if (title.startsWith("/"))
        return false;
    if (title.startsWith("~"))
        return false;
    if (title.includes("--"))
        return false;
    if (/^[a-f0-9-]{20,}$/i.test(title))
        return false;
    if (title.includes(" ") && title.length < 100)
        return true;
    if (title.length < 30 && /^[a-z][a-z\s]+$/i.test(title))
        return true;
    return false;
}
/**
 * Extract context percentage from terminal output
 */
function extractContextProgress(data) {
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
 * Start the embedded Next.js server (production) or connect to existing dev server
 */
async function startNextServer() {
    const isPackaged = electron_1.app.isPackaged;
    // In development, connect to the already-running dev server
    // Port can be specified via CLAUDE_KANBAN_DEV_PORT env var (set by dev app launcher)
    if (!isPackaged) {
        const devPort = parseInt(process.env.CLAUDE_KANBAN_DEV_PORT || "3000", 10);
        serverPort = devPort;
        return devPort;
    }
    // Production: start the standalone server
    const port = await findAvailablePort(3000);
    serverPort = port;
    return new Promise((resolve, reject) => {
        const serverPath = path.join(process.resourcesPath, "app", ".next", "standalone", "server.js");
        nextServer = (0, child_process_1.spawn)("node", [serverPath], {
            env: {
                ...process.env,
                PORT: String(port),
                DATA_DIR,
                NODE_ENV: "production",
            },
            cwd: path.join(process.resourcesPath, "app"),
        });
        let started = false;
        nextServer.stdout?.on("data", (data) => {
            const output = data.toString();
            console.log("[Next.js]", output);
            // Check if server has started
            if (!started && (output.includes("Ready") || output.includes(`localhost:${port}`))) {
                started = true;
                resolve(port);
            }
        });
        nextServer.stderr?.on("data", (data) => {
            console.error("[Next.js Error]", data.toString());
        });
        nextServer.on("error", (err) => {
            console.error("Failed to start Next.js server:", err);
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
 * Create the main application window
 */
async function createWindow() {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // Load modules using require - tsx/cjs handles TypeScript compilation
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptyModule = require("../src/lib/pty-manager.ts");
    ptyManager = ptyModule.ptyManager;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sessionsModule = require("../src/lib/claude-sessions.ts");
    getSessionById = sessionsModule.getSessionById;
    // Start the Next.js server
    console.log("Starting Next.js server...");
    const port = await startNextServer();
    console.log(`Next.js server running on port ${port}`);
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
    // Load the Next.js app
    mainWindow.loadURL(`http://localhost:${port}`);
    // Log any load errors
    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
        console.error(`Failed to load: ${errorCode} - ${errorDescription}`);
    });
    // Inject Electron-specific CSS
    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow?.webContents.insertCSS(`
      /* Hide Next.js dev indicator */
      [data-nextjs-dialog-overlay],
      [data-nextjs-toast],
      nextjs-portal { display: none !important; }

      /* Add left padding to status bar for macOS traffic light buttons */
      [data-statusbar] { padding-left: 80px; }
    `);
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
    const getWindowId = (event) => {
        return event.sender.id;
    };
    // Handle spawn requests
    electron_1.ipcMain.handle("pty:spawn", async (event, data) => {
        const { terminalId, sessionId, projectPath, isNew, initialPrompt } = data;
        const windowId = getWindowId(event);
        if (!terminalId || !sessionId) {
            return { error: "Missing terminalId or sessionId" };
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
        terminalToIpc.get(terminalId).add(windowId);
        return { success: true, terminalId };
    });
    // Handle data writes
    electron_1.ipcMain.handle("pty:write", async (_event, data) => {
        const { terminalId, data: inputData } = data;
        if (!terminalId || inputData === undefined)
            return { error: "Missing data" };
        ptyManager.write(terminalId, inputData);
        return { success: true };
    });
    // Handle resize
    electron_1.ipcMain.handle("pty:resize", async (_event, data) => {
        const { terminalId, cols, rows } = data;
        if (!terminalId || !cols || !rows)
            return { error: "Missing dimensions" };
        ptyManager.resize(terminalId, cols, rows);
        return { success: true };
    });
    // Handle kill
    electron_1.ipcMain.handle("pty:kill", async (event, data) => {
        const { terminalId } = data;
        const windowId = getWindowId(event);
        if (!terminalId)
            return { error: "Missing terminalId" };
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
    ptyManager.on("data", (terminalId, data) => {
        if (!mainWindow)
            return;
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
    ptyManager.on("exit", (terminalId, exitCode) => {
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
                    mainWindow.webContents.send("pty:plan", {
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
                    mainWindow.webContents.send("pty:plan", {
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
// App lifecycle
electron_1.app.whenReady().then(createWindow);
electron_1.app.on("window-all-closed", () => {
    // Kill the Next.js server
    if (nextServer) {
        nextServer.kill();
        nextServer = null;
    }
    // Clean up plan watcher
    if (plansWatcher) {
        plansWatcher.close();
    }
    // Kill all terminals
    if (ptyManager) {
        ptyManager.getAll().forEach((session) => {
            ptyManager.kill(session.id);
        });
    }
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    if (mainWindow === null) {
        createWindow();
    }
});
// Handle app quit
electron_1.app.on("before-quit", () => {
    if (nextServer) {
        nextServer.kill();
    }
    if (plansWatcher) {
        plansWatcher.close();
    }
});
