import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractMeetings, degreeMap, layoutSmallGraph } from "./contract";
import type { GraphEdge, GraphNode } from "./types";

const ROOT = "/vault";

function node(id: string, type: GraphNode["type"], refPath: string | null): GraphNode {
  return { id, type, label: id, refPath, degree: 0, colorKey: type, attrs: {} };
}
function edge(source: string, target: string, kind: GraphEdge["kind"] = "wikilink", weight = 1): GraphEdge {
  return { id: `${source}|${target}`, source, target, kind, weight, attrs: {} };
}

describe("meeting contraction", () => {
  test("a meeting folds into a clique among its non-meeting neighbors", () => {
    const nodes = [
      node("p:alice", "person", "alice"),
      node("p:bob", "person", "bob"),
      node("proj:x", "project", "/vault/projects/x.md"),
      node("note:m1", "note", "/vault/meetings/m1.md"), // the meeting
    ];
    const edges = [
      edge("note:m1", "p:alice", "meeting"),
      edge("note:m1", "p:bob", "meeting"),
      edge("note:m1", "proj:x", "wikilink"),
    ];
    const c = contractMeetings(nodes, edges, ROOT);
    assert.equal(c.removed, 1);
    const ids = c.nodes.map((n) => n.id).sort();
    assert.deepEqual(ids, ["p:alice", "p:bob", "proj:x"], "meeting node removed; survivors remain");
    // Clique of the meeting's 3 neighbors → 3 undirected derived edges.
    const pairs = c.edges.map((e) => [e.source, e.target].sort().join("|")).sort();
    assert.deepEqual(pairs, ["p:alice|p:bob", "p:alice|proj:x", "p:bob|proj:x"]);
  });

  test("repeated co-occurrence and kept edges accumulate weight", () => {
    const nodes = [
      node("p:alice", "person", "alice"),
      node("proj:x", "project", "/vault/projects/x.md"),
      node("note:m1", "note", "/vault/meetings/m1.md"),
      node("note:m2", "note", "/vault/meetings/m2.md"),
    ];
    const edges = [
      edge("p:alice", "proj:x", "connected_project", 1), // a kept (non-meeting) edge
      edge("note:m1", "p:alice", "meeting"),
      edge("note:m1", "proj:x", "wikilink"),
      edge("note:m2", "p:alice", "meeting"),
      edge("note:m2", "proj:x", "wikilink"),
    ];
    const c = contractMeetings(nodes, edges, ROOT);
    assert.equal(c.removed, 2);
    const ab = c.edges.find((e) => [e.source, e.target].sort().join("|") === "p:alice|proj:x");
    assert.ok(ab, "alice↔project edge present");
    // 1 kept + 2 derived (one per meeting) = weight 3.
    assert.equal(ab!.weight, 3);
  });

  test("no meetings → graph passes through unchanged", () => {
    const nodes = [node("p:alice", "person", "alice"), node("proj:x", "project", "/vault/projects/x.md")];
    const edges = [edge("p:alice", "proj:x")];
    const c = contractMeetings(nodes, edges, ROOT);
    assert.equal(c.removed, 0);
    assert.equal(c.nodes.length, 2);
    assert.equal(c.edges.length, 1);
  });

  test("degreeMap counts both endpoints; layoutSmallGraph places every node finitely", () => {
    const nodes = [node("a", "person", "alice"), node("b", "person", "bob"), node("c", "project", "/vault/projects/c.md")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const deg = degreeMap(nodes, edges);
    assert.equal(deg.get("a"), 1);
    assert.equal(deg.get("b"), 2);
    assert.equal(deg.get("c"), 1);
    const pos = layoutSmallGraph(nodes, edges, 50);
    for (const n of nodes) {
      const p = pos.get(n.id);
      assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y), `${n.id} placed finitely`);
    }
  });
});
