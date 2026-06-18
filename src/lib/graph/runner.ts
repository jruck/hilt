/**
 * Graph runner (System → Graph): the server-side orchestrator that keeps the
 * derived `graph.sqlite` index incrementally in sync with the vault and emits a WS
 * `graph` `changed` notification after each settled relax/build.
 *
 * It is instantiated ONLY by `ws-server.ts` and ONLY when `isGraphEnabled()` — with
 * the flag off, `getGraphRunner()` is never called, so none of build/layout/db/
 * candidate-cache work executes and the watchers below are never wired. This module
 * has no importers outside `ws-server.ts` and its own test.
 *
 * Watcher integration is corrected for how the watchers actually emit (see the
 * plan):
 *   - BridgeWatcher debounces by `key = type` and watches at `depth: 2`, so a burst
 *     across many files collapses to ONE emit carrying only the last path. The
 *     runner therefore does NOT trust the single path: `onDirChanged(dir)` re-scans
 *     the affected top-level dir and diffs by `source_file` mtime, updating only the
 *     files whose mtime changed (robust to the collapse + the depth cap).
 *   - ScopeWatcher (persistent internal client at the vault root) covers
 *     `references/` and `docs/`, which BridgeWatcher does not. file:changed /
 *     tree:changed → onFileChanged / onFileRemoved.
 *   - Candidates churn via Library ingest in a dotdir; no watcher fires. The runner
 *     polls `refreshCandidates` on an interval (freshness is EVENTUAL by design).
 *   - A periodic full mtime reconcile over all included dirs is the backstop that
 *     self-heals any drift the event path missed; it also runs once on cold start.
 *
 * The runner coalesces every incremental signal into its own debounce window
 * (>= 200ms), then runs ONE scoped relayout of the accumulated dirty set + ONE
 * notify. It never writes the vault (the graph lives under DATA_DIR), so no
 * suppressWrite is needed and there is no watcher feedback loop.
 */

import * as fs from "fs";
import * as path from "path";
import {
  INCLUDED_DIRS,
  refreshCandidates,
  removeGraphForFile,
  resolveVaultRoot,
  scanVault,
  updateGraphForFile,
} from "./build";
import { getGraphDb } from "./db";
import {
  requestFullLayout,
  requestIncrementalRelayout,
  requestWarmStartLayout,
  warmStartDecision,
} from "./layout";
import { touchGraphChanged } from "./notify";
import { graphLayoutDebounceMs } from "./config";

/** Reserved persistent client id for the ScopeWatcher subscription. */
export const GRAPH_RUNNER_CLIENT_ID = "graph-runner";

/** Candidate poll cadence — candidate freshness is documented as eventual. */
const CANDIDATE_POLL_MS = 60_000;

/** Periodic full mtime-reconcile backstop. */
const RECONCILE_MS = 5 * 60_000;

/** Top-level dirs touched by BridgeWatcher's `people-changed` event. */
const PEOPLE_DIRS = ["people", "meetings"] as const;

/** Map a BridgeWatcher event name to the included top-level dir(s) to re-scan. */
const BRIDGE_DIR_GROUPS: Record<string, readonly string[]> = {
  projects: ["projects"],
  people: PEOPLE_DIRS,
  areas: ["areas"],
  thoughts: ["thoughts"],
  weekly: ["lists/now"],
};

export class GraphRunner {
  private readonly root: string;
  /** source_file → mtimeMs of the last-seen state per included file. */
  private readonly mtimes = new Map<string, number>();
  /** Accumulated changed node ids for the next coalesced relax. */
  private dirtySeeds = new Set<string>();
  /** Whether any change has been applied since the last relax (drives notify). */
  private pendingNotify = false;
  /** Coalescing debounce timer for the relax pass. */
  private relaxTimer: ReturnType<typeof setTimeout> | null = null;
  private candidateTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  /** Single in-flight relax promise so we never overlap passes. */
  private relaxInFlight: Promise<void> | null = null;
  /** A relax was requested while one was in flight — re-run after it settles. */
  private relaxQueued = false;
  private stopped = false;
  private readonly debounceMs: number;

