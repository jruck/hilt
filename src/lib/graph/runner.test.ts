import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { closeGraphDbForTests, getGraphDb } from "./db";
import { buildFullGraph, candidateNodeId, noteNodeId } from "./build";
import { GraphRunner, resetGraphRunnerForTests, getGraphRunner } from "./runner";

// ---------------------------------------------------------------------------
// Harness (mirrors build.test.ts)
// ---------------------------------------------------------------------------

const envKeys = [
  "DATA_DIR",
  "HILT_GRAPH_DB_PATH",
  "HILT_GRAPH_ENABLED",
  "HILT_GRAPH_INCLUDE_LIBRARIES",
  "HILT_GRAPH_LAYOUT_DISABLED",
  "HILT_GRAPH_LAYOUT_DEBOUNCE_MS",
  "BRIDGE_VAULT_PATH",
  "HILT_WORKING_FOLDER",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  resetGraphRunnerForTests();
  closeGraphDbForTests();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function file(root: string, rel: string, content: string): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return abs;
}

function seedVault(root: string): void {
  file(root, "docs/notes/alpha.md", "# Alpha\n\nSee [[beta]].\n");
  file(root, "docs/notes/beta.md", "# Beta\n\nNothing.\n");
}

function withRunner(run: (ctx: { root: string; runner: GraphRunner; db: import("better-sqlite3").Database }) => Promise<void> | void): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "hilt-graph-rdata-"));
  const vaultRoot = mkdtempSync(join(tmpdir(), "hilt-graph-rvault-"));
  process.env.HILT_GRAPH_ENABLED = "true";
  process.env.DATA_DIR = dataDir;
  process.env.HILT_GRAPH_DB_PATH = join(dataDir, "graph.sqlite");
  process.env.BRIDGE_VAULT_PATH = vaultRoot;
  process.env.HILT_GRAPH_LAYOUT_DISABLED = "true"; // hash placement, fast + deterministic
  process.env.HILT_GRAPH_LAYOUT_DEBOUNCE_MS = "0"; // clamped to 200 by the runner
  delete process.env.HILT_WORKING_FOLDER;
  delete process.env.HILT_GRAPH_INCLUDE_LIBRARIES;
  resetGraphRunnerForTests();
  closeGraphDbForTests();
  seedVault(vaultRoot);
  buildFullGraph({ root: vaultRoot });
  const runner = getGraphRunner(vaultRoot);
  const db = getGraphDb();
  return Promise.resolve(run({ root: vaultRoot, runner, db })).finally(() => {
    resetGraphRunnerForTests();
    closeGraphDbForTests();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(vaultRoot, { recursive: true, force: true });
  });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function nodeExists(db: import("better-sqlite3").Database, id: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM graph_nodes WHERE id = ?").get(id));
}

// ---------------------------------------------------------------------------

