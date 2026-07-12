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
import { recommendationRoot } from "../../src/lib/library/recommendation-store";

export interface LibraryArtifactChangedEvent {
  operation: "add" | "change" | "unlink";
  id: string;
  path: string;
  processing?: LibraryProcessingState;
  became_ready?: boolean;
}

export interface LibraryQueueChangedEvent {
  queue_depth: number;
  active: number;
  blocked: number;
  oldest_queued_at: string | null;
  active_item: { artifact_uid: string; title: string; path: string } | null;
}

export interface LibraryContextChangedEvent {
  path: string;
  kind: "meeting" | "task" | "project" | "area";
}

export interface LibraryRecommendationsChangedEvent {
  path: string | null;
  affects_feed: boolean;
}

export class LibraryWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private artifactTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingArtifactEvents = new Map<string, LibraryArtifactChangedEvent>();
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private recommendationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRecommendationPath: string | null = null;
  private pendingRecommendationAffectsFeed = false;
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
      recommendationRoot(this.vaultPath),
      path.join(this.vaultPath, "meetings"),
      path.join(this.vaultPath, "tasks"),
      path.join(this.vaultPath, "projects"),
      path.join(this.vaultPath, "areas"),
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
    if (filePath.startsWith(recommendationRoot(this.vaultPath))) {
      if (path.basename(filePath) === "editor.lock") return;
      if (["add", "change", "unlink"].includes(operation) && !path.basename(filePath).includes(".tmp.")) {
        this.debounceRecommendations(relative);
      }
      return;
    }
    if (filePath.startsWith(libraryProcessingDir(this.vaultPath))) {
      this.debounceQueue();
      return;
    }
    const contextKind = relative.startsWith("meetings/")
      ? "meeting"
      : relative.startsWith("tasks/")
        ? "task"
        : relative.startsWith("projects/")
          ? "project"
          : relative.startsWith("areas/")
            ? "area"
            : null;
    if (contextKind) {
      if (filePath.endsWith(".md") && ["add", "change"].includes(operation)) {
        this.emit("context-changed", { path: relative, kind: contextKind } satisfies LibraryContextChangedEvent);
      }
      return;
    }
    if (!filePath.endsWith(".md") || !["add", "change", "unlink"].includes(operation)) return;
    const previous = this.knownArtifacts.get(filePath);
    const artifact = fs.existsSync(filePath) ? processingArtifactFromFile(this.vaultPath, filePath) : null;
    const id = artifact?.id || previous?.id || hashId(relative);
    if (artifact) this.knownArtifacts.set(filePath, { id, processing: artifact.processing });
    else this.knownArtifacts.delete(filePath);
    const nextEvent: LibraryArtifactChangedEvent = {
      operation: operation as LibraryArtifactChangedEvent["operation"],
      id,
      path: relative,
      processing: artifact?.processing || previous?.processing,
      became_ready: artifact?.processing?.state === "ready"
        && (operation === "add" || (Boolean(previous?.processing) && previous?.processing?.state !== "ready")),
    };
    const pending = this.pendingArtifactEvents.get(id);
    const event: LibraryArtifactChangedEvent = {
      ...nextEvent,
      became_ready: Boolean(nextEvent.became_ready || pending?.became_ready),
      operation: nextEvent.operation === "unlink"
        ? "unlink"
        : pending?.operation === "add"
          ? "add"
          : pending?.operation === "unlink" && nextEvent.operation === "add"
            ? "change"
            : nextEvent.operation,
    };
    this.pendingArtifactEvents.set(id, event);
    const existing = this.artifactTimers.get(id);
    if (existing) clearTimeout(existing);
    this.artifactTimers.set(id, setTimeout(() => {
      this.artifactTimers.delete(id);
      const pendingEvent = this.pendingArtifactEvents.get(id);
      this.pendingArtifactEvents.delete(id);
      if (pendingEvent) this.emit("artifact-changed", pendingEvent);
    }, this.debounceMs));
  }

  private debounceQueue(): void {
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      this.emit("queue-changed", processingQueueSummary(this.vaultPath));
    }, this.debounceMs);
  }

  private debounceRecommendations(relativePath: string): void {
    this.pendingRecommendationPath = relativePath;
    const parts = relativePath.split("/");
    this.pendingRecommendationAffectsFeed = this.pendingRecommendationAffectsFeed
      || parts.includes("batches")
      || ["feed.json", "verdicts.json"].includes(path.basename(relativePath));
    if (this.recommendationTimer) clearTimeout(this.recommendationTimer);
    this.recommendationTimer = setTimeout(() => {
      this.recommendationTimer = null;
      const changedPath = this.pendingRecommendationPath;
      const affectsFeed = this.pendingRecommendationAffectsFeed;
      this.pendingRecommendationPath = null;
      this.pendingRecommendationAffectsFeed = false;
      this.emit("recommendations-changed", { path: changedPath, affects_feed: affectsFeed } satisfies LibraryRecommendationsChangedEvent);
    }, this.debounceMs);
  }

  stop(): void {
    void this.watcher?.close();
    this.watcher = null;
    for (const timer of this.artifactTimers.values()) clearTimeout(timer);
    this.artifactTimers.clear();
    this.pendingArtifactEvents.clear();
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = null;
    if (this.recommendationTimer) clearTimeout(this.recommendationTimer);
    this.recommendationTimer = null;
    this.pendingRecommendationPath = null;
    this.pendingRecommendationAffectsFeed = false;
  }
}

let singleton: LibraryWatcher | null = null;

export function getLibraryWatcher(vaultPath: string): LibraryWatcher {
  if (!singleton) singleton = new LibraryWatcher(vaultPath);
  return singleton;
}
