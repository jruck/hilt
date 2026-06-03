import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { ClusterInput, ClusterNode, ClusterResult, RunClustering } from "./cluster";
import {
  closeSemanticDbForTests,
  getAllItemTopics,
  getSemanticDb,
  upsertChunk,
  upsertItem,
  type TopicRow,
} from "./db";
import type { SemanticLlmClient, TopicLabel } from "./gemini";
import { getTopic } from "./query";
import { runTopicRefit } from "./topics";
import { l2normalize } from "./vector";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "SEMANTIC_VEC_DISABLED"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

/** A fake label client: returns a label per cluster (the orchestrator never hits the network). */
function fakeLabelClient(labels: Record<string, TopicLabel> = {}): SemanticLlmClient {
  return {
    async embed(texts) {
      return texts.map(() => l2normalize(Float32Array.from([1, 0, 0, 0])));
    },
    async extractEntities() {
      return [];
    },
    async labelTopics(inputs) {
      return inputs.map((i) => labels[i.clusterId] ?? { clusterId: i.clusterId, label: `Theme ${i.clusterId}`, summary: `summary ${i.clusterId}` });
    },
  };
}

function centroidOf(vecs: Float32Array[]): number[] {
  const n = vecs[0].length;
  const out = new Float32Array(n);
  for (const v of vecs) for (let i = 0; i < n; i++) out[i] += v[i];
  return Array.from(l2normalize(out));
}

/**
 * Build a fake clustering seam from a chunk→leaf assignment + a leaf→parent map. Produces a
 * proper 2-level hierarchy (L0 parents over L1 leaves), computing centroids from the actual
 * vectors the orchestrator ships in — so warm-start centroid matching is exercised honestly.
 */
function fakeClustering(leafOf: Record<string, string>, parentOf: Record<string, string>): RunClustering {
  return async (input: ClusterInput): Promise<ClusterResult> => {
    const vecById = new Map(input.ids.map((id, i) => [id, l2normalize(Float32Array.from(input.vectors[i]))]));
    const leafMembers = new Map<string, string[]>();
    for (const id of input.ids) {
      const leaf = leafOf[id];
      if (!leaf) continue;
      const arr = leafMembers.get(leaf) ?? [];
      arr.push(id);
      leafMembers.set(leaf, arr);
    }
    const parentMembers = new Map<string, string[]>();
    for (const [leaf, members] of leafMembers) {
      const parent = parentOf[leaf];
      if (!parent) continue;
      const arr = parentMembers.get(parent) ?? [];
      arr.push(...members);
      parentMembers.set(parent, arr);
    }
    const hierarchy: ClusterNode[] = [];
    for (const [parent, members] of [...parentMembers].sort()) {
      hierarchy.push({
        clusterId: parent,
        parentId: null,
        level: 0,
        memberIds: members,
        centroid: centroidOf(members.map((m) => vecById.get(m)!)),
        size: members.length,
      });
    }
    for (const [leaf, members] of [...leafMembers].sort()) {
      hierarchy.push({
        clusterId: leaf,
        parentId: parentOf[leaf] ?? null,
        level: parentOf[leaf] ? 1 : 0,
        memberIds: members,
        centroid: centroidOf(members.map((m) => vecById.get(m)!)),
        size: members.length,
      });
    }
    const outliers = input.ids.filter((id) => !leafOf[id]);
    return {
      assignments: input.ids.map((id) => ({ id, leafCluster: leafOf[id] ? 1 : -1, probability: leafOf[id] ? 0.9 : 0 })),
      hierarchy,
      outliers,
      paramsUsed: {},
    };
  };
}

