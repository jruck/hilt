/**
 * filterDecodedByTypes (src/components/graph/decode.ts) — the legend's per-type
 * visibility toggles. Pure index-remapping over a decoded payload: node-safe to test
 * here (decode.ts has no DOM/WebGL imports), same placement rationale as deeplink.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { filterDecodedByTypes, type DecodedGraph } from "@/components/graph/decode";

/** 4 nodes: 0=note(t0), 1=entity(t9), 2=topic(t8), 3=person(t3). Links: 0-1, 0-2, 2-3. */
function payload(): DecodedGraph {
  return {
    version: 1,
    nodeCount: 4,
    edgeCount: 3,
    hasZ: false,
    includesTags: false,
    isLocal: false,
    truncated: false,
    positions: Float32Array.from([0, 0, 10, 10, 20, 20, 30, 30]),
    colorKeys: Uint8Array.from([0, 1, 2, 3]),
    links: Float32Array.from([0, 1, 0, 2, 2, 3]),
    sidecar: {
      ids: ["note:a", "ent:x", "topic:t", "person:p"],
      labels: ["A", "X", "T", "P"],
      types: [0, 9, 8, 3],
      colorKeyTable: ["note", "entity", "topic", "person"],
      folders: [0, 0, 0, 1],
      folderTable: ["f0", "f1"],
    },
  };
}

describe("filterDecodedByTypes", () => {
  test("nothing hidden ⇒ the exact same object (no copy)", () => {
    const p = payload();
    assert.equal(filterDecodedByTypes(p, new Set()), p);
  });

  test("hiding entities drops the node, its links, and remaps surviving indices", () => {
    const out = filterDecodedByTypes(payload(), new Set([9]));
    assert.equal(out.nodeCount, 3);
    assert.deepEqual(out.sidecar.ids, ["note:a", "topic:t", "person:p"]);
    // Positions preserved per node (toggling never moves anything).
    assert.deepEqual(Array.from(out.positions), [0, 0, 20, 20, 30, 30]);
    assert.deepEqual(Array.from(out.colorKeys), [0, 2, 3]);
    // Link 0-1 (note↔entity) dropped; 0-2 and 2-3 remapped: topic 2→1, person 3→2.
    assert.deepEqual(Array.from(out.links), [0, 1, 1, 2]);
    assert.equal(out.edgeCount, 2);
    // Folders filtered in lockstep.
    assert.deepEqual(out.sidecar.folders, [0, 0, 1]);
  });

  test("hiding multiple types compounds; hasZ payloads copy 3 components per node", () => {
    const p = payload();
    p.hasZ = true;
    p.positions = Float32Array.from([0, 0, 1, 10, 10, 1, 20, 20, 1, 30, 30, 1]);
    const out = filterDecodedByTypes(p, new Set([9, 8]));
    assert.equal(out.nodeCount, 2);
    assert.deepEqual(Array.from(out.positions), [0, 0, 1, 30, 30, 1]);
    assert.deepEqual(Array.from(out.links), [], "all links touched a hidden node");
  });
});
