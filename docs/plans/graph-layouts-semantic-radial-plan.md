# Graph Layout Modes: Semantic Space + Radial Hierarchy

**Status: PAUSED (credits) — resume week of 2026-06-15.** No feature code written yet; this doc
is the full plan + the reconnaissance already done, so a cold session can execute top to bottom.

## The request (verbatim)

> "love the #2 and #3 ideas you had, let's build those out completely and beautifully, and
> please review your work to confirm they work as expected without breaking the existing
> modes and functionality"

- **#2 = Semantic Space layout** — UMAP 2D projection of the actual embeddings as node
  positions. Distance on screen ≈ semantic distance. Precomputed server-side, served as
  alternate positions.
- **#3 = Radial Hierarchy layout** — topic-tree rings: root themes as sectors, leaf topics on
  inner rings, member items orbiting their topic, unassigned/entities on outer rings. Pure
  client-side geometry from edges already in the payload.

## State at pause

- Last graph commit: `e675e05` "fix(graph): physics AND picking — swap Graph instances at
  sim-mode boundaries". Working tree clean of graph work. Prod app rebuilt and serving on :3000.
- A concurrent session works on gateway/base-path, library v2, chat-v1 — keep commits
  **scoped to graph files** (plus shared deps they import).
- Recon completed (findings folded into the design below):
  `src/app/api/system/graph/route.ts`, `src/lib/graph/build.ts` (id helpers),
  `scripts/semantic-cluster.py` (sidecar pattern), `src/lib/semantic/db.ts` (schema mechanics).

## Hard constraints to respect (learned the expensive way this session)

1. **cosmos.gl 2.6.4**: `enableSimulation` is construction-only; force modules exist only on a
   sim-constructed instance, and that instance has broken GPU hover picking. The renderer
   already handles this via the **instance-swap** pattern (`recreateGraph` in
   `src/components/graph/CosmosRenderer.ts`). The new layouts must NOT touch that machinery —
   they are pure position swaps via the existing `renderer.setPositions(positions, true)`.
2. Never call `graph.render()` from hover paths (it clears `store.hoveredPoint` → flicker +
   dead clicks).
3. `semantic.sqlite` schema changes must be **additive** (`CREATE TABLE IF NOT EXISTS` inside
   `ensureSemanticSchema`). Do **not** bump `SEMANTIC_DB_FORMAT_VERSION` — a bump drops every
   derived table and forces a full embedding cold start (rate-limit pain). Do add the new table
   to the `invalidateOnFormatBump` drop list so a *future* bump cleans it too.
4. Determinism: fixed seed 42 (matches `scripts/semantic-cluster.py`); deterministic ordering
   by sorted ids everywhere so re-runs and tests reproduce.
5. Live server DATA_DIR is `/Users/jruck/.hilt/data` (not the repo). semantic.sqlite lives there.

## Key seams (recon findings)

- **Route** `src/app/api/system/graph/route.ts`: the global path already computes fresh
  positions into `positionsById: Map<string, NodePositionRow>` and passes them to
  `encodeFromParts(nodes, edges, positionsById, …)` (route.ts:106–114). `layout=semantic`
  plugs in by substituting that map. Local scope uses `encodeGraphBinary` (db positions) but
  can use the same `encodeFromParts` override path if we want semantic-local later — global
  first.
- **Node id mapping** (`src/lib/graph/build.ts`): semantic `item_id` IS the graph node id
  (ruling R1: `note:/ref:/person:/project:` …); topics map via `topicNodeId(id)` =
  `topic:${id}`; entities via `entityNodeId(id)` = `entity:${id}`.
- **Vector sources** (`src/lib/semantic/db.ts`):
  - items → mean of `chunks.embedding_blob` per item (normalize after averaging);
  - topics → `topics.centroid_blob`;
  - entities → `entities.embedding_blob` (only those meeting
    `semanticGraphEntityMinMentions()` ≥ 3 are plotted in the graph, but embedding ALL
    entities is fine — extra rows are ignored at serve time).
- **Sidecar pattern** (`scripts/semantic-cluster.py`): uv inline-deps header (`# /// script`),
  invoked `uv run --python 3.12 …`, JSON stdin/stdout, never opens SQLite, `{"error": …}` +
  non-zero exit on hard failure so the TS wrapper abstains gracefully, `params_used` echoed.
- **Wire format v2** is already capable: `edgeKinds` + `edgeKindTable` arrive client-side
  (`decode.ts`), which is exactly what `computeRadialLayout` needs (`topic_parent`,
  `item_topic` kinds) — radial needs **no server work at all**.

## Implementation order

### 1. UMAP sidecar — `scripts/semantic-umap.py`

Mirror `semantic-cluster.py` exactly (uv header, stdin/stdout contract, fail-soft).

- stdin: `{ "vectors": number[][], "ids": string[], "params"?: { seed, n_neighbors, min_dist } }`
- stdout: `{ "positions": [{ "id", "x", "y" }], "params_used": {...} }`
- `umap.UMAP(n_components=2, metric="cosine", random_state=seed, n_neighbors=min(15, n-1), min_dist≈0.1)`
  — note `min_dist` here is for *display* spread (0.1), not the clusterer's 0.0.
- Degrade inside the contract: < 4 points ⇒ valid empty/zero positions, not an error.

### 2. Orchestrator — `src/lib/semantic/umap-layout.ts` + persistence

