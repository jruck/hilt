import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { closeSemanticDbForTests, getMentionsForItem, getSemanticDb, upsertItem } from "./db";
import { extractEntities } from "./extract";
import type { ExtractedEntity } from "./gemini";
import { createFakeSemanticClient } from "./test-helpers";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "SEMANTIC_VEC_DISABLED"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

function withDb(run: (db: ReturnType<typeof getSemanticDb>) => void | Promise<void>): Promise<void> {
  const data = mkdtempSync(join(tmpdir(), "hilt-sem-extract-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = data;
  process.env.HILT_SEMANTIC_DB_PATH = join(data, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  return Promise.resolve(run(getSemanticDb())).finally(() => {
    closeSemanticDbForTests();
    rmSync(data, { recursive: true, force: true });
  });
}

function seedItem(db: ReturnType<typeof getSemanticDb>, itemId: string, contentHash: string): void {
  upsertItem(
    { itemId, scope: "vault", kind: "note", sourcePath: "/v/n.md", sourceFile: "/v/n.md", title: "Note", contentHash, chunkCount: 1 },
    db,
  );
}

const FOUR_BUCKETS: ExtractedEntity[] = [
  { type: "person", name: "Ada", aliases: ["Ada L."], salience: 1, evidence: "Ada leads" },
  { type: "project", name: "Hilt", aliases: [], salience: 0.6, evidence: "Hilt is built" },
  { type: "idea", name: "RAG", aliases: ["retrieval-augmented generation"], salience: 0.6, evidence: "RAG matters" },
  { type: "source", name: "Anthropic", aliases: [], salience: 0.3, evidence: "Anthropic ships" },
];

describe("extractEntities", () => {
  test("all four buckets round-trip into item_entity_mentions", async () => {
    await withDb(async (db) => {
      const text = "agent note text";
      seedItem(db, "note:abc", "h1");
      const client = createFakeSemanticClient({ extractFixtures: { [text]: FOUR_BUCKETS } });
      const r = await extractEntities({ itemId: "note:abc", contentHash: "h1", text }, { client, db });
      assert.equal(r.skipped, false);
      assert.equal(r.mentions, 4);
      assert.deepEqual(r.byType, { person: 1, project: 1, idea: 1, source: 1 });

      const rows = getMentionsForItem("note:abc", db);
      assert.equal(rows.length, 4);
      const types = new Set(rows.map((m) => m.raw_type));
      assert.deepEqual([...types].sort(), ["idea", "person", "project", "source"]);
      const ada = rows.find((m) => m.raw_name === "Ada")!;
      assert.equal(ada.norm_name, "ada");
      assert.deepEqual(JSON.parse(ada.aliases_json), ["Ada L."]);
      assert.equal(ada.entity_id, null, "mentions are unresolved at extraction time");
      assert.equal(client.calls.extract, 1);
    });
  });

  test("re-extracting an unchanged item makes 0 client calls (idempotent)", async () => {
    await withDb(async (db) => {
      const text = "agent note text";
      seedItem(db, "note:abc", "h1");
      const first = createFakeSemanticClient({ extractFixtures: { [text]: FOUR_BUCKETS } });
      await extractEntities({ itemId: "note:abc", contentHash: "h1", text }, { client: first, db });
      assert.equal(first.calls.extract, 1);

      const second = createFakeSemanticClient({ extractFixtures: { [text]: FOUR_BUCKETS } });
      const r2 = await extractEntities({ itemId: "note:abc", contentHash: "h1", text }, { client: second, db });
      assert.equal(r2.skipped, true);
      assert.equal(second.calls.extract, 0, "unchanged hash+version ⇒ no extract call");
    });
  });

  test("a content edit (new hash) re-extracts that item", async () => {
    await withDb(async (db) => {
      seedItem(db, "note:abc", "h1");
      const c1 = createFakeSemanticClient({ extractFixtures: { "v1 text": FOUR_BUCKETS } });
      await extractEntities({ itemId: "note:abc", contentHash: "h1", text: "v1 text" }, { client: c1, db });

      const c2 = createFakeSemanticClient({
        extractFixtures: { "v2 text": [{ type: "person", name: "Grace", aliases: [], salience: 1, evidence: "Grace now" }] },
      });
      const r = await extractEntities({ itemId: "note:abc", contentHash: "h2", text: "v2 text" }, { client: c2, db });
      assert.equal(r.skipped, false);
      assert.equal(c2.calls.extract, 1);
      const rows = getMentionsForItem("note:abc", db);
      assert.equal(rows.length, 1, "stale mentions replaced");
      assert.equal(rows[0].raw_name, "Grace");
    });
  });

  test("duplicate surface forms within one item fold to a single max-salience mention", async () => {
    await withDb(async (db) => {
      const text = "dup text";
      seedItem(db, "note:dup", "h1");
      const client = createFakeSemanticClient({
        extractFixtures: {
          [text]: [
            { type: "person", name: "Ada", aliases: ["A"], salience: 0.3, evidence: "mention 1" },
            { type: "person", name: "ada", aliases: ["Ada Lovelace"], salience: 1, evidence: "mention 2" },
          ],
        },
      });
      const r = await extractEntities({ itemId: "note:dup", contentHash: "h1", text }, { client, db });
      assert.equal(r.mentions, 1);
      const rows = getMentionsForItem("note:dup", db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].salience, 1, "max salience wins");
      assert.deepEqual(JSON.parse(rows[0].aliases_json).sort(), ["A", "Ada Lovelace"]);
    });
  });

  test("empty text ⇒ no client call, no mentions", async () => {
    await withDb(async (db) => {
      seedItem(db, "note:empty", "h1");
      const client = createFakeSemanticClient();
      const r = await extractEntities({ itemId: "note:empty", contentHash: "h1", text: "   " }, { client, db });
      assert.equal(r.mentions, 0);
      assert.equal(client.calls.extract, 0);
    });
  });
});
