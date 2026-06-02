import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  closeSemanticDbForTests,
  countChunks,
  deleteItem,
  getItem,
  getMeta,
  getSemanticDb,
  isSemanticVecAvailable,
  setMeta,
  upsertChunk,
  upsertItem,
} from "./db";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "SEMANTIC_VEC_DISABLED"] as const;
const originalEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function withTempSemantic(run: (db: ReturnType<typeof getSemanticDb>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-semantic-test-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1"; // deterministic: BLOB fallback regardless of host
  try {
    run(getSemanticDb());
  } finally {
    closeSemanticDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("semantic db", () => {
  test("schema: WAL, foreign_keys ON, all tables, vec0 absent in fallback mode", () => {
    withTempSemantic((db) => {
      assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
      assert.equal(db.pragma("foreign_keys", { simple: true }), 1, "foreign_keys must be ON (R4)");
      assert.equal(isSemanticVecAvailable(), false, "vec off under SEMANTIC_VEC_DISABLED");
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((r) => r.name);
      for (const t of ["semantic_meta", "semantic_items", "chunks", "entities", "entity_aliases", "topics", "item_entities", "item_topics", "topic_lineage"]) {
        assert.ok(tables.includes(t), `missing table ${t}`);
      }
      // vec0 virtual tables must NOT exist when the extension didn't load.
      assert.ok(!tables.includes("chunk_vectors"), "chunk_vectors should be absent in BLOB-fallback mode");
    });
  });

  test("item upsert round-trips and overwrites every mutable column", () => {
    withTempSemantic(() => {
      upsertItem({ itemId: "note:a", scope: "vault", kind: "note", sourcePath: "/v/a.md", sourceFile: "/v/a.md", contentHash: "h1" });
      const first = getItem("note:a");
      assert.ok(first);
      assert.equal(first.kind, "note");
      assert.equal(first.content_hash, "h1");
      assert.equal(first.semantic_version, "v0.1");

      upsertItem({ itemId: "note:a", scope: "vault", kind: "meeting", sourcePath: "/v/a2.md", sourceFile: "/v/a2.md", title: "Renamed", contentHash: "h2", chunkCount: 3 });
      const second = getItem("note:a");
      assert.equal(second?.kind, "meeting");
      assert.equal(second?.title, "Renamed");
      assert.equal(second?.content_hash, "h2");
      assert.equal(second?.chunk_count, 3);
    });
  });

  test("chunk embedding BLOB round-trips bit-identical (LE float32)", () => {
    withTempSemantic((db) => {
      upsertItem({ itemId: "note:a", scope: "vault", kind: "note", sourcePath: "/v/a.md", sourceFile: "/v/a.md", contentHash: "h1" });
      const vec = new Float32Array([0.5, -0.25, 1, 0]);
      upsertChunk({ id: "note:a:0", itemId: "note:a", ordinal: 0, text: "hello", embedding: vec, embeddingModel: "gemini-embedding-001" });
      const row = db.prepare("SELECT embedding_blob, dim, embedding_model FROM chunks WHERE id = ?").get("note:a:0") as { embedding_blob: Buffer; dim: number; embedding_model: string };
      assert.equal(row.dim, 4);
      assert.equal(row.embedding_model, "gemini-embedding-001");
      const back = new Float32Array(row.embedding_blob.buffer, row.embedding_blob.byteOffset, row.embedding_blob.byteLength / 4);
      assert.deepEqual(Array.from(back), [0.5, -0.25, 1, 0]);
    });
  });

  test("FK cascade: deleting an item removes its chunks", () => {
    withTempSemantic(() => {
      upsertItem({ itemId: "note:a", scope: "vault", kind: "note", sourcePath: "/v/a.md", sourceFile: "/v/a.md", contentHash: "h1" });
      upsertChunk({ id: "note:a:0", itemId: "note:a", ordinal: 0, text: "x" });
      upsertChunk({ id: "note:a:1", itemId: "note:a", ordinal: 1, text: "y" });
      assert.equal(countChunks("note:a"), 2);
      deleteItem("note:a");
      assert.equal(getItem("note:a"), null);
      assert.equal(countChunks("note:a"), 0, "FK ON DELETE CASCADE should remove chunks");
    });
  });

  test("meta k/v round-trips", () => {
    withTempSemantic(() => {
      assert.equal(getMeta("built_at"), null);
      setMeta("built_at", "2026-06-01T00:00:00.000Z");
      assert.equal(getMeta("built_at"), "2026-06-01T00:00:00.000Z");
      setMeta("built_at", "later");
      assert.equal(getMeta("built_at"), "later");
    });
  });
});