- Gather vectors in ONE run (so items/topics/entities share the projection space):
  item centroids + topic `centroid_blob`s + entity `embedding_blob`s, ids already mapped to
  **graph node ids** (R1 / `topicNodeId` / `entityNodeId`).
- Persist to new table in `ensureSemanticSchema` (additive — see constraint 3):

  ```sql
  CREATE TABLE IF NOT EXISTS semantic_layout (
    node_id          TEXT PRIMARY KEY,   -- graph node id, NOT semantic id
    x                REAL NOT NULL,
    y                REAL NOT NULL,
    semantic_version TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
  ```

- Normalize projected coords to a sane box (e.g. [-1, 1]); the encoder/client scaling to the
  4096-unit space happens at serve time (match what `layoutSmallGraph` output ranges look like).
- npm script `semantic:layout` (CLI must call `loadEnvConfig(process.cwd())` first — the
  flag-trap lesson). Chain it after refit in the refit script so the Sunday 03:30
  `com.hilt.semantic.refit` job keeps the layout fresh; also fine to run standalone.

### 3. Route — `layout=semantic` param

In `src/app/api/system/graph/route.ts` (global scope): when `search.get("layout") === "semantic"`,
read `semantic_layout` rows, build `positionsById` from them **instead of** `layoutSmallGraph`,
and pass through the existing `encodeFromParts` path. Nodes with no stored coords (new since
last layout run, contracted-meeting survivors, tags) get a **deterministic outer fallback
ring**: angle from a hash of the node id, radius just outside the projected cloud's bounding
circle. Keep `fmt=json` debug parity.

### 4. Client layout state + picker

- `GraphView.tsx`: `layout: "force" | "semantic" | "radial"` state, persisted
  (`localStorage["hilt-graph-layout"]`, default `"force"`).
- `useGraphData` (or wherever the fetch URL is built): append `&layout=semantic` when active —
  semantic is a *server* layout, so it refetches; radial is client-only, no refetch.
- `GraphLegendPanel.tsx`: Layout picker (Force / Semantic / Radial) — a segmented row above the
  Physics section, same visual language as the preset buttons.

### 5. Radial layout — pure client module

`src/components/graph/radial-layout.ts`: `computeRadialLayout(decoded): Float32Array`
from the v2 payload alone:

- Build the topic tree from `topic_parent` edges; memberships from `item_topic` edges.
- Root topics → angular sectors sized by descendant count; leaf topics on inner rings inside
  their sector; member items orbiting their (highest-score) topic; items with no topic and
  entities on outer rings. All ordering by sorted ids ⇒ deterministic.
- Applied via `renderer.setPositions(positions, true)`. Re-derives on filter changes (the
  `decoded` memo already chains the type/edge-kind filters).

### 6. Mode gating in the UI

In non-force layouts:

- Hide (or disable with a hint) the Physics section, Reflow, Live, Restore — physics dials are
  meaningless against pinned coordinates.
- **Skip auto-settle** on data swaps (the every-swap-settles policy in `GraphView.tsx` is
  force-only) and reveal immediately (no settle gate — positions are already final).
- Mixers/filters (node types, edge kinds, solo/hide) work in ALL layouts; in radial they
  trigger a recompute, in semantic they just filter the fetched/decoded set.
- Switching back to Force: re-seed from canonical positions + auto-reflow into the active
  preset (same path as `handleApplyPreset`).

### 7. Tests

- `radial-layout.test.ts`: determinism, sector partition (no overlap), members land inside
  their topic's sector, unassigned on the outer ring, empty/degenerate payloads.
- Orchestrator unit test with a stubbed sidecar (id mapping → graph node ids, normalization,
  fallback-ring determinism).
- Route test: `layout=semantic` returns positions from the table; missing-coord node lands on
  the fallback ring; `layout` absent ⇒ unchanged behavior (regression guard).

### 8. In-browser verification matrix (before commit — "review your work")

Use the established harness: `agent-browser --args
"--use-gl=angle,--use-angle=swiftshader,--enable-unsafe-swiftshader"`, screenshot RMSE diffs
(PIL), cursor-style probe for picking, drift probe for sim state. SwiftShader picking is flaky
(~5/6) — retry, don't conclude from one miss.

| Check | Expectation |
|---|---|
| Three layouts render | Screenshots pairwise RMSE-distinct (force disc vs UMAP cloud vs rings) |
| Semantic layout | Clusters visibly grouped; fallback-ring nodes on rim; no console errors |
| Radial layout | Rings/sectors legible; topic labels on their rings |
| Clicks in all 3 layouts | Node click opens detail panel (cursor probe + click) |
| Mixers in all 3 | Solo/hide node types + edge kinds filter correctly |
| Layout persistence | Reload restores picked layout |
| **Force regression** | Settle-on-load, presets visibly distinct, Reflow moves (drift > 0), Live toggle, clicks — unchanged |
| Switch force↔semantic↔radial repeatedly | No stuck reveal gate, no dead picking, no leaked sim instance |

## Wrap-up checklist

- `docs/CHANGELOG.md` entry; `docs/ARCHITECTURE.md` if the layout table/param counts as
  architectural; `docs/DATA-MODELS.md` for `semantic_layout`; `docs/API.md` for the
  `layout` param.
- Scoped commit(s): graph + semantic-layout files only.
- Run `npm run rebuild` so the prod Electron app picks it up.
