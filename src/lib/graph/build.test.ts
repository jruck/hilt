import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import * as wikilinkResolver from "@/lib/docs/wikilink-resolver";
import { closeGraphDbForTests, getGraphDb } from "./db";
import {
  NORTH_STAR_NODE_ID,
  buildFullGraph,
  buildResolverMap,
  buildTagLayer,
  candidateNodeId,
  classifyFile,
  edgeId,
  noteNodeId,
  personNodeId,
  projectNodeId,
  referenceNodeId,
  removeGraphForFile,
  removeTagLayer,
  resolveLinkWithMap,
  scanVault,
  updateGraphForFile,
} from "./build";
import type { GraphEdge, GraphNode } from "./types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const envKeys = [
  "DATA_DIR",
  "HILT_GRAPH_DB_PATH",
  "HILT_GRAPH_ENABLED",
  "HILT_GRAPH_INCLUDE_LIBRARIES",
  "BRIDGE_VAULT_PATH",
  "HILT_WORKING_FOLDER",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  closeGraphDbForTests();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function file(root: string, rel: string, content: string): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return abs;
}

/**
 * Build the fixture vault from the plan's Test Plan spec. Exercises every edge
 * source plus the on-demand tag boundary.
 */
function buildFixtureVault(root: string): void {
  // notes/alpha.md with [[beta]] and [[gamma|Gamma display]] and an anchor link.
  file(root, "docs/notes/alpha.md", "# Alpha\n\nSee [[beta]] and [[gamma|Gamma display]] and [[beta#Section]].\n");
  file(root, "docs/notes/beta.md", "# Beta\n\nNothing here.\n");
  file(root, "docs/notes/gamma.md", "---\ntags: research, infra\n---\n\n# Gamma\n\nGamma body.\n");
  // An isolated note (no inbound/outbound links).
  file(root, "docs/notes/orphan.md", "# Orphan\n\nNo links at all.\n");

  // Saved reference with connection_suggestions + connected_projects: [atlas].
  file(
    root,
    "references/ref-001.md",
    [
      "---",
      "type: reference",
      "title: Ref One",
      "url: https://example.com/ref-001",
      "tags: research, infra",
      "connected_projects:",
      "  - atlas",
      "connection_suggestions:",
      "  - target: art-vandelay",
      "    label: Art Vandelay",
      "    relationship: mentioned-by",
      "    kind: person",
      "  - target: areas",
      "    label: North Stars",
      "    relationship: supports",
      "    kind: area",
      "---",
      "",
      "# Ref One",
      "",
      "## Summary",
      "",
      "A saved reference.",
      "",
      "## Connections",
      "",
      "- [[atlas]]",
      "",
    ].join("\n"),
  );

  // Person + a matching meeting file with hilt_calendar_event_id.
  file(
    root,
    "people/index.md",
    "# People\n\n## People\n\n- [[art-vandelay]] — Designer\n",
  );
  file(
    root,
    "people/art-vandelay.md",
    "---\ntype: person\ncreated: 2026-01-01\naliases: [\"Art Vandelay\"]\n---\n\n# Art Vandelay\n\n## Next\n\n## Notes\n",
  );
  file(
    root,
    "meetings/2026-03-05/art-vandelay-2026-03-05 @ 12-00-38.md",
    [
      "---",
      "title: Sync with Art",
      "created: 2026-03-05T12:00:38",
      "hilt_calendar_event_id: evt-123",
      "---",
      "",
      "# Sync with Art",
      "",
      "Meeting notes.",
      "",
    ].join("\n"),
  );

  // projects/atlas/index.md with tags + areas/index.md (north_star).
  file(
    root,
    "projects/atlas/index.md",
    "---\nstatus: doing\narea: infra\ntags: research, infra\n---\n\n# Atlas\n\nThe Atlas project.\n",
  );
  file(root, "areas/index.md", "# North Stars\n\n- Build great things.\n");

  // A nested library sub-vault (default-excluded).
  file(root, "libraries/everpro/projects/zeta/index.md", "---\nstatus: doing\n---\n\n# Zeta\n");
  file(root, "libraries/everpro/notes/secret.md", "# Secret\n\n[[alpha]]\n");

  // A dotdir that must be ignored entirely.
  file(root, "docs/.obsidian/workspace.md", "# should be ignored\n");

  // A candidate in the cache dir (a dotdir — read via the cache API, not the walker).
  file(
    root,
    "references/.cache/library-candidates/2026-03-01-some-candidate-abcdef.md",
    [
      "---",
      "type: reference-candidate",
      "title: Some Candidate",
      "url: https://example.com/candidate",
      "status: candidate",
      "channel: rss",
      "score:",
      "  total: 0.4",
      "---",
      "",
      "## Summary",
      "",
      "A review candidate.",
      "",
    ].join("\n"),
  );
}

