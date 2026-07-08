import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatTaskEditorWikilinkTarget,
  isVaultRootRelativeTaskEditorTarget,
  resolveTaskEditorReferencePath,
} from "./task-editor-links";

const vaultPath = "/Users/jruck/work/bridge";
const taskPath = `${vaultPath}/tasks/t-20260707-026.md`;

describe("task editor link resolution", () => {
  test("resolves Bridge root folder wikilinks from task files against the vault root", () => {
    const target = "projects/seb-1on1-strategy/2026-07-09-seb-show-and-tell-plan";
    assert.equal(
      resolveTaskEditorReferencePath(target, vaultPath, taskPath),
      `${vaultPath}/projects/seb-1on1-strategy/2026-07-09-seb-show-and-tell-plan`,
    );
  });

  test("keeps explicit relative links relative to the task file", () => {
    assert.equal(
      resolveTaskEditorReferencePath("../projects/seb-1on1-strategy/index", vaultPath, taskPath),
      `${vaultPath}/projects/seb-1on1-strategy/index`,
    );
  });

  test("keeps task-local media relative to the task file", () => {
    assert.equal(
      resolveTaskEditorReferencePath("media/sketch.png", vaultPath, taskPath),
      `${vaultPath}/tasks/media/sketch.png`,
    );
    assert.equal(
      resolveTaskEditorReferencePath("sketch.png", vaultPath, taskPath, { plainFileUsesMediaDir: true }),
      `${vaultPath}/tasks/media/sketch.png`,
    );
  });

  test("saves vault-root wikilinks without adding a parent traversal from tasks", () => {
    assert.equal(
      formatTaskEditorWikilinkTarget(
        `${vaultPath}/projects/seb-1on1-strategy/2026-07-09-seb-show-and-tell-plan`,
        vaultPath,
        taskPath,
      ),
      "projects/seb-1on1-strategy/2026-07-09-seb-show-and-tell-plan",
    );
  });

  test("recognizes only unambiguous Bridge root-relative targets", () => {
    assert.equal(isVaultRootRelativeTaskEditorTarget("projects/seb-1on1-strategy/index"), true);
    assert.equal(isVaultRootRelativeTaskEditorTarget("media/sketch.png"), false);
    assert.equal(isVaultRootRelativeTaskEditorTarget("../projects/seb-1on1-strategy/index"), false);
    assert.equal(isVaultRootRelativeTaskEditorTarget("local-note"), false);
  });
});
