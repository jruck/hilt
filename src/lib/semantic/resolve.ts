/**
 * Entity resolution / dedupe (P2.1, spec §B.4–B.6). Two-stage, cheap-filter-then-LLM:
 *
 *   Stage 1 — blocking (no LLM): same-type candidates joined by the union of three
 *     cheap signals — exact normalized name/alias hit, embedding-ANN over the name+
 *     context vector, and a normalized edit-distance fallback. Blocking PROPOSES pairs;
 *     it only auto-merges on an exact-norm hit or a near-identical cosine (auto-merge floor).
 *   Stage 2 — LLM merge-judge (injectable, fail-soft): for clusters above the block floor
 *     but below the auto-merge floor, one judge call per connected component decides
 *     referential identity. An unparseable/empty verdict ⇒ NO merge (every member its own
 *     entity) — the abstain-respecting behavior, never a spurious merge.
 *
 * Determinism: components are processed in hashId order; the canonical id is
 * hashId(type|canonical_name) at CREATION and never recomputed on rename — so the same
 * mentions always resolve to the same canonical id, and delete+rebuild reproduces the
 * canonical set. person/project entities first attempt to adopt an existing graph node
 * id via the injected `reconcile` binding (§B.6) so they never shadow the graph's roster.
 */

import type Database from "better-sqlite3";
import { hashId } from "@/lib/library/utils";
import { semanticAutoMergeSim, semanticBlockSim } from "./config";
import {
  addAlias,
  bindMentionsToEntity,
  findEntityByNorm,
  getAllMentions,
  getSemanticDb,
  recomputeEntityMentionCounts,
  recordEntityMerge,
  upsertEntity,
  upsertItemEntity,
  type EntityRow,
  type MentionRow,
} from "./db";
import type { SemanticLlmClient } from "./gemini";
import { SEMANTIC_EMBEDDING_MODEL } from "./pipeline";
import type { MergeCandidate, MergeJudge, MergeGroup } from "./resolve-prompt";
import { cosineSimilarity } from "./vector";

/** A binding decision from reconcile (§B.6): adopt an existing graph node's id, or mint fresh. */
export interface EntityBinding {
  /** The canonical entity id to use (graph node id when bound, else minted). */
  id: string;
  /** The bound graph node id, or null when this entity has no graph node. */
  graphNodeId: string | null;
  /** A resolved vault page path if one exists (person/project ref), else null. */
  refPath: string | null;
}

/**
 * Reconcile hook: given a resolved canonical (type, canonicalName), return the binding
 * (graph node adoption for person/project; fresh mint for idea/source). Injected so
 * resolve.ts never reaches into graph.sqlite directly.
 */
export type ReconcileBinder = (type: string, canonicalName: string) => EntityBinding;

/** Default binder: mint a fresh id with no graph node (used when no reconcile is wired). */
export function mintBinding(type: string, canonicalName: string): EntityBinding {
  return { id: entityIdFor(type, canonicalName), graphNodeId: null, refPath: null };
}

/** Deterministic canonical entity id at creation time. */
export function entityIdFor(type: string, canonicalName: string): string {
  return hashId(`${type}|${normName(canonicalName)}`);
}

/** Same normalization as extract.ts (kept local to avoid a circular import). */
export function normName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface ResolveOptions {
  client: SemanticLlmClient;
  judge: MergeJudge;
  db?: Database.Database;
  /** Bind person/project entities to existing graph nodes; defaults to fresh mint. */
  reconcile?: ReconcileBinder;
}

export interface ResolveResult {
  entitiesTotal: number;
  merges: number;
  judgeCalls: number;
  byType: Record<string, number>;
}

/** A blocking unit: a mention plus its name+context embedding (lazy, computed in batch). */
interface ResolveItem {
  norm: string;
  name: string;
  evidence: string;
  mentionIds: string[];
  salience: number; // max across folded mentions
  aliases: Set<string>;
  itemIds: Set<string>; // items that mention this surface form
  vec?: Float32Array;
}

