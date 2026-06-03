/**
 * P2.4 — versioning, format-version invalidation, and the backfill-coexistence + gc contract.
 *
 * Asserts the "model upgrade is a backfill, not a migration" rules:
 *   - SEMANTIC_VERSION parses to the integer/decimal scheme the Library uses.
 *   - SEMANTIC_DB_FORMAT_VERSION is orthogonal (LAYOUT_VERSION precedent) and invalidates the
 *     cache file independently when it lags.
 *   - A version bump writes new-version rows WITHOUT deleting prior-version rows until blessed.
 *   - gcStaleVersions() drops `version != active_version` AFTER the bless flip (analog of the
 *     Library candidates cleanup).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  closeSemanticDbForTests,
  countRowsAtVersion,
  gcStaleVersions,
  getActiveVersion,
  getMeta,
  getSemanticDb,
  listDerivedVersions,
  setActiveVersion,
  upsertChunk,
  upsertItem,
} from "./db";
import {
  isPublishedVersion,
  parseSemanticVersion,
  SEMANTIC_DB_FORMAT_VERSION,
  SEMANTIC_VERSION,
} from "./pipeline";

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

function withTempSemantic(run: (db: ReturnType<typeof getSemanticDb>, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-semantic-version-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  try {
    run(getSemanticDb(), dir);
  } finally {
    closeSemanticDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Seed an item + one chunk, then re-stamp them at `version` (simulates a coexisting pass). */
function seedItemAtVersion(db: ReturnType<typeof getSemanticDb>, itemId: string, version: string): void {
  upsertItem({ itemId, scope: "vault", kind: "note", sourcePath: `/v/${itemId}.md`, sourceFile: `/v/${itemId}.md`, contentHash: `h-${itemId}` }, db);
  upsertChunk({ id: `${itemId}:0`, itemId, ordinal: 0, text: "x", embedding: new Float32Array([1, 0]), embeddingModel: "m" }, db);
  db.prepare("UPDATE semantic_items SET semantic_version = ? WHERE item_id = ?").run(version, itemId);
  db.prepare("UPDATE chunks SET semantic_version = ? WHERE item_id = ?").run(version, itemId);
}

describe("SEMANTIC_VERSION + format version", () => {
  test("SEMANTIC_VERSION parses to the vN/vN.M integer-vs-decimal scheme", () => {
    const parsed = parseSemanticVersion(SEMANTIC_VERSION);
    assert.ok(parsed, `SEMANTIC_VERSION ${SEMANTIC_VERSION} must parse`);
    assert.equal(parseSemanticVersion("v2")?.minor, 0);
    assert.equal(parseSemanticVersion("v1.4")?.major, 1);
    assert.equal(parseSemanticVersion("v1.4")?.minor, 4);
    assert.equal(parseSemanticVersion("nope"), null);
    assert.equal(isPublishedVersion("v2"), true, "integer = published baseline");
    assert.equal(isPublishedVersion("v0.1"), false, "decimal = test lane");
    assert.equal(isPublishedVersion("v1.4"), false);
  });

  test("format version is stamped fresh and is orthogonal to SEMANTIC_VERSION", () => {
    withTempSemantic((db) => {
      assert.equal(getMeta("db_format_version", db), String(SEMANTIC_DB_FORMAT_VERSION));
      // active_version defaults to the headline when unset (no backfill yet).
      assert.equal(getActiveVersion(db), SEMANTIC_VERSION);
    });
  });

  test("a stale db_format_version invalidates the cache file (LAYOUT_VERSION precedent)", () => {
    withTempSemantic((db, dir) => {
      // Seed a row, then forge an OLD format stamp + a now-removed legacy table.
      seedItemAtVersion(db, "note:a", SEMANTIC_VERSION);
      db.prepare("UPDATE semantic_meta SET value = '0' WHERE key = 'db_format_version'").run();
      db.exec("CREATE TABLE IF NOT EXISTS legacy_junk (x TEXT)");
      assert.equal(countRowsAtVersion(SEMANTIC_VERSION, db) > 0, true, "row present before reopen");

      // Reopen: getSemanticDb detects the stale format and discards every derived table.
      closeSemanticDbForTests();
      process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
      const db2 = getSemanticDb();
      assert.equal(getMeta("db_format_version", db2), String(SEMANTIC_DB_FORMAT_VERSION), "re-stamped current");
      assert.equal(countRowsAtVersion(SEMANTIC_VERSION, db2), 0, "stale-format file invalidated → empty");
      const tables = (db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name);
      assert.ok(tables.includes("semantic_items"), "schema recreated at current format");
    });
  });

  test("coexistence: a version bump writes new rows WITHOUT deleting the prior baseline", () => {
    withTempSemantic((db) => {
      // Baseline v1 (blessed) + a coexisting decimal v1.1 sample lane.
      seedItemAtVersion(db, "note:base", "v1");
      setActiveVersion("v1", {}, db);
      seedItemAtVersion(db, "note:sample", "v1.1");

      assert.deepEqual(listDerivedVersions(db), ["v1", "v1.1"], "both versions coexist pre-bless");
      assert.equal(getActiveVersion(db), "v1", "active baseline unchanged by the sample pass");
      assert.ok(countRowsAtVersion("v1", db) > 0);
      assert.ok(countRowsAtVersion("v1.1", db) > 0);
    });
  });

  test("blessing flips active_version then gc drops the superseded rows", () => {
    withTempSemantic((db) => {
      seedItemAtVersion(db, "note:base", "v1");
      setActiveVersion("v1", {}, db);
      seedItemAtVersion(db, "note:sample", "v1.1");

      // GC before blessing would (correctly) drop the NEW lane, not the old — so we bless first.
      setActiveVersion("v2", { embedding: "e", extraction: "x", taxonomy: "t" }, db);
      assert.equal(getActiveVersion(db), "v2");
      assert.equal(getMeta("active_embedding", db), "e");

      // Re-stamp the blessed lane to the integer it was promoted to (the decimal → integer rule).
      db.prepare("UPDATE semantic_items SET semantic_version = 'v2' WHERE item_id = 'note:sample'").run();
      db.prepare("UPDATE chunks SET semantic_version = 'v2' WHERE item_id = 'note:sample'").run();

      const r = gcStaleVersions(db);
      assert.equal(r.activeVersion, "v2");
      assert.ok(r.rowsRemoved > 0, "stale v1 rows removed");
      assert.deepEqual(listDerivedVersions(db), ["v2"], "only the blessed version survives");
      assert.equal(countRowsAtVersion("v1", db), 0);
      assert.ok(countRowsAtVersion("v2", db) > 0);
      assert.ok(getMeta("gc_at", db), "gc stamps a timestamp");
    });
  });
});
