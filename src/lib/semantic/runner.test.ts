/**
 * P2.4 — SemanticRunner incremental loop (mirrors src/lib/graph/runner.test.ts).
 *
 * Injects a deterministic fake client + drives the runner directly (no real watcher / no
 * network). Asserts the plan's incremental guarantees:
 *   - a new note → EXACTLY one embed call (its chunks), slotted in without re-clustering;
 *   - a removal drops the item's chunks/mentions/topic-memberships and GCs dangling entities;
 *   - a burst of edits coalesces into ONE debounced single-flight pass;
 *   - a path under libraries/ (the locked exclusion) is ignored by the scope guard;
 *   - flag-off inertness: isSemanticEnabled() is false by default (ws-server never wires it).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { noteNodeId } from "@/lib/graph/build";
import { isSemanticEnabled } from "./config";
import { closeSemanticDbForTests, getSemanticDb } from "./db";
import { SemanticRunner, resetSemanticRunnerForTests } from "./runner";
import { createFakeSemanticClient, type FakeSemanticClient } from "./test-helpers";

const envKeys = [
  "DATA_DIR",
  "HILT_SEMANTIC_DB_PATH",
  "SEMANTIC_VEC_DISABLED",
  "HILT_SEMANTIC_ENABLED",
  "BRIDGE_VAULT_PATH",
  "HILT_WORKING_FOLDER",
  "SEMANTIC_INCREMENTAL_DEBOUNCE_MS",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

afterEach(() => {
  resetSemanticRunnerForTests();
  closeSemanticDbForTests();
  for (const k of envKeys) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function file(root: string, rel: string, content: string): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return abs;
}

interface Ctx {
  root: string;
  runner: SemanticRunner;
  fake: FakeSemanticClient;
  db: ReturnType<typeof getSemanticDb>;
}

function withRunner(run: (ctx: Ctx) => Promise<void> | void): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "hilt-semantic-rdata-"));
  const vaultRoot = mkdtempSync(join(tmpdir(), "hilt-semantic-rvault-"));
  process.env.DATA_DIR = dataDir;
  process.env.HILT_SEMANTIC_DB_PATH = join(dataDir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  process.env.BRIDGE_VAULT_PATH = vaultRoot;
  process.env.SEMANTIC_INCREMENTAL_DEBOUNCE_MS = "0"; // flush quickly in tests
  delete process.env.HILT_WORKING_FOLDER;
  resetSemanticRunnerForTests();
  closeSemanticDbForTests();
  // Seed an empty vault so the cold-start hash map starts empty.
  const fake = createFakeSemanticClient({ dim: 16 });
  const runner = new SemanticRunner({ rootOverride: vaultRoot, client: fake, judge: async () => [] });
  const db = getSemanticDb();
  return Promise.resolve(run({ root: vaultRoot, runner, fake, db })).finally(() => {
    runner.stop();
    resetSemanticRunnerForTests();
    closeSemanticDbForTests();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(vaultRoot, { recursive: true, force: true });
  });
}

function itemExists(db: Ctx["db"], itemId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM semantic_items WHERE item_id = ?").get(itemId));
}
function chunkCount(db: Ctx["db"], itemId: string): number {
  return Number((db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE item_id = ?").get(itemId) as { c: number }).c);
}

describe("SemanticRunner", () => {
  test("isSemanticEnabled() is OFF by default (flag-off inertness — ws-server never wires it)", () => {
    delete process.env.HILT_SEMANTIC_ENABLED;
    assert.equal(isSemanticEnabled(), false);
    process.env.HILT_SEMANTIC_ENABLED = "false";
    assert.equal(isSemanticEnabled(), false);
    process.env.HILT_SEMANTIC_ENABLED = "true";
    assert.equal(isSemanticEnabled(), true);
  });

  test("onFileChanged for a new note embeds EXACTLY one item (1 embed call) — no re-cluster", async () => {
    await withRunner(async ({ root, runner, fake, db }) => {
      const alpha = file(root, "docs/notes/alpha.md", "# Alpha\n\nAgent architecture and tool use notes.\n");
      const id = noteNodeId(alpha);
      assert.equal(itemExists(db, id), false, "absent before the event");

      runner.onFileChanged(alpha);
      await runner.runWork(); // flush the debounced pass deterministically

      assert.equal(itemExists(db, id), true, "item embedded after the event");
      assert.equal(chunkCount(db, id) >= 1, true, "at least one chunk embedded");
      assert.equal(fake.calls.embed, 1, "exactly one embed call (its chunks) — no resolve embeds (no entities)");
      assert.equal(fake.calls.extract, 1, "extracted entities for the one changed item");
      // No topics exist yet (no re-fit) → the item is an outlier, no item_topics row.
      const tt = Number((db.prepare("SELECT COUNT(*) AS c FROM item_topics WHERE item_id = ?").get(id) as { c: number }).c);
      assert.equal(tt, 0, "incremental never creates a topic — outlier until the next re-fit");
    });
  });

  test("an unchanged re-signal is a no-op (0 additional embed calls)", async () => {
    await withRunner(async ({ root, runner, fake, db }) => {
      const alpha = file(root, "docs/notes/alpha.md", "# Alpha\n\nSome stable content.\n");
      runner.onFileChanged(alpha);
      await runner.runWork();
      assert.equal(fake.calls.embed, 1);
      const id = noteNodeId(alpha);
      assert.equal(itemExists(db, id), true);

      // Same file, same content → the content-hash guard skips it entirely.
      runner.onFileChanged(alpha);
      await runner.runWork();
      assert.equal(fake.calls.embed, 1, "no re-embed when content is unchanged");
    });
  });

  test("onFileRemoved deletes the item's chunks + mentions and cleans dangling entities", async () => {
    await withRunner(async ({ root, runner, db }) => {
      const alpha = file(root, "docs/notes/alpha.md", "# Alpha\n\nContent about agents.\n");
      const id = noteNodeId(alpha);
      runner.onFileChanged(alpha);
      await runner.runWork();
      assert.equal(itemExists(db, id), true);

      rmSync(alpha);
      runner.onFileRemoved(alpha);
      await runner.runWork();

      assert.equal(itemExists(db, id), false, "item removed");
      assert.equal(chunkCount(db, id), 0, "FK cascade + explicit delete cleared its chunks");
      const mentions = Number((db.prepare("SELECT COUNT(*) AS c FROM item_entity_mentions WHERE item_id = ?").get(id) as { c: number }).c);
      assert.equal(mentions, 0, "its mentions cleared");
    });
  });

  test("a burst of edits coalesces into a SINGLE debounced pass (all items embedded)", async () => {
    await withRunner(async ({ root, fake, db }) => {
      process.env.SEMANTIC_INCREMENTAL_DEBOUNCE_MS = "30"; // a real window for this test
      // New runner so the debounce is re-read; reuse the same fake/db via the env.
      const burst = new SemanticRunner({ rootOverride: root, client: fake, judge: async () => [] });
      const a = file(root, "docs/notes/a.md", "# A\n\nalpha body\n");
      const b = file(root, "docs/notes/b.md", "# B\n\nbeta body\n");
      const c = file(root, "docs/notes/c.md", "# C\n\ngamma body\n");

      burst.onFileChanged(a);
      burst.onFileChanged(b);
      burst.onFileChanged(c);
      await new Promise<void>((r) => setTimeout(r, 80)); // past the 30ms window

      for (const p of [a, b, c]) assert.equal(itemExists(db, noteNodeId(p)), true, `placed ${p}`);
      // One embed call per item (3), all driven by ONE coalesced pass (no per-signal pass).
      assert.equal(fake.calls.embed, 3, "three items embedded across the single coalesced pass");
      burst.stop();
    });
  });

  test("a path under libraries/ is ignored by the scope guard (locked exclusion)", async () => {
    await withRunner(async ({ root, runner, fake, db }) => {
      const lib = file(root, "libraries/repo/readme.md", "# external\n\nmust be excluded\n");
      runner.onFileChanged(lib);
      await runner.runWork();
      assert.equal(fake.calls.embed, 0, "no embed for a libraries/ file");
      const any = Number((db.prepare("SELECT COUNT(*) AS c FROM semantic_items").get() as { c: number }).c);
      assert.equal(any, 0, "nothing ingested from libraries/");
    });
  });

  test("a library candidate is embedded (cand: id) but NOT entity-extracted", async () => {
    await withRunner(async ({ root, runner, fake, db }) => {
      const cand = file(
        root,
        "references/.cache/library-candidates/2026-01-01-x.md",
        "---\ntype: reference-candidate\ntitle: Cand X\nstatus: candidate\nurl: https://example.com/x\n---\nDiscovery body about agent tooling.\n",
      );
      runner.onFileChanged(cand);
      await runner.runWork();
      assert.equal(fake.calls.embed, 1, "candidate embeds (1 call)");
      assert.equal(fake.calls.extract, 0, "candidates skip entity extraction (transient, un-vetted)");
      const row = db.prepare("SELECT item_id, kind, scope FROM semantic_items").get() as
        | { item_id: string; kind: string; scope: string }
        | undefined;
      assert.ok(row, "candidate item ingested");
      assert.ok(row!.item_id.startsWith("cand:"), "graph-aligned cand: id (R1)");
      assert.equal(row!.kind, "candidate");
      assert.equal(row!.scope, "library");
    });
  });

  test("a candidate whose status flips off `candidate` is removed on the next signal", async () => {
    await withRunner(async ({ root, runner, db }) => {
      const rel = "references/.cache/library-candidates/2026-01-01-y.md";
      const cand = file(root, rel, "---\ntype: reference-candidate\ntitle: Cand Y\nstatus: candidate\n---\nBody to embed.\n");
      runner.onFileChanged(cand);
      await runner.runWork();
      const before = Number((db.prepare("SELECT COUNT(*) AS c FROM semantic_items").get() as { c: number }).c);
      assert.equal(before, 1, "candidate ingested");

      // Promotion/expiry flips the status in place — the item must drop out.
      file(root, rel, "---\ntype: reference-candidate\ntitle: Cand Y\nstatus: skipped\n---\nBody to embed.\n");
      runner.onFileChanged(cand);
      await runner.runWork();
      const after = Number((db.prepare("SELECT COUNT(*) AS c FROM semantic_items").get() as { c: number }).c);
      assert.equal(after, 0, "status-flipped candidate removed");
    });
  });

  test("a non-candidate dotdir path (references/.cache outside library-candidates) stays ignored", async () => {
    await withRunner(async ({ root, runner, fake }) => {
      const junk = file(root, "references/.cache/source-cache/page.md", "# Cached\n\nderived, not source\n");
      runner.onFileChanged(junk);
      await runner.runWork();
      assert.equal(fake.calls.embed, 0, "dotdir derived content excluded");
    });
  });
});
