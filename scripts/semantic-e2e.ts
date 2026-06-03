/**
 * Semantic e2e — offline, fake-client, fixture-vault end-to-end (mirrors graph-e2e.ts).
 * Proves: a cold-start populates items/chunks; topic-exploration/related queries work;
 * and the backfill is REPRODUCIBLE — two cold-starts into separate data dirs over the
 * same vault produce identical chunk row-sets (deterministic, no live API).
 *
 *   npm run test:semantic:e2e
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runColdStart } from "../src/lib/semantic/backfill";
import { collectItems } from "../src/lib/semantic/chunking";
import type { ClusterInput, ClusterNode, ClusterResult, RunClustering } from "../src/lib/semantic/cluster";
import { closeSemanticDbForTests, getEntitiesByType, getSemanticDb } from "../src/lib/semantic/db";
import type { ExtractedEntity } from "../src/lib/semantic/gemini";
import { getTopic, listTopics, relatedToItem, entityByName, status } from "../src/lib/semantic/query";
import { runTopicRefit } from "../src/lib/semantic/topics";
import type { MergeJudge } from "../src/lib/semantic/resolve-prompt";
import { createFakeSemanticClient } from "../src/lib/semantic/test-helpers";
import { l2normalize } from "../src/lib/semantic/vector";

function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function buildFixtureVault(root: string): void {
  write(root, "people/ada.md", "---\ntitle: Ada\n---\nAda drives agent architecture, context windows, and tool use.");
  write(root, "projects/agents/index.md", "---\ntitle: Agents\n---\nAgent architecture and tool use are the core of the stack.");
  write(root, "references/article.md", "---\ntitle: On Agents\nurl: https://ex.com/a\n---\nA piece about agent architecture and memory.");
  write(root, "thoughts/hiring.md", "---\ntitle: Hiring\n---\nRecruiting, interviews, and team growth notes.");
  write(root, "libraries/repo/readme.md", "# external\n\nmust be excluded");
}

function chunkSnapshot(dataDir: string): string[] {
  closeSemanticDbForTests();
  process.env.HILT_SEMANTIC_DB_PATH = join(dataDir, "semantic.sqlite");
  const db = getSemanticDb();
  const rows = db
    .prepare("SELECT id, item_id, ordinal, hex(embedding_blob) AS h FROM chunks ORDER BY id")
    .all() as Array<{ id: string; item_id: string; ordinal: number; h: string }>;
  return rows.map((r) => `${r.id}|${r.item_id}|${r.ordinal}|${r.h}`);
}

/** Entities each fixture item is "about" — keyed by the item's TITLE for readability,
 * then mapped to the assembled item text the backfill actually sends to extractEntities. */
const ENTITY_BY_TITLE: Record<string, ExtractedEntity[]> = {
  Ada: [
    { type: "person", name: "Ada", aliases: [], salience: 1, evidence: "Ada drives agent architecture" },
    { type: "idea", name: "agent architecture", aliases: ["agents"], salience: 0.6, evidence: "agent architecture" },
    { type: "source", name: "context windows", aliases: [], salience: 0.3, evidence: "context windows" },
  ],
  Agents: [
    { type: "project", name: "Agents", aliases: [], salience: 1, evidence: "Agent architecture is the core" },
    { type: "idea", name: "agent architecture", aliases: ["agents"], salience: 0.6, evidence: "agent architecture" },
  ],
  "On Agents": [
    { type: "idea", name: "agent architecture", aliases: ["agents"], salience: 1, evidence: "agent architecture and memory" },
    { type: "source", name: "memory", aliases: [], salience: 0.3, evidence: "memory" },
  ],
  Hiring: [{ type: "idea", name: "recruiting", aliases: [], salience: 1, evidence: "Recruiting, interviews, and team growth" }],
};

/** Build an extractEntities fixture map keyed by the EXACT assembled item text. */
function buildExtractFixtures(): Record<string, ExtractedEntity[]> {
  const fixtures: Record<string, ExtractedEntity[]> = {};
  for (const item of collectItems()) {
    const text = item.chunks.map((c) => c.text).join(" ");
    const ents = item.title ? ENTITY_BY_TITLE[item.title] : undefined;
    if (ents) fixtures[text] = ents;
  }
  return fixtures;
}

