/**
 * Session Watcher
 *
 * Watches ~/.claude/projects for JSONL file changes.
 * Emits events when sessions are created, updated, or deleted.
 * Performs incremental parsing and status derivation.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { deriveSessionState, parseJSONLEntries } from "../../src/lib/session-status";
import type { DerivedSessionState } from "../../src/lib/types";

// Track state per session file
interface SessionFileState {
  byteOffset: number;
  lastModTime: number;
  derivedStatus: DerivedSessionState;
}

// Events emitted by SessionWatcher
export interface SessionCreatedEvent {
  sessionId: string;
  filePath: string;
  projectFolder: string;
  derivedStatus: DerivedSessionState;
}

export interface SessionUpdatedEvent {
  sessionId: string;
  filePath: string;
  projectFolder: string;
  derivedStatus: DerivedSessionState;
  previousStatus?: DerivedSessionState;
}

export interface SessionDeletedEvent {
  sessionId: string;
  filePath: string;
  projectFolder: string;
}

export class SessionWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private fileStates: Map<string, SessionFileState> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly debounceMs = 50; // Reduced for faster responsiveness
  private readonly claudeDir: string;

  constructor() {
    super();
    this.claudeDir = path.join(os.homedir(), ".claude", "projects");
  }

  /**
   * Start watching for session file changes
   */
  start(): void {
    if (this.watcher) {
      console.log("[SessionWatcher] Already watching");
      return;
    }

    if (!fs.existsSync(this.claudeDir)) {
      console.log(`[SessionWatcher] Claude projects directory doesn't exist: ${this.claudeDir}`);
      return;
    }

    console.log(`[SessionWatcher] Starting to watch: ${this.claudeDir}`);

    this.watcher = chokidar.watch(this.claudeDir, {
      depth: 2, // Project folders are one level deep, JSONL files are another
      ignored: [
        /agent-.*\.jsonl$/, // Ignore agent sub-sessions
        /node_modules/,
        /\.DS_Store/,
      ],
      ignoreInitial: false, // Process existing files on startup
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 50, // Reduced for faster responsiveness
        pollInterval: 25,
      },
    });

    this.watcher.on("add", (filePath) => {
      console.log(`[SessionWatcher] File add event: ${filePath}`);
      if (this.isSessionFile(filePath)) {
        this.handleFileAdd(filePath);
      }
    });

    this.watcher.on("change", (filePath) => {
      console.log(`[SessionWatcher] File change event: ${filePath}`);
      if (this.isSessionFile(filePath)) {
        this.debouncedHandleChange(filePath);
      }
    });

    this.watcher.on("unlink", (filePath) => {
      if (this.isSessionFile(filePath)) {
        this.handleFileDelete(filePath);
      }
    });

    this.watcher.on("error", (error) => {
      console.error("[SessionWatcher] Error:", error);
    });
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.fileStates.clear();

    console.log("[SessionWatcher] Stopped");
  }

  /**
   * Check if a file path is a session JSONL file
   */
  private isSessionFile(filePath: string): boolean {
    const basename = path.basename(filePath);
    return (
      basename.endsWith(".jsonl") &&
      !basename.startsWith("agent-") &&
      !basename.startsWith(".")
    );
  }

  /**
   * Extract session ID from file path
   */
  private getSessionId(filePath: string): string {
    return path.basename(filePath, ".jsonl");
  }

  /**
   * Extract project folder from file path (e.g., "-Users-jruck-Bridge")
   */
  private getProjectFolder(filePath: string): string {
    const dir = path.dirname(filePath);
    return path.basename(dir);
  }

  /**
   * Handle new session file
   */
  private async handleFileAdd(filePath: string): Promise<void> {
    const sessionId = this.getSessionId(filePath);
    const projectFolder = this.getProjectFolder(filePath);

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const entries = parseJSONLEntries(content);
      const derivedStatus = deriveSessionState(entries);

      // Store state
      this.fileStates.set(filePath, {
        byteOffset: Buffer.byteLength(content, "utf-8"),
        lastModTime: Date.now(),
        derivedStatus,
      });

      // Emit event
      const event: SessionCreatedEvent = {
        sessionId,
        filePath,
        projectFolder,
        derivedStatus,
      };
      this.emit("session:created", event);

      console.log(
        `[SessionWatcher] Session created: ${sessionId} (${derivedStatus.status})`
      );
    } catch (error) {
      console.error(`[SessionWatcher] Error processing new file ${filePath}:`, error);
    }
  }

  /**
   * Debounced handler for file changes
   */
  private debouncedHandleChange(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.handleFileChange(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Handle session file change
   */
  private async handleFileChange(filePath: string): Promise<void> {
    const sessionId = this.getSessionId(filePath);
    const projectFolder = this.getProjectFolder(filePath);
    const previousState = this.fileStates.get(filePath);

    console.log(`[SessionWatcher] Processing file change for ${sessionId}`);

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const entries = parseJSONLEntries(content);
      const derivedStatus = deriveSessionState(entries);

      console.log(`[SessionWatcher] ${sessionId}: prev=${previousState?.derivedStatus.status}, new=${derivedStatus.status}`);

      // Update state
      this.fileStates.set(filePath, {
        byteOffset: Buffer.byteLength(content, "utf-8"),
        lastModTime: Date.now(),
        derivedStatus,
      });

      // Emit if status or lastMessage changed (for live updates)
      const statusChanged =
        !previousState || previousState.derivedStatus.status !== derivedStatus.status;
      const messageChanged =
        !previousState || previousState.derivedStatus.lastMessage !== derivedStatus.lastMessage;

      if (statusChanged || messageChanged) {
        const event: SessionUpdatedEvent = {
          sessionId,
          filePath,
          projectFolder,
          derivedStatus,
          previousStatus: previousState?.derivedStatus,
        };
        this.emit("session:updated", event);

        console.log(
          `[SessionWatcher] Session updated: ${sessionId} (${previousState?.derivedStatus.status || "new"} -> ${derivedStatus.status})`
        );
      }
    } catch (error) {
      console.error(`[SessionWatcher] Error processing file change ${filePath}:`, error);
    }
  }

  /**
   * Handle session file deletion
   */
  private handleFileDelete(filePath: string): void {
    const sessionId = this.getSessionId(filePath);
    const projectFolder = this.getProjectFolder(filePath);

    // Clean up state
    this.fileStates.delete(filePath);
    const timer = this.debounceTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filePath);
    }

    // Emit event
    const event: SessionDeletedEvent = {
      sessionId,
      filePath,
      projectFolder,
    };
    this.emit("session:deleted", event);

    console.log(`[SessionWatcher] Session deleted: ${sessionId}`);
  }

  /**
   * Get current derived state for a session
   */
  getSessionState(sessionId: string): DerivedSessionState | null {
    for (const [filePath, state] of this.fileStates) {
      if (this.getSessionId(filePath) === sessionId) {
        return state.derivedStatus;
      }
    }
    return null;
  }

  /**
   * Get all current session states
   */
  getAllSessionStates(): Map<string, DerivedSessionState> {
    const result = new Map<string, DerivedSessionState>();
    for (const [filePath, state] of this.fileStates) {
      const sessionId = this.getSessionId(filePath);
      result.set(sessionId, state.derivedStatus);
    }
    return result;
  }
}

// Singleton instance
let sessionWatcher: SessionWatcher | null = null;

/**
 * Get or create the session watcher singleton
 */
export function getSessionWatcher(): SessionWatcher {
  if (!sessionWatcher) {
    sessionWatcher = new SessionWatcher();
  }
  return sessionWatcher;
}
