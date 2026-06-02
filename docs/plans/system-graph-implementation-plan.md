# Hilt Knowledge Graph (System → Graph) Implementation Plan

## Summary

Add a new **Graph** sub-mode to the System section: an Obsidian-style force-directed network graph of the vault (notes, references, people, projects, North Stars), built for maximum frame rate and node count, limited by the *device* rather than by the fact that it runs in a browser.

The performance strategy is deliberate: the renderer is the **replaceable** half; the **data pipeline is the durable investment**. The backend (on the host `xochipilli`) does all heavy work — parse the vault into an incremental SQLite graph index, precompute force-layout positions, and serve a compact **binary** payload. The client loads finished coordinates into GPU buffers and renders, freezing at rest. The same view is viable on a Mac (Electron) *and* a phone (mobile Safari), each limited by its own hardware.

Renderer baseline is **cosmos.gl (WebGL2)** — the current OpenJS package (`@cosmos.gl/graph`, **not** legacy `@cosmograph/cosmos`). It runs identically on Electron and iOS Safari today. **WebGPU is an optional desktop-only progressive enhancement**, never the baseline.

The graph is a **derived cache, never a source of truth** — markdown remains canonical (Critical Constraint #2). It ships behind `HILT_GRAPH_ENABLED` to stay clear of the in-flight Library/connections work.

> **Vault-scale reality (measured against `~/work/bridge`, 2026-05).** The real vault is **11,356 `.md` files**, but only **4,720** outside dotdirs (`.git`/`.codex`/`.claude` hold the other ~6,636). Of the non-dot files, **2,235 live under `libraries/`**, which is **three full nested sub-vaults** (`everpro`, `priceless-misc`, `ventures`), each with its own `.git`/`.obsidian`/`.codex`/`projects`/`people`/`references`. The **primary connected vault** is ~**2,485** files: 27 people, 1,261 meetings, 26 project indexes, 646 saved references, 167 candidates, ~1,557 wikilink-bearing files. The global graph is therefore *not* a uniformly-connected 30k-node mesh — it is ~2.5k connected nodes plus a large tail of near-isolated library leaves. **Node-inclusion policy (below) is a hard design input, not an afterthought.**

## Goals / Non-Goals

**Goals**
- A `Graph` sub-mode in System with the established segmented-control + `modeSwitcher` pattern.
- Max performance: GPU render, server-precomputed layout, binary transport, idle at ~60fps (render-only after layout freeze).
- Scale headroom for a growing vault (low-thousands of connected nodes on desktop; capped/local on mobile) with a clean path to far larger graphs.
- Cross-platform: identical client code on Electron and mobile Safari, with per-device budgets.
- Click-through: selecting a node opens the underlying note/person/reference in its native Hilt view; and the reciprocal "Show in graph" from those views.

**Non-Goals (v1)**
- No WebGPU baseline (optional desktop enhancement only).
- No client-side full re-simulation of large graphs (layout is server-precomputed; client freezes at rest).
- No graph editing — the graph is read-only and derived from the vault.
- No 3D (cosmos.gl 2D first; the `z` column is reserved).
- No materialized tag layer in the default build (tags are on-demand only).

## Decisions (settled)

These four are non-negotiable and are baked into every section below.

1. **Sub-mode label is "Graph"** — `SystemMode` value `"graph"`, Lucide **`Network`** icon.
2. **Desktop default scope is the GLOBAL graph** — not the local-of-recent-note. Mobile defaults to a capped LOCAL neighborhood (forbidden to ship the global buffer to a phone).
3. **A "Show in graph" affordance** lives in a node's Docs / People / Library detail view and deep-links into the Graph sub-mode focused on that node — the reciprocal of node click-through — in addition to living under System.
4. **Tag nodes are OFF by default**, materialized and served only on demand. The default builder pass never creates `tag` nodes or `tag` edges.

### Two cross-cutting consistency rules (resolved here once)

- **Feature flag predicate.** There is **one** reader: `isGraphEnabled()` in `src/lib/graph/config.ts`, defined as `process.env.HILT_GRAPH_ENABLED === "true"` — matching the `isLocalAppsEnabled()` precedent (`src/lib/local-apps/settings.ts:8`, verified). Every API route and the System wiring import this helper; **no inline `process.env` checks, no `=== "1"` variants.** `.env.example` documents it commented-out and opt-in: `# HILT_GRAPH_ENABLED=true`.
- **Deep-link grammar.** There is **one** grammar, **path-segment only** (no query strings — `navigateTo(mode, scope)` builds the URL as `/${mode}${scope}` and cannot carry a query string; verified `ScopeContext.tsx:65`, `url-utils.ts:35`). It is defined once in `src/components/graph/graph-deeplink.ts` and imported everywhere. See [Scope & deep-link grammar](#scope--deep-link-grammar-one-source-of-truth).

## System Integration

Graph is a **sub-mode of the existing System tab**, not a new top-level tab. The "System" tab is already bound to **Cmd+7** (`ViewToggle.tsx:38`, `NavBar.tsx:32`). No new top-level `ViewMode`, no new `VIEW_KEYS` entry, no new `ViewPrefix` — `/system/graph` routes through existing generic logic.

### File 1 — `src/lib/system/navigation.ts` (2 edits, the only hard prerequisite)

Current (`navigation.ts:3,5-7`, verified):

```typescript
export type SystemMode = "sessions" | "apps" | "stack" | "sync";

export function isSystemMode(value: string | null | undefined): value is SystemMode {
  return value === "apps" || value === "stack" || value === "sessions" || value === "sync";
}
```

Edit to:

```typescript
export type SystemMode = "sessions" | "apps" | "stack" | "sync" | "graph";

export function isSystemMode(value: string | null | undefined): value is SystemMode {
  return value === "apps" || value === "stack" || value === "sessions" || value === "sync" || value === "graph";
}
```

`systemScopeForMode("graph")` already returns `/graph` (the non-stack branch, line 11). `systemModeFromUrl()` reads `scopePath.split("/").filter(Boolean)[0]` and validates via `isSystemMode()` (lines 19-20), so once `"graph"` is in the guard, `/system/graph` resolves to `systemMode === "graph"` automatically. `stackScopeFromSystemUrl()` is stack-specific and untouched.

**This guard edit is also the hard prerequisite for localStorage persistence:** `Board.tsx` restores the last System sub-mode from `SYSTEM_MODE_STORAGE_KEY` validated through `isSystemMode()` (Board:79). Without the guard edit, a persisted `"graph"` silently falls back to `"sessions"`.

### File 2 — `src/components/system/SystemView.tsx` (4 edits)

**2a — import the icon** (line 5):

```typescript
import { Bot, FileText, Layers, Loader2, Map as MapIcon, Network, RefreshCw, Server } from "lucide-react";
```

**2b — lazy-load `GraphView`** next to the `StackView` `dynamic()` (line 19). `ssr: false` is mandatory — cosmos.gl/luma.gl touch `window`/`document` at import time and the WebGL2 `Graph` instance must be client-only:

```typescript
const GraphView = dynamic(() => import("@/components/graph/GraphView").then((m) => ({ default: m.GraphView })), { ssr: false });
```

**2c — add the MODES entry** (the array is at lines 30-35), Graph last so Sessions/Apps/Stack/Sync order is preserved:

```typescript
  { id: "sync", label: "Sync", icon: RefreshCw, title: "Syncthing sync health" },
  { id: "graph", label: "Graph", icon: Network, title: "Knowledge graph of the vault" },
];
```

`SystemModeSwitcher` (lines 62-79) renders `MODES` generically — the segmented button appears with no switcher edit. **Gating strategy:** keep the entry unconditional (consistent with Apps), and enforce the flag at the API layer (below); a disabled graph renders a reason panel and never allocates a WebGL context. *No conditional MODES filtering* — that avoids any half-enabled UI state.

**2d — add the render branch** (current chain lines 48-56). Convert the trailing `else` (Sync) into an explicit conditional and insert Graph before it:

```tsx
        {mode === "sessions" ? (
          <MapView searchQuery={searchQuery} apiBase="/api/system/sessions" modeSwitcher={modeSwitcher} />
        ) : mode === "apps" ? (
          <LocalAppsView searchQuery={searchQuery} modeSwitcher={modeSwitcher} />
        ) : mode === "stack" ? (
          <SystemStackView workingFolder={workingFolder} searchQuery={searchQuery} modeSwitcher={modeSwitcher} />
        ) : mode === "graph" ? (
          <GraphView searchQuery={searchQuery} modeSwitcher={modeSwitcher} scopePath={graphScopePath} />
        ) : (
          <SystemSyncView modeSwitcher={modeSwitcher} />
        )}
```

`GraphView` consumes `modeSwitcher` and renders the System segmented control inside its own `SecondaryToolbar`, exactly as `MapView`/`LocalAppsView`/`SystemSyncView` do. Add `scopePath?: string` (default `""`) and `graphScopePath` to `SystemViewProps`, threaded from Board (File 3).

**`index.ts` note:** `src/components/system/index.ts` only re-exports `SystemView`/`SystemMode`. `GraphView` ships from `@/components/graph`, so no edit there.

### File 3 — `src/components/Board.tsx` (1 small edit: scope derivation only)

Board already routes `/system/<mode>` generically (verified): `systemMode` via `systemModeFromUrl(urlViewMode, scopePath)` (Board:60); `setSystemMode` (88-93) navigates to `/system/graph` for `mode==="graph"` (stack-scope branch skipped); `SYSTEM_MODE_STORAGE_KEY` persistence (25, 79, 90) is generic. **No routing or persistence edits.**

Add a `graphScopePath` derivation alongside `stackScopePath` (Board:61) and pass it down:

```typescript
const graphScopePath = systemMode === "graph"
  ? scopePath.split("/").filter(Boolean).slice(1).join("/")  // remainder after "graph"
  : "";
```

Pass `scopePath={graphScopePath}` into both `<SystemView>` renders (Board:241, 280). The remainder for a focus deep-link is `focus/<encodedId>[/local|/global]` (see grammar), which `GraphView` parses.

### Cmd+7 reach and shortcuts

Cmd+7 opens System (`VIEW_KEYS["7"]="system"`, `NavBar.tsx:32`) and restores the last sub-mode from localStorage; if that was Graph, Cmd+7 lands on `/system/graph`. **No dedicated Graph shortcut** (sub-modes are not individually key-bound; the Cmd+1–7 row is full). The `SHORTCUTS` popup documents top tabs only — **no edit**.

### CLI `/navigate` allowlist (one server edit for Decision 3)

`server/ws-server.ts:128` hardcodes `validViews = ["bridge","docs","stack","briefings","calendar","people"]` and 400s anything else (verified). The in-app React `navigateTo("system", ...)` path does **not** go through this endpoint, but the **file-based/Electron-IPC navigate channel does** (used when the renderer WS reconnect is throttled — exactly the backgrounded-window / mobile-Tailscale case). Since Decision 3 routes "Show in graph" to `system`, **add `"system"` to `validViews`** and confirm the Electron main `NAVIGATE_FILE` forwarder and the renderer `goto` handler accept a `system` view + scope path. Add an e2e assertion that `POST /navigate {view:"system", path:"/graph/focus/<id>"}` returns 200 and lands focused.

### Scope & deep-link grammar (one source of truth)

`src/components/graph/graph-deeplink.ts` is the **only** place that defines or parses graph scope. Both the "Show in graph" buttons and `GraphView` import it; the API route validates `scope` against the shared `GraphScope` type from `src/lib/graph/types.ts` (no re-typed string literals anywhere).

```typescript
import type { GraphScope } from "@/lib/graph/types"; // "global" | "local"

// Path tail after "/system" — i.e. the value SystemView passes as scopePath,
// which is the segment(s) AFTER "graph" (Board strips the leading "graph").
export interface GraphScopeParse {
  focusId: string | null;
  scope: GraphScope | null;   // null => apply device default (desktop global, mobile local)
}

export function parseGraphScope(scopePath: string): GraphScopeParse {
  const parts = scopePath.split("/").filter(Boolean); // e.g. ["focus", "<enc>", "local"]
  if (parts[0] === "focus" && parts[1]) {
    const focusId = decodeURIComponent(parts[1]);
    const scope = parts[2] === "local" || parts[2] === "global" ? parts[2] : null;
    return { focusId, scope };
  }
  if (parts[0] === "local") return { focusId: null, scope: "local" };
  if (parts[0] === "global") return { focusId: null, scope: "global" };
  return { focusId: null, scope: null };
}

// Returns a scope string for navigateTo("system", ...): "/graph", "/graph/focus/<enc>", etc.
export function buildGraphScope(o: { focus?: string; scope?: GraphScope }): string {
  const f = o.focus ? `/focus/${encodeURIComponent(o.focus)}` : "";
  const s = o.scope ? `/${o.scope}` : "";
  return `/graph${f}${s}`;
}
```

Canonical URL forms (the **only** ones):

| URL | Meaning |
|-----|---------|
| `/system/graph` | Default scope (GLOBAL on desktop, LOCAL on mobile per Decision 2). |
| `/system/graph/focus/<encodedNodeId>` | Focus that node; scope = device default. (What "Show in graph" emits.) |
| `/system/graph/focus/<encodedNodeId>/local` | Local N-hop around the focused node. |
| `/system/graph/focus/<encodedNodeId>/global` | Global graph, camera centered on the node. |
| `/system/graph/local` / `/system/graph/global` | Force scope without a focus (e.g. mobile "see everything" with caps). |

**All `?focused=…` query-string forms are deleted** from the Test Plan and Phasing. "Show in graph" calls `navigateTo("system", buildGraphScope({ focus: nodeId }))` → `/system/graph/focus/<enc>` → on history pop, `parseViewUrl` splits on `/`, first segment is `graph`, `isSystemMode` accepts it, and `parseGraphScope` recovers the focus id. A regression unit test round-trips `buildGraphScope → buildViewUrl → parseViewUrl → systemModeFromUrl → isSystemMode` asserting `mode === "graph"` and the focus id survives.

### `.env.example`

Add under the System block:

```bash
# Knowledge graph sub-mode (System → Graph). Opt-in; off while Library/connections work is in flight.
# HILT_GRAPH_ENABLED=true
# HILT_GRAPH_DB_PATH=                       # default: $DATA_DIR/graph.sqlite
# HILT_GRAPH_MAX_NODES_MOBILE=1500
# HILT_GRAPH_MAX_NODES_DESKTOP=20000        # soft ceiling; above this, aggressive LOD
# HILT_GRAPH_LAYOUT_ITERATIONS=300
# HILT_GRAPH_LAYOUT_WARM_ITERATIONS=40
# HILT_GRAPH_LAYOUT_INCREMENTAL_ITERATIONS=60
# HILT_GRAPH_LAYOUT_DEBOUNCE_MS=500
# HILT_GRAPH_LAYOUT_DISABLED=               # =true to serve hash-placement positions only
# HILT_GRAPH_TAGS=                          # =true to allow on-demand tag layer (still off in default payload)
# HILT_GRAPH_INCLUDE_LIBRARIES=             # =true to include nested library sub-vault docs in the global graph
```

### Edit checklist (System integration)

| # | File | Change |
|---|------|--------|
| 1 | `src/lib/system/navigation.ts` | Add `"graph"` to `SystemMode` + `isSystemMode()` |
| 2 | `src/components/system/SystemView.tsx` | Import `Network`; `dynamic()` `GraphView`; MODES entry; render branch + `scopePath` prop |
| 3 | `src/components/Board.tsx` | `graphScopePath` derivation + prop pass-through |
| 4 | `src/lib/graph/config.ts` (new) | `isGraphEnabled()` reading `HILT_GRAPH_ENABLED === "true"` |
| 5 | `server/ws-server.ts` | Add `"system"` to `/navigate` `validViews`; instantiate graph runner + marker watch (see Builder) |
| 6 | `.env.example` | Document the flag block |

**Explicitly NOT changed:** `src/lib/url-utils.ts`, `ViewToggle.tsx`, `NavBar.tsx` `VIEW_KEYS`/`SHORTCUTS`, `SYSTEM_MODE_STORAGE_KEY` logic, `src/components/system/index.ts`, `connections.ts`/`digestion.ts`.

## Data Model, Node Types & Edge Sources

Renderer-agnostic durable core (Phase 0). Mirrors `src/lib/calendar/` conventions.

### Module layout (`src/lib/graph/`)

| File | Responsibility |
|------|----------------|
| `config.ts` | `getGraphDataDir()`, `getGraphDbPath()`, `getGraphMarkerPath()`, `isGraphEnabled()`, bounded env getters, `LAYOUT_VERSION` + `TRANSPORT_FORMAT_VERSION` constants, vault-root + node-inclusion policy. |
| `db.ts` | `getGraphDb()` singleton (WAL + `synchronous=NORMAL`), `ensureGraphSchema()`, upserts/queries, `selectGlobalGraph`, `selectLocalGraph` (BFS), `graphMeta()`, `closeGraphDbForTests()`. |
| `types.ts` | `GraphNode`, `GraphEdge`, `GraphNodeType`, `GraphEdgeKind`, `GraphMeta`, `GraphScope`, `GraphFormatError`, decoded `GraphPayload`. |
| `sources.ts` | Pure extractors: one vault file → `{ node, edges[] }` by delegating to existing parsers. No DB access. |
| `build.ts` | `buildFullGraph()`, `updateGraphForFile()`, `removeGraphForFile()`, `buildTagLayer()`, dirty-region marking, periodic mtime reconcile. |
| `layout.ts` (+ optional `layout-worker.ts`) | ngraph.forcelayout; warm-start; relax dirty region; persist `node_positions`. |
| `encode.ts` | Server binary `ArrayBuffer` encoder (the canonical wire format). |
| `notify.ts` | `touchGraphChanged(detail)` marker-file writer (mirrors `calendar/notify.ts`). |

### `config.ts`

```typescript
export function getGraphDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}
export function getGraphDbPath(): string {
  return process.env.HILT_GRAPH_DB_PATH || path.join(getGraphDataDir(), "graph.sqlite");
}
export function getGraphMarkerPath(): string {
  return path.join(getGraphDataDir(), "graph-build-event.json");
}
export function isGraphEnabled(): boolean {
  return process.env.HILT_GRAPH_ENABLED === "true";   // ONE predicate, matches local-apps
}
export const LAYOUT_VERSION = 1;            // bump to invalidate ALL cached positions
export const TRANSPORT_FORMAT_VERSION = 1;  // bump on any wire-format change (distinct from LAYOUT_VERSION)
export function graphTagsEnabled(): boolean { return process.env.HILT_GRAPH_TAGS === "true"; }
export function graphIncludeLibraries(): boolean { return process.env.HILT_GRAPH_INCLUDE_LIBRARIES === "true"; }
export function graphLayoutDisabled(): boolean { return process.env.HILT_GRAPH_LAYOUT_DISABLED === "true"; }
// bounded env getters (calendar boundedInt pattern):
export function graphMaxNodesMobile(): number { /* default 1500, [50, 20000] */ }
export function graphMaxNodesDesktop(): number { /* default 20000, [1000, 500000] */ }
export function graphLayoutIterations(): number { /* default 300 */ }
export function graphLayoutWarmIterations(): number { /* default 40 */ }
export function graphLayoutIncrementalIterations(): number { /* default 60 */ }
export function graphLayoutDebounceMs(): number { /* default 500 */ }
```

`closeGraphDbForTests()` must reset **both** `cachedDb` and `cachedPath` (calendar/granola/map gotcha) so tests rebind to a temp DB.

#### Node-inclusion policy (Critical — drives the whole feature)

The scan **must exclude all dotdirs** (`.git`, `.obsidian`, `.claude`, `.codex`, `node_modules`, `.cache` except the candidate dir which is read via the cache API, not the walker). Without this the global graph balloons from ~4.7k to ~11.4k files of pure noise.

Default **global graph = primary vault dirs only**: `projects`, `people`, `meetings`, `references` (saved refs, excluding `.cache`), `areas`, `thoughts`, `lists/now`, `docs`. The three nested `libraries/<sub>` sub-vaults are **excluded by default** (`graphIncludeLibraries()` opt-in). When opt-in, each `libraries/<sub>` is modeled as a **collapsible cluster** (a single synthetic cluster node that expands on demand), not 2,235 raw leaf nodes — its own `.git`/`.obsidian` dirs are still excluded.

Additionally, **degree-0 nodes are filtered out of the default global payload** (a `?includeIsolated=1` opt-in shows them). The primary vault still has a long isolated-leaf tail (drafts, stubs); hiding them by default keeps the global graph a *knowledge* graph, not a dust cloud. (Candidates are intentionally low-degree leaves — see below — and are exempt: they are shown when explicitly focused, with an empty-neighborhood hint.)

### `graph.sqlite` schema (`ensureGraphSchema`)

Pragmas **before** `CREATE TABLE` (calendar precedent). All `IF NOT EXISTS`.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS graph_nodes (
  id          TEXT PRIMARY KEY,   -- stable derived ID (see Node ID scheme)
  type        TEXT NOT NULL,      -- note|reference|candidate|person|project|north_star|library_cluster|tag
  label       TEXT NOT NULL,
  ref_path    TEXT,               -- absolute vault path, or person slug; NULL for synthetic
  degree      INTEGER NOT NULL DEFAULT 0,
  color_key   TEXT,
  source_file TEXT,               -- the vault file whose change owns this node (incremental delete key)
  attrs_json  TEXT,               -- per-type extras
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type    ON graph_nodes(type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_ref     ON graph_nodes(ref_path);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_srcfile ON graph_nodes(source_file);

CREATE TABLE IF NOT EXISTS graph_edges (
  id          TEXT PRIMARY KEY,   -- hash(source_id|target_id|kind) — upsert/dedupe
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,      -- wikilink|connection|connected_project|meeting|tag
  weight      REAL NOT NULL DEFAULT 1,
  source_file TEXT,               -- the file that produced this edge (re-extract side)
  attrs_json  TEXT,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source  ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target  ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_kind    ON graph_edges(kind);
CREATE INDEX IF NOT EXISTS idx_graph_edges_srcfile ON graph_edges(source_file);

CREATE TABLE IF NOT EXISTS node_positions (
  id             TEXT PRIMARY KEY,
  x              REAL NOT NULL,
  y              REAL NOT NULL,
  z              REAL,                       -- NULL in 2D v1
  dirty          INTEGER NOT NULL DEFAULT 1, -- 1 = needs (re)layout
  layout_version INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_node_positions_dirty   ON node_positions(dirty);
CREATE INDEX IF NOT EXISTS idx_node_positions_version ON node_positions(layout_version);

CREATE TABLE IF NOT EXISTS graph_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`graph_meta` keys: `node_count`, `edge_count`, `built_at`, `layout_version`, `layout_state` (`idle|building|running|frozen|stale`), `layout_phase`, `nodes_placed`, `total_nodes` (coarse progress for the first-run panel), `dirty_node_ids` (JSON array), `tags_built` (`0|1`), `last_error`. Upserts use `ON CONFLICT(<pk>) DO UPDATE SET col = excluded.col` listing **every** mutable column (partial upserts leave stale values). Multi-row writes wrap in `db.transaction(() => {…})()`. JSON columns parse through a shared `parseJson<T>(value, fallback)` with a **type-matching** fallback (`{}` for object attrs, `[]` for arrays).

### Node ID scheme (stable, derived, click-through-ready)

| Type | `id` | `ref_path` | Source |
|------|------|-----------|--------|
| `note` | `note:<sha1(absPath)>` | absolute `.md` path | any included `.md` not classified below |
| `reference` | `ref:<sha1(absPath)>` | absolute path under `references/` (excl `.cache`) | saved Library artifact (`state:"saved"`) |
| `candidate` | `cand:<artifactId>` | absolute candidate path (or null) | candidate cache (`state:"candidate"`) |
| `person` | `person:<slug>` | person slug (e.g. `art-vandelay`) | `people/<slug>.md` |
| `project` | `project:<slug>` | absolute project `index.md` | `projects/<slug>/index.md` |
| `north_star` | `north_star:areas` (singleton) | `areas/index.md` | `areas/index.md` |
| `library_cluster` | `libcluster:<sub>` | `libraries/<sub>` dir | nested sub-vault root (opt-in) |
| `tag` | `tag:<normalizedTag>` | NULL (synthetic) | frontmatter tags (ON DEMAND) |

IDs are stable across rebuilds so cached `node_positions` survive. The client `encodeURIComponent`s the `id` for "Show in graph"; click-through resolves back via `ref_path`.

### Node types (Decision 4: tags OFF by default)

- `note` — generic vault markdown (Docs). Click-through → `navigateTo("docs", absPath)`.
- `reference` — saved Library artifact. Click-through → Library detail.
- `candidate` — review-queue artifact; distinct `color_key`; **no connection edges until promoted** (digestion only populates connections when `willBeDurablySaved`), so candidates are low-degree leaves *by design*. Sourced from the candidate cache API, not the file walker (see Builder).
- `person` — `people/<slug>.md`. `ref_path` = slug.
- `project` — `projects/<slug>/index.md`.
- `north_star` — single synthetic node from `areas/index.md` (`northStarSignal()` returns one signal targeting `areas`, `kb-index.ts:88`); area-membership edges hang off it.
- `library_cluster` — opt-in collapsible cluster per nested sub-vault.
- `tag` — off by default; built only when requested. Lives in a separate render layer and builder pass.

### Edge kinds & concrete parser mapping (read-only reuse; no writes to connections/digestion)

**1. `wikilink` — `parseWikilinks()` + `resolveWikilink()` (`src/lib/docs/wikilink-resolver.ts`)**
- `parseWikilinks(content)` yields `{ target, display }`; image links `![[...]]` already excluded by the regex.
- Resolve via `resolveWikilink(target, currentFilePath, scopePath, fileTree)` → `ResolvedLink { absolutePath, exists, displayName }`. Section anchors stripped by the resolver (`wikilink-resolver.ts:83-84`).
- Create an edge only when `exists === true` and `absolutePath` non-null; map both endpoints through the ID scheme. Skip unresolved links (no placeholder nodes).
- Edge: `source = <currentFile node>`, `target = <absolutePath node>`, `kind = "wikilink"`, `weight = 1`, `attrs_json = { display }`.
- **Performance — mandatory fix (see Builder).** `resolveWikilink` rebuilds the entire file map on *every call* (`buildFileMap` walks the tree up to 3× per link, verified `wikilink-resolver.ts:104,148,171`). At ~1,557 wikilink files over a ~2,485-node tree that is hundreds of millions of node visits per full build. The graph builder **must not call `resolveWikilink` per link.** It builds the file map **once** and uses a graph-local resolver over the prebuilt `Map` (see Builder).

**2. `connection` — `ProcessedArtifact.connection_suggestions: ConnectionSuggestion[]` (`library/types.ts:90-95`)**
- Present only on durably saved artifacts. Each: `{ target?, label, relationship, kind? }`.
- Edge: `source = <reference node>`, `target = <node resolved from suggestion.target>` (project slug, person slug, or `areas`). When `target === null`, **drop the edge** (no synthetic theme node); keep the relationship in the node inspector. `kind = "connection"`, `attrs_json = { relationship, label, kind }`.

**3. `connected_project` — `ProcessedArtifact.connected_projects: string[]` (`types.ts:119`)**
- Project-slug subset of connections. Edge: `source = <reference node>`, `target = project:<slug>`, `kind = "connected_project"`, `weight = 1.5`.

**4. `meeting` — People ↔ meeting (two parser calls, corrected)**
- `matchMeetingsToSlug(slug, name, meetingFilenames, aliases)` returns **`string[]` — matched meeting *filenames* only** (verified `people-parser.ts:248-284`). It does **not** return metadata.
- For each matched filename, read the file and call `parseMeetingFrontmatter(content, filename)` (verified `people-parser.ts:289`) to get `{ title, created, hiltCalendarEventId, … }`.
- Edge: `source = person:<slug>`, `target = <note node for the meeting .md>` (`ref_path` = absolute meeting path), `kind = "meeting"`, `attrs_json = { date: created, title, hilt_calendar_event_id: hiltCalendarEventId }`. The calendar id is retained as metadata; it does not create a calendar node in v1.

**5. `tag` — frontmatter tags (ON DEMAND only — Decision 4)**
- Project tags via `parseIndexFile()` (`project-parser.ts:105-108`): comma-separated YAML `tags` split/trimmed. Note tags same shape, retained in `attrs_json` on every build.
- Only `buildTagLayer()` mints `tag:<normalizedTag>` nodes and `kind="tag"` edges (undirected → canonical `(min,max)` endpoint ordering). The default build skips this entirely. **Bounded inclusion:** materialize only tags with member count in `[2, K]` (drop singletons; mega-tags above K render as a labeled cluster, not an edge-fanning hub). See Renderer/UI for placement.

> **North Stars.** `northStarSignal()` is one signal targeting `areas/index.md` (`kb-index.ts:88`). The `north_star:areas` node is the hub; `connection`/`connected_project` edges resolving to `areas` attach to it. Individual area folders are not separate nodes in v1.

### `degree` and `color_key`

`degree` recomputed as `COUNT(*)` over `graph_edges` per endpoint after each build/incremental pass (single `UPDATE … SET degree = (SELECT COUNT(*) …)` or in-memory tally in the build transaction). It drives node-size LOD and the degree-0 filter. `color_key` defaults to `type`; for `reference`/`note`/`project` it prefers the owning area/North-Star bucket from `attrs_json.area` (contextual-color philosophy).

### Derived-cache contract (Critical Constraint #2)

1. **Markdown is canonical.** `graph.sqlite` is a pure derived cache under `DATA_DIR` (which `dev:all` sets to `$HOME/.hilt/data`, **outside all watched vault roots** — no watcher feedback loop, verified). The module never writes the vault or transcript stores.
2. **Rebuildable from scratch.** Deleting `graph.sqlite` and rebuilding reproduces the same nodes/edges. Positions are reproducible given a fixed seed; `layout_version` gates validity.
3. **Incremental, watcher-driven** (see Builder for exact watch set).
4. **Layout decoupled from index.** `build.ts` keeps nodes/edges current; `layout.ts` consumes them and writes `node_positions`, broadcasting completion via the marker. The client freezes at rest and never re-simulates.
5. **Tags are a removable layer.** `buildTagLayer()` adds/removes `tag` rows without invalidating the rest of the cache; the **default `SELECT` filters by `type`**, so a stale `tags_built=1` never leaks tags into a default payload.
6. **Stays clear of in-flight work.** Gated by `HILT_GRAPH_ENABLED`; reads `connection_suggestions`/`connected_projects` read-only; zero schema/behavior changes to Library/connections.

### Domain types (`src/lib/graph/types.ts`)

```typescript
export type GraphNodeType =
  | "note" | "reference" | "candidate" | "person" | "project" | "north_star" | "library_cluster" | "tag";
export type GraphEdgeKind =
  | "wikilink" | "connection" | "connected_project" | "meeting" | "tag";
export type GraphScope = "global" | "local";   // single source of truth for scope literals

export interface GraphNode {
  id: string; type: GraphNodeType; label: string;
  refPath: string | null;  // absolute path, or person slug
  degree: number; colorKey: string | null; attrs: Record<string, unknown>;
}
export interface GraphEdge {
  id: string; source: string; target: string;  // source/target are node ids
  kind: GraphEdgeKind; weight: number; attrs: Record<string, unknown>;
}
export interface GraphMeta {
  enabled: boolean; nodeCount: number; edgeCount: number; tagNodeCount: number;
  builtAt: string | null; layoutVersion: number;
  layoutState: "idle" | "building" | "running" | "frozen" | "stale";
  layoutPhase: string | null; nodesPlaced: number | null; totalNodes: number | null;
  dirty: boolean; stale: boolean; lastError: string | null; truncated?: boolean;
  budgets: { mobileMaxNodes: number; desktopMaxNodes: number; defaultHops: number;
             defaultScope: { desktop: "global"; mobile: "local" } };
}
// Decoded in-memory shape (NOT the wire layout — see Binary Transport for the canonical wire format):
export interface GraphPayload {
  positions: Float32Array;  // [x0,y0, x1,y1, ...] index-aligned to nodes[]
  links: Float32Array;      // [src0,tgt0, ...] node-array INDICES (Float32 — cosmos.gl setLinks)
  colorKeys: Uint8Array;    // enum index per node
  nodes: GraphNode[];       // sidecar; index i <-> positions[2i..2i+1]
  truncated: boolean;
}
export class GraphFormatError extends Error {}
```

**Index-vs-ID gotcha (bake in everywhere):** cosmos.gl `onPointClick` returns the **point array index, not a node id**, and `setLinks`/`setPointPositions` consume **`Float32Array`** (the corrected type — see Binary Transport). The encoder assigns a deterministic index per node; the sidecar `nodes[]` is the index→`GraphNode` (hence index→`id`/`refPath`) map the renderer uses for click-through and hover.

### Files (this section)

- New: `config.ts`, `db.ts`, `types.ts`, `sources.ts` (deliverables); `build.ts`, `layout.ts`, `encode.ts`, `notify.ts` (consumers).
- Reused read-only: `wikilink-resolver.ts`, `library/types.ts`, `people-parser.ts`, `project-parser.ts`, `kb-index.ts`, `candidate-cache.ts`.
- No edits to `connections.ts`/`digestion.ts`.

## Graph Builder & Incremental Updates

### Full build (`buildFullGraph()`)

Runs on cold start when `graph.sqlite` is empty or `layout_version` ≠ `LAYOUT_VERSION`, and on `POST /api/system/graph/rebuild`. Wrapped in `db.transaction()`:

1. Resolve the vault root (`BRIDGE_VAULT_PATH || HILT_WORKING_FOLDER || ~/work/bridge`, matching BridgeWatcher). Walk the **included** dirs only, **excluding dotdirs** and (by default) `libraries/`. Build **one** `FileNode` tree and **one** prebuilt wikilink resolution `Map` for the whole pass.
2. For each file, run the matching `sources.ts` extractor; resolve wikilinks against the prebuilt map (never per-call `resolveWikilink`); upsert node + edges (`ON CONFLICT(id) DO UPDATE SET …` listing every mutable column; `source_file` set).
3. Pull **candidates from the candidate cache API** (`listCandidates`/`findCandidateById`), not the walker — `references/.cache/library-candidates` is a dotdir, unwatchable and unwalked. Upsert `candidate` nodes with `source_file = <candidate file path>` (for later removal).
4. `reconcileDanglingEdges()` (drop or note edges with no resolvable target); recompute `degree`; set `color_key`; apply the **degree-0 filter** for the default global selection (kept in the table, excluded at `SELECT`).
5. Insert/refresh `node_positions` (`dirty=1`), set `graph_meta` (`node_count`, `edge_count`, `built_at`, `layout_state="building"`, `total_nodes`, `nodes_placed=0`, `tags_built=0`).
6. Kick layout for a full pass; stream coarse progress into `graph_meta` (`layout_phase`, `nodes_placed`); on completion clear `dirty`, set `layout_state="frozen"`, `touchGraphChanged({ kind: "full" })`.

Tag layer is excluded; `buildTagLayer()` runs only via the on-demand path and sets `tags_built=1`. Tag rows never count toward `LAYOUT_VERSION` or baseline `node_positions`.

### Incremental update (hot path)

```
updateGraphForFile(absPath):
  node = extract(absPath)                                  // reuse parsers + prebuilt resolver map
  tx:
    DELETE FROM graph_edges WHERE source_file = absPath    // drop this file's outbound edges
    upsert node row (source_file = absPath)
    insert new edges (source_file = absPath)
    recompute degree for {node + touched neighbors}
    mark node_positions.dirty = 1 for node + 1-hop neighbors
    graph_meta.layout_state = "stale"
  schedule debounced relaxDirty()

removeGraphForFile(absPath):  // unlink
  tx: collect neighbor ids; DELETE edges/nodes WHERE source_file = absPath;
      reconcileDanglingEdges(); recompute neighbor degree; mark neighbors dirty.
```

The **dirty region** is the changed node + 1-hop neighbors. Whether to pull 2-hop for visual stability is a layout-tuning knob; the `dirty` flag makes either selectable without schema change.

### Watcher integration — corrected for how the watchers actually emit

The graph index is server-side, hooking existing watchers (no second chokidar where avoidable). A long-lived `getGraphRunner()` (instantiated in `startServer()` only when `isGraphEnabled()`) wires:

**BridgeWatcher events — but do NOT trust the single `path`.** BridgeWatcher debounces by `key = type` (verified `bridge-watcher.ts:77`), so a burst across many files in one 200ms window collapses to **one emit carrying only the last file's path**, and it watches at `depth: 2`. Therefore, on `projects-changed`/`people-changed`/`thoughts-changed`, the runner does **not** surgically update the single `path`. Instead it **re-scans the affected top-level dir and diffs against the index by `source_file` mtime**, updating only files whose mtime changed:

```ts
bridgeWatcher.on("projects-changed", () => runner.onDirChanged("projects"));
bridgeWatcher.on("people-changed",   () => runner.onDirChanged("people"));   // + meetings (same event)
bridgeWatcher.on("thoughts-changed", () => runner.onDirChanged("thoughts"));
```

`onDirChanged(dir)` lists current files (excluding dotdirs), compares mtimes to a small in-memory `source_file → mtime` map, and calls `updateGraphForFile`/`removeGraphForFile` for the diff. This is robust to the per-type debounce collapse and to the `depth:2` cap (it walks the real dir, not the event path).

**ScopeWatcher for wikilink-bearing docs + references** (BridgeWatcher does **not** cover `references/` or `docs/`). The runner registers a **persistent internal client** at startup with a reserved id and the vault root, then listens:

```ts
const GRAPH_RUNNER_CLIENT_ID = "graph-runner";
scopeWatcher.watchScope(vaultRoot, GRAPH_RUNNER_CLIENT_ID);   // ref-counted; survives UI subs
scopeWatcher.on("file:changed", (e) => runner.onFileChanged(e.path));
scopeWatcher.on("tree:changed", (e) => e.type === "unlink" ? runner.onFileRemoved(e.path) : runner.onFileChanged(e.path));
```

`vaultRoot` **must be a single ancestor of `projects`/`people`/`meetings`/`references`/`docs`/`areas`/`thoughts`** (it is — they are siblings under the bridge root). ScopeWatcher keys on exact scope-path string match, so watching the root covers all of them with one subscription. SIGINT teardown calls `scopeWatcher.unwatchScope(vaultRoot, GRAPH_RUNNER_CLIENT_ID)`. The runner's `removeClient` is never invoked for this id (it is not a WebSocket client), so it is not evicted by UI disconnects.

**Candidates (eventual, not file-watcher-incremental).** Candidates live in a dotdir and churn via Library ingest; neither watcher fires for them. The runner refreshes candidate nodes off the **candidate cache directly** — hooking whatever signal Library ingest/digestion already emits, or, failing that, polling `listCandidates` on the same cadence the Library refresh uses. `expireCandidates()` flips status to `"expired"` (verified `candidate-cache.ts:196-203`); the runner treats expired/removed candidates as `removeGraphForFile`-equivalent node deletions. **Candidate freshness is documented as eventual.**

**Periodic full reconcile (backstop).** A cheap mtime diff over all included dirs runs on an interval (e.g. 5 min) and on cold start, self-healing any drift the event path missed. This makes the incremental promise robust without claiming perfect per-event fidelity.

The runner coalesces with its own debounce ≥ 200ms, batching a burst into one `relaxDirty()` + one notify. It never writes the vault (graph lives under `DATA_DIR`), so no `suppressWrite()` is needed.

### Concurrency / single-flight (decided)

- The layout worker (or chunked loop) is single; the orchestrator owns all DB writes.
- `POST /rebuild` returns `409 { blocked: true }` if a rebuild/layout pass is running.
- A **full rebuild supersedes and clears the incremental queue**; dirty marks are re-derived from the full build. Incremental requests arriving during a full build are coalesced and run after it (often no-ops, since the full build placed them).
- A **watchdog** resets `layout_state` from `running`/`building` to `stale` and records `graph_meta.last_error` if a run exceeds a max wall-clock or the worker crashes, so a stuck state self-heals and `/meta` surfaces it. The next watcher event or `/rebuild` re-runs.

### WebSocket notify

After a relax/full build completes, `notify.ts touchGraphChanged({ kind, changed })` writes `DATA_DIR/graph-build-event.json`. In `ws-server.ts`, alongside the existing calendar marker watch (~line 250):

```ts
fs.watchFile(GRAPH_MARKER_FILE, { interval: 1000 }, (curr, prev) => {
  if (curr.mtimeMs > 0 && curr.mtimeMs !== prev.mtimeMs) {
    eventServer.broadcast("graph", "changed", {}); // optionally { changed: [...] } for surgical patch
  }
});
```

Add `fs.unwatchFile(GRAPH_MARKER_FILE)` to SIGINT teardown. The client subscribes to the `graph` channel and refetches on `changed` (or applies a targeted patch when `changed` ids are present), preserving the mental map by only moving relaxed nodes. The marker keeps the WS layer decoupled from the worker (worker → orchestrator on the main thread → marker).

## Layout Precompute

ngraph.forcelayout (Barnes-Hut, O(n log n)) + ngraph.graph — pure-JS, no native build. **All layout runs on the host; the client never simulates.**

### Execution model (decided: chunked main-loop for v1, worker deferred)

There is **no `worker_threads` precedent anywhere in the codebase** (verified — zero `new Worker`/`execArgv` usages), and the tsx-dev vs compiled-Electron-prod worker-bootstrap divergence is a real, unproven risk. Given the real graph is ~2.5k connected nodes (not 30k+), **v1 runs the ngraph `step()` loop inline with cooperative yielding** — small batches (e.g. 20–40 iterations) via `setImmediate`, yielding to the event loop between batches so HTTP/WS/watchers never block. This removes the entire dev/prod worker problem.

`layout.ts` public API:
- `getLayoutEngine()` singleton.
- `requestFullLayout(reason)` — cold start / `LAYOUT_VERSION` bump / `/rebuild`.
- `requestIncrementalRelayout(changedNodeIds)` — coalesced; from the runner.
- `getLayoutState()` → `{ status, layoutVersion, lastRunMs, dirtyCount }`.
- `closeLayoutEngineForTests()`.

A `worker_thread` is a **Phase 3** optimization, gated behind a spike that proves `execArgv: ["--import","tsx"]` works for a child Worker *and* resolves a compiled `.js` worker path in the `output: "standalone"` Electron build. Until then, chunked main-loop is the shipping path. (Document the chosen approach in ARCHITECTURE.md.)

### Determinism (seeded, epsilon-tolerant — not byte-identical across runs)

- **Stable initial placement, not RNG.** Before the first step, set each node's `(x,y)` from a deterministic hash of its `id` (reuse `hashValue()`) mapped onto a seeded disc/spiral. Same id → same start.
- **Fixed physics params** from config (`timeStep`, `gravity`, `theta≈0.8`, `springLength`, `springCoefficient`, `dragCoefficient`), **fixed iteration count** (never wall-clock).
- **Determinism guarantee, correctly scoped:** Barnes-Hut float accumulation is order- and platform-sensitive, so the plan does **not** assert byte-identical positions across machines/Node-versions/restarts. The tests assert: (a) **same-run encode→decode→re-encode** is byte-identical; (b) two full layouts *in the same process on the same fixture* match within a tight epsilon; (c) cross-run/warm-start asserts **topological stability** (bounded per-node displacement / preserved relative ordering), not exact floats. If exactness ever matters, Node version + arch become part of `LAYOUT_VERSION`.

### Persistence & warm-start

- Positions written in **one transaction** at run end, upsert `ON CONFLICT(id) DO UPDATE SET x=…,y=…,z=…,layout_version=…,updated_at=…`. Orphan rows (id no longer in `graph_nodes`) deleted in the same transaction.
- On boot: if positions exist at the current `layout_version` and the index is not dirty → `layout_state = "frozen"`, serve cached positions immediately, zero layout work.
- Warm-start seeds from persisted `(x,y)` when present (else hash placement), runs `WARM_ITERATIONS` (~10–20% of full) to absorb drift. New nodes start at the centroid of their already-placed neighbors (or hash placement if isolated) so they relax in rather than fly from origin.

### Freeze at rest — corrected cosmos.gl API

Server: the loop runs to its fixed iteration count, persists, sets `layout_state = "frozen"`, then **idles** (no further `step()`).

Client: after uploading buffers, call **`graph.render()` once, then `graph.pause()`** (the real freeze idiom — there is no `enableSimulation` constructor flag or `render(0)` magic in the current cosmos.gl). Verify `graph.isSimulationRunning === false`. Idle is pure GPU render (~60fps, ~0 CPU). For an optional desktop "settle" animation, use `setConfigPartial({ onSimulationEnd: () => graph.pause() })` and a short cooldown; mobile always uses the instant pause path. **Pin the exact cosmos.gl version at install and re-verify these method names** — the package is in flux.

### Incremental relayout

Scoped, not global: relax the dirty set + its 1-hop neighborhood; **pin** all other nodes (ngraph `pinNode`/fixed flag) so the rest of the map doesn't shuffle. After the run, only touched `node_positions` rows are upserted; `layout_state` returns to `frozen`. **The "unaffected rows unchanged" guarantee means those rows are *not rewritten* (testable via `updated_at`)** — it does not claim they equal a fresh cold solve.

`HILT_GRAPH_LAYOUT_DISABLED=true` short-circuits to hash-placement positions only (escape hatch).

### Config (layout)

`LAYOUT_VERSION` (constant, bump to invalidate), `HILT_GRAPH_LAYOUT_ITERATIONS` (300), `…WARM_ITERATIONS` (40), `…INCREMENTAL_ITERATIONS` (60), `…DEBOUNCE_MS` (500), `…DISABLED`.

## Binary Transport & APIs

The wire format is the durable contract. The four routes under `src/app/api/system/graph/` follow Calendar/Granola conventions (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, thin handlers delegating to `src/lib/graph/`). All routes **404 `{ error: "Graph disabled" }`** unless `isGraphEnabled()`.

### Endpoint overview

| Method | Path | Purpose | Default `fmt` |
|--------|------|---------|---------------|
| `GET` | `/api/system/graph` | Graph payload (nodes + edges + positions) | `bin` |
| `GET` | `/api/system/graph/meta` | Counts, layout version, health, progress, budgets | `json` |
| `GET` | `/api/system/graph/node/:id` | Single node + immediate edges (hover/inspector) | `json` |
| `POST` | `/api/system/graph/rebuild` | Manual full rebuild + relayout (operational) | `json` |

### `GET /api/system/graph` — binary payload

Query params (`scope` validated against the shared `GraphScope` type):

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `scope` | `global \| local` | **`global`** (D2) | `local` requires a resolvable `node`. |
| `node` | encoded node id | — | Required for `scope=local`; `decodeURIComponent` + validate. **If unresolvable, degrade to the mobile-anchor fallback (below), never 400 on the cold path.** |
| `hops` | int `1..3` | `2` | BFS depth, clamped. |
| `limit` | int | `0` (desktop unbounded up to `desktopMaxNodes`) | Server enforces device ceilings regardless. |
| `includeTags` | `0 \| 1` | **`0`** (D4) | Tag nodes/edges omitted unless `1` (and `HILT_GRAPH_TAGS=true`). |
| `includeIsolated` | `0 \| 1` | `0` | Show degree-0 nodes (default hides them). |
| `fmt` | `bin \| json` | `bin` | `json` decodes the payload for debugging. |

#### Canonical wire format (the ONE binary layout; `GraphPayload` is the decoded shape, not this)

`Content-Type: application/octet-stream`, headers `X-Graph-Format-Version`, `X-Graph-Layout-Version`, `X-Graph-Node-Count`, `X-Graph-Edge-Count`, `X-Graph-Truncated`.

```
[ HEADER 32 bytes (Uint32 view) ]
  magic        u32   0x48474C31  // "HGL1"
  version      u32   TRANSPORT_FORMAT_VERSION
  nodeCount    u32
  edgeCount    u32
  flags        u32   bit0=hasZ, bit1=includesTags, bit2=isLocal, bit3=truncated
  reserved     u32 x3
[ POSITIONS    Float32Array(nodeCount * 2) ]   // x,y interleaved (×3 if hasZ)
[ COLOR_KEYS   Uint8Array(nodeCount) ]          // enum index into type/area palette
[ pad to 4-byte boundary ]
[ EDGES        Float32Array(edgeCount * 2) ]    // [srcIdx, tgtIdx, ...] — point ARRAY INDICES (Float32)
[ METALEN      u32 ]                            // byte length of the JSON tail
[ META         UTF-8 JSON ]
  { "ids": [...], "labels": [...], "types": [...uint], "refPaths": [...|null] }
```

**Corrected, non-negotiable facts:**
- **EDGES is `Float32Array`, not `Uint32Array`.** cosmos.gl `setLinks` and `setPointPositions` both consume `Float32Array` (verified against current cosmos.gl docs). Every prior "Uint32Array gotcha, bake in everywhere" statement is **wrong and removed.** If a compact `Uint32` representation is kept in SQLite/transport for size, the **decoder converts to `Float32Array` before `setLinks` as an explicit step.** Caveat to document: Float32 mantissa is 24 bits, so indices are exact only to 2^24 (~16.7M nodes) — fine for this vault.
- **The `DEGREES` block is dropped** from the wire format (degree is in the sidecar `attrs`/derivable; a perf test would have to justify re-adding it).
- **Three distinct versions, distinct names:** `TRANSPORT_FORMAT_VERSION` (header), `LAYOUT_VERSION` (`graph_meta`), cosmos.gl version (pinned in `package.json`). Never conflated.

#### The sidecar is the real payload cost (honest budget)

The plan does **not** claim "no JSON.parse over the node set." The binary buffers are tiny (~2.5k nodes → positions 20KB, edges ~ low tens of KB, colors 2.5KB). The **dominant cost is the JSON META tail** the client must `JSON.parse` to map `onPointClick(index) → id` and drive click-through. At global scale (~2.5k nodes) `ids + labels + refPaths + types` is ~120–200 B/node ≈ **0.3–0.5 MB** parsed on every load. Mitigations baked in:
- `types` is interned to a **`Uint8Array` enum** (7 values), not strings.
- **`refPaths` is dropped from the bulk sidecar** and resolved lazily via `GET /node/:id` on click — `refPath` is only needed at click time, not for every node. The sidecar carries `ids` + `labels` + `types` only.
- Mobile's small **local** payload keeps the sidecar tiny — that (not "global avoids JSON.parse") is the real reason mobile is fine. State this explicitly.
- The perf test asserts **sidecar byte size and parse time**, not just buffer bytes.

#### Server flow (`route.ts` → `encode.ts`)

1. `isGraphEnabled()` guard.
2. Parse + clamp params. For `scope=local` with an unresolvable `node`, fall through to the **mobile-anchor fallback** rather than 400 (below).
3. `scope=global` → `selectGlobalGraph({ limit, includeTags, includeIsolated })` (excludes dotdir/library leaves and degree-0 by policy; filters tags by `type`). `scope=local` → `selectLocalGraph({ nodeId, hops, limit, includeTags })` (BFS in SQLite).
4. Load `node_positions` for selected ids; if any missing/dirty, serve what exists and flag `dirty` in `/meta` (do **not** block on relayout). The **client gates the canvas on `built_at != null`** (see Renderer first-run), so it never renders seeded-initial coordinates as a real layout.
5. `encodeGraphBinary(selection)` → `ArrayBuffer`; `new NextResponse(buffer, { headers })`.

Decoder `src/components/graph/decode.ts` (`decodeGraphBinary`) checks `magic`/`version`, throws `GraphFormatError` on mismatch (client hard-refreshes rather than rendering garbage), and **converts the EDGES block to `Float32Array` for `setLinks`** if stored otherwise.

#### Local-scope capping — by BFS ring, not global degree

Naive "truncate by descending degree" can drop the anchor's own 1-hop neighbors in favor of distant hubs (and person nodes are super-hubs: 1,261 meetings fan into ~27 people). Instead:
- **Always include all 1-hop neighbors** of the anchor.
- Fill 2-hop by **ascending** target degree until the cap (keep the tight neighborhood, shed giant hubs first).
- **Cap hub fan-out per node** (e.g. at most K meeting-edges off a person).
- Set `truncated` **per ring** so the UI "expand" knows what was dropped and stays connected to the anchor.

#### Mobile cold-open anchor (resolved chicken-and-egg)

Mobile defaults to `scope=local`, but a cold open (Cmd+7 → Graph, or a fresh Safari tab) has no active note. Resolution order for the anchor:
1. The most-recent Docs/People scope from `localStorage` / server preferences (Board persists view state) → map to a node id if it exists in the graph.
2. Else the **highest-degree node** (a person super-hub or North Star) → its N-hop neighborhood, with a "showing the busiest part of your vault" hint.
3. **Never fall back to global on mobile** (jetsam). `scope=local` with an unresolvable/absent anchor degrades to (2), not a 400 or empty canvas.

### `GET /api/system/graph/meta`

`graphMeta()` reads `graph_meta`. JSON includes the full `GraphMeta` shape (counts, `builtAt`, `layoutVersion`, `layoutState`, **`layoutPhase`/`nodesPlaced`/`totalNodes` for the first-run progress panel**, `dirty`, `stale`, `lastError`, `tagNodeCount` (reported, not shipped), `budgets`). The client calls `/meta` first (cheap), drives its first-run state machine and scope/limit choice, then fetches the binary.

### `GET /api/system/graph/node/:id`

`decodeURIComponent(params.id)`, look up node + immediate edges. JSON (inspector-only, never binary), includes `refPath` (the lazy-resolved navigation target dropped from the bulk sidecar). **404** for unknown id → the client treats this as a stale-focus case (graceful fallback, below), never a crash.

### `POST /api/system/graph/rebuild`

Operational, **monitor-first** (Constraint #4). Request `{ fullLayout?, bumpLayoutVersion? }`; response `{ ok, nodeCount, edgeCount, layoutVersion, durationMs, blocked }`. `409 { blocked: true }` if a pass is running (single-flight). `bumpLayoutVersion=true` invalidates all cached client positions. Never deletes vault content.

### Device budgets (one renderer, two-plus ceilings)

- **Desktop/Electron:** `scope=global`, `limit=0` up to `desktopMaxNodes`, `includeTags=0`. Above `HILT_GRAPH_MAX_NODES_DESKTOP` the server still ships but flags it; the client applies aggressive LOD + a "large graph — performance reduced" hint, or offers to narrow scope (see Renderer).
- **Mobile Safari:** `scope=local&node=<anchor>&hops=2`, `limit` clamped to `HILT_GRAPH_MAX_NODES_MOBILE` (default 1500). **Server enforces the cap even if the client asks for more.** Never ships the global buffer to a phone.
- **Tags (D4):** never in the default binary; a second scoped request when toggled on; rendered as a separate layer.

### COOP/COEP

The baseline transport (`fetch().arrayBuffer()` → decode → `setPointPositions`/`setLinks`) needs **no cross-origin isolation**. Ship v1 without COOP/COEP. They become mandatory only for a future `OffscreenCanvas` + `SharedArrayBuffer` desktop path (Phase 3), gated behind `HILT_GRAPH_OFFSCREEN` and verified end-to-end over the Tailscale host. Blanket COOP/COEP can break the Library X/YouTube embeds, so it is deferred and scoped, not global.

## Renderer, Device Budgets & WebGPU

### Package & module layout

- **`@cosmos.gl/graph`** (v3+, OpenJS) — confirm name/version at install (`npm view @cosmos.gl/graph version`); **no official React wrapper**, so `GraphView` manages one `Graph` via `useRef`/`useEffect`. Do **not** add `@cosmograph/react` or `d3-force`.
- New files under `src/components/graph/`:
  - `GraphView.tsx` — sub-mode shell: toolbar (`SecondaryToolbar` + `modeSwitcher`), first-run state machine, fetch lifecycle, device-class selection, renderer instance, staleness chip.
  - `CosmosRenderer.ts` — the only file importing `@cosmos.gl/graph`; owns the `Graph`, buffer uploads, freeze, hover/click wiring.
  - `renderer.ts` — renderer-agnostic `GraphRenderer` interface (so a WebGPU engine can swap in).
  - `decode.ts` — binary `ArrayBuffer` → typed-array views; validates magic/version; converts EDGES to `Float32Array`.
  - `device-budget.ts` — pure device-class → `GraphBudget` mapping.
  - `useGraphData.ts` / `useGraphMeta.ts` — fetch + decode hooks (binary default, scope-aware; meta poll fallback).
  - `graph-deeplink.ts` — `parseGraphScope`/`buildGraphScope` (defined once; §grammar).
  - `graph-style.ts` — color-by-type/area palette, degree→size, label LOD.
  - `GraphToolbar.tsx` — Global/Local toggle, depth stepper, Show-tags toggle, legend, refresh.

### `GraphRenderer` interface (`renderer.ts`)

```ts
export interface GraphRenderer {
  mount(canvas: HTMLCanvasElement, opts: RendererOptions): void;
  setData(positions: Float32Array, links: Float32Array, colorKeys: Uint8Array, meta: NodeMeta[]): void;
  applyBudget(budget: GraphBudget): void;
  focusNode(index: number, scale?: number): void;     // deep-link (D3)
  highlightNeighbors(index: number | null): void;      // hover
  onPointClick(cb: (index: number) => void): void;     // click-through
  freeze(): void;                                       // render() then pause()
  resize(): void;                                       // viewport only; NEVER mutate canvas pixel dims on iOS
  destroy(): void;
}
```

`onPointClick` returns the **point array index**, never a node id. `GraphView` holds `meta[]` (parallel to positions) and maps `index → { id, type, label }`, resolving `refPath` lazily via `/node/:id`.

### First-run / cold-start state machine (decided — gate the canvas on real layout)

`GraphView` keys off `/api/system/graph/meta` and **never mounts the WebGL canvas on seeded-initial coordinates**:

- **`enabled === false`** → disabled empty state ("Set `HILT_GRAPH_ENABLED=true` to build and view the vault graph."). No canvas, no WebGL context (critical for iOS).
- **`builtAt === null` AND `layoutState ∈ {building, running}`** → a **"Building graph index…" progress panel** (spinner + coarse percent from `nodesPlaced/totalNodes` + `layoutPhase`), subscribed to the `graph` channel; auto-loads when the first `changed` arrives. **Not** a seeded hairball.
- **`layoutDisabled`** → render with hash-placement positions + a "layout disabled" badge (explicit, not silent).
- **Ready (`builtAt != null`)** → fetch the binary, mount the canvas, freeze.

### Loading buffers + freeze (corrected API)

```ts
graph.setPointPositions(positions, /* dontRescale */ true); // server coords are authoritative
graph.setLinks(links);          // Float32Array index pairs
graph.setPointColors(colors);   // derived from colorKeys + theme tokens
graph.setPointSizes(sizes);     // sqrt(degree) curve
graph.render();
graph.pause();                  // freeze at rest; assert graph.isSimulationRunning === false
```

Re-fetch (scope/tag/notify) flows through `setData()` on the existing instance — no remount, no context recreation. `graph.destroy()` on unmount/sub-mode-switch frees the WebGL context (failing to do so is an iOS jetsam accelerant).

### Empty / sparse / isolated states (decided)

- **0 nodes** → "No graph yet — add notes, references, or people to your vault." **Do not upload an empty `Float32Array` to cosmos.** No canvas mount.
- **Isolated focused node** (e.g. an un-promoted candidate, which has no connection edges by design) → render the node centered, label always visible, with a hint ("No connections yet"), not an empty-feeling canvas. This is the candidate "Show in graph" path.

### Stale / disconnected / refresh UX (decided)

- A subtle **"updated <relative time> · N pending" chip** sourced from `/meta` (`builtAt` + `dirty`/`stale`), plus a **manual refresh button** in the toolbar (re-fetch payload + re-poll `/meta`) — for when the WS socket is down.
- On `graph` channel `changed` → refetch. If the socket is disconnected (`useEventSocket` can fail over Tailscale), **fall back to polling `/meta`** on an interval (10s, like `SystemStackView`, verified `SystemView.tsx:114`) and refetch when `layoutVersion` or `builtAt` changes.
- `POST /rebuild` stays operational (monitor-first); the toolbar exposes only the read-only **refresh**, not a full rebuild.

### Stale-focus fallback (deleted/expired/not-yet-indexed nodes)

When `parseGraphScope` yields a `focusId` absent from the loaded payload (or `/node/:id` 404s), `GraphView` **must not throw or center on index 0.** It renders the graph at default scope/zoom and shows a dismissible banner distinguishing three cases: *not-yet-indexed candidate*, *expired candidate*, *deleted file*. Persisted System URL scope carrying a focus id is validated on restore. An e2e case deep-links to a deleted/expired id and asserts graceful fallback + `consoleErrors === []`.

### Interactions

- **Hover-highlight:** `graph.getConnectedPointIndices([index])` → set `highlightedPointIndices` + connected links. **Gotcha:** `[]` greys out *all* points; `highlightNeighbors(null)` must send **`undefined`** (`graph.unselectPoints()`), never `[]`. Neighbor indices come from an adjacency `Map<number, number[]>` built once from the links buffer (O(degree) per hover). Mobile uses tap-to-select (no hover layer).
- **Click-through:** `meta[index].type` → `navigateTo`:
  - `note`/`reference`/`candidate` → resolve `refPath` via `/node/:id`, then Docs (notes) or Library detail (refs/candidates).
  - `person` → People (`"/" + slug`).
  - `project` → Bridge project (or Docs `index.md`).
  - `north_star` → Docs `areas/index.md`.
  - `library_cluster` → expand the cluster in-graph (no nav).
  - `tag` → re-root the local graph on that tag (no nav).
  - Modifier-click re-roots local scope on the clicked node (`navigateTo("system", buildGraphScope({ focus: id, scope: "local" }))`).
- **Zoom/pan, focus:** `graph.zoomToPointByIndex(idx, 700, 12)` powers `focusNode` for deep-links (two-phase: load data, then focus once data arrives — calendar precedent).

### Color, size, label LOD (`graph-style.ts`)

Colors precomputed into the `colorKeys` enum on the server and resolved to hex client-side from CSS custom properties (re-derived on theme change), pushed via `setPointColors` (never per-frame). North Stars get a permanent emphasis ring + size floor regardless of degree. Size: `MIN + (MAX-MIN)*sqrt(degree/maxDegree)`. Label LOD keyed off zoom (`onZoom`, debounced): none when zoomed out (avoids global-graph text soup), hubs/North-Stars mid-zoom, on-screen-culled labels at high zoom; focused/hovered always labeled; higher thresholds on mobile.

### Device-adaptive budgets (`device-budget.ts`)

Detection uses proven signals; **never** `navigator.deviceMemory` (undefined in Safari) or GPU-string probes (identical across iOS models).

- Electron/desktop: `window.electronAPI?.isElectron === true` → desktop class.
- Mobile: `useIsMobile()` (`(pointer: coarse), (max-width: 639px)`) → mobile budget (a narrow desktop window safely falls to mobile).
- iPad/tablet: coarse pointer + large viewport → mid budget.
- DPR: `window.devicePixelRatio`, clamped per class.

| | Desktop/Electron | Tablet | Mobile (iPhone) |
|---|---|---|---|
| Default scope | **GLOBAL** (D2) | Local | Local (anchor neighborhood) |
| Simulation | Frozen (live opt-in) | Render-only | **Render-only — never simulate** |
| Node cap | `desktopMaxNodes` (soft, LOD above) | ~5,000 | `mobileMaxNodes` (~1,500) |
| `pixelRatio` | ≤ `devicePixelRatio` | 1.5 | 1.0 |
| LOD | light cull above ceiling | aggressive | aggressive |
| WebGPU | opt-in if `navigator.gpu` | no | no |

**iOS guardrails:** never resize the WebGL canvas pixel dimensions (`resize()` adjusts viewport/projection only); DPR 1.0; capped local payloads. The headless mobile e2e validates **server-side caps** (scope, count, DPR), **not** memory — real jetsam testing is an on-device gate (Phasing).

### WebGPU (optional, desktop-only)

Feature-detect `navigator.gpu`; enable only on desktop/Electron. A future `WebGPURenderer` implements the same `GraphRenderer` interface over the same binary buffers — no change to `encode.ts` or endpoints. Selection precedence: `WebGPURenderer` (desktop + `navigator.gpu` + flag) → `CosmosRenderer` (WebGL2 baseline) → static fallback. iOS Safari WebGPU is too new to be the baseline.

## UI, Interactions & Show-in-Graph

Toolbar: `SecondaryToolbar` with `left={modeSwitcher}` and `right={<GraphToolbar/>}` (Global/Local segmented control with Lucide `Globe`/`Locate`, depth stepper when local, Show-tags toggle (Lucide `Tag`), legend popover collapsed by default, refresh button, staleness chip). Canvas below in `flex-1 min-h-0 overflow-hidden`.

### "Show in graph" affordance (Decision 3)

`handleShowInGraph(nodeId)` in each surface calls `navigateTo("system", buildGraphScope({ focus: nodeId }))` (scope omitted → device default = GLOBAL on desktop, LOCAL on mobile, centered on the node). All three use Lucide `Network`. Each renders only when graph is enabled (learned from `/meta`). Buttons:

- **Docs** — `DocsContentPane.tsx` `FileActionButtons` (~207-278): desktop inline icon button beside Copy/Reveal (~266); mobile row in the overflow menu (~234). `nodeId` = absolute `filePath`. `handleShowInGraph` is a `useCallback` with `[navigateTo, filePath]`.
- **Library** — `LibraryArtifactDetailPane.tsx` actions menu (~357-372), after "Archive reference"; `nodeId = artifact.id`. Available for saved refs **and** candidates (un-promoted candidate lands focused with the isolated-node hint).
- **People** — `PersonMeetingList.tsx` person-header toolbar (~175+), `person` branch only; `nodeId = slug`.

### Tag layer on-demand (Decision 4)

Toggling "Show tags" issues a separate `?includeTags=1` fetch and shows an **inline loading state** (reuse the building-panel pattern) until the augmented payload returns — the first `buildTagLayer()` may be slow. Default queries filter tags by `type` regardless of `tags_built`, so a stale `tags_built=1` never leaks tags into a `?includeTags=0` response. `tags_built` is cleared on `/rebuild`. Tag visibility is **not** URL-encoded (clean deep-links; optional `localStorage` persistence). Bounded inclusion (members in `[2,K]`; mega-tags as a labeled cluster); on mobile, only tag edges among already-visible local nodes (no new nodes pulled in); placement by jittered weighted centroid or pinned outside the member cloud, never the dead center of the hairball.

## Test Plan & Perf Budgets

All graph test entry points require `HILT_GRAPH_ENABLED=true` and run only against fixture vaults / temp SQLite.

### npm scripts

```json
"test:graph": "tsx --test src/lib/graph/**/*.test.ts",
"test:graph:perf": "tsx --test src/lib/graph/**/*.perf.ts",
"test:graph:e2e": "tsx scripts/graph-e2e.ts"
```

### Fixture vault (`src/lib/graph/__fixtures__/`)

Exercises all edge sources and the on-demand tag boundary, exporting expected counts as constants:
- `notes/alpha.md` with `[[beta]]` and `[[gamma|Gamma display]]` → two wikilink edges (display + anchor-strip).
- `library/ref-001.md` (saved) with `connection_suggestions` + `connected_projects: [atlas]` → connection + connected_project edges.
- A candidate fixture (via the cache API) with **no** connection edges → isolated leaf.
- `people/art-vandelay.md` + a meeting file with `hilt_calendar_event_id` → meeting edge (filename match then frontmatter read).
- `projects/atlas/index.md` `tags: research, infra`; `areas/index.md` → north_star.
- Two notes sharing a tag → tag node appears **only** under `buildTagLayer()`.
- An **isolated node** and an **empty-vault** fixture for empty/sparse states.

### `withTempGraph()` harness

```ts
async function withTempGraph(run: () => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "hilt-graph-test-"));
  process.env.HILT_GRAPH_ENABLED = "true";
  process.env.DATA_DIR = dir;
  process.env.HILT_GRAPH_DB_PATH = join(dir, "graph.sqlite");
  closeGraphDbForTests();        // reset cachedDb AND cachedPath
  try { await run(); }
  finally { closeGraphDbForTests(); rmSync(dir, { recursive: true, force: true }); }
}
```

### Unit (`test:graph`)

1. **Builder** — exact node counts by type; **`tag` absent by default** (present only with `buildTagLayer()`); dotdirs and (default) `libraries/` excluded; degree-0 filtered from the default global selection. Edge kinds with correct endpoints/weights, incl. `[[a|display]]` and anchor-stripped wikilinks. `connection`/`connected_project` present for the saved ref, **absent for the candidate**. `ref_path` absolute for docs/refs, slug for people. `meeting` extractor calls `matchMeetingsToSlug` then `parseMeetingFrontmatter`.
2. **Wikilink resolver perf** — the builder resolves against a **prebuilt map**, not per-call `resolveWikilink`; assert the file map is built once per full build (spy/count) and the build time is within budget on the ~2k-connected fixture.
3. **Binary round-trip** — `encode → decode` structurally equal; **EDGES decoded as `Float32Array`**; header carries magic + `TRANSPORT_FORMAT_VERSION`; bad version throws `GraphFormatError`; sidecar index-aligned to positions; no `NaN`/`Infinity` in floats; `types` is `Uint8Array`; `refPaths` **not** in the bulk sidecar.
4. **Layout** — same-process repeat within tight epsilon; cross-run topological stability (bounded displacement), **not byte-identical**; `LAYOUT_VERSION` bump forces full re-solve; warm-start converges in far fewer steps and stays within epsilon; orphan position rows deleted.
5. **Incremental** — editing one fixture file touches only that file's `source_file` rows; unaffected `node_positions` rows are **not rewritten** (assert via `updated_at`); deleting a file removes its node + dangling edges and decrements neighbor degree; saving a reference (changes `connection_suggestions`) updates connection/connected_project edges without a full rebuild; the dir-rescan path correctly handles a multi-file burst that BridgeWatcher collapsed to one event.
6. **Meta contract** — `dirty=true` after an incremental edit, `dirty=false` after relayout; first-run `builtAt=null` + progress fields.
7. **Concurrency** — `/rebuild` during incremental converges; a simulated mid-layout crash leaves a recoverable `stale` state with `last_error`.
8. **Deep-link round-trip** — `buildGraphScope({ focus }) → buildViewUrl → parseViewUrl → systemModeFromUrl → isSystemMode` yields `mode === "graph"` and recovers the focus id.

### Perf (`test:graph:perf`)

Re-baselined to the **real shape**: ~2,000 connected nodes + ~3,000 isolated leaves (not 30k uniform). Assert:
- Warm full **global** build/query < 500ms (after the resolver fix); encoded `ArrayBuffer` byte size **and JSON sidecar byte size + parse time** under budget (`Buffer.byteLength`).
- 100-node incremental relayout < 2,000ms.
- **Mobile local cap:** `scope=local&node=<id>&hops=2` ≤ `HILT_GRAPH_MAX_NODES_MOBILE`, payload under a **derived** budget (positions + edges + Uint8 colors + measured sidecar bytes for the cap), and the local set stays **connected to the anchor** even with a person super-hub (1000+ meeting edges).
- A **mega-tag** augmented payload stays under cap (bounded inclusion + cluster).
- Desktop idle-frame-time is a **soft gate** (warn/log) at desktop scale.

### E2E (`scripts/graph-e2e.ts`, calendar-e2e skeleton)

Boot env: `HILT_GRAPH_ENABLED=true`, temp `DATA_DIR`/`HILT_GRAPH_DB_PATH`, `BRIDGE_VAULT_PATH=<fixture>`, `HILT_GRAPH_MAX_NODES_MOBILE=200`. Before the browser run, `POST /api/system/graph/rebuild`, then poll `/meta` until `builtAt` is set. `data-testid`s: `graph-view`, `graph-canvas`, `graph-mode-graph`, `graph-scope-toggle`, `graph-node-inspector`, `graph-tag-toggle`, `graph-building-panel`, `graph-empty-state`.

- **Desktop (1440×1000, 1280×800):** canvas + WebGL2 context acquired; scope toggle reports **global** on first paint (D2); hover highlights the neighborhood (asserts the neighbor set, never `[]`); clicking `alpha` → Docs, person → `/people/art-vandelay`, saved ref → Library; **tags off initially**, toggle on → tag nodes appear → toggle off → gone (D4); freeze (`isSimulationRunning === false`) after settle.
- **Show in graph (D3):** from Docs file actions, click "Show in graph" → asserts navigation to **`/system/graph/focus/<encoded ref_path>`** (path form, **not** `?focused=`) and Graph mounts focused. Repeat for People header and Library actions. Also assert `POST /navigate {view:"system", path:"/graph/focus/<id>"}` returns 200.
- **Stale focus:** deep-link to a deleted/expired id → graceful banner, no console error.
- **First-run:** with `built_at=null`, the building panel renders (no canvas); after rebuild notify, the canvas mounts.
- **Mobile (390×844, 430×932):** scope toggle reports **local**; `waitForResponse` confirms `scope=local` was requested (never global); **cold-open no-anchor** test (fresh storage) asserts a non-empty capped payload via the highest-degree anchor; node count ≤ cap; DPR ≤ 1.5; canvas chrome clears mobile nav; node tap navigates.
- End-of-run: `assert.deepEqual(consoleErrors, [])`.

### Observability

`GraphView` exposes `window.__hiltGraphStats` (dev/test only) — `{ scope, focusedNodeId, nodeCount, edgeCount, devicePixelRatio, isSimulationRunning, idleFrameMs, deviceClass, webgpu }` — the single source for e2e assertions and logged metrics. Idle frame time and per-class node ceilings are logged (non-blocking in e2e); the mobile node-cap is a hard correctness assertion. `/meta` doubles as the operational health surface.

## Phasing

Backend substrate first (durable); renderer second (replaceable). Everything ships behind `HILT_GRAPH_ENABLED` (off in production until Phase 2 passes on-device).

**Dependencies:** `better-sqlite3@^12`, `chokidar@^5` already present. Add `ngraph.forcelayout` + `ngraph.graph` (Phase 0, pure-JS, pin versions, seed RNG). Add `@cosmos.gl/graph` (Phase 1; confirm exact name/version at install, pin it, record in CHANGELOG). `graphology` + `graphology-metrics` are Phase 3, optional, backend-only. Do **not** add `@cosmograph/react` or `d3-force`.

- **Phase 0 — Backend substrate.** `src/lib/graph/` module + schema; builder reusing parsers read-only with the **prebuilt-map wikilink resolver** and **dotdir/library/degree-0 inclusion policy**; candidate nodes via the cache API; chunked main-loop layout with persisted positions + warm-start; binary `GET /api/system/graph` + `/meta` + `/node/:id` + `/rebuild`; runner wired with the **dir-rescan + persistent ScopeWatcher client + periodic reconcile** model; marker notify. Exit: real primary-vault graph builds; `fmt=json` shows expected counts; binary round-trips (Float32 edges); layout deterministic same-process; incremental touches only changed files; tags absent unless requested; reference edits update incrementally.
- **Phase 1 — cosmos.gl desktop.** Navigation edits (File 1–3); `/navigate` `system` allowlist; `GraphView` with the first-run state machine, freeze via `pause()`, hover/click-through, **default scope = GLOBAL**; "Show in graph" in Docs/People/Library using the path-form grammar; staleness chip + refresh. Exit: System → Graph renders the global vault graph on Electron; hover/click/deep-link work; idle ~60fps; layout frozen.
- **Phase 2 — Mobile budgets (iOS Safari over the tailnet).** Device-class detection; mobile **local default with anchor fallback**; server-enforced cap; DPR 1.0; aggressive LOD; ring-based local capping. Exit: renders on the physical iPhone at `xochipilli.tailc0acaa.ts.net:3000` without tab reload, defaults local, respects the cap, stable across minutes of pan/zoom. **On-device jetsam verification is a required gate** before flipping the flag on for mobile (the headless e2e validates only server-side caps; measure and record the WebGL2/luma.gl baseline + sidecar-parse spike on the target iPhone).
- **Phase 3 — Optional.** WebGPU desktop fast path (same interface, same buffers); a real `worker_thread` layout (only after the bootstrap spike passes for both tsx-dev and compiled-Electron); clustering/centrality via graphology (offline into `attrs_json`); materialized on-demand tag layer refinements; `library_cluster` expansion.

## Risks & Constraints

| Risk | Mitigation |
|---|---|
| **iOS memory ceiling** (jetsam ~200–450MB; profiler unreliable) | Server-precomputed positions; binary + paging; mobile local default with anchor; capped buffers; DPR 1.0; never resize the canvas; gate the canvas on real layout (no seeded hairball); on-device verification required before mobile flag-on. |
| **Wrong node-count assumption / hairball** | Exclude dotdirs (hard); exclude `libraries/` sub-vaults by default (opt-in cluster nodes); filter degree-0 from default global; re-baseline perf fixture to ~2k connected + ~3k leaves. |
| **Wikilink resolver O(links×nodes)** | Build the file map once per full build; graph-local resolver over the prebuilt `Map`; never per-call `resolveWikilink`; re-derive perf budget after the fix. |
| **Watcher fidelity** | BridgeWatcher collapses bursts to one event → dir-rescan-by-mtime, not single-path surgery; ScopeWatcher persistent client at vault root for docs/references; candidates via cache API; periodic full reconcile backstop. |
| **cosmos.gl API/package flux** | Pin exact `@cosmos.gl/graph` version; use the real freeze API (`render()`+`pause()`, `isSimulationRunning`) and `Float32Array` `setLinks`; versioned wire header isolates the data layer; renderer-agnostic interface. |
| **Worker bootstrap unproven** | v1 uses a chunked main-loop solve (no `worker_threads`); a real worker is Phase 3 behind a tsx-dev + compiled-prod spike. |
| **Stay clear of connections work** | Reads `connection_suggestions`/`connected_projects` only; zero edits to `connections.ts`/`digestion.ts`; dark behind the flag. |
| **Markdown source of truth** | `graph.sqlite` is a derived cache under `DATA_DIR`, outside watched roots; rebuildable via `/rebuild`; never authoritative; no feedback loop. |
| **Tag-node explosion** | Off by default; default `SELECT` filters by `type`; on-demand layer with bounded inclusion + cluster for mega-tags; never auto-included on mobile. |
| **Deep-link breakage** | Single path-segment grammar in `graph-deeplink.ts`; no query strings (incompatible with `navigateTo`); `system` added to `/navigate` allowlist; round-trip regression test. |
| **Flag inconsistency** | One `isGraphEnabled()` (`=== "true"`) imported everywhere; `.env.example` consistently `# HILT_GRAPH_ENABLED=true`. |
| **Stuck layout state** | Watchdog resets `running`/`building` → `stale` with `last_error`; full rebuild supersedes the incremental queue. |

## Docs To Update (on build)

`docs/ARCHITECTURE.md` (System + graph subsystem, pipeline, watcher wiring, chunked-vs-worker layout decision, node-inclusion policy), `docs/DATA-MODELS.md` (node/edge/payload/meta types + schema), `docs/API.md` (`/api/system/graph*`), `docs/COMPONENTS.md` (`GraphView`), `docs/DESIGN-PHILOSOPHY.md` (graph-view + "Show in graph" patterns, contextual color), `docs/CHANGELOG.md` (pin the cosmos.gl + ngraph versions resolved at install).

## Open Questions (genuinely unresolved)

1. **`libraries/` modeling depth.** Default-exclude is decided; whether opt-in renders one `library_cluster` per sub-vault vs a deeper two-level cluster (sub-vault → its projects/people) is deferred to after Phase 1, pending whether the cluster view proves useful.
2. **Incremental dirty radius (1-hop vs 2-hop).** The `dirty` flag supports either; pick empirically during layout tuning against the real vault for mental-map stability vs cost.
3. **`WARM_ITERATIONS` / `INCREMENTAL_ITERATIONS` tuning.** Defaults (40/60) are starting points; tune against fixture + real-vault layout quality.
4. **Mega-tag rendering.** Labeled-cluster vs filter-highlight-only for tags exceeding K members — decide after seeing real tag-degree distribution when the on-demand layer first runs.
5. **Whether to ever promote `worker_thread` layout.** Only if the chunked main-loop measurably janks at real scale; gated by the dev/prod bootstrap spike.
