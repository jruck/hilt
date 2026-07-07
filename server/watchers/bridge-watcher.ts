/**
 * Bridge Watcher
 *
 * Watches the bridge vault's weekly lists and primary Bridge directories.
 * Emits events when Bridge-backed files change.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isIgnoredBridgePath } from "./watch-ignore";

export type BridgeChangeType = "weekly" | "projects" | "people" | "thoughts" | "areas" | "tasks";

export interface BridgeChangedEvent {
  type: BridgeChangeType;
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
    // Ensure the task stores exist so a fresh vault has something to watch
    // (tasks/.proposals/ creates tasks/ too). Best-effort: a read-only vault
    // must not take the watcher down.
    try {
      fs.mkdirSync(path.join(this.vaultPath, "tasks", ".proposals"), { recursive: true });
    } catch (err) {
      console.warn("[BridgeWatcher] Could not ensure tasks dirs:", err);
    }

    const watchPaths = [
      path.join(this.vaultPath, "lists", "now"),
      path.join(this.vaultPath, "projects"),
      path.join(this.vaultPath, "areas"),
      path.join(this.vaultPath, "thoughts"),
      path.join(this.vaultPath, "people"),
      path.join(this.vaultPath, "meetings"),
      path.join(this.vaultPath, "tasks"),
    ];

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      depth: 2,
      // NOT the blanket dot-regex: tasks/.proposals/ must be watched (proposal task
      // files live there from birth). See watch-ignore.ts for the exact semantics.
      ignored: (watchedPath: string) => isIgnoredBridgePath(watchedPath),
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

      let changeType: BridgeChangeType;
      if (filePath.includes(path.join("lists", "now"))) {
        changeType = "weekly";
      } else if (filePath.includes(path.sep + "tasks" + path.sep)) {
        // Covers tasks/*.md AND tasks/.proposals/*.md — one event for both stores.
        changeType = "tasks";
      } else if (filePath.includes(path.sep + "people" + path.sep) || filePath.includes(path.sep + "meetings" + path.sep)) {
        changeType = "people";
      } else if (filePath.includes(path.sep + "areas" + path.sep)) {
        changeType = "areas";
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

  private debouncedEmit(type: BridgeChangeType, filePath: string): void {
    const key = type;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const eventNames: Record<string, string> = {
        weekly: "weekly-changed",
        projects: "projects-changed",
        people: "people-changed",
        areas: "areas-changed",
        thoughts: "thoughts-changed",
        tasks: "tasks-changed",
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

export function getBridgeWatcher(vaultPathOverride?: string): BridgeWatcher {
  if (!bridgeWatcher) {
    const vaultPath = vaultPathOverride || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(os.homedir(), "work/bridge");
    bridgeWatcher = new BridgeWatcher(vaultPath);
  }
  return bridgeWatcher;
}