/** Offline merge-judge: keep every member separate (we exercise auto-merge, not the LLM). */
const noMergeJudge: MergeJudge = async () => [];

/**
 * Offline clustering seam (ruling R6) — no Python, fully deterministic. Buckets chunks by
 * their item-id prefix into two leaf topics under one root: the agent strand (person/project/
 * reference) vs the hiring strand (a plain note), guaranteeing a ≥2-level hierarchy. `split`
 * peels the reference out of the agent leaf into its own leaf so a re-fit exercises lineage.
 */
function fakeClustering(opts: { split?: boolean } = {}): RunClustering {
  return async (input: ClusterInput): Promise<ClusterResult> => {
    const vecById = new Map(input.ids.map((id, i) => [id, l2normalize(Float32Array.from(input.vectors[i]))]));
    const leafFor = (chunkId: string): string => {
      if (chunkId.startsWith("note:")) return "L1-hiring";
      if (opts.split && chunkId.startsWith("ref:")) return "L1-reading";
      return "L1-agents";
    };
    const leafMembers = new Map<string, string[]>();
    for (const id of input.ids) {
      const leaf = leafFor(id);
      const arr = leafMembers.get(leaf) ?? [];
      arr.push(id);
      leafMembers.set(leaf, arr);
    }
    const centroid = (members: string[]): number[] => {
      const dim = input.vectors[0]?.length ?? 0;
      const out = new Float32Array(dim);
      for (const m of members) {
        const v = vecById.get(m)!;
        for (let i = 0; i < dim; i++) out[i] += v[i];
      }
      return Array.from(l2normalize(out));
    };
    const all = [...leafMembers.values()].flat();
    const hierarchy: ClusterNode[] = [
      { clusterId: "L0-root", parentId: null, level: 0, memberIds: all, centroid: centroid(all), size: all.length },
    ];
    for (const [leaf, members] of [...leafMembers].sort()) {
      hierarchy.push({ clusterId: leaf, parentId: "L0-root", level: 1, memberIds: members, centroid: centroid(members), size: members.length });
    }
    return {
      assignments: input.ids.map((id) => ({ id, leafCluster: 1, probability: 0.9 })),
      hierarchy,
      outliers: [],
      paramsUsed: {},
    };
  };
}

async function coldStartInto(dataDir: string): Promise<void> {
  closeSemanticDbForTests();
  process.env.HILT_SEMANTIC_DB_PATH = join(dataDir, "semantic.sqlite");
  // Isolate reconcile from any real data/graph.sqlite — a non-existent path ⇒ mint fresh.
  process.env.HILT_GRAPH_DB_PATH = join(dataDir, "graph.sqlite");
  const client = createFakeSemanticClient({ dim: 64, extractFixtures: buildExtractFixtures() });
  await runColdStart({ client, judge: noMergeJudge, runClustering: fakeClustering() });
}