// ---------------------------------------------------------------------------
// Levenshtein (normalized) — cheap typo/casing fallback for short names.
// ---------------------------------------------------------------------------
function editRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return 1 - prev[n] / Math.max(m, n);
}

// ---------------------------------------------------------------------------
// Union-find over the same-type blocking graph.
// ---------------------------------------------------------------------------
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/**
 * Fold all of a type's mentions into one ResolveItem per (type, norm_name), then
 * embed each name+context string once via the injected client.
 */
async function foldAndEmbed(client: SemanticLlmClient, mentions: MentionRow[]): Promise<ResolveItem[]> {
  const byNorm = new Map<string, ResolveItem>();
  for (const m of mentions) {
    let item = byNorm.get(m.norm_name);
    if (!item) {
      item = {
        norm: m.norm_name,
        name: m.raw_name,
        evidence: m.evidence,
        mentionIds: [],
        salience: 0,
        aliases: new Set<string>(),
        itemIds: new Set<string>(),
      };
      byNorm.set(m.norm_name, item);
    }
    item.mentionIds.push(m.id);
    item.salience = Math.max(item.salience, m.salience);
    item.itemIds.add(m.item_id);
    for (const a of safeAliases(m.aliases_json)) item.aliases.add(a);
  }
  const items = [...byNorm.values()].sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));
  if (items.length > 0) {
    const vecs = await client.embed(items.map((i) => `${i.name} — ${i.evidence}`));
    items.forEach((i, idx) => (i.vec = vecs[idx]));
  }
  return items;
}

