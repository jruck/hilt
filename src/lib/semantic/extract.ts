/**
 * Per-item entity extraction (P2.1, spec §B.2). One Gemini Flash call per item via
 * the injected SemanticLlmClient; the result is written to `item_entity_mentions`.
 *
 * Idempotent on (item_id, item_content_hash, SEMANTIC_VERSION): an item whose mentions
 * already exist at the current content-hash + version is skipped with ZERO client calls,
 * so re-running over an unchanged vault costs nothing. A content edit (new hash) or a
 * version bump re-extracts only the affected items — the model-upgrade-is-a-backfill rule.
 *
 * Fail-soft, never throws: the real client returns `[]` on any HTTP/parse failure (and
 * honors SEMANTIC_DISABLED), so a poison item produces no mentions rather than stalling
 * a thousands-item backfill. All writes run in one db.transaction per item.
 */

import type Database from "better-sqlite3";
import { hashId } from "@/lib/library/utils";
import { deleteMentionsForItem, getSemanticDb, hasMentions, upsertMention } from "./db";
import type { ExtractedEntity, SemanticLlmClient } from "./gemini";
import { SEMANTIC_VERSION, semanticExtractModel } from "./pipeline";

/** Minimal shape extract needs — satisfied by chunking's ItemChunks. */
export interface ExtractInput {
  itemId: string;
  contentHash: string;
  /** The assembled item text to send to Flash (title + body). */
  text: string;
}

export interface ExtractOptions {
  client: SemanticLlmClient;
  db?: Database.Database;
  /** Re-extract even if mentions already exist at this hash+version (default false). */
  force?: boolean;
}

export interface ExtractResult {
  itemId: string;
  skipped: boolean;
  mentions: number;
  byType: Record<ExtractedEntity["type"], number>;
}

/** Normalize a surface form to a blocking key: lowercase, trim, collapse non-alnum to '-'. */
export function normName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic mention id — stable across re-runs at the same version. */
function mentionId(itemId: string, rawType: string, norm: string): string {
  return hashId(`${itemId}|${rawType}|${norm}|${SEMANTIC_VERSION}`);
}

const EMPTY_BY_TYPE = (): Record<ExtractedEntity["type"], number> => ({ person: 0, project: 0, idea: 0, source: 0 });

/**
 * Extract entities for one item and persist its raw mentions. Returns the per-type
 * tally (skipped=true ⇒ unchanged, no client call). The text sent to Flash is the
 * caller's assembled `title + body` (capped upstream by the chunker); we never touch
 * the source bytes (Critical Constraint #2 — markdown stays source of truth).
 */
export async function extractEntities(item: ExtractInput, opts: ExtractOptions): Promise<ExtractResult> {
  const db = opts.db ?? getSemanticDb();
  const byType = EMPTY_BY_TYPE();

  if (!opts.force && hasMentions(item.itemId, item.contentHash, db)) {
    return { itemId: item.itemId, skipped: true, mentions: 0, byType };
  }

  const entities = item.text.trim() ? await opts.client.extractEntities(item.text) : [];
  const extractModel = semanticExtractModel();

  // De-dupe within the item by (type, norm_name): a single canonical mention per
  // typed surface form, max-salience wins, aliases unioned.
  const merged = new Map<string, { e: ExtractedEntity; norm: string }>();
  for (const e of entities) {
    if (!e.name.trim()) continue;
    const norm = normName(e.name);
    if (!norm) continue;
    const key = `${e.type}|${norm}`;
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, { e: { ...e, aliases: [...e.aliases] }, norm });
    } else {
      prior.e.salience = Math.max(prior.e.salience, e.salience);
      for (const a of e.aliases) if (!prior.e.aliases.includes(a)) prior.e.aliases.push(a);
    }
  }

  db.transaction(() => {
    deleteMentionsForItem(item.itemId, db); // clear stale (prior hash/version) mentions
    for (const { e, norm } of merged.values()) {
      upsertMention(
        {
          id: mentionId(item.itemId, e.type, norm),
          itemId: item.itemId,
          rawType: e.type,
          rawName: e.name,
          normName: norm,
          aliases: e.aliases,
          salience: e.salience,
          evidence: e.evidence ?? "",
          extractModel,
          itemContentHash: item.contentHash,
        },
        db,
      );
      byType[e.type] += 1;
    }
  })();

  return { itemId: item.itemId, skipped: false, mentions: merged.size, byType };
}
