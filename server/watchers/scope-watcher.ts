/**
 * Scope Watcher
 *
 * Watches scope directories for file system changes.
 * Emits events for tree changes (file/dir add/remove) and file content changes.
 * Supports multiple clients watching the same scope with ref counting.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import * as path from "path";

// Events emitted by ScopeWatcher
export interface TreeChangedEvent {
  scope: string;
  type: "add" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  relativePath: string;
}

export interface FileChangedEvent {
  scope: string;
  path: string;
  relativePath: string;
}

interface WatchEntry {
  watcher: chokidar.FSWatcher;
  clients: Set<string>;
}

export class ScopeWatcher extends EventEmitter {
  private watchers: Map<string, WatchEntry> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly debounceMs = 200;

  /**
   * Start watching a scope directory for a client
   * Uses ref counting to share watchers between clients
   */
  watchScope(scopePath: string, clientId: string): void {
    const existing = this.watchers.get(scopePath);
    if (existing) {
      existing.clients.add(clientId);
      console.log(`[ScopeWatcher] Client ${clientId.slice(0, 8)} joined scope ${scopePath} (${existing.clients.size} clients)`);
      return;
    }

    console.log(`[ScopeWatcher] Starting to watch: ${scopePath}`);

    const watcher = chokidar.watch(scopePath, {
      ignoreInitial: true, // Don't emit events for existing files
      ignored: [
        /node_modules/,
        /\.git/,
        /\.DS_Store/,
        /\.swp$/,
        /~$/,
        // macOS home directory folders (avoid file descriptor exhaustion)
        /\/Applications$/,
        /\/Library$/,
        /\/System$/,
        /\/Movies$/,
        /\/Music$/,
        /\/Pictures$/,
        /\/Downloads$/,
        /\/Documents$/,
        /\/Desktop$/,
        /\/Public$/,
        // Cloud sync folders - partial match (case-insensitive)
        /\/[^/]*onedrive[^/]*$/i,
        /\/[^/]*google drive[^/]*$/i,
        /\/[^/]*my drive[^/]*$/i,
        /\/[^/]*creative cloud[^/]*$/i,
        /\/[^/]*dropbox[^/]*$/i,
        /\/[^/]*icloud drive[^/]*$/i,
        /\/[^/]*box sync[^/]*$/i,
      ],
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    watcher.on("add", (filePath) => {
      this.emitTreeChange(scopePath, "add", filePath);
    });

    watcher.on("unlink", (filePath) => {
      this.emitTreeChange(scopePath, "unlink", filePath);
    });

    watcher.on("addDir", (filePath) => {
      // Don't emit for the root scope directory itself
      if (filePath !== scopePath) {
        this.emitTreeChange(scopePath, "addDir", filePath);
      }
    });

    watcher.on("unlinkDir", (filePath) => {
      this.emitTreeChange(scopePath, "unlinkDir", filePath);
    });

    watcher.on("change", (filePath) => {
      this.debouncedEmitFileChange(scopePath, filePath);
    });

    watcher.on("error", (error) => {
      console.error(`[ScopeWatcher] Error watching ${scopePath}:`, error);
    });

    this.watchers.set(scopePath, {
      watcher,
      clients: new Set([clientId]),
    });
  }

  /**
   * Stop watching a scope directory for a client
   * Only closes the watcher when all clients have unsubscribed
   */
  unwatchScope(scopePath: string, clientId: string): void {
    const entry = this.watchers.get(scopePath);
    if (!entry) return;

    entry.clients.delete(clientId);
    console.log(`[ScopeWatcher] Client ${clientId.slice(0, 8)} left scope ${scopePath} (${entry.clients.size} clients remaining)`);

    if (entry.clients.size === 0) {
      console.log(`[ScopeWatcher] No more clients, closing watcher for: ${scopePath}`);
      entry.watcher.close();
      this.watchers.delete(scopePath);

      // Clean up any pending debounce timers for this scope
      for (const [key, timer] of this.debounceTimers) {
        if (key.startsWith(scopePath)) {
          clearTimeout(timer);
          this.debounceTimers.delete(key);
        }
      }
    }
  }

  /**
   * Remove a client from all scopes (on disconnect)
   */
  removeClient(clientId: string): void {
    for (const [scopePath] of this.watchers) {
      this.unwatchScope(scopePath, clientId);
    }
  }

  /**
   * Emit a tree change event
   */
  private emitTreeChange(scope: string, type: TreeChangedEvent["type"], filePath: string): void {
    const relativePath = path.relative(scope, filePath);
    const event: TreeChangedEvent = {
      scope,
      type,
      path: filePath,
      relativePath,
    };
    this.emit("tree:changed", event);
    console.log(`[ScopeWatcher] Tree changed: ${type} ${relativePath}`);
  }

  /**
   * Debounced file change emitter to coalesce rapid changes
   */
  private debouncedEmitFileChange(scope: string, filePath: string): void {
    const key = `${scope}:${filePath}`;
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emitFileChange(scope, filePath);
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Emit a file change event
   */
  private emitFileChange(scope: string, filePath: string): void {
    const relativePath = path.relative(scope, filePath);
    const event: FileChangedEvent = {
      scope,
      path: filePath,
      relativePath,
    };
    this.emit("file:changed", event);
    console.log(`[ScopeWatcher] File changed: ${relativePath}`);
  }

  /**
   * Stop all watchers
   */
  stop(): void {
    for (const [, entry] of this.watchers) {
      entry.watcher.close();
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.log("[ScopeWatcher] Stopped all watchers");
  }

  /**
   * Get list of currently watched scopes
   */
  getWatchedScopes(): string[] {
    return Array.from(this.watchers.keys());
  }
}

// Singleton instance
let scopeWatcher: ScopeWatcher | null = null;

/**
 * Get or create the scope watcher singleton
 */
export function getScopeWatcher(): ScopeWatcher {
  if (!scopeWatcher) {
    scopeWatcher = new ScopeWatcher();
  }
  return scopeWatcher;
}
