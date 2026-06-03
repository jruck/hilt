import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { closeSemanticDbForTests, getSemanticDb, upsertChunk, upsertItem } from "./db";
import { entityByName, getTopic, itemTopics, listTopics, recentTopics, relatedToItem, status } from "./query";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "SEMANTIC_VEC_DISABLED"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

const NOW = "2026-06-02T00:00:00.000Z";
const V = "v0.1";

function seed(db: ReturnType<typeof getSemanticDb>): void {
  for (const [id, title] of [["note:A", "Alpha"], ["note:B", "Beta"], ["note:C", "Gamma"]] as const) {
    upsertItem({ itemId: id, scope: "vault", kind: "note", sourcePath: `/v/${id}.md`, sourceFile: `/v/${id}.md`, title, contentHash: id });
  }
  // A & B similar, C orthogonal → related(A) ranks B above C.
  upsertChunk({ id: "note:A:0", itemId: "note:A", ordinal: 0, text: "a", embedding: new Float32Array([1, 0, 0]), embeddingModel: "fake" });
  upsertChunk({ id: "note:B:0", itemId: "note:B", ordinal: 0, text: "b", embedding: new Float32Array([0.92, 0.12, 0]), embeddingModel: "fake" });
  upsertChunk({ id: "note:C:0", itemId: "note:C", ordinal: 0, text: "c", embedding: new Float32Array([0, 0, 1]), embeddingModel: "fake" });

  const topic = db.prepare("INSERT INTO topics (id, parent_id, level, label, item_count, trend_score, semantic_version, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  topic.run("t_root", null, 0, "Agents", 5, 0.9, V, NOW);
  topic.run("t_other", null, 0, "Hiring", 2, 0.4, V, NOW);
  topic.run("t_child", "t_root", 1, "Tool use", 3, 0.7, V, NOW);

  const it = db.prepare("INSERT INTO item_topics (item_id, topic_id, score, assigned_by, semantic_version, updated_at) VALUES (?,?,?,?,?,?)");
  it.run("note:A", "t_child", 0.8, "refit", V, NOW);
  it.run("note:B", "t_root", 0.6, "refit", V, NOW);

  db.prepare("INSERT INTO entities (id, type, canonical_name, summary, mention_count, semantic_version, updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("ent:ada", "person", "Ada Lovelace", "first programmer", 1, V, NOW);
  db.prepare("INSERT INTO entity_aliases (entity_id, alias, alias_norm, semantic_version, updated_at) VALUES (?,?,?,?,?)")
    .run("ent:ada", "Ada", "ada", V, NOW);
  db.prepare("INSERT INTO item_entities (item_id, entity_id, salience, semantic_version, updated_at) VALUES (?,?,?,?,?)")
    .run("note:A", "ent:ada", 0.9, V, NOW);
}

function withSeeded(run: (db: ReturnType<typeof getSemanticDb>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-sem-q-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  try {
    const db = getSemanticDb();
    seed(db);
    run(db);
  } finally {
    closeSemanticDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("query layer", () => {
  test("listTopics: top-level by item_count desc; children by parent", () => {
    withSeeded(() => {
      assert.deepEqual(listTopics().map((t) => t.id), ["t_root", "t_other"]);
      assert.deepEqual(listTopics({ parentId: "t_root" }).map((t) => t.id), ["t_child"]);
    });
  });

  test("recentTopics ranks by trend_score", () => {
    withSeeded(() => {
      assert.equal(recentTopics()[0].id, "t_root");
    });
  });

  test("getTopic returns children + member items", () => {
    withSeeded(() => {
      const d = getTopic("t_root");
      assert.ok(d);
      assert.deepEqual(d!.children.map((c) => c.id), ["t_child"]);
      assert.ok(d!.items.some((i) => i.itemId === "note:B"));
      assert.equal(getTopic("nope"), null);
    });
  });

  test("itemTopics lists an item's topics", () => {
    withSeeded(() => {
      assert.deepEqual(itemTopics("note:A").map((t) => t.id), ["t_child"]);
    });
  });

  test("relatedToItem rolls chunk KNN up to items (B before C), excludes self", () => {
    withSeeded(() => {
      const hits = relatedToItem("note:A", 10);
      assert.ok(!hits.some((h) => h.itemId === "note:A"), "self excluded");
      assert.equal(hits[0].itemId, "note:B");
      assert.ok(hits[0].score > (hits.find((h) => h.itemId === "note:C")?.score ?? -1));
      assert.equal(hits[0].title, "Beta");
    });
  });

  test("entityByName resolves by canonical name AND alias, with items", () => {
    withSeeded(() => {
      const a = entityByName("Ada Lovelace");
      const b = entityByName("ada"); // alias
      assert.equal(a?.id, "ent:ada");
      assert.equal(b?.id, "ent:ada");
      assert.ok(a!.items.some((i) => i.itemId === "note:A"));
      assert.equal(entityByName("nobody"), null);
    });
  });

  test("status counts everything; built=true once items exist", () => {
    withSeeded(() => {
      const s = status();
      assert.equal(s.built, true);
      assert.equal(s.items, 3);
      assert.equal(s.chunks, 3);
      assert.equal(s.embeddedChunks, 3);
      assert.equal(s.entities, 1);
      assert.equal(s.topics, 3);
    });
  });
});