function withFixtureVault(run: (root: string) => void): void {
  const dataDir = mkdtempSync(join(tmpdir(), "hilt-graph-data-"));
  const vaultRoot = mkdtempSync(join(tmpdir(), "hilt-graph-vault-"));
  process.env.HILT_GRAPH_ENABLED = "true";
  process.env.DATA_DIR = dataDir;
  process.env.HILT_GRAPH_DB_PATH = join(dataDir, "graph.sqlite");
  process.env.BRIDGE_VAULT_PATH = vaultRoot;
  delete process.env.HILT_WORKING_FOLDER;
  delete process.env.HILT_GRAPH_INCLUDE_LIBRARIES;
  closeGraphDbForTests();
  buildFixtureVault(vaultRoot);
  try {
    run(vaultRoot);
  } finally {
    closeGraphDbForTests();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(vaultRoot, { recursive: true, force: true });
  }
}

function allNodes(): GraphNode[] {
  const db = getGraphDb();
  return (db.prepare("SELECT id, type, label, ref_path, color_key, attrs_json FROM graph_nodes").all() as Array<{
    id: string;
    type: string;
    label: string;
    ref_path: string | null;
    color_key: string | null;
    attrs_json: string | null;
  }>).map((r) => ({
    id: r.id,
    type: r.type as GraphNode["type"],
    label: r.label,
    refPath: r.ref_path,
    degree: 0,
    colorKey: r.color_key,
    attrs: r.attrs_json ? JSON.parse(r.attrs_json) : {},
  }));
}

function allEdges(): GraphEdge[] {
  const db = getGraphDb();
  return (db.prepare("SELECT id, source_id, target_id, kind, weight, attrs_json FROM graph_edges").all() as Array<{
    id: string;
    source_id: string;
    target_id: string;
    kind: string;
    weight: number;
    attrs_json: string | null;
  }>).map((r) => ({
    id: r.id,
    source: r.source_id,
    target: r.target_id,
    kind: r.kind as GraphEdge["kind"],
    weight: r.weight,
    attrs: r.attrs_json ? JSON.parse(r.attrs_json) : {},
  }));
}

function nodesByType(type: string): GraphNode[] {
  return allNodes().filter((n) => n.type === type);
}
function edgesByKind(kind: string): GraphEdge[] {
  return allEdges().filter((e) => e.kind === kind);
}

// ---------------------------------------------------------------------------
// Node classification + counts
// ---------------------------------------------------------------------------

