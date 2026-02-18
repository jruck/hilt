import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { EventServer } from "./event-server";
import { getScopeWatcher, getInboxWatcher, getBridgeWatcher } from "./watchers";
import type {
  TreeChangedEvent,
  FileChangedEvent,
  InboxChangedEvent,
} from "./watchers";

const PREFERRED_PORT = parseInt(process.env.WS_PORT || "3001", 10);
const PORT_FILE = path.join(process.env.HOME || "~", ".hilt-ws-port");
const LOCK_FILE = path.join(process.env.HOME || "~", ".hilt-server.lock");

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

async function startServer() {
  // Prevent multiple server instances
  if (!acquireLock()) {
    process.exit(1);
  }

  const port = await findAvailablePort(PREFERRED_PORT);
  writePortFile(port);

  // Create HTTP server for path-based WebSocket routing
  const httpServer = http.createServer((req, res) => {
    // Simple health check endpoint
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // Event WebSocket server (noServer mode)
  const eventServer = new EventServer();
  console.log(`Event WebSocket server configured for path: /events`);

  // Scope watcher for docs tree/file events (per-client subscription)
  const scopeWatcher = getScopeWatcher();

  // Connect scope watcher events to EventServer broadcasts
  scopeWatcher.on("tree:changed", (event: TreeChangedEvent) => {
    // Broadcast to clients subscribed to "tree" channel with matching scope
    eventServer.broadcast("tree", "changed", {
      scope: event.scope,
      type: event.type,
      path: event.path,
      relativePath: event.relativePath,
    }, (params) => params.scope === event.scope);
  });

  scopeWatcher.on("file:changed", (event: FileChangedEvent) => {
    // Broadcast to clients subscribed to "file" channel with matching scope
    eventServer.broadcast("file", "changed", {
      scope: event.scope,
      path: event.path,
      relativePath: event.relativePath,
    }, (params) => params.scope === event.scope);
  });

  // Inbox watcher for todo file events (per-client subscription)
  const inboxWatcher = getInboxWatcher();

  // Connect inbox watcher events to EventServer broadcasts
  inboxWatcher.on("inbox:changed", (event: InboxChangedEvent) => {
    // Broadcast to clients subscribed to "inbox" channel with matching scope
    eventServer.broadcast("inbox", "changed", {
      scope: event.scope,
    }, (params) => params.scope === event.scope);
  });

  // Handle subscription events to start/stop watching scopes
  eventServer.on("subscription:added", ({ clientId, channel, params }: { clientId: string; channel: string; params: Record<string, unknown> }) => {
    const scope = params.scope as string | undefined;
    if (!scope) return;

    if (channel === "tree" || channel === "file") {
      scopeWatcher.watchScope(scope, clientId);
    } else if (channel === "inbox") {
      inboxWatcher.watchInbox(scope, clientId);
    }
  });

  eventServer.on("subscription:removed", ({ clientId, channel, params }: { clientId: string; channel: string; params?: Record<string, unknown> }) => {
    const scope = params?.scope as string | undefined;
    if (!scope) return;

    if (channel === "tree" || channel === "file") {
      scopeWatcher.unwatchScope(scope, clientId);
    } else if (channel === "inbox") {
      inboxWatcher.unwatchInbox(scope, clientId);
    }
  });

  // Clean up watchers when client disconnects
  eventServer.on("client:disconnected", (clientId: string) => {
    scopeWatcher.removeClient(clientId);
    inboxWatcher.removeClient(clientId);
  });

  // Bridge watcher for vault file events
  const bridgeWatcher = getBridgeWatcher();

  bridgeWatcher.on("weekly-changed", () => {
    eventServer.broadcast("bridge", "weekly-changed", {});
  });

  bridgeWatcher.on("projects-changed", () => {
    eventServer.broadcast("bridge", "projects-changed", {});
  });

  bridgeWatcher.on("people-changed", () => {
    eventServer.broadcast("bridge", "people-changed", {});
  });

  bridgeWatcher.start();

  console.log(`Scope, inbox, and bridge watchers configured`);

  // Manually handle WebSocket upgrades and route to appropriate server
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = request.url || "";

    if (pathname === "/events" || pathname.startsWith("/events?")) {
      eventServer.handleUpgrade(request, socket, head);
    } else {
      // Unknown path - destroy the socket
      socket.destroy();
    }
  });

  httpServer.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
    console.log(`  Events WebSocket: ws://localhost:${port}/events`);
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down WebSocket server...");
    removePortFile();
    releaseLock();
    scopeWatcher.stop();
    inboxWatcher.stop();
    bridgeWatcher.stop();
    eventServer.close();
    httpServer.close(() => {
      process.exit(0);
    });
  });
}

// Start the server
startServer().catch((err) => {
  console.error("Failed to start WebSocket server:", err);
  process.exit(1);
});