async function main(): Promise<void> {
  const vault = mkdtempSync(join(tmpdir(), "hilt-sem-e2e-vault-"));
  const dataA = mkdtempSync(join(tmpdir(), "hilt-sem-e2e-A-"));
  const dataB = mkdtempSync(join(tmpdir(), "hilt-sem-e2e-B-"));
  const prev = {
    db: process.env.HILT_SEMANTIC_DB_PATH,
    graph: process.env.HILT_GRAPH_DB_PATH,
    vec: process.env.SEMANTIC_VEC_DISABLED,
    vault: process.env.BRIDGE_VAULT_PATH,
  };
  process.env.SEMANTIC_VEC_DISABLED = "1";
  process.env.BRIDGE_VAULT_PATH = vault;
  buildFixtureVault(vault);

  try {
    await coldStartInto(dataA);
    const s = status();
    assert.ok(s.built, "built after cold-start");
    assert.equal(s.items, 4, "4 items (libraries/ excluded)");
    assert.equal(s.embeddedChunks, s.chunks, "every chunk embedded");

    const related = relatedToItem("person:ada");
    assert.ok(related.length >= 1 && !related.some((h) => h.itemId === "person:ada"), "related returns non-self items");

    // Entity layer (P2.1): all four buckets extracted + resolved.
    assert.ok(s.entities > 0, "entities populated");
    assert.ok(getEntitiesByType("person", getSemanticDb()).length >= 1, "person entity");
    assert.ok(getEntitiesByType("project", getSemanticDb()).length >= 1, "project entity");
    assert.ok(getEntitiesByType("idea", getSemanticDb()).length >= 1, "idea entity");
    assert.ok(getEntitiesByType("source", getSemanticDb()).length >= 1, "source entity");

    // The "agent architecture" idea co-occurs across the Ada note, the Agents project,
    // and the On Agents reference — co-occurrence is multiple items sharing an entity.
    const agentIdea = entityByName("agent architecture", getSemanticDb());
    assert.ok(agentIdea, "the shared idea resolves by name");
    assert.ok(agentIdea!.items.length >= 2, "the idea co-occurs across ≥2 items");

    // Topic layer (P2.2): the cold-start re-fit produced a ≥2-level hierarchy.
    assert.ok(s.topics >= 3, "topics populated (1 root + ≥2 leaves)");
    const roots = listTopics({}, getSemanticDb()); // parentId omitted → root level
    assert.equal(roots.length, 1, "exactly one root theme");
    const children = listTopics({ parentId: roots[0].id }, getSemanticDb());
    assert.ok(children.length >= 2, "the root has ≥2 leaf children (the hierarchy)");

    // `topic <id>` drill-down: a leaf returns its items + a lineage entry (birth on first fit).
    const leafDetail = getTopic(children[0].id, {}, getSemanticDb());
    assert.ok(leafDetail, "topic <id> returns a detail object");
    assert.ok(leafDetail!.items.length >= 1, "leaf topic drill-down returns its items");
    assert.ok(leafDetail!.lineage.length >= 1, "leaf topic carries a lineage entry");

    // A warm-started re-fit that SPLITS the agent leaf records split lineage and re-homes
    // the reference under a new leaf — the lineage drill-down through-line.
    const refitClient = createFakeSemanticClient({ dim: 64, extractFixtures: buildExtractFixtures() });
    const r2 = await runTopicRefit({ client: refitClient, runClustering: fakeClustering({ split: true }), db: getSemanticDb() });
    assert.ok(r2.ran, "the split re-fit ran");
    assert.ok(r2.lineage.split >= 2, "the agent leaf split into ≥2 children (lineage split rows)");
    const refChild = listTopics({ parentId: roots[0].id }, getSemanticDb());
    assert.ok(refChild.length >= 3, "the split produced an additional leaf under the root");

    const snapA = chunkSnapshot(dataA);
    await coldStartInto(dataB);
    const snapB = chunkSnapshot(dataB);
    assert.deepEqual(snapA, snapB, "two cold-starts over the same vault produce identical chunk row-sets");

    process.stdout.write(
      `✓ semantic e2e passed — ${s.items} items, ${s.chunks} chunks, ${s.topics} topics (hierarchy + lineage drill-down), reproducible across data dirs\n`,
    );
  } finally {
    closeSemanticDbForTests();
    if (prev.db === undefined) delete process.env.HILT_SEMANTIC_DB_PATH; else process.env.HILT_SEMANTIC_DB_PATH = prev.db;
    if (prev.graph === undefined) delete process.env.HILT_GRAPH_DB_PATH; else process.env.HILT_GRAPH_DB_PATH = prev.graph;
    if (prev.vec === undefined) delete process.env.SEMANTIC_VEC_DISABLED; else process.env.SEMANTIC_VEC_DISABLED = prev.vec;
    if (prev.vault === undefined) delete process.env.BRIDGE_VAULT_PATH; else process.env.BRIDGE_VAULT_PATH = prev.vault;
    for (const d of [vault, dataA, dataB]) rmSync(d, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("semantic e2e FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
