import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { closeGraphDbForTests, getGraphDb, upsertNode } from "@/lib/graph/db";
import { personNodeId, projectNodeId } from "@/lib/graph/build";
import { closeSemanticDbForTests, getEntity, getSemanticDb, upsertItem, upsertMention } from "./db";
import type { SemanticLlmClient } from "./gemini";
import { entityByName } from "./query";
import { createReconcileBinder } from "./reconcile";
import { entityIdFor, normName, resolveAll } from "./resolve";
import type { MergeJudge } from "./resolve-prompt";
import { l2normalize } from "./vector";

const envKeys = ["DATA_DIR", "HILT_SEMANTIC_DB_PATH", "HILT_GRAPH_DB_PATH", "SEMANTIC_VEC_DISABLED"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  closeSemanticDbForTests();
  closeGraphDbForTests();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

let seq = 0;
const distinctVec = (): ((t: string) => Float32Array) => {
  const map = new Map<string, number>();
  return (t: string) => {
    if (!map.has(t)) map.set(t, map.size);
    const theta = (map.get(t)! * Math.PI) / 3 + 0.1;
    return l2normalize(Float32Array.from([Math.cos(theta), Math.sin(theta), 0, 0]));
  };
};

function fakeClient(): SemanticLlmClient {
  const v = distinctVec();
  return {
    async embed(texts) {
      return texts.map(v);
    },
    async extractEntities() {
      return [];
    },
    async labelTopics() {
      return [];
    },
  };
}

const noMergeJudge: MergeJudge = async () => [];

function seedMention(db: ReturnType<typeof getSemanticDb>, itemId: string, type: string, name: string): void {
  upsertItem(
    { itemId, scope: "vault", kind: "note", sourcePath: `/v/${itemId}.md`, sourceFile: `/v/${itemId}.md`, title: itemId, contentHash: "h", chunkCount: 1 },
    db,
  );
  upsertMention(
    {
      id: `m${seq++}`,
      itemId,
      rawType: type,
      rawName: name,
      normName: normName(name),
      aliases: [],
      salience: 1,
      evidence: `${name} appears`,
      extractModel: "fake",
      itemContentHash: "h",
    },
    db,
  );
}

function withDbs(run: (sem: ReturnType<typeof getSemanticDb>) => void | Promise<void>, opts: { seedGraph: boolean }): Promise<void> {
  const data = mkdtempSync(join(tmpdir(), "hilt-sem-reconcile-"));
  closeSemanticDbForTests();
  closeGraphDbForTests();
  process.env.DATA_DIR = data;
  process.env.HILT_SEMANTIC_DB_PATH = join(data, "semantic.sqlite");
  process.env.HILT_GRAPH_DB_PATH = join(data, "graph.sqlite");
  process.env.SEMANTIC_VEC_DISABLED = "1";

  if (opts.seedGraph) {
    const gdb = getGraphDb();
    upsertNode(
      { id: personNodeId("ada"), type: "person", label: "Ada Lovelace", refPath: "ada", degree: 0, colorKey: "person", attrs: { slug: "ada", aliases: ["Ada", "Ada L."] } },
      "/v/people/ada.md",
      gdb,
    );
    upsertNode(
      { id: projectNodeId("hilt"), type: "project", label: "Hilt", refPath: "/v/projects/hilt/index.md", degree: 0, colorKey: "project", attrs: { slug: "hilt" } },
      "/v/projects/hilt/index.md",
      gdb,
    );
    closeGraphDbForTests(); // release the writer; reconcile opens its own read-only handle
  }

  const sem = getSemanticDb();
  return Promise.resolve(run(sem)).finally(() => {
    closeSemanticDbForTests();
    closeGraphDbForTests();
    rmSync(data, { recursive: true, force: true });
  });
}

describe("reconcile — bind person/project entities to existing graph nodes", () => {
  test("a person with a graph node binds to person:<slug> (adopts the node id)", async () => {
    await withDbs(async (sem) => {
      seedMention(sem, "note:1", "person", "Ada"); // matches node alias "Ada"
      const { binder, close } = createReconcileBinder();
      try {
        await resolveAll({ client: fakeClient(), judge: noMergeJudge, db: sem, reconcile: binder });
      } finally {
        close();
      }
      const ent = entityByName("Ada", sem)!;
      assert.equal(ent.id, personNodeId("ada"), "entity adopts the graph node id");
      const row = getEntity(personNodeId("ada"), sem)!;
      assert.equal(row.graph_node_id, personNodeId("ada"));
      assert.equal(row.ref_path, "ada");
    }, { seedGraph: true });
  });

  test("a project name binds to project:<slug>", async () => {
    await withDbs(async (sem) => {
      seedMention(sem, "note:1", "project", "Hilt");
      const { binder, close } = createReconcileBinder();
      try {
        await resolveAll({ client: fakeClient(), judge: noMergeJudge, db: sem, reconcile: binder });
      } finally {
        close();
      }
      const row = getEntity(projectNodeId("hilt"), sem)!;
      assert.equal(row.graph_node_id, projectNodeId("hilt"));
    }, { seedGraph: true });
  });

  test("a name-only person (no graph node) mints fresh with graph_node_id NULL", async () => {
    await withDbs(async (sem) => {
      seedMention(sem, "note:1", "person", "Bob Nobody");
      const { binder, close } = createReconcileBinder();
      try {
        await resolveAll({ client: fakeClient(), judge: noMergeJudge, db: sem, reconcile: binder });
      } finally {
        close();
      }
      const ent = entityByName("Bob Nobody", sem)!;
      assert.equal(ent.id, entityIdFor("person", "Bob Nobody"), "fresh minted id, not a graph node id");
      const row = getEntity(ent.id, sem)!;
      assert.equal(row.graph_node_id, null);
    }, { seedGraph: true });
  });

  test("idea/source always mint fresh (no graph node to bind)", async () => {
    await withDbs(async (sem) => {
      seedMention(sem, "note:1", "idea", "Agents");
      seedMention(sem, "note:1", "source", "Gemini");
      const { binder, close } = createReconcileBinder();
      try {
        await resolveAll({ client: fakeClient(), judge: noMergeJudge, db: sem, reconcile: binder });
      } finally {
        close();
      }
      assert.equal(getEntity(entityIdFor("idea", "Agents"), sem)!.graph_node_id, null);
      assert.equal(getEntity(entityIdFor("source", "Gemini"), sem)!.graph_node_id, null);
    }, { seedGraph: true });
  });

  test("no-ops gracefully when graph.sqlite does not exist (risk #2)", async () => {
    await withDbs(async (sem) => {
      seedMention(sem, "note:1", "person", "Ada");
      const { binder, close } = createReconcileBinder(); // no graph db on disk
      try {
        await resolveAll({ client: fakeClient(), judge: noMergeJudge, db: sem, reconcile: binder });
      } finally {
        close();
      }
      const ent = entityByName("Ada", sem)!;
      assert.equal(ent.id, entityIdFor("person", "Ada"), "fresh mint when no graph cache");
      assert.equal(getEntity(ent.id, sem)!.graph_node_id, null);
    }, { seedGraph: false });
  });
});
