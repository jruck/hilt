/**
 * P2.4 — the semantic review queue is a SIBLING of the Library queue (ruling R10 / spec
 * "Versioning, Scheduling"). The data model is reused verbatim; only the store dir differs
 * (`DATA_DIR/semantic-review-queue` vs `DATA_DIR/library-review-queue`) so the two never
 * collide. The decimal/integer badge semantics carry over unchanged.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  addToReviewQueue,
  getActiveBatchNotes,
  listPendingReview,
  readReviewQueue,
  semanticReviewQueueDir,
} from "@/lib/library/review-queue";

const originalDataDir = process.env.DATA_DIR;
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function withTempData(run: (dir: string, vault: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-semantic-rq-"));
  const vault = mkdtempSync(join(tmpdir(), "hilt-semantic-rq-vault-"));
  process.env.DATA_DIR = dir;
  try {
    run(dir, vault);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
}

describe("semantic review queue (sibling store)", () => {
  test("semanticReviewQueueDir is the semantic sibling, not the library dir", () => {
    withTempData((dir) => {
      assert.equal(semanticReviewQueueDir(), join(dir, "semantic-review-queue"));
      assert.notEqual(semanticReviewQueueDir(), join(dir, "library-review-queue"));
    });
  });

  test("a semantic sample batch lands in the sibling store without colliding with the library queue", () => {
    withTempData((dir, vault) => {
      // Library lane for the SAME vault — must not see the semantic entries (separate files).
      addToReviewQueue(vault, [{ id: "ref:x", path: "/v/x.md", pipeline_version: "v2" }], { batch: "lib-batch" });

      const r = addToReviewQueue(
        vault,
        [
          { id: "note:a", path: "/v/a.md", pipeline_version: "v0.2" },
          { id: "note:b", path: "/v/b.md", pipeline_version: "v0.2" },
        ],
        { batch: "v0.2", note: { version: "v0.2", title: "Semantic v0.2", markdown: "# Semantic v0.2\n\nwhat changed" }, kind: "semantic" },
      );
      assert.equal(r.added, 2);

      // The semantic store file exists under the sibling dir.
      assert.ok(existsSync(join(dir, "semantic-review-queue")), "semantic store dir created");

      // Semantic lane: exactly the two semantic items, with the batch note surfaced.
      const semanticPending = listPendingReview(vault, "semantic");
      assert.equal(semanticPending.length, 2);
      assert.deepEqual(semanticPending.map((e) => e.path).sort(), ["/v/a.md", "/v/b.md"]);
      const notes = getActiveBatchNotes(vault, "semantic");
      assert.equal(notes.length, 1);
      assert.equal(notes[0].title, "Semantic v0.2");
      assert.equal(notes[0].pending_count, 2);

      // Library lane is untouched by the semantic write (no collision).
      const libQueue = readReviewQueue(vault, "library");
      assert.deepEqual(Object.keys(libQueue.items), ["ref:x"]);
      assert.equal(listPendingReview(vault, "semantic").some((e) => e.path === "/v/x.md"), false);
    });
  });

  test("the library queue defaults are unchanged (kind defaults to library)", () => {
    withTempData((dir, vault) => {
      addToReviewQueue(vault, [{ id: "ref:y", path: "/v/y.md", pipeline_version: "v2" }], { batch: "b" });
      assert.ok(existsSync(join(dir, "library-review-queue")), "library store dir is the default");
      assert.equal(listPendingReview(vault).length, 1, "default kind = library");
      assert.equal(listPendingReview(vault, "semantic").length, 0, "nothing leaked into semantic");
    });
  });
});
