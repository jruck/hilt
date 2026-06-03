# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "numpy>=1.26,<2.2",
#   "umap-learn>=0.5.6",
#   "hdbscan>=0.8.38",
#   "scikit-learn>=1.4",
# ]
# ///
"""
Topic clustering sidecar (Phase 2 §C.0–C.1) — UMAP dimensionality reduction +
HDBSCAN density clustering with the condensed-tree hierarchy.

Invoked by src/lib/semantic/cluster.ts as `uv run --python 3.12 scripts/semantic-cluster.py`,
mirroring scripts/youtube-transcript.py: JSON in on stdin, JSON out on stdout, never opens
SQLite (the TS caller owns the db). Determinism comes from a fixed `random_state` (UMAP) and
HDBSCAN's deterministic core; the seed is echoed back in `params_used` so a re-fit reproduces.

stdin:  { "vectors": number[][], "ids": string[], "params"?: {...}, "warm_start"?: {...} }
stdout: { "assignments": [{id, leaf_cluster, probability}],
          "hierarchy":   [{cluster_id, parent_id, level, member_ids[], centroid[], size}],
          "outliers":    string[],
          "params_used": {...} }

Degrades INSIDE the contract: too few points to cluster ⇒ everything is an outlier with an
empty hierarchy (a valid, parseable result the orchestrator treats as "no topics this pass").
A hard import/runtime failure prints {"error": ...} to stdout and exits non-zero, so the TS
wrapper's tolerant parse abstains (warn once + incremental-only), exactly like the
missing-`summarize`/`uv` paths elsewhere.
"""

import sys
import json


