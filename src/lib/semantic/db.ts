/**
 * semantic.sqlite — the Phase 2 semantic knowledge layer's derived cache.
 *
 * Third derived-cache db alongside graph.sqlite (src/lib/graph/db.ts) and
 * calendar.sqlite. Same conventions: better-sqlite3, WAL + synchronous=NORMAL,
 * a process singleton keyed on the resolved path, `IF NOT EXISTS` schema, lives
 * under DATA_DIR. Pure derived cache (Critical Constraint #2): never writes the
 * vault; `rm semantic.sqlite*` + rebuild reproduces it.
 *
 * Reconciliation rulings honored (docs/plans/semantic-layer-phase2-spec.md):
 *  - R1: the item key `item_id` IS the graph node id (note:/ref:/person:/project:);
 *    table is `semantic_items` and carries `source_file` (abs path) as the
 *    incremental delete-by-path key.
 *  - R4: PRAGMA foreign_keys = ON (cascade-on-item-delete). Note: vec0 virtual
 *    tables are NOT reached by FK cascade — explicit deletes stay mandatory.
 *  - R5: the `embedding_blob` columns are CANONICAL; the sqlite-vec `vec0` tables
 *    are a derived KNN accelerator created only when the extension loads. Vector
 *    search degrades to an in-process cosine scan (src/lib/semantic/vector.ts).
 *
 * NOTE: sqlite-vec wiring is intentionally deferred (HIGH risk #1 — verify
 * `loadExtension` in the packaged Electron build first). We ship vec-OFF/BLOB-first;
 * `isSemanticVecAvailable()` stays false until that task flips it on. Correctness
 * never depends on the extension.
 */

import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { getSemanticDbPath, isSemanticVecDisabled, semanticDim } from "./config";
import { SEMANTIC_DB_FORMAT_VERSION, SEMANTIC_VERSION } from "./pipeline";
import { blobToFloat32 } from "./vector";

let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;
let vecAvailable = false;

/** True when the sqlite-vec KNN accelerator is loaded; false ⇒ BLOB cosine fallback. */
export function isSemanticVecAvailable(): boolean {
  return vecAvailable;
}

export function getSemanticDb(): Database.Database {
  const dbPath = getSemanticDbPath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  vecAvailable = tryLoadVec(cachedDb);
  invalidateOnFormatBump(cachedDb);
  ensureSemanticSchema(cachedDb);
  return cachedDb;
}

/**
 * Drop every derived table when the on-disk SEMANTIC_DB_FORMAT_VERSION lags this build's
 * (the LAYOUT_VERSION precedent — a schema/wire change invalidates the cache file
 * independently of a SEMANTIC_VERSION model upgrade). The db is a pure derived cache, so
 * discarding it is always safe; the cold start rebuilds it from the vault. Runs before
 * `ensureSemanticSchema` so the IF-NOT-EXISTS recreate lands a clean current-format schema.
 *
 * On a fresh/empty file `semantic_meta` doesn't exist yet → nothing to invalidate; we
 * stamp the format version after the schema is (re)created in `ensureSemanticSchema`.
 */
function invalidateOnFormatBump(db: Database.Database): void {
  const metaExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'semantic_meta'")
    .get();
  if (!metaExists) return; // fresh file — ensureSemanticSchema stamps the format version
  const row = db.prepare("SELECT value FROM semantic_meta WHERE key = 'db_format_version'").get() as
    | { value: string }
    | undefined;
  const stamped = row ? Number(row.value) : 0;
  if (stamped === SEMANTIC_DB_FORMAT_VERSION) return; // current — keep the cache
  // Stale (or unstamped legacy) format → discard all derived tables. Order respects FKs
  // (children first); vec0 virtual tables are dropped explicitly (FK cascade can't reach them).
  db.exec(`
    DROP TABLE IF EXISTS chunk_vectors;
    DROP TABLE IF EXISTS entity_vectors;
    DROP TABLE IF EXISTS topic_vectors;
    DROP TABLE IF EXISTS topic_lineage;
    DROP TABLE IF EXISTS item_topics;
    DROP TABLE IF EXISTS item_entities;
    DROP TABLE IF EXISTS entity_aliases;
    DROP TABLE IF EXISTS entity_merges;
    DROP TABLE IF EXISTS item_entity_mentions;
    DROP TABLE IF EXISTS topics;
    DROP TABLE IF EXISTS entities;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS semantic_items;
    DROP TABLE IF EXISTS semantic_meta;
  `);
}

/** Reset BOTH cached db and path (the calendar/graph rebind gotcha) so tests rebind. */
export function closeSemanticDbForTests(): void {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
  vecAvailable = false;
}

/**
 * Attempt to load the sqlite-vec accelerator. Deliberately conservative: returns false
 * (BLOB fallback) unless the extension is present AND loads AND is verified live. The
 * package is optional — its absence must never throw. Dedicated vec task flips this on
 * after verifying the packaged-Electron dlopen path (risk #1).
 */
