import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveBriefingNativeLinkTarget } from "./briefing-link-targets";
import { hashId } from "@/lib/library/utils";

function makeVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-briefing-links-"));
  fs.mkdirSync(path.join(vaultPath, "meta", "library-reports"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "references", "process", "memos"), { recursive: true });
  return vaultPath;
}

test("resolves morning report links to the dated Docs markdown file", () => {
  const vaultPath = makeVault();
  const reportPath = path.join(vaultPath, "meta", "library-reports", "2026-06-17.md");
  fs.writeFileSync(reportPath, "# Library Morning Report\n", "utf-8");

  const target = resolveBriefingNativeLinkTarget(vaultPath, "/api/reports/morning", "2026-06-17");

  assert.deepEqual(target, {
    kind: "library-morning-report",
    view: "docs",
    scope: reportPath,
    path: "meta/library-reports/2026-06-17.md",
  });
});
test("resolves memo report links to the latest editor memo library item as of the briefing date", () => {
  const vaultPath = makeVault();
  fs.writeFileSync(path.join(vaultPath, "references", "process", "memos", "2026-06-10-editors-memo.md"), "---\ntype: reference\n---\n# Old\n", "utf-8");
  fs.writeFileSync(path.join(vaultPath, "references", "process", "memos", "2026-06-14-editors-memo.md"), "---\ntype: reference\n---\n# Current\n", "utf-8");
  fs.writeFileSync(path.join(vaultPath, "references", "process", "memos", "2026-06-21-editors-memo.md"), "---\ntype: reference\n---\n# Future\n", "utf-8");

  const target = resolveBriefingNativeLinkTarget(vaultPath, "https://xochipilli.tailnet.example/api/reports/memo", "2026-06-17");
  const relPath = "references/process/memos/2026-06-14-editors-memo.md";

  assert.deepEqual(target, {
    kind: "library-editors-memo",
    view: "library",
    scope: `/item/${hashId(relPath)}`,
    path: relPath,
  });
});

test("ignores non-report links", () => {
  const vaultPath = makeVault();
  assert.equal(resolveBriefingNativeLinkTarget(vaultPath, "https://example.com/post", "2026-06-17"), null);
});
