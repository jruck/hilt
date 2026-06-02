# Phase 2 — Semantic Knowledge Layer — BUILD SPEC

> Status: **build-ready spec**. Rationale + locked decisions live in `docs/plans/semantic-layer-phase2-plan.md`.
> This doc = the per-subsystem design (8 sections) + the phased, verification-first implementation plan.

## Subsystem designs

## Data model — semantic.sqlite schema

This section specifies `DATA_DIR/semantic.sqlite` (live: `/Users/jruck/.hilt/data/semantic.sqlite`) — the third derived-cache database alongside `graph.sqlite` (`src/lib/graph/db.ts`) and `calendar.sqlite` (`src/lib/calendar/db.ts`). It is a **pure derived cache** (Critical Constraint #2): it never writes the vault or transcript stores, and `rm semantic.sqlite*` + a rebuild reproduces it bit-for-equivalent. New code lives in `src/lib/semantic/db.ts` (this file) and `src/lib/semantic/config.ts` (path/flags, mirroring `src/lib/graph/config.ts`).

### Vector storage: sqlite-vec extension (recommended) with a BLOB+in-process fallback

**Recommendation: load `sqlite-vec` into the existing `better-sqlite3` handle, with a BLOB-only fallback when the extension can't load.** At Hilt's scale (low thousands of items/chunks per the plan §4) a brute-force in-process cosine scan is genuinely fine, but `sqlite-vec` gives us file-native KNN with zero extra services and is the path the plan already commits to (`docs/plans/semantic-layer-phase2-plan.md` §6), so it's worth the thin dependency.

Decision details:

- **npm package + load mechanism.** Add `sqlite-vec` (the official package ships prebuilt `vec0` loadable extensions per platform and exposes `getLoadablePath()`). `better-sqlite3@12.10.0` is already installed (`package.json`) and supports `Database.prototype.loadExtension`. Load it right after opening, before schema creation:

  ```typescript
  import * as sqliteVec from "sqlite-vec";
  // ...
  cachedDb = new Database(dbPath);
  vecAvailable = tryLoadVec(cachedDb); // sets module-level flag
  ```

  ```typescript
  function tryLoadVec(db: Database.Database): boolean {
    if (process.env.SEMANTIC_VEC_DISABLED === "true") return false;
    try {
      sqliteVec.load(db); // db.loadExtension(sqliteVec.getLoadablePath())
      // sanity check the extension is actually live:
      db.prepare("SELECT vec_version()").get();
      return true;
    } catch (err) {
      // Electron-packaged builds or an arch mismatch can fail to dlopen the
      // prebuilt .dylib; degrade instead of throwing (monitor-first).
      console.warn("[semantic] sqlite-vec unavailable, BLOB fallback:", err);
      return false;
    }
  }
  ```

  Note: `electron/main.ts` runs better-sqlite3 in the main process; `loadExtension` requires the better-sqlite3 native addon to be built with extension support (it is, by default). If a future packaged build strips it, the fallback covers us — no crash.

- **When vec loads:** store vectors in a `vec0` virtual table (`chunk_vectors`) keyed by the chunk rowid, and a parallel one for entity/topic-label vectors. KNN is `WHERE embedding MATCH ? ORDER BY distance LIMIT k`.

- **Fallback (vec unavailable):** every embedding is *always also* stored as a `BLOB` of little-endian Float32 in the owning row (`chunks.embedding_blob`, etc.). The query layer checks the module-level `vecAvailable` flag: if false, it loads candidate vectors via a covering index, decodes the Float32 BLOB, and does an in-process cosine scan (`src/lib/semantic/vector.ts`). Because the BLOB is the source of truth and the `vec0` table is *derived from it*, the two never diverge, and the `vec0` table can be rebuilt from BLOBs alone (`reindexVectors()`), so toggling `SEMANTIC_VEC_DISABLED` or fixing a broken extension never requires a full re-embed.

This dual-store (BLOB canonical + `vec0` index) is the only deviation from the "one row, every column" graph pattern, and it's deliberate: it keeps delete+rebuild reproducible and makes the extension a pure accelerator, not a hard dependency.

### Singleton + lifecycle shape (identical to graph/calendar)

```typescript
// src/lib/semantic/db.ts
let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;
let vecAvailable = false;

export function isSemanticVecAvailable(): boolean {
  return vecAvailable;
}

export function getSemanticDb(): Database.Database {
  const dbPath = getSemanticDbPath(); // SEMANTIC_DB_PATH || $DATA_DIR/semantic.sqlite
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  vecAvailable = tryLoadVec(cachedDb);
  ensureSemanticSchema(cachedDb); // creates vec0 tables only when vecAvailable
  return cachedDb;
}

/** Reset BOTH cached db and path (the calendar/graph rebind gotcha) so tests rebind. */
export function closeSemanticDbForTests(): void {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
  vecAvailable = false;
}
```

`getSemanticDbPath()` lives in `src/lib/semantic/config.ts` and follows `getGraphDbPath()` exactly:

```typescript
export function getSemanticDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}
export function getSemanticDbPath(): string {
  return process.env.SEMANTIC_DB_PATH || path.join(getSemanticDataDir(), "semantic.sqlite");
}
export function isSemanticEnabled(): boolean {
  return process.env.HILT_SEMANTIC_ENABLED === "true";
}
```

### Version-stamping convention (every row)

Per the locked decision and `PIPELINE_VERSION` precedent (`src/lib/library/pipeline.ts`), every derived row carries:
- `embedding_model` TEXT (e.g. `gemini-embedding-001`) — on any row that holds a vector.
- `dim` INTEGER (1536 — the stored Matryoshka truncation) — on any row that holds a vector.
- `semantic_version` TEXT (e.g. `v1` / `v1.2`) — on **every** derived row. This is `SEMANTIC_VERSION` from `src/lib/semantic/pipeline.ts` (decimal = test lane, integer = blessed backfill), mirroring the library scheme. Extraction-prompt and cluster-param identity roll into this single string exactly as `PIPELINE_VERSION` rolls digest+connection+reweave together.
- `updated_at` TEXT NOT NULL — ISO-8601 (`new Date().toISOString()`), matching `graph_nodes`/`calendar_events`. (Positions in graph use epoch-int; semantic uses ISO everywhere for consistency with stamping.)

A model upgrade or prompt change is a **backfill** (`WHERE semantic_version != ?`), not a migration — the version column is what lets the re-fit job find stale rows and re-derive them, and lets a decimal test-lane coexist with the blessed integer baseline until blessed.

### Schema — CREATE TABLE DDL

`ensureSemanticSchema()` opens with the same pragmas as the other two dbs, then `CREATE … IF NOT EXISTS`. The `vec0` virtual tables are created only when `vecAvailable` (guarded so a fallback-mode db has a valid, queryable schema).

```typescript
export function ensureSemanticSchema(db = getSemanticDb()): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    -- ----------------------------------------------------------------------
    -- meta: k/v store (mirrors graph_meta) — holds backfill cursors,
    -- last_refit_at, active_semantic_version, embedding_model, dim, vec_mode.
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS semantic_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ----------------------------------------------------------------------
    -- items: one row per source unit (a vault note, a meeting transcript, a
    -- saved Library reference). The join key back to source-of-truth markdown.
    -- scope distinguishes vault work from saved reading (cross-pollination).
    -- content_hash drives incremental: unchanged hash => skip re-embed/extract.
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS items (
      id               TEXT PRIMARY KEY,         -- stable: scope + ':' + source_path (or library artifact id)
      scope            TEXT NOT NULL,            -- 'vault' | 'library'
      kind             TEXT NOT NULL,            -- 'note' | 'meeting' | 'project' | 'reference' | 'person' | ...
      source_path      TEXT NOT NULL,            -- absolute vault path, OR references/<file> for saved refs
      title            TEXT,
      url              TEXT,                     -- library refs only
      content_hash     TEXT NOT NULL,            -- sha256 of normalized source text (skip-unchanged key)
      chunk_count      INTEGER NOT NULL DEFAULT 0,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_scope       ON items(scope);
    CREATE INDEX IF NOT EXISTS idx_items_kind        ON items(kind);
    CREATE INDEX IF NOT EXISTS idx_items_source_path ON items(source_path);
    CREATE INDEX IF NOT EXISTS idx_items_version     ON items(semantic_version);

    -- ----------------------------------------------------------------------
    -- chunks: embedding unit. Short items = 1 chunk; long meetings split into
    -- coherent segments (plan §3 Layer A). embedding_blob is the CANONICAL
    -- vector (LE float32); the vec0 table is a derived KNN index over it.
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS chunks (
      id               TEXT PRIMARY KEY,         -- item_id + ':' + ordinal
      item_id          TEXT NOT NULL,
      ordinal          INTEGER NOT NULL DEFAULT 0,
      text             TEXT NOT NULL,            -- the embedded text (derived; vault is source)
      token_count      INTEGER,
      embedding_blob   BLOB,                     -- canonical: dim x float32 LE; NULL until embedded
      embedding_model  TEXT,
      dim              INTEGER,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_item    ON chunks(item_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_version ON chunks(semantic_version);
    CREATE INDEX IF NOT EXISTS idx_chunks_unembed ON chunks(embedding_model)
      WHERE embedding_blob IS NULL;             -- backfill "what still needs embedding" probe

    -- ----------------------------------------------------------------------
    -- entities: resolved, canonical typed things (plan §3 Layer B). One row per
    -- canonical entity; surface forms live in entity_aliases. Carries its own
    -- name+context embedding (shared space) for resolution + similarity edges.
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS entities (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL,            -- 'person' | 'project' | 'idea' | 'source' (4 buckets)
      canonical_name   TEXT NOT NULL,
      summary          TEXT,
      ref_path         TEXT,                     -- resolved vault page if one exists (person note, project)
      mention_count    INTEGER NOT NULL DEFAULT 0,
      embedding_blob   BLOB,
      embedding_model  TEXT,
      dim              INTEGER,
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_name     ON entities(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_entities_ref      ON entities(ref_path);
    CREATE INDEX IF NOT EXISTS idx_entities_version  ON entities(semantic_version);

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id        TEXT NOT NULL,
      alias            TEXT NOT NULL,
      alias_norm       TEXT NOT NULL,            -- lowercased/trimmed for lookup
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (entity_id, alias_norm),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_norm ON entity_aliases(alias_norm);

    -- ----------------------------------------------------------------------
    -- topics: emergent, hierarchical, evolving (plan §3 Layer C). parent_id +
    -- level make the broad->specific tree navigable at any depth (first query:
    -- topic exploration). label/summary are LLM-written on the global re-fit.
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS topics (
      id               TEXT PRIMARY KEY,
      parent_id        TEXT,                     -- NULL at the root level
      level            INTEGER NOT NULL DEFAULT 0, -- 0 = broadest; increases toward specifics
      label            TEXT NOT NULL,
      summary          TEXT,
      item_count       INTEGER NOT NULL DEFAULT 0,
      centroid_blob    BLOB,                     -- cluster centroid in the shared space
      embedding_model  TEXT,                     -- model that produced centroid + label embedding
      dim              INTEGER,
      trend_score      REAL,                     -- recency-weighted activity (powers "recent/trending")
      semantic_version TEXT NOT NULL,            -- the re-fit pass that produced this topic
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES topics(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topics_parent  ON topics(parent_id);
    CREATE INDEX IF NOT EXISTS idx_topics_level   ON topics(level);
    CREATE INDEX IF NOT EXISTS idx_topics_trend   ON topics(trend_score DESC);
    CREATE INDEX IF NOT EXISTS idx_topics_version ON topics(semantic_version);

    -- ----------------------------------------------------------------------
    -- item_entities: which entities an item is about, with salience (Layer B).
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS item_entities (
      item_id          TEXT NOT NULL,
      entity_id        TEXT NOT NULL,
      salience         REAL NOT NULL DEFAULT 0,  -- Flash-extracted 0..1
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (item_id, entity_id),
      FOREIGN KEY (item_id)   REFERENCES items(id)    ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_entities_entity ON item_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_item_entities_sal    ON item_entities(entity_id, salience DESC);

    -- ----------------------------------------------------------------------
    -- item_topics: which topics an item belongs to, with membership score
    -- (HDBSCAN soft membership / cosine to centroid). Drives "items in topic Y".
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS item_topics (
      item_id          TEXT NOT NULL,
      topic_id         TEXT NOT NULL,
      score            REAL NOT NULL DEFAULT 0,  -- membership/confidence 0..1
      assigned_by      TEXT NOT NULL,            -- 'refit' (clustered) | 'incremental' (nearest-existing)
      semantic_version TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (item_id, topic_id),
      FOREIGN KEY (item_id)  REFERENCES items(id)  ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_topics_topic ON item_topics(topic_id);
    CREATE INDEX IF NOT EXISTS idx_item_topics_score ON item_topics(topic_id, score DESC);

    -- ----------------------------------------------------------------------
    -- topic_lineage: old->new history across re-fits (balanced evolution). Lets
    -- old items get pulled under new themes and powers a future lineage view.
    -- ----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS topic_lineage (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      old_topic_id     TEXT,                     -- NULL for op='create'
      new_topic_id     TEXT,                     -- NULL for op='delete'
      op               TEXT NOT NULL,            -- 'create'|'merge'|'split'|'rename'|'carry'|'delete'
      score            REAL,                     -- overlap/continuity weight for merge/split
      semantic_version TEXT NOT NULL,            -- the re-fit version that performed the op
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topic_lineage_old ON topic_lineage(old_topic_id);
    CREATE INDEX IF NOT EXISTS idx_topic_lineage_new ON topic_lineage(new_topic_id);
    CREATE INDEX IF NOT EXISTS idx_topic_lineage_ver ON topic_lineage(semantic_version);
  `);

  if (vecAvailable) {
    // KNN index over the canonical embedding_blob columns. rowid is the join key
    // back to chunks/entities/topics (we store the textual id alongside so we can
    // re-resolve). vec0 needs a fixed dim known at create time -> read from meta,
    // default SEMANTIC_DIM (1536).
    const dim = semanticDim(); // SEMANTIC_DIM || 1536
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        chunk_id  TEXT PRIMARY KEY,
        embedding FLOAT[${dim}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entity_vectors USING vec0(
        entity_id TEXT PRIMARY KEY,
        embedding FLOAT[${dim}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS topic_vectors USING vec0(
        topic_id  TEXT PRIMARY KEY,
        embedding FLOAT[${dim}]
      );
    `);
  }
}
```

### How delete+rebuild reproduces

1. `rm $DATA_DIR/semantic.sqlite*` (WAL/`-shm` too).
2. The cold-start backfill (`scripts/semantic-backfill.ts`, a launchd-scheduled CLI per the heavy-job convention in `src/lib/library/scheduler-jobs.ts`) walks the scope: main vault + saved Library references, with `libraries/` sub-vault excluded exactly as `graphIncludeLibraries()` excludes it (`src/lib/graph/config.ts`). For each item it computes `content_hash`, chunks, embeds (Gemini Embedding 001 → 1536 float32), runs Flash extraction → entities/aliases/item_entities, then the global re-fit (cluster → topics/item_topics, LLM label, seed `topic_lineage` with `op='create'`).
3. Every row is stamped with the active `SEMANTIC_VERSION`, `embedding_model`, `dim`, `updated_at`. The `vec0` tables are populated from the `embedding_blob` canonicals as a derived step (or skipped entirely in fallback mode and rebuilt later by `reindexVectors()`).

Determinism caveats (call out in the plan, same spirit as graph's seeded layout): embeddings are deterministic given the model+text; LLM extraction/labels are not bit-identical, so "reproduces" means *structurally equivalent at the same `SEMANTIC_VERSION`*, not byte-identical — identical to how the library's LLM digests vary across runs.

### Incremental delete key + cascade

Incremental updates (GraphRunner-style, `src/lib/graph/runner.ts`) key on `items.source_path` / `items.id`: on a file change, `DELETE FROM items WHERE id = ?` cascades (via `ON DELETE CASCADE`, with `PRAGMA foreign_keys = ON` set in `getSemanticDb()` — note the other two dbs don't enable FKs, so this is a deliberate addition for the semantic db's join integrity) through `chunks`, `item_entities`, `item_topics`. The matching `vec0` rows are deleted explicitly in the same transaction (virtual tables aren't reached by FK cascade): `DELETE FROM chunk_vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE item_id = ?)` before the item delete. After a batch, an `entities` GC step (`DELETE FROM entities WHERE mention_count = 0 AND id NOT IN (SELECT entity_id FROM item_entities)`) mirrors `deleteDanglingEdges()` in `src/lib/graph/db.ts`, and `recomputeEntityMentionCounts()` / `recomputeTopicItemCounts()` mirror `recomputeDegrees()`.

### .env.example additions (mirror `LIBRARY_*` / `HILT_GRAPH_*` blocks)

```
# Phase 2 — Semantic Knowledge Layer (semantic.sqlite). Opt-in; off by default.
# HILT_SEMANTIC_ENABLED=true
# SEMANTIC_DB_PATH=                  # default: $DATA_DIR/semantic.sqlite
# SEMANTIC_VEC_DISABLED=             # =true to force the BLOB cosine fallback (skip sqlite-vec)
# SEMANTIC_DIM=1536                  # stored Matryoshka truncation of gemini-embedding-001
# GEMINI_API_KEY=
# SEMANTIC_EMBEDDING_MODEL=gemini-embedding-001
# SEMANTIC_EXTRACT_MODEL=gemini-flash-latest      # per-item entity/topic extraction
# SEMANTIC_TAXONOMY_MODEL=gemini-pro-latest       # low-frequency global label/merge pass
```

### Docs to touch on build

- `docs/DATA-MODELS.md` — these eight tables + the `LibraryArtifact` cross-reference (saved refs become `items` with `scope='library'`).
- `docs/PIPELINE-VERSIONS.md` — register `SEMANTIC_VERSION` alongside `PIPELINE_VERSION` (the version drives backfill/blessing identically).
- `docs/ARCHITECTURE.md` — third derived-cache db; note the `vec0`-vs-BLOB dual store and the `PRAGMA foreign_keys = ON` deviation from graph/calendar.

---

## Ingest, chunking & embedding pipeline

This section specifies how items are discovered, chunked, and embedded into `DATA_DIR/semantic.sqlite` (`/Users/jruck/.hilt/data/semantic.sqlite` on the live app). It reuses the graph's inclusion policy and watcher wiring verbatim where possible, and follows the derived-cache / versioning / shell-vs-API conventions already in the tree.

### 1. Discovery — reuse the graph inclusion policy, do not re-invent it

The graph builder already encodes exactly the scope we want, so the semantic ingest layer must **import** it rather than duplicate it:

- **Vault scan**: use `scanVault(root)` and `INCLUDED_DIRS` from `src/lib/graph/build.ts:76` (`projects`, `people`, `meetings`, `references`, `areas`, `thoughts`, `lists/now`, `docs`). This already excludes all dotdirs and the `libraries/` sub-vault via `isExcludedDirName` (`build.ts:93`) and `walkIncludedDir` (`build.ts:109`). The locked decision "main vault + saved Library references, exclude `libraries/`" is *identical* to the graph's default `INCLUDED_DIRS` minus the opt-in `library_cluster` path, so reuse is exact — no new walker.
- **Root resolution**: `resolveVaultRoot()` (`build.ts:62`).
- **Saved references**: these are the `.md` files under `references/` that `scanVault` already returns; the rich text to embed (summary, key points, digest, cached source) is read via `parseReferenceFile(vaultPath, absPath)` from `src/lib/library/references.ts:28`, which yields a `LibraryArtifactDetail` with `summary`, `key_points`, `digest_markdown?`, `content`, and `source_cache?` (`src/lib/library/types.ts:160,234`).
- **Candidates are EXCLUDED** from the semantic layer in v1. They live in `references/.cache` (a dotdir, derived not source) and are explicitly out of "saved Library references." Embedding churning review candidates would burn API spend on items that mostly expire. This matches the graph's treatment of candidates as a separate, eventual concern.
- **`item` identity**: one logical item == one `.md` file. The stable item id is `note:<hashId(absPath)>` / `ref:<hashId(absPath)>` etc., reusing `noteNodeId`/`referenceNodeId`/`personNodeId`/`projectNodeId` from `build.ts:246-264` so the semantic layer's item ids are **the same strings as graph node ids**. This is the single most important integration decision in this section: it makes the Phase-2 graph integration a join, not a mapping table.

### 2. Chunking rule — item-as-unit, with coherent-segment splitting for long bodies

Text is assembled per item from the richest available source, in priority order, then split:

**Per-item text assembly** (the "document" to embed):
- **notes / project index / north-star / person notes**: full file body with frontmatter stripped (reuse `frontmatterTagList`-style frontmatter detection from `build.ts:391`; strip the `---…---` block, keep the H1 + body).
- **saved references**: concatenate `title` + `summary` + `key_points` + `digest_markdown` + `source_cache.content` (the transcript/article body) from `parseReferenceFile`. This is where YouTube transcripts and article extractions live (`source_cache.kind` ∈ `transcript|article|source`, populated in `digestion.ts:346`). **Text-only v1**: we embed the transcript/summary text and let entity extraction (sibling section) carry creator/channel/source entities; we never touch the media bytes.
- **meetings**: the meeting `.md` (Granola summary + notes), NOT the raw transcript store (`meetings/transcripts/` is excluded by `collectMeetingFiles`, `build.ts:645`, and is a read-only provider store per Critical Constraint #1).

**Chunking decision (the rule):**
- Compute `charCount` of the assembled text.
- If `charCount <= CHUNK_TARGET_CHARS` (default **4000 chars**, ~1k tokens) → **one chunk = the whole item** (`chunk_index = 0`, `chunk_count = 1`). This is the common case: most notes, all short references, most meetings.
- If `charCount > CHUNK_TARGET_CHARS` → **split on coherent boundaries**, never mid-sentence:
  1. Split first on **markdown structure**: H2/H3 headings and horizontal rules. Reuse the heading/section helpers already in `src/lib/library/markdown.ts` (`extractSection`, `extractHeading`, used by `scripts/library-reweave.ts`).
  2. Within an over-long section, fall back to **paragraph boundaries** (`\n\n`), greedily packing paragraphs into chunks of `CHUNK_TARGET_CHARS` with **`CHUNK_OVERLAP_CHARS` overlap** (default 400 chars) so a concept spanning a boundary is embeddable from either side.
  3. For transcripts with no paragraph structure, split on sentence boundaries reusing the `sentences()` splitter from `digestion.ts:47` (it already protects "vs." etc.), packing to target size.
- **Hard floor**: drop chunks under `CHUNK_MIN_CHARS` (default 80, matching the library's existing "chrome vs content" floor in `digestion.ts`) so navigation cruft / empty stubs don't generate junk embeddings.

Rationale for these knobs: `gemini-embedding-001` accepts up to 2048 input tokens; 4000 chars keeps us comfortably under that with headroom, and matches the granularity at which topic clustering produces useful drill-downs (a long meeting splits into a handful of segments rather than one diluted mean vector). The item-as-unit default keeps the common case to a single embedding (cost and simplicity), and the split path only activates for the minority of long meetings/notes — exactly the locked "item-as-unit + long meetings/notes split into coherent segments" rule.

### 3. The Gemini client — thin fetch-based API client (recommend), NOT a shell-out

**Recommendation: a thin `fetch`-based API client** at `src/lib/semantic/gemini.ts`, in deliberate departure from the Library's CLI shell-out, for these concrete reasons:

- The existing shell-outs (`summarize` CLI in `digestion.ts:24`, `claude` CLI in `connections.ts:42`) wrap **agentic, vault-exploring** tasks where the CLI *is* the value (it greps the vault, has tools). Embeddings are a **stateless, high-volume, batched** RPC — there is no Gemini "embeddings CLI" that adds value, and shelling out per batch would add process-spawn overhead on thousands of items and make batching/backpressure awkward.
- `fetch` is already used directly in the Library for HTTP (`digestion.ts:179,395` for Raindrop/short-URL resolution), so a fetch client is in-idiom and adds **zero new npm dependencies** (no `@google/genai` SDK needed — the embeddings REST endpoint is one POST).
- We still follow the env-config + graceful-degradation style of the CLIs: resolve the key per call, warn once and **disable** rather than crash when unconfigured (mirroring `warnedMissingSummarize` in `digestion.ts:22`).

Client spec (`src/lib/semantic/gemini.ts`):

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents
header: x-goog-api-key: <GEMINI_API_KEY>
body: { requests: [{ model, content:{parts:[{text}]}, taskType, outputDimensionality: 1536 }, …] }
```

- **Batching**: `batchEmbedContents` (up to `SEMANTIC_EMBED_BATCH_SIZE`, default **100** requests/call). The backfill feeds chunks into a batcher that flushes at the size cap.
- **Matryoshka truncation to 1536**: request `outputDimensionality: 1536` so the API returns the truncated vector directly. Because `gemini-embedding-001` Matryoshka vectors below 3072 are **not unit-normalized**, **L2-normalize each returned vector in the client** before persisting (so cosine == dot product downstream). Store as `Float32Array` → SQLite `BLOB` (1536 × 4 = 6144 bytes/vector).
- **`taskType`**: embed corpus items with `RETRIEVAL_DOCUMENT`; the CLI/query backbone (sibling section) embeds queries with `RETRIEVAL_QUERY`. The pipeline always passes `RETRIEVAL_DOCUMENT` here.
- **Retry/backoff**: retry on HTTP 429 / 503 / network error with exponential backoff + full jitter, `SEMANTIC_EMBED_MAX_RETRIES` (default 5), base 1s, cap 60s. Honor a `Retry-After` header when present. On a 400 (bad input) do **not** retry — log the offending item id and skip it (one poison chunk must not stall a 3000-item backfill).
- **Rate limits**: a simple token-bucket limiter keyed to `SEMANTIC_EMBED_RPM` (default 1500, the documented gemini-embedding-001 paid tier; set conservatively). Concurrency capped at `SEMANTIC_EMBED_CONCURRENCY` (default 4 in-flight batches). The limiter lives in the client so both backfill and incremental paths share it.

### 4. Schema (`DATA_DIR/semantic.sqlite`) — follows the graph/calendar db conventions exactly

New module `src/lib/semantic/db.ts` mirrors `src/lib/graph/db.ts:64-135` precisely: `better-sqlite3`, `journal_mode=WAL`, `synchronous=NORMAL`, a process singleton (`cachedDb`/`cachedPath` keyed on the resolved path, `db.pragma` set in `ensureSemanticSchema`), `CREATE TABLE IF NOT EXISTS`, upserts listing every mutable column, and `closeSemanticDbForTests()` that resets **both** `cachedDb` and `cachedPath` (the calendar/graph gotcha). Path resolution mirrors `getGraphDbPath()` (`config.ts:21`): `process.env.SEMANTIC_DB_PATH || path.join(getSemanticDataDir(), "semantic.sqlite")`.

```sql
CREATE TABLE IF NOT EXISTS semantic_items (
  item_id        TEXT PRIMARY KEY,      -- == graph node id (note:/ref:/person:/project:…)
  source_file    TEXT NOT NULL,         -- abs path (incremental delete key, mirrors graph_nodes.source_file)
  kind           TEXT NOT NULL,         -- note|reference|meeting|person|project|north_star
  title          TEXT,
  content_hash   TEXT NOT NULL,         -- sha256 of assembled text → skip re-embed when unchanged
  chunk_count    INTEGER NOT NULL,
  embed_version  INTEGER NOT NULL,      -- EMBED_PIPELINE_VERSION integer part
  embed_model    TEXT NOT NULL,         -- "gemini-embedding-001"
  embed_dims     INTEGER NOT NULL,      -- 1536
  status         TEXT NOT NULL,         -- pending|embedded|error
  last_error     TEXT,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_semantic_items_srcfile ON semantic_items(source_file);
CREATE INDEX IF NOT EXISTS idx_semantic_items_status  ON semantic_items(status);

CREATE TABLE IF NOT EXISTS semantic_chunks (
  chunk_id       TEXT PRIMARY KEY,      -- hashId(item_id|chunk_index)
  item_id        TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,
  char_start     INTEGER NOT NULL,
  char_count     INTEGER NOT NULL,
  text_excerpt   TEXT,                  -- first ~240 chars for query-result display (no full body re-store)
  embedding      BLOB,                  -- Float32Array(1536), L2-normalized; NULL until embedded
  embed_version  INTEGER NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_item ON semantic_chunks(item_id);

CREATE TABLE IF NOT EXISTS semantic_meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
```

Notes: chunks store only a short `text_excerpt`, not the full body — markdown stays the source of truth (Critical Constraint #2); query results read the live file when full text is needed. `deleteChunksByItemId` / `deleteItemsBySourceFile` are the incremental delete keys, exactly paralleling `deleteNodesBySourceFile` (`graph/db.ts:223`). Deleting `semantic.sqlite` and re-running the backfill reproduces it (modulo a fresh round of API calls), satisfying the derived-cache constraint.

### 5. Versioning — `EMBED_PIPELINE_VERSION`, mirroring `PIPELINE_VERSION`

Add `src/lib/semantic/pipeline.ts` with `export const EMBED_PIPELINE_VERSION = "v1.0"` following the **integer = published-at-scale, decimal = test-iteration** precedent documented in `src/lib/library/pipeline.ts:1-23`. The integer part is stamped onto every `semantic_items.embed_version` / `semantic_chunks.embed_version`. Add a `docs/PIPELINE-VERSIONS.md`-style entry (or a `## Embeddings` section in the same file) on every change to: the chunking rule, the assembled-text composition, the model, `outputDimensionality`, or normalization. **Bumping the integer version triggers a full re-embed backfill** (the backfill treats any row with `embed_version < current` as stale, identical in spirit to the Library's full-backfill-on-integer-bump). A `content_hash` mismatch triggers re-embed of just that item.

### 6. Cold-start backfill — resumable, chunked, idempotent, version-stamped

New CLI script `scripts/semantic-backfill.ts`, structured like `scripts/library-reweave.ts` (`loadEnvConfig(process.cwd())` at top; `--vault`, `--write` default-off-dry-run, `--limit`, `--batch` args). Invoked as an npm script `semantic:backfill` and scheduled via launchd by extending `librarySchedulerJobs()` in `src/lib/library/scheduler-jobs.ts:21` (the existing launchd registration path) — heavy/periodic, never in-process on the request path.

Algorithm:
1. `scanVault(root)` → candidate item list (graph inclusion policy).
2. For each item: assemble text, compute `content_hash`. **Idempotency / resumability**: skip if a `semantic_items` row exists with matching `content_hash` AND `embed_version == current` AND `status == 'embedded'`. This makes re-running the backfill after a crash a no-op for already-done items — the resume key is the DB itself, no separate cursor file.
3. Chunk per §2; upsert `semantic_items` (`status='pending'`) and `semantic_chunks` (embedding NULL) **before** calling the API, in one transaction per item, so a kill mid-run leaves a consistent "pending" record to resume from.
4. Feed pending chunks to the Gemini batcher (§3). On batch success, write embeddings + set item `status='embedded'` in a transaction. On per-item failure, set `status='error'`, `last_error`, and continue.
5. **Chunked / cooperative**: process in batches of `SEMANTIC_EMBED_BATCH_SIZE`; between batches, persist progress and (in the CLI) log a `processed/total` line. This is the launchd-job analogue of the layout engine's cooperative chunking (`graph/layout.ts`) — bounded work per step, fully resumable.
6. Stamp `semantic_meta`: `backfilled_at`, `embed_version`, `item_count`, `chunk_count`.

### 7. Incremental embedding on file change — a `SemanticRunner`, GraphRunner-style

Add `src/lib/semantic/runner.ts` modeled directly on `src/lib/graph/runner.ts`: a singleton instantiated **only** by `server/ws-server.ts` and **only** when `isSemanticEnabled()` (new `HILT_SEMANTIC_ENABLED` flag mirroring `isGraphEnabled()`, `graph/config.ts:11`). It subscribes to the **same** watcher signals the GraphRunner already consumes — there is no need for a second watcher:

- **Reuse the existing watcher events.** The cleanest wiring is to have `ws-server.ts` fan the same `onDirChanged`/`onFileChanged`/`onFileRemoved` calls (BridgeWatcher + ScopeWatcher) to the `SemanticRunner` it already fans to the `GraphRunner` (`runner.ts:156-203`). The `SemanticRunner` keeps its own `source_file → content_hash` map (analogue of the GraphRunner's `mtimes` map, `runner.ts:75`) and on a change: re-assembles text, compares hash, and if changed enqueues the item.
- **Debounce + coalesce**: same pattern as `scheduleRelax` (`runner.ts:321`) — a debounce window (`SEMANTIC_EMBED_DEBOUNCE_MS`, default 2000; embeddings are an API round-trip, so a larger window than layout's 500ms is appropriate) coalesces a burst into one batched embed pass. Single-flight with a queued-rerun flag, exactly as `runRelax` (`runner.ts:338`).
- **Apply**: on change → `deleteChunksByItemId` then re-chunk + re-embed (delete-then-insert, matching `updateGraphForFile`'s `delete*BySourceFile` + upsert, `build.ts:848`). On removal → `deleteItemsBySourceFile` + `deleteChunksByItemId`.
- **Periodic reconcile backstop**: a `RECONCILE_MS` interval (reuse the 5-min cadence from `runner.ts:59`) does a full `content_hash` diff over `scanVault` to self-heal missed events, and re-embeds any rows with `embed_version < current` (catching a version bump without a separate migration). This is the embeddings analogue of the GraphRunner reconcile (`runner.ts:233`).
- **No candidate poll** — candidates are out of scope (§1), so the `pollCandidates` timer has no analogue here.

Errors are swallowed-and-logged (`console.error("[SemanticRunner] …")`) so a boot or API hiccup never crashes `ws-server.ts`, matching the GraphRunner's defensive style (`runner.ts:108-122`).

### 8. `SEMANTIC_*` env config to add to `.env.example`

Add after the graph block (`.env.example:62`), commented-out like the graph vars, with bounded-int getters in a new `src/lib/semantic/config.ts` mirroring `boundedInt` (`graph/config.ts:144`):

```
# Semantic Knowledge Layer (Phase 2). Opt-in; off by default.
# HILT_SEMANTIC_ENABLED=true
# SEMANTIC_DB_PATH=                          # default: $DATA_DIR/semantic.sqlite
# GEMINI_API_KEY=                            # required; store the real key in .env.local only
# SEMANTIC_EMBED_MODEL=gemini-embedding-001
# SEMANTIC_EMBED_DIMS=1536                   # Matryoshka truncation (vectors re-normalized client-side)
# SEMANTIC_EMBED_BATCH_SIZE=100              # requests per batchEmbedContents call
# SEMANTIC_EMBED_CONCURRENCY=4               # max in-flight batches
# SEMANTIC_EMBED_RPM=1500                    # client-side rate limit (requests/min)
# SEMANTIC_EMBED_MAX_RETRIES=5               # 429/503/network backoff retries (full jitter, cap 60s)
# SEMANTIC_EMBED_DEBOUNCE_MS=2000            # coalesce incremental re-embeds (SemanticRunner)
# SEMANTIC_CHUNK_TARGET_CHARS=4000           # item-as-unit below this; split above it
# SEMANTIC_CHUNK_OVERLAP_CHARS=400           # overlap between split chunks
# SEMANTIC_CHUNK_MIN_CHARS=80                # drop chunks below this (chrome/stub floor)
# SEMANTIC_DISABLED=0                        # =1 to no-op embeds (parallels LIBRARY_SUMMARIZE_DISABLED)
```

`GEMINI_API_KEY` is the one **new credential**; like `RAINDROP_TOKEN`/`XURL_BIN` it belongs in `.env.local` and is loaded by the same `loadEnvConfig`/CLI-runner path the Library uses (`.env.example:64-65`). Reuse this single key for the Flash entity-extraction and Pro/global-taxonomy passes (sibling sections) — one Gemini key, one client base.

### 9. Cost order-of-magnitude (a few-thousand items + references)

`gemini-embedding-001` paid pricing is ~$0.15 per 1M input tokens. Assume **3,000 items**, averaging ~600 tokens of assembled text each, with long meetings/references multiplying into ~1.4 chunks/item on average → ~4,200 chunks → **~2.5M input tokens** for a full cold-start backfill.

- **Cold-start backfill: ~$0.40** (well under $1). Even a pessimistic 5,000 items at 1,000 tokens each (5M tokens) is **~$0.75**.
- **Incremental steady state**: a handful of file edits/day re-embed only the touched item's chunks — **fractions of a cent per day**, negligible.
- **Version-bump full re-embed**: same order as a cold start (~$0.40), incurred only on an integer `EMBED_PIPELINE_VERSION` bump.

Embedding cost is effectively a rounding error; the cost-sensitive components are the per-item Flash extraction and the periodic Pro/Claude taxonomy pass covered in sibling sections. The chunking rule (item-as-unit default, split only long bodies) keeps token volume — and therefore this already-tiny cost — minimal.

---

## Entity extraction & resolution

This section specifies Layer B of `DATA_DIR/semantic.sqlite`: per-item entity extraction with **Gemini Flash** and entity **resolution/dedupe**. It follows the existing shell-out LLM convention (`src/lib/library/connections.ts`, `src/lib/library/digestion.ts`), the derived-cache db conventions (`src/lib/graph/db.ts`, `src/lib/calendar/db.ts`), the `PIPELINE_VERSION` precedent (`src/lib/library/pipeline.ts`), and reconciles against the **already-existing** `person`/`project` graph nodes minted in `src/lib/graph/build.ts`.

### B.0 Module layout

```
src/lib/semantic/
  config.ts            # SEMANTIC_* + GEMINI_* env getters, getSemanticDbPath()
  db.ts                # better-sqlite3 singleton, ensureSemanticSchema()
  gemini.ts            # thin Gemini client (shell-out vs API decision below)
  extraction-prompt.ts # EXTRACTION_PROMPT + parseExtractionOutput() (mirrors connection-prompt.ts)
  extract.ts           # extractEntities(item) -> RawEntity[]  (Gemini Flash, one call/item)
  resolve.ts           # blocking + LLM merge-judge -> canonical entities + aliases
  resolve-prompt.ts    # MERGE_PROMPT + parseMergeJudgment()
  reconcile.ts         # bind canonical entities to existing graph person/project nodes
  version.ts           # SEMANTIC_VERSION (mirrors pipeline.ts integers/decimals scheme)
scripts/semantic-extract.ts      # CLI: cold-start backfill / per-item extract
scripts/semantic-resolve.ts      # CLI: cold-start global resolution
```

### B.1 Gemini access: thin API client (NOT a CLI shell-out)

The Library shells out to `claude` / `summarize` because those are *agentic, vault-exploring* calls (read-only Read/Grep/Glob inside the vault, `--output-format json` envelope). Entity extraction is the opposite: a **stateless, high-volume, structured-output** call (one per item, thousands at cold-start). Spawning a child process per item is the wrong shape, and no first-party `gemini` CLI is a stable dependency the way `claude` is. So: a **thin `fetch`-based client** in `src/lib/semantic/gemini.ts`, no SDK (matches "no API SDK" by staying dependency-free — raw `fetch`, like `fetchRaindropCache` in `digestion.ts:395`). Config mirrors the `LIBRARY_*` env style:

```
# .env.example (new block, mirroring the LIBRARY_* block)
# GEMINI_API_KEY=
# SEMANTIC_DISABLED=0                         # mirrors LIBRARY_CONNECTIONS_DISABLED — keeps tests offline
# SEMANTIC_EXTRACT_MODEL=gemini-flash-latest  # per-item extraction
# SEMANTIC_TAXONOMY_MODEL=gemini-pro-latest   # global label/merge pass (or claude via CLI)
# SEMANTIC_EMBED_MODEL=gemini-embedding-001
# SEMANTIC_EXTRACT_TIMEOUT_MS=60000
# SEMANTIC_EXTRACT_CONCURRENCY=4              # parallel Flash calls at backfill
# SEMANTIC_MAX_ITEM_CHARS=12000              # cap text sent per item (cost guard)
# SEMANTIC_DB_PATH=                          # default DATA_DIR/semantic.sqlite
```

`gemini.ts` exposes `generateStructured(model, systemPrompt, userText, schema, {timeoutMs})` and `embed(texts, {dim:1536})`. It honors `SEMANTIC_DISABLED=1` by short-circuiting to an empty result (exact precedent: `judgeConnections` short-circuits on `LIBRARY_CONNECTIONS_DISABLED==="1"`, `connections.ts:132`). On any HTTP/parse failure it returns the same empty result — **fail-soft, never throw** — matching the abstain-on-failure discipline throughout the Library.

> The stronger global taxonomy/labeling pass (locked as Gemini Pro **or** Claude CLI) is the one place a CLI shell-out is appropriate, because it can be a single low-frequency call that may want to explore the vault. `reconcile.ts`/topics-layer reuse `runClaude` from `connections.ts` if `SEMANTIC_TAXONOMY_MODEL` names a `claude:*` model, else `gemini.ts`. That dispatch lives outside this section (Topics), but the seam is named here.

### B.2 Per-item extraction with Gemini Flash

**What is an "item".** Same scope as the graph builder's `INCLUDED_DIRS` (`build.ts:76`) plus saved Library references — i.e. the corpus is exactly the set of `note`/`project`/`person`/`north_star`/`reference` nodes the graph already mints (candidates and `libraries/` excluded, per locked scope). Reuse the graph node id as the `item_id` so Layer B keys 1:1 to graph nodes: `noteNodeId`/`referenceNodeId`/`personNodeId`/`projectNodeId` from `build.ts:246-264`. The text sent to Flash is, per item kind:
- reference: `title` + frontmatter `description` + `digest_markdown`/`summary` + `key_points` (the already-digested text — never re-extract the source);
- note/project/north_star: H1 + body (stripped frontmatter), capped at `SEMANTIC_MAX_ITEM_CHARS`;
- meeting (a `note` under `meetings/`): transcript summary/body, **text-only** (locked).

**Prompt design** (`extraction-prompt.ts`, exported `EXTRACTION_PROMPT`, same module shape as `CONNECTION_PROMPT` in `connection-prompt.ts:3`). System prompt, practitioner voice ("Justin"), four buckets named explicitly, abstention-positive (mirrors the "No connection is a correct answer" framing that makes the Library judge honest):

```
You extract the typed entities a single item is ABOUT, for one person's ("Justin") personal
knowledge base. Return only entities genuinely present or centrally discussed — not every
noun. Empty buckets are correct and common.

Four entity types (use EXACTLY these `type` values):
- "person"  — people, authors, creators, channels, hosts (a named human or named channel/byline)
- "project" — Justin's projects, areas, or concrete tasks/initiatives (things he is DOING)
- "concept" — ideas, concepts, themes, arguments, mental models (things being THOUGHT ABOUT)
- "source"  — tools, products, orgs, companies, publications, services (named external things)

RULES:
- Extract the entity's most CANONICAL surface form as `name` (e.g. "Anthropic", not "anthropic's");
  list other surface forms seen in THIS item in `aliases` (handles, abbreviations, "the company").
- `salience` ∈ {primary, secondary, mention}: primary = the item is substantially about it;
  mention = named in passing. Be strict; most items have 0-2 primary entities.
- `evidence` = one short quoted/paraphrased span from the item that justifies the entity. If you
  cannot ground it in the text, DO NOT emit it.
- Do NOT invent. Do NOT split one thing into near-duplicates. Do NOT emit generic words
  ("technology", "ideas") as concepts — a concept must be a NAMED, specific idea.
- Prefer specific over broad ("retrieval-augmented generation" over "AI").

Return ONLY this JSON, nothing else:
{ "entities": [ {
    "type": "person" | "project" | "concept" | "source",
    "name": "<canonical surface form>",
    "aliases": ["<other surface forms in this item>"],
    "salience": "primary" | "secondary" | "mention",
    "evidence": "<one grounding span from the item>"
} ] }
If nothing qualifies: { "entities": [] }. That is a complete, correct answer.
```

**Strict JSON enforcement** — two layers, belt-and-suspenders, exactly mirroring how the Library both *asks* for JSON and *tolerantly parses* it:
1. **Provider-enforced**: Gemini `generateContent` is called with `generationConfig.responseMimeType="application/json"` and `responseSchema` set to the OpenAPI-subset schema below. This is the structured-output guarantee Flash supports natively; it removes the prose/code-fence failure mode the Library has to defend against.
2. **Defensive parse**: `parseExtractionOutput()` reuses the exact tolerant-parse helpers proven in `connection-prompt.ts` — `stripCodeFences` (`:93`), `extractFirstJsonObject` (`:98`), `tryParse` (`:122`) — then per-entity normalization that **drops any malformed entity** (no `evidence` ⇒ drop, unknown `type` ⇒ drop, blank `name` ⇒ drop), identical in spirit to `normalizeConnections` dropping a connection with no relationship sentence (`connection-prompt.ts:43-60`). On a wholly-unparseable response: return `{entities:[]}` (abstain), never throw.

`responseSchema` (the enforced shape):

```jsonc
{ "type":"object","properties":{ "entities":{ "type":"array","items":{
  "type":"object",
  "properties":{
    "type":{"type":"string","enum":["person","project","concept","source"]},
    "name":{"type":"string"},
    "aliases":{"type":"array","items":{"type":"string"}},
    "salience":{"type":"string","enum":["primary","secondary","mention"]},
    "evidence":{"type":"string"}
  },
  "required":["type","name","salience","evidence"]
}}},"required":["entities"]}
```

`RawEntity` (in-memory, pre-resolution):
```ts
interface RawEntity { type:"person"|"project"|"concept"|"source"; name:string; aliases:string[]; salience:"primary"|"secondary"|"mention"; evidence:string; }
```

**Versioning & idempotency.** Every extraction row is stamped `extract_version` (= `SEMANTIC_VERSION` from `version.ts`, integers/decimals exactly per `pipeline.ts:23`) plus `extract_model` and `item_content_hash` (`hashId(itemText)` from `utils.ts:5`). `extractEntities` skips an item whose `(item_id, item_content_hash, extract_version)` already exists — so re-runs are free, a content edit re-extracts only that item, and a `SEMANTIC_VERSION` bump triggers a full backfill (the model-upgrade-is-a-backfill principle). Backfill runs at `SEMANTIC_EXTRACT_CONCURRENCY` parallel Flash calls with a bounded promise pool, resumable like the layout main-loop.

### B.3 Schema (Layer B tables in `semantic.sqlite`)

`db.ts` follows `graph/db.ts` exactly: WAL + `synchronous=NORMAL`, singleton keyed on resolved path (`getSemanticDb`/`closeSemanticDbForTests`), `CREATE TABLE IF NOT EXISTS`, every-mutable-column upserts, shared `parseJson`.

```sql
-- raw per-item extractions (the audit/rebuild source; cheap to re-derive)
CREATE TABLE IF NOT EXISTS item_entity_mentions (
  id            TEXT PRIMARY KEY,   -- hashId(item_id|type|normName|extract_version)
  item_id       TEXT NOT NULL,      -- = graph node id (note:/ref:/person:/project:)
  raw_type      TEXT NOT NULL,      -- person|project|concept|source
  raw_name      TEXT NOT NULL,
  norm_name     TEXT NOT NULL,      -- slugify(raw_name) for blocking
  aliases_json  TEXT NOT NULL,
  salience      TEXT NOT NULL,
  evidence      TEXT NOT NULL,
  entity_id     TEXT,               -- FK to entities.id, NULL until resolved
  extract_model TEXT NOT NULL,
  extract_version TEXT NOT NULL,
  item_content_hash TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentions_item   ON item_entity_mentions(item_id);
CREATE INDEX IF NOT EXISTS idx_mentions_norm   ON item_entity_mentions(raw_type, norm_name);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON item_entity_mentions(entity_id);

-- resolved canonical entities
CREATE TABLE IF NOT EXISTS entities (
  id             TEXT PRIMARY KEY,  -- hashId(type|canonical_name) at creation; stable thereafter
  type           TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  summary        TEXT,              -- filled by Topics/global pass; NULL ok at B
  graph_node_id  TEXT,             -- reconciliation: bound person:/project: node id, else NULL
  name_embedding BLOB,             -- 1536-dim Matryoshka, name+context (sqlite-vec)
  resolve_version TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_node ON entities(graph_node_id);

CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_id  TEXT NOT NULL,
  alias      TEXT NOT NULL,
  norm_alias TEXT NOT NULL,
  PRIMARY KEY (entity_id, norm_alias)
);
CREATE INDEX IF NOT EXISTS idx_aliases_norm ON entity_aliases(norm_alias);

-- the durable item↔entity edge (feeds graph integration later)
CREATE TABLE IF NOT EXISTS item_entities (
  item_id   TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  salience  TEXT NOT NULL,
  PRIMARY KEY (item_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_item_entities_entity ON item_entities(entity_id);

-- merge audit (so a merge is reversible/inspectable; mirrors topic_lineage intent)
CREATE TABLE IF NOT EXISTS entity_merges (
  loser_id  TEXT NOT NULL,
  winner_id TEXT NOT NULL,
  reason    TEXT,
  resolve_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (loser_id, winner_id)
);
```

Delete `semantic.sqlite` + re-run extract→resolve reproduces everything (Critical Constraint #2). `name_embedding` is computed by Layer A's `embed()` over a short `"<type>: <canonical_name> — <top evidence spans>"` context string and stored via `sqlite-vec`; resolution blocking does ANN over this column.

### B.4 Entity resolution / dedupe

Two-stage, cheap-filter-then-LLM, exactly the architecture the plan calls for (`semantic-layer-phase2-plan.md:135-138`): blocking by embedding similarity, then an LLM merge-judge for the survivors.

**Stage 1 — candidate blocking (no LLM).** For each unresolved mention (or each existing entity at re-fit), gather merge candidates of the **same `type` only** via the union of three cheap signals:
1. **Exact/normalized name or alias hit** — `norm_name` equals an existing `entities.canonical_name`-slug or any `entity_aliases.norm_alias` (SQL index lookup). High-precision, auto-merges with no LLM (see Stage 2 short-circuit).
2. **Embedding ANN** — `sqlite-vec` KNN over `name_embedding`, top-K (default 10) within a cosine threshold (`SEMANTIC_BLOCK_SIM`, default 0.82). This catches "Anthropic" ↔ "the Anthropic team", "RAG" ↔ "retrieval-augmented generation".
3. **Edit-distance fallback** — a cheap normalized Levenshtein on `norm_name` (handles typos/casing the embedding may miss for very short names).

Blocking only proposes pairs; it never merges on its own except case 1's exact normalized match.

**Stage 2 — LLM merge-judge** (`resolve-prompt.ts`, `MERGE_PROMPT`, same envelope discipline as the extraction prompt). For each blocked pair/cluster above the similarity floor but below the auto-merge floor (`SEMANTIC_AUTO_MERGE_SIM`, default 0.95 — collapse near-identical without spend), batch the candidate set into ONE Gemini Flash call and ask for a same/different verdict per pair with the canonical form:

```
You decide whether candidate entity mentions refer to the SAME real-world entity, for one
person's knowledge base. Same type only. Two things that are merely RELATED or commonly
co-occur are NOT the same entity (do not merge "OpenAI" and "GPT-4"; do not merge a person
with their company). Merge only true referential identity: spelling/handle/abbreviation
variants, full-name vs short-name, "the company" vs its name.

Given a CLUSTER of mentions (each with type, name, sample evidence), return ONLY:
{ "groups": [ { "canonical_name": "<best canonical form>",
                "members": ["<name as given>", ...],
                "reason": "<one line: why these are one entity>" } ] }
Every input member must appear in exactly one group; a singleton group is correct and common.
```

Enforced again with `responseMimeType:"application/json"` + `responseSchema`, parsed with the same tolerant helpers; an unparseable verdict ⇒ **treat every member as its own entity** (fail-soft = no spurious merges). The merge-judge is the only quality lever — no manual override rules (plan principle 1).

**Producing canonical entities.** For each judge group: pick (or create) the surviving `entities` row, set `canonical_name`, fold all members' surface forms + their `aliases_json` into `entity_aliases`, point every member mention's `entity_id` at the survivor, write `item_entities` rows (max-salience wins on conflict), and record an `entity_merges` row per absorbed entity. Entity `id` is `hashId(type|canonical_name)` at *creation* and **never recomputed on rename** (rename is an alias add + `canonical_name` update, not a new id) — so downstream `item_entities`/graph edges stay stable across re-fits.

### B.5 Incremental vs cold-start resolution

These are two entry points over the same Stage 1/2 engine, mirroring the GraphRunner "incremental on watcher events + periodic full reconcile" split (`src/lib/graph/runner.ts`) and the Library's two-cadence model.

**Incremental (new/edited item → extract → resolve against existing).** Triggered the same way the graph incremental path is — on a vault watcher event for an included file (the `updateGraphForFile` seam in `build.ts:829`), and via the candidate→saved promotion hook for new references. Flow: `extractEntities(item)` → for each new mention, run Stage 1 blocking **against the existing `entities` table** → Stage 2 merge-judge only on the small blocked candidate set → bind to an existing entity or mint a new one. This is O(new mentions), no global re-cluster — it just slots the item's entities into the existing canonical set, exactly the plan's "incremental on ingest" cadence (`plan §4.2`). Cost: one Flash extract call + at most one small Flash merge call per changed item.

**Cold-start global resolution (`scripts/semantic-resolve.ts`).** After the cold-start extraction backfill populates `item_entity_mentions` for the whole corpus, run resolution over **all** mentions at once: block by `type`, cluster the blocked pairs into connected components (union-find over the similarity graph), then one merge-judge call per component. This is the launchd-scheduled heavy job shape (`scheduler-jobs.ts`), resumable/chunked. It is also the operation re-run on a `SEMANTIC_VERSION` bump (re-extract everything, then global re-resolve), and the periodic reconcile that warm-starts from the prior `entities` table so canonical ids stay stable (only genuine new identities mint new rows). Determinism: process components in `hashId` order, tie-break by mention count, so a delete+rebuild reproduces the same canonical set.

### B.6 Reconciling with the EXISTING graph person/project nodes (don't duplicate)

This is the critical "don't double-mint" requirement. `src/lib/graph/build.ts` already mints authoritative nodes for two of the four buckets:
- **`person:<slug>`** from `people/*.md`, with `attrs.aliases` already parsed (`build.ts:523`, aliases from `people-parser.ts:306-313`) — these are *first-class, file-backed* people.
- **`project:<slug>`** from `projects/*/index.md` (`build.ts:421`), `attrs.slug` set.

Layer B's `person`/`project` entities **must bind to these, not shadow them.** `reconcile.ts` runs as the first step of every resolution pass, before any new entity is minted:

1. Build a **graph-node binding index** once per pass from `getGraphDb()` (read-only): for every `type IN ('person','project')` node, index its `label`, `attrs.slug`, and (for people) `attrs.aliases` → its graph node id. This is the authoritative roster.
2. For each resolved `person`/`project` canonical entity, attempt a bind in priority order: exact `norm(slug)` match → exact `norm(label)`/alias match → embedding-ANN of the entity name against the node labels above `SEMANTIC_BIND_SIM` (default 0.88) **confirmed by one merge-judge call** (so "Anthropic the org" never binds to a person named Anthony). On a confident bind, set `entities.graph_node_id` to the existing node id and set `entities.id = personNodeId(slug)` / `projectNodeId(slug)` — i.e. **the canonical entity adopts the graph node's id**, guaranteeing 1:1 and making the future graph-integration step a no-op (the entity *is* the node; Layer B only adds new `concept`/`source` nodes + `item_entities` edges).
3. A `person`/`project` mention with **no** graph-node match (a person mentioned in a reference but with no `people/*.md` file, a project named but not yet filed) mints an ordinary `entities` row with `graph_node_id = NULL`. These are the candidates that *could* become real person/project files — surfaced later, never auto-written (markdown stays source of truth). When such a file later appears, the incremental reconcile binds the existing entity to the new node (alias add, no new id), so no duplicate is created.
4. **`concept` and `source` entities have no pre-existing graph nodes** — they are Layer B's net-new contribution and mint fresh `entities` rows freely. They become new graph node types only in the later graph-integration phase; this section produces them and their `item_entities` edges, leaving graph wiring to that phase.

Net effect: people and projects are reconciled by *adopting the graph's authoritative ids*; ideas/concepts and tools/sources are introduced cleanly; nothing is double-counted; and because every binding is recorded (`graph_node_id`, `entity_merges`) the whole layer remains delete-and-rebuild reproducible.

### B.7 Versioning, tests, and fail-soft summary

- `SEMANTIC_VERSION` in `version.ts` governs `extract_version`/`resolve_version`; decimals = sample-lane test pass, integers = blessed full backfill — identical to `PIPELINE_VERSION` (`pipeline.ts:1-23`). A bump is recorded in `docs/PIPELINE-VERSIONS.md` (or a sibling `docs/SEMANTIC-VERSIONS.md`) per the established discipline.
- Every Gemini call is gated by `SEMANTIC_DISABLED=1` returning empty, so `npm run test:*` stays offline exactly like `LIBRARY_CONNECTIONS_DISABLED` does for the connection judge. `closeSemanticDbForTests()` rebinds the singleton per the calendar/graph gotcha.
- Failure policy is uniform and matches the Library: missing key, HTTP error, timeout, or unparseable JSON ⇒ that step yields empty/abstain, never throws, never partially corrupts the db (all writes in `db.transaction`). The worst case of a failed extraction is a missing item, fixed by re-running — not a bad merge.

---

## Topic layer — clustering, labeling, hierarchy, lineage

This section designs Layer C from `docs/plans/semantic-layer-phase2-plan.md` §3 — the emergent, hierarchical, evolving topic taxonomy — built on the embeddings already in `chunks(embedding)` and the resolved `entities`. Everything here is a derived cache under `DATA_DIR/semantic.sqlite`; delete + rebuild reproduces it (Critical Constraint #2). It ships in **P2.2** after the CLI/query backbone (P2.0) and entities (P2.1).

### C.0 Stack decision — RECOMMENDATION: (a) Python sidecar via shell-out

**Recommendation: a pinned Python sidecar invoked exactly like `scripts/youtube-transcript.py`.** This is not a new convention — `src/app/api/youtube-transcript/route.ts:23` already does `execFileAsync("python3", [SCRIPT_PATH, input], …)`, and `src/lib/granola/handoff.ts:70` pipes through a remote `python3`. The semantic clustering job is the same shape as the LLM shell-outs in `src/lib/library/connections.ts` (`execFile` → JSON on stdout → tolerant parse → abstain on failure). The clustering math (UMAP + HDBSCAN, or Leiden) is mature, battle-tested, and *exactly* the BERTopic/GraphRAG reference stack the plan cites — there is no production-quality JS equivalent, and re-deriving it in JS is the riskiest part of the whole layer.

Why not (b) pure-JS:
- **HDBSCAN has no credible JS port.** The hierarchical density structure (the condensed tree that gives us free multi-resolution granularity per the "data-driven + hierarchy" decision) is the single most valuable property and is precisely what JS lacks.
- **Leiden in JS means re-adding graphology.** graphology is **not** in the current tree (`grep` of `src/`, `server/`, `scripts/`, and `git log -S` all empty) — the graph layer uses `ngraph.graph` + `ngraph.forcelayout` (`package.json:135-136`), and `ngraph` has **no Leiden/Louvain community detection**. So pure-JS Leiden requires adding `graphology` + `graphology-communities-louvain` (Louvain only; no Leiden, which is the GraphRAG-blessed algorithm) plus hand-rolling the kNN cosine graph and multi-resolution sweep. That is more new surface than a sidecar, with worse algorithms.
- UMAP does have `umap-js`, but without HDBSCAN downstream it buys little.

Why not (c) hybrid: a hybrid (JS kNN-graph + JS Louvain for incremental, Python for global) doubles the code paths for the *same* taxonomy and invites the two engines to disagree. Keep one source of truth for cluster shape: the sidecar. JS does the cheap, deterministic part it's already good at — **incremental nearest-topic assignment** (C.4) is pure cosine-in-SQL, no clustering, no Python.

**Sidecar contract** (`scripts/semantic-cluster.py`, mirroring `youtube-transcript.py`):
- Invocation: `uv run --python 3.12 scripts/semantic-cluster.py` (pinned via an inline `# /// script` PEP-723 block declaring `numpy`, `umap-learn`, `hdbscan`, `scikit-learn`; `uv` resolves a locked env per run — no global pip pollution, reproducible, and consistent with the "pinned script" half of option (a)). Fall back to `SEMANTIC_PYTHON_BIN` / `SEMANTIC_CLUSTER_BIN` overrides (mirror `SUMMARIZE_BIN` in `digestion.ts:25` and `CLAUDE_PATH` in `connections.ts:33`).
- **stdin**: JSON `{ vectors: number[][], ids: string[], params: {...}, warm_start?: {...} }`. Vectors are the 1536-dim Matryoshka embeddings read from `chunks`/`entities` by the TS caller (Python never opens SQLite — keeps the DB singleton and schema ownership entirely in TS, per `src/lib/graph/db.ts`).
- **stdout**: JSON `{ assignments: [{id, leaf_cluster, probability}], hierarchy: [{cluster_id, parent_id, level, member_ids[], centroid[], size}], outliers: string[], params_used: {...} }`. The TS side does a tolerant `JSON.parse` with an abstain-on-anything-unparseable fallback, identical to `parseConnectionJudgment` in `connection-prompt.ts:138`.
- **Determinism**: pass a fixed `random_state`/`umap` seed in `params`; record it in the run row so a re-fit is reproducible (the layout engine's determinism discipline, `src/lib/graph/layout.ts:14-19`).
- **Degrades gracefully**: ENOENT on `uv`/`python3` → warn once with install guidance and skip the global re-fit (incremental assignment still works), exactly like the missing-`summarize` path in `digestion.ts:30-38`.

If true zero-dependency operation is ever required, the JS Louvain path is a documented fallback, but it ships as a degraded mode, not the default.

### C.1 Pipeline shape — embed → reduce → cluster → label → reduce

The TS orchestrator (`src/lib/semantic/topics.ts`) runs the GraphRAG-spine/BERTopic-body pipeline:

1. **Gather** — read all `chunks.embedding` (+ `entities.embedding` for entity-anchored topics) at the current `SEMANTIC_VERSION`. Item-level topic membership rolls up from chunk membership (a note in topic T if any of its chunks land in T; salience = max chunk probability).
2. **Sidecar cluster** — ship vectors → `semantic-cluster.py` → UMAP(→~10-d) → HDBSCAN with `cluster_selection_method="leaf"` to get the full condensed-tree hierarchy, not just the flat top cut. The condensed tree *is* the broad→specific hierarchy (the "data-driven + hierarchy" decision needs no separate resolution sweep — HDBSCAN gives it natively). Outliers (label `-1`) are not forced into a topic; they're recorded and become incremental-assignment candidates later.
3. **LLM label + reduce** (C.2) — Gemini Pro / Claude CLI names each cluster, writes a GraphRAG-style community summary, and proposes merges of near-duplicate siblings.
4. **Persist + lineage** — write `topics`, `item_topics`, `entity_topics`, and diff against the prior version to record `topic_lineage` (C.5).

This runs as a **launchd-scheduled CLI** (`npm run semantic:refit`, a new `LibrarySchedulerJobDefinition`-shaped job added to `src/lib/library/scheduler-jobs.ts` or a sibling `semantic-scheduler-jobs.ts`), not in `GraphRunner` — it's heavy and low-frequency, matching the "heavy/periodic jobs run as launchd-scheduled CLI invocations" convention. For corpora in the low thousands the whole pass is seconds of compute + a handful of labeling calls; resumability via the chunked main-loop (`layout.ts:292` `runSteps`) is only needed if the labeling fan-out grows large (then chunk the per-cluster label calls with `setImmediate` yields).

### C.2 LLM labeling + topic reduction/merge

**Labeling is the lower-frequency global pass** → stronger model (Gemini Pro or Claude CLI), per the locked decision and plan §7. Reuse the `connections.ts` plumbing verbatim: `execFile` the Claude CLI with `--append-system-prompt-file` + `--output-format json`, tolerant JSON extraction (`extractFirstJsonObject` in `connection-prompt.ts:98`), abstain on failure. A new prompt module `src/lib/semantic/topic-label-prompt.ts` mirrors `connection-prompt.ts` (exported `TOPIC_LABEL_PROMPT` string + a `parseTopicLabels` normalizer), and the prompt text is version-stamped under `SEMANTIC_VERSION`.

**Per-cluster input** (GraphRAG community-summary style — give the LLM the cluster's *content*, not just keywords): top-N items by centrality-to-centroid (titles + one-line summaries from `chunks`/digests), the cluster's most-salient entities (from `entity_topics`), and the parent topic's label for hierarchical context. **Per-cluster output**: `{ label, summary (2-4 sentences), aliases[] }` — same author-it-as-if-asked, practitioner-voice framing as `CONNECTION_PROMPT` (`connection-prompt.ts:3-15`).

**Reduction/merge** is a *second, batched* call over the freshly-labeled sibling set (the LLM-assisted topic reduction the plan cites, arXiv 2509.19365): present labels + summaries of all siblings under a parent and ask for merge groups with a one-line justification each — the same "name a SPECIFIC pair and state the relationship in one honest sentence, else don't merge" discipline that makes `CONNECTION_PROMPT` conservative. Merge candidates are also **pre-gated by cosine** (centroid similarity ≥ `SEMANTIC_MERGE_COS`, default ~0.85) so the LLM only ever sees plausible pairs — cuts cost and false merges. No manual split/rename rules ever (plan §1: observe, don't curate); if light steering is wanted later it's an advisory seed string appended to the prompt, never a hard rule.

Merge prompt output is a list of `{ merge: [clusterA, clusterB, …], into_label, why }`; anything unjustified is dropped (mirrors `normalizeConnections` discarding relationship-less ties, `connection-prompt.ts:43-60`).

### C.3 Hierarchy (broad → specific), stored

`topics(id, parent_id, label, summary, level, kind, centroid BLOB, version, created_at)` — the `parent_id` self-reference is the hierarchy; `level` is the condensed-tree depth (0 = root themes, increasing = more specific). This is the same parent/child idea as `graph_nodes`/`node_positions` self-reference patterns but for a tree. Querying any depth is a recursive CTE over `parent_id` (SQLite supports `WITH RECURSIVE`), so the **first query to nail — topic exploration** — is:

- *"What themes am I working on?"* → `SELECT … FROM topics WHERE level <= :depth AND version = :current ORDER BY size DESC`.
- *"recent / trending"* → join `item_topics` to item mtime/ingest-date (available from the source file or Library ingest timestamp) and rank topics by recent-item count or velocity (Δ items in last 14d). No new model work — pure SQL over the membership table.
- *"drill into topic T"* → its children (`parent_id = T`) plus its direct items (`item_topics WHERE topic = T ORDER BY salience`).

All sub-ms, indexed (`idx_topics_parent`, `idx_topics_version`, `idx_item_topics_topic`), served over the existing `/navigate`-style CLI channel — no new serving infra. Topics and entities later become `graph_nodes` (type `topic`/`entity`) with `item↔topic` and entity-co-occurrence `graph_edges` (P2.3), reusing `upsertNodes`/`upsertEdges` (`src/lib/graph/db.ts:169,257`) so the System → Graph view renders the cross-topic through-lines.

### C.4 Incremental assignment of new items (no re-cluster)

On ingest, a new item is embedded (Layer A) and assigned to **nearest existing leaf topics by cosine to topic centroids** — pure SQL/TS, no Python, runnable inside the `GraphRunner` incremental path (`src/lib/graph/runner.ts`) or the Library ingest hook:

- Compute cosine(item_chunk_embedding, topic.centroid) for all leaf topics; assign to the top-k above `SEMANTIC_ASSIGN_COS` (default ~0.55). Write `item_topics(item, topic, score, assigned_by='incremental', version)`.
- If nothing clears the floor → record the item as a **topic outlier** (`item_topics` row with `topic = NULL` / a sentinel "unassigned" bucket). Outliers are the seed signal that a *new* theme may be forming — they get pulled into a real topic at the next global re-fit (C.5). This is the standard online-topic shape and avoids the over-proliferation the plan warns about (§4, arXiv 2504.07711): incremental **never creates a topic**, it only slots into existing ones or defers.

Centroids are cached on the `topics` row (written by the sidecar in C.1) so incremental assignment needs no vector other than the item's own.

### C.5 BALANCED warm-started periodic re-fit + topic_lineage

The locked "balanced" evolution: topics move on **real signal**, warm-started so the taxonomy doesn't churn wildly, with `topic_lineage` recording every split/merge so old items re-home and through-lines surface retroactively.

**Warm start** — the analog of `seedPositions`/`warmStartDecision` in `layout.ts:183,509`. The sidecar receives the **prior version's centroids** in `warm_start` and:
- Seeds HDBSCAN-adjacent stability by aligning new leaf clusters to prior topics via **centroid cosine (Hungarian / greedy match ≥ `SEMANTIC_LINEAGE_COS`, default ~0.7)**. A new cluster whose centroid matches an existing topic *inherits that topic's id* — so a topic that barely moved keeps its identity and items don't thrash (the "topics move only on real signal" requirement). Only genuinely new structure gets new ids.

**Lineage detection** (computed in TS after the sidecar returns, by comparing prior `item_topics` membership against new assignments — pure set math, no model):
- **stable**: prior topic T → exactly one matched new cluster, ≥X% member overlap → keep id, update centroid/label. No lineage row (or an `op='carry'` row for audit).
- **split**: prior topic T's members land in ≥2 new clusters above a size floor → emit `topic_lineage(old_topic=T, new_topic=C1, op='split')`, `(T, C2, 'split')`, …. New child ids; T marked superseded.
- **merge**: ≥2 prior topics' members collapse into one new cluster → `topic_lineage(old_topic=T1, new_topic=M, op='merge')`, `(T2, M, 'merge')`. (The LLM merge step in C.2 produces the *label*; lineage records the *membership* fact.)
- **birth**: a new cluster dominated by former outliers/new items, no prior match → `op='birth'`, no `old_topic`. This is the "a new area explodes" case.
- **death**: a prior topic with no surviving matched cluster → `op='death'`, no `new_topic`.

`topic_lineage(old_topic, new_topic, op, overlap, version, created_at)` — `op ∈ {carry,split,merge,birth,death}`. Because membership is recomputed over the **whole corpus** each re-fit, an old note written months ago is freely re-homed under a topic that only emerged recently — that's the "step back and see the through-lines" outcome. The lineage chain lets the future Topics view render a topic's history ("Agent architecture split out of Tooling in v3") and lets a query walk `topic_lineage` to show "everything that ever belonged to this lineage" across renames.

**Cadence**: a launchd job (default nightly via the `{hour, minute}` schedule shape in `scheduler-jobs.ts:35`), but **signal-gated** so it's truly balanced — the job no-ops unless drift exceeds a threshold (e.g. ≥ `SEMANTIC_REFIT_MIN_NEW` new/outlier items since the last re-fit, or a `SEMANTIC_VERSION` bump). This mirrors `warmStartDecision` returning `needsLayout:false` when nothing changed (`layout.ts:517`): cheap to schedule often, only does the expensive work when the corpus actually moved. Exact interval is the one open item the plan defers (§ Decisions note); the gate makes the interval choice low-stakes.

### C.6 Versioning, config, storage

- **`SEMANTIC_VERSION`** in `src/lib/semantic/pipeline.ts`, exactly mirroring `PIPELINE_VERSION` in `src/lib/library/pipeline.ts:23` and its decimal=test / integer=published-at-scale rule, with the matching `docs/PIPELINE-VERSIONS.md` entry + review-note discipline (`pipeline.ts:1-21`). The version stamps embedding model + extraction prompt + **cluster params + label/merge prompt** together — a re-fit at a new version is a backfill, not a migration. Prior-version `topics`/`item_topics` rows survive until the new version is blessed, then swapped (same as the Library decimal→integer promotion).
- **Config** (`.env.example`, `SEMANTIC_*` mirroring `LIBRARY_*`/`HILT_GRAPH_*` at `.env.example:48-121`): `GEMINI_API_KEY`, `SEMANTIC_PYTHON_BIN`, `SEMANTIC_CLUSTER_BIN`, `SEMANTIC_LABEL_MODEL`, `SEMANTIC_LABEL_DISABLED` (offline tests, like `LIBRARY_CONNECTIONS_DISABLED=1`), `SEMANTIC_ASSIGN_COS`, `SEMANTIC_MERGE_COS`, `SEMANTIC_LINEAGE_COS`, `SEMANTIC_REFIT_MIN_NEW`, `SEMANTIC_REFIT_TIMEOUT_MS`, `SEMANTIC_CLUSTER_SEED`.
- **Tables** (in `DATA_DIR/semantic.sqlite` via the `getSemanticDb()` singleton + `ensureSemanticSchema()` + `closeSemanticDbForTests()` — copy `src/lib/graph/db.ts:64-135` verbatim, WAL + `synchronous=NORMAL`, `IF NOT EXISTS`):
  - `topics(id, parent_id, label, summary, level, kind, centroid BLOB, size, version, created_at)` + `idx_topics_parent`, `idx_topics_version`.
  - `item_topics(item, topic, score, salience, assigned_by, version)` + `idx_item_topics_topic`, `idx_item_topics_item`.
  - `entity_topics(entity, topic, weight, version)`.
  - `topic_lineage(old_topic, new_topic, op, overlap, version, created_at)` + `idx_lineage_old`, `idx_lineage_new`.
  - a `semantic_meta` key/value store (built_at, last_refit_version, last_error) — copy `graph_meta` + `setMeta`/`getMeta` (`db.ts:353-370`) for the same self-healing `/meta` surface the layout engine uses.

### Files to create
- `scripts/semantic-cluster.py` — UMAP+HDBSCAN sidecar (PEP-723 `uv` script; stdin/stdout JSON; modeled on `scripts/youtube-transcript.py`).
- `src/lib/semantic/db.ts` — `semantic.sqlite` singleton + schema (copy of `src/lib/graph/db.ts` conventions).
- `src/lib/semantic/topics.ts` — orchestrator: gather → sidecar → label/merge → persist → lineage diff.
- `src/lib/semantic/cluster.ts` — TS wrapper that `execFile`s the Python sidecar (modeled on `runClaude` in `src/lib/library/connections.ts:42`).
- `src/lib/semantic/assign.ts` — incremental nearest-topic cosine assignment (pure TS).
- `src/lib/semantic/lineage.ts` — split/merge/birth/death detection from membership diff.
- `src/lib/semantic/topic-label-prompt.ts` — `TOPIC_LABEL_PROMPT` + `parseTopicLabels` (modeled on `src/lib/library/connection-prompt.ts`).
- `src/lib/semantic/pipeline.ts` — `SEMANTIC_VERSION` (modeled on `src/lib/library/pipeline.ts`).
- New launchd job in `src/lib/library/scheduler-jobs.ts` (or `semantic-scheduler-jobs.ts`) + `semantic:refit` npm script (modeled on `library:ingest:hourly`).

### Key risks
- **`uv`/Python availability on the daily-driver Electron app** — the YouTube transcript route already assumes `python3` on PATH, so there's precedent, but the global re-fit must degrade to "incremental-only, no taxonomy evolution" (warn once) when the sidecar is missing, never crash ingest. This is the same posture as the missing-`summarize` CLI in `digestion.ts:30`.
- **Determinism across machines** — UMAP is stochastic; pin `SEMANTIC_CLUSTER_SEED` and accept epsilon-tolerant reproducibility (the same stance `layout.ts:14-19` takes for the force layout), asserting topological/lineage stability rather than byte-identical clusters in tests.

---

## CLI / Query Surface (ship first)

This is the headless backbone for the semantic layer: a single `tsx` CLI entrypoint plus a thin, pure query module over `DATA_DIR/semantic.sqlite`. Everything downstream — the later graph integration, a Topics view, auto-generated topic pages — reads the *same* query functions. The CLI is the first consumer and the contract test for that layer.

### 1. Where this sits in the repo

| Concern | File | Mirrors |
|---|---|---|
| DB + schema + singleton | `src/lib/semantic/db.ts` | `src/lib/graph/db.ts`, `src/lib/calendar/db.ts` |
| Env/flags/paths | `src/lib/semantic/config.ts` | `src/lib/graph/config.ts` |
| Pure query functions (the layer everything reads) | `src/lib/semantic/query.ts` | new — but called by CLI, routes, runner alike |
| Version constant + history | `src/lib/semantic/version.ts` (`SEMANTIC_VERSION`) + `docs/SEMANTIC-VERSIONS.md` | `src/lib/library/pipeline.ts` + `docs/PIPELINE-VERSIONS.md` |
| CLI entrypoint (subcommand dispatch) | `scripts/semantic.ts` | `scripts/library-ingest.ts` (subcommand style), `scripts/library-reweave.ts` (`argValue`/`argValues`/`--json`) |
| HTTP routes (later, read-only over `query.ts`) | `src/app/api/system/semantic/{topics,topic/[id],related,entity/[name]}/route.ts` | `src/app/api/system/graph/*/route.ts` |

Decision: **CLI ships in Phase 2.0 reading the same `query.ts`** the routes will later import. No logic lives in the CLI itself — it is an arg parser + a `query.ts` call + a formatter. This is the load-bearing choice: the graph/UI integration in P2.3 is then "add a route that calls the function the CLI already proved out," not a reimplementation.

### 2. DB shape the query layer reads (only the columns the queries touch)

Following `src/lib/graph/db.ts` conventions exactly — `better-sqlite3`, `journal_mode=WAL`, `synchronous=NORMAL`, process singleton keyed on resolved path (`getSemanticDb()`/`closeSemanticDbForTests()`), `CREATE TABLE IF NOT EXISTS`, pragmas first, every column version-stamped, lives at `DATA_DIR/semantic.sqlite` (live app: `/Users/jruck/.hilt/data/semantic.sqlite`). Vectors via the `sqlite-vec` extension (`db.loadExtension(...)` right after the pragmas in `ensureSemanticSchema`), so KNN is in-file.

Tables the *query surface* depends on (write side is the ingest/cluster section's concern):
- `items(path, kind, title, last_seen_at, version)` — one row per included unit (vault note / saved Library ref).
- `item_vec` — `sqlite-vec` virtual table `vec0(item_rowid INTEGER PRIMARY KEY, embedding float[1536])` (1536-dim Matryoshka per locked decision).
- `topics(id, parent_id, label, summary, level, item_count, centroid_rowid, version, updated_at)` — hierarchical; `parent_id` NULL at the root level.
- `item_topics(item_path, topic_id, score)` — soft membership; indexed `(topic_id, score DESC)` and `(item_path)`.
- `entities(id, type, canonical_name, summary, version)` + `entity_aliases(entity_id, alias)`.
- `item_entities(item_path, entity_id, salience)` — indexed `(entity_id)` and `(item_path)`.
- `topic_lineage(old_topic, new_topic, op, version, at)` — for "trending/recent" and lineage drill-down.
- `semantic_meta(key, value)` — `built_at`, `version`, `last_refit_at`, `embedding_model`, `dim` (same k/v pattern as `graph_meta`).

**Recency/trending** is computed from `items.last_seen_at` (note mtime / ref `captured` date) joined through `item_topics` — no separate table needed. Index `idx_item_topics_topic_score` + `idx_items_last_seen` make "top topics by recent activity" a single indexed aggregate, sub-ms at the locked scale (low thousands of items).

### 3. The pure query module — `src/lib/semantic/query.ts`

These are the functions the CLI, the HTTP routes, and the future graph builder all call. Every one takes an optional `db = getSemanticDb()` (the graph-db dependency-injection convention, so tests pass a temp db) and returns plain typed objects — never formats output.

```ts
// All sub-ms at locked scale; each query is backed by an index named below it.
listTopics(opts: { level?: number; parentId?: string; limit?: number }): TopicSummary[]
// → topics WHERE (level=? | parent_id=?) ORDER BY item_count DESC. idx_topics_parent, idx_topics_level

recentTopics(opts: { sinceDays?: number; limit?: number }): TopicActivity[]
// → JOIN item_topics→items, COUNT/MAX(last_seen_at) WHERE last_seen_at >= cutoff,
//   GROUP BY topic_id ORDER BY recent_count DESC, includes trend delta vs prior window. idx_item_topics_topic_score + idx_items_last_seen

getTopic(id: string): { topic: Topic; children: TopicSummary[]; topItems: ItemRef[]; topEntities: EntityRef[]; lineage: LineageEntry[] } | null
// → topics by id + children (parent_id=id) + top item_topics by score + top item_entities + topic_lineage

relatedToItem(path: string, opts: { limit?: number }): { item: ItemRef; neighbors: ScoredItem[] }
// → sqlite-vec KNN: SELECT item_rowid, distance FROM item_vec WHERE embedding MATCH ? ORDER BY distance LIMIT k+1 (drop self)

entityByName(name: string): { entity: Entity; aliases: string[]; items: ItemRef[]; coOccurring: ScoredEntity[] } | null
// → entities/entity_aliases match (exact→alias→trigram fallback); item_entities; co-occurrence via self-join on item_entities

itemTopics(path: string): ScoredTopic[]   // "what is this note about" — item_topics by item_path, score DESC
```

`relatedToItem` resolves the anchor's vector by `path → item rowid → item_vec` and runs the `sqlite-vec` `MATCH` KNN; co-occurrence (`coOccurring`) is the indexed self-join `item_entities a JOIN item_entities b ON a.item_path=b.item_path WHERE a.entity_id=? AND b.entity_id<>? GROUP BY b.entity_id ORDER BY COUNT(*) DESC`. No table scans, no impromptu grep — exactly the "navigate/query it fast" surface the plan §6 calls for.

### 4. The CLI — `scripts/semantic.ts`

Single entrypoint, subcommand dispatch like `scripts/library-ingest.ts`; arg parsing copied from `scripts/library-reweave.ts` (`argValue`, `--json`, `--limit`). It calls `loadEnvConfig(process.cwd())` so `DATA_DIR`/`SEMANTIC_*` resolve identically to the Library scripts. Wired into `package.json` under the existing `tsx`/`DATA_DIR` idiom used by `granola:*` (which already prefix `DATA_DIR=${DATA_DIR:-$HOME/.hilt/data}`):

```jsonc
"semantic":          "DATA_DIR=${DATA_DIR:-$HOME/.hilt/data} tsx scripts/semantic.ts",
"semantic:topics":   "DATA_DIR=${DATA_DIR:-$HOME/.hilt/data} tsx scripts/semantic.ts topics",
"test:semantic":     "tsx --test src/lib/semantic/**/*.test.ts"
```

Day-to-day you invoke subcommands directly: `tsx scripts/semantic.ts topics --recent`. The npm aliases mirror `library:ingest:*` so launchd jobs (next section) reference a stable script name.

**Commands** (every command supports `--json`; human output is the default and is what a person reads in a terminal). All are read-only — the CLI never re-clusters or writes the vault; that is the scheduled batch job's role. If `semantic.sqlite` is absent or `built_at` is unset, every command prints one line: `semantic layer not built — run \`npm run semantic:backfill\`` (or `{"error":"not_built"}` under `--json`) and exits non-zero, mirroring how `route.ts` 404s when `isGraphEnabled()` is false.

- **`topics [--level N] [--parent <id>] [--limit N]`** — the taxonomy at a depth. `--parent <id>` drills into a subtree (data-driven hierarchy decision). → `listTopics`.
- **`topics --recent [--since 30d] [--limit N]`** — *the first query to nail.* "What themes am I working on / thinking about, including trending." → `recentTopics`. Trend arrow from the prior-window delta.
- **`topic <id> [--items N] [--depth N]`** — drill into one: summary, child topics, top items (with paths), top entities, lineage. → `getTopic`. Each listed item line is a real vault/ref path, so it pipes straight into `--navigate` (below).
- **`related <path> [--limit N]`** — vector KNN neighbors of a note/ref (serendipity). → `relatedToItem`.
- **`entity <name> [--limit N]`** — items mentioning an entity + co-occurring entities. → `entityByName`.
- **`item <path>`** — "what is this about": the item's topics + entities. → `itemTopics` + `item_entities`.
- **`status`** — `semantic_meta` dump (version, built_at, last_refit_at, model, dim, counts). Mirrors `graph meta`.

### 5. Integration with the existing `/navigate` channel

The `/navigate` POST in `server/ws-server.ts` (lines 124-157) takes `{view, path}`, broadcasts to renderers, and writes `~/.hilt-pending-navigate.json` for Electron IPC. **Two integration points, no protocol change:**

1. **CLI → navigate passthrough.** Add a `--navigate` flag to `topic`/`related`/`entity`/`item`. When the result has a primary path, the CLI reads the port from `~/.hilt-ws-port` (the documented discovery file) and POSTs `{view:"docs", path:<absolute>}` — exactly the snippet in `CLAUDE.md` / the `hilt` skill. This makes "explore a topic, then open its top item in Hilt" a one-liner from any agent or terminal, today, with zero UI work. Items already carry absolute paths, and `docs` view takes absolute file paths.
2. **`validViews` stays as-is for v1.** The navigate allowlist (`["bridge","docs","stack","briefings","calendar","people","system"]`) does **not** need a `"semantic"`/`"topics"` view yet — topic pages are deferred per the ship order. When P2.3 adds a Topics view, the only change is appending one string to that array and adding a renderer handler; the CLI's `--navigate` already speaks the same wire format.

### 6. How the later UI / graph read the same layer

The HTTP routes added in P2.3 are thin wrappers — each route is `isSemanticEnabled()` guard → call the identical `query.ts` function → `NextResponse.json(...)`, structurally identical to `src/app/api/system/graph/route.ts` (the `dynamic="force-dynamic"`, `runtime="nodejs"`, feature-flag-404 pattern). `GET /api/system/semantic/topics?recent=1` is `recentTopics()`; `GET /api/system/semantic/topic/[id]` is `getTopic()`; `GET /api/system/semantic/related?path=` is `relatedToItem()`. A Topics view fetches those; SWR caches them like the rest of the app.

For **graph integration**, the builder in `src/lib/graph/build.ts` reads `listTopics()` + `item_topics` + `item_entities` to emit `topic`/`entity` graph nodes and `item↔topic` / co-occurrence / KNN-similarity edges into `graph_nodes`/`graph_edges` — it consumes `query.ts`, it does not re-query SQLite directly. So the CLI is not a throwaway: it is the reference implementation of the read contract that the routes and the graph builder both bind to.

**Feature flag + env** (mirroring `src/lib/graph/config.ts` and the `LIBRARY_*` style in `.env.example`), added to `.env.example` near the graph block:
```
# HILT_SEMANTIC_ENABLED=false            # gates routes + the GraphRunner-style refit loop
# HILT_SEMANTIC_DB_PATH=                 # default: $DATA_DIR/semantic.sqlite
# GEMINI_API_KEY=                        # embeddings + Flash extraction
# SEMANTIC_EMBED_MODEL=gemini-embedding-001
# SEMANTIC_EMBED_DIM=1536                # Matryoshka truncation
# SEMANTIC_RELATED_LIMIT=10
# SEMANTIC_RECENT_WINDOW_DAYS=30
```
The CLI's read path needs none of the Gemini vars (it only reads `semantic.sqlite`); they belong to the ingest/cluster side. Per the locked decision, Gemini is a **new dependency** — recommend a thin API client (`src/lib/semantic/gemini.ts`) rather than a CLI shell-out, since the embedding endpoint is a plain REST call with no headless-CLI equivalent and the existing `execFile` shell-out pattern (`connections.ts`, `digestion.ts`) buys nothing here. That client is invisible to the query surface, which is the point of this section's split.

### 7. Example output

`tsx scripts/semantic.ts topics --recent --since 30d --limit 5`
```
THEME                                 ITEMS  30d  TREND   ID
Agent architecture & context          142    18   ▲ +7    t.agent-arch
  └ context windows / compaction       38     9   ▲ +5    t.agent-arch.context
Reference library & knowledge tools    96     11   ▲ +3    t.kb-tools
Defensibility / moats                  54      6   ▬ ±0    t.moats
Local-first / file-native systems      71      4   ▼ −2    t.local-first
Calendar & scheduling                  29      2   ▼ −1    t.calendar

5 of 38 topics · last refit 2026-05-28 · drill in: semantic topic <ID>
```

`tsx scripts/semantic.ts topic t.agent-arch.context --items 4`
```
context windows / compaction   (t.agent-arch.context, level 2)
parent: Agent architecture & context (t.agent-arch)

Summary: Recurring through-line on managing finite model context — compaction,
retrieval gating, and when to summarize vs. drop. Spans your own notes and
saved reading.

Top items:
  0.91  thoughts/context-rot-and-compaction.md
  0.88  references/2026/anthropic-context-engineering.md
  0.84  meetings/2026-05-22-agent-platform-sync.md
  0.79  projects/hilt/docs/plans/semantic-layer-phase2-plan.md

Top entities:  Anthropic (org) · compaction (idea) · GraphRAG (idea) · BERTopic (tool)
Lineage:  merged from t.agent-arch.memory (2026-05-12)

Open in Hilt:  semantic topic t.agent-arch.context --navigate
```

`tsx scripts/semantic.ts topics --recent --json` (shape consumed unchanged by the future route + Topics view)
```json
{"version":"v0.3","built_at":"2026-05-28T04:12:09Z","window_days":30,
 "topics":[{"id":"t.agent-arch","label":"Agent architecture & context","level":1,
   "item_count":142,"recent_count":18,"trend":7,"parent_id":null}]}
```

`tsx scripts/semantic.ts related references/2026/anthropic-context-engineering.md --json`
```json
{"item":{"path":"references/2026/anthropic-context-engineering.md","title":"Context Engineering"},
 "neighbors":[{"path":"thoughts/context-rot-and-compaction.md","score":0.93},
   {"path":"meetings/2026-05-22-agent-platform-sync.md","score":0.81}]}
```

### 8. Versioning hook the CLI surfaces

`status` and every `--json` payload include `version` from `semantic_meta` (the `SEMANTIC_VERSION` from `src/lib/semantic/version.ts`, decimals = sample-lane test, integers = blessed full backfill — the `PIPELINE_VERSION` precedent in `src/lib/library/pipeline.ts`). This lets a caller detect "queried against a stale/test build" without a second call, and lets the backfill job (a launchd CLI invocation registered in a `librarySchedulerJobs`-style array, e.g. `scripts/semantic-scheduler.ts` modeled on `src/lib/library/scheduler-jobs.ts`) bless a version by writing `semantic_meta.version` — at which point the CLI immediately reads the new taxonomy with no restart, since `getSemanticDb()` is a live singleton over the same file.

---

## Graph Integration (ship second)

> Build target: layer topics + entities onto the existing System -> Graph (`src/lib/graph/*`, `src/components/graph/*`) **without forking the renderer, the wire format, or the layout engine**. Everything here is flag-gated behind a new predicate and is a pure derived view: deleting `graph.sqlite` + `semantic.sqlite` and rebuilding reproduces it (Critical Constraint #2). This is where the serendipitous through-lines that wikilinks + manual connections structurally cannot produce finally render.

### 0. Decision summary (what to build)

1. **One graph DB, augmented in place.** Add `topic` + `entity` node types and three new edge kinds to the *existing* `graph_nodes` / `graph_edges` tables in `DATA_DIR/graph.sqlite` — **not** a parallel overlay table. The semantic rows are written by a new `src/lib/graph/semantic-overlay.ts` producer that reads `semantic.sqlite` and upserts into `graph.sqlite` using the same `upsertNodes`/`upsertEdges` API. Rationale below (§2).
2. **The graph build pulls semantic in; the graph never queries `semantic.sqlite` at request time.** The hot read path (`route.ts`, `selectGlobalGraph`, `selectLocalGraph`, `encodeFromParts`) stays a single-DB read against `graph.sqlite`. `semantic.sqlite` is only touched by the overlay producer, which runs as a build/reconcile step (§5).
3. **Flag-gated, additive, reversible.** A new `graphSemanticOverlayEnabled()` predicate (env `HILT_GRAPH_SEMANTIC=true`) gates whether the overlay producer runs and whether semantic rows are *selected*. With it off, `buildSemanticOverlay()` is never called and `removeSemanticOverlay()` strips every `topic`/`entity`/semantic-edge row — identical lifecycle to `buildTagLayer()` / `removeTagLayer()` (`src/lib/graph/build.ts:1001-1075`).

---

### 1. New node + edge types

Extend the unions in `src/lib/graph/types.ts:15-31`:

```typescript
export type GraphNodeType =
  | "note" | "reference" | "candidate" | "person" | "project"
  | "north_star" | "library_cluster" | "tag"
  | "topic"    // NEW — emergent cluster (semantic.sqlite `topics`)
  | "entity";  // NEW — resolved entity (semantic.sqlite `entities`)

export type GraphEdgeKind =
  | "wikilink" | "connection" | "connected_project" | "meeting" | "tag"
  | "item_topic"    // NEW — item belongs to topic (item_topics.score)
  | "topic_parent"  // NEW — topic hierarchy (topics.parent_id), directed child->parent
  | "item_entity"   // NEW — item mentions entity (item_entities.salience)
  | "co_occurrence" // NEW — entity<->entity co-mention OR item<->item embedding similarity
  | "similar";      // NEW — item<->item KNN similarity (kept distinct from co_occurrence)
```

**Append-only ordinal contract.** `NODE_TYPE_ORDER` in `src/lib/graph/encode.ts:60-69` is "append ONLY (never reorder)". Append `"topic"` (ordinal 8) and `"entity"` (ordinal 9) to the end. This is back-compatible under the existing `TRANSPORT_FORMAT_VERSION` (no bump needed — the client already maps unknown ordinals to fallback color/type). The `north_star` size-floor in `src/components/graph/graph-style.ts:131-135` is keyed on ordinal `=== 5`; topics need their own emphasis — see §4.

**Node ID scheme** (extend `src/lib/graph/build.ts:246-267`, mirroring the existing `note:`/`ref:` hashed-path scheme):

```typescript
export function topicNodeId(topicId: string): string  { return `topic:${topicId}`; }   // semantic.sqlite topics.id
export function entityNodeId(entityId: string): string { return `entity:${entityId}`; } // semantic.sqlite entities.id (post-resolution canonical id)
```

These are **stable across re-fits only as much as `semantic.sqlite` keeps the id stable**. Because topic re-fit churns ids (BERTopic re-cluster), the overlay producer must map *current* `topics.id` -> node id and rely on `topic_lineage(old_topic, new_topic, op, version)` so `node_positions` warm-start can inherit a moved topic's coordinates (§5, "lineage-aware warm start"). Entity ids are stable post-resolution, so entity nodes warm-start cleanly.

---

### 2. Overlay rows in `graph_nodes`/`graph_edges` (not a parallel table) — and why

The existing schema (`src/lib/graph/db.ts:88-116`) already carries everything semantic rows need: `attrs_json` for scores/salience/summary, `source_file` for incremental delete-by-key, `degree` for LOD sizing. A parallel overlay table would force the encoder (`encodeFromParts`), the selection SQL (`selectGlobalGraph`/`selectLocalGraph`), `contractMeetings`, degree recompute, and the inspector neighbor-join (`getNodesByIds`, `getEdgesForNode`) to all UNION two tables. That is a large, invasive, error-prone change to the *durable* read path for zero benefit — the tag layer already proved the in-table additive pattern works (a whole node/edge type living in the same tables, filtered by `type`/`kind`, gated by a flag).

**`source_file` convention for semantic rows.** Vault-derived nodes set `source_file` to an abs vault path so `deleteNodesBySourceFile` works on file change. Semantic rows have no single owning vault file, so use a **synthetic source-file sentinel** exactly like the tag layer uses `sourceFile: null` and clears by `type`. Concretely:

- `topic` / `entity` nodes: `source_file = null`; cleared wholesale by `type IN ('topic','entity')` in `removeSemanticOverlay()`.
- `item_topic` / `item_entity` edges: set `source_file` to the **owning item's abs path**. This is the key correctness win — when `updateGraphForFile(absPath)` re-extracts a note (`build.ts:829`), its existing `deleteEdgesBySourceFile(absPath)` *already* wipes that file's semantic edges too, so a re-digested note's stale topic/entity links never linger. The overlay producer re-creates them from `semantic.sqlite` on the next overlay pass.
- `co_occurrence` / `similar` / `topic_parent` edges: `source_file = null`; cleared by `kind` in `removeSemanticOverlay()`.

**Endpoint resolution — the hard part.** A semantic edge's item endpoint comes from `semantic.sqlite` as an `item_path` (abs vault path) or a Library ref path. The overlay producer must map that to the *graph* node id using the **same** `nodeIdForResolvedPath(absPath, root)` helper already in `build.ts:322-335` (people -> `person:slug`, references -> `ref:hash`, project index -> `project:slug`, else `note:hash`). Export it (it's currently module-private) and reuse it — do **not** reimplement the mapping. If the mapped node id is absent from `graph_nodes` (item outside `INCLUDED_DIRS`, e.g. a `libraries/` ref that semantic indexed but the graph excludes), **drop the edge** — `deleteDanglingEdges()` (`db.ts:269`) is the backstop, and the overlay producer should pre-filter against a `SELECT id FROM graph_nodes` set so it never mints dangling-by-construction edges.

**`attrs_json` payloads** (consumed by the inspector + label/size logic):

| Node/edge | attrs |
|-----------|-------|
| `topic` node | `{ topicId, level, parentId, memberCount, summary, trending: boolean, recentCount }` |
| `entity` node | `{ entityId, entityType: "person"\|"author"\|"channel"\|"project"\|"task"\|"idea"\|"tool"\|"org", aliases[], salienceTotal }` |
| `item_topic` edge | `{ score }` -> `weight = score` |
| `item_entity` edge | `{ salience }` -> `weight = salience` |
| `topic_parent` edge | `{ }` -> `weight = 2` (structural, keep tight in layout) |
| `co_occurrence` / `similar` edge | `{ cosine }` -> `weight = cosine` (thresholded, §3) |

---

### 3. Edge construction policy (where the through-lines come from)

Three families, each with a hard cap so the global hairball stays legible (the layout engine and `selectLocalGraph`'s `hubFanoutCap` already defend against fan-out, but cheap pre-capping at write time keeps `recomputeDegrees` honest):

1. **`item_topic`** — for every `item_topics(item, topic, score)` row above a score floor (`SEMANTIC_GRAPH_TOPIC_MIN_SCORE`, default 0.5). This is the backbone of the locked "first query to nail": a `topic` node is a visible hub whose neighbors are its member items, and drilling a topic node in the inspector = exactly the "drill into a theme to see its items" experience. **Cap** each item to its top-K topics (default 3) so a note isn't smeared across the whole taxonomy.
2. **`topic_parent`** — `topics.parent_id` -> `topic_parent` edge (child source, parent target, `weight 2`). This materializes the data-driven hierarchy *in the graph itself*, so broad topics cluster their specific children. Pairs with the locked "navigable at any depth" decision via a `level` filter (§4).
3. **`item_entity` + `co_occurrence` + `similar`** — `item_entity` from `item_entities(item, entity, salience)` above a salience floor, top-K per item. Entity `co_occurrence` is computed by the overlay producer (not stored in `semantic.sqlite` necessarily): two entities co-occurring in >= N items get an `entity<->entity co_occurrence` edge weighted by count. `similar` is the **embedding-KNN item<->item** edge — for each item, its top-M nearest neighbors above a cosine floor (`SEMANTIC_GRAPH_SIMILARITY_MIN`, default 0.78; M default 5). This is the literal "fuzzy link" the explicit-link graph can't produce. **Keep `similar` distinct from `co_occurrence`** so the legend and any future edge-kind filter can toggle "fuzzy similarity" independently from "shared entity," and so the layout can spring them differently.

**Crucial layout interaction with `contractMeetings`.** The global view contracts meetings into people<->project edges and lays out the reduced graph **fresh per request** (`route.ts:75-90`, `contract.ts:48`). Topic nodes must survive contraction (they're not in the `meetings/` folder, so `folderGroupOf` never tags them — they pass through untouched). But `co_occurrence`/`similar` edges can be *dense*; running them through `layoutSmallGraph`'s synchronous ngraph solve (`contract.ts:119`) on every global request risks blowing the "few hundred nodes, cheap per-request" assumption that justifies the synchronous solve. Therefore:

- **Topic + entity nodes and `item_topic`/`topic_parent` edges:** include in the contracted global selection by default when the overlay flag is on. These are *sparse hubs* — they reduce the hairball, they don't expand it.
- **`similar`/`co_occurrence` edges:** **off by default in global scope**, on via `&semanticEdges=1` (and always available in `local` scope around an anchor, where `selectLocalGraph`'s ring/fan-out caps already bound them). This keeps the per-request synchronous layout cheap while still letting a user summon the fuzzy web when they want it. Mirror the existing `includeTags`/`minDegree` query-param pattern in `route.ts:47-49`.

---

### 4. Node coloring + sizing (`graph-style.ts`)

Extend `TYPE_HUE` (`src/components/graph/graph-style.ts:51-60`) — these are the two unused-by-anyone-else vivid hues left in the Tailwind palette that read apart from the existing eight:

```typescript
const TYPE_HUE: Record<string, keyof typeof TW> = {
  note: "slate", reference: "blue", candidate: "amber", person: "emerald",
  project: "violet", north_star: "rose", library_cluster: "teal", tag: "slate",
  topic: "fuchsia",  // NEW — emergent themes pop as the new structural layer
  entity: "cyan",    // NEW — resolved entities, distinct from blue references
};
```

`resolveColorKey` (`graph-style.ts:78-82`) already routes any key in `TYPE_HUE` to its hue, so the only server-side requirement is that the overlay producer sets `colorKey: "topic"` / `colorKey: "entity"` on the node (the encoder interns it into `colorKeyTable` at `encode.ts:175`). No change to `buildColorBuffer`. **Optional refinement:** color `entity` nodes by their `entityType` via a contextual `entity:<type>` colorKey + a small sub-palette in `resolveColorKey` (parallel to the existing `area:<slug>` branch at `graph-style.ts:80`) — defer to a follow-up; the flat `cyan` is the ship-it default.

**Sizing.** Topics are the new hubs and should read as such. The current size logic (`buildSizeBuffer`, `graph-style.ts:123-139`) hard-codes the north_star floor on ordinal `=== 5`. Generalize the floor check to **also** apply `NORTH_STAR_SIZE_FLOOR` (or a new `TOPIC_SIZE_FLOOR`) to the `topic` ordinal (8), so a broad topic with few-but-meaningful members isn't shrunk to `LEAF_SIZE`. Keep entities on the default `sqrt(degree)` curve — a high-co-occurrence entity earns its size honestly.

**Legend.** Add `topic`/`entity` swatches and the three new edge kinds to `GraphLegend` (`src/components/graph/GraphToolbar.tsx:88`, `LEGEND_EDGE_KINDS`). Gate the semantic rows in the legend on the same `HILT_GRAPH_SEMANTIC` flag the meta endpoint reports, so the legend never shows kinds the payload can't contain.

---

### 5. Where it composes into the build/runner lifecycle

**Producer: `src/lib/graph/semantic-overlay.ts`** (new), modeled exactly on `buildTagLayer()`/`removeTagLayer()`:

```typescript
export function buildSemanticOverlay(opts?: { root?; db?; semanticDb? }): { topicNodes; entityNodes; edges };
export function removeSemanticOverlay(db?): void; // DELETE ... WHERE type IN ('topic','entity'); DELETE edges WHERE kind IN (...); recomputeDegrees; setMeta semantic_built=0
```

`buildSemanticOverlay` opens `semantic.sqlite` (its own better-sqlite3 singleton in `src/lib/semantic/db.ts`, read-only here), reads `topics`/`entities`/`item_topics`/`item_entities`/lineage, resolves item paths to graph node ids via the exported `nodeIdForResolvedPath`, pre-filters against the live `graph_nodes` id set, and upserts in **one transaction** ending with `recomputeDegrees(db); deleteOrphanPositions(db); setMetaMany({ semantic_built: "1", semantic_version: SEMANTIC_VERSION }, db)`. It clears prior overlay rows first (same as the tag layer's `DELETE ... WHERE type='tag'` opener).

**Call sites (three, all flag-gated):**

1. **`buildFullGraph` tail** (`build.ts:783-804`): after the vault transaction commits, if `graphSemanticOverlayEnabled()`, call `buildSemanticOverlay()`. A full graph rebuild repaints the whole overlay — correct, since `semantic.sqlite` is the authority and the vault nodes it links to were just rebuilt.
2. **GraphRunner periodic reconcile** (`runner.ts:233`): the overlay is **eventual, like candidates** — `semantic.sqlite` churns via the Phase-1 CLI/scheduled jobs, not vault file watchers. Add an overlay refresh to `reconcile()` (5-min backstop) and/or a dedicated longer interval. Re-derive only when `semantic.sqlite`'s `semantic_built`/version marker advanced past the graph's recorded `semantic_version` meta key (cheap watermark check — skip the rebuild when nothing re-fit). On change, seed `dirtySeeds` with the touched topic/entity/item node ids and `scheduleRelax()` so the incremental layout repositions just the affected region.
3. **Incremental file update** (`updateGraphForFile`, `build.ts:848-858`): no new code needed for *edges* — `deleteEdgesBySourceFile(absPath)` already drops a re-digested item's `item_topic`/`item_entity` edges (they carry that `source_file`). They get re-created on the next overlay reconcile. This is the right freshness tradeoff: vault structure is real-time, semantic re-attachment is eventual.

**Lineage-aware warm start.** When a re-fit changes `topics.id`, the new `topic:<newId>` node would lose its persisted position in `node_positions` and snap to (0,0). Before upserting topic nodes, `buildSemanticOverlay` reads `topic_lineage(old_topic, new_topic, op)` and, for each `merge`/`split`/`rename`, copies the old topic node's `node_positions` row to the new node id (via `upsertNodePosition` with `dirty: true`) so the layout warm-starts the new topic from its ancestor's location and the incremental relax nudges it — directly serving the locked "topics move only on real signal" + "old items get pulled under new themes" decisions, visually.

---

### 6. Read path + serving (no changes to the durable contract)

Because semantic rows live in `graph_nodes`/`graph_edges`, the entire read/encode/transport path is **unchanged**:

- `selectGlobalGraph` / `selectLocalGraph` (`db.ts:493`, `db.ts:540`) select them by default once written; `contractMeetings` passes them through (they're not meeting nodes); `encodeFromParts` interns their colorKeys and emits their type ordinals. No `TRANSPORT_FORMAT_VERSION` bump (append-only ordinals).
- **The one route change** (`src/app/api/system/graph/route.ts`): add a `semanticEdges` query param and a server-side filter that *excludes* `kind IN ('similar','co_occurrence')` from the global selection unless `semanticEdges=1` (§3). Cleanest implementation: a `kinds`/`excludeKinds` option threaded into `selectGlobalGraph`'s WHERE builder and `getAllEdges` (which already has the `kind != 'tag'` precedent at `db.ts:218`). Local scope leaves them in (ring caps bound them).
- **`/meta`** (`graphMeta`, `db.ts:390`): add `topicNodeCount` / `entityNodeCount` / `semanticBuilt` so `GraphToolbar` can gate the semantic legend/filters and the client knows the overlay is live. Mirror the existing `tagNodeCount` reporting.
- **Inspector** (`getEdgesForNode`, `GraphInspector.tsx`): works as-is — clicking a topic node shows its `item_topic` edges (its members) and `topic_parent` edges (its place in the hierarchy); the `attrs.summary` from `semantic.sqlite` gives the inspector a real description string to render. This is the in-graph version of the locked first query, available before the dedicated Topics view ships.

### 7. Files to touch / add (checklist)

| Action | Path |
|--------|------|
| Add `topic`/`entity` types + 5 edge kinds | `src/lib/graph/types.ts` |
| Append `topic`,`entity` ordinals | `src/lib/graph/encode.ts:60` (`NODE_TYPE_ORDER`) |
| Add `topicNodeId`/`entityNodeId`; **export** `nodeIdForResolvedPath` | `src/lib/graph/build.ts` |
| Call `buildSemanticOverlay()` in full build (flag-gated) | `src/lib/graph/build.ts:803` |
| New producer (mirror `buildTagLayer`/`removeTagLayer`) | `src/lib/graph/semantic-overlay.ts` (new) |
| `graphSemanticOverlayEnabled()` + thresholds (`SEMANTIC_GRAPH_*`) | `src/lib/graph/config.ts` (mirror `isGraphTagsEnabled` at :78) |
| Overlay refresh in reconcile + watermark + dirty-seed + lineage warm-start | `src/lib/graph/runner.ts:233`, `src/lib/graph/db.ts` (positions API already present) |
| `topic`/`entity` hues; topic size floor | `src/components/graph/graph-style.ts:51`, `:131` |
| Legend swatches + edge-kind rows (flag-gated) | `src/components/graph/GraphToolbar.tsx:88` |
| `semanticEdges` param + `excludeKinds` in selection | `src/app/api/system/graph/route.ts`, `src/lib/graph/db.ts` (`selectGlobalGraph`, `getAllEdges`) |
| `topicNodeCount`/`entityNodeCount`/`semanticBuilt` in meta | `src/lib/graph/db.ts:390`, `src/lib/graph/types.ts` (`GraphMeta`) |
| Env docs | `.env.example` (mirror `LIBRARY_*` block at :107-121 with `HILT_GRAPH_SEMANTIC`, `SEMANTIC_GRAPH_*`) |
| Docs | `docs/ARCHITECTURE.md` (semantic-overlay producer), `docs/API.md` (`semanticEdges` param + new meta fields), `docs/DATA-MODELS.md` (new node/edge kinds), `docs/CHANGELOG.md` |

**Net design property:** the semantic graph integration is the tag-layer pattern applied to a richer, externally-derived source. It adds two node types and five edge kinds to the existing tables, reads `semantic.sqlite` only in a single flag-gated producer (never the request path), survives meeting contraction, warm-starts through topic lineage, and is fully reversible via `removeSemanticOverlay()`. The durable wire contract (`encode.ts`) is untouched beyond an append-only ordinal addition.

---

## Versioning, Scheduling & Model Upgrades

### `SEMANTIC_VERSION` — what it captures

Mirror the Library scheme exactly. A single exported constant + a non-executable history doc, integers-vs-decimals semantics, every row stamped with the version that produced it.

Create `src/lib/semantic/pipeline.ts` as the **versioned-skill module** (the analog of `src/lib/library/pipeline.ts`):

```typescript
// src/lib/semantic/pipeline.ts
export const SEMANTIC_VERSION = "v0.1";

// The version is a COMPOUND of three independently-bumpable sub-versions.
// SEMANTIC_VERSION is the headline; the components let a stage decide what to
// re-run on an upgrade (re-embed only? re-extract only? re-cluster only?).
export const SEMANTIC_COMPONENTS = {
  embedding: "gemini-embedding-001@1536",   // model id + stored Matryoshka dim
  extraction: "flash-extract-v0.1",          // EXTRACTION_PROMPT + Flash model id
  taxonomy: "umap-hdbscan-v0.1+pro-label-v0.1", // cluster params + labeler model+prompt
} as const;

export { EXTRACTION_PROMPT } from "./extraction-prompt";
export { TAXONOMY_PROMPT } from "./taxonomy-prompt";
```

The headline `SEMANTIC_VERSION` is what gets stamped on rows and surfaced in the review lane; the three **component versions** are the upgrade lever — a row carries all four so a backfill can target precisely the stage that changed (re-embed without re-extracting, etc.). This is the one deliberate departure from the Library pipeline, justified because the semantic layer has three independently-versioned passes (embed / extract / cluster) where Library has one (reweave); folding them into a single opaque string would force a full re-embed every time a cluster param moved.

Following the precedent in `pipeline.ts` lines 1-21:
- **Integer** (`v1`, `v2`, …) = a protocol **published at scale** via a full backfill across the whole corpus — the "of record" baseline most rows carry.
- **Decimal** (`v0.1`, `v1.1`, …) = a **test/iteration** pass run on a **sample lane**, reviewed before rollout. Bump the decimal each iteration.
- **Promotion**: when a decimal is blessed and backfilled, it becomes the next integer (e.g. `v1.3 → v2`).

Per-row stamping (every table in `semantic.sqlite` per the plan §6) carries `version TEXT NOT NULL` plus the relevant component columns the plan already names: `chunks.model` + `chunks.version`, `entities.version`, `topics.version`, `topic_lineage.version`. Add `embedding_dim`, `embedded_at`, `extracted_at` per the plan's "Versioned" note (§3 Layer A line 128). This is the provenance trail — the exact analog of `pipeline_version` on `LibraryArtifact` / candidates.

Create `docs/SEMANTIC-VERSIONS.md` modeled byte-for-byte on `docs/PIPELINE-VERSIONS.md`: same header banner ("NON-EXECUTABLE historical record … the ONLY live skill is `src/lib/semantic/pipeline.ts`"), same "How versioning works" integers/decimals section, same version-history table (`Version | Class | One-line summary | Git ref`), same "never keep runnable copies of old versions — git history is the archive" rule (`pipeline.ts` line 20). Old cluster params / prompts live in git, recovered by checking out the ref.

### The generation cycle (run on every change)

Identical shape to `PIPELINE-VERSIONS.md` lines 30-50:

1. **Edit** the prompt(s) / cluster params in `src/lib/semantic/`.
2. **Bump** the affected component in `SEMANTIC_COMPONENTS` **and** the headline `SEMANTIC_VERSION` (decimal for a test, integer for a full backfill publish).
3. **Add an entry** to `docs/SEMANTIC-VERSIONS.md`.
4. **Write `docs/semantic-review-notes/<version>.md`** — the card rendered atop the sample lane (a `# Title` + a specific "what changed / what we were fixing / what's still open" body, per the PIPELINE-VERSIONS note discipline).
5. **Cut the sample batch** with `scripts/semantic-backfill.ts --sample --review-batch <label>` — it stamps the version on the sample rows and carries the note into a review queue.

**Reuse the existing review queue verbatim.** `src/lib/library/review-queue.ts` is vault-keyed (`hashId(resolve(vaultPath))`) and not Library-specific in its data model — `ReviewQueueEntry` / `ReviewBatchNote` / `addToReviewQueue` / `getActiveBatchNotes` work unchanged. Use a sibling store dir so the two queues never collide: change `libraryReviewQueueDir()`'s pattern into a parameterized `reviewQueueDir(kind)` (or simply add `semanticReviewQueueDir()` returning `DATA_DIR/semantic-review-queue`). The "decimal badge = experiment under review, integer badge = published standard" UI semantic carries straight over (`PIPELINE-VERSIONS.md` lines 25-28).

### Model-upgrade re-analysis flow

A model upgrade is a **backfill, not a migration** (plan §5, principle 3). The component-versioning makes the blast radius explicit:

- **Embedding model upgrade** (e.g. `gemini-embedding-001` → next): bump `SEMANTIC_COMPONENTS.embedding`. Re-embed every chunk → invalidates topic assignment (item↔topic scores are KNN over embeddings) → forces a re-cluster. Entities survive (extraction unchanged) but their stored embeddings re-embed. **Widest blast radius.**
- **Extraction prompt / Flash upgrade**: bump `extraction`. Re-extract + re-resolve entities; embeddings untouched; re-cluster only if entity-derived signal feeds clustering.
- **Taxonomy (cluster params / labeler) upgrade**: bump `taxonomy`. Re-cluster + re-label over the **existing** embeddings; no re-embed, no re-extract. **Narrowest.**

**Keep prior version live until blessed** (plan §5 "keep prior version's rows until blessed → swap"). Because every row is version-stamped, the new pass writes new rows alongside the old; queries default to the **active version** stored in a `semantic_meta` key (mirroring `graph_meta` / `setMeta` in `src/lib/graph/db.ts` lines 353-365):

```
semantic_meta: active_version, active_embedding, active_extraction, active_taxonomy, built_at, ...
```

The backfill runs on a sample lane first (decimal), the review queue surfaces the diff, and **blessing = flipping `active_version` in `semantic_meta` + bumping to the integer**. Old-version rows are then garbage-collected by a sweep keyed on `version != active_version` (a `semantic:gc` job, analog of `library:candidates:cleanup`). This is the safe, repeatable "reanalyze historic stuff with newer models" path. **Delete + rebuild reproduces** the current active version (Critical Constraint #2; `src/lib/graph/db.ts` lines 27-28).

`LAYOUT_VERSION` (`src/lib/graph/config.ts` line 42) is the precedent for a second, orthogonal bump: add a `SEMANTIC_DB_FORMAT_VERSION` constant (distinct from `SEMANTIC_VERSION`) so a `sqlite-vec` schema/wire change can invalidate the cache file independently of a model upgrade, exactly as `LAYOUT_VERSION` invalidates positions independently of `TRANSPORT_FORMAT_VERSION`.

### The jobs

Three cadences (plan §4), each a CLI entrypoint under `scripts/` so launchd and the runner share the same code path — the Library precedent where `scheduler-jobs.ts` names npm scripts that all dispatch into one `scripts/library-ingest.ts` (`package.json` lines 45-49).

**Single dispatcher: `scripts/semantic-backfill.ts <mode>`** with modes `cold-start | refit | gc | sample`, plus `scripts/semantic-incremental.ts` invoked by the runner (not scheduled).

1. **Cold-start backfill** (`semantic:backfill:cold`) — one-time, resumable/chunked like the layout main-loop. Embed all chunks → extract + resolve entities → global cluster → label → stamp version → write `active_version`. **Resumability**: track per-stage progress in `semantic_meta` (e.g. `coldstart_phase`, `coldstart_cursor`) and write in transactions so a crash mid-run resumes at the cursor rather than restarting (the plan calls this out as "resumable/chunked like the graph layout main-loop", §4.1). Cooperative chunking via `setImmediate` between batches, exactly like `src/lib/graph/layout.ts` lines 4-12 (no `worker_threads`; the corpus is low thousands of items).

2. **Incremental on change** — a **`SemanticRunner`** at `src/lib/semantic/runner.ts`, structurally a copy of `GraphRunner` (`src/lib/graph/runner.ts`):
   - Instantiated **only** by `server/ws-server.ts` and **only** when `isSemanticEnabled()` — same gating shape as the GraphRunner block at `ws-server.ts` lines 262-298 (dynamic `import()` so nothing on the flag-off path loads it; `flag-inert` per `layout.ts` lines 23-26).
   - **Watcher wiring**: subscribe a persistent ScopeWatcher client (reserved id `SEMANTIC_RUNNER_CLIENT_ID`) at the vault root for `references/` + main-vault dirs; consume `BridgeWatcher` dir-changed events via the same `onDirChanged(dir)` → re-scan-by-mtime pattern (the runner does NOT trust the single collapsed path — `runner.ts` lines 16-30, 150-164). Library-candidate churn (a dotdir, no watcher fires) is polled, same as `pollCandidates` (lines 209-222).
   - **Per-item work**: embed the changed item, extract + resolve its entities, assign to **nearest existing topics by embedding KNN — no re-cluster** (plan §4.2). New items just slot in.
   - **Coalesce + single-flight**: one debounced work window, one in-flight pass with a `queued` re-run flag, exactly `scheduleRelax` / `runRelax` (`runner.ts` lines 320-380). The expensive op here is the **Gemini API embedding/extraction call**, so the coalesce window should be larger than layout's 200ms (start ~2s, env-tunable) to batch a burst of edits into one API round-trip.
   - **Scope guard**: `isIncludedFile` must include main-vault dirs + `references/` and **exclude `libraries/`** (locked decision; mirrors `graphIncludeLibraries()` being OFF by default, `config.ts` lines 30-39 — but here libraries stays hard-excluded, not opt-in).

3. **Periodic global re-fit — BALANCED** (`semantic:refit`):
   - **Cadence**: nightly is too churny for a balanced posture; schedule **weekly** (a `StartCalendarInterval` low-traffic slot, e.g. Sunday 03:30) plus the option to run on-demand via the CLI. Re-fit cadence is flagged "still open" in the plan (§Decisions line 24, §9), so make the interval env-tunable (`SEMANTIC_REFIT_*`) rather than hard-coded.
   - **Warm-start**: re-cluster over all embeddings but **seed from the prior taxonomy** so topics move only on real signal (plan §3 Layer C line 149, §4.3) — the conceptual analog of `requestWarmStartLayout` / `warmStartDecision` (`runner.ts` lines 399-407). The LLM labeler (stronger model) merges/splits; **`topic_lineage(old_topic, new_topic, op, version)`** records every move so old items get pulled under new themes (plan §6). Guard against the documented over-proliferation failure (plan §4 caution) by requiring the LLM merge step, not raw streaming clusters.
   - Re-fit is a **decimal/sample** pass by default (writes new-version topic rows, surfaces in the review lane); blessing flips `active_version`.

4. **GC sweep** (`semantic:gc`, low-frequency e.g. daily 04:30) — drop rows whose `version != active_version` after a blessing, analog of the Library `cleanup` job (`scheduler-jobs.ts` lines 47-54).

### Scheduling (launchd) + flag gating

Add `src/lib/semantic/scheduler-jobs.ts` as a near-clone of `src/lib/library/scheduler-jobs.ts`: a `semanticSchedulerJobs(logDir)` returning the same `{ id, label, script, schedule, stdout, stderr }` shape, with `com.hilt.semantic.*` labels and logs under `~/Library/Logs/hilt-semantic`:

| id | npm script | schedule |
|----|-----------|----------|
| `cold-start` | `semantic:backfill:cold` | manual / RunAtLoad-once (not periodic) |
| `refit` | `semantic:refit` | `{ hour: 3, minute: 30 }` weekly (see note) |
| `gc` | `semantic:candidates:gc` | `{ hour: 4, minute: 30 }` |

Reuse `scripts/library-scheduler.ts` wholesale — extract its plist/launchctl install logic into a shared helper and add `scripts/semantic-scheduler.ts` calling it with `semanticSchedulerJobs()`, or add a `--feature semantic` flag. Keep the existing `--install` / `--uninstall` / dry-run-by-default contract (`library-scheduler.ts` lines 143-149) and the `RunAtLoad=false` default (line 84-85). launchd `StartCalendarInterval` has no native "weekly" key; either gate inside the script on day-of-week or set `Weekday` in the calendar-interval dict — prefer the latter (`schedulePlist`, lines 51-64, extended with a `<key>Weekday</key>`).

**Flag gating** — add to `src/lib/semantic/config.ts` mirroring `src/lib/graph/config.ts` lines 11-23:

```typescript
export function isSemanticEnabled(): boolean {
  return process.env.HILT_SEMANTIC_ENABLED === "true"; // OFF by default
}
export function getSemanticDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data"); // live: /Users/jruck/.hilt/data
}
export function getSemanticDbPath(): string {
  return process.env.HILT_SEMANTIC_DB_PATH || path.join(getSemanticDataDir(), "semantic.sqlite");
}
```

With `HILT_SEMANTIC_ENABLED` unset, `ws-server.ts` never imports/starts the `SemanticRunner`, no DB is opened, no watchers wire — identical to the graph feature's inert posture (`runner.ts` lines 5-10). The scheduled launchd jobs should **also** short-circuit on the flag at the top of `scripts/semantic-backfill.ts` so a stray installed plist is a no-op when the feature is off.

**Env config** — append a `# Semantic Knowledge Layer (Phase 2)` block to `.env.example` directly after the `HILT_GRAPH_*` block (lines 47-61), mirroring its commented-default style:

```
# HILT_SEMANTIC_ENABLED=true
# HILT_SEMANTIC_DB_PATH=                     # default: $DATA_DIR/semantic.sqlite
# GEMINI_API_KEY=                            # real value belongs in .env.local
# SEMANTIC_EMBEDDING_MODEL=gemini-embedding-001
# SEMANTIC_EMBEDDING_DIM=1536                # stored Matryoshka truncation
# SEMANTIC_EXTRACT_MODEL=gemini-flash        # per-item entity/topic extraction
# SEMANTIC_TAXONOMY_MODEL=                   # stronger model for the global label pass (Gemini Pro / claude CLI)
# SEMANTIC_INCREMENTAL_DEBOUNCE_MS=2000      # coalesce edit bursts into one API round-trip
# SEMANTIC_REFIT_WEEKDAY=0                   # 0=Sunday; the BALANCED weekly global re-fit
# SEMANTIC_BACKFILL_CHUNK_SIZE=64            # items per cooperative chunk in cold-start/refit
# SEMANTIC_DISABLED=                         # =true to no-op all jobs/runner (kill switch)
```

`GEMINI_API_KEY` goes under the existing "Store real values in .env.local, not in chat or committed files" warning (lines 64-65), alongside the Library credentials. The Gemini dependency decision (thin API client vs CLI shell-out) belongs to the model-access section; for **this** section the only requirement is that the model/version identifiers flowing into `SEMANTIC_COMPONENTS` and the per-row stamps come from these `SEMANTIC_*` env getters via a `boundedInt`-style config module (`config.ts` lines 144-149), so a model swap is a one-line env change that the upgrade-backfill flow then reconciles.

### Self-healing / single-flight

Match the layout engine's robustness contract (`src/lib/graph/layout.ts` lines 14-26, `LayoutEngine.acquire/release` lines 91-116):
- **Single-flight per job**: a process-singleton guard so two `semantic:refit` invocations (a launchd run overlapping a manual one) never both cluster — the second sees the lock and exits cleanly. The `SemanticRunner`'s incremental pass is single-flight via the in-flight-promise + queued-flag pattern (`runner.ts` lines 338-380); a full backfill/refit **supersedes** any queued incremental request.
- **Watchdog / stale recovery**: record `last_error` + a `pass_state` (`idle | running | frozen | stale`) in `semantic_meta` (mirroring `layout_state` / `last_error` in `graph_meta`, `db.ts` lines 372-410); a crashed pass leaves `stale`, and the cold-start/refit entrypoint self-heals by resuming from the persisted cursor. Errors are swallowed-and-recorded so a boot or API hiccup never crashes `ws-server` (`runner.ts` lines 107-122).
- **Periodic reconcile backstop**: the `SemanticRunner` runs a cheap full-mtime reconcile on an interval (and once on cold start) to re-embed any item the event path missed, exactly `reconcile()` (`runner.ts` lines 233-241) — freshness is **eventual** by design, and the weekly re-fit is the heavier backstop above it.

Net: `SEMANTIC_VERSION` + component-versioning gives precise upgrade blast-radius; the review-queue reuse gives the sample-lane bless-before-publish loop; three CLI jobs (cold-start / refit / gc) + the `SemanticRunner` cover the three cadences; launchd install reuses `library-scheduler.ts`; and the whole feature is inert behind `HILT_SEMANTIC_ENABLED` with layout-grade single-flight and self-heal.

**Key file paths**: `src/lib/library/pipeline.ts`, `docs/PIPELINE-VERSIONS.md`, `src/lib/library/review-queue.ts`, `src/lib/library/scheduler-jobs.ts`, `scripts/library-scheduler.ts`, `src/lib/graph/runner.ts`, `src/lib/graph/config.ts`, `src/lib/graph/db.ts`, `src/lib/graph/layout.ts`, `server/ws-server.ts` (lines 262-298), `.env.example` (lines 47-65, 102-121), `docs/plans/semantic-layer-phase2-plan.md` (§4, §5, §6). New files to create: `src/lib/semantic/pipeline.ts`, `src/lib/semantic/config.ts`, `src/lib/semantic/runner.ts`, `src/lib/semantic/scheduler-jobs.ts`, `scripts/semantic-backfill.ts`, `scripts/semantic-incremental.ts`, `scripts/semantic-scheduler.ts`, `docs/SEMANTIC-VERSIONS.md`, `docs/semantic-review-notes/`.

---

## Testing & verification strategy

This section makes every phase from the plan's §8 phasing (`docs/plans/semantic-layer-phase2-plan.md`) independently checkable with a single command, and guarantees **no live Gemini/Claude calls run in tests or CI**. It mirrors the existing graph/calendar test harness exactly so the conventions stay uniform.

### Guiding principles (from the codebase)

1. **Deterministic core, injectable LLM edge.** Every module that touches Gemini must take its client as an injectable dependency (defaulting to the real one), exactly like every db function in `src/lib/graph/db.ts` and `src/lib/calendar/db.ts` takes `db = getXxxDb()` as a trailing parameter. Tests pass a fake; production passes nothing. The Gemini client is **never** constructed inside a pure function.
2. **Temp-dir-per-test db isolation.** Reuse the `withTempGraph` pattern from `src/lib/graph/db.test.ts:47-58` verbatim: `mkdtempSync`, set `DATA_DIR` + `HILT_SEMANTIC_DB_PATH`, call `closeSemanticDbForTests()` before and after, `rmSync` in `finally`. The new db module **must** export `closeSemanticDbForTests()` (the calendar/granola/map cached-path gotcha — see `closeGraphDbForTests` at `db.ts:78-82`).
3. **Recorded fixtures over live calls.** Real Gemini responses are recorded once into JSON fixtures under `src/lib/semantic/__fixtures__/`; the fake client replays them keyed by input hash. CI runs entirely offline.
4. **Version stamping is asserted, not assumed.** Mirror `PIPELINE_VERSION` (`src/lib/library/pipeline.ts:23`): every embedding/extraction/topic row carries a `version` column, and there is a dedicated test that the stamp lands.

---

### The injectable Gemini client (the seam everything mocks against)

Define one interface in `src/lib/semantic/gemini-client.ts` so all three call sites (embeddings, Flash extraction, Pro/Claude taxonomy) mock through the same seam. Whether the real impl is a thin API client or a CLI shell-out (the open decision in §7 of the plan), **the interface is identical** so tests don't care:

```ts
export interface SemanticLlmClient {
  embed(texts: string[], opts: { model: string; dim: number }): Promise<number[][]>;     // 1536-dim Matryoshka
  extractEntities(input: ExtractInput): Promise<EntityExtraction>;                         // Gemini Flash
  labelTopics(input: TopicLabelInput): Promise<TopicLabeling>;                             // Pro/Claude
}
```

- Real impl resolves config from `SEMANTIC_*` / `GEMINI_API_KEY` env, following the `LIBRARY_*` style in `.env.example:106-121` and the bin-resolution pattern in `src/lib/library/connections.ts:32-34` (`resolveClaudeBin`) and `src/lib/library/digestion.ts:25` (`SUMMARIZE_BIN`).
- **`createFakeSemanticClient(fixtures)`** lives in `src/lib/semantic/test-helpers.ts`. It is deterministic:
  - `embed()` returns a **hash-seeded pseudo-vector** (e.g. seed a small PRNG from `sha1(text)`, fill 1536 dims, L2-normalize) — same input always yields the same vector, different inputs yield stably-different vectors. This makes KNN ordering deterministic without any recorded fixture, which is what unit tests need.
  - `extractEntities()` / `labelTopics()` replay from a fixture map keyed by `sha1(JSON.stringify(input))`; a missing key **throws** (so a test that forgot to record a fixture fails loudly rather than hitting the network).
  - Records call counts and inputs so tests can assert "incremental ingest embedded exactly 1 new chunk, re-used the rest."
- A guard in the real client: if `process.env.NODE_ENV === "test"` or `SEMANTIC_OFFLINE=1` and no `GEMINI_API_KEY`, it throws a clear "use createFakeSemanticClient in tests" error. Belt-and-suspenders against accidental live spend in CI.

**Recording fixtures:** a one-off `scripts/semantic-record-fixtures.ts` (run manually, never in CI) hits the real API over the tiny fixture vault and writes the keyed JSON into `__fixtures__/`. Checked into git. Re-recorded only when a prompt/model version bumps — and that re-record is itself a `SEMANTIC_VERSION` decimal bump per `pipeline.ts` rules.

---

### Deterministic unit tests (run via `tsx --test`, mirroring `test:graph`)

All under `src/lib/semantic/*.test.ts`, using `node:test` + `node:assert/strict` like `src/lib/graph/db.test.ts`.

**1. Chunking rules — `chunking.test.ts`** (pure, no client)
- note/ref kept as a single chunk (frontmatter + body), per plan §3 Layer A.
- long meeting transcript splits into coherent segments at a deterministic boundary; assert segment count and that concatenated segments == normalized source (no dropped text).
- scope filter: a path under `libraries/` produces **zero** chunks (locked exclusion); main-vault + `references/*.md` (saved refs) produce chunks; `references/.cache/` candidates are **excluded** (derived, not source — same boundary the graph e2e fixture encodes at `scripts/graph-e2e.ts:421`).
- edge cases: empty file → 0 chunks; frontmatter-only → 0 chunks; chunk char-cap honored.

**2. Schema round-trip — `db.test.ts`** (mirror `graph/db.test.ts:85-282`)
- `ensures all tables with WAL + synchronous=NORMAL`: assert `journal_mode == "wal"` and that `chunks`, `entities`, `entity_aliases`, `topics`, `item_entities`, `item_topics`, `topic_lineage`, `semantic_meta` all exist (plan §6).
- upsert round-trips and **overwrites every mutable column** (the partial-upsert footgun called out in `graph/db.ts:19-28`); assert a conflicting upsert replaces, not merges.
- vector column round-trips: store a 1536-float embedding, read it back bit-identical; assert `dim`, `model`, `version` columns persisted.
- `closeSemanticDbForTests` resets the cached path so a fresh temp dir starts empty (mirror `graph/db.test.ts:229-238`).
- **delete+rebuild reproducibility**: build over the fixture vault, snapshot all rows, delete the file, rebuild, assert identical row-set (Critical Constraint #2). With the hash-seeded fake `embed()`, vectors are byte-identical across rebuilds.

**3. Entity-resolution merge logic — `entity-resolution.test.ts`**
- the dedupe is the part the plan worried about (§3 Layer B). Test the **merge decision function in isolation**, feeding it candidate entities + a fake `labelTopics`/merge-judge response:
  - exact alias match → single canonical entity, second name lands in `entity_aliases`.
  - high embedding cosine + LLM "same" → merged; salience combined per the defined rule.
  - high cosine but LLM "different" (e.g. two people with similar names) → **kept separate** (the abstain-respecting behavior, analogous to the connections judge abstaining in `connections.ts:14-19`).
  - all four entity buckets (person/author/creator · project/area/task · idea/concept/theme · source/tool/org) survive a round-trip with correct `type`.
  - determinism: same inputs → same canonical id (id derived from canonical name, not insertion order).

**4. topic_lineage detection — `topic-lineage.test.ts`**
- this is the balanced-evolution guarantee. Given two clusterings (prior taxonomy + re-fit) as **fixture inputs** (no clustering library call — feed precomputed cluster assignments), assert the lineage diff:
  - split: one parent topic → two children writes two `topic_lineage(old, new, op="split")` rows.
  - merge: two topics → one writes `op="merge"` rows.
  - stable (no real signal moved): a topic whose membership barely changed keeps its id and writes **no** lineage row (the "topics move only on real signal" lock — assert a churn threshold gate).
  - old items get re-pointed: an item previously under the old topic now resolves to the new topic via lineage; assert the query in test 6 follows lineage.
  - warm-start: re-fit seeded from prior labels reuses ids where membership overlap exceeds threshold.

**5. Version stamping — `version.test.ts`**
- mirror the integer-vs-decimal contract documented in `pipeline.ts:1-23`. Assert `SEMANTIC_VERSION` is a parseable `vN`/`vN.M`; assert every writer stamps it onto rows; assert a backfill with a bumped version writes new-version rows **without deleting** prior-version rows until blessed (the "keep prior version's rows until blessed → swap" rule, plan §5). A `docs/PIPELINE-VERSIONS.md`-equivalent entry presence is checked in the docs-check, not here.

**6. Query functions over a seeded fixture db — `queries.test.ts`** (the highest-value tests — this is the P2.0 deliverable and the "first query to nail")
- Seed a temp db with hand-written rows (entities, topics with a 2-level hierarchy, item_topics scores, chunks with hash-seeded vectors) — no LLM, fully deterministic.
- **Topic exploration (the locked first query):** `listTopics({ recent, trending })` returns top-level topics ordered correctly; `recent`/`trending` ranking is deterministic given seeded `created_at`/scores; drilling into a parent returns its children then its items (broad→specific navigability, plan §3 Layer C). This test is the contract for the CLI command shipped first.
- `relatedTo(itemPath)` → vector KNN returns neighbors in cosine order; assert the seeded near-vector ranks above the far one.
- `itemsInTopic(topicId)` includes items pulled in via `topic_lineage` (cross-check with test 4).
- `entitiesCoOccurringWith(entityId)` returns co-occurrence-ranked entities.
- chunked `IN(...)` query for batch lookups doesn't blow the SQLite variable limit (mirror `getNodesByIds` chunking at `graph/db.ts:190-201`) — seed >400 ids and assert correctness.

**7. Incremental runner — `runner.test.ts`** (mirror `src/lib/graph/runner.test.ts:81-220`)
- construct the `SemanticRunner` with a **fake watcher + fake client** (the graph runner's test injects fakes; do the same).
- `onFileChanged` for a new note embeds **exactly one** chunk (assert fake `embed` call count == 1), extracts entities, slots into nearest existing topic **without re-clustering** (plan §4 cadence 2).
- `onFileRemoved` deletes the item's chunks/entities and cleans dangling `item_entities`/`item_topics` (mirror dangling-edge cleanup at `graph/db.ts:269-275`).
- a burst of edits coalesces into a single debounced pass (mirror `runner.test.ts:194` "coalesces a burst").
- a path under `libraries/` is ignored by the watcher (scope lock).

---

### E2E against a tiny fixture vault — `scripts/semantic-e2e.ts`

Model directly on `scripts/graph-e2e.ts`. The semantic layer's first deliverable is **CLI/query**, not UI, so the e2e is lighter than the graph one (no Playwright/WebGL initially):

- `mkdtempSync` a temp `DATA_DIR` + fixture vault; build the fixture vault with the **same `file()` helper and the same content shape** as `graph-e2e.ts:344-442` (notes with links, one saved `references/ref-*.md`, a person, a meeting transcript long enough to chunk, a `references/.cache/` candidate that **must be excluded**, and a `libraries/` file that **must be excluded**).
- Inject the **fake client** via env (`SEMANTIC_OFFLINE=1` + a fixtures path env the runner reads) so the whole cold-start backfill runs offline and deterministically. This is the key difference from a live run — the e2e proves the *pipeline wiring* end to end, not Gemini's quality.
- Run the **cold-start backfill CLI** (`scripts/semantic-backfill.ts`) over the fixture vault; assert: chunk count matches expected, entities of all four types extracted, a topic hierarchy with ≥1 parent + children, every row version-stamped.
- Exercise the **CLI query commands** that ship first (the `/navigate`-style channel, plan §6): "topics" lists the seeded themes; "topic <id>" drills to items; "related <path>" returns KNN neighbors. Assert JSON output shape (the CLI returns structured JSON for assertion, like the graph API's `fmt=json` at `graph-e2e.ts:105`).
- **Reproducibility assertion:** run backfill twice into two temp dirs; assert identical topic/entity/chunk row-sets (delete+rebuild reproduces — Constraint #2). The hash-seeded fake makes this exact.
- When P2.3 lands graph integration, **extend `graph-e2e.ts`** (don't fork it): add assertions that topic/entity nodes and semantic edges appear in `/api/system/graph?fmt=json`, reusing its existing `GraphSelectionJson` plumbing.
- Lifecycle (`waitForServer`/`stopServer`/`findFreePort`) and teardown (`rmSync` in `finally`) copied from `graph-e2e.ts:512-555`. No `next build` is needed for the CLI-only phases (P2.0–P2.2); only P2.3+ that adds graph nodes needs the flag-on build the way `graph-e2e.ts:500-510` does.

---

### npm scripts to add (to `package.json`)

Follow the exact glob/`tsx` form of the existing `test:graph` / `test:graph:e2e` entries:

```jsonc
"test:semantic":      "tsx --test src/lib/semantic/**/*.test.ts",
"test:semantic:e2e":  "tsx scripts/semantic-e2e.ts",
"semantic:backfill":  "DATA_DIR=${DATA_DIR:-$HOME/.hilt/data} tsx scripts/semantic-backfill.ts",
"semantic:record-fixtures": "tsx scripts/semantic-record-fixtures.ts"   // manual, hits live API, never in CI
```

`test:semantic` and `test:semantic:e2e` must both be **offline-deterministic** (fake client). `semantic:record-fixtures` is the only script that spends API and is run by hand. CI runs `test:semantic` (fast, pure) on every push and `test:semantic:e2e` on the same cadence as the other e2e suites.

---

### Per-phase Definition of Done + exact verification command

Each phase is **not done** until its command passes green offline. Phase names track plan §8.

| Phase | Definition of Done | Verification command |
|-------|--------------------|----------------------|
| **P2.0 Foundations** | `semantic.sqlite` schema (WAL, all tables) + `closeSemanticDbForTests`; chunking rules (incl. `libraries/` + `.cache/` exclusion); injectable `SemanticLlmClient` + fake; cold-start backfill writes version-stamped chunks/embeddings; **CLI "related items" (KNN) returns ordered neighbors**; delete+rebuild reproduces byte-identically. | `npm run test:semantic` (chunking + db + queries-KNN + version tests green) **and** `npm run test:semantic:e2e` (backfill + `related` over fixture vault, reproducibility assertion). |
| **P2.1 Entities** | Per-item extraction returns all four buckets; entity-resolution merge/abstain logic correct and deterministic; `entities`/`entity_aliases`/`item_entities` round-trip; incremental on-ingest embeds+extracts exactly the changed item (no re-cluster). | `npm run test:semantic` (now incl. `entity-resolution.test.ts` + `runner.test.ts` incremental-extract case) **and** `npm run test:semantic:e2e` asserting four entity types + co-occurrence query. |
| **P2.2 Topics** | Global clustering → LLM label/merge produces a 2-level hierarchy; `topics` + `item_topics` + `topic_lineage` populated; periodic re-fit is warm-started, moves topics only past the churn threshold, and writes lineage on split/merge; old items re-point under new topics. | `npm run test:semantic` (incl. `topic-lineage.test.ts` split/merge/stable/warm-start cases) **and** `npm run test:semantic:e2e` asserting topic hierarchy + `topic <id>` drill-down returns lineage-pulled items. |
| **P2.3 Surfaces** | CLI topic-exploration commands (`topics`, `topic <id>`, `related <path>`) return correct JSON; topic/entity node pages generated as derived artifacts (round-trip, not source); topic+entity nodes and semantic edges appear in the graph API. | `npm run test:semantic:e2e` (CLI command JSON contracts) **and** the extended `npm run test:graph:e2e` (topic/entity nodes + semantic edges present in `/api/system/graph?fmt=json`; no console errors). |
| **P2.4 Evolution** | A `SEMANTIC_VERSION` bump + backfill writes new-version rows without dropping prior-version rows until blessed, then swaps; lineage view query works across versions. | `npm run test:semantic` (`version.test.ts` backfill-coexistence + blessing/swap case) **and** `npm run test:semantic:e2e` run twice with different `SEMANTIC_VERSION` env asserting both versions coexist pre-bless. |

**Cross-cutting gate (every phase, every commit):** the project's mandatory pre-commit doc net (CLAUDE.md) — `docs/CHANGELOG.md` entry, plus `docs/PIPELINE-VERSIONS.md`-style version-history entry for any `SEMANTIC_VERSION` change, `docs/DATA-MODELS.md` for the new tables, and `docs/API.md` for any new route/CLI command. Run the existing `docs-check` skill before commit; treat a missing version-history entry the same way the Library treats a missing `PIPELINE_VERSION` bump.

**CI invariant to enforce:** a grep guard in `test:semantic`'s harness (or a tiny `no-live-calls.test.ts`) asserts that constructing the default client under `NODE_ENV=test` without `GEMINI_API_KEY` throws — so a regression that wires a live call into a unit test fails immediately rather than silently spending or hanging on network.

Relevant files to mirror: `/Users/jruck/work/engineering/me/hilt/src/lib/graph/db.test.ts` (temp-db harness + round-trip/reproducibility tests), `/Users/jruck/work/engineering/me/hilt/scripts/graph-e2e.ts` (fixture-vault e2e skeleton + lifecycle helpers), `/Users/jruck/work/engineering/me/hilt/src/lib/graph/runner.test.ts` (fake-watcher injection for the incremental loop), `/Users/jruck/work/engineering/me/hilt/src/lib/library/pipeline.ts` (version-stamping contract), `/Users/jruck/work/engineering/me/hilt/src/lib/library/review-queue.ts` (per-version batch/note surface), and `/Users/jruck/work/engineering/me/hilt/src/lib/library/connections.ts` + `digestion.ts` (env/bin-resolution + abstain conventions for the real client).

---

## Implementation Plan

This layer reconciles the six independently-designed sections and turns them into an ordered, command-by-command build. It does not restate their content; it resolves where they disagree, sequences the work so the no-key parts ship first, and names the verification command for every task.

### 1. Reconciliation notes (conflicts between sections, with rulings)

These are real contradictions across the sections that *must* be settled before P2.0, because later sections bind to whatever P2.0 names. Each ruling is binding for the rest of this plan.

| # | Conflict | Sections in tension | Ruling |
|---|----------|---------------------|--------|
| R1 | **Table names + item key.** Schema section: `items` keyed `id` (`scope:source_path`), plus `chunks`/`item_entities`/`item_topics`. Ingest section: `semantic_items` keyed `item_id` = graph node id, `semantic_chunks`. Query section: `items(path,...)` keyed on `path`. Entity section: `item_entity_mentions` + `entities`/`item_entities` keyed on graph node id. | **Adopt the Entity/Ingest convention: `item_id` IS the graph node id** (`note:`/`ref:`/`person:`/`project:` from `src/lib/graph/build.ts:246-267`). This is load-bearing for graph integration (R3) and is the more-cited choice (3 of 6 sections). Rename the schema section's `items`→`semantic_items`, `id`→`item_id`, and **add a `source_file` column** (abs path) so incremental delete-by-path works (Ingest §4, Graph §2). Keep the schema section's richer column set (`scope`, `kind`, `content_hash`, `chunk_count`) on `semantic_items`. The query section's `path` is a *view concern*: expose it as a derived column/alias resolved from `source_file`, not a second key. |
| R2 | **Version constant location + shape.** Versioning section: `src/lib/semantic/pipeline.ts` with a compound `SEMANTIC_COMPONENTS {embedding, extraction, taxonomy}`. CLI/Query + Testing sections: `src/lib/semantic/version.ts` with a flat `SEMANTIC_VERSION`. Ingest section: a *separate* `EMBED_PIPELINE_VERSION` integer in `pipeline.ts`. | **One module: `src/lib/semantic/pipeline.ts`** (mirrors `src/lib/library/pipeline.ts` exactly — the established precedent). It exports the headline `SEMANTIC_VERSION` string **and** the compound `SEMANTIC_COMPONENTS` (the Versioning section's design wins — three independently-bumpable passes is real). The Ingest section's `EMBED_PIPELINE_VERSION` is **subsumed** by `SEMANTIC_COMPONENTS.embedding`; rows store both the headline `version` and the per-pass component string (e.g. `embed_component`). Delete the standalone `version.ts` from the CLI/Testing sections — they import `SEMANTIC_VERSION` from `pipeline.ts`. |
| R3 | **Graph reads `semantic.sqlite` directly vs. through `query.ts`.** CLI/Query §6 says the graph builder "reads `listTopics()` + `item_topics` ... it consumes `query.ts`." Graph §5 says `buildSemanticOverlay()` "opens `semantic.sqlite` (its own better-sqlite3 singleton ... read-only here), reads `topics`/`entities`/...". | **Graph overlay reads `query.ts`, not raw SQL.** The CLI/Query section's contract is the right one: `query.ts` is the single read surface (CLI, routes, graph builder all bind to it). Graph §5's "opens semantic.sqlite" is fine *as long as* it does so via `getSemanticDb()` + `query.ts` functions, not hand-rolled SELECTs. Add `listAllItemTopics()`/`listAllItemEntities()`/`listEntityCoOccurrences()` bulk variants to `query.ts` for the builder's whole-corpus pass (the per-item query functions are too chatty for a full overlay rebuild). |
| R4 | **`PRAGMA foreign_keys = ON` deviation.** Schema section enables FKs (deliberate, for cascade). Every other section copies `src/lib/graph/db.ts` *verbatim*, which does **not** enable FKs. | **Keep FKs ON** (Schema section wins — cascade-on-item-delete is genuinely useful and the deviation is documented). But this means `closeSemanticDbForTests()` and every writer must tolerate it: virtual `vec0` tables are **not** reached by FK cascade (Schema §"incremental delete key"), so explicit `DELETE FROM chunk_vectors ...` stays mandatory. Add a `db.test.ts` assertion that `PRAGMA foreign_keys` returns `1` so a future copy-paste from graph/db.ts can't silently regress it. |
| R5 | **Vector storage: `sqlite-vec` virtual tables vs. BLOB-in-row.** Schema §"dual store" (vec0 + canonical BLOB). Ingest §4 stores `embedding BLOB` only on `semantic_chunks` (no vec0 mention). CLI/Query §2 assumes `item_vec vec0(item_rowid,...)` exists for KNN. Testing section's fake `embed()` returns hash-seeded vectors and asserts KNN ordering. | **Schema section's dual-store wins and is canonical: BLOB is source of truth, `vec0` is a derived accelerator** behind `isSemanticVecAvailable()`. Reconcile the *grain*: CLI/Query's `item_vec` (item-level) is wrong — KNN is over **chunks** (Ingest/Schema). `relatedToItem` resolves item→its chunks→`chunk_vectors` MATCH, then rolls neighbor chunks up to items (max score). The Testing fake `embed()` is unaffected: it feeds the BLOB path, and `SEMANTIC_VEC_DISABLED=1` in tests forces the deterministic in-process cosine scan so test KNN never depends on the native extension loading in CI. |
| R6 | **Clustering: Python sidecar vs. mockable in tests.** Topic §C.0 mandates a `uv`/Python UMAP+HDBSCAN sidecar. Testing §"topic-lineage" feeds *precomputed cluster assignments* as fixtures (no clustering call). | **No conflict once the seam is named.** The sidecar (`scripts/semantic-cluster.py`) is invoked by `src/lib/semantic/cluster.ts` (the `execFile` wrapper). Tests inject a **fake cluster function** the same way the LLM client is faked — `runClustering` is a dependency parameter on the topic orchestrator. The lineage/label tests feed fixture assignments through that seam; only `test:semantic:e2e` (optionally) exercises the real sidecar, and even there it degrades to "incremental-only" if `uv` is absent (Topic §C.0), so CI without Python still passes. |
| R7 | **Gemini access: thin `fetch` client.** Ingest §3, Entity §B.1, CLI/Query §6 all independently recommend a thin `fetch`-based client; Versioning section is access-agnostic; Topic §C.2 wants the *labeler* to optionally shell out to `claude`. | **Unify on `src/lib/semantic/gemini.ts` (thin `fetch` client) implementing the Testing section's `SemanticLlmClient` interface** — `embed()` / `extractEntities()` / `labelTopics()`. The taxonomy/label pass dispatches inside `labelTopics()`: if `SEMANTIC_TAXONOMY_MODEL` starts with `claude:`, it shells out via `runClaude` (reuse `src/lib/library/connections.ts`); else it POSTs Gemini. One interface, one injection seam, one env block. |
| R8 | **Env var names drift.** `HILT_SEMANTIC_ENABLED` (Versioning, CLI) vs no `HILT_` prefix flag in Schema; `SEMANTIC_DB_PATH` (Schema/Entity) vs `HILT_SEMANTIC_DB_PATH` (Versioning/CLI); `SEMANTIC_DISABLED` (Entity) vs `SEMANTIC_OFFLINE` (Testing) vs `SEMANTIC_LABEL_DISABLED` (Topic). | **Canonical names (mirror `HILT_GRAPH_*`/`LIBRARY_*`):** feature flag `HILT_SEMANTIC_ENABLED`; db path `HILT_SEMANTIC_DB_PATH` (falls back to `$DATA_DIR/semantic.sqlite`); offline/no-op kill switch `SEMANTIC_DISABLED=1` (the Testing section's `SEMANTIC_OFFLINE` is an alias — accept both, prefer `SEMANTIC_DISABLED`); `SEMANTIC_VEC_DISABLED=1` forces BLOB fallback. All other `SEMANTIC_*` tuning vars keep their section names. One consolidated block in `.env.example` (one section, not five).|
| R9 | **`source_file` for semantic edges in the graph.** Graph §2 sets `item_topic`/`item_entity` edge `source_file` to the owning item's abs path (so `deleteEdgesBySourceFile` wipes them on re-digest). This requires `semantic.sqlite` items to *carry* that abs path — which R1's `semantic_items.source_file` now guarantees. | Consistent after R1. No change beyond ensuring `nodeIdForResolvedPath` (currently module-private in `build.ts`) is **exported** (Graph §7 checklist) so the overlay maps item paths→node ids without reimplementation. |
| R10 | **Scheduler module home.** Versioning section: new `src/lib/semantic/scheduler-jobs.ts` + extract shared launchd helper from `scripts/library-scheduler.ts`. Ingest §6 / Topic: "extend `librarySchedulerJobs()`". | **New `src/lib/semantic/scheduler-jobs.ts`** (Versioning section wins — a separate `com.hilt.semantic.*` job family with its own log dir is cleaner than bloating the library array). Extract the plist/launchctl install/uninstall logic from `scripts/library-scheduler.ts` into a shared helper both schedulers call. |

### 2. Phased implementation plan (P2.0 → P2.4)

Tasks are ordered; each names its file(s), a one-line acceptance criterion, and the exact verification command. **Everything in P2.0–P2.1 up to the first live-embedding task is buildable with NO `GEMINI_API_KEY`** (schema, vec wiring, chunking, CLI skeleton, fake client, versioning, tests). The fake `SemanticLlmClient` (Testing section) with hash-seeded deterministic vectors is what unblocks all of this. Tasks marked **[KEYLESS]** require no API key; **[KEY]** needs a live key (or recorded fixtures).

#### P2.0 — Foundations + embeddings + cold-start + "related"/topic-exploration CLI

| # | Task | Target file(s) | Acceptance | Verify |
|---|------|----------------|------------|--------|
| 0.1 **[KEYLESS]** | Add `sqlite-vec` dep; `config.ts` with `isSemanticEnabled()`, `getSemanticDbPath()`, `getSemanticDataDir()`, `SEMANTIC_*` bounded-int getters (copy `boundedInt` from `graph/config.ts:144`). | `package.json`, `src/lib/semantic/config.ts` | `isSemanticEnabled()` false by default; path resolves to `$DATA_DIR/semantic.sqlite`. | `npm i && npx tsc --noEmit` |
| 0.2 **[KEYLESS]** | `pipeline.ts`: `SEMANTIC_VERSION="v0.1"` + `SEMANTIC_COMPONENTS` (R2). | `src/lib/semantic/pipeline.ts` | Exports parse as `vN`/`vN.M`; re-exports `EXTRACTION_PROMPT`/`TAXONOMY_PROMPT` (stubs ok). | `tsx --test src/lib/semantic/version.test.ts` |
| 0.3 **[KEYLESS]** | `db.ts`: singleton (`getSemanticDb`/`closeSemanticDbForTests` resetting **both** cached vars), `ensureSemanticSchema` (WAL, `synchronous=NORMAL`, **`foreign_keys=ON`** per R4), all 8 tables with R1 names (`semantic_items` carrying `source_file`), `tryLoadVec`/`isSemanticVecAvailable`, vec0 tables guarded by `vecAvailable`. | `src/lib/semantic/db.ts` | All tables created; `PRAGMA foreign_keys=1`; `journal_mode=wal`; vec0 tables exist when extension loads, absent when `SEMANTIC_VEC_DISABLED=1`. | `tsx --test src/lib/semantic/db.test.ts` |
| 0.4 **[KEYLESS]** | `vector.ts`: Float32 BLOB encode/decode + in-process cosine KNN fallback; `reindexVectors()` rebuilds vec0 from BLOBs. | `src/lib/semantic/vector.ts` | Round-trip BLOB bit-identical; cosine scan returns same top-K order as a vec0 MATCH on the same data. | `tsx --test src/lib/semantic/vector.test.ts` |
| 0.5 **[KEYLESS]** | `gemini.ts`: `SemanticLlmClient` interface (R7) + real impl (POST `batchEmbedContents`, L2-normalize, retry/backoff); throws under `NODE_ENV=test` w/o key. | `src/lib/semantic/gemini.ts` | Interface compiles; default client throws the "use fake" error offline. | `npx tsc --noEmit` |
| 0.6 **[KEYLESS]** | `test-helpers.ts`: `createFakeSemanticClient` (hash-seeded `embed`, fixture-replay `extract`/`label`, call-count recording) + no-live-call guard test. | `src/lib/semantic/test-helpers.ts`, `src/lib/semantic/no-live-calls.test.ts` | Same text → same vector; missing fixture throws; default-client-in-test throws. | `tsx --test src/lib/semantic/no-live-calls.test.ts` |
| 0.7 **[KEYLESS]** | `chunking.ts`: text assembly per kind + item-as-unit/split rules; `libraries/` and `references/.cache/` excluded; reuse `scanVault`/`INCLUDED_DIRS`/`resolveVaultRoot` from `graph/build.ts`, `parseReferenceFile` from `library/references.ts`, `sentences()` from `library/digestion.ts`. | `src/lib/semantic/chunking.ts` | Short note → 1 chunk; long transcript → N chunks whose concat == normalized source; `libraries/` path → 0 chunks. | `tsx --test src/lib/semantic/chunking.test.ts` |
| 0.8 **[KEYLESS]** | `query.ts`: pure read functions (`listTopics`, `recentTopics`, `getTopic`, `relatedToItem`, `entityByName`, `itemTopics`) + bulk variants for the graph builder (R3), each taking `db = getSemanticDb()`. KNN is **chunk-grain** (R5). | `src/lib/semantic/query.ts` | Over a hand-seeded db, topic exploration returns broad→specific order; `relatedToItem` returns cosine-ordered neighbors. | `tsx --test src/lib/semantic/queries.test.ts` |
| 0.9 **[KEYLESS]** | `scripts/semantic.ts` CLI skeleton: subcommand dispatch (`topics`, `topic`, `related`, `entity`, `item`, `status`), `--json`, `--navigate`, "not built" guard; calls `query.ts` only. | `scripts/semantic.ts`, `package.json` (`semantic`, `semantic:topics`, `test:semantic`, `test:semantic:e2e`) | `semantic status` on empty db prints "not built" / `{"error":"not_built"}` non-zero; on seeded db `topics --json` shape matches CLI §7. | `tsx scripts/semantic.ts status --json` |
| 0.10 **[KEY]** | Implement real `embed()` batching/rate-limit/retry against live API. | `src/lib/semantic/gemini.ts` | A 3-text batch returns 3 × 1536 L2-normalized vectors. | `GEMINI_API_KEY=… tsx scripts/semantic-record-fixtures.ts --embed-smoke` |
| 0.11 **[KEYLESS w/ fake]** | `scripts/semantic-backfill.ts` cold-start mode: scan → assemble → hash → upsert pending → embed (via injected client) → stamp version. Resumable via `content_hash`/`status`. | `scripts/semantic-backfill.ts` | Re-running over an unchanged vault is a no-op (0 embed calls on second pass). | `npm run test:semantic:e2e` |
| 0.12 **[KEYLESS]** | `scripts/semantic-e2e.ts`: fixture vault (copy `graph-e2e.ts` helpers), inject fake client, run cold-start backfill, exercise `topics`/`related`, assert reproducibility across two temp dirs. | `scripts/semantic-e2e.ts` | Two backfills into separate temp dirs produce identical chunk/topic/entity row-sets. | `npm run test:semantic:e2e` |

**P2.0 DoD:** `npm run test:semantic && npm run test:semantic:e2e` green **offline**; live embed smoke (0.10) green once key is set.

#### P2.1 — Entity extraction & resolution

| # | Task | Target file(s) | Acceptance | Verify |
|---|------|----------------|------------|--------|
| 1.1 **[KEYLESS]** | `extraction-prompt.ts`: `EXTRACTION_PROMPT` + `parseExtractionOutput()` reusing `stripCodeFences`/`extractFirstJsonObject`/`tryParse` from `library/connection-prompt.ts`; drop malformed entities. | `src/lib/semantic/extraction-prompt.ts` | Garbage/fenced/partial JSON → `{entities:[]}`, never throws; unknown `type` dropped. | `tsx --test src/lib/semantic/extraction-prompt.test.ts` |
| 1.2 **[KEYLESS]** | `extract.ts`: `extractEntities(item, client)` (injected); idempotent on `(item_id, content_hash, version)`. | `src/lib/semantic/extract.ts` | Re-extracting unchanged item → 0 client calls; four buckets round-trip into `item_entity_mentions`. | `tsx --test src/lib/semantic/extract.test.ts` |
| 1.3 **[KEYLESS]** | `resolve.ts` + `resolve-prompt.ts`: blocking (exact/alias, vec ANN via `chunk_vectors`/`entity_vectors`, edit-distance) + LLM merge-judge; fail-soft = no merge. | `src/lib/semantic/resolve.ts`, `resolve-prompt.ts` | Exact alias auto-merges; high-cosine+LLM-"different" stays separate; same inputs → same canonical id. | `tsx --test src/lib/semantic/entity-resolution.test.ts` |
| 1.4 **[KEYLESS]** | `reconcile.ts`: bind `person`/`project` entities to existing graph nodes (read `getGraphDb()` read-only); adopt graph node id; `concept`/`source` mint fresh. | `src/lib/semantic/reconcile.ts` | A person with a `people/*.md` file binds to `person:<slug>` (no duplicate); a name-only person mints `graph_node_id=NULL`. | `tsx --test src/lib/semantic/reconcile.test.ts` |
| 1.5 **[KEYLESS w/ fake]** | Wire extract→resolve→reconcile into `scripts/semantic-backfill.ts` and `scripts/semantic-resolve.ts` (global). | `scripts/semantic-backfill.ts`, `scripts/semantic-resolve.ts` | E2E backfill produces resolved entities of all four types + co-occurrence. | `npm run test:semantic:e2e` |
| 1.6 **[KEY]** | Record extraction/merge fixtures from the real Flash model over the fixture vault. | `src/lib/semantic/__fixtures__/`, `scripts/semantic-record-fixtures.ts` | Fixtures committed; `extract.test.ts` replays them deterministically. | `GEMINI_API_KEY=… tsx scripts/semantic-record-fixtures.ts` |

**P2.1 DoD:** `npm run test:semantic` (adds extraction/resolution/reconcile) **and** `npm run test:semantic:e2e` (four entity types + co-occurrence) green offline.

#### P2.2 — Emergent topics (clustering, labeling, hierarchy, lineage)

| # | Task | Target file(s) | Acceptance | Verify |
|---|------|----------------|------------|--------|
| 2.1 **[KEYLESS]** | `scripts/semantic-cluster.py`: PEP-723 `uv` sidecar (UMAP+HDBSCAN), stdin/stdout JSON, seeded `random_state`. | `scripts/semantic-cluster.py` | Given a vectors JSON on stdin, emits `{assignments,hierarchy,outliers,params_used}`. | `echo '{"vectors":[[…]],"ids":["a"],"params":{"seed":1}}' \| uv run scripts/semantic-cluster.py` |
| 2.2 **[KEYLESS]** | `cluster.ts`: `execFile` wrapper around the sidecar; tolerant parse; **injectable** `runClustering` seam (R6); degrade-gracefully on missing `uv`. | `src/lib/semantic/cluster.ts` | Missing `uv` → warn once + abstain (no throw); valid output parses. | `tsx --test src/lib/semantic/cluster.test.ts` |
| 2.3 **[KEYLESS]** | `topic-label-prompt.ts`: `TOPIC_LABEL_PROMPT` + `parseTopicLabels` (mirror connection-prompt parse). | `src/lib/semantic/topic-label-prompt.ts` | Fenced/partial label JSON tolerated; unjustified merges dropped. | `tsx --test src/lib/semantic/topic-label-prompt.test.ts` |
| 2.4 **[KEYLESS]** | `assign.ts`: incremental nearest-topic cosine assignment (pure TS, no Python); outliers → unassigned bucket. | `src/lib/semantic/assign.ts` | New item above floor → top-k topics; below floor → outlier; never creates a topic. | `tsx --test src/lib/semantic/assign.test.ts` |
| 2.5 **[KEYLESS]** | `lineage.ts`: split/merge/birth/death/carry detection from membership diff (pure set math). | `src/lib/semantic/lineage.ts` | Fixture prior+new assignments produce correct `topic_lineage` ops; stable topic writes no row. | `tsx --test src/lib/semantic/topic-lineage.test.ts` |
| 2.6 **[KEYLESS w/ fakes]** | `topics.ts` orchestrator: gather → `runClustering` → `labelTopics` → persist `topics`/`item_topics`/`entity_topics` → lineage diff; warm-start from prior centroids. | `src/lib/semantic/topics.ts` | Over fixtures (fake cluster + fake labeler), produces ≥2-level hierarchy; re-fit reuses ids where overlap > threshold. | `tsx --test src/lib/semantic/topics.test.ts` |
| 2.7 **[KEYLESS w/ fakes]** | `semantic:refit` mode in `scripts/semantic-backfill.ts`; signal-gated (`SEMANTIC_REFIT_MIN_NEW`). | `scripts/semantic-backfill.ts` | E2E: `topic <id>` drill-down returns child topics + lineage-pulled items. | `npm run test:semantic:e2e` |
| 2.8 **[KEY]** | Record clustering/labeling fixtures from real sidecar + Pro/Claude over the fixture corpus. | `src/lib/semantic/__fixtures__/`, `scripts/semantic-record-fixtures.ts` | Fixtures committed; topic tests replay offline. | `GEMINI_API_KEY=… tsx scripts/semantic-record-fixtures.ts --topics` |

**P2.2 DoD:** `npm run test:semantic` (adds cluster/label/assign/lineage/topics) **and** `npm run test:semantic:e2e` (hierarchy + lineage drill-down) green offline.

#### P2.3 — Graph integration (ship second)

| # | Task | Target file(s) | Acceptance | Verify |
|---|------|----------------|------------|--------|
| 3.1 **[KEYLESS]** | `types.ts`: append `topic`/`entity` node types + 5 edge kinds (`item_topic`,`topic_parent`,`item_entity`,`co_occurrence`,`similar`). | `src/lib/graph/types.ts` | Unions compile; `GraphMeta` adds `topicNodeCount`/`entityNodeCount`/`semanticBuilt`. | `npx tsc --noEmit` |
| 3.2 **[KEYLESS]** | `encode.ts`: append `topic`,`entity` to `NODE_TYPE_ORDER` (end only, no reorder); **no** `TRANSPORT_FORMAT_VERSION` bump. | `src/lib/graph/encode.ts` | Existing encode tests still pass; new ordinals 8/9. | `npm run test:graph` |
| 3.3 **[KEYLESS]** | `build.ts`: add `topicNodeId`/`entityNodeId`; **export** `nodeIdForResolvedPath` (R9). | `src/lib/graph/build.ts` | Helpers importable; existing build tests pass. | `npm run test:graph` |
| 3.4 **[KEYLESS]** | `graph/config.ts`: `graphSemanticOverlayEnabled()` (`HILT_GRAPH_SEMANTIC`) + `SEMANTIC_GRAPH_*` thresholds. | `src/lib/graph/config.ts` | Off by default; thresholds bounded. | `npx tsc --noEmit` |
| 3.5 **[KEYLESS w/ seeded dbs]** | `semantic-overlay.ts`: `buildSemanticOverlay()`/`removeSemanticOverlay()` reading `query.ts` bulk variants (R3), pre-filtering against live `graph_nodes`, lineage-aware position warm-start; one transaction; `recomputeDegrees`. | `src/lib/graph/semantic-overlay.ts` | With both dbs seeded, overlay upserts topic/entity nodes + edges; dangling edges pre-filtered out; `removeSemanticOverlay` strips them all. | `tsx --test src/lib/graph/semantic-overlay.test.ts` |
| 3.6 **[KEYLESS]** | `route.ts` + `db.ts` selection: `semanticEdges` param + `excludeKinds` so `similar`/`co_occurrence` are global-off-by-default; `/meta` reports new counts. | `src/app/api/system/graph/route.ts`, `src/lib/graph/db.ts` | Global payload omits `similar`/`co_occurrence` unless `semanticEdges=1`; local scope includes them. | `npm run test:graph` |
| 3.7 **[KEYLESS]** | `graph-style.ts` + `GraphToolbar.tsx`: `topic`(fuchsia)/`entity`(cyan) hues, topic size floor, legend rows gated on flag. | `src/components/graph/graph-style.ts`, `GraphToolbar.tsx` | Topic nodes render at hub size; legend shows new kinds only when flag on. | `npm run test:graph` |
| 3.8 **[KEYLESS]** | Wire `buildSemanticOverlay` into `buildFullGraph` tail + GraphRunner reconcile (watermark check). | `src/lib/graph/build.ts`, `src/lib/graph/runner.ts` | Overlay refreshes only when `semantic.sqlite` version watermark advanced. | `npm run test:graph` |
| 3.9 **[KEYLESS]** | HTTP routes `/api/system/semantic/{topics,topic/[id],related,entity/[name]}` — thin `query.ts` wrappers, `isSemanticEnabled()` 404 guard. | `src/app/api/system/semantic/*/route.ts` | Flag-off → 404; flag-on → JSON matching CLI `--json` shape. | extend `npm run test:semantic:e2e` |
| 3.10 **[KEYLESS]** | Extend `scripts/graph-e2e.ts` (don't fork) to assert topic/entity nodes + semantic edges in `/api/system/graph?fmt=json` with overlay flag on. | `scripts/graph-e2e.ts` | Topic/entity nodes present; no console errors. | `npm run test:graph:e2e` |

**P2.3 DoD:** `npm run test:graph && npm run test:graph:e2e && npm run test:semantic:e2e` green; overlay fully reversible via `removeSemanticOverlay()`.

#### P2.4 — Versioned re-analysis (model upgrades + scheduling)

| # | Task | Target file(s) | Acceptance | Verify |
|---|------|----------------|------------|--------|
| 4.1 **[KEYLESS]** | `semantic_meta` active-version keys (`active_version`, `active_*` components, `built_at`); add `SEMANTIC_DB_FORMAT_VERSION` (orthogonal to `SEMANTIC_VERSION`, like `LAYOUT_VERSION`). | `src/lib/semantic/db.ts`, `pipeline.ts` | Queries default to `active_version`; format bump invalidates the cache file independently. | `tsx --test src/lib/semantic/version.test.ts` |
| 4.2 **[KEYLESS]** | Backfill coexistence: a `SEMANTIC_VERSION` bump writes new-version rows **without deleting** prior-version rows until blessed; `semantic:gc` drops `version != active_version` after blessing. | `scripts/semantic-backfill.ts` (`gc` mode) | Two versions coexist pre-bless; `gc` removes the old after `active_version` flip. | `tsx --test src/lib/semantic/version.test.ts` |
| 4.3 **[KEYLESS]** | Reuse review queue: `semanticReviewQueueDir()` (sibling store) via parameterized `reviewQueueDir(kind)`; `--sample`/`--review-batch` stamps version + carries note. | `src/lib/library/review-queue.ts`, `scripts/semantic-backfill.ts` | Sample batch lands in `DATA_DIR/semantic-review-queue` without colliding with the library queue. | `tsx --test src/lib/semantic/review-queue.test.ts` |
| 4.4 **[KEYLESS]** | `runner.ts` (`SemanticRunner`): GraphRunner-shaped incremental (debounce, single-flight, queued-rerun, periodic reconcile, scope guard excludes `libraries/`); instantiated by `ws-server.ts` only when `isSemanticEnabled()`. | `src/lib/semantic/runner.ts`, `server/ws-server.ts` | New note → exactly 1 embed call, slots into nearest topic (no re-cluster); burst coalesces to one pass; `libraries/` ignored. | `tsx --test src/lib/semantic/runner.test.ts` |
| 4.5 **[KEYLESS]** | `scheduler-jobs.ts` + `scripts/semantic-scheduler.ts` (`com.hilt.semantic.*`); extract shared launchd helper from `library-scheduler.ts` (R10); jobs short-circuit on `HILT_SEMANTIC_ENABLED` off. | `src/lib/semantic/scheduler-jobs.ts`, `scripts/semantic-scheduler.ts` | `semantic:scheduler:plan` prints cold-start/refit/gc jobs; install/uninstall dry-run-by-default. | `tsx scripts/semantic-scheduler.ts` |
| 4.6 **[KEYLESS]** | Docs net: `docs/SEMANTIC-VERSIONS.md`, `docs/semantic-review-notes/`, update `DATA-MODELS.md`/`API.md`/`ARCHITECTURE.md`/`CHANGELOG.md`. | docs | `docs-check` passes; version-history entry present for `v0.1`. | run `docs-check` skill |
| 4.7 **[KEY]** | Full model-upgrade rehearsal: bump `SEMANTIC_COMPONENTS.embedding`, run backfill, bless, gc. | live | New embeddings re-cluster; lineage preserved; old rows gc'd post-bless. | `GEMINI_API_KEY=… npm run semantic:backfill -- refit` |

**P2.4 DoD:** `npm run test:semantic` (adds version/runner/review-queue) green offline; `ws-server` boots inert with flag off; scheduler plan lists three jobs.

### 3. Risks & open micro-decisions (prioritized)

1. **[HIGH] `sqlite-vec` load in the packaged Electron main process.** The Schema section's `tryLoadVec` degrades on dlopen failure, but the daily-driver app runs better-sqlite3 in Electron's main process where a prebuilt `.dylib` arch mismatch is plausible. *Decision needed:* verify `loadExtension` works in the `npm run app` dev build **before** P2.0 ships, and make `SEMANTIC_VEC_DISABLED=1` the documented fallback. The BLOB-canonical design (R5) means this is a perf risk, not a correctness risk — at low-thousands scale the in-process cosine scan is fine, so this can ship vec-off and add vec later.
2. **[HIGH] `item_id` = graph node id couples semantic to graph (R1).** If `HILT_GRAPH_ENABLED` is off but `HILT_SEMANTIC_ENABLED` is on, the node-id helpers (`noteNodeId` etc.) and `nodeIdForResolvedPath` must still be importable from `build.ts` **without** triggering graph DB work. *Open:* confirm those helpers are pure (they appear to be) so the semantic layer can mint ids without `getGraphDb()`. The `reconcile.ts` graph-node binding (1.4) must no-op gracefully when `graph.sqlite` doesn't exist (semantic-only deployment).
3. **[MED] FK cascade vs. vec0 tables (R4).** Virtual tables are not reached by `ON DELETE CASCADE`, so every item/chunk delete path must explicitly delete `chunk_vectors`/`entity_vectors`/`topic_vectors` rows in the same transaction. *Risk:* a missed explicit delete leaves orphan vectors that pollute KNN. *Mitigation:* a `reindexVectors()`-based integrity test asserting `count(chunk_vectors) == count(chunks WHERE embedding_blob NOT NULL)` after a delete batch.
4. **[MED] `uv`/Python availability for the re-fit sidecar.** Precedent exists (`scripts/youtube-transcript.py`), but the global re-fit must degrade to "incremental-only, no taxonomy evolution" when `uv` is missing. *Open:* pin the Python version in the PEP-723 block and document the `SEMANTIC_CLUSTER_BIN` override; decide whether CI installs `uv` for `test:semantic:e2e` or always runs the fake-cluster seam (recommend: fake seam in CI, real sidecar only in a manual `:e2e:live`).
5. **[MED] Topic id stability across re-fits drives graph position warm-start (R3/Graph §5).** BERTopic re-cluster churns ids; the overlay copies positions via `topic_lineage`. *Open micro-decision:* the lineage overlap threshold (`SEMANTIC_LINEAGE_COS`) is set in two places (Topic §C.5 default 0.7, Graph warm-start) — make it a single config getter so they can't drift.
6. **[LOW] Re-fit cadence is explicitly deferred in the plan.** Versioning section recommends weekly + signal-gated. *Decision:* ship signal-gated (`SEMANTIC_REFIT_MIN_NEW`) so cadence choice is low-stakes; make the interval env-tunable, default weekly.
7. **[LOW] `SEMANTIC_DISABLED` vs `SEMANTIC_OFFLINE` alias (R8).** Accept both, prefer `SEMANTIC_DISABLED`; document the alias in `.env.example` so the Testing section's harness and the runtime kill switch don't diverge.
8. **[LOW] Chunk-grain KNN roll-up (R5) for `relatedToItem`.** Returning item-level neighbors from chunk-level matches needs a max/sum aggregation choice. *Decision:* max-score roll-up (a single strongly-matching chunk should surface its item); document so the CLI and graph `similar` edges agree.

Key new files this plan creates: `src/lib/semantic/{config,pipeline,db,vector,gemini,test-helpers,chunking,query,extract,extraction-prompt,resolve,resolve-prompt,reconcile,cluster,topics,assign,lineage,topic-label-prompt,runner,scheduler-jobs}.ts`, `scripts/{semantic,semantic-backfill,semantic-resolve,semantic-cluster.py,semantic-e2e,semantic-scheduler,semantic-record-fixtures}.ts`, `src/lib/graph/semantic-overlay.ts`, `src/app/api/system/semantic/*/route.ts`, `docs/SEMANTIC-VERSIONS.md`, `docs/semantic-review-notes/`.
