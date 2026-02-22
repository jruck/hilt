/**
 * Bridge Watcher
 *
 * Watches the bridge vault's lists/now/ and projects/ directories.
 * Emits events when weekly lists or projects change.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import * as path from "path";
import * as os from "os";

export interface BridgeChangedEvent {
  type: "weekly" | "projects" | "people" | "thoughts";
  path: string;
}

export class BridgeWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private selfWrites = new Set<string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs = 200;

  constructor(private vaultPath: string) {
    super();
  }

  start(): void {
    const watchPaths = [
      path.join(this.vaultPath, "lists", "now"),
      path.join(this.vaultPath, "projects"),
      path.join(this.vaultPath, "thoughts"),
      path.join(this.vaultPath, "people"),
      path.join(this.vaultPath, "meetings"),
    ];

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      depth: 2,
      ignored: [/(^|[/\\])\../, /node_modules/],
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("all", (_event: string, filePath: string) => {
      // Suppress self-writes
      if (this.selfWrites.has(filePath)) {
        this.selfWrites.delete(filePath);
        return;
      }

      let changeType: "weekly" | "projects" | "people" | "thoughts";
      if (filePath.includes(path.join("lists", "now"))) {
        changeType = "weekly";
      } else if (filePath.includes(path.sep + "people" + path.sep) || filePath.includes(path.sep + "meetings" + path.sep)) {
        changeType = "people";
      } else if (filePath.includes(path.sep + "thoughts" + path.sep)) {
        changeType = "thoughts";
      } else {
        changeType = "projects";
      }

      this.debouncedEmit(changeType, filePath);
    });

    this.watcher.on("error", (error) => {
      console.error("[BridgeWatcher] Error:", error);
    });

    console.log(`[BridgeWatcher] Watching: ${watchPaths.join(", ")}`);
  }

  private debouncedEmit(type: "weekly" | "projects" | "people" | "thoughts", filePath: string): void {
    const key = type;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const eventNames: Record<string, string> = {
        weekly: "weekly-changed",
        projects: "projects-changed",
        people: "people-changed",
        thoughts: "thoughts-changed",
      };
      const eventName = eventNames[type] || "projects-changed";
      this.emit(eventName, { type, path: filePath });
      console.log(`[BridgeWatcher] ${eventName}: ${filePath}`);
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  suppressWrite(filePath: string): void {
    this.selfWrites.add(filePath);
    setTimeout(() => this.selfWrites.delete(filePath), 500);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    console.log("[BridgeWatcher] Stopped");
  }
}

// Singleton
let bridgeWatcher: BridgeWatcher | null = null;

export function getBridgeWatcher(): BridgeWatcher {
  if (!bridgeWatcher) {
    const vaultPath = process.env.BRIDGE_VAULT_PATH || path.join(os.homedir(), "work/bridge");
    bridgeWatcher = new BridgeWatcher(vaultPath);
  }
  return bridgeWatcher;
}
