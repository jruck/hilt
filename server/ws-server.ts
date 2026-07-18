import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { loadEnvConfig } from "@next/env";
import { EventServer } from "./event-server";
import { getScopeWatcher, getInboxWatcher, getBridgeWatcher, getLibraryWatcher } from "./watchers";
import { startCalendarSyncDaemon } from "../src/lib/calendar/daemon";
import { startGranolaSyncDaemon, stopGranolaSyncDaemon } from "../src/lib/granola/daemon";
import { startMetricsCollectorDaemon } from "../src/lib/system/telemetry/daemon";
import type {
  TreeChangedEvent,
  FileChangedEvent,
  InboxChangedEvent,
} from "./watchers";
import { getVaultPathSync } from "../src/lib/bridge/vault";
import { LibraryProcessingRunner } from "../src/lib/library/processing-trigger";
import { LibraryRecommendationRunner } from "../src/lib/library/recommendation-trigger";
import { startLibraryIntakeDaemon } from "../src/lib/library/intake-daemon";
import { appendActiveBriefingDecisions } from "../src/lib/briefing/decision-append";
import { meetingLedgerEventMarkerPath } from "../src/lib/loops/meeting-ledger-store";
import { installGeminiNetworkTripwire } from "../src/lib/ai/gemini-tripwire";

loadEnvConfig(process.cwd());
installGeminiNetworkTripwire();