def fail(message):
    sys.stdout.write(json.dumps({"error": message}))
    sys.stdout.flush()
    sys.exit(1)


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception as exc:  # noqa: BLE001
        fail(f"bad stdin json: {exc}")

    vectors = payload.get("vectors") or []
    ids = payload.get("ids") or []
    params = payload.get("params") or {}

    if len(vectors) != len(ids):
        fail(f"vectors/ids length mismatch: {len(vectors)} != {len(ids)}")

    seed = int(params.get("seed", 42))
    # Density-clustering knobs (data-driven hierarchy decision): leaf selection exposes the
    # full condensed tree, not just the top flat cut.
    min_cluster_size = int(params.get("min_cluster_size", 3))
    min_samples = params.get("min_samples")
    umap_neighbors = int(params.get("umap_neighbors", 15))
    umap_components = int(params.get("umap_components", 10))
    umap_min_dist = float(params.get("umap_min_dist", 0.0))

    params_used = {
        "seed": seed,
        "min_cluster_size": min_cluster_size,
        "min_samples": min_samples,
        "umap_neighbors": umap_neighbors,
        "umap_components": umap_components,
        "umap_min_dist": umap_min_dist,
        "n_input": len(ids),
    }

    # Not enough points for a meaningful density cluster: emit a valid empty result.
    if len(ids) < max(min_cluster_size + 1, 4):
        sys.stdout.write(
            json.dumps(
                {
                    "assignments": [{"id": i, "leaf_cluster": -1, "probability": 0.0} for i in ids],
                    "hierarchy": [],
                    "outliers": list(ids),
                    "params_used": params_used,
                }
            )
        )
        sys.stdout.flush()
        return

    try:
        import numpy as np
        import hdbscan
        import umap
    except Exception as exc:  # noqa: BLE001
        fail(f"import failed: {exc}")

    X = np.asarray(vectors, dtype=np.float32)

    # UMAP → low-dim manifold the density clusterer works in. Cosine metric matches the
    # L2-normalized embeddings the TS side stores. n_neighbors must be < n_samples.
    try:
        n_neighbors = max(2, min(umap_neighbors, len(ids) - 1))
        reducer = umap.UMAP(
            n_neighbors=n_neighbors,
            n_components=min(umap_components, max(2, len(ids) - 2)),
            min_dist=umap_min_dist,
            metric="cosine",
            random_state=seed,
        )
        reduced = reducer.fit_transform(X)
    except Exception as exc:  # noqa: BLE001
        fail(f"umap failed: {exc}")

    # HDBSCAN with leaf selection → the condensed tree gives us the broad→specific hierarchy
    # natively (no separate resolution sweep). store_centers caches per-cluster centroids in
    # the REDUCED space; we recompute centroids in the ORIGINAL embedding space below so the
    # TS cosine-assignment + warm-start lineage operate in the shared embedding space.
    try:
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            cluster_selection_method="leaf",
            metric="euclidean",
        )
        labels = clusterer.fit_predict(reduced)
        probabilities = clusterer.probabilities_
    except Exception as exc:  # noqa: BLE001
        fail(f"hdbscan failed: {exc}")

    assignments = []
    outliers = []
    for idx, item_id in enumerate(ids):
        leaf = int(labels[idx])
        prob = float(probabilities[idx]) if probabilities is not None else 0.0
        assignments.append({"id": item_id, "leaf_cluster": leaf, "probability": prob})
        if leaf < 0:
            outliers.append(item_id)

    # ---- Build a two-level hierarchy from the leaf clusters ----------------------------
    # Level 1 = the HDBSCAN leaf clusters. Level 0 = parent themes formed by agglomerating
    # leaf centroids (the condensed tree's broader cut). This guarantees the spec's ≥2-level
    # hierarchy whenever there is more than one leaf cluster.
    leaf_ids = sorted({int(l) for l in labels if int(l) >= 0})
    hierarchy = []

    def centroid(member_idx):
        if not member_idx:
            return []
        vec = X[member_idx].mean(axis=0)
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm
        return [float(v) for v in vec]

    leaf_centroids = {}
    leaf_members = {}
    for leaf in leaf_ids:
        member_idx = [i for i in range(len(ids)) if int(labels[i]) == leaf]
        leaf_members[leaf] = [ids[i] for i in member_idx]
        leaf_centroids[leaf] = centroid(member_idx)

    parent_of = {}
    if len(leaf_ids) >= 2:
        try:
            from sklearn.cluster import AgglomerativeClustering

            cmat = np.asarray([leaf_centroids[l] for l in leaf_ids], dtype=np.float32)
            n_parents = max(1, min(len(leaf_ids) - 1, int(round(len(leaf_ids) ** 0.5))))
            if n_parents >= 2:
                agg = AgglomerativeClustering(n_clusters=n_parents, metric="cosine", linkage="average")
                parent_labels = agg.fit_predict(cmat)
                for leaf, p in zip(leaf_ids, parent_labels):
                    parent_of[leaf] = int(p)
        except Exception:  # noqa: BLE001
            parent_of = {}  # fall back to flat (level-1-only) hierarchy

    # Emit level-0 parent themes (only when agglomeration produced ≥2 of them).
    parent_groups = {}
    for leaf, p in parent_of.items():
        parent_groups.setdefault(p, []).append(leaf)
    parent_cluster_id = {}
    for p, leaves in sorted(parent_groups.items()):
        member_idx = [i for i in range(len(ids)) if int(labels[i]) in leaves]
        cid = f"L0-{p}"
        parent_cluster_id[p] = cid
        hierarchy.append(
            {
                "cluster_id": cid,
                "parent_id": None,
                "level": 0,
                "member_ids": [ids[i] for i in member_idx],
                "centroid": centroid(member_idx),
                "size": len(member_idx),
            }
        )

    # Emit leaf clusters (level 1 when parented, else level 0 — the flat fallback).
    for leaf in leaf_ids:
        p = parent_of.get(leaf)
        parent_id = parent_cluster_id.get(p) if p is not None else None
        hierarchy.append(
            {
                "cluster_id": f"L1-{leaf}",
                "parent_id": parent_id,
                "level": 1 if parent_id is not None else 0,
                "member_ids": leaf_members[leaf],
                "centroid": leaf_centroids[leaf],
                "size": len(leaf_members[leaf]),
            }
        )

    sys.stdout.write(
        json.dumps(
            {
                "assignments": assignments,
                "hierarchy": hierarchy,
                "outliers": outliers,
                "params_used": params_used,
            }
        )
    )
    sys.stdout.flush()


if __name__ == "__main__":
    main()