  constructor(rootOverride?: string) {
    this.root = rootOverride ?? resolveVaultRoot();
    // Coalesce at least 200ms (plan); the layout debounce getter is >= the same.
    this.debounceMs = Math.max(200, graphLayoutDebounceMs());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Cold start: seed the in-memory mtime map from the current scan, decide whether
   * the persisted layout needs a (warm-start or cold) pass, and start the candidate
   * poll + periodic reconcile timers. Errors are swallowed and recorded so a boot
   * hiccup never crashes the server; `/meta` surfaces any layout error.
   */
  async start(): Promise<void> {
    try {
      this.seedMtimes();
      await this.coldStartLayout();
    } catch (err) {
      console.error("[GraphRunner] start failed:", err);
    }
    this.candidateTimer = setInterval(() => {
      void this.pollCandidates();
    }, CANDIDATE_POLL_MS);
    this.candidateTimer.unref?.();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_MS);
    this.reconcileTimer.unref?.();
  }

  /** Tear down timers (called from ws-server SIGINT). Idempotent. */
  stop(): void {
    this.stopped = true;
    if (this.relaxTimer) {
      clearTimeout(this.relaxTimer);
      this.relaxTimer = null;
    }
    if (this.candidateTimer) {
      clearInterval(this.candidateTimer);
      this.candidateTimer = null;
    }
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  /** The vault root this runner watches (ws-server subscribes ScopeWatcher to it). */
  getVaultRoot(): string {
    return this.root;
  }

  // -------------------------------------------------------------------------
  // BridgeWatcher path (dir-rescan-by-mtime, NOT single-path surgery)
  // -------------------------------------------------------------------------

  /**
   * A BridgeWatcher event fired for `dir` (one of "projects"/"people"/"thoughts"/
   * "weekly"). Because BridgeWatcher collapses a burst to one event with only the
   * last path, we re-scan the affected top-level dir(s) and diff by mtime, applying
   * only the files that actually changed. Resilient to the depth:2 cap.
   */
  onDirChanged(dir: string): void {
    if (this.stopped) return;
    const dirs = BRIDGE_DIR_GROUPS[dir] ?? [dir];
    try {
      this.diffDirs(dirs);
    } catch (err) {
      console.error(`[GraphRunner] onDirChanged(${dir}) failed:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // ScopeWatcher path (references/ + docs/ — exact file paths)
  // -------------------------------------------------------------------------

  /** A wikilink-bearing file under the vault changed (ScopeWatcher file:changed). */
  onFileChanged(absPath: string): void {
    if (this.stopped) return;
    if (!this.isIncludedFile(absPath)) return;
    try {
      let mtime = 0;
      try {
        mtime = fs.statSync(absPath).mtimeMs;
      } catch {
        // Vanished between event and stat — treat as a removal.
        this.onFileRemoved(absPath);
        return;
      }
      if (this.mtimes.get(absPath) === mtime) return; // no real change
      this.mtimes.set(absPath, mtime);
      this.applyUpdate(absPath);
      this.scheduleRelax();
    } catch (err) {
      console.error(`[GraphRunner] onFileChanged(${absPath}) failed:`, err);
    }
  }

  /** A wikilink-bearing file was removed (ScopeWatcher tree:changed unlink). */
  onFileRemoved(absPath: string): void {
    if (this.stopped) return;
    if (!this.isIncludedFile(absPath)) return;
    try {
      this.mtimes.delete(absPath);
      this.applyRemove(absPath);
      this.scheduleRelax();
    } catch (err) {
      console.error(`[GraphRunner] onFileRemoved(${absPath}) failed:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Candidate refresh (eventual)
  // -------------------------------------------------------------------------

  /** Poll the candidate cache and apply the delta. Public for the test/manual use. */
  async pollCandidates(): Promise<void> {
    if (this.stopped) return;
    try {
      const { changed, removed } = refreshCandidates({ root: this.root, db: getGraphDb() });
      const touched = [...changed, ...removed];
      if (touched.length > 0) {
        for (const id of touched) this.dirtySeeds.add(id);
        this.scheduleRelax();
      }
    } catch (err) {
      console.error("[GraphRunner] pollCandidates failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Periodic reconcile backstop
  // -------------------------------------------------------------------------

  /**
   * Cheap full mtime diff over every included dir — self-heals any drift the event
   * path missed (e.g. an edit that arrived during a relax, or a watcher that never
   * fired). Also refreshes candidates so the backstop is complete.
   */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    try {
      this.diffDirs(INCLUDED_DIRS);
      await this.pollCandidates();
      this.refreshSemanticOverlay();
    } catch (err) {
      console.error("[GraphRunner] reconcile failed:", err);
    }
  }

  /**
   * Eventual semantic overlay refresh (like candidates — `semantic.sqlite` churns via the
   * Phase-1 CLI/scheduled jobs, not vault file watchers). Flag-gated + lazily required so
   * the semantic layer never loads with the overlay off. Re-derives only when the semantic
   * watermark advanced past the graph's recorded marker (cheap watermark check — skip the
   * rebuild when nothing re-fit). On change, seed the touched overlay node ids dirty and
   * schedule a relax so the incremental layout repositions just the affected region.
   */
  private refreshSemanticOverlay(): void {
    if (process.env.HILT_GRAPH_SEMANTIC !== "true") return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const overlay = require("./semantic-overlay") as typeof import("./semantic-overlay");
      const db = getGraphDb();
      const before = new Set(this.overlayNodeIds(db));
      const changed = overlay.refreshSemanticOverlayIfStale({ db });
      if (!changed) return;
      const after = this.overlayNodeIds(db);
      // Seed both prior and current overlay nodes so vacated positions also re-relax.
      for (const id of before) this.dirtySeeds.add(id);
      for (const id of after) this.dirtySeeds.add(id);
      this.scheduleRelax();
    } catch (err) {
      console.error("[GraphRunner] semantic overlay refresh failed:", err);
    }
  }

  /** Current topic/entity overlay node ids (the dirty-seed set for an overlay change). */
  private overlayNodeIds(db: ReturnType<typeof getGraphDb>): string[] {
    return (db.prepare("SELECT id FROM graph_nodes WHERE type IN ('topic','entity')").all() as Array<{ id: string }>).map(
      (r) => r.id,
    );
  }

  // -------------------------------------------------------------------------
  // Internal: mtime diff + apply
  // -------------------------------------------------------------------------

  /** Seed the mtime map from a full scan (cold start; no graph writes). */
  private seedMtimes(): void {
    this.mtimes.clear();
    for (const file of scanVault(this.root)) {
      this.mtimes.set(file.absPath, file.mtimeMs);
    }
  }

  /**
   * Diff the given top-level dirs against the in-memory mtime map and apply the
   * changes. New/modified files → updateGraphForFile; vanished files (present in the
   * map but no longer on disk under these dirs) → removeGraphForFile. Updates the
   * mtime map in lockstep. Coalesces all touched nodes into one scheduled relax.
   */
  private diffDirs(dirs: readonly string[]): void {
    const dirSet = new Set(dirs);
    const seen = new Set<string>();
    let touched = false;

    // Scan only the requested dirs (scanVault walks all included dirs; filter to the
    // subset so a `projects-changed` event doesn't re-stat `references/` + `docs/`).
    for (const file of scanVault(this.root)) {
      if (!dirSet.has(file.dir)) continue;
      seen.add(file.absPath);
      const prev = this.mtimes.get(file.absPath);
      if (prev === file.mtimeMs) continue;
      this.mtimes.set(file.absPath, file.mtimeMs);
      this.applyUpdate(file.absPath);
      touched = true;
    }

    // Detect removals: anything previously tracked under these dirs that the scan no
    // longer returned.
    for (const tracked of [...this.mtimes.keys()]) {
      if (seen.has(tracked)) continue;
      if (!this.pathInDirs(tracked, dirSet)) continue;
      this.mtimes.delete(tracked);
      this.applyRemove(tracked);
      touched = true;
    }

    if (touched) this.scheduleRelax();
  }

  /** Re-extract a single file's nodes/edges, accumulating its dirty region. */
  private applyUpdate(absPath: string): void {
    const db = getGraphDb();
    // Seed the relax with the file's nodes both before (in case its node set shrank)
    // and after the update, so vacated positions also get re-relaxed.
    for (const id of this.nodeIdsForFile(absPath)) this.dirtySeeds.add(id);
    updateGraphForFile(absPath, { root: this.root, db });
    for (const id of this.nodeIdsForFile(absPath)) this.dirtySeeds.add(id);
  }

  /** Remove a deleted file's node + dangling edges, accumulating its dirty region. */
  private applyRemove(absPath: string): void {
    const db = getGraphDb();
    for (const id of this.nodeIdsForFile(absPath)) this.dirtySeeds.add(id);
    removeGraphForFile(absPath, { root: this.root, db });
  }

  /** Current node ids whose source_file is the given path. */
  private nodeIdsForFile(absPath: string): string[] {
    const rows = getGraphDb()
      .prepare("SELECT id FROM graph_nodes WHERE source_file = ?")
      .all(absPath) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  // -------------------------------------------------------------------------
  // Coalesced relax + notify
  // -------------------------------------------------------------------------

  /** Schedule a coalesced incremental relayout after the debounce window. */
  private scheduleRelax(): void {
    this.pendingNotify = true;
    if (this.stopped) return;
    if (this.relaxTimer) clearTimeout(this.relaxTimer);
    this.relaxTimer = setTimeout(() => {
      this.relaxTimer = null;
      void this.runRelax();
    }, this.debounceMs);
    this.relaxTimer.unref?.();
  }

  /**
   * Run a single scoped relayout of the accumulated dirty seeds, then notify. If a
   * relax is already in flight, mark it queued and re-run once it settles (a burst
   * mid-relax is absorbed). The layout engine itself is single-flight; if it returns
   * blocked we keep the seeds and re-schedule.
   */
  private async runRelax(): Promise<void> {
    if (this.stopped) return;
    if (this.relaxInFlight) {
      this.relaxQueued = true;
      return;
    }
    const seeds = [...this.dirtySeeds];
    this.dirtySeeds.clear();
    const shouldNotify = this.pendingNotify;
    this.pendingNotify = false;

    this.relaxInFlight = (async () => {
      try {
        const result = await requestIncrementalRelayout(seeds, { db: getGraphDb() });
        if (result.blocked) {
          // Engine busy (e.g. a /rebuild full pass) — keep the work and retry.
          for (const id of seeds) this.dirtySeeds.add(id);
          this.pendingNotify = this.pendingNotify || shouldNotify;
          this.relaxQueued = true;
          return;
        }
        if (shouldNotify) {
          touchGraphChanged({ kind: "incremental", changed: seeds });
        }
      } catch (err) {
        // Layout records last_error + leaves a recoverable stale state; keep seeds.
        console.error("[GraphRunner] relax failed:", err);
        for (const id of seeds) this.dirtySeeds.add(id);
        this.pendingNotify = this.pendingNotify || shouldNotify;
      }
    })();

    try {
      await this.relaxInFlight;
    } finally {
      this.relaxInFlight = null;
    }

    if (this.relaxQueued && !this.stopped) {
      this.relaxQueued = false;
      this.scheduleRelax();
    }
  }

  // -------------------------------------------------------------------------
  // Cold-start layout decision
  // -------------------------------------------------------------------------

  /**
   * On boot: if the index has no nodes yet, do nothing (a /rebuild or the first edit
   * will build it; we don't auto-build an empty index here). If positions are
   * present and valid → no-op (already frozen). Otherwise run the appropriate pass:
   * a cold/empty position set → full layout; drift (dirty/stale) → warm-start. Emits
   * a notify on completion so a client that mounts during boot loads the canvas.
   */
  private async coldStartLayout(): Promise<void> {
    const db = getGraphDb();
    // Don't bootstrap an empty index — leave that to /rebuild or the first event.
    const nodeCount = (db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE type != 'tag'").get() as { c: number }).c;
    if (nodeCount === 0) return;

    const decision = warmStartDecision(db);
    if (!decision.needsLayout) return;

    // No positions at all → a full cold solve; otherwise a cheap warm-start.
    const positionCount = (db.prepare("SELECT COUNT(*) AS c FROM node_positions").get() as { c: number }).c;
    const result =
      positionCount === 0
        ? await requestFullLayout(`cold-start:${decision.reason}`, { db })
        : await requestWarmStartLayout({ db });
    if (!result.blocked) {
      touchGraphChanged({ kind: "full" });
    }
  }

  // -------------------------------------------------------------------------
  // Path helpers
  // -------------------------------------------------------------------------

  /** True if `absPath` is a `.md` file under one of the included top-level dirs. */
  private isIncludedFile(absPath: string): boolean {
    if (!absPath.endsWith(".md")) return false;
    const rel = path.relative(this.root, absPath).split(path.sep).join("/");
    if (rel.startsWith("..")) return false;
    if (rel.split("/").some((seg) => seg.startsWith(".") && seg.length > 1)) return false;
    return INCLUDED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  }

  /** True if `absPath` lives under one of the given top-level dirs. */
  private pathInDirs(absPath: string, dirSet: Set<string>): boolean {
    const rel = path.relative(this.root, absPath).split(path.sep).join("/");
    if (rel.startsWith("..")) return false;
    for (const dir of dirSet) {
      if (rel === dir || rel.startsWith(`${dir}/`)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Singleton (instantiated by ws-server only when isGraphEnabled())
// ---------------------------------------------------------------------------

let runner: GraphRunner | null = null;

export function getGraphRunner(rootOverride?: string): GraphRunner {
  if (!runner) {
    runner = new GraphRunner(rootOverride);
  }
  return runner;
}

/** Test-only: reset the singleton so a fresh runner can be constructed. */
export function resetGraphRunnerForTests(): void {
  if (runner) runner.stop();
  runner = null;
}
