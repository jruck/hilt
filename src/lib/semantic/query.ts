/**
 * Read layer over semantic.sqlite — the single query surface the CLI, the (later)
 * HTTP routes, and the graph overlay all bind to (ruling R3). Pure reads; every
 * function takes `db = getSemanticDb()` so it's testable over a seeded fixture.
 *
 * KNN is chunk-grain rolled up to items by MAX score (rulings R5/R8): a single
 * strongly-matching chunk should surface its item. Vector search uses the canonical
 * BLOBs + in-process cosine (correct with or without the sqlite-vec accelerator).
 */

import type Database from "better-sqlite3";
import { getActiveVersion, getSemanticDb, listDerivedVersions } from "./db";
import { blobToFloat32, cosineSimilarity, knnCosine, type VectorCandidate } from "./vector";

export interface TopicSummary {
  id: string;
  label: string;
  level: number;
  parentId: string | null;
  itemCount: number;
  trendScore: number | null;
}

export interface ItemRef {
  itemId: string;
  title: string | null;
  kind: string;
  score?: number;
}

export interface LineageEntry {
  op: string;
  oldTopicId: string | null;
  newTopicId: string | null;
  score: number | null;
}

export interface TopicDetail {
  topic: TopicSummary;
  children: TopicSummary[];
  items: ItemRef[];
  lineage: LineageEntry[];
}

export interface RelatedHit extends ItemRef {
  score: number;
}

export interface EntityResult {
  id: string;
  type: string;
  name: string;
  summary: string | null;
  mentionCount: number;
  items: ItemRef[];
}

export interface SemanticStatus {
  built: boolean;
  items: number;
  chunks: number;
  embeddedChunks: number;
  entities: number;
  topics: number;
  builtAt: string | null;
  /** The "of record" version queries default to (P2.4) — decimal = under review, integer = published. */
  activeVersion: string;
  /** Every distinct version present across derived tables — >1 means a coexistence window. */
  versions: string[];
}

interface TopicRow {
  id: string;
  parent_id: string | null;
  level: number;
  label: string;
  item_count: number;
  trend_score: number | null;
}

const toSummary = (r: TopicRow): TopicSummary => ({
  id: r.id,
  label: r.label,
  level: r.level,
  parentId: r.parent_id,
  itemCount: r.item_count,
  trendScore: r.trend_score,
});

/** Topics at a level: top-level (parentId omitted) or the children of a parent. */
export function listTopics(opts: { parentId?: string | null } = {}, db = getSemanticDb()): TopicSummary[] {
  const rows =
    opts.parentId === undefined
      ? (db.prepare("SELECT * FROM topics WHERE parent_id IS NULL ORDER BY item_count DESC, label ASC").all() as TopicRow[])
      : opts.parentId === null
        ? (db.prepare("SELECT * FROM topics WHERE parent_id IS NULL ORDER BY item_count DESC, label ASC").all() as TopicRow[])
        : (db.prepare("SELECT * FROM topics WHERE parent_id = ? ORDER BY item_count DESC, label ASC").all(opts.parentId) as TopicRow[]);
  return rows.map(toSummary);
}

/** Recent/trending topics by recency-weighted activity. */
export function recentTopics(limit = 12, db = getSemanticDb()): TopicSummary[] {
  const rows = db
    .prepare("SELECT * FROM topics WHERE trend_score IS NOT NULL ORDER BY trend_score DESC, item_count DESC LIMIT ?")
    .all(limit) as TopicRow[];
  return rows.map(toSummary);
}

/** A topic with its child topics + its top member items. */
export function getTopic(id: string, opts: { items?: number } = {}, db = getSemanticDb()): TopicDetail | null {
  const row = db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as TopicRow | undefined;
  if (!row) return null;
  const children = (db.prepare("SELECT * FROM topics WHERE parent_id = ? ORDER BY item_count DESC, label ASC").all(id) as TopicRow[]).map(toSummary);
  const items = db
    .prepare(
      `SELECT si.item_id AS itemId, si.title AS title, si.kind AS kind, it.score AS score
       FROM item_topics it JOIN semantic_items si ON si.item_id = it.item_id
       WHERE it.topic_id = ? ORDER BY it.score DESC, si.item_id ASC LIMIT ?`,
    )
    .all(id, opts.items ?? 50) as ItemRef[];
  const lineage = (
    db
      .prepare(
        `SELECT op, old_topic_id AS oldTopicId, new_topic_id AS newTopicId, score
         FROM topic_lineage WHERE old_topic_id = ? OR new_topic_id = ? ORDER BY id`,
      )
      .all(id, id) as LineageEntry[]
  );
  return { topic: toSummary(row), children, items, lineage };
}