describe("graph builder — nodes", () => {
  test("classifies files by dir + path", () => {
    assert.equal(classifyFile("/v/people/art.md", "people"), "person");
    assert.equal(classifyFile("/v/references/r.md", "references"), "reference");
    assert.equal(classifyFile("/v/projects/atlas/index.md", "projects"), "project");
    assert.equal(classifyFile("/v/projects/atlas/notes.md", "projects"), "note");
    assert.equal(classifyFile("/v/areas/index.md", "areas"), "north_star");
    assert.equal(classifyFile("/v/docs/notes/alpha.md", "docs"), "note");
  });

  test("exact node counts by type; dotdirs + libraries excluded by default", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });

      // notes: alpha, beta, gamma, orphan, ref-001's Connections wikilink doesn't add a note;
      // people/index.md is treated as a note (not a person). meeting file is a note.
      const personNodes = nodesByType("person");
      assert.deepEqual(
        personNodes.map((n) => n.id).sort(),
        [personNodeId("art-vandelay")].sort(),
      );

      const referenceNodes = nodesByType("reference");
      assert.equal(referenceNodes.length, 1);
      assert.equal(referenceNodes[0].label, "Ref One");

      const projectNodes = nodesByType("project");
      assert.deepEqual(projectNodes.map((n) => n.id), [projectNodeId("atlas")]);

      const northStar = nodesByType("north_star");
      assert.equal(northStar.length, 1);
      assert.equal(northStar[0].id, NORTH_STAR_NODE_ID);

      // candidate from the cache API (not the walker).
      const candidateNodes = nodesByType("candidate");
      assert.equal(candidateNodes.length, 1);
      assert.equal(candidateNodes[0].label, "Some Candidate");

      // No tag nodes in the default build.
      assert.equal(nodesByType("tag").length, 0);
      // No library_cluster nodes by default.
      assert.equal(nodesByType("library_cluster").length, 0);

      // The dotdir note must be absent.
      const noteLabels = nodesByType("note").map((n) => n.label);
      assert.ok(!noteLabels.includes("should be ignored"));
      // The library leaf must be absent.
      assert.ok(!noteLabels.includes("Secret"));
      assert.ok(!allNodes().some((n) => n.refPath?.includes("libraries/")));
    });
  });

  test("ref_path is absolute for docs/refs/projects, slug for people, null for north star synthetic edge cases", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const person = nodesByType("person")[0];
      assert.equal(person.refPath, "art-vandelay");

      const ref = nodesByType("reference")[0];
      assert.ok(ref.refPath?.startsWith(root));
      assert.ok(ref.refPath?.endsWith("references/ref-001.md"));

      const project = nodesByType("project")[0];
      assert.ok(project.refPath?.endsWith("projects/atlas/index.md"));
    });
  });

  test("library clusters appear only when opt-in (one node per sub-vault, not leaves)", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root, includeLibraries: true });
      const clusters = nodesByType("library_cluster");
      assert.deepEqual(clusters.map((n) => n.label), ["everpro"]);
      // Still no raw library leaf notes.
      assert.ok(!nodesByType("note").some((n) => n.label === "Secret"));
    });
  });
});

// ---------------------------------------------------------------------------
// Edges by kind, endpoints, weights
// ---------------------------------------------------------------------------

