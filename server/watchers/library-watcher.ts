import * as chokidar from "chokidar";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { CANDIDATE_CACHE_DIR } from "../../src/lib/library/candidate-cache";
import {
  libraryProcessingDir,
  processingArtifactFromFile,
  processingQueueSummary,
} from "../../src/lib/library/processing";
import type { LibraryProcessingState } from "../../src/lib/library/types";
import { ensureDir, hashId } from "../../src/lib/library/utils";
import { relativeVaultPath } from "../../src/lib/library/markdown";

export interface LibraryArtifactChangedEvent {
  operation: "add" | "change" | "unlink";
  id: string;
  path: string;
  processing?: LibraryProcessingState;
}

export interface LibraryQueueChangedEvent {
  queue_depth: number;
  active: number;
  blocked: number;
  oldest_queued_at: string | null;
}

export class LibraryWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private artifactTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private knownArtifacts = new Map<string, { id: string; processing?: LibraryProcessingState }>();
  private readyPromise: Promise<void> = Promise.resolve();

  constructor(private readonly vaultPath: string, private readonly debounceMs = 180) {
    super();
  }

  start(): void {
    if (this.watcher) return;
    const watchPaths = [
      path.join(this.vaultPath, "references"),
      libraryProcessingDir(this.vaultPath),
    ];
    for (const watchPath of [...watchPaths, path.join(this.vaultPath, CANDIDATE_CACHE_DIR)]) ensureDir(watchPath);
    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
      ignored: (filePath) => {
        const name = path.basename(filePath);
        return name === ".DS_Store" || name.endsWith(".tmp") || name.includes(".tmp.");
      },
      usePolling: process.env.HILT_LIBRARY_WATCHER_POLLING === "1",
      interval: 40,
    });
    this.readyPromise = new Promise((resolve) => this.watcher?.once("ready", resolve));
    this.watcher.on("all", (operation, filePath) => this.handle(operation, filePath));
    this.watcher.on("error", (error) => console.error("[LibraryWatcher] Error:", error));
    console.log(`[LibraryWatcher] Watching references, candidates, and queue for ${this.vaultPath}`);
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  private handle(operation: string, filePath: string): void {
    const relative = relativeVaultPath(this.vaultPath, filePath);
    if (filePath.startsWith(libraryProcessingDir(this.vaultPath))) {
      this.debounceQueue();
      return;
    }
    if (!filePath.endsWith(".md") || !["add", "change", "unlink"].includes(operation)) return;
    const previous = this.knownArtifacts.get(filePath);
    const artifact = fs.existsSync(filePath) ? processingArtifactFromFile(this.vaultPath, filePath) : null;
    const id = artifact?.id || previous?.id || hashId(relative);
    if (artifact) this.knownArtifacts.set(filePath, { id, processing: artifact.processing });
    else this.knownArtifacts.delete(filePath);
    const event: LibraryArtifactChangedEvent = {
      operation: operation as LibraryArtifactChangedEvent["operation"],
      id,
      path: relative,
      processing: artifact?.processing || previous?.processing,
    };
    const existing = this.artifactTimers.get(id);
    if (existing) clearTimeout(existing);
    this.artifactTimers.set(id, setTimeout(() => {
      this.artifactTimers.delete(id);
      this.emit("artifact-changed", event);
    }, this.debounceMs));
  }

  private debounceQueue(): void {
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      this.emit("queue-changed", processingQueueSummary(this.vaultPath));
    }, this.debounceMs);
  }

  stop(): void {
    void this.watcher?.close();
    this.watcher = null;
    for (const timer of this.artifactTimers.values()) clearTimeout(timer);
    this.artifactTimers.clear();
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = null;
  }
}

let singleton: LibraryWatcher | null = null;

export function getLibraryWatcher(vaultPath: string): LibraryWatcher {
  if (!singleton) singleton = new LibraryWatcher(vaultPath);
  return singleton;
}
