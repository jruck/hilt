import { WebSocketServer, WebSocket } from "ws";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { ptyManager } from "../src/lib/pty-manager";
import { getSessionById } from "../src/lib/claude-sessions";

const PREFERRED_PORT = parseInt(process.env.WS_PORT || "3001", 10);
const PORT_FILE = path.join(process.env.HOME || "~", ".hilt-ws-port");
const LOCK_FILE = path.join(process.env.HOME || "~", ".hilt-server.lock");
const PLANS_DIR = path.join(process.env.HOME || "~", ".claude", "plans");

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a lock to prevent multiple server instances
 * Returns true if lock acquired, false if another server is running
 */
function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pidStr = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && isProcessRunning(pid)) {
        console.error(`Server already running (PID ${pid}). Use 'pkill -f ws-server' to stop it.`);
        return false;
      }
      // Stale lock file - process is dead
      console.log(`Removing stale lock file (PID ${pid} is not running)`);
    }
    // Write our PID
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf-8");
    return true;
  } catch (err) {
    console.error("Failed to acquire lock:", err);
    return false;
  }
}

/**
 * Release the lock file
 */
function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

interface WSMessage {
  type: "spawn" | "data" | "resize" | "kill";
  terminalId?: string;
  sessionId?: string;
  projectPath?: string;
  isNew?: boolean;
  initialPrompt?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

/**
 * Find an available port, starting with the preferred port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(startPort, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : startPort;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      // Port in use, try next one
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * Write the port to a file so clients can discover it
 */
function writePortFile(port: number): void {
  fs.writeFileSync(PORT_FILE, String(port), "utf-8");
}

/**
 * Clean up port file on shutdown
 */
function removePortFile(): void {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

// Track which WebSocket is connected to which terminal
const wsToTerminal = new Map<WebSocket, string>();
const terminalToWs = new Map<string, Set<WebSocket>>();
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
 * Claude Code shows context usage like "85% context" or similar patterns
 */
function extractContextProgress(data: string): number | null {
  // Match patterns like "85% context", "85.5% context", "Context: 85%", etc.
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

async function startServer() {
  // Prevent multiple server instances
  if (!acquireLock()) {
    process.exit(1);
  }

  const port = await findAvailablePort(PREFERRED_PORT);
  writePortFile(port);

  const wss = new WebSocketServer({ port });
  console.log(`WebSocket server running on ws://localhost:${port}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plansWatcher: any = null;

  wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", async (message) => {
      try {
        const msg: WSMessage = JSON.parse(message.toString());

        switch (msg.type) {
          case "spawn": {
            if (!msg.terminalId || !msg.sessionId) {
              ws.send(
                JSON.stringify({ type: "error", message: "Missing terminalId or sessionId" })
              );
              return;
            }

            let projectPath = msg.projectPath;
            if (!projectPath && !msg.isNew) {
              const session = await getSessionById(msg.sessionId);
              projectPath = session?.projectPath || process.env.HOME || "/";
            }
            projectPath = projectPath || process.env.HOME || "/";

            ptyManager.spawn(msg.terminalId, msg.sessionId, projectPath, msg.isNew, msg.initialPrompt);

            wsToTerminal.set(ws, msg.terminalId);
            if (!terminalToWs.has(msg.terminalId)) {
              terminalToWs.set(msg.terminalId, new Set());
            }
            terminalToWs.get(msg.terminalId)!.add(ws);

            ws.send(JSON.stringify({ type: "spawned", terminalId: msg.terminalId }));
            break;
          }

          case "data": {
            if (!msg.terminalId || msg.data === undefined) return;
            ptyManager.write(msg.terminalId, msg.data);
            break;
          }

          case "resize": {
            if (!msg.terminalId || !msg.cols || !msg.rows) return;
            ptyManager.resize(msg.terminalId, msg.cols, msg.rows);
            break;
          }

          case "kill": {
            if (!msg.terminalId) return;
            ptyManager.kill(msg.terminalId);
            ws.send(JSON.stringify({ type: "killed", terminalId: msg.terminalId }));
            break;
          }
        }
      } catch (err) {
        console.error("Error processing message:", err);
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      const terminalId = wsToTerminal.get(ws);
      if (terminalId) {
        wsToTerminal.delete(ws);
        const wsSet = terminalToWs.get(terminalId);
        if (wsSet) {
          wsSet.delete(ws);
          if (wsSet.size === 0) {
            ptyManager.kill(terminalId);
            terminalToWs.delete(terminalId);
          }
        }
      }
    });
  });

  // Forward PTY data to connected WebSockets
  ptyManager.on("data", (terminalId: string, data: string) => {
    const wsSet = terminalToWs.get(terminalId);
    if (!wsSet) return;

    // Check for title changes and forward to clients
    const newTitle = extractTitle(data);
    if (newTitle && newTitle !== terminalTitles.get(terminalId)) {
      terminalTitles.set(terminalId, newTitle);
      const titleMsg = JSON.stringify({ type: "title", terminalId, title: newTitle });
      wsSet.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(titleMsg);
        }
      });
    }

    // Check for context progress changes and forward to clients
    const newProgress = extractContextProgress(data);
    if (newProgress !== null && newProgress !== terminalContextProgress.get(terminalId)) {
      terminalContextProgress.set(terminalId, newProgress);
      const progressMsg = JSON.stringify({ type: "context", terminalId, progress: newProgress });
      wsSet.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(progressMsg);
        }
      });
    }

    // Forward the data
    const msg = JSON.stringify({ type: "data", terminalId, data });
    wsSet.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  });

  // Forward PTY exit events
  ptyManager.on("exit", (terminalId: string, exitCode: number) => {
    const wsSet = terminalToWs.get(terminalId);
    if (wsSet) {
      const msg = JSON.stringify({ type: "exit", terminalId, exitCode });
      wsSet.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      });
    }
    terminalToWs.delete(terminalId);
    terminalTitles.delete(terminalId);
    terminalContextProgress.delete(terminalId);
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down WebSocket server...");
    removePortFile();
    releaseLock();
    ptyManager.getAll().forEach((session) => {
      ptyManager.kill(session.id);
    });
    if (plansWatcher) {
      await plansWatcher.close();
    }
    wss.close(() => {
      process.exit(0);
    });
  });

  // Watch for new plan files and broadcast to all clients
  async function watchPlans() {
    try {
      const chokidar = await import("chokidar");

      // Ensure plans directory exists
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

        // Read the plan content
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const msg = JSON.stringify({
            type: "plan",
            event: "created",
            slug,
            path: filePath,
            content,
          });

          // Broadcast to all connected clients
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
        } catch (err) {
          console.error(`Error reading new plan ${filePath}:`, err);
        }
      });

      plansWatcher.on("change", (filePath: string) => {
        const slug = path.basename(filePath, ".md");
        console.log(`Plan updated: ${slug}`);

        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const msg = JSON.stringify({
            type: "plan",
            event: "updated",
            slug,
            path: filePath,
            content,
          });

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
        } catch (err) {
          console.error(`Error reading updated plan ${filePath}:`, err);
        }
      });

      console.log(`Watching for plans in: ${PLANS_DIR}`);
    } catch (err) {
      console.error("Error setting up plans watcher:", err);
    }
  }

  // Start watching plans
  watchPlans();
}

// Start the server
startServer().catch((err) => {
  console.error("Failed to start WebSocket server:", err);
  process.exit(1);
});
