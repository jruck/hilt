import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { runColdStart } from "./backfill";
import { closeSemanticDbForTests, getSemanticDb } from "./db";
import { relatedToItem, status } from "./query";
import { createFakeSemanticClient } from "./test-helpers";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "SEMANTIC_VEC_DISABLED", "BRIDGE_VAULT_PATH", "SEMANTIC_CHUNK_MAX_CHARS"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function seedVault(root: string): void {
  write(root, "people/alice.md", "---\ntitle: Alice\n---\nAlice leads the agent architecture work and tool-use design.");
  write(root, "projects/agents/index.md", "---\ntitle: Agents\n---\nAgent architecture, context windows, and tool use across the stack.");
  write(root, "thoughts/hiring.md", "---\ntitle: Hiring\n---\nNotes on recruiting, interviews, and team growth.");
}

function withVaultDb(run: (db: ReturnType<typeof getSemanticDb>) => void | Promise<void>): Promise<void> {
  const data = mkdtempSync(join(tmpdir(), "hilt-sem-bf-data-"));
  const vault = mkdtempSync(join(tmpdir(), "hilt-sem-bf-vault-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = data;
  process.env.HILT_SEMANTIC_DB_PATH = join(data, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  process.env.BRIDGE_VAULT_PATH = vault;
  seedVault(vault);
  return Promise.resolve(run(getSemanticDb())).finally(() => {
    closeSemanticDbForTests();
    rmSync(data, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  });
}

describe("cold-start backfill", () => {
  test("embeds every item; status reflects it; related works on fake vectors", async () => {
    await withVaultDb(async () => {
      const client = createFakeSemanticClient({ dim: 64 });
      const r = await runColdStart({ client });
      assert.equal(r.itemsTotal, 3);
      assert.equal(r.itemsEmbedded, 3);
      assert.ok(r.chunksEmbedded >= 3);

      const s = status();
      assert.equal(s.built, true);
      assert.equal(s.items, 3);
      assert.equal(s.embeddedChunks, s.chunks);
      assert.ok(s.builtAt);

      // related on the deterministic fake vectors returns the other items (not self).
      const hits = relatedToItem("person:alice");
      assert.ok(hits.length >= 1);
      assert.ok(!hits.some((h) => h.itemId === "person:alice"));
    });
  });

  test("re-running over an unchanged vault is a no-op (0 embed calls)", async () => {
    await withVaultDb(async () => {
      const first = createFakeSemanticClient({ dim: 64 });
      await runColdStart({ client: first });
      const firstCalls = first.calls.embed;
      assert.ok(firstCalls > 0);

      const second = createFakeSemanticClient({ dim: 64 });
      const r2 = await runColdStart({ client: second });
      assert.equal(second.calls.embed, 0, "no embed calls on unchanged second pass");
      assert.equal(r2.itemsSkipped, 3);
      assert.equal(r2.itemsEmbedded, 0);
    });
  });
});
