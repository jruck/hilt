/**
 * Session Watcher
 *
 * Watches JSONL files for registered Hilt sessions only.
 * On startup, reads the registry and watches non-archived sessions.
 * Provides watchSession/unwatchSession for dynamic management.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { deriveSessionState, parseJSONLEntries } from "../../src/lib/session-status";
import { readSessionsRegistry } from "../../src/lib/db";
import { getSessionJSONLPath } from "../../src/lib/claude-sessions";
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
  private readonly debounceMs = 50;
  private readonly claudeDir: string;
  // Track which files we're watching: sessionId -> filePath
  private watchedFiles: Map<string, string> = new Map();

  constructor() {
    super();
    this.claudeDir = path.join(os.homedir(), ".claude", "projects");
  }

  /**
   * Start watching registered session files
   */
  start(): void {
    if (this.watcher) {
      console.log("[SessionWatcher] Already watching");
      return;
    }

    // Read registry and find JSONL paths for non-archived sessions
    const sessions = readSessionsRegistry();
    const filePaths: string[] = [];

    for (const session of sessions) {
      if (session.archived) continue;
      if (session.id.startsWith("new-")) continue; // Skip temp sessions

      const jsonlPath = getSessionJSONLPath(session.id, session.projectPath);
      if (jsonlPath) {
        filePaths.push(jsonlPath);
        this.watchedFiles.set(session.id, jsonlPath);
      }
    }

    console.log(`[SessionWatcher] Starting to watch ${filePaths.length} registered session files`);

    if (filePaths.length === 0) {
      // Watch a dummy pattern so we can add files later
      this.watcher = chokidar.watch([], {
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 25,
        },
      });
    } else {
      this.watcher = chokidar.watch(filePaths, {
        ignoreInitial: false,
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 25,
        },
      });
    }

    this.watcher.on("add", (filePath) => {
      if (this.isWatchedFile(filePath)) {
        this.handleFileAdd(filePath);
      }
    });

    this.watcher.on("change", (filePath) => {
      if (this.isWatchedFile(filePath)) {
        this.debouncedHandleChange(filePath);
      }
    });

    this.watcher.on("unlink", (filePath) => {
      if (this.isWatchedFile(filePath)) {
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

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.fileStates.clear();
    this.watchedFiles.clear();

    console.log("[SessionWatcher] Stopped");
  }

  /**
   * Start watching a specific session's JSONL file
   */
  watchSession(sessionId: string, projectPath: string): void {
    if (this.watchedFiles.has(sessionId)) return;

    const jsonlPath = getSessionJSONLPath(sessionId, projectPath);
    if (!jsonlPath) {
      // File doesn't exist yet — watch the directory for it
      const folderName = projectPath.replace(/\//g, "-");
      const expectedPath = path.join(this.claudeDir, folderName, `${sessionId}.jsonl`);
      this.watchedFiles.set(sessionId, expectedPath);
      if (this.watcher) {
        this.watcher.add(expectedPath);
      }
      console.log(`[SessionWatcher] Queued watch for ${sessionId} (file not yet created)`);
      return;
    }

    this.watchedFiles.set(sessionId, jsonlPath);
    if (this.watcher) {
      this.watcher.add(jsonlPath);
    }
    console.log(`[SessionWatcher] Watching session ${sessionId}`);
  }

  /**
   * Stop watching a specific session
   */
  unwatchSession(sessionId: string): void {
    const filePath = this.watchedFiles.get(sessionId);
    if (!filePath) return;

    this.watchedFiles.delete(sessionId);
    if (this.watcher) {
      this.watcher.unwatch(filePath);
    }
    this.fileStates.delete(filePath);
    console.log(`[SessionWatcher] Unwatched session ${sessionId}`);
  }

  /**
   * Check if a file path is being watched
   */
  private isWatchedFile(filePath: string): boolean {
    for (const watched of this.watchedFiles.values()) {
      if (watched === filePath) return true;
    }
    return false;
  }

  /**
   * Extract session ID from file path
   */
  private getSessionId(filePath: string): string {
    return path.basename(filePath, ".jsonl");
  }

  /**
   * Extract project folder from file path
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

      this.fileStates.set(filePath, {
        byteOffset: Buffer.byteLength(content, "utf-8"),
        lastModTime: Date.now(),
        derivedStatus,
      });

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

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const entries = parseJSONLEntries(content);
      const derivedStatus = deriveSessionState(entries);

      this.fileStates.set(filePath, {
        byteOffset: Buffer.byteLength(content, "utf-8"),
        lastModTime: Date.now(),
        derivedStatus,
      });

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

    this.fileStates.delete(filePath);
    const timer = this.debounceTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filePath);
    }

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
