/**
 * Cold-start backfill — scan the vault → chunk → embed → upsert. Idempotent and
 * resumable: an item whose `content_hash` is unchanged and whose chunks are already
 * embedded at the current `SEMANTIC_VERSION` is skipped, so re-running over an
 * unchanged vault is a no-op (zero embed calls). The LLM client is injected (real
 * Gemini in the CLI, the deterministic fake in tests — no live calls in CI).
 *
 * Embeddings are computed OUTSIDE the write transaction (network is async); the
 * per-item upsert (item + chunk rows) then runs in one synchronous transaction.
 */

import type Database from "better-sqlite3";
import { collectItems, type ItemChunks } from "./chunking";
import {
  countEmbeddedChunks,
  deleteChunksForItem,
  getItem,
  getMeta,
  getSemanticDb,
  setActiveVersion,
  setMeta,
  upsertChunk,
  upsertItem,
} from "./db";
import type { ClusterInput, RunClustering } from "./cluster";
import { extractEntities } from "./extract";
import type { SemanticLlmClient } from "./gemini";
import { SEMANTIC_COMPONENTS, SEMANTIC_EMBEDDING_MODEL, SEMANTIC_VERSION } from "./pipeline";
import { createReconcileBinder } from "./reconcile";
import { resolveAll } from "./resolve";
import { createGeminiMergeJudge, type MergeJudge } from "./resolve-prompt";
import { runTopicRefit } from "./topics";

export interface ColdStartOptions {
  client: SemanticLlmClient;
  root?: string;
  db?: Database.Database;
  /** Cap items processed (slice — for a cheap real smoke over part of the vault). */
  limit?: number;
  onProgress?: (done: number, total: number, itemId: string) => void;
  /**
   * Run the entity layer (extract → resolve → reconcile) after embedding. Default true.
   * The merge-judge defaults to the real Gemini judge; tests inject a fake to stay offline.
   */
  extractEntities?: boolean;
  judge?: MergeJudge;
  /**
   * Run the topic re-fit (cluster → label → lineage) after the entity layer. Default true.
   * `runClustering` defaults to the real `uv` sidecar; tests inject a fake to stay offline.
   * Abstains gracefully (taxonomy unchanged) when the sidecar is unavailable.
   */
  refitTopics?: boolean;
  runClustering?: RunClustering;
  clusterParams?: ClusterInput["params"];
  /**
   * Bless this build's SEMANTIC_VERSION as the active baseline (flip `active_version` +
   * stamp the component versions). Default: bless on a true cold-start (no prior
   * `active_version`), but DON'T overwrite an existing baseline on a re-analysis pass —
   * a SEMANTIC_VERSION bump writes new-version rows that coexist with the live baseline
   * until explicitly blessed (the sample lane). Pass `true` to force a bless, `false` to
   * never bless (a coexistence/sample run).
   */
  blessActive?: boolean;
}

export interface ColdStartResult {
  itemsTotal: number;
  itemsEmbedded: number;
  itemsSkipped: number;
  chunksEmbedded: number;
  embedCalls: number;
  /** Entity-layer tallies (0 when extractEntities is disabled). */
  itemsExtracted: number;
  entitiesResolved: number;
  entityMerges: number;
  /** Topic-layer tallies (topicsTotal=0 when refit disabled or clustering abstained). */
  topicsTotal: number;
  topicsItemsAssigned: number;
}

function itemUnchanged(itemId: string, contentHash: string, chunkLen: number, db: Database.Database): boolean {
  const existing = getItem(itemId, db);
  if (!existing || existing.content_hash !== contentHash || existing.semantic_version !== SEMANTIC_VERSION) return false;
  return chunkLen > 0 && countEmbeddedChunks(itemId, db) === chunkLen;
}

/** Assemble the item text sent to Flash extraction — the chunk texts rejoined. */
function itemText(item: ItemChunks): string {
  return item.chunks.map((c) => c.text).join(" ");
}

export async function runColdStart(opts: ColdStartOptions): Promise<ColdStartResult> {
  const db = opts.db ?? getSemanticDb();
  let items = collectItems(opts.root);
  if (opts.limit && opts.limit > 0) items = items.slice(0, opts.limit);

  const result: ColdStartResult = {
    itemsTotal: items.length,
    itemsEmbedded: 0,
    itemsSkipped: 0,
    chunksEmbedded: 0,
    embedCalls: 0,
    itemsExtracted: 0,
    entitiesResolved: 0,
    entityMerges: 0,
    topicsTotal: 0,
    topicsItemsAssigned: 0,
  };
  let done = 0;
  for (const item of items) {
    done += 1;
    opts.onProgress?.(done, items.length, item.itemId);

    if (itemUnchanged(item.itemId, item.contentHash, item.chunks.length, db)) {
      result.itemsSkipped += 1;
      continue;
    }

    let vecs: Float32Array[] = [];
    if (item.chunks.length > 0) {
      vecs = await opts.client.embed(item.chunks.map((c) => c.text));
      result.embedCalls += 1;
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

    result.itemsEmbedded += 1;
    result.chunksEmbedded += item.chunks.length;
  }

  // Entity layer: per-item extraction (idempotent) then one global resolve+reconcile pass.
  if (opts.extractEntities !== false) {
    for (const item of items) {
      const r = await extractEntities({ itemId: item.itemId, contentHash: item.contentHash, text: itemText(item) }, { client: opts.client, db });
      if (!r.skipped) result.itemsExtracted += 1;
    }
    const { binder, close } = createReconcileBinder();
    try {
      const judge = opts.judge ?? createGeminiMergeJudge();
      const rr = await resolveAll({ client: opts.client, judge, db, reconcile: binder });
      result.entitiesResolved = rr.entitiesTotal;
      result.entityMerges = rr.merges;
    } finally {
      close();
    }
  }

  // Topic layer: a single global re-fit (cluster → label → lineage) over the embedded
  // chunks. Abstains gracefully (topicsTotal stays 0) when the sidecar is unavailable.
  if (opts.refitTopics !== false) {
    const rt = await runTopicRefit({
      client: opts.client,
      runClustering: opts.runClustering,
      clusterParams: opts.clusterParams,
      db,
    });
    result.topicsTotal = rt.topics;
    result.topicsItemsAssigned = rt.itemsAssigned;
  }

  setMeta("built_at", new Date().toISOString(), db);

  // Bless the active baseline. On a true cold-start (no prior active_version) the new
  // build IS the baseline; on a re-analysis pass we leave the prior baseline live so the
  // new (decimal) version coexists and is reviewed before blessing (P2.4 coexistence rule).
  // `blessActive` forces or suppresses that decision.
  const hadBaseline = getMeta("active_version", db) !== null;
  const bless = opts.blessActive ?? !hadBaseline;
  if (bless) {
    setActiveVersion(
      SEMANTIC_VERSION,
      { embedding: SEMANTIC_COMPONENTS.embedding, extraction: SEMANTIC_COMPONENTS.extraction, taxonomy: SEMANTIC_COMPONENTS.taxonomy },
      db,
    );
  }
  setMeta("last_backfill_version", SEMANTIC_VERSION, db);
  setMeta("last_backfill_at", new Date().toISOString(), db);
  return result;
}
