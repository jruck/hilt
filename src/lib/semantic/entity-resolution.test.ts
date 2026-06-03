import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  closeSemanticDbForTests,
  getEntitiesByType,
  getMentionsForItem,
  getSemanticDb,
  upsertItem,
  upsertMention,
} from "./db";
import type { SemanticLlmClient } from "./gemini";
import { entityByName } from "./query";
import { entityIdFor, normName, resolveAll } from "./resolve";
import type { MergeGroup, MergeJudge } from "./resolve-prompt";
import { l2normalize } from "./vector";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "SEMANTIC_VEC_DISABLED", "SEMANTIC_BLOCK_SIM", "SEMANTIC_AUTO_MERGE_SIM"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

function withDb(run: (db: ReturnType<typeof getSemanticDb>) => void | Promise<void>): Promise<void> {
  const data = mkdtempSync(join(tmpdir(), "hilt-sem-resolve-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = data;
  process.env.HILT_SEMANTIC_DB_PATH = join(data, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  // No graph.sqlite in the temp dir ⇒ reconcile mints fresh (graph_node_id NULL).
  return Promise.resolve(run(getSemanticDb())).finally(() => {
    closeSemanticDbForTests();
    rmSync(data, { recursive: true, force: true });
  });
}

let mentionSeq = 0;
function seedMention(
  db: ReturnType<typeof getSemanticDb>,
  itemId: string,
  type: string,
  name: string,
  opts: { aliases?: string[]; salience?: number; evidence?: string } = {},
): void {
  upsertItem(
    { itemId, scope: "vault", kind: "note", sourcePath: `/v/${itemId}.md`, sourceFile: `/v/${itemId}.md`, title: itemId, contentHash: "h", chunkCount: 1 },
    db,
  );
  upsertMention(
    {
      id: `m${mentionSeq++}`,
      itemId,
      rawType: type,
      rawName: name,
      normName: normName(name),
      aliases: opts.aliases ?? [],
      salience: opts.salience ?? 1,
      evidence: opts.evidence ?? `${name} appears`,
      extractModel: "fake",
      itemContentHash: "h",
    },
    db,
  );
}

/** A fake client whose embed returns a controllable vector per text (default: distinct). */
function fakeClientWith(vectorOf: (text: string) => Float32Array): SemanticLlmClient {
  return {
    async embed(texts) {
      return texts.map(vectorOf);
    },
    async extractEntities() {
      return [];
    },
    async labelTopics() {
      return [];
    },
  };
}

/** Two basis vectors θ apart in a 4-d space (cosine = cos θ). */
function angled(theta: number): Float32Array {
  return l2normalize(Float32Array.from([Math.cos(theta), Math.sin(theta), 0, 0]));
}

const distinctVecs = (): ((t: string) => Float32Array) => {
  const map = new Map<string, number>();
  return (t: string) => {
    if (!map.has(t)) map.set(t, map.size);
    // Spread far apart on the circle so unrelated names never cross the block floor.
    return angled((map.get(t)! * Math.PI) / 3 + 0.1);
  };
};

const noMergeJudge: MergeJudge = async () => [];

describe("entity resolution / dedupe", () => {
  test("exact-norm duplicate auto-merges into one canonical entity (no judge call)", async () => {
    await withDb(async (db) => {
      seedMention(db, "note:1", "source", "Anthropic");
      seedMention(db, "note:2", "source", "anthropic"); // same norm
      let judgeCalls = 0;
      const judge: MergeJudge = async () => {
        judgeCalls++;
        return [];
      };
      const r = await resolveAll({ client: fakeClientWith(distinctVecs()), judge, db });
      assert.equal(r.byType.source, 1, "one canonical source entity");
      assert.equal(judgeCalls, 0, "exact-norm match needs no LLM");
      const ent = entityByName("Anthropic", db)!;
      assert.equal(ent.items.length, 2, "both items point at the canonical entity");
    });
  });

  test("high cosine + judge 'same' → merged with the other name as an alias", async () => {
    await withDb(async (db) => {
      seedMention(db, "note:1", "idea", "RAG", { salience: 1 });
      seedMention(db, "note:2", "idea", "retrieval-augmented generation", { salience: 0.6 });
      // Put the two name+evidence strings in the JUDGE band: cos(0.4)≈0.921 — above the
      // 0.82 block floor, below the 0.95 auto-merge floor — so the judge is consulted.
      const client = fakeClientWith((t) => (t.startsWith("RAG") ? angled(0) : t.startsWith("retrieval") ? angled(0.4) : angled(2)));
      const judge: MergeJudge = async (_type, cands) => [
        { canonicalName: "retrieval-augmented generation", members: cands.map((c) => c.name), reason: "abbreviation" } as MergeGroup,
      ];
      const r = await resolveAll({ client, judge, db });
      assert.equal(r.byType.idea, 1, "merged into one idea entity");
      assert.equal(r.merges, 1);
      const ent = entityByName("RAG", db);
      assert.ok(ent, "the absorbed surface form resolves via alias");
      assert.equal(ent!.name, "retrieval-augmented generation", "judge's canonical name wins");
    });
  });

  test("high cosine but judge 'different' → kept separate (abstain-respecting)", async () => {
    await withDb(async (db) => {
      seedMention(db, "note:1", "person", "Jon Smith");
      seedMention(db, "note:2", "person", "Jen Smith");
      // Judge band (cos≈0.921): blocking proposes the pair, the judge decides.
      const client = fakeClientWith((t) => (t.startsWith("Jon") ? angled(0) : t.startsWith("Jen") ? angled(0.4) : angled(2)));
      // The judge returns two singleton groups — they are different people.
      const judge: MergeJudge = async (_type, cands) => cands.map((c) => ({ canonicalName: c.name, members: [c.name], reason: "different person" }));
      const r = await resolveAll({ client, judge, db });
      assert.equal(r.byType.person, 2, "two distinct people survive");
      assert.equal(r.merges, 0);
      assert.ok(entityByName("Jon Smith", db));
      assert.ok(entityByName("Jen Smith", db));
    });
  });

  test("the four buckets survive a round-trip with correct type", async () => {
    await withDb(async (db) => {
      seedMention(db, "note:1", "person", "Ada");
      seedMention(db, "note:1", "project", "Hilt");
      seedMention(db, "note:1", "idea", "Agents");
      seedMention(db, "note:1", "source", "Gemini");
      await resolveAll({ client: fakeClientWith(distinctVecs()), judge: noMergeJudge, db });
      assert.equal(getEntitiesByType("person", db).length, 1);
      assert.equal(getEntitiesByType("project", db).length, 1);
      assert.equal(getEntitiesByType("idea", db).length, 1);
      assert.equal(getEntitiesByType("source", db).length, 1);
      // mentions all bound to an entity_id
      for (const m of getMentionsForItem("note:1", db)) assert.ok(m.entity_id, `${m.raw_name} resolved`);
    });
  });

  test("determinism: the canonical id is hashId(type|norm), independent of insertion order", async () => {
    const idA = entityIdFor("source", "Anthropic");
    const idB = entityIdFor("source", "anthropic");
    assert.equal(idA, idB, "canonical id derives from normalized name, not casing");

    await withDb(async (db) => {
      seedMention(db, "note:1", "source", "Anthropic");
      await resolveAll({ client: fakeClientWith(distinctVecs()), judge: noMergeJudge, db });
      const ent = entityByName("Anthropic", db)!;
      assert.equal(ent.id, entityIdFor("source", "Anthropic"));
    });
  });

  test("mention counts are recomputed from item_entities", async () => {
    await withDb(async (db) => {
      seedMention(db, "note:1", "source", "Anthropic");
      seedMention(db, "note:2", "source", "Anthropic");
      await resolveAll({ client: fakeClientWith(distinctVecs()), judge: noMergeJudge, db });
      const ent = entityByName("Anthropic", db)!;
      assert.equal(ent.mentionCount, 2);
    });
  });
});