function tryLoadVec(db: Database.Database): boolean {
  if (isSemanticVecDisabled()) return false;
  try {
    // Optional native accelerator — resolve at call time so a missing package or a
    // bundler that can't see it simply yields the BLOB fallback.
    const req: NodeRequire | undefined = typeof require === "function" ? require : undefined;
    if (!req) return false;
    const sqliteVec = req("sqlite-vec") as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false; // monitor-first: degrade, never crash
  }
}

export function ensureSemanticSchema(db = getSemanticDb()): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON"); // ruling R4 — cascade on item delete
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- One row per source unit. item_id IS the graph node id (R1). source_file is the
    -- abs path on disk (incremental delete-by-path key); source_path is the canonical
    -- reference (abs path for vault, references/<file> for saved refs).
    CREATE TABLE IF NOT EXISTS semantic_items (
      item_id          TEXT PRIMARY KEY,
      scope            TEXT NOT NULL,            -- 'vault' | 'library'
      kind             TEXT NOT NULL,            -- 'note' | 'meeting' | 'project' | 'reference' | 'person' | ...
      source_path      TEXT NOT NULL,
      source_file      TEXT NOT NULL,            -- abs path (delete key)
      title            TEXT,
      url              TEXT,                     -- library refs only
      content_hash     TEXT NOT NULL,            -- sha256 of normalized source text (skip-unchanged key)
      chunk_count      INTEGER NOT NULL DEFAULT 0,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_items_scope   ON semantic_items(scope);
    CREATE INDEX IF NOT EXISTS idx_semantic_items_kind    ON semantic_items(kind);
    CREATE INDEX IF NOT EXISTS idx_semantic_items_srcfile ON semantic_items(source_file);
    CREATE INDEX IF NOT EXISTS idx_semantic_items_version ON semantic_items(semantic_version);

    -- Embedding unit. embedding_blob is the CANONICAL vector (LE float32); the vec0
    -- table is a derived KNN index over it (R5).
    CREATE TABLE IF NOT EXISTS chunks (
      id               TEXT PRIMARY KEY,         -- item_id + ':' + ordinal
      item_id          TEXT NOT NULL,
      ordinal          INTEGER NOT NULL DEFAULT 0,
      text             TEXT NOT NULL,
      token_count      INTEGER,
      embedding_blob   BLOB,                     -- dim x float32 LE; NULL until embedded
      embedding_model  TEXT,
      dim              INTEGER,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES semantic_items(item_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_item    ON chunks(item_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_version ON chunks(semantic_version);
    CREATE INDEX IF NOT EXISTS idx_chunks_unembed ON chunks(embedding_model) WHERE embedding_blob IS NULL;

    -- Resolved, canonical typed things (Layer B). Surface forms live in entity_aliases.
    CREATE TABLE IF NOT EXISTS entities (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL,            -- 'person' | 'project' | 'idea' | 'source'
      canonical_name   TEXT NOT NULL,
      summary          TEXT,
      ref_path         TEXT,                     -- resolved vault page if one exists
      graph_node_id    TEXT,                     -- bound graph node (person:/project:) or NULL
      mention_count    INTEGER NOT NULL DEFAULT 0,
      embedding_blob   BLOB,
      embedding_model  TEXT,
      dim              INTEGER,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_type    ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_name    ON entities(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_entities_ref     ON entities(ref_path);
    CREATE INDEX IF NOT EXISTS idx_entities_node    ON entities(graph_node_id);
    CREATE INDEX IF NOT EXISTS idx_entities_version ON entities(semantic_version);

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id        TEXT NOT NULL,
      alias            TEXT NOT NULL,
      alias_norm       TEXT NOT NULL,            -- lowercased/trimmed
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (entity_id, alias_norm),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_norm ON entity_aliases(alias_norm);

    -- Raw per-item extractions (Layer B audit/rebuild source; cheap to re-derive). The
    -- idempotency key is (item_id, item_content_hash, semantic_version): an unchanged
    -- item at the same version re-extracts to 0 client calls. entity_id is NULL until
    -- a resolution pass binds the mention to a canonical entity.
    CREATE TABLE IF NOT EXISTS item_entity_mentions (
      id                TEXT PRIMARY KEY,         -- hashId(item_id|raw_type|norm_name|semantic_version)
      item_id           TEXT NOT NULL,
      raw_type          TEXT NOT NULL,            -- person|project|idea|source
      raw_name          TEXT NOT NULL,
      norm_name         TEXT NOT NULL,            -- slugified raw_name for blocking
      aliases_json      TEXT NOT NULL,
      salience          REAL NOT NULL DEFAULT 0,
      evidence          TEXT NOT NULL,
      entity_id         TEXT,                     -- FK to entities.id, NULL until resolved
      extract_model     TEXT NOT NULL,
      item_content_hash TEXT NOT NULL,
      semantic_version  TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES semantic_items(item_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mentions_item   ON item_entity_mentions(item_id);
    CREATE INDEX IF NOT EXISTS idx_mentions_norm   ON item_entity_mentions(raw_type, norm_name);
    CREATE INDEX IF NOT EXISTS idx_mentions_entity ON item_entity_mentions(entity_id);

    -- Merge audit (a merge is reversible/inspectable; mirrors topic_lineage intent).
    CREATE TABLE IF NOT EXISTS entity_merges (
      loser_id         TEXT NOT NULL,
      winner_id        TEXT NOT NULL,
      reason           TEXT,
      semantic_version TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      PRIMARY KEY (loser_id, winner_id)
    );

    -- Emergent, hierarchical, evolving topics (Layer C).
    CREATE TABLE IF NOT EXISTS topics (
      id               TEXT PRIMARY KEY,
      parent_id        TEXT,                     -- NULL at the root level
      level            INTEGER NOT NULL DEFAULT 0,
      label            TEXT NOT NULL,
      summary          TEXT,
      item_count       INTEGER NOT NULL DEFAULT 0,
      centroid_blob    BLOB,
      embedding_model  TEXT,
      dim              INTEGER,
      trend_score      REAL,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES topics(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topics_parent  ON topics(parent_id);
    CREATE INDEX IF NOT EXISTS idx_topics_level   ON topics(level);
    CREATE INDEX IF NOT EXISTS idx_topics_trend   ON topics(trend_score DESC);
    CREATE INDEX IF NOT EXISTS idx_topics_version ON topics(semantic_version);

    CREATE TABLE IF NOT EXISTS item_entities (
      item_id          TEXT NOT NULL,
      entity_id        TEXT NOT NULL,
      salience         REAL NOT NULL DEFAULT 0,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (item_id, entity_id),
      FOREIGN KEY (item_id)   REFERENCES semantic_items(item_id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id)            ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_entities_entity ON item_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_item_entities_sal    ON item_entities(entity_id, salience DESC);

    CREATE TABLE IF NOT EXISTS item_topics (
      item_id          TEXT NOT NULL,
      topic_id         TEXT NOT NULL,
      score            REAL NOT NULL DEFAULT 0,
      assigned_by      TEXT NOT NULL,            -- 'refit' | 'incremental'
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (item_id, topic_id),
      FOREIGN KEY (item_id)  REFERENCES semantic_items(item_id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id)              ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_topics_topic ON item_topics(topic_id);
    CREATE INDEX IF NOT EXISTS idx_item_topics_score ON item_topics(topic_id, score DESC);

    CREATE TABLE IF NOT EXISTS topic_lineage (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      old_topic_id     TEXT,                     -- NULL for op='create'
      new_topic_id     TEXT,                     -- NULL for op='delete'
      op               TEXT NOT NULL,            -- 'create'|'merge'|'split'|'rename'|'carry'|'delete'
      score            REAL,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topic_lineage_old ON topic_lineage(old_topic_id);
    CREATE INDEX IF NOT EXISTS idx_topic_lineage_new ON topic_lineage(new_topic_id);
    CREATE INDEX IF NOT EXISTS idx_topic_lineage_ver ON topic_lineage(semantic_version);
  `);

  if (vecAvailable) {
    // Derived KNN accelerator over the canonical embedding_blob columns. Created only
    // when the extension loaded; rebuildable from BLOBs alone (reindexVectors, later).
    const dim = semanticDim();
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        chunk_id TEXT PRIMARY KEY, embedding FLOAT[${dim}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entity_vectors USING vec0(
        entity_id TEXT PRIMARY KEY, embedding FLOAT[${dim}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS topic_vectors USING vec0(
        topic_id TEXT PRIMARY KEY, embedding FLOAT[${dim}]
      );
    `);
  }

  // Stamp the cache-file format version so a future bump (invalidateOnFormatBump) can
  // detect a stale layout and discard the file. Idempotent — overwrites the same value.
  db.prepare(
    "INSERT INTO semantic_meta (key, value) VALUES ('db_format_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(SEMANTIC_DB_FORMAT_VERSION));
}

// ---------------------------------------------------------------------------
// meta k/v
// ---------------------------------------------------------------------------

export function setMeta(key: string, value: string, db = getSemanticDb()): void {
  db.prepare(`INSERT INTO semantic_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function getMeta(key: string, db = getSemanticDb()): string | null {
  const row = db.prepare("SELECT value FROM semantic_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// Active-version meta (P2.4) — the "of record" version queries default to.
// ---------------------------------------------------------------------------
//
// A SEMANTIC_VERSION bump writes new-version rows ALONGSIDE the prior-version rows
// (a backfill, not a migration). `active_version` is the published baseline; the
// review lane shows the new (decimal) version's diff before it is blessed. Blessing
// = flipping `active_version` to the new string + recording the component versions,
// after which `semantic:gc` drops every row whose version != active_version.

/** Component versions stamped at the active baseline (the upgrade blast-radius record). */
export interface ActiveComponents {
  embedding?: string;
  extraction?: string;
  taxonomy?: string;
}

/** The version queries default to. Falls back to the headline SEMANTIC_VERSION when unset. */
export function getActiveVersion(db = getSemanticDb()): string {
  return getMeta("active_version", db) ?? SEMANTIC_VERSION;
}

/**
 * Bless a version as the active baseline (flip `active_version` + record the component
 * versions + a `blessed_at` timestamp). After this, `getActiveVersion()` returns it and a
 * `semantic:gc` sweep can drop the now-superseded rows. Idempotent; one transaction.
 */
export function setActiveVersion(version: string, components: ActiveComponents = {}, db = getSemanticDb()): void {
  db.transaction(() => {
    setMeta("active_version", version, db);
    if (components.embedding) setMeta("active_embedding", components.embedding, db);
    if (components.extraction) setMeta("active_extraction", components.extraction, db);
    if (components.taxonomy) setMeta("active_taxonomy", components.taxonomy, db);
    setMeta("blessed_at", new Date().toISOString(), db);
  })();
}

/** Every distinct `semantic_version` present across the derived tables (coexistence probe). */
export function listDerivedVersions(db = getSemanticDb()): string[] {
  const rows = db
    .prepare(
      `SELECT semantic_version AS v FROM semantic_items
       UNION SELECT semantic_version FROM chunks
       UNION SELECT semantic_version FROM entities
       UNION SELECT semantic_version FROM item_entity_mentions
       UNION SELECT semantic_version FROM topics
       UNION SELECT semantic_version FROM item_topics
       UNION SELECT semantic_version FROM topic_lineage
       ORDER BY v`,
    )
    .all() as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

/** Row counts at a given version across the derived tables (gc/coexistence inspection). */
export function countRowsAtVersion(version: string, db = getSemanticDb()): number {
  const one = (sql: string): number => Number((db.prepare(sql).get(version) as { c: number }).c);
  return (
    one("SELECT COUNT(*) AS c FROM semantic_items WHERE semantic_version = ?") +
    one("SELECT COUNT(*) AS c FROM chunks WHERE semantic_version = ?") +
    one("SELECT COUNT(*) AS c FROM entities WHERE semantic_version = ?") +
    one("SELECT COUNT(*) AS c FROM item_entity_mentions WHERE semantic_version = ?") +
    one("SELECT COUNT(*) AS c FROM topics WHERE semantic_version = ?") +
    one("SELECT COUNT(*) AS c FROM item_topics WHERE semantic_version = ?") +
    one("SELECT COUNT(*) AS c FROM topic_lineage WHERE semantic_version = ?")
  );
}

/**
 * GC sweep (the `semantic:gc` job, analog of `library:candidates:cleanup`): drop every
 * derived row whose `semantic_version` != the active baseline. Run AFTER a blessing flip,
 * never before — the coexistence window is what lets a decimal test lane be reviewed
 * against the live integer baseline. Returns the active version + the row count removed.
 *
 * Deletes children before parents and clears the matching vec0 rows explicitly (virtual
 * tables aren't reached by FK cascade — the same discipline as the incremental delete key).
 * One transaction so a crash never leaves a half-swept file.
 */
export function gcStaleVersions(db = getSemanticDb()): { activeVersion: string; rowsRemoved: number } {
  const active = getActiveVersion(db);
  const total = (sql: string): number => Number((db.prepare(sql).get() as { c: number }).c);
  const staleSql = (table: string): string => `SELECT COUNT(*) AS c FROM ${table} WHERE semantic_version != '${active.replace(/'/g, "''")}'`;
  const before =
    total(staleSql("semantic_items")) +
    total(staleSql("chunks")) +
    total(staleSql("entities")) +
    total(staleSql("item_entity_mentions")) +
    total(staleSql("topics")) +
    total(staleSql("item_topics")) +
    total(staleSql("topic_lineage"));

  db.transaction(() => {
    if (vecAvailable) {
      db.prepare(
        "DELETE FROM chunk_vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE semantic_version != ?)",
      ).run(active);
      db.prepare(
        "DELETE FROM entity_vectors WHERE entity_id IN (SELECT id FROM entities WHERE semantic_version != ?)",
      ).run(active);
      db.prepare(
        "DELETE FROM topic_vectors WHERE topic_id IN (SELECT id FROM topics WHERE semantic_version != ?)",
      ).run(active);
    }
    // Children first (defensive even with FK cascade — versions can cross item boundaries).
    db.prepare("DELETE FROM topic_lineage WHERE semantic_version != ?").run(active);
    db.prepare("DELETE FROM item_topics WHERE semantic_version != ?").run(active);
    db.prepare("DELETE FROM item_entity_mentions WHERE semantic_version != ?").run(active);
    db.prepare("DELETE FROM topics WHERE semantic_version != ?").run(active);
    db.prepare("DELETE FROM entities WHERE semantic_version != ?").run(active);
    db.prepare("DELETE FROM chunks WHERE semantic_version != ?").run(active);
    db.prepare("DELETE FROM semantic_items WHERE semantic_version != ?").run(active);
    setMeta("gc_at", new Date().toISOString(), db);
  })();

  return { activeVersion: active, rowsRemoved: before };
}

// ---------------------------------------------------------------------------
// items + chunks (foundation upserts; later phases add entities/topics writers)
// ---------------------------------------------------------------------------

export interface SemanticItem {
  itemId: string;
  scope: "vault" | "library";
  kind: string;
  sourcePath: string;
  sourceFile: string;
  title?: string | null;
  url?: string | null;
  contentHash: string;
  chunkCount?: number;
}

export function upsertItem(item: SemanticItem, db = getSemanticDb()): void {
  db.prepare(`
    INSERT INTO semantic_items (item_id, scope, kind, source_path, source_file, title, url, content_hash, chunk_count, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      scope = excluded.scope, kind = excluded.kind, source_path = excluded.source_path,
      source_file = excluded.source_file, title = excluded.title, url = excluded.url,
      content_hash = excluded.content_hash, chunk_count = excluded.chunk_count,
      semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(
    item.itemId, item.scope, item.kind, item.sourcePath, item.sourceFile,
    item.title ?? null, item.url ?? null, item.contentHash, item.chunkCount ?? 0,
    SEMANTIC_VERSION, new Date().toISOString(),
  );
}

export interface SemanticItemRow {
  item_id: string;
  scope: string;
  kind: string;
  source_path: string;
  source_file: string;
  title: string | null;
  url: string | null;
  content_hash: string;
  chunk_count: number;
  semantic_version: string;
  updated_at: string;
}

export function getItem(itemId: string, db = getSemanticDb()): SemanticItemRow | null {
  return (db.prepare("SELECT * FROM semantic_items WHERE item_id = ?").get(itemId) as SemanticItemRow | undefined) ?? null;
}

/** All item rows (item_id + source_file + version) — the sample-lane review-queue source. */
export function listItemRows(db = getSemanticDb()): Array<Pick<SemanticItemRow, "item_id" | "source_file" | "semantic_version">> {
  return db
    .prepare("SELECT item_id, source_file, semantic_version FROM semantic_items ORDER BY item_id")
    .all() as Array<Pick<SemanticItemRow, "item_id" | "source_file" | "semantic_version">>;
}

/** Delete an item; FK cascade removes its chunks/item_entities/item_topics rows. */
export function deleteItem(itemId: string, db = getSemanticDb()): void {
  db.prepare("DELETE FROM semantic_items WHERE item_id = ?").run(itemId);
}

export interface SemanticChunk {
  id: string;
  itemId: string;
  ordinal: number;
  text: string;
  tokenCount?: number | null;
  embedding?: Float32Array | null;
  embeddingModel?: string | null;
}

export function upsertChunk(chunk: SemanticChunk, db = getSemanticDb()): void {
  const blob = chunk.embedding ? Buffer.from(chunk.embedding.buffer, chunk.embedding.byteOffset, chunk.embedding.byteLength) : null;
  db.prepare(`
    INSERT INTO chunks (id, item_id, ordinal, text, token_count, embedding_blob, embedding_model, dim, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_id = excluded.item_id, ordinal = excluded.ordinal, text = excluded.text,
      token_count = excluded.token_count, embedding_blob = excluded.embedding_blob,
      embedding_model = excluded.embedding_model, dim = excluded.dim,
      semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(
    chunk.id, chunk.itemId, chunk.ordinal, chunk.text, chunk.tokenCount ?? null,
    blob, chunk.embeddingModel ?? null, chunk.embedding ? chunk.embedding.length : null,
    SEMANTIC_VERSION, new Date().toISOString(),
  );
}

export function countChunks(itemId: string, db = getSemanticDb()): number {
  return Number((db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE item_id = ?").get(itemId) as { c: number }).c);
}

export function countEmbeddedChunks(itemId: string, db = getSemanticDb()): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE item_id = ? AND embedding_blob IS NOT NULL").get(itemId) as { c: number }).c,
  );
}

/** Drop an item's chunks (re-chunk on content change). vec0 cleanup is handled separately. */
export function deleteChunksForItem(itemId: string, db = getSemanticDb()): void {
  db.prepare("DELETE FROM chunks WHERE item_id = ?").run(itemId);
}

/** An item's embedded chunk vectors (decoded from the canonical BLOBs), ordinal order. */
export function getChunkVectorsForItem(itemId: string, db = getSemanticDb()): Float32Array[] {
  const rows = db
    .prepare("SELECT embedding_blob FROM chunks WHERE item_id = ? AND embedding_blob IS NOT NULL ORDER BY ordinal")
    .all(itemId) as Array<{ embedding_blob: Buffer }>;
  return rows.map((r) => blobToFloat32(r.embedding_blob));
}

// ---------------------------------------------------------------------------
// Layer B — entity mentions (raw per-item extractions) + canonical entities
// ---------------------------------------------------------------------------

export interface MentionRow {
  id: string;
  item_id: string;
  raw_type: string;
  raw_name: string;
  norm_name: string;
  aliases_json: string;
  salience: number;
  evidence: string;
  entity_id: string | null;
  extract_model: string;
  item_content_hash: string;
  semantic_version: string;
  updated_at: string;
}

export interface MentionInput {
  id: string;
  itemId: string;
  rawType: string;
  rawName: string;
  normName: string;
  aliases: string[];
  salience: number;
  evidence: string;
  extractModel: string;
  itemContentHash: string;
}

export function upsertMention(m: MentionInput, db = getSemanticDb()): void {
  db.prepare(`
    INSERT INTO item_entity_mentions
      (id, item_id, raw_type, raw_name, norm_name, aliases_json, salience, evidence, entity_id, extract_model, item_content_hash, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_id = excluded.item_id, raw_type = excluded.raw_type, raw_name = excluded.raw_name,
      norm_name = excluded.norm_name, aliases_json = excluded.aliases_json, salience = excluded.salience,
      evidence = excluded.evidence, extract_model = excluded.extract_model,
      item_content_hash = excluded.item_content_hash, semantic_version = excluded.semantic_version,
      updated_at = excluded.updated_at
  `).run(
    m.id, m.itemId, m.rawType, m.rawName, m.normName, JSON.stringify(m.aliases),
    m.salience, m.evidence, m.extractModel, m.itemContentHash, SEMANTIC_VERSION, new Date().toISOString(),
  );
}

/** All mentions for an item (across types). */
export function getMentionsForItem(itemId: string, db = getSemanticDb()): MentionRow[] {
  return db.prepare("SELECT * FROM item_entity_mentions WHERE item_id = ? ORDER BY id").all(itemId) as MentionRow[];
}

/** All mentions in the corpus (cold-start global resolution input). */
export function getAllMentions(db = getSemanticDb()): MentionRow[] {
  return db.prepare("SELECT * FROM item_entity_mentions ORDER BY id").all() as MentionRow[];
}

/** True when this item already has mentions at the given (content_hash, version) — idempotency probe. */
export function hasMentions(itemId: string, contentHash: string, db = getSemanticDb()): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS c FROM item_entity_mentions WHERE item_id = ? AND item_content_hash = ? AND semantic_version = ? LIMIT 1",
    )
    .get(itemId, contentHash, SEMANTIC_VERSION) as { c: number } | undefined;
  return row !== undefined;
}

/** Drop an item's mentions (re-extract on content/version change). */
export function deleteMentionsForItem(itemId: string, db = getSemanticDb()): void {
  db.prepare("DELETE FROM item_entity_mentions WHERE item_id = ?").run(itemId);
}

/** Point a set of mentions at their resolved canonical entity. */
export function bindMentionsToEntity(mentionIds: string[], entityId: string, db = getSemanticDb()): void {
  const stmt = db.prepare("UPDATE item_entity_mentions SET entity_id = ?, updated_at = ? WHERE id = ?");
  const now = new Date().toISOString();
  for (const id of mentionIds) stmt.run(entityId, now, id);
}

export interface EntityRow {
  id: string;
  type: string;
  canonical_name: string;
  summary: string | null;
  ref_path: string | null;
  graph_node_id: string | null;
  mention_count: number;
  semantic_version: string;
  updated_at: string;
}

export interface EntityInput {
  id: string;
  type: string;
  canonicalName: string;
  summary?: string | null;
  refPath?: string | null;
  graphNodeId?: string | null;
  mentionCount?: number;
  embedding?: Float32Array | null;
  embeddingModel?: string | null;
}

export function upsertEntity(e: EntityInput, db = getSemanticDb()): void {
  const blob = e.embedding ? Buffer.from(e.embedding.buffer, e.embedding.byteOffset, e.embedding.byteLength) : null;
  db.prepare(`
    INSERT INTO entities
      (id, type, canonical_name, summary, ref_path, graph_node_id, mention_count, embedding_blob, embedding_model, dim, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, canonical_name = excluded.canonical_name, summary = excluded.summary,
      ref_path = excluded.ref_path, graph_node_id = excluded.graph_node_id,
      mention_count = excluded.mention_count, embedding_blob = excluded.embedding_blob,
      embedding_model = excluded.embedding_model, dim = excluded.dim,
      semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(
    e.id, e.type, e.canonicalName, e.summary ?? null, e.refPath ?? null, e.graphNodeId ?? null,
    e.mentionCount ?? 0, blob, e.embeddingModel ?? null, e.embedding ? e.embedding.length : null,
    SEMANTIC_VERSION, new Date().toISOString(),
  );
}

export function getEntity(id: string, db = getSemanticDb()): EntityRow | null {
  return (db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as EntityRow | undefined) ?? null;
}

/** Look up an existing canonical entity of a type by its exact normalized name or any alias. */
export function findEntityByNorm(type: string, norm: string, db = getSemanticDb()): EntityRow | null {
  const viaName = db
    .prepare("SELECT * FROM entities WHERE type = ? AND LOWER(canonical_name) = ?")
    .get(type, norm) as EntityRow | undefined;
  if (viaName) return viaName;
  const viaAlias = db
    .prepare(
      `SELECT e.* FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
       WHERE a.alias_norm = ? AND e.type = ? LIMIT 1`,
    )
    .get(norm, type) as EntityRow | undefined;
  return viaAlias ?? null;
}

/** All canonical entities of a type (resolution blocking corpus). */
export function getEntitiesByType(type: string, db = getSemanticDb()): EntityRow[] {
  return db.prepare("SELECT * FROM entities WHERE type = ? ORDER BY id").all(type) as EntityRow[];
}

export function addAlias(entityId: string, alias: string, db = getSemanticDb()): void {
  const aliasNorm = alias.trim().toLowerCase();
  if (!aliasNorm) return;
  db.prepare(`
    INSERT INTO entity_aliases (entity_id, alias, alias_norm, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entity_id, alias_norm) DO UPDATE SET
      alias = excluded.alias, semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(entityId, alias.trim(), aliasNorm, SEMANTIC_VERSION, new Date().toISOString());
}

export function upsertItemEntity(itemId: string, entityId: string, salience: number, db = getSemanticDb()): void {
  db.prepare(`
    INSERT INTO item_entities (item_id, entity_id, salience, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_id, entity_id) DO UPDATE SET
      salience = MAX(item_entities.salience, excluded.salience),
      semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(itemId, entityId, salience, SEMANTIC_VERSION, new Date().toISOString());
}

export function recordEntityMerge(loserId: string, winnerId: string, reason: string, db = getSemanticDb()): void {
  db.prepare(`
    INSERT INTO entity_merges (loser_id, winner_id, reason, semantic_version, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(loser_id, winner_id) DO UPDATE SET reason = excluded.reason
  `).run(loserId, winnerId, reason, SEMANTIC_VERSION, new Date().toISOString());
}

/** Recompute every entity's mention_count from item_entities (mirrors recomputeDegrees). */
export function recomputeEntityMentionCounts(db = getSemanticDb()): void {
  db.prepare(
    `UPDATE entities SET mention_count =
       (SELECT COUNT(*) FROM item_entities ie WHERE ie.entity_id = entities.id), updated_at = ?`,
  ).run(new Date().toISOString());
}

/** GC entities with no remaining item_entities edges (mirrors deleteDanglingEdges). */
export function deleteDanglingEntities(db = getSemanticDb()): void {
  db.prepare("DELETE FROM entities WHERE id NOT IN (SELECT entity_id FROM item_entities)").run();
}

// ---------------------------------------------------------------------------
// Layer C — topics, item_topics, topic_lineage (P2.2)
// ---------------------------------------------------------------------------

export interface TopicRow {
  id: string;
  parent_id: string | null;
  level: number;
  label: string;
  summary: string | null;
  item_count: number;
  trend_score: number | null;
  semantic_version: string;
  updated_at: string;
}

export interface TopicInput {
  id: string;
  parentId?: string | null;
  level: number;
  label: string;
  summary?: string | null;
  itemCount?: number;
  centroid?: Float32Array | null;
  embeddingModel?: string | null;
  trendScore?: number | null;
}

export function upsertTopic(t: TopicInput, db = getSemanticDb()): void {
  const blob = t.centroid ? Buffer.from(t.centroid.buffer, t.centroid.byteOffset, t.centroid.byteLength) : null;
  db.prepare(`
    INSERT INTO topics
      (id, parent_id, level, label, summary, item_count, centroid_blob, embedding_model, dim, trend_score, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id, level = excluded.level, label = excluded.label,
      summary = excluded.summary, item_count = excluded.item_count, centroid_blob = excluded.centroid_blob,
      embedding_model = excluded.embedding_model, dim = excluded.dim, trend_score = excluded.trend_score,
      semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(
    t.id, t.parentId ?? null, t.level, t.label, t.summary ?? null, t.itemCount ?? 0,
    blob, t.embeddingModel ?? null, t.centroid ? t.centroid.length : null, t.trendScore ?? null,
    SEMANTIC_VERSION, new Date().toISOString(),
  );
}

export function getTopicRow(id: string, db = getSemanticDb()): TopicRow | null {
  return (db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as TopicRow | undefined) ?? null;
}

/** Update just a topic's label/summary in place (the label-only repair path — no re-cluster). */
export function updateTopicLabel(id: string, label: string, summary: string | null, db = getSemanticDb()): void {
  db.prepare("UPDATE topics SET label = ?, summary = ?, updated_at = ? WHERE id = ?").run(
    label,
    summary,
    new Date().toISOString(),
    id,
  );
}

/** Topics with a centroid (leaf topics carry one) — the incremental-assignment corpus. */
export interface TopicCentroid {
  id: string;
  level: number;
  vec: Float32Array;
}

export function getTopicCentroids(db = getSemanticDb()): TopicCentroid[] {
  const rows = db
    .prepare("SELECT id, level, centroid_blob FROM topics WHERE centroid_blob IS NOT NULL ORDER BY id")
    .all() as Array<{ id: string; level: number; centroid_blob: Buffer }>;
  return rows.map((r) => ({ id: r.id, level: r.level, vec: blobToFloat32(r.centroid_blob) }));
}

/** Leaf topic centroids only (childless topics) — the nearest-topic targets (§C.4). */
export function getLeafTopicCentroids(db = getSemanticDb()): TopicCentroid[] {
  const rows = db
    .prepare(
      `SELECT id, level, centroid_blob FROM topics t
       WHERE centroid_blob IS NOT NULL AND NOT EXISTS (SELECT 1 FROM topics c WHERE c.parent_id = t.id)
       ORDER BY id`,
    )
    .all() as Array<{ id: string; level: number; centroid_blob: Buffer }>;
  return rows.map((r) => ({ id: r.id, level: r.level, vec: blobToFloat32(r.centroid_blob) }));
}

/** Drop every topic + membership + lineage row (a re-fit rebuilds from scratch at the current version). */
export function clearTopics(db = getSemanticDb()): void {
  db.exec("DELETE FROM topic_lineage; DELETE FROM item_topics; DELETE FROM topics;");
}

export function upsertItemTopic(
  itemId: string,
  topicId: string,
  score: number,
  assignedBy: "refit" | "incremental",
  db = getSemanticDb(),
): void {
  db.prepare(`
    INSERT INTO item_topics (item_id, topic_id, score, assigned_by, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id, topic_id) DO UPDATE SET
      score = excluded.score, assigned_by = excluded.assigned_by,
      semantic_version = excluded.semantic_version, updated_at = excluded.updated_at
  `).run(itemId, topicId, score, assignedBy, SEMANTIC_VERSION, new Date().toISOString());
}

/** Remove an item's topic memberships (incremental re-assignment clears stale rows first). */
export function deleteItemTopicsForItem(itemId: string, db = getSemanticDb()): void {
  db.prepare("DELETE FROM item_topics WHERE item_id = ?").run(itemId);
}

export interface ItemTopicRow {
  item_id: string;
  topic_id: string;
  score: number;
  assigned_by: string;
}

/** Current item→topic membership across the corpus (lineage diff input). */
export function getAllItemTopics(db = getSemanticDb()): ItemTopicRow[] {
  return db
    .prepare("SELECT item_id, topic_id, score, assigned_by FROM item_topics ORDER BY topic_id, item_id")
    .all() as ItemTopicRow[];
}

export interface LineageInput {
  oldTopicId?: string | null;
  newTopicId?: string | null;
  op: "create" | "merge" | "split" | "rename" | "carry" | "delete" | "birth" | "death";
  score?: number | null;
}

export function insertLineage(l: LineageInput, db = getSemanticDb()): void {
  db.prepare(`
    INSERT INTO topic_lineage (old_topic_id, new_topic_id, op, score, semantic_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(l.oldTopicId ?? null, l.newTopicId ?? null, l.op, l.score ?? null, SEMANTIC_VERSION, new Date().toISOString());
}

export interface LineageRow {
  id: number;
  old_topic_id: string | null;
  new_topic_id: string | null;
  op: string;
  score: number | null;
  semantic_version: string;
  updated_at: string;
}

/** Lineage rows touching a topic (either side) — powers the drill-down history. */
export function getLineageForTopic(topicId: string, db = getSemanticDb()): LineageRow[] {
  return db
    .prepare("SELECT * FROM topic_lineage WHERE old_topic_id = ? OR new_topic_id = ? ORDER BY id")
    .all(topicId, topicId) as LineageRow[];
}

/** Recompute every topic's item_count from item_topics (mirrors recomputeEntityMentionCounts). */
export function recomputeTopicItemCounts(db = getSemanticDb()): void {
  db.prepare(
    `UPDATE topics SET item_count =
       (SELECT COUNT(*) FROM item_topics it WHERE it.topic_id = topics.id), updated_at = ?`,
  ).run(new Date().toISOString());
}