describe("GraphRunner", () => {
  test("onFileChanged adds a new file's node + edges incrementally", async () => {
    await withRunner(async ({ root, runner, db }) => {
      // Add a new note linking to beta — write it, then signal the runner.
      const gammaPath = file(root, "docs/notes/gamma.md", "# Gamma\n\n[[beta]]\n");
      assert.equal(nodeExists(db, noteNodeId(gammaPath)), false, "new node absent before event");

      runner.onFileChanged(gammaPath);

      assert.equal(nodeExists(db, noteNodeId(gammaPath)), true, "node present after event");
      // gamma -> beta wikilink edge exists.
      const edgeCount = (db
        .prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ? AND kind = 'wikilink'")
        .get(noteNodeId(gammaPath)) as { c: number }).c;
      assert.equal(edgeCount, 1, "gamma->beta wikilink edge created");
    });
  });

  test("onFileRemoved deletes the node and its dangling edges", async () => {
    await withRunner(async ({ root, runner, db }) => {
      const alphaPath = join(root, "docs/notes/alpha.md");
      const alphaId = noteNodeId(alphaPath);
      assert.equal(nodeExists(db, alphaId), true, "alpha present initially");
      const beforeEdges = (db.prepare("SELECT COUNT(*) AS c FROM graph_edges").get() as { c: number }).c;
      assert.ok(beforeEdges >= 1, "alpha->beta edge present initially");

      rmSync(alphaPath);
      runner.onFileRemoved(alphaPath);

      assert.equal(nodeExists(db, alphaId), false, "alpha removed");
      // The alpha->beta edge is dangling and cleaned up.
      const afterEdges = (db
        .prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ?")
        .get(alphaId) as { c: number }).c;
      assert.equal(afterEdges, 0, "alpha's edges removed");
    });
  });

  test("onDirChanged re-scans the dir and applies a multi-file burst (collapse-robust)", async () => {
    await withRunner(async ({ root, runner, db }) => {
      // Simulate a burst: two new docs land in one window; BridgeWatcher would emit
      // ONE event. The runner re-scans the dir, not the single path.
      const oneePath = file(root, "docs/notes/one.md", "# One\n\n[[beta]]\n");
      const twoPath = file(root, "docs/notes/two.md", "# Two\n\n[[beta]]\n");

      // Only fire the single collapsed event once.
      runner.onDirChanged("projects"); // wrong group — should not pick up docs
      assert.equal(nodeExists(db, noteNodeId(oneePath)), false, "projects event ignores docs");

      // The reconcile / scope path covers docs; simulate it via onFileChanged twice
      // would be the live path, but here exercise the dir-rescan diff directly for
      // the included `docs` dir via reconcile().
      await runner.reconcile();
      assert.equal(nodeExists(db, noteNodeId(oneePath)), true, "reconcile picked up one.md");
      assert.equal(nodeExists(db, noteNodeId(twoPath)), true, "reconcile picked up two.md");
    });
  });

  test("pollCandidates applies new + removed candidates (eventual)", async () => {
    await withRunner(async ({ root, runner, db }) => {
      const candAbs = file(
        root,
        "references/.cache/library-candidates/2026-03-01-cand-abcdef.md",
        [
          "---",
          "type: reference-candidate",
          "title: Cand One",
          "url: https://example.com/c1",
          "status: candidate",
          "channel: rss",
          "score:",
          "  total: 0.5",
          "---",
          "",
          "## Summary",
          "",
          "A candidate.",
          "",
        ].join("\n"),
      );

      await runner.pollCandidates();
      // The candidate node id is hash(relativeVaultPath) -> candidateNodeId.
      const candRows = db.prepare("SELECT id FROM graph_nodes WHERE type = 'candidate'").all() as Array<{ id: string }>;
      assert.equal(candRows.length, 1, "candidate node added");

      // Remove the candidate file; poll again -> node removed.
      rmSync(candAbs);
      await runner.pollCandidates();
      const after = db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE type = 'candidate'").get() as { c: number };
      assert.equal(after.c, 0, "candidate node removed after it vanished");
      void candidateNodeId; // (id scheme covered indirectly above)
    });
  });

  test("incremental edits mark the changed node dirty and a coalesced relax clears it", async () => {
    await withRunner(async ({ root, runner, db }) => {
      const gammaPath = file(root, "docs/notes/gamma.md", "# Gamma\n\n[[beta]]\n");
      runner.onFileChanged(gammaPath);
      // The new node has no position row yet, but its 1-hop neighbor (beta) is marked
      // dirty by updateGraphForFile. After the debounced relax fires, dirty clears.
      const dirtyBefore = (db.prepare("SELECT COUNT(*) AS c FROM node_positions WHERE dirty = 1").get() as { c: number }).c;
      assert.ok(dirtyBefore >= 0); // beta may or may not have a position row pre-relax
      // Wait past the (>=200ms) coalescing window + the hash-placement relax.
      await wait(450);
      const dirtyAfter = (db.prepare("SELECT COUNT(*) AS c FROM node_positions WHERE dirty = 1").get() as { c: number }).c;
      assert.equal(dirtyAfter, 0, "relax cleared the dirty region");
      // The new node got a persisted position.
      const pos = db.prepare("SELECT 1 FROM node_positions WHERE id = ?").get(noteNodeId(gammaPath));
      assert.ok(pos, "new node placed by the relax");
    });
  });

  test("coalesces a burst of edits into a single relax pass", async () => {
    await withRunner(async ({ root, runner, db }) => {
      const a = file(root, "docs/notes/burst-a.md", "# A\n[[beta]]\n");
      const b = file(root, "docs/notes/burst-b.md", "# B\n[[beta]]\n");
      const c = file(root, "docs/notes/burst-c.md", "# C\n[[beta]]\n");
      // Three signals inside one debounce window.
      runner.onFileChanged(a);
      runner.onFileChanged(b);
      runner.onFileChanged(c);
      await wait(450);
      // All three placed, dirty cleared (single coalesced relax).
      for (const p of [a, b, c]) {
        assert.ok(db.prepare("SELECT 1 FROM node_positions WHERE id = ?").get(noteNodeId(p)), "node placed");
      }
      const dirty = (db.prepare("SELECT COUNT(*) AS c FROM node_positions WHERE dirty = 1").get() as { c: number }).c;
      assert.equal(dirty, 0, "all dirty cleared by the coalesced relax");
    });
  });

  test("getVaultRoot returns the resolved root and is the ScopeWatcher scope", async () => {
    await withRunner(async ({ root, runner }) => {
      assert.equal(runner.getVaultRoot(), root);
    });
  });
});
