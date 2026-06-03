/**
 * Clustering seam (P2.2, ruling R6) — the TS boundary around the Python sidecar.
 *
 * The sidecar (scripts/semantic-cluster.py) does the UMAP+HDBSCAN math; this module
 * is the `execFile` wrapper that ships vectors to it and tolerantly parses the result,
 * modeled on `runClaude` in src/lib/library/connections.ts (execFile → JSON on stdout →
 * parse → abstain-on-failure).
 *
 * The orchestrator (topics.ts) never calls the sidecar directly — it takes a
 * `RunClustering` function parameter. The default is `runClusteringSidecar` (real `uv`);
 * tests inject a deterministic fake the same way the LLM client is faked, so CI needs no
 * Python. A missing `uv` (ENOENT) ⇒ warn ONCE and ABSTAIN (null) rather than throw, so
 * the global re-fit degrades to "incremental-only" exactly like the missing-`summarize`
 * path in digestion.ts — incremental nearest-topic assignment (assign.ts) still works.
 */

import { execFile } from "child_process";
import * as path from "path";
import { semanticClusterSeed, semanticRefitTimeoutMs } from "./config";

/** One item's leaf-cluster assignment from the sidecar. -1 ⇒ outlier (HDBSCAN noise). */
export interface ClusterAssignment {
  id: string;
  leafCluster: number;
  probability: number;
}

/** A node in the condensed-tree hierarchy: a cluster at some level, with members + centroid. */
export interface ClusterNode {
  clusterId: string;
  parentId: string | null;
  level: number;
  memberIds: string[];
  centroid: number[];
  size: number;
}

export interface ClusterResult {
  assignments: ClusterAssignment[];
  hierarchy: ClusterNode[];
  outliers: string[];
  paramsUsed: Record<string, unknown>;
}

export interface ClusterParams {
  seed?: number;
  minClusterSize?: number;
  minSamples?: number | null;
  umapNeighbors?: number;
  umapComponents?: number;
  umapMinDist?: number;
}

export interface ClusterInput {
  vectors: number[][];
  ids: string[];
  params?: ClusterParams;
  /** Prior-version centroids for warm-start (passed through to the sidecar). */
  warmStart?: { centroids: Array<{ topicId: string; centroid: number[] }> };
}

/**
 * The injectable clustering seam. Returns the cluster result, or `null` to ABSTAIN
 * (sidecar/`uv` missing, timeout, unparseable output) — the orchestrator treats null as
 * "no global re-fit this pass" (incremental-only), never an error.
 */
export type RunClustering = (input: ClusterInput) => Promise<ClusterResult | null>;

function resolvePythonRunner(): { bin: string; prefixArgs: string[] } {
  // SEMANTIC_CLUSTER_BIN overrides the whole invocation (e.g. a venv python); else `uv run`
  // resolves the pinned PEP-723 env per-run (no global pip pollution). SEMANTIC_PYTHON_BIN
  // pins the interpreter uv hands the script.
  const clusterBin = process.env.SEMANTIC_CLUSTER_BIN;
  if (clusterBin) return { bin: clusterBin, prefixArgs: [] };
  const pyVersion = process.env.SEMANTIC_PYTHON_BIN || "3.12";
  return { bin: process.env.SEMANTIC_UV_BIN || "uv", prefixArgs: ["run", "--python", pyVersion] };
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "semantic-cluster.py");
}

let warnedMissingUv = false;

/** Emit the install-guidance warning at most once per process (mirrors warnedMissingSummarize). */
function warnMissingUvOnce(detail: string): void {
  if (warnedMissingUv) return;
  warnedMissingUv = true;
  console.warn(
    `[semantic] clustering sidecar unavailable (${detail}) — topic re-fit skipped, incremental assignment still runs. ` +
      "Install uv (https://docs.astral.sh/uv/) or set SEMANTIC_CLUSTER_BIN to enable emergent topics.",
  );
}

/** Exposed for tests to reset the once-warned latch. */
export function resetClusterWarning(): void {
  warnedMissingUv = false;
}

interface SidecarAssignment {
  id?: unknown;
  leaf_cluster?: unknown;
  probability?: unknown;
}
interface SidecarNode {
  cluster_id?: unknown;
  parent_id?: unknown;
  level?: unknown;
  member_ids?: unknown;
  centroid?: unknown;
  size?: unknown;
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asNumArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => asNum(x)) : [];
}
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Tolerant parse of the sidecar's stdout (identical spirit to parseConnectionJudgment):
 * a malformed body, an `{ "error": ... }` envelope, or anything non-conforming yields
 * null (abstain). A well-formed result with zero clusters is a VALID empty result, not null.
 */
export function parseClusterOutput(stdout: string): ClusterResult | null {
  const text = (stdout || "").trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string") return null; // sidecar reported a failure
  if (!Array.isArray(obj.assignments) || !Array.isArray(obj.hierarchy)) return null;

  const assignments: ClusterAssignment[] = (obj.assignments as SidecarAssignment[])
    .map((a) => ({ id: asStr(a?.id), leafCluster: asNum(a?.leaf_cluster, -1), probability: asNum(a?.probability) }))
    .filter((a) => a.id);
  const hierarchy: ClusterNode[] = (obj.hierarchy as SidecarNode[])
    .map((n) => ({
      clusterId: asStr(n?.cluster_id),
      parentId: typeof n?.parent_id === "string" ? n.parent_id : null,
      level: asNum(n?.level),
      memberIds: asStrArr(n?.member_ids),
      centroid: asNumArr(n?.centroid),
      size: asNum(n?.size),
    }))
    .filter((n) => n.clusterId);
  const outliers = asStrArr(obj.outliers);
  const paramsUsed = obj.params_used && typeof obj.params_used === "object" ? (obj.params_used as Record<string, unknown>) : {};
  return { assignments, hierarchy, outliers, paramsUsed };
}

/**
 * Run the sidecar over stdin JSON. Resolves with the parsed result, or null on ANY failure
 * (ENOENT/`uv` missing, non-zero exit, timeout, unparseable stdout) after warning once.
 */
export const runClusteringSidecar: RunClustering = (input) => {
  return new Promise((resolve) => {
    const { bin, prefixArgs } = resolvePythonRunner();
    const payload = JSON.stringify({
      vectors: input.vectors,
      ids: input.ids,
      params: {
        seed: input.params?.seed ?? semanticClusterSeed(),
        min_cluster_size: input.params?.minClusterSize,
        min_samples: input.params?.minSamples,
        umap_neighbors: input.params?.umapNeighbors,
        umap_components: input.params?.umapComponents,
        umap_min_dist: input.params?.umapMinDist,
      },
      warm_start: input.warmStart,
    });

    const child = execFile(
      bin,
      [...prefixArgs, scriptPath()],
      { timeout: semanticRefitTimeoutMs(), maxBuffer: 1024 * 1024 * 64 },
      (error, stdout) => {
        if (error) {
          // ENOENT = uv/python not on PATH ⇒ degrade with install guidance; any other error
          // (timeout, non-zero exit) ⇒ abstain quietly (the re-fit just doesn't run this pass).
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") warnMissingUvOnce(`${bin} not found`);
          // A non-zero exit can still carry an {"error":...} body on stdout; parse it (→ null).
          resolve(parseClusterOutput(stdout || ""));
          return;
        }
        resolve(parseClusterOutput(stdout));
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(payload);
  });
};