/** Topics an item belongs to (highest membership first). */
export function itemTopics(itemId: string, db = getSemanticDb()): TopicSummary[] {
  return (
    db
      .prepare(
        `SELECT t.* FROM item_topics it JOIN topics t ON t.id = it.topic_id
         WHERE it.item_id = ? ORDER BY it.score DESC`,
      )
      .all(itemId) as TopicRow[]
  ).map(toSummary);
}

interface ChunkVecRow {
  chunk_id: string;
  item_id: string;
  embedding_blob: Buffer;
}

function loadChunkVectors(db: Database.Database, where: string, params: unknown[] = []): Array<{ chunkId: string; itemId: string; vec: Float32Array }> {
  const rows = db
    .prepare(`SELECT id AS chunk_id, item_id, embedding_blob FROM chunks WHERE embedding_blob IS NOT NULL ${where}`)
    .all(...params) as ChunkVecRow[];
  return rows.map((r) => ({ chunkId: r.chunk_id, itemId: r.item_id, vec: blobToFloat32(r.embedding_blob) }));
}

/**
 * Items semantically related to `itemId`: every query-item chunk KNN'd against all
 * other items' chunks, rolled up to items by MAX cosine (R8). Returns top-k items
 * (excluding the query item). Empty if the item has no embedded chunks.
 */
export function relatedToItem(itemId: string, k = 10, db = getSemanticDb()): RelatedHit[] {
  const queryChunks = loadChunkVectors(db, "AND item_id = ?", [itemId]);
  if (queryChunks.length === 0) return [];
  const candidates = loadChunkVectors(db, "AND item_id != ?", [itemId]);
  if (candidates.length === 0) return [];
  const candVecs: VectorCandidate[] = candidates.map((c) => ({ id: c.chunkId, vec: c.vec }));
  const chunkToItem = new Map(candidates.map((c) => [c.chunkId, c.itemId]));

  const itemScore = new Map<string, number>();
  for (const q of queryChunks) {
    for (const hit of knnCosine(q.vec, candVecs, candVecs.length)) {
      const item = chunkToItem.get(hit.id);
      if (!item) continue;
      const prev = itemScore.get(item);
      if (prev === undefined || hit.score > prev) itemScore.set(item, hit.score);
    }
  }

  const ranked = [...itemScore.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k);
  const out: RelatedHit[] = [];
  const getMeta = db.prepare("SELECT title, kind FROM semantic_items WHERE item_id = ?");
  for (const [item, score] of ranked) {
    const meta = getMeta.get(item) as { title: string | null; kind: string } | undefined;
    out.push({ itemId: item, title: meta?.title ?? null, kind: meta?.kind ?? "", score });
  }
  return out;
}

/** Resolve an entity by name/alias and return it with its top items. */
export function entityByName(name: string, db = getSemanticDb()): EntityResult | null {
  const norm = name.trim().toLowerCase();
  const direct = db.prepare("SELECT * FROM entities WHERE LOWER(canonical_name) = ?").get(norm) as
    | { id: string; type: string; canonical_name: string; summary: string | null; mention_count: number }
    | undefined;
  const viaAlias = direct
    ? undefined
    : (db.prepare("SELECT entity_id FROM entity_aliases WHERE alias_norm = ?").get(norm) as { entity_id: string } | undefined);
  const entityId = direct?.id ?? viaAlias?.entity_id;
  if (!entityId) return null;
  const ent = direct ?? (db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId) as typeof direct);
  if (!ent) return null;
  const items = db
    .prepare(
      `SELECT si.item_id AS itemId, si.title AS title, si.kind AS kind, ie.salience AS score
       FROM item_entities ie JOIN semantic_items si ON si.item_id = ie.item_id
       WHERE ie.entity_id = ? ORDER BY ie.salience DESC, si.item_id ASC LIMIT 50`,
    )
    .all(ent.id) as ItemRef[];
  return { id: ent.id, type: ent.type, name: ent.canonical_name, summary: ent.summary, mentionCount: ent.mention_count, items };
}

// ---------------------------------------------------------------------------
// Bulk variants for the graph overlay (ruling R3): the per-item query functions
// above are too chatty for a whole-corpus overlay rebuild, so the builder reads
// these single-pass projections instead of hand-rolling SELECTs against semantic.sqlite.
// ---------------------------------------------------------------------------

/** One item→topic membership edge (with the topic's level for hierarchy emphasis). */
export interface ItemTopicEdge {
  itemId: string;
  topicId: string;
  score: number;
  /** Topic hierarchy level (0 = broadest); the overlay uses it for size emphasis. */
  level: number;
  parentId: string | null;
}

