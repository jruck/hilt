/**
 * SemanticRunner (Phase 2 — incremental on change): the server-side orchestrator that
 * keeps the derived `semantic.sqlite` cache incrementally in sync with the vault as files
 * change. Structurally a copy of `GraphRunner` (src/lib/graph/runner.ts): a content-hash
 * map (the analog of the GraphRunner mtime map), a debounced + single-flight + queued-rerun
 * work pass, a periodic full-content reconcile backstop, and a scope guard.
 *
 * It is instantiated ONLY by `ws-server.ts` and ONLY when `isSemanticEnabled()` — with the
 * flag off, `getSemanticRunner()` is never called, so none of db/chunking/embed work
 * executes and the watchers below are never wired. This module has no importers outside
 * `ws-server.ts` and its own test (mirroring the GraphRunner's inert posture).
 *
 * The per-item work is an API round-trip (embed + extract), so the coalesce window is
 * larger than layout's (default 2000ms, `SEMANTIC_INCREMENTAL_DEBOUNCE_MS`): a burst of
 * edits collapses into ONE batched pass. The pass is the cheap online path (plan §4.2):
 *   - (re)chunk + embed the changed item → 1 client.embed call per changed item
 *   - extract its entities + resolve them against the EXISTING canonical set (no global re-cluster)
 *   - slot the item into the nearest EXISTING leaf topics by cosine to cached centroids
 * It NEVER re-clusters — topic creation is the weekly re-fit's job (the heavy launchd CLI).
 *
 * Errors are swallowed-and-logged (`[SemanticRunner] …`) so a boot or API hiccup never
 * crashes `ws-server.ts`, matching the GraphRunner's defensive style. The runner never
 * writes the vault (the cache lives under DATA_DIR), so there is no watcher feedback loop.
 */

import * as fs from "fs";
import * as path from "path";
import { INCLUDED_DIRS, resolveVaultRoot, scanVault, type ScannedFile } from "@/lib/graph/build";
import { boundedInt, isSemanticDisabled, semanticAssignCos } from "./config";
import { CANDIDATE_CACHE_DIR, parseCandidateFile } from "@/lib/library/candidate-cache";
import { buildItemChunks, candidateItemChunks, collectCandidateItems, type ItemChunks } from "./chunking";
import {
  deleteChunksForItem,
  deleteDanglingEntities,
  deleteItem,
  deleteItemTopicsForItem,
  deleteMentionsForItem,
  getChunkVectorsForItem,
  getItem,
  getLeafTopicCentroids,
  getSemanticDb,
  recomputeEntityMentionCounts,
  upsertChunk,
  upsertItem,
  upsertItemTopic,
} from "./db";
import { assignItemChunks } from "./assign";
import { extractEntities } from "./extract";
import { createGeminiClient, type SemanticLlmClient } from "./gemini";
import { SEMANTIC_EMBEDDING_MODEL } from "./pipeline";
import { createReconcileBinder } from "./reconcile";
import { resolveAll } from "./resolve";
import { createGeminiMergeJudge, type MergeJudge } from "./resolve-prompt";

/** Reserved persistent client id for the ScopeWatcher subscription (mirrors GRAPH_RUNNER_CLIENT_ID). */
export const SEMANTIC_RUNNER_CLIENT_ID = "semantic-runner";

/** Periodic full content-hash reconcile backstop (re-embed anything the event path missed). */
const RECONCILE_MS = 5 * 60_000;

/** Default coalesce window (ms). Larger than layout's because the work is an API round-trip. */
function debounceMs(): number {
  return boundedInt(process.env.SEMANTIC_INCREMENTAL_DEBOUNCE_MS, 2000, 0, 60_000);
}

export interface SemanticRunnerOptions {
  rootOverride?: string;
  /** Injected LLM client (real Gemini in production; the deterministic fake in tests). */
  client?: SemanticLlmClient;
  /** Injected merge-judge for resolution; defaults to the real Gemini judge. */
  judge?: MergeJudge;
}

export class SemanticRunner {
  private readonly root: string;
  private readonly client: SemanticLlmClient;
  private readonly judge: MergeJudge;
  /** source_file → content_hash of the last-applied state per included file. */
  private readonly hashes = new Map<string, string>();
  /** Accumulated changed source_files for the next coalesced pass. */
  private readonly dirty = new Set<string>();
  /** Accumulated removed source_files (delete-then-clean). */
  private readonly removed = new Set<string>();
  private workTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  /** Single in-flight work promise so we never overlap passes. */
  private inFlight: Promise<void> | null = null;
  /** A pass was requested while one was in flight — re-run after it settles. */
  private queued = false;
  private stopped = false;
  private readonly debounce: number;

