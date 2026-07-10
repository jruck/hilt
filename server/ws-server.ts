import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { loadEnvConfig } from "@next/env";
import { EventServer } from "./event-server";
import { getScopeWatcher, getInboxWatcher, getBridgeWatcher, getLibraryWatcher } from "./watchers";
import { startCalendarSyncDaemon } from "../src/lib/calendar/daemon";
import { startGranolaSyncDaemon } from "../src/lib/granola/daemon";
import { startMetricsCollectorDaemon } from "../src/lib/system/telemetry/daemon";
import { isGraphEnabled, getGraphMarkerPath } from "../src/lib/graph/config";
import { isSemanticEnabled } from "../src/lib/semantic/config";
import type {
  TreeChangedEvent,
  FileChangedEvent,
  InboxChangedEvent,
} from "./watchers";
import type { GraphRunner } from "../src/lib/graph/runner";
import type { SemanticRunner } from "../src/lib/semantic/runner";
import { getVaultPathSync } from "../src/lib/bridge/vault";
import { LibraryProcessingRunner } from "../src/lib/library/processing-trigger";
import { startLibraryIntakeDaemon } from "../src/lib/library/intake-daemon";

loadEnvConfig(process.cwd());

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
          const validViews = ["bridge", "docs", "stack", "briefings", "calendar", "people", "system", "library"];
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
  const libraryProcessingRunner = new LibraryProcessingRunner(libraryVaultPath);
  const libraryWatcher = getLibraryWatcher(libraryVaultPath);
  const libraryIntakeDaemon = startLibraryIntakeDaemon(libraryVaultPath, () => libraryProcessingRunner.kick());

  libraryWatcher.on("artifact-changed", (event) => {
    eventServer.broadcast("library", "artifact-changed", event);
  });
  libraryWatcher.on("queue-changed", (event) => {
    eventServer.broadcast("library", "queue-changed", event);
    libraryProcessingRunner.kick();
  });
  libraryWatcher.start();
  libraryProcessingRunner.kick();

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
  bridgeWatcher.on("tasks-changed", () => {
    eventServer.broadcast("bridge", "tasks-changed", {});
  });

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

  // --- System → Graph runner + marker watch (flag-gated; inert when off) ---
  // ENTIRELY no-op unless HILT_GRAPH_ENABLED === "true". The runner module (which
  // pulls in build/layout/db) is dynamically imported so the flag-off path never
  // loads it. Mirrors the calendar marker watch above.
  let graphRunner: GraphRunner | null = null;
  let graphMarkerWatched = false;
  if (isGraphEnabled()) {
    const graphMarker = getGraphMarkerPath();
    fs.watchFile(graphMarker, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs > 0 && curr.mtimeMs !== prev.mtimeMs) {
        eventServer.broadcast("graph", "changed", {});
      }
    });
    graphMarkerWatched = true;

    void (async () => {
      try {
        const { getGraphRunner, GRAPH_RUNNER_CLIENT_ID } = await import(
          "../src/lib/graph/runner"
        );
        graphRunner = getGraphRunner();
        const vaultRoot = graphRunner.getVaultRoot();

        // BridgeWatcher: dir-rescan-by-mtime (do NOT trust the single collapsed path).
        bridgeWatcher.on("projects-changed", () => graphRunner?.onDirChanged("projects"));
        bridgeWatcher.on("people-changed", () => graphRunner?.onDirChanged("people")); // + meetings
        bridgeWatcher.on("areas-changed", () => graphRunner?.onDirChanged("areas"));
        bridgeWatcher.on("thoughts-changed", () => graphRunner?.onDirChanged("thoughts"));
        bridgeWatcher.on("weekly-changed", () => graphRunner?.onDirChanged("weekly"));
        bridgeWatcher.on("tasks-changed", () => graphRunner?.onDirChanged("tasks"));

        // ScopeWatcher: persistent internal client at the vault root covers
        // references/ + docs/ (BridgeWatcher does not). Ref-counted; survives UI subs.
        scopeWatcher.watchScope(vaultRoot, GRAPH_RUNNER_CLIENT_ID);
        scopeWatcher.on("file:changed", (e: FileChangedEvent) => graphRunner?.onFileChanged(e.path));
        scopeWatcher.on("tree:changed", (e: TreeChangedEvent) =>
          e.type === "unlink"
            ? graphRunner?.onFileRemoved(e.path)
            : graphRunner?.onFileChanged(e.path),
        );

        await graphRunner.start();
        console.log("[GraphRunner] Started (graph feature enabled)");
      } catch (err) {
        console.error("[GraphRunner] Failed to start:", err);
      }
    })();
  }

  // --- Phase 2 → Semantic runner (flag-gated; inert when off) ---
  // ENTIRELY no-op unless HILT_SEMANTIC_ENABLED === "true". The runner module (which pulls
  // in db/chunking/embed/Gemini) is dynamically imported so the flag-off path never loads it
  // — identical inert posture to the GraphRunner block above. The runner reuses the SAME
  // watcher signals (BridgeWatcher dir events + the ScopeWatcher persistent client) and keeps
  // its own content-hash map; it never writes the vault (the cache lives under DATA_DIR).
  let semanticRunner: SemanticRunner | null = null;
  if (isSemanticEnabled()) {
    void (async () => {
      try {
        const { getSemanticRunner, SEMANTIC_RUNNER_CLIENT_ID } = await import(
          "../src/lib/semantic/runner"
        );
        semanticRunner = getSemanticRunner();
        const vaultRoot = semanticRunner.getVaultRoot();

        // BridgeWatcher: dir-rescan-by-content-hash (do NOT trust the single collapsed path).
        bridgeWatcher.on("projects-changed", () => semanticRunner?.onDirChanged("projects"));
        bridgeWatcher.on("people-changed", () => semanticRunner?.onDirChanged("people")); // + meetings
        bridgeWatcher.on("areas-changed", () => semanticRunner?.onDirChanged("areas"));
        bridgeWatcher.on("thoughts-changed", () => semanticRunner?.onDirChanged("thoughts"));
        bridgeWatcher.on("weekly-changed", () => semanticRunner?.onDirChanged("weekly"));
        bridgeWatcher.on("tasks-changed", () => semanticRunner?.onDirChanged("tasks"));

        // ScopeWatcher: persistent internal client at the vault root covers references/ + docs/.
        // Ref-counted via a reserved client id, so it coexists with the GraphRunner's client.
        scopeWatcher.watchScope(vaultRoot, SEMANTIC_RUNNER_CLIENT_ID);
        scopeWatcher.on("file:changed", (e: FileChangedEvent) => semanticRunner?.onFileChanged(e.path));
        scopeWatcher.on("tree:changed", (e: TreeChangedEvent) =>
          e.type === "unlink"
            ? semanticRunner?.onFileRemoved(e.path)
            : semanticRunner?.onFileChanged(e.path),
        );

        await semanticRunner.start();
        console.log("[SemanticRunner] Started (semantic feature enabled)");
      } catch (err) {
        console.error("[SemanticRunner] Failed to start:", err);
      }
    })();
  }

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

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down WebSocket server...");
    removePortFile();
    releaseLock();
    if (graphRunner) {
      graphRunner.stop();
      try {
        const { GRAPH_RUNNER_CLIENT_ID } = await import("../src/lib/graph/runner");
        scopeWatcher.unwatchScope(graphRunner.getVaultRoot(), GRAPH_RUNNER_CLIENT_ID);
      } catch {
        // Ignore — teardown best-effort.
      }
    }
    if (semanticRunner) {
      semanticRunner.stop();
      try {
        const { SEMANTIC_RUNNER_CLIENT_ID } = await import("../src/lib/semantic/runner");
        scopeWatcher.unwatchScope(semanticRunner.getVaultRoot(), SEMANTIC_RUNNER_CLIENT_ID);
      } catch {
        // Ignore — teardown best-effort.
      }
    }
    if (graphMarkerWatched) {
      fs.unwatchFile(getGraphMarkerPath());
    }
    scopeWatcher.stop();
    inboxWatcher.stop();
    bridgeWatcher.stop();
    libraryWatcher.stop();
    libraryIntakeDaemon.stop();
    stopCalendarSyncDaemon();
    fs.unwatchFile(CALENDAR_MARKER_FILE);
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