/** Every item→topic membership across the corpus, joined to the topic for level/parent. */
export function listAllItemTopics(db = getSemanticDb()): ItemTopicEdge[] {
  return db
    .prepare(
      `SELECT it.item_id AS itemId, it.topic_id AS topicId, it.score AS score,
              t.level AS level, t.parent_id AS parentId
       FROM item_topics it JOIN topics t ON t.id = it.topic_id
       ORDER BY it.item_id, it.score DESC`,
    )
    .all() as ItemTopicEdge[];
}

/** One topic node projection (label/summary/level/parent + member count + trend). */
export interface TopicNodeRow {
  id: string;
  parentId: string | null;
  level: number;
  label: string;
  summary: string | null;
  itemCount: number;
  trendScore: number | null;
}

/** Every topic, for minting the topic nodes (and their parent edges) in one pass. */
export function listAllTopics(db = getSemanticDb()): TopicNodeRow[] {
  return db
    .prepare(
      `SELECT id, parent_id AS parentId, level, label, summary, item_count AS itemCount, trend_score AS trendScore
       FROM topics ORDER BY id`,
    )
    .all() as TopicNodeRow[];
}

/** One item→entity mention edge (with the entity's salience for this item). */
export interface ItemEntityEdge {
  itemId: string;
  entityId: string;
  salience: number;
}

/** Every item→entity mention across the corpus (top-K/floor filtering is the overlay's job). */
export function listAllItemEntities(db = getSemanticDb()): ItemEntityEdge[] {
  return db
    .prepare(
      `SELECT item_id AS itemId, entity_id AS entityId, salience
       FROM item_entities ORDER BY item_id, salience DESC`,
    )
    .all() as ItemEntityEdge[];
}

/** One entity node projection (canonical name/type/summary + aliases + total salience). */
export interface EntityNodeRow {
  id: string;
  type: string;
  canonicalName: string;
  summary: string | null;
  aliases: string[];
  salienceTotal: number;
}

/** Every entity, for minting the entity nodes in one pass (aliases joined). */
export function listAllEntities(db = getSemanticDb()): EntityNodeRow[] {
  const rows = db
    .prepare(
      `SELECT e.id AS id, e.type AS type, e.canonical_name AS canonicalName, e.summary AS summary,
              COALESCE(SUM(ie.salience), 0) AS salienceTotal
       FROM entities e LEFT JOIN item_entities ie ON ie.entity_id = e.id
       GROUP BY e.id ORDER BY e.id`,
    )
    .all() as Array<Omit<EntityNodeRow, "aliases">>;
  const aliasRows = db
    .prepare("SELECT entity_id AS entityId, alias FROM entity_aliases ORDER BY entity_id, alias")
    .all() as Array<{ entityId: string; alias: string }>;
  const aliasesById = new Map<string, string[]>();
  for (const a of aliasRows) {
    const list = aliasesById.get(a.entityId) ?? [];
    list.push(a.alias);
    aliasesById.set(a.entityId, list);
  }
  return rows.map((r) => ({ ...r, aliases: aliasesById.get(r.id) ?? [] }));
}

/**
 * A cheap monotone watermark string that advances whenever the semantic layer
 * re-derives (cold-start sets `built_at`; any re-fit sets `last_refit_at`). The graph
 * runner records the last watermark it overlaid and skips the rebuild when unchanged
 * (Graph §5). Empty string ⇒ nothing built yet.
 */