describe("graph builder — edges", () => {
  test("wikilink edges: [[beta]], [[gamma|display]], anchor-strip — correct endpoints, display attr", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const alphaAbs = join(root, "docs/notes/alpha.md");
      const betaAbs = join(root, "docs/notes/beta.md");
      const gammaAbs = join(root, "docs/notes/gamma.md");
      const alphaId = noteNodeId(alphaAbs);

      const wikilinks = edgesByKind("wikilink").filter((e) => e.source === alphaId);
      // [[beta]] and [[beta#Section]] dedupe to one edge; [[gamma|display]] is the second.
      assert.equal(wikilinks.length, 2);

      const toBeta = wikilinks.find((e) => e.target === noteNodeId(betaAbs));
      assert.ok(toBeta, "expected alpha → beta wikilink");
      assert.equal(toBeta!.weight, 1);

      const toGamma = wikilinks.find((e) => e.target === noteNodeId(gammaAbs));
      assert.ok(toGamma, "expected alpha → gamma wikilink");
      assert.equal(toGamma!.attrs.display, "Gamma display");
    });
  });

  test("connection + connected_project edges on the saved ref; absent on the candidate", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const refAbs = join(root, "references/ref-001.md");
      const refId = referenceNodeId(refAbs);

      // connected_project: atlas, weight 1.5
      const connProj = edgesByKind("connected_project");
      assert.equal(connProj.length, 1);
      assert.equal(connProj[0].source, refId);
      assert.equal(connProj[0].target, projectNodeId("atlas"));
      assert.equal(connProj[0].weight, 1.5);

      // connection: person target + areas → north star
      const conns = edgesByKind("connection").filter((e) => e.source === refId);
      const targets = conns.map((e) => e.target).sort();
      assert.deepEqual(
        targets,
        [personNodeId("art-vandelay"), NORTH_STAR_NODE_ID].sort(),
      );

      // The candidate has no connection/connected_project edges (low-degree leaf).
      const candId = candidateNodeId(
        nodesByType("candidate")[0].id.replace(/^cand:/, ""),
      );
      assert.equal(allEdges().filter((e) => e.source === candId || e.target === candId).length, 0);
    });
  });

  test("meeting edge: person → meeting note with date/title/calendar id in attrs", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const meetings = edgesByKind("meeting");
      assert.equal(meetings.length, 1);
      const edge = meetings[0];
      assert.equal(edge.source, personNodeId("art-vandelay"));
      const meetingAbs = join(root, "meetings/2026-03-05/art-vandelay-2026-03-05 @ 12-00-38.md");
      assert.equal(edge.target, noteNodeId(meetingAbs));
      assert.equal(edge.attrs.title, "Sync with Art");
      assert.equal(edge.attrs.hilt_calendar_event_id, "evt-123");
      assert.ok(String(edge.attrs.date).startsWith("2026-03-05"));
    });
  });

  test("meta + reconcile: built_at set, layout_state stale, no dangling edges", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const db = getGraphDb();
      assert.ok((db.prepare("SELECT value FROM graph_meta WHERE key='built_at'").get() as { value: string }).value);
      assert.equal(
        (db.prepare("SELECT value FROM graph_meta WHERE key='layout_state'").get() as { value: string }).value,
        "stale",
      );
      // Every edge endpoint resolves to an existing node.
      const dangling = db
        .prepare(
          "SELECT COUNT(*) AS c FROM graph_edges WHERE source_id NOT IN (SELECT id FROM graph_nodes) OR target_id NOT IN (SELECT id FROM graph_nodes)",
        )
        .get() as { c: number };
      assert.equal(dangling.c, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Wikilink resolver performance: prebuilt map, no per-call resolveWikilink
// ---------------------------------------------------------------------------

describe("graph builder — resolver perf", () => {
  test("the builder uses the prebuilt-map resolver, never per-call resolveWikilink", () => {
    // The mandatory perf fix: build.ts must not import/call resolveWikilink (which
    // rebuilds the file map on every call). It imports parseWikilinks only and
    // resolves against a map built once via buildResolverMap.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "build.ts"), "utf-8");
    // Strip block + line comments so the doc comment explaining the fix doesn't
    // count as a reference.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(code.includes("parseWikilinks"), "expected parseWikilinks import");
    assert.ok(!/resolveWikilink\s*\(/.test(code), "build.ts must NOT call resolveWikilink");
    assert.ok(!/import[\s\S]*?resolveWikilink/.test(code), "build.ts must NOT import resolveWikilink");
    // resolveWikilink remains a usable export elsewhere (sanity that we read the right module).
    assert.equal(typeof wikilinkResolver.resolveWikilink, "function");
  });

  test("a large fixture full build stays within a generous time budget (prebuilt map)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hilt-graph-perf-data-"));
    const vaultRoot = mkdtempSync(join(tmpdir(), "hilt-graph-perf-vault-"));
    process.env.HILT_GRAPH_ENABLED = "true";
    process.env.DATA_DIR = dataDir;
    process.env.HILT_GRAPH_DB_PATH = join(dataDir, "graph.sqlite");
    process.env.BRIDGE_VAULT_PATH = vaultRoot;
    closeGraphDbForTests();
    try {
      // 600 interlinked notes — per-call resolveWikilink would be O(links × tree).
      const N = 600;
      for (let i = 0; i < N; i += 1) {
        const next = (i + 1) % N;
        file(vaultRoot, `docs/notes/n${i}.md`, `# Note ${i}\n\n[[n${next}]]\n`);
      }
      const start = Date.now();
      const result = buildFullGraph({ root: vaultRoot });
      const elapsed = Date.now() - start;
      assert.equal(result.nodeCount, N);
      assert.ok(elapsed < 5000, `build took ${elapsed}ms (expected < 5000ms with prebuilt map)`);
    } finally {
      closeGraphDbForTests();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(vaultRoot, { recursive: true, force: true });
    }
  });

  test("resolveLinkWithMap resolves by filename, relative path, and anchor-strip", () => {
    withFixtureVault((root) => {
      const files = scanVault(root);
      const map = buildResolverMap(root, files);
      const alphaAbs = join(root, "docs/notes/alpha.md");
      const betaAbs = join(root, "docs/notes/beta.md");

      assert.equal(resolveLinkWithMap("beta", alphaAbs, root, map), betaAbs);
      assert.equal(resolveLinkWithMap("beta#Section", alphaAbs, root, map), betaAbs);
      assert.equal(resolveLinkWithMap("./beta", alphaAbs, root, map), betaAbs);
      assert.equal(resolveLinkWithMap("nonexistent", alphaAbs, root, map), null);
    });
  });
});

