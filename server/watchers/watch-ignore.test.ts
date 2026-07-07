/**
 * Behavioral spec for the BridgeWatcher ignore predicate (v3 unit A2): dot-paths stay
 * ignored, `node_modules` stays ignored, but `tasks/.proposals/` — the proposal store —
 * is watched (its changes must emit `tasks-changed`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isIgnoredBridgePath } from "./watch-ignore";

const VAULT = "/Users/x/work/bridge";

test("plain vault files are not ignored", () => {
  assert.equal(isIgnoredBridgePath(`${VAULT}/lists/now/2026-07-06.md`), false);
  assert.equal(isIgnoredBridgePath(`${VAULT}/tasks/t-20260707-001.md`), false);
  assert.equal(isIgnoredBridgePath(`${VAULT}/projects/hilt/index.md`), false);
});

test("dotfiles and dotdirs are ignored", () => {
  assert.equal(isIgnoredBridgePath(`${VAULT}/.git/HEAD`), true);
  assert.equal(isIgnoredBridgePath(`${VAULT}/lists/now/.2026-07-06.md.swp`), true);
  assert.equal(isIgnoredBridgePath(`${VAULT}/tasks/.DS_Store`), true);
  assert.equal(isIgnoredBridgePath(`${VAULT}/projects/.obsidian/workspace.json`), true);
});

test("tasks/.proposals/ is the one sanctioned dotdir", () => {
  assert.equal(isIgnoredBridgePath(`${VAULT}/tasks/.proposals`), false);
  assert.equal(isIgnoredBridgePath(`${VAULT}/tasks/.proposals/t-20260707-002.md`), false);
});

test("dotfiles INSIDE .proposals are still ignored", () => {
  assert.equal(isIgnoredBridgePath(`${VAULT}/tasks/.proposals/.DS_Store`), true);
});

test(".proposals NOT under a tasks segment stays ignored", () => {
  assert.equal(isIgnoredBridgePath(`${VAULT}/projects/.proposals/x.md`), true);
  assert.equal(isIgnoredBridgePath(`${VAULT}/.proposals/x.md`), true);
});

test("node_modules is ignored", () => {
  assert.equal(isIgnoredBridgePath(`${VAULT}/projects/demo/node_modules/pkg/index.js`), true);
});

test("windows separators are handled", () => {
  assert.equal(isIgnoredBridgePath(`C:\\vault\\tasks\\.proposals\\t-1.md`), false);
  assert.equal(isIgnoredBridgePath(`C:\\vault\\.git\\HEAD`), true);
});