/** Seed a few items each with one embedded chunk (distinct unit vectors per group). */
function seedCorpus(db: ReturnType<typeof getSemanticDb>): void {
  const items: Array<{ id: string; theta: number }> = [
    { id: "note:a", theta: 0.0 },
    { id: "note:b", theta: 0.1 },
    { id: "note:c", theta: 1.5 },
    { id: "note:d", theta: 1.6 },
    { id: "note:e", theta: 3.0 },
    { id: "note:f", theta: 3.1 },
  ];
  for (const it of items) {
    upsertItem(
      { itemId: it.id, scope: "vault", kind: "note", sourcePath: `/v/${it.id}.md`, sourceFile: `/v/${it.id}.md`, title: it.id, contentHash: "h", chunkCount: 1 },
      db,
    );
    const vec = l2normalize(Float32Array.from([Math.cos(it.theta), Math.sin(it.theta), 0, 0]));
    upsertChunk({ id: `${it.id}:0`, itemId: it.id, ordinal: 0, text: `text ${it.id}`, embedding: vec, embeddingModel: "fake" }, db);
  }
}

function withDb(run: (db: ReturnType<typeof getSemanticDb>) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "hilt-sem-topics-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  const db = getSemanticDb();
  return run(db).finally(() => {
    closeSemanticDbForTests();
    rmSync(dir, { recursive: true, force: true });
  });
}

const chunkId = (item: string): string => `${item}:0`;

