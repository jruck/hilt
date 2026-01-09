/**
 * Inbox Watcher
 *
 * Watches Todo.md files for changes.
 * Each scope has its own Todo.md file at {scopePath}/docs/Todo.md.
 * Emits events when inbox content changes.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";

// Events emitted by InboxWatcher
export interface InboxChangedEvent {
  scope: string;
  path: string;
}

interface WatchEntry {
  watcher: chokidar.FSWatcher;
  clients: Set<string>;
}

export class InboxWatcher extends EventEmitter {
  private watchers: Map<string, WatchEntry> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly debounceMs = 200;

  /**
   * Get the Todo.md file path for a scope
   */
  private getTodoPath(scopePath: string): string {
    return path.join(scopePath, "docs", "Todo.md");
  }

  /**
   * Start watching inbox for a scope
   * Uses ref counting to share watchers between clients
   */
  watchInbox(scopePath: string, clientId: string): void {
    const existing = this.watchers.get(scopePath);
    if (existing) {
      existing.clients.add(clientId);
      console.log(`[InboxWatcher] Client ${clientId.slice(0, 8)} joined inbox watch for ${scopePath} (${existing.clients.size} clients)`);
      return;
    }

    const todoPath = this.getTodoPath(scopePath);
    const docsDir = path.dirname(todoPath);

    // Check if docs directory exists
    if (!fs.existsSync(docsDir)) {
      console.log(`[InboxWatcher] Docs directory doesn't exist yet: ${docsDir}`);
      // We'll still set up the watcher to catch when the file is created
    }

    console.log(`[InboxWatcher] Starting to watch: ${todoPath}`);

    // Watch the docs directory for the Todo.md file specifically
    const watcher = chokidar.watch(docsDir, {
      ignoreInitial: true,
      depth: 0, // Only watch direct children
      ignored: (filePath: string) => {
        // Only watch Todo.md
        const basename = path.basename(filePath);
        return basename !== "Todo.md" && filePath !== docsDir;
      },
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    watcher.on("add", (filePath) => {
      if (path.basename(filePath) === "Todo.md") {
        this.debouncedEmitChange(scopePath, filePath);
      }
    });

    watcher.on("change", (filePath) => {
      if (path.basename(filePath) === "Todo.md") {
        this.debouncedEmitChange(scopePath, filePath);
      }
    });

    watcher.on("unlink", (filePath) => {
      if (path.basename(filePath) === "Todo.md") {
        this.emitChange(scopePath, filePath);
      }
    });

    watcher.on("error", (error) => {
      console.error(`[InboxWatcher] Error watching ${todoPath}:`, error);
    });

    this.watchers.set(scopePath, {
      watcher,
      clients: new Set([clientId]),
    });
  }

  /**
   * Stop watching inbox for a scope
   */
  unwatchInbox(scopePath: string, clientId: string): void {
    const entry = this.watchers.get(scopePath);
    if (!entry) return;

    entry.clients.delete(clientId);
    console.log(`[InboxWatcher] Client ${clientId.slice(0, 8)} left inbox watch for ${scopePath} (${entry.clients.size} clients remaining)`);

    if (entry.clients.size === 0) {
      console.log(`[InboxWatcher] No more clients, closing inbox watcher for: ${scopePath}`);
      entry.watcher.close();
      this.watchers.delete(scopePath);

      // Clean up debounce timer
      const timer = this.debounceTimers.get(scopePath);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(scopePath);
      }
    }
  }

  /**
   * Remove a client from all inbox watches (on disconnect)
   */
  removeClient(clientId: string): void {
    for (const [scopePath] of this.watchers) {
      this.unwatchInbox(scopePath, clientId);
    }
  }

  /**
   * Debounced change emitter
   */
  private debouncedEmitChange(scope: string, filePath: string): void {
    const existing = this.debounceTimers.get(scope);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(scope);
      this.emitChange(scope, filePath);
    }, this.debounceMs);

    this.debounceTimers.set(scope, timer);
  }

  /**
   * Emit an inbox changed event
   */
  private emitChange(scope: string, filePath: string): void {
    const event: InboxChangedEvent = {
      scope,
      path: filePath,
    };
    this.emit("inbox:changed", event);
    console.log(`[InboxWatcher] Inbox changed: ${scope}`);
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

    console.log("[InboxWatcher] Stopped all watchers");
  }

  /**
   * Get list of currently watched scopes
   */
  getWatchedScopes(): string[] {
    return Array.from(this.watchers.keys());
  }
}

// Singleton instance
let inboxWatcher: InboxWatcher | null = null;

/**
 * Get or create the inbox watcher singleton
 */
export function getInboxWatcher(): InboxWatcher {
  if (!inboxWatcher) {
    inboxWatcher = new InboxWatcher();
  }
  return inboxWatcher;
}
