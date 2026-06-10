import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { chunkText, collectItems, normalizeForChunking, splitSentences } from "./chunking";

const envKeys = ["BRIDGE_VAULT_PATH", "SEMANTIC_CHUNK_MAX_CHARS"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
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

function withVault(run: (root: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-sem-chunk-"));
  process.env.BRIDGE_VAULT_PATH = dir;
  process.env.SEMANTIC_CHUNK_MAX_CHARS = "120"; // force multi-chunk on modest text
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("chunking — pure helpers", () => {
  test("splitSentences + chunkText reconstruct the normalized text", () => {
    const text = "First idea here. Second idea follows. Third one too! And a fourth? Yes a fifth.";
    const chunks = chunkText(text, 40);
    assert.ok(chunks.length > 1, "should split into multiple chunks at 40 chars");
    assert.ok(chunks.every((c) => c.length <= 40));
    assert.equal(chunks.join(" "), normalizeForChunking(text));
  });

  test("short text → single chunk; empty → none", () => {
    assert.deepEqual(chunkText("just one short sentence.", 4000), ["just one short sentence."]);
    assert.deepEqual(chunkText("   \n  ", 4000), []);
    assert.equal(splitSentences("a. b. c.").length, 3);
  });
});

describe("chunking — vault scan", () => {
  test("collectItems honors scope, id scheme, scope tags, and exclusions", () => {
    withVault((root) => {
      write(root, "people/alice.md", "---\ntitle: Alice\n---\nNotes about Alice.");
      const longBody = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} about agents and tools.`).join(" ");
      write(root, "meetings/2026-06-01/sync.md", `---\ntitle: Weekly sync\n---\n${longBody}`);
      write(root, "references/an-article.md", "---\ntitle: An Article\nurl: https://example.com/x\n---\nSummary body.");
      // Candidates ARE collected (via the candidate-cache API, not the dir walk) — status=candidate only:
      write(root, "references/.cache/library-candidates/2026-06-10-pending.md", "---\ntype: reference-candidate\ntitle: Pending Cand\nstatus: candidate\nurl: https://example.com/c\n---\nDiscovery body.");
      write(root, "references/.cache/library-candidates/2026-06-10-skipped.md", "---\ntype: reference-candidate\ntitle: Skipped Cand\nstatus: skipped\n---\nGone body.");
      // Must be excluded:
      write(root, "libraries/repo/readme.md", "# external\n\nlots of text");
      write(root, "references/.cache/junk.md", "# cached\n\nignore me");

      const items = collectItems(root);
      const byId = new Map(items.map((i) => [i.itemId, i]));

      // person id scheme + scope
      const alice = byId.get("person:alice");
      assert.ok(alice, "alice present as person:alice");
      assert.equal(alice!.scope, "vault");
      assert.equal(alice!.chunks.length, 1, "short note = 1 chunk");

      // meeting: note id, meeting kind, multi-chunk, reconstructs
      const meeting = items.find((i) => i.kind === "meeting");
      assert.ok(meeting, "meeting present");
      assert.ok(meeting!.itemId.startsWith("note:"));
      assert.ok(meeting!.chunks.length > 1, "long meeting splits");
      assert.equal(meeting!.chunks.map((c) => c.text).join(" "), normalizeForChunking(`Weekly sync\n\n${longBody}`));

      // reference: ref id, library scope, url captured
      const ref = items.find((i) => i.itemId.startsWith("ref:"));
      assert.ok(ref, "reference present");
      assert.equal(ref!.scope, "library");
      assert.equal(ref!.url, "https://example.com/x");

      // candidate: cand: id, library scope, candidate kind; status≠candidate dropped
      const cand = items.find((i) => i.kind === "candidate");
      assert.ok(cand, "pending candidate present");
      assert.ok(cand!.itemId.startsWith("cand:"), "graph-aligned cand: id (R1)");
      assert.equal(cand!.scope, "library");
      assert.equal(cand!.title, "Pending Cand");
      assert.equal(cand!.url, "https://example.com/c");
      assert.ok(!items.some((i) => i.title === "Skipped Cand"), "non-candidate status excluded");

      // exclusions
      assert.ok(!items.some((i) => i.sourceFile.includes("/libraries/")), "libraries/ excluded");
      assert.ok(
        !items.some((i) => i.sourceFile.includes("/.cache/") && i.kind !== "candidate"),
        ".cache excluded except the candidate cache",
      );
    });
  });
});