describe("runTopicRefit — orchestrator over fake cluster + label seams", () => {
  test("produces a ≥2-level hierarchy with item_topics + labels, and a birth lineage row per topic", async () => {
    await withDb(async (db) => {
      seedCorpus(db);
      // 3 leaves (ab, cd, ef) under one root parent P0.
      const leafOf: Record<string, string> = {
        [chunkId("note:a")]: "L1-0",
        [chunkId("note:b")]: "L1-0",
        [chunkId("note:c")]: "L1-1",
        [chunkId("note:d")]: "L1-1",
        [chunkId("note:e")]: "L1-2",
        [chunkId("note:f")]: "L1-2",
      };
      const parentOf: Record<string, string> = { "L1-0": "L0-0", "L1-1": "L0-0", "L1-2": "L0-0" };

      const r = await runTopicRefit({
        client: fakeLabelClient(),
        runClustering: fakeClustering(leafOf, parentOf),
        db,
      });

      assert.equal(r.ran, true);
      assert.equal(r.topics, 4, "1 root + 3 leaves");
      assert.ok(r.rootTopics >= 1, "has a root-level topic");
      assert.equal(r.itemsAssigned, 6, "all six items assigned");

      // The hierarchy is navigable: the root has children, leaves have a parent + items.
      const allTopics = db.prepare("SELECT * FROM topics").all() as TopicRow[];
      const roots = allTopics.filter((t) => t.parent_id === null);
      const leaves = allTopics.filter((t) => t.parent_id !== null);
      assert.equal(roots.length, 1, "one root theme");
      assert.equal(leaves.length, 3, "three leaf themes under it");
      assert.ok(leaves.every((l) => l.parent_id === roots[0].id), "every leaf points at the root");
      assert.ok(allTopics.every((t) => t.label.length > 0), "every topic is labeled");

      // item_topics populated (refit-assigned), centroids stored.
      const memberships = getAllItemTopics(db);
      assert.ok(memberships.length >= 6, "items mapped to topics");
      assert.ok(memberships.every((m) => m.assigned_by === "refit"));

      // First-ever fit: every LEAF topic is a birth (lineage is a leaf-level concern — a
      // parent theme's membership is the union of its children, so parents are not diffed).
      const births = db.prepare("SELECT COUNT(*) AS c FROM topic_lineage WHERE op = 'birth'").get() as { c: number };
      assert.equal(births.c, 3, "first fit births all three leaf topics");

      // getTopic drill-down returns children for the root and lineage for a leaf.
      const detail = getTopic(roots[0].id, {}, db)!;
      assert.equal(detail.children.length, 3);
      const leafDetail = getTopic(leaves[0].id, {}, db)!;
      assert.ok(leafDetail.items.length >= 1, "leaf drill-down returns its items");
      assert.ok(leafDetail.lineage.length >= 1, "leaf has a lineage entry (birth on first fit)");
    });
  });

  test("re-fit over UNCHANGED membership keeps stable topic ids (warm-start carry) and writes carry lineage", async () => {
    await withDb(async (db) => {
      seedCorpus(db);
      const leafOf: Record<string, string> = {
        [chunkId("note:a")]: "L1-0",
        [chunkId("note:b")]: "L1-0",
        [chunkId("note:c")]: "L1-1",
        [chunkId("note:d")]: "L1-1",
        [chunkId("note:e")]: "L1-2",
        [chunkId("note:f")]: "L1-2",
      };
      const parentOf: Record<string, string> = { "L1-0": "L0-0", "L1-1": "L0-0", "L1-2": "L0-0" };
      const cluster = fakeClustering(leafOf, parentOf);

      await runTopicRefit({ client: fakeLabelClient(), runClustering: cluster, db });
      const idsBefore = (db.prepare("SELECT id FROM topics ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);

      // Identical cluster shape again → identical membership → ids reused (carry, not birth).
      const r2 = await runTopicRefit({ client: fakeLabelClient(), runClustering: cluster, db });
      const idsAfter = (db.prepare("SELECT id FROM topics ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);

      assert.deepEqual(idsAfter, idsBefore, "topic ids are stable across an unchanged re-fit");
      assert.ok(r2.lineage.carry >= 1, "stable topics record carry, not birth");
      assert.equal(r2.lineage.birth, 0, "no births on an unchanged re-fit");
    });
  });

  test("a SPLIT (one leaf becomes two) records split lineage and re-homes items", async () => {
    await withDb(async (db) => {
      seedCorpus(db);
      // Pass 1: ef are ONE leaf.
      const v1 = fakeClustering(
        {
          [chunkId("note:a")]: "L1-0",
          [chunkId("note:b")]: "L1-0",
          [chunkId("note:c")]: "L1-1",
          [chunkId("note:d")]: "L1-1",
          [chunkId("note:e")]: "L1-2",
          [chunkId("note:f")]: "L1-2",
        },
        { "L1-0": "L0-0", "L1-1": "L0-0", "L1-2": "L0-0" },
      );
      await runTopicRefit({ client: fakeLabelClient(), runClustering: v1, db });

      // Pass 2: the ef leaf SPLITS into e and f as separate leaves.
      const v2 = fakeClustering(
        {
          [chunkId("note:a")]: "L1-0",
          [chunkId("note:b")]: "L1-0",
          [chunkId("note:c")]: "L1-1",
          [chunkId("note:d")]: "L1-1",
          [chunkId("note:e")]: "L1-2",
          [chunkId("note:f")]: "L1-3",
        },
        { "L1-0": "L0-0", "L1-1": "L0-0", "L1-2": "L0-0", "L1-3": "L0-0" },
      );
      const r2 = await runTopicRefit({ client: fakeLabelClient(), runClustering: v2, db });

      assert.ok(r2.lineage.split >= 2, "the split parent fans out to ≥2 children");
      assert.equal(r2.topics, 5, "1 root + 4 leaves after the split");
    });
  });

  test("clustering ABSTAIN (null) ⇒ no-op, taxonomy unchanged", async () => {
    await withDb(async (db) => {
      seedCorpus(db);
      const abstain: RunClustering = async () => null;
      const r = await runTopicRefit({ client: fakeLabelClient(), runClustering: abstain, db });
      assert.equal(r.ran, false);
      assert.equal((db.prepare("SELECT COUNT(*) AS c FROM topics").get() as { c: number }).c, 0);
    });
  });

  test("empty corpus ⇒ ran:false (nothing to cluster)", async () => {
    await withDb(async (db) => {
      const r = await runTopicRefit({ client: fakeLabelClient(), runClustering: fakeClustering({}, {}), db });
      assert.equal(r.ran, false);
    });
  });
});