// ---------------------------------------------------------------------------
// Tag layer (on demand only)
// ---------------------------------------------------------------------------

describe("graph builder — tag layer (on demand)", () => {
  test("tags absent by default; buildTagLayer mints shared tags, drops singletons", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      assert.equal(nodesByType("tag").length, 0);

      // gamma + ref-001 + atlas all carry tags research,infra → both shared (>=2 members).
      const result = buildTagLayer({ root });
      assert.equal(result.tagNodeCount, 2);
      const tagLabels = nodesByType("tag").map((n) => n.label).sort();
      assert.deepEqual(tagLabels, ["#infra", "#research"]);

      // Tag edges are undirected kind="tag".
      assert.ok(edgesByKind("tag").length >= 4);

      // Removing the layer clears tag rows + tags_built.
      removeTagLayer();
      assert.equal(nodesByType("tag").length, 0);
      assert.equal(edgesByKind("tag").length, 0);
      const db = getGraphDb();
      assert.equal((db.prepare("SELECT value FROM graph_meta WHERE key='tags_built'").get() as { value: string }).value, "0");
    });
  });
});

// ---------------------------------------------------------------------------
// Incremental
// ---------------------------------------------------------------------------

describe("graph builder — incremental", () => {
  test("editing one file touches only its rows; unaffected position rows are not rewritten", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const db = getGraphDb();
      // Seed position rows for two unrelated nodes.
      const orphanId = noteNodeId(join(root, "docs/notes/orphan.md"));
      const gammaId = noteNodeId(join(root, "docs/notes/gamma.md"));
      const alphaId = noteNodeId(join(root, "docs/notes/alpha.md"));
      db.prepare("INSERT INTO node_positions (id, x, y, z, dirty, layout_version, updated_at) VALUES (?,1,1,NULL,0,1,1000)").run(orphanId);
      db.prepare("INSERT INTO node_positions (id, x, y, z, dirty, layout_version, updated_at) VALUES (?,2,2,NULL,0,1,1000)").run(gammaId);
      db.prepare("INSERT INTO node_positions (id, x, y, z, dirty, layout_version, updated_at) VALUES (?,3,3,NULL,0,1,1000)").run(alphaId);

      // Edit alpha (its 1-hop neighbors are beta + gamma via wikilinks).
      writeFileSync(join(root, "docs/notes/alpha.md"), "# Alpha\n\nOnly [[gamma]] now.\n", "utf-8");
      updateGraphForFile(join(root, "docs/notes/alpha.md"), { root });

      // Orphan is unrelated → its position row must be untouched.
      const orphanRow = db.prepare("SELECT dirty, updated_at FROM node_positions WHERE id = ?").get(orphanId) as { dirty: number; updated_at: number };
      assert.equal(orphanRow.dirty, 0);
      assert.equal(orphanRow.updated_at, 1000);

      // alpha → beta wikilink dropped, alpha → gamma kept.
      const betaAbs = join(root, "docs/notes/beta.md");
      const betaEdge = edgeId(alphaId, noteNodeId(betaAbs), "wikilink");
      const betaCount = (db.prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE id = ?").get(betaEdge) as { c: number }).c;
      assert.equal(betaCount, 0);
      const gammaEdge = edgeId(alphaId, gammaId, "wikilink");
      const gammaCount = (db.prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE id = ?").get(gammaEdge) as { c: number }).c;
      assert.equal(gammaCount, 1);
    });
  });

  test("deleting a file removes its node + dangling edges and decrements neighbor degree", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      const db = getGraphDb();
      const betaAbs = join(root, "docs/notes/beta.md");
      const betaId = noteNodeId(betaAbs);
      const alphaId = noteNodeId(join(root, "docs/notes/alpha.md"));

      const alphaDegreeBefore = (db.prepare("SELECT degree FROM graph_nodes WHERE id = ?").get(alphaId) as { degree: number }).degree;
      assert.ok(alphaDegreeBefore >= 1);

      rmSync(betaAbs, { force: true });
      removeGraphForFile(betaAbs, { root });

      const betaNodeCount = (db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE id = ?").get(betaId) as { c: number }).c;
      assert.equal(betaNodeCount, 0);
      // alpha → beta edge gone; alpha degree decremented.
      const alphaDegreeAfter = (db.prepare("SELECT degree FROM graph_nodes WHERE id = ?").get(alphaId) as { degree: number }).degree;
      assert.equal(alphaDegreeAfter, alphaDegreeBefore - 1);
    });
  });

  test("saving a reference change updates connection edges without a full rebuild", () => {
    withFixtureVault((root) => {
      // A second project must exist as a node so the re-pointed edge has a valid
      // target (dangling edges are reconciled away by design).
      file(root, "projects/beacon/index.md", "---\nstatus: doing\n---\n\n# Beacon\n");
      buildFullGraph({ root });
      const refAbs = join(root, "references/ref-001.md");
      const refId = referenceNodeId(refAbs);
      assert.equal(edgesByKind("connected_project").filter((e) => e.source === refId).length, 1);
      assert.equal(
        edgesByKind("connected_project").filter((e) => e.source === refId)[0].target,
        projectNodeId("atlas"),
      );

      // Rewrite the ref with a different connected project.
      writeFileSync(
        refAbs,
        [
          "---",
          "type: reference",
          "title: Ref One",
          "url: https://example.com/ref-001",
          "connected_projects:",
          "  - beacon",
          "---",
          "",
          "# Ref One",
          "",
          "## Summary",
          "",
          "Changed.",
          "",
        ].join("\n"),
        "utf-8",
      );
      updateGraphForFile(refAbs, { root });

      const connProj = edgesByKind("connected_project").filter((e) => e.source === refId);
      assert.equal(connProj.length, 1);
      assert.equal(connProj[0].target, projectNodeId("beacon"));
    });
  });

  test("multi-file burst (dir rescan) — a rebuild after several edits converges", () => {
    withFixtureVault((root) => {
      buildFullGraph({ root });
      // Add two new notes that link each other (a burst BridgeWatcher would collapse).
      file(root, "docs/notes/delta.md", "# Delta\n\n[[epsilon]]\n");
      file(root, "docs/notes/epsilon.md", "# Epsilon\n\n[[delta]]\n");
      // A full rebuild is the robust backstop for a collapsed burst.
      buildFullGraph({ root });

      const deltaId = noteNodeId(join(root, "docs/notes/delta.md"));
      const epsilonId = noteNodeId(join(root, "docs/notes/epsilon.md"));
      assert.ok(allNodes().some((n) => n.id === deltaId));
      assert.ok(allNodes().some((n) => n.id === epsilonId));
      assert.equal(edgesByKind("wikilink").filter((e) => e.source === deltaId && e.target === epsilonId).length, 1);
      assert.equal(edgesByKind("wikilink").filter((e) => e.source === epsilonId && e.target === deltaId).length, 1);
    });
  });
});