function safeAliases(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Resolve all mentions in the corpus into canonical entities (cold-start global pass,
 * also the warm-started periodic reconcile). Processes each type independently. Writes
 * entities/entity_aliases/item_entities, binds mentions, records entity_merges, and
 * recomputes mention counts. All writes run in one db.transaction.
 */
export async function resolveAll(opts: ResolveOptions): Promise<ResolveResult> {
  const db = opts.db ?? getSemanticDb();
  const reconcile = opts.reconcile ?? mintBinding;
  const blockSim = semanticBlockSim();
  const autoMergeSim = semanticAutoMergeSim();
  const all = getAllMentions(db);
  const byType = new Map<string, MentionRow[]>();
  for (const m of all) {
    const arr = byType.get(m.raw_type);
    if (arr) arr.push(m);
    else byType.set(m.raw_type, [m]);
  }

  const result: ResolveResult = { entitiesTotal: 0, merges: 0, judgeCalls: 0, byType: {} };

  for (const type of [...byType.keys()].sort()) {
    const items = await foldAndEmbed(opts.client, byType.get(type)!);
    if (items.length === 0) continue;

    // Stage 1 — build the blocking graph. Edges: exact-norm (always), high cosine,
    // or high edit-ratio. Track which edges are "auto-merge" (no judge needed).
    const uf = new UnionFind(items.length);
    const autoMergeEdges = new Set<string>(); // "i:j" pairs that auto-merge
    const proposed = new Set<string>(); // "i:j" pairs that need the judge
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const cos = a.vec && b.vec ? cosineSimilarity(a.vec, b.vec) : 0;
        const edit = editRatio(a.norm, b.norm);
        if (cos >= autoMergeSim || a.norm === b.norm) {
          uf.union(i, j);
          autoMergeEdges.add(`${i}:${j}`);
        } else if (cos >= blockSim || edit >= 0.9) {
          uf.union(i, j);
          proposed.add(`${i}:${j}`);
        }
      }
    }

    // Group items into connected components, processed in deterministic (lowest-index) order.
    const components = new Map<number, number[]>();
    for (let i = 0; i < items.length; i++) {
      const root = uf.find(i);
      const arr = components.get(root);
      if (arr) arr.push(i);
      else components.set(root, [i]);
    }

    const groupsToWrite: Array<{ canonical: ResolveItem; members: ResolveItem[]; reason: string }> = [];
    for (const idxs of [...components.values()].sort((x, y) => x[0] - y[0])) {
      const members = idxs.map((i) => items[i]);
      // A component with any "proposed" (ambiguous) edge gets a judge call; a pure
      // auto-merge / singleton component skips the LLM entirely.
      const needsJudge = idxs.some((i) =>
        idxs.some((j) => i < j && proposed.has(`${i}:${j}`) && !autoMergeEdges.has(`${i}:${j}`)),
      );
      if (members.length === 1 || !needsJudge) {
        // Auto-merge the whole component (or a singleton) into one canonical entity.
        groupsToWrite.push({ canonical: pickCanonical(members), members, reason: members.length > 1 ? "auto-merge: exact/near-identical" : "" });
        continue;
      }
      // Ambiguous → ask the judge; fail-soft = no merge (each member its own entity).
      result.judgeCalls += 1;
      const candidates: MergeCandidate[] = members.map((m) => ({ name: m.name, evidence: m.evidence }));
      let verdict: MergeGroup[] = [];
      try {
        verdict = await opts.judge(type, candidates);
      } catch {
        verdict = [];
      }
      const byName = new Map(members.map((m) => [m.name, m]));
      const claimed = new Set<ResolveItem>();
      for (const g of verdict) {
        const grouped = g.members.map((n) => byName.get(n)).filter((m): m is ResolveItem => Boolean(m) && !claimed.has(m!));
        if (grouped.length === 0) continue;
        for (const m of grouped) claimed.add(m);
        const canonical = grouped.find((m) => m.name === g.canonicalName) ?? pickCanonical(grouped);
        groupsToWrite.push({ canonical, members: grouped, reason: g.reason || "judge: same entity" });
      }
      // Any member the judge omitted (or on an abstain) stays its own entity.
      for (const m of members) if (!claimed.has(m)) groupsToWrite.push({ canonical: m, members: [m], reason: "" });
    }

    // Persist this type's groups in one pass.
    let typeCount = 0;
    db.transaction(() => {
      for (const g of groupsToWrite) {
        const binding = reconcile(type, g.canonical.name);
        // Warm-start: if an entity already exists at this canonical norm (or an alias),
        // reuse its id so canonical ids stay stable across re-fits. A graph-node binding
        // takes precedence (it IS the canonical id).
        const existing: EntityRow | null = binding.graphNodeId ? null : findEntityByNorm(type, normName(g.canonical.name), db);
        const entityId = binding.graphNodeId ? binding.id : existing?.id ?? binding.id;
        const salience = Math.max(...g.members.map((m) => m.salience), 0);
        upsertEntity(
          {
            id: entityId,
            type,
            canonicalName: g.canonical.name,
            refPath: binding.refPath,
            graphNodeId: binding.graphNodeId,
            embedding: g.canonical.vec ?? null,
            embeddingModel: g.canonical.vec ? SEMANTIC_EMBEDDING_MODEL : null,
          },
          db,
        );
        const itemIds = new Set<string>();
        for (const m of g.members) {
          bindMentionsToEntity(m.mentionIds, entityId, db);
          addAlias(entityId, m.name, db);
          for (const a of m.aliases) addAlias(entityId, a, db);
          for (const it of m.itemIds) itemIds.add(it);
          if (m !== g.canonical) {
            recordEntityMerge(entityIdFor(type, m.name), entityId, g.reason, db);
            result.merges += 1;
          }
        }
        for (const it of itemIds) upsertItemEntity(it, entityId, salience, db);
        typeCount += 1;
      }
    })();
    result.byType[type] = typeCount;
    result.entitiesTotal += typeCount;
  }

  recomputeEntityMentionCounts(db);
  return result;
}

/** Choose the surviving canonical: highest salience, then most items, then lexical. */
function pickCanonical(members: ResolveItem[]): ResolveItem {
  return [...members].sort(
    (a, b) => b.salience - a.salience || b.itemIds.size - a.itemIds.size || (a.norm < b.norm ? -1 : 1),
  )[0];
}
