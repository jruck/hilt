/**
 * Behavioral spec for owner-prefix parsing (render-level owner chips): only the two prefixes
 * the meeting-actions loop writes (`[unclear] `, `[other:Name] `) parse into chips; every
 * other bracket (footnotes, editorial) passes through untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerChip, parseOwnerPrefix } from "./owner";

test("parseOwnerPrefix strips [unclear] and tags the owner", () => {
  const parsed = parseOwnerPrefix("[unclear] Send the deck to Floyds");
  assert.equal(parsed.title, "Send the deck to Floyds");
  assert.deepEqual(parsed.owner, { kind: "unclear" });
});

test("parseOwnerPrefix strips [other:Name] and carries the name (spaces included)", () => {
  const parsed = parseOwnerPrefix("[other:Ana Marie] Draft the QBR agenda");
  assert.equal(parsed.title, "Draft the QBR agenda");
  assert.deepEqual(parsed.owner, { kind: "other", name: "Ana Marie" });
});

test("parseOwnerPrefix leaves unprefixed titles untouched (Justin's own commitments)", () => {
  const parsed = parseOwnerPrefix("Send the deck to Floyds");
  assert.equal(parsed.title, "Send the deck to Floyds");
  assert.equal(parsed.owner, null);
});

test("parseOwnerPrefix does NOT treat arbitrary brackets as owner prefixes", () => {
  // Footnote markers, editorial brackets, and malformed variants stay in the display title.
  for (const raw of ["[1] A footnote line", "[WIP] Ship it", "[other:] no name", "[unclear]no space"]) {
    const parsed = parseOwnerPrefix(raw);
    assert.equal(parsed.title, raw);
    assert.equal(parsed.owner, null);
  }
});

test("ownerChip copy: unclear teaches, other informs, null renders nothing", () => {
  assert.equal(ownerChip(null), null);
  const unclear = ownerChip({ kind: "unclear" });
  assert.equal(unclear?.label, "owner unclear");
  assert.match(unclear?.title ?? "", /verdict also teaches/);
  const other = ownerChip({ kind: "other", name: "Ana" });
  assert.equal(other?.label, "owner: Ana");
  assert.match(other?.title ?? "", /Someone else/);
});

test("parseLifecycle strips 🆕 from DONE titles too (check-off-before-view)", () => {
  const { parseLifecycle } = require("../attribution") as typeof import("../attribution");
  const done = parseLifecycle("🆕 Ship the thing", true);
  assert.equal(done.state, "done");
  assert.equal(done.displayTitle, "Ship the thing");
});