  constructor(opts: SemanticRunnerOptions = {}) {
    this.root = opts.rootOverride ?? resolveVaultRoot();
    this.client = opts.client ?? createGeminiClient();
    this.judge = opts.judge ?? createGeminiMergeJudge();
    this.debounce = debounceMs();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Cold start: seed the content-hash map from the current scan (no embed work — the
   * cold-start backfill CLI owns the initial build), then start the periodic reconcile.
   * Errors are swallowed so a boot hiccup never crashes ws-server.
   */
  async start(): Promise<void> {
    try {
      this.seedHashes();
    } catch (err) {
      console.error("[SemanticRunner] start failed:", err);
    }
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_MS);
    this.reconcileTimer.unref?.();
  }

  /** Tear down timers (called from ws-server SIGINT). Idempotent. */
  stop(): void {
    this.stopped = true;
    if (this.workTimer) {
      clearTimeout(this.workTimer);
      this.workTimer = null;
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
  // BridgeWatcher path (dir-rescan-by-content-hash, NOT single-path surgery)
  // -------------------------------------------------------------------------

  /**
   * A BridgeWatcher event fired for `dir`. Because BridgeWatcher collapses a burst to one
   * event carrying only the last path, we re-scan the affected included dir(s) and diff by
   * content hash, enqueuing only the files that actually changed. Resilient to the depth cap.
   */
  onDirChanged(dir: string): void {
    if (this.stopped) return;
    const dirs = BRIDGE_DIR_GROUPS[dir] ?? [dir];
    try {
      this.diffDirs(dirs);
    } catch (err) {
      console.error(`[SemanticRunner] onDirChanged(${dir}) failed:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // ScopeWatcher path (references/ + docs/ — exact file paths)
  // -------------------------------------------------------------------------

  /** A file under the vault changed (ScopeWatcher file:changed). */
  onFileChanged(absPath: string): void {
    if (this.stopped) return;
    if (!this.isInScope(absPath)) return; // scope guard excludes libraries/ + dotdirs (candidate cache excepted)
    try {
      if (!fs.existsSync(absPath)) {
        this.onFileRemoved(absPath);
        return;
      }
      this.enqueueIfChanged(absPath);
    } catch (err) {
      console.error(`[SemanticRunner] onFileChanged(${absPath}) failed:`, err);
    }
  }

  /** A file was removed (ScopeWatcher tree:changed unlink). */
  onFileRemoved(absPath: string): void {
    if (this.stopped) return;
    if (!this.isInScope(absPath)) return;
    try {
      if (!this.hashes.has(absPath)) return; // never tracked → nothing to clean
      this.hashes.delete(absPath);
      this.dirty.delete(absPath);
      this.removed.add(absPath);
      this.scheduleWork();
    } catch (err) {
      console.error(`[SemanticRunner] onFileRemoved(${absPath}) failed:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Periodic reconcile backstop
  // -------------------------------------------------------------------------

  /**
   * Cheap full content-hash diff over every included dir — self-heals any drift the event
   * path missed (an edit that arrived during a pass, a watcher that never fired). Also picks
   * up version drift implicitly: an item the cold-start hasn't embedded at this version has
   * no chunks, so it re-embeds when its hash is (re-)applied. Public for the test/manual use.
   */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    try {
      this.diffDirs(INCLUDED_DIRS);
    } catch (err) {
      console.error("[SemanticRunner] reconcile failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Internal: content-hash diff + enqueue
  // -------------------------------------------------------------------------

  /** Seed the content-hash map from a full scan (cold start; no embed work). */
  private seedHashes(): void {
    this.hashes.clear();
    for (const file of scanVault(this.root)) {
      const item = buildItemChunks(file);
      if (item) this.hashes.set(file.absPath, item.contentHash);
    }
    for (const item of collectCandidateItems(this.root)) {
      this.hashes.set(item.sourceFile, item.contentHash);
    }
  }

  /** Enqueue a single file if its assembled content hash differs from the last-applied. */
  private enqueueIfChanged(absPath: string): void {
    const item = this.itemChunksFor(absPath);
    if (!item) {
      // No embeddable text (empty/frontmatter-only, or a candidate whose status flipped) —
      // treat as a removal if we tracked it.
      if (this.hashes.has(absPath)) this.onFileRemoved(absPath);
      return;
    }
    if (this.hashes.get(absPath) === item.contentHash) return; // no real change
    this.dirty.add(absPath);
    this.scheduleWork();
  }

  /**
   * Diff the given included dirs against the content-hash map and enqueue the changes.
   * New/modified files → dirty; vanished files (tracked but no longer scanned under these
   * dirs) → removed. Coalesces all touched files into one scheduled pass.
   *
   * Candidates (under the dotdir-excluded `references/.cache`) are diffed alongside the
   * `references` dir via the candidate-cache API. They MUST be folded into `seen`, or the
   * removal sweep (path-prefix on `references/`) would falsely sweep every tracked candidate
   * each pass. A candidate whose status flips (promoted/expired/skipped) drops out of the
   * collect → lands in `removed` → its `cand:` row is deleted (itemIdFor's source_file
   * fallback resolves the id).
   */
  private diffDirs(dirs: readonly string[]): void {
    const dirSet = new Set(dirs);
    const seen = new Set<string>();
    let touched = false;

    for (const file of scanVault(this.root)) {
      if (!dirSet.has(file.dir)) continue;
      seen.add(file.absPath);
      const item = buildItemChunks(file);
      if (!item) continue;
      if (this.hashes.get(file.absPath) === item.contentHash) continue;
      this.dirty.add(file.absPath);
      touched = true;
    }

    if (dirSet.has("references")) {
      for (const item of collectCandidateItems(this.root)) {
        seen.add(item.sourceFile);
        if (this.hashes.get(item.sourceFile) === item.contentHash) continue;
        this.dirty.add(item.sourceFile);
        touched = true;
      }
    }

    for (const tracked of [...this.hashes.keys()]) {
      if (seen.has(tracked)) continue;
      if (!this.pathInDirs(tracked, dirSet)) continue;
      this.hashes.delete(tracked);
      this.dirty.delete(tracked);
      this.removed.add(tracked);
      touched = true;
    }

    if (touched) this.scheduleWork();
  }

  // -------------------------------------------------------------------------
  // Coalesced single-flight work pass
  // -------------------------------------------------------------------------

  /** Schedule a coalesced work pass after the debounce window. */
  private scheduleWork(): void {
    if (this.stopped) return;
    if (this.workTimer) clearTimeout(this.workTimer);
    this.workTimer = setTimeout(() => {
      this.workTimer = null;
      void this.runWork();
    }, this.debounce);
    this.workTimer.unref?.();
  }

  /**
   * Process the accumulated dirty + removed sets in ONE pass. Single-flight: if a pass is
   * already running, mark queued and re-run once it settles (a burst mid-pass is absorbed).
   * Public for the test/manual flush.
   */
  async runWork(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) {
      this.queued = true;
      return;
    }
    const dirty = [...this.dirty];
    const removed = [...this.removed];
    this.dirty.clear();
    this.removed.clear();
    if (dirty.length === 0 && removed.length === 0) return;

    this.inFlight = (async () => {
      try {
        await this.applyPass(dirty, removed);
      } catch (err) {
        // Keep the work and let the next pass (or reconcile) retry; never throw to the caller.
        console.error("[SemanticRunner] work pass failed:", err);
        for (const p of dirty) this.dirty.add(p);
        for (const p of removed) this.removed.add(p);
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }

    if (this.queued && !this.stopped) {
      this.queued = false;
      this.scheduleWork();
    }
  }

  /**
   * Embed + extract the changed items and clean up the removed ones. Kept off the flag-off
   * path (the whole runner is); honors SEMANTIC_DISABLED by abstaining (no client calls).
   */
  private async applyPass(dirty: string[], removed: string[]): Promise<void> {
    const db = getSemanticDb();
    const disabled = isSemanticDisabled();

    // Removals first: drop the item (FK cascade clears chunks/item_entities/item_topics),
    // then GC dangling entities + recompute mention counts (mirrors the GraphRunner's
    // dangling-edge cleanup). vec0 rows degrade gracefully (vec is off by default).
    let cleanedAny = false;
    for (const absPath of removed) {
      const itemId = this.itemIdFor(absPath);
      if (!itemId) continue;
      db.transaction(() => {
        deleteItemTopicsForItem(itemId, db);
        deleteMentionsForItem(itemId, db);
        deleteChunksForItem(itemId, db);
        deleteItem(itemId, db);
      })();
      cleanedAny = true;
    }

    // Changes: (re)chunk + embed + extract + resolve + nearest-topic assign, per item.
    const touchedItemIds: string[] = [];
    for (const absPath of dirty) {
      const item = this.itemChunksFor(absPath);
      if (!item) {
        // Lost its text since enqueue — treat as a removal.
        const itemId = this.itemIdFor(absPath);
        if (itemId) {
          db.transaction(() => {
            deleteItemTopicsForItem(itemId, db);
            deleteMentionsForItem(itemId, db);
            deleteChunksForItem(itemId, db);
            deleteItem(itemId, db);
          })();
          cleanedAny = true;
        }
        this.hashes.delete(absPath);
        continue;
      }
      // Skip if unchanged AND already embedded at this hash (a reconcile re-scan after the
      // event path already applied it). buildItemChunks is content-only, so compare hashes.
      const existing = getItem(item.itemId, db);
      if (existing && existing.content_hash === item.contentHash) {
        this.hashes.set(absPath, item.contentHash);
        continue;
      }

      // Embed OUTSIDE the write transaction (network is async) — exactly ONE embed call
      // per changed item (the plan's "new note → exactly 1 embed call" guarantee).
      let vecs: Float32Array[] = [];
      if (!disabled && item.chunks.length > 0) {
        vecs = await this.client.embed(item.chunks.map((c) => c.text));
      }

      db.transaction(() => {
        upsertItem(
          {
            itemId: item.itemId,
            scope: item.scope,
            kind: item.kind,
            sourcePath: item.sourcePath,
            sourceFile: item.sourceFile,
            title: item.title,
            url: item.url,
            contentHash: item.contentHash,
            chunkCount: item.chunks.length,
          },
          db,
        );
        deleteChunksForItem(item.itemId, db);
        item.chunks.forEach((c, i) =>
          upsertChunk(
            { id: c.id, itemId: item.itemId, ordinal: c.ordinal, text: c.text, embedding: vecs[i], embeddingModel: SEMANTIC_EMBEDDING_MODEL },
            db,
          ),
        );
      })();

      // Per-item entity extraction (idempotent on content hash + version; abstains offline).
      // Candidates are embedded but NOT extracted — transient un-vetted discovery content
      // would mint junk entities that outlive the candidate (mirrors the backfill's skip).
      if (item.kind !== "candidate") {
        await extractEntities({ itemId: item.itemId, contentHash: item.contentHash, text: itemText(item) }, { client: this.client, db });
      }

      // Slot into the nearest EXISTING leaf topics by cosine to cached centroids — NO
      // re-cluster (the heavy global re-fit owns topic creation). An item that clears no
      // centroid's floor is an outlier and waits for the next re-fit (assign.ts §C.4).
      this.assignNearestTopics(item.itemId, db);

      this.hashes.set(absPath, item.contentHash);
      touchedItemIds.push(item.itemId);
    }

    // One global resolve pass folds the changed items' new mentions into the existing
    // canonical set (incremental resolution warm-starts from the live entities table).
    if (!disabled && touchedItemIds.length > 0) {
      const { binder, close } = createReconcileBinder();
      try {
        await resolveAll({ client: this.client, judge: this.judge, db, reconcile: binder });
      } finally {
        close();
      }
    }

    if (cleanedAny) {
      recomputeEntityMentionCounts(db);
      deleteDanglingEntities(db);
    }
  }

  /** Assign one item to the nearest existing leaf topics (incremental, no re-cluster). */
  private assignNearestTopics(itemId: string, db: ReturnType<typeof getSemanticDb>): void {
    const centroids = getLeafTopicCentroids(db);
    if (centroids.length === 0) {
      // No taxonomy yet (pre first re-fit) — clear any stale membership and defer to re-fit.
      deleteItemTopicsForItem(itemId, db);
      return;
    }
    const chunkVecs = getChunkVectorsForItem(itemId, db);
    if (chunkVecs.length === 0) {
      deleteItemTopicsForItem(itemId, db);
      return;
    }
    const result = assignItemChunks(chunkVecs, centroids, { floor: semanticAssignCos() });
    db.transaction(() => {
      deleteItemTopicsForItem(itemId, db);
      for (const hit of result.topics) upsertItemTopic(itemId, hit.topicId, hit.score, "incremental", db);
    })();
  }

  // -------------------------------------------------------------------------
  // Path helpers
  // -------------------------------------------------------------------------

  /** True if `absPath` is a `.md` file under one of the included dirs (libraries/ excluded). */
  private isIncludedFile(absPath: string): boolean {
    if (!absPath.endsWith(".md")) return false;
    const rel = path.relative(this.root, absPath).split(path.sep).join("/");
    if (rel.startsWith("..")) return false;
    // Any dotdir segment (.cache, .git, …) is excluded — derived/non-source.
    if (rel.split("/").some((seg) => seg.startsWith(".") && seg.length > 1)) return false;
    return INCLUDED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  }

  /** True if `absPath` lives under one of the given included dirs. */
  private pathInDirs(absPath: string, dirSet: Set<string>): boolean {
    const rel = path.relative(this.root, absPath).split(path.sep).join("/");
    if (rel.startsWith("..")) return false;
    for (const dir of dirSet) {
      if (rel === dir || rel.startsWith(`${dir}/`)) return true;
    }
    return false;
  }

  /** True if `absPath` is a file inside the candidate cache (`references/.cache/library-candidates`). */
  private isCandidatePath(absPath: string): boolean {
    const rel = path.relative(this.root, absPath).split(path.sep).join("/");
    const cacheRel = CANDIDATE_CACHE_DIR.split(path.sep).join("/");
    return !rel.startsWith("..") && rel.startsWith(`${cacheRel}/`);
  }

  /** Event-path scope: vault included files PLUS the candidate cache (the one dotdir we ingest). */
  private isInScope(absPath: string): boolean {
    return this.isIncludedFile(absPath) || (absPath.endsWith(".md") && this.isCandidatePath(absPath));
  }

  /** Reconstruct the included top-level dir for an abs path → a ScannedFile for buildItemChunks. */
  private scannedFileFor(absPath: string): ScannedFile | null {
    if (!this.isIncludedFile(absPath)) return null;
    const rel = path.relative(this.root, absPath).split(path.sep).join("/");
    const dir = INCLUDED_DIRS.find((d) => rel === d || rel.startsWith(`${d}/`));
    if (!dir) return null;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(absPath).mtimeMs;
    } catch {
      return null;
    }
    return { absPath, dir, mtimeMs };
  }

  /**
   * Build the item + chunks for an abs path — vault files via the scanned-file route,
   * candidate-cache files via the candidate parse. Returns null when out of scope or no
   * longer embeddable (incl. a candidate whose status flipped off `candidate`).
   */
  private itemChunksFor(absPath: string): ItemChunks | null {
    if (this.isCandidatePath(absPath)) {
      let candidate: ReturnType<typeof parseCandidateFile>;
      try {
        candidate = parseCandidateFile(this.root, absPath);
      } catch {
        return null;
      }
      if (!candidate || candidate.status !== "candidate") return null;
      return candidateItemChunks(candidate, this.root);
    }
    const file = this.scannedFileFor(absPath);
    return file ? buildItemChunks(file) : null;
  }

  /** The semantic item id (= graph node id) for an abs path, or null if out of scope. */
  private itemIdFor(absPath: string): string | null {
    const item = this.itemChunksFor(absPath);
    if (item) return item.itemId;
    // File gone/empty (the removal case): fall back to the row whose source_file matches
    // (the incremental delete-by-path key — semantic_items.source_file is the abs path).
    const row = getSemanticDb().prepare("SELECT item_id FROM semantic_items WHERE source_file = ?").get(absPath) as
      | { item_id: string }
      | undefined;
    return row?.item_id ?? null;
  }
}

/** Assemble the item text sent to Flash extraction — the chunk texts rejoined (mirrors backfill). */
function itemText(item: ItemChunks): string {
  return item.chunks.map((c) => c.text).join(" ");
}

/** Map a BridgeWatcher event name to the included dir(s) to re-scan (mirrors GraphRunner). */
const BRIDGE_DIR_GROUPS: Record<string, readonly string[]> = {
  projects: ["projects"],
  people: ["people", "meetings"],
  thoughts: ["thoughts"],
  weekly: ["lists/now"],
};

// ---------------------------------------------------------------------------
// Singleton (instantiated by ws-server only when isSemanticEnabled())
// ---------------------------------------------------------------------------

let runner: SemanticRunner | null = null;

export function getSemanticRunner(opts: SemanticRunnerOptions = {}): SemanticRunner {
  if (!runner) {
    runner = new SemanticRunner(opts);
  }
  return runner;
}

/** Test-only: reset the singleton so a fresh runner can be constructed. */
export function resetSemanticRunnerForTests(): void {
  if (runner) runner.stop();
  runner = null;
}
