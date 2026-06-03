import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { parseClusterOutput, resetClusterWarning, runClusteringSidecar } from "./cluster";

const envKeys = ["SEMANTIC_CLUSTER_BIN", "SEMANTIC_UV_BIN", "SEMANTIC_PYTHON_BIN", "SEMANTIC_REFIT_TIMEOUT_MS"] as const;
const original = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  resetClusterWarning();
  for (const k of envKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("parseClusterOutput — tolerant parse (mirrors parseConnectionJudgment)", () => {
  test("well-formed sidecar JSON parses into assignments + hierarchy", () => {
    const out = parseClusterOutput(
      JSON.stringify({
        assignments: [
          { id: "a", leaf_cluster: 0, probability: 0.9 },
          { id: "b", leaf_cluster: 1, probability: 0.8 },
          { id: "c", leaf_cluster: -1, probability: 0 },
        ],
        hierarchy: [
          { cluster_id: "L0-0", parent_id: null, level: 0, member_ids: ["a", "b"], centroid: [0.1, 0.2], size: 2 },
          { cluster_id: "L1-0", parent_id: "L0-0", level: 1, member_ids: ["a"], centroid: [0.3], size: 1 },
        ],
        outliers: ["c"],
        params_used: { seed: 42 },
      }),
    );
    assert.ok(out);
    assert.equal(out!.assignments.length, 3);
    assert.equal(out!.hierarchy.length, 2);
    assert.deepEqual(out!.outliers, ["c"]);
    assert.equal(out!.hierarchy[1].parentId, "L0-0");
    assert.equal(out!.paramsUsed.seed, 42);
  });

  test("an empty (zero-cluster) result is VALID, not null", () => {
    const out = parseClusterOutput(JSON.stringify({ assignments: [], hierarchy: [], outliers: [], params_used: {} }));
    assert.ok(out, "empty result is a valid abstain-distinct result");
    assert.equal(out!.hierarchy.length, 0);
  });

  test("an {error} envelope ⇒ null (abstain)", () => {
    assert.equal(parseClusterOutput(JSON.stringify({ error: "import failed: no umap" })), null);
  });

  test("malformed / non-object / missing-fields bodies ⇒ null", () => {
    assert.equal(parseClusterOutput(""), null);
    assert.equal(parseClusterOutput("not json"), null);
    assert.equal(parseClusterOutput("[1,2,3]"), null);
    assert.equal(parseClusterOutput(JSON.stringify({ assignments: [] })), null, "missing hierarchy");
  });

  test("drops malformed entries (no id / no cluster_id) but keeps the good ones", () => {
    const out = parseClusterOutput(
      JSON.stringify({
        assignments: [{ id: "a", leaf_cluster: 0 }, { leaf_cluster: 1 }],
        hierarchy: [{ cluster_id: "L1-0", member_ids: ["a"], centroid: [], size: 1 }, { member_ids: [] }],
        outliers: [],
        params_used: {},
      }),
    );
    assert.ok(out);
    assert.equal(out!.assignments.length, 1, "the id-less assignment is dropped");
    assert.equal(out!.hierarchy.length, 1, "the cluster_id-less node is dropped");
  });
});

describe("runClusteringSidecar — graceful degrade on missing uv (R6)", () => {
  test("a non-existent binary ⇒ ABSTAIN (null), no throw, warns once", async () => {
    process.env.SEMANTIC_CLUSTER_BIN = "/nonexistent/definitely-not-a-real-clusterer-xyz";
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => warnings.push(a.join(" "));
    try {
      const r1 = await runClusteringSidecar({ vectors: [[0.1, 0.2]], ids: ["a"] });
      const r2 = await runClusteringSidecar({ vectors: [[0.1, 0.2]], ids: ["a"] });
      assert.equal(r1, null, "missing binary abstains rather than throwing");
      assert.equal(r2, null);
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.filter((w) => w.includes("clustering sidecar unavailable")).length, 1, "warned exactly once");
  });
});