export function semanticWatermark(db = getSemanticDb()): string {
  const get = (k: string): string =>
    (db.prepare("SELECT value FROM semantic_meta WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? "";
  const builtAt = get("built_at");
  const refitAt = get("last_refit_at");
  const version = get("active_version");
  if (!builtAt && !refitAt) return "";
  return `${version}|${builtAt}|${refitAt}`;
}

/** Item identity row for the overlay: item_id IS the graph node id (R1); source_file is its abs path. */
export interface ItemIdentity {
  itemId: string;
  sourceFile: string;
}

/** Every item's id + owning abs path — the overlay's edge-`source_file` source (R9). */
export function listAllItems(db = getSemanticDb()): ItemIdentity[] {
  return db
    .prepare("SELECT item_id AS itemId, source_file AS sourceFile FROM semantic_items ORDER BY item_id")
    .all() as ItemIdentity[];
}

/** One lineage hop (old_topic_id → new_topic_id) for the position warm-start. */
export interface LineageHop {
  op: string;
  oldTopicId: string | null;
  newTopicId: string | null;
}

/**
 * All lineage rows with both endpoints, ordered oldest-first — the overlay copies the
 * old topic node's persisted position to the new node so a re-fit warm-starts (Graph §5).
 */
export function listAllLineage(db = getSemanticDb()): LineageHop[] {
  return db
    .prepare(
      `SELECT op, old_topic_id AS oldTopicId, new_topic_id AS newTopicId
       FROM topic_lineage WHERE old_topic_id IS NOT NULL AND new_topic_id IS NOT NULL ORDER BY id`,
    )
    .all() as LineageHop[];
}

/** One entity↔entity co-occurrence (two entities sharing `count` items). Undirected (a<b). */
export interface EntityCoOccurrence {
  entityA: string;
  entityB: string;
  count: number;
}

/**
 * Entity pairs that co-occur in ≥ `minItems` items, computed via a self-join on
 * item_entities (canonical a<b ordering so each pair appears once). This is the only
 * co-occurrence source — `semantic.sqlite` doesn't store it; the graph derives it.
 */
export function listEntityCoOccurrences(minItems = 2, db = getSemanticDb()): EntityCoOccurrence[] {
  return db
    .prepare(
      `SELECT a.entity_id AS entityA, b.entity_id AS entityB, COUNT(*) AS count
       FROM item_entities a JOIN item_entities b
         ON a.item_id = b.item_id AND a.entity_id < b.entity_id
       GROUP BY a.entity_id, b.entity_id
       HAVING COUNT(*) >= ?
       ORDER BY count DESC, entityA, entityB`,
    )
    .all(minItems) as EntityCoOccurrence[];
}

/** One item↔item embedding-similarity edge (cosine above the floor). Undirected (a<b). */
export interface ItemSimilarity {
  itemA: string;
  itemB: string;
  cosine: number;
}

/**
 * Whole-corpus item↔item KNN over the canonical chunk BLOBs (R5), rolled up to items by
 * MAX cosine (R8 — a single strongly-matching chunk surfaces its item) and de-duplicated
 * to the top-`topM` neighbors per item above `minCosine`. Returns canonical (a<b) pairs so
 * the overlay mints each `similar` edge once. The BLOB path is correct with or without vec.
 */
export function listAllItemSimilarities(
  opts: { minCosine?: number; topM?: number } = {},
  db = getSemanticDb(),
): ItemSimilarity[] {
  const minCosine = opts.minCosine ?? 0.78;
  const topM = Math.max(1, opts.topM ?? 5);
  const chunks = loadChunkVectors(db, "");
  if (chunks.length === 0) return [];

  // Group chunk vectors by item so the roll-up is per-item, not per-chunk.
  const byItem = new Map<string, Float32Array[]>();
  for (const c of chunks) {
    const list = byItem.get(c.itemId) ?? [];
    list.push(c.vec);
    byItem.set(c.itemId, list);
  }
  const items = [...byItem.keys()].sort();

  // For each item, max-cosine to every other item over their chunk cross-product, then
  // keep the top-M neighbors above the floor. Accumulate into a canonical (a<b) map so a
  // pair surfaced from either side is recorded once (max wins on the symmetric collision).
  const pairs = new Map<string, ItemSimilarity>();
  for (const itemA of items) {
    const aVecs = byItem.get(itemA)!;
    const neighborScores: Array<{ item: string; cosine: number }> = [];
    for (const itemB of items) {
      if (itemB === itemA) continue;
      let best = -Infinity;
      for (const av of aVecs) {
        for (const bv of byItem.get(itemB)!) {
          const s = cosineSimilarity(av, bv);
          if (s > best) best = s;
        }
      }
      if (best >= minCosine) neighborScores.push({ item: itemB, cosine: best });
    }
    neighborScores.sort((x, y) => y.cosine - x.cosine || (x.item < y.item ? -1 : 1));
    for (const n of neighborScores.slice(0, topM)) {
      const [a, b] = itemA < n.item ? [itemA, n.item] : [n.item, itemA];
      const key = `${a} ${b}`;
      const prev = pairs.get(key);
      if (!prev || n.cosine > prev.cosine) pairs.set(key, { itemA: a, itemB: b, cosine: n.cosine });
    }
  }
  return [...pairs.values()].sort(
    (x, y) => y.cosine - x.cosine || (x.itemA < y.itemA ? -1 : 1) || (x.itemB < y.itemB ? -1 : 1),
  );
}

/** Build/coverage status — drives the CLI "not built" guard. */
export function status(db = getSemanticDb()): SemanticStatus {
  const count = (sql: string): number => Number((db.prepare(sql).get() as { c: number }).c);
  const items = count("SELECT COUNT(*) AS c FROM semantic_items");
  const builtAt = (db.prepare("SELECT value FROM semantic_meta WHERE key = 'built_at'").get() as { value: string } | undefined)?.value ?? null;
  return {
    built: items > 0,
    items,
    chunks: count("SELECT COUNT(*) AS c FROM chunks"),
    embeddedChunks: count("SELECT COUNT(*) AS c FROM chunks WHERE embedding_blob IS NOT NULL"),
    entities: count("SELECT COUNT(*) AS c FROM entities"),
    topics: count("SELECT COUNT(*) AS c FROM topics"),
    builtAt,
    activeVersion: getActiveVersion(db),
    versions: listDerivedVersions(db),
  };
}
