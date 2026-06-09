import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { closeSemanticDbForTests, getSemanticDb, upsertChunk, upsertItem } from "@/lib/semantic/db";
import { buildSemanticContext, librarySemanticEnabled, scoreArtifactSemantic } from "./semantic-relevance";
import type { LibraryArtifactDetail } from "./types";

const VAULT = "/vault";
const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "HILT_SEMANTIC_ENABLED", "HILT_LIBRARY_SEMANTIC", "SEMANTIC_VEC_DISABLED"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

/** Minimal artifact — the seam only reads `path`, `title`, `lifecycle_status`. */
function artifact(relPath: string, title: string, lifecycle: "saved" | "candidate" = "saved"): LibraryArtifactDetail {
  return { path: relPath, title, lifecycle_status: lifecycle } as unknown as LibraryArtifactDetail;
}

/** Seed a project (context) + two saved refs: A aligned with the project, B orthogonal. */
function seed(): void {
  upsertItem({ itemId: "project:proj", scope: "vault", kind: "project", sourcePath: `${VAULT}/projects/proj/index.md`, sourceFile: `${VAULT}/projects/proj/index.md`, title: "Pathfinder", contentHash: "p" });
  upsertItem({ itemId: "ref:a", scope: "library", kind: "reference", sourcePath: `${VAULT}/references/a.md`, sourceFile: `${VAULT}/references/a.md`, title: "Ref A", contentHash: "a" });
  upsertItem({ itemId: "ref:b", scope: "library", kind: "reference", sourcePath: `${VAULT}/references/b.md`, sourceFile: `${VAULT}/references/b.md`, title: "Ref B", contentHash: "b" });

  upsertChunk({ id: "project:proj:0", itemId: "project:proj", ordinal: 0, text: "p", embedding: new Float32Array([1, 0, 0]), embeddingModel: "fake" });
  upsertChunk({ id: "ref:a:0", itemId: "ref:a", ordinal: 0, text: "a", embedding: new Float32Array([1, 0, 0]), embeddingModel: "fake" }); // identical → cosine 1
  upsertChunk({ id: "ref:b:0", itemId: "ref:b", ordinal: 0, text: "b", embedding: new Float32Array([0, 0, 1]), embeddingModel: "fake" }); // orthogonal → cosine 0
}

function withSeeded(run: (db: ReturnType<typeof getSemanticDb>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hilt-sem-rel-"));
  closeSemanticDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_SEMANTIC_DB_PATH = join(dir, "semantic.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";
  try {
    const db = getSemanticDb();
    seed();
    run(db);
  } finally {
    closeSemanticDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("semantic relevance contextFit", () => {
  test("a saved ref aligned with an active project scores high; an orthogonal one scores 0", () => {
    withSeeded((db) => {
      const arts = [artifact("references/a.md", "Ref A"), artifact("references/b.md", "Ref B")];
      const ctx = buildSemanticContext(VAULT, arts, db);
      assert.equal(ctx.available, true);

      const a = scoreArtifactSemantic(VAULT, arts[0], ctx);
      const b = scoreArtifactSemantic(VAULT, arts[1], ctx);
      assert.ok(a && a.score > 0, "aligned ref has positive fit");
      assert.equal(a!.label, "Pathfinder", "fit attributes to the matched project");
      assert.ok(b && b.score === 0, "orthogonal ref has zero fit");
      assert.ok(a!.score > b!.score, "aligned outranks orthogonal");
    });
  });

  test("a candidate (no embedded centroid) returns null → caller keeps the token score", () => {
    withSeeded((db) => {
      const arts = [artifact("references/a.md", "Ref A")];
      const ctx = buildSemanticContext(VAULT, arts, db);
      const cand = artifact("references/.cache/library-candidates/c.md", "Candidate C", "candidate");
      assert.equal(scoreArtifactSemantic(VAULT, cand, ctx), null);
    });
  });

  test("an artifact never matches its own recent-save context entry", () => {
    withSeeded((db) => {
      // Only ref:b in context+scored; with self excluded and the project orthogonal to B, fit is 0.
      const arts = [artifact("references/b.md", "Ref B")];
      const ctx = buildSemanticContext(VAULT, arts, db);
      const b = scoreArtifactSemantic(VAULT, arts[0], ctx);
      assert.ok(b && b.score === 0, "self-match is excluded, so no spurious 1.0 fit");
    });
  });

  test("unavailable context → scoreArtifactSemantic returns null", () => {
    const ctx = buildSemanticContext(VAULT, [], undefined); // flag resolution below; no db override
    assert.equal(ctx.available, false);
    assert.equal(scoreArtifactSemantic(VAULT, artifact("references/a.md", "A"), ctx), null);
  });

  test("db absent → available:false (never creates an empty db)", () => {
    process.env.HILT_SEMANTIC_ENABLED = "true";
    process.env.HILT_SEMANTIC_DB_PATH = join(tmpdir(), "does-not-exist-hilt-sem.sqlite");
    delete process.env.HILT_LIBRARY_SEMANTIC;
    const ctx = buildSemanticContext(VAULT, [artifact("references/a.md", "A")]);
    assert.equal(ctx.available, false);
  });

  test("kill switch: HILT_LIBRARY_SEMANTIC=false disables even when semantic is enabled", () => {
    process.env.HILT_SEMANTIC_ENABLED = "true";
    process.env.HILT_LIBRARY_SEMANTIC = "false";
    assert.equal(librarySemanticEnabled(), false);
    const ctx = buildSemanticContext(VAULT, [artifact("references/a.md", "A")]);
    assert.equal(ctx.available, false);
  });
});
