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
import { SEMANTIC_VERSION } from "./pipeline";

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
  ensureSemanticSchema(cachedDb);
  return cachedDb;
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