const PREFERRED_PORT = parseInt(process.env.WS_PORT || "3001", 10);
const PORT_FILE = path.join(process.env.HOME || "~", ".hilt-ws-port");
const LOCK_FILE = path.join(process.env.HOME || "~", ".hilt-server.lock");
const NAVIGATE_FILE = path.join(process.env.HOME || "~", ".hilt-pending-navigate.json");
const CALENDAR_MARKER_FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "calendar-sync-event.json");

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
    server.listen(startPort, "127.0.0.1", () => {
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

    // Navigate endpoint — broadcasts to all connected renderer clients
    if (req.method === "POST" && req.url === "/navigate") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk; });
      req.on("end", () => {
        try {
          const { view, path } = JSON.parse(body);
          const validViews = ["bridge", "docs", "stack", "briefings", "calendar", "people", "system", "library", "chats"];
          if (!view || !validViews.includes(view)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid view. Must be one of: " + validViews.join(", ") }));
            return;
          }
          eventServer.broadcastAll("navigate", "goto", { view, path });
          // Also write the intent to a file. Electron main watches this and
          // forwards to the renderer via IPC — reliable path when the renderer's
          // WS reconnect is throttled (e.g. backgrounded window).
          try {
            fs.writeFileSync(
              NAVIGATE_FILE,
              JSON.stringify({ view, path, ts: Date.now() }),
              "utf-8"
            );
          } catch (err) {
            console.error("Failed to write navigate file:", err);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // Event WebSocket server (noServer mode)
  const eventServer = new EventServer();
  console.log(`Event WebSocket server configured for path: /events`);

  const libraryVaultPath = getVaultPathSync();
  const meetingLedgerMarker = meetingLedgerEventMarkerPath(libraryVaultPath);
  const libraryProcessingRunner = new LibraryProcessingRunner(libraryVaultPath);
  const libraryRecommendationRunner = new LibraryRecommendationRunner(
    libraryVaultPath,
    () => eventServer.broadcast("library", "recommendations-changed", { at: new Date().toISOString() }),
  );
  const libraryWatcher = getLibraryWatcher(libraryVaultPath);
  const libraryIntakeDaemon = startLibraryIntakeDaemon(libraryVaultPath, () => libraryProcessingRunner.kick());

  libraryWatcher.on("artifact-changed", (event) => {
    eventServer.broadcast("library", "artifact-changed", event);
    libraryRecommendationRunner.noteArtifact(event.path, event.became_ready === true);
  });
  libraryWatcher.on("queue-changed", (event) => {
    eventServer.broadcast("library", "queue-changed", event);
    libraryProcessingRunner.kick();
  });
  libraryWatcher.on("context-changed", (event) => {
    libraryRecommendationRunner.noteContext(event.path);
  });
  libraryWatcher.on("recommendations-changed", (event) => {
    eventServer.broadcast("library", "recommendations-changed", event);
    if (!event.affects_feed) libraryRecommendationRunner.resume();
  });
  libraryWatcher.start();
  libraryProcessingRunner.kick();
  libraryRecommendationRunner.resume();

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
    if (channel === "library") libraryIntakeDaemon.setForeground(true);
    const scope = params.scope as string | undefined;
    if (!scope) return;

    if (channel === "tree" || channel === "file") {
      scopeWatcher.watchScope(scope, clientId);
    } else if (channel === "inbox") {
      inboxWatcher.watchInbox(scope, clientId);
    }
  });

  eventServer.on("subscription:removed", ({ clientId, channel, params }: { clientId: string; channel: string; params?: Record<string, unknown> }) => {
    if (channel === "library") {
      libraryIntakeDaemon.setForeground(eventServer.getSubscribers("library").length > 0);
    }
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
    libraryIntakeDaemon.setForeground(eventServer.getSubscribers("library").length > 0);
  });

  // Bridge watcher for vault file events
  const bridgeWatcher = getBridgeWatcher();

  bridgeWatcher.on("weekly-changed", () => {
    eventServer.broadcast("bridge", "weekly-changed", {});
  });

  // Task files (tasks/ + tasks/.proposals/) — the only broadcast path for /api/tasks
  // mutations: routes never broadcast; the file write lands here via chokidar.
  let decisionAppendTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleDecisionAppend = () => {
    if (decisionAppendTimer) clearTimeout(decisionAppendTimer);
    decisionAppendTimer = setTimeout(() => {
      decisionAppendTimer = null;
      try {
        const appended = appendActiveBriefingDecisions(
          getVaultPathSync(),
          new Date().toLocaleDateString("en-CA"),
        );
        if (appended.length) {
          console.log("[BriefingDecisions] appended", appended);
          eventServer.broadcast("bridge", "briefings-changed", { files: appended.map((result) => result.file) });
        }
      } catch (error) {
        console.warn("[BriefingDecisions] append failed:", error instanceof Error ? error.message : error);
      }
    }, 400);
  };
  bridgeWatcher.on("tasks-changed", () => {
    eventServer.broadcast("bridge", "tasks-changed", {});
    scheduleDecisionAppend();
  });
  scheduleDecisionAppend();

  bridgeWatcher.on("projects-changed", () => {
    eventServer.broadcast("bridge", "projects-changed", {});
  });

  bridgeWatcher.on("people-changed", () => {
    eventServer.broadcast("bridge", "people-changed", {});
  });

  bridgeWatcher.on("areas-changed", () => {
    eventServer.broadcast("bridge", "areas-changed", {});
  });

  bridgeWatcher.on("thoughts-changed", () => {
    eventServer.broadcast("bridge", "thoughts-changed", {});
  });

  bridgeWatcher.start();
  startGranolaSyncDaemon();
  startMetricsCollectorDaemon(); // no-op unless HILT_METRICS_COLLECTOR=1 (Mercury only)
  const stopCalendarSyncDaemon = startCalendarSyncDaemon();

  fs.watchFile(CALENDAR_MARKER_FILE, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs > 0 && curr.mtimeMs !== prev.mtimeMs) {
      eventServer.broadcast("calendar", "changed", {});
    }
  });
  fs.watchFile(meetingLedgerMarker, { interval: 750 }, (curr, prev) => {
    if (curr.mtimeMs > 0 && curr.mtimeMs !== prev.mtimeMs) {
      eventServer.broadcast("bridge", "meeting-ledger-changed", {});
    }
  });

  console.log(`Scope, inbox, bridge, library, and calendar watchers configured`);

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

  // Loopback only: remote devices reach real-time events through the
  // authenticated Serve origin (server/app-server.ts proxies
  // `${basePath}/events` here), never a raw open port. /navigate likewise
  // stays a localhost-only POST — agents that use it run on this machine.
  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`HTTP server listening on 127.0.0.1:${port}`);
    console.log(`  Events WebSocket: ws://127.0.0.1:${port}/events (reached via app-server's /events proxy)`);
  });

  // Handle both interactive and supervisor rebuild shutdowns. Durable extraction jobs remain in
  // SQLite; a detached worker may finish, and the next ws-server verifies it before any retry.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down WebSocket server...");
    removePortFile();
    releaseLock();
    scopeWatcher.stop();
    inboxWatcher.stop();
    bridgeWatcher.stop();
    libraryWatcher.stop();
    libraryIntakeDaemon.stop();
    libraryRecommendationRunner.stop();
    stopGranolaSyncDaemon();
    stopCalendarSyncDaemon();
    fs.unwatchFile(CALENDAR_MARKER_FILE);
    fs.unwatchFile(meetingLedgerMarker);
    eventServer.close();
    httpServer.close(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

// Start the server
startServer().catch((err) => {
  console.error("Failed to start WebSocket server:", err);
  process.exit(1);
});
