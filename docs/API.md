# API Reference

All API routes are Next.js App Router API routes under `src/app/api/`.

## Inbox (Draft Prompts)

**File**: `src/app/api/inbox/route.ts`

Manages draft prompts stored in `Todo.md` files.

### GET /api/inbox

List all draft prompts for a scope.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Project path (uses `{scope}/docs/Todo.md`) |
| `lastModTime` | number | For polling - skip if unchanged |

**Response**

```typescript
{
  items: Array<{
    id: string;
    prompt: string;
    completed: boolean;
    section: string | null;  // Markdown heading group
    projectPath: string | null;
    createdAt: string;
    sortOrder: number;
  }>;
  sections: Array<{
    heading: string;
    level: number;
  }>;
  lastModTime: number | null;
}
```

### POST /api/inbox

Create a new draft prompt.

**Request Body**

```typescript
{
  prompt: string;          // Required
  section?: string | null; // Target section heading
  scope?: string;          // Project path
}
```

**Response**

```typescript
{ id: string; success: true }
```

### PATCH /api/inbox

Update an existing draft.

**Request Body**

```typescript
{
  id: string;              // Required
  prompt?: string;
  completed?: boolean;
  section?: string | null;
  scope?: string;
}
```

### DELETE /api/inbox

Delete a draft prompt.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Required - Item ID |
| `scope` | string | Project path |

### PUT /api/inbox

Reorder sections or items within the Todo.md file.

**Request Body (Section Reorder)**

```typescript
{
  sectionOrder: string[];  // Headings in new order
  scope?: string;
}
```

**Request Body (Item Reorder)**

```typescript
{
  itemReorder: {
    itemId: string;
    targetSection: string | null;
    targetIndex: number;
  };
  scope?: string;
}
```

---

## Folders

**File**: `src/app/api/folders/route.ts`

Browse project folders and validate paths.

### GET /api/folders

List project folders.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Filter to children of this path |
| `validate` | string | Check if specific path exists |

**Response (List)**

```typescript
{
  folders: string[];  // Decoded paths sorted by depth
  homeDir: string;    // User's home directory
}
```

**Response (Validate)**

```typescript
{
  path: string;
  exists: boolean;
  isDirectory: boolean;
  valid: boolean;  // exists && isDirectory
}
```

### POST /api/folders

Open native macOS folder picker dialog.

**Response**

```typescript
{ path: string }
// or
{ cancelled: true }
```

---

## Plans

**File**: `src/app/api/plans/[slug]/route.ts`

Read and write plan markdown files stored in `~/.claude/plans/`.

### GET /api/plans/[slug]

Read a plan file by slug.

**Response (Exists)**

```typescript
{
  exists: true;
  slug: string;
  content: string;
  path: string;
}
```

**Response (Not Found)**

```typescript
{
  exists: false;
  slug: string;
}
```

### PUT /api/plans/[slug]

Write or update a plan file.

**Request Body**

```typescript
{
  content: string;
}
```

**Response**

```typescript
{
  success: true;
  slug: string;
  path: string;
}
```

---

## Map Routes

Local-first session/work graph APIs backed by `${DATA_DIR}/map.sqlite`. Set `HILT_MAP_LOCAL_ENABLED=false` to disable them. History preview is controlled by `HILT_MAP_HISTORY_PREVIEW`; it defaults on in local dev and should be explicitly enabled for shared/packaged deployments.

### GET /api/map/local/work-graph

Returns the filtered tree, counts, and scan diagnostics. It does **not** include full session arrays or raw history. `foreground` is the default human-legible work view; `background` keeps worker, sidechain, unmapped, and automation-like sessions available without letting them dominate the map. Tree node kinds are `root`, `space`, `workspace`, `folder`, and `workItem`; `folder` nodes come from summarized work-footprint path signals.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `window` | `24h \| 7d \| 30d \| all` | Activity window, default `7d` |
| `status` | `all \| foreground \| background` | Visibility filter, default `foreground` |
| `source` | `all \| codex \| claude` | Provider filter, default `all` |
| `q` | string | Optional text search across titles, workspaces, providers, branches, Map session ids, and provider session ids |

### GET /api/map/local/sessions

Returns paginated session summaries for the same filters, optionally narrowed to a tree node. Summaries may include capped `workFootprint` metadata entries with relative labels and aggregate kind/weight counts; they never include raw transcript text or `sourcePath`.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `nodeId` | string | Tree node id, default `root` |
| `cursor` | string | Offset cursor returned by the previous page |
| `limit` | number | Page size, max 200 |
| `window`, `status`, `source`, `q` | same as graph | Same filters as work graph |

### GET /api/map/local/session-detail

Read-only history preview for one indexed session. The browser supplies only `id` and `limit`; arbitrary source paths are rejected. Provider files are read on demand, capped, and redacted.

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Indexed session id |
| `limit` | number | Preview cap, 20-240 |

### POST /api/map/local/refresh

Forces an index scan and returns diagnostics.

### GET /api/map/local/source-status

Returns the latest scan diagnostics and source status list.

---

## System Routes

System is the top-level inspection surface for Sessions, Apps, Stack, and Sync. Peer aggregation is Hilt-to-Hilt only: the serving machine discovers online Tailscale peers, probes `/api/system/machine?scope=local`, and accepts only Hilt responses. Set `HILT_SYSTEM_NETWORK_ENABLED=false` to keep System local-only.

For demo and screenshot runs, `HILT_SYSTEM_MACHINE_HOSTNAME`, `HILT_SYSTEM_MACHINE_DNS`, and `HILT_SYSTEM_MACHINE_IP4` can override the displayed local machine identity without changing the API response shape.

### GET /api/system/machine

Returns the serving machine's System identity and feature availability. Peer discovery calls this with `?scope=local`.

```typescript
{
  app: "hilt-system";
  enabled: true;
  machine: MachineIdentity;
  features: {
    map: boolean;
    apps: boolean;
    stack: boolean;
    sync: boolean;
  };
  app_server?: AppServerInfo | null;  // how this server runs: dev or prod + build age
}
```

### GET /api/system/app-server

Returns how this Next.js server instance is running — the source of the mode badge and switch in the SourceToggle dropdown. Always same-origin (each server reports only itself).

```typescript
{
  mode: "dev" | "prod";        // NODE_ENV-derived
  dist_dir: string;            // ".next" (dev) or ".next-prod" (prod daily driver)
  build_id: string | null;     // prod only
  built_at: string | null;     // ISO; rebuild stamp preferred over BUILD_ID mtime
  supervised: boolean;         // fresh supervisor heartbeat (≤90s, live pid) on THIS machine
  supervisor: {                // null when unsupervised
    kind: "electron" | "daemon";
    state: "idle" | "rebuilding" | "switching" | "reverting";
    detail?: string;           // human progress line during a switch
  } | null;
}
```

### POST /api/system/app-mode

Requests a dev/prod switch for THIS server (supervisor protocol, `docs/plans/supervisor-v1.md`). The route never touches processes — it validates the supervisor heartbeat and writes `${DATA_DIR}/app-mode-intent.json`; the machine's supervisor (Electron or the headless daemon) performs the swap. Callers poll `GET /api/system/app-server` until `mode` flips, then reload themselves.

| Body | Response |
|---|---|
| `{ "mode": "dev" \| "prod" }` | `202 { ok, accepted }` — intent written |
| invalid mode / body | `400 { error }` |
| no fresh supervisor heartbeat | `409 { error }` |

Deliberately tailnet-reachable (unlike loopback-only `/navigate`): single-user tailnet, non-destructive, auto-reverting.

### GET /api/system/machines

Returns the local Hilt machine plus reachable Hilt peers. Use `?scope=local` to suppress peer discovery.

```typescript
{
  app: "hilt-system";
  enabled: true;
  machines: SystemMachine[];
}
```

### GET /api/system/sessions/graph

Aggregates each machine's local Map graph into the same response shape as `/api/map/local/work-graph`. Top-level root children are machine nodes; nested tree node ids and session ids are namespaced with the owning machine id. Query parameters match `/api/map/local/work-graph`.

### GET /api/system/sessions

Aggregates paginated session summaries. Query parameters match `/api/map/local/sessions`. When `nodeId` is a machine or namespaced node id, the request is routed to that machine's local Map index.

### GET /api/system/sessions/detail

Reads one namespaced session history preview from the machine that owns it. Query parameters match `/api/map/local/session-detail`.

### POST /api/system/sessions/refresh

Forces Map index refreshes on reachable Hilt machines and returns per-machine results.

### GET /api/system/stack

Returns Claude/Codex Stack snapshots for local and peer Hilt machines. Use `?scope=local` for a single-machine response. Optional `project` sets the local project scope; remote peers default to their own active Hilt folder.

### GET /api/system/stack/file

Read-only Stack file preview. Parameters:

| Param | Type | Description |
|-------|------|-------------|
| `machine` | string | Machine id from `/api/system/machines`, required for aggregate reads |
| `path` | string | Required. Must match a file discovered in that machine's stack |
| `project` | string | Optional project scope |
| `scope=local` | string | Used by peer-to-peer reads to force local validation |

Remote Stack writes/toggles are intentionally not exposed in v1.

### GET /api/system/sync

Returns read-only Syncthing sync snapshots for local and peer Hilt machines. Use `?scope=local` for a single-machine response. `?scope=network` is accepted as the default aggregate behavior. `?force=true` bypasses Hilt's short server-side cache for a manual refresh.

Local sync is gated by:

```bash
HILT_SYNC_ENABLED=true
HILT_SYNC_PROVIDER=syncthing
HILT_SYNC_FOLDER_ID=work-meta
HILT_SYNC_SYNCTHING_URL=http://127.0.0.1:8384
HILT_SYNC_SYNCTHING_API_KEY_FILE=/Users/jruck/.hilt/sync/syncthing-api-key
```

Hilt only calls the local loopback Syncthing REST API and never returns the API key or exposes arbitrary Syncthing API paths.

Each enabled machine snapshot includes daemon reachability, peer connection state, folder status, last scan/file timestamps, versioning, ignore parity, conflict counts, and a local disk summary that separates Syncthing's synced bytes from ignored/generated local weight. Aggregate reads treat `/api/system/machine` feature flags as hints: if a peer is reachable, Hilt probes `/api/system/sync?scope=local` before declaring Sync unavailable.

Live smoke test:

```bash
npm run test:system:sync-live
```

### GET /api/system/sync/conflicts

Returns conflict-copy files for the configured Syncthing folder. Parameters:

| Param | Type | Description |
|-------|------|-------------|
| `folder` | string | Folder id, defaults to `work-meta` |
| `scope=local` | string | Return only the serving machine's conflicts |
| `force=true` | string | Bypass cached sync snapshot |

### Mercury (System → Performance)

Server-side proxies to the standalone Mercury observability dashboard (collector + server on Mercury's tailnet IP, port 8787). Proxying avoids CORS and keeps the host off the client. Base URL via `MERCURY_API_URL` (default `http://mercury-v.tailc0acaa.ts.net:8787`); 8s `AbortController` timeout; both return `502 { error: "Mercury dashboard unreachable" }` on outage. `runtime = "nodejs"`, `dynamic = "force-dynamic"`. **File**: `src/lib/system/mercury.ts`.

#### GET /api/system/mercury/series

Proxies Mercury `/api/series`. Returns `{ columns: string[], rows: MercurySample[], generatedAt }`.

| Param | Type | Description |
|-------|------|-------------|
| `range` | `6h \| 24h \| 7d \| all` | Defaults to `24h`; invalid value → `400` |

#### GET /api/system/mercury/latest

Proxies Mercury `/api/latest`. Returns `{ sample: MercurySample \| null, ageSeconds }`. A `MercurySample` carries `ts` plus nullable closet temp/humidity/motion, room/outdoor temp, cpu/gpu die temp + power, mem, load, cpu/gpu %, fan, thermal pressure (`src/hooks/useMercury.ts`).

### Knowledge Graph (System → Graph)

Opt-in: every route below returns `404 { error: "Graph disabled" }` unless `HILT_GRAPH_ENABLED=true` (the `isGraphEnabled()` predicate). The graph index is a derived SQLite cache (`graph.sqlite` under `DATA_DIR`); markdown remains source of truth. `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

#### GET /api/system/graph

Binary graph payload (`application/octet-stream`). The canonical wire format is a 32-byte header (magic `0x48474C31`, `TRANSPORT_FORMAT_VERSION`, node/edge counts, flag bits) followed by interleaved `Float32` positions, a `Uint8` color-key enum, `Float32` edge index-pairs (for cosmos.gl `setLinks`), and a JSON sidecar (`ids`, `labels`, interned `types` ordinals, `colorKeyTable`). `refPaths` is intentionally dropped from the sidecar and resolved lazily via `/node/:id` at click time. Response headers: `X-Graph-Format-Version`, `X-Graph-Layout-Version`, `X-Graph-Node-Count`, `X-Graph-Edge-Count`, `X-Graph-Truncated`.

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `scope` | `global \| local` | `global` (desktop) | `local` BFS around an anchor (mobile default). |
| `node` | encoded node id | — | Anchor for `scope=local`. Unresolvable → degrades to the highest-degree node, never 400. |
| `hops` | int `1..3` | `2` | BFS depth, clamped. |
| `limit` | int | device ceiling | Server enforces `HILT_GRAPH_MAX_NODES_MOBILE`/`_DESKTOP` regardless of request. |
| `includeTags` | `0 \| 1` | `0` | Requires `HILT_GRAPH_TAGS=true`; default payload always filters tags by `type`. |
| `includeIsolated` | `0 \| 1` | `0` | Degree-0 leaves are hidden by default (global only). |
| `semanticEdges` | `0 \| 1` | `0` | Requires `HILT_GRAPH_SEMANTIC=true`. In **global** scope, includes the dense fuzzy semantic web (`similar`/`co_occurrence`) which is off by default (sparse `topic`/`entity` hubs + `item_topic`/`topic_parent` are always included when the overlay flag is on). **Local** scope always includes them (ring/fan-out caps bound them). With the overlay flag off, all overlay rows are excluded everywhere. |
| `fmt` | `bin \| json` | `bin` | `json` returns the decoded selection (nodes/edges/byteLength) for debugging. |

Local selection always keeps all 1-hop neighbors, fills 2-hop by ascending target degree until the cap, and caps per-node hub fan-out (`HILT_GRAPH_HUB_FANOUT_CAP`) so a person super-hub cannot swamp the set; `truncatedRings` reports which ring was clipped.

#### GET /api/system/graph/meta

JSON `GraphMeta`: counts, `builtAt`, `layoutVersion`/`layoutState`, first-run progress (`layoutPhase`/`nodesPlaced`/`totalNodes`), `dirty`/`stale`/`lastError`, reported `tagNodeCount` (never shipped in the default payload), the semantic-overlay counts `topicNodeCount`/`entityNodeCount` and `semanticBuilt` (gate the legend/filters on these), and device `budgets`. The client polls this first to drive its first-run state machine and scope/limit choice.

#### GET /api/system/graph/node/[id]

JSON single node + its immediate edges (inspector/hover). Includes `refPath` (the lazy-resolved navigation target dropped from the bulk sidecar). `404` for an unknown id → the client treats it as a stale-focus case (graceful fallback).

#### POST /api/system/graph/rebuild

Operational, monitor-first: full rebuild + relayout. Body `{ fullLayout?, bumpLayoutVersion? }`; response `{ ok, blocked, nodeCount, edgeCount, layoutVersion, durationMs }`. `409 { blocked: true }` if a layout/rebuild pass is already running (single-flight). Never deletes vault content. When `HILT_GRAPH_SEMANTIC=true`, the build tail also repaints the semantic overlay (topic/entity nodes + semantic edges) from `semantic.sqlite`.

---

## Semantic Layer Routes

Thin read wrappers over `src/lib/semantic/query.ts` (the same surface the `semantic` CLI binds to). All four `404` when `HILT_SEMANTIC_ENABLED` is unset — the whole subsystem is inert without the flag. JSON matches the CLI `--json` shape.

#### GET /api/system/semantic/topics

Topic exploration (the locked "first query"). Returns `TopicSummary[]`. `?recent=1` orders by recency/trend; `?parent=<id>` returns a parent topic's children (broad→specific drill-down).

#### GET /api/system/semantic/topic/[id]

A `TopicDetail` — the topic plus its child topics, top member items, and lineage history. `404` for an unknown topic id (mirrors the CLI's "no topic" exit).

#### GET /api/system/semantic/related

`?item=<itemId>&k=N` → items semantically related to an item via embedding KNN (chunk-grain, rolled up to items by max cosine). Returns `RelatedHit[]`. `400` when `item` is missing.

#### GET /api/system/semantic/entity/[name]

Resolve an entity by canonical name or alias → an `EntityResult` (entity + its top items). `404` when no entity matches.

### Semantic CLI + scheduler (P2.4)

The layer's heavy/periodic work runs as CLI entrypoints (the launchd jobs and the runner share the same code path), never on the request path. All gate on `HILT_SEMANTIC_ENABLED` (`--force` overrides for a manual dev run), so a stray installed plist is a no-op when the feature is off.

- `npm run semantic:backfill` — cold-start backfill (default mode): scan → chunk → embed → extract → cluster. Idempotent/resumable. Blesses `active_version` on a true cold-start. `-- --limit N` for a cheap slice.
- `npm run semantic:backfill:cold` — alias for the `cold-start` mode (the launchd cold-start job).
- `npm run semantic:backfill -- sample --review-batch <label>` — a coexistence/decimal pass: writes new-version rows **without** blessing the live baseline and registers the sample items + the `docs/semantic-review-notes/<version>.md` note into the **sibling** semantic review queue.
- `npm run semantic:gc` — drop rows whose `semantic_version != active_version` (run after a bless flip; analog of `library:candidates:cleanup`).
- `npm run semantic:refit` — the signal-gated BALANCED weekly global re-fit (`--force` to override the drift gate).
- `npm run semantic:scheduler:plan` — print the `com.hilt.semantic.*` launchd jobs (cold-start / refit / gc) without installing.
- `npm run semantic:scheduler:install` / `npm run semantic:scheduler:uninstall` — write/load or unload/remove the launchd plists (dry-run by default; reuses the shared `scripts/launchd-scheduler.ts` helper that the Library scheduler also uses).

The incremental path is the **SemanticRunner** (`src/lib/semantic/runner.ts`), not a CLI — it is instantiated by `ws-server.ts` only when `HILT_SEMANTIC_ENABLED=true` and embeds/extracts a changed item (one embed call) then slots it into the nearest existing topic with no re-cluster.

---

## Local Apps Routes

Monitor-only local/tailnet service inspection for the machine serving the active Hilt instance. Set `HILT_LOCAL_APPS_ENABLED=true` to enable. Optional screenshot previews require `HILT_LOCAL_APPS_PREVIEWS=true`; `HILT_LOCAL_APPS_PREVIEW_CACHE_MS` controls the screenshot recapture cadence and defaults to 120000 ms. Hilt keeps returning the last successful screenshot path after a failed recapture and records the latest failure in `service.preview.error`. By default, Hilt also discovers other online tailnet machines that are running Hilt and includes their local snapshots in `machines`; set `HILT_LOCAL_APPS_PEERS=false` to disable that aggregation.

### GET /api/local-apps

Returns the cached Local Apps snapshot. The scanner uses a single-flight cache, so requests return the latest snapshot while background refreshes run.

Use `?scope=local` when one Hilt instance is calling another Hilt instance. This returns only the serving machine's snapshot and avoids recursive peer aggregation.

**Enabled response**

```typescript
{
  app: "hilt-local-apps";
  enabled: true;
  machine: {
    hostname: string;
    tailscale_dns?: string | null;
    tailscale_ip4?: string | null;
    origin: "local";
  };
  groups: ServiceGroup[];       // visible groups only; groups may include hidden child services
  diagnostics: {
    scanned_at: string | null;
    is_scanning: boolean;
    duration_ms: number | null;
    listener_count: number;
    group_count: number;
    visible_group_count: number;
    errors: string[];
  };
  machines?: Array<{
    id: string;                  // tailscale DNS, IP, or hostname
    self: boolean;
    reachable: boolean;
    source_url?: string | null;  // base URL used for this Hilt instance, remote only
    machine: MachineIdentity;
    groups: ServiceGroup[];
    diagnostics: ScanDiagnostics;
    error?: string | null;
  }>;
  summary?: {
    machine_count: number;
    group_count: number;
    service_count: number;
    visible_group_count: number;
  };
}
```

**Disabled response**

```typescript
{
  app: "hilt-local-apps";
  enabled: false;
  reason: string;
}
```

### POST /api/local-apps/refresh

Forces a fresh Local Apps scan. By default this also waits for fresh screenshot capture before returning, so the response can immediately include updated `service.preview` metadata for healthy HTTP services. If screenshot capture fails but an older PNG exists, `service.preview.path` and `captured_at` continue pointing to the last good image while `error` and `error_at` describe the failed refresh. When peer aggregation is enabled, Hilt asks discovered peer Hilt instances to refresh their local previews through `scope=local` calls; ordinary `GET /api/local-apps` requests never capture screenshots by themselves.

Query params:

| Param | Values | Description |
| --- | --- | --- |
| `scope` | `local` | Return only the serving machine's snapshot, matching `GET /api/local-apps?scope=local`. |
| `previews` | `false` | Skip forced screenshot refresh and run a metadata-only scan. |

Response shape matches `GET /api/local-apps`.

### GET /api/local-apps/settings

Returns Hilt-owned Local Apps settings metadata. `api_url` is always `null` because Hilt does not expose a separate Port Authority-style daemon.

```typescript
{
  settings: Settings;
  api_url: null;
  settings_path: string;
  preview_dir: string;
}
```

### GET /api/local-apps/previews/[filename]

Serves cached PNG screenshots from the Local Apps preview directory. The route accepts only simple `.png` filenames and rejects `/` or `\` path separators.

### GET /api/local-apps/remote-preview

Proxies a cached PNG screenshot from a known remote Hilt machine so HTTPS-served Apps views do not load insecure HTTP image URLs directly in the browser. The browser supplies only a `machine` id already present in the current Hilt-discovered `machines` list and a safe `.png` `filename`; arbitrary remote URLs are not accepted.

Query params:

| Param | Description |
| --- | --- |
| `machine` | Machine id from the Local Apps `machines` array. |
| `filename` | Safe `.png` filename from `service.preview.path`. |

---

## Bridge Routes

Routes for the Bridge view, which manages weekly task lists and projects from an Obsidian vault.

### GET /api/bridge/weekly

**File**: `src/app/api/bridge/weekly/route.ts`

Get the current (or specified) weekly list with tasks, notes, and metadata.
The response includes the weekly file's section order so the Bridge view can render current/future notes-first files without rewriting older weeks.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `week` | string | Optional. ISO date string (e.g., `2025-01-06`) to preview a specific week |

**Response**

```typescript
{
  filename: string;
  week: string;
  needsRecycle: boolean;
  sectionOrder: ("accomplishments" | "notes" | "tasks")[];
  tasks: BridgeTask[];
  accomplishments: string;
  notes: string;
  vaultPath: string;
  filePath: string;
  availableWeeks: string[];
  latestWeek: string;
}
```

### GET /api/bridge/briefings

**File**: `src/app/api/bridge/briefings/route.ts`

List briefing summaries, newest first. Reads weekday daily files from `briefings/YYYY-MM-DD.md` and weekend editions from `briefings/weekend/YYYY-MM-DD.md`. Daily ids are `YYYY-MM-DD`; weekend ids are `weekend:YYYY-MM-DD`. If today's ET daily briefing markdown is missing but Hermes reports that the Morning Briefing cron job failed today, the response prepends a synthetic failed daily row so the Briefing tab shows today's failure instead of falling back to yesterday. Failed rows include the daily job's next run plus any auto-retry watcher `next_run_at` so the UI can distinguish recovery attempts from tomorrow's normal run.

**Response**

```typescript
Array<{
  id: string;
  kind: "daily" | "weekend";
  date: string;
  title: string;
  summary: string | null;
  dateRange?: { start: string; end: string };
  status?: "ready" | "failed";
  run?: BriefingRunFailure;
}>
```

### GET /api/bridge/briefings/[id]

**File**: `src/app/api/bridge/briefings/[date]/route.ts`

Read one briefing by stable id. Daily ids are ISO dates (`2026-06-17`); weekend ids are `weekend:YYYY-MM-DD` and should be URL-encoded by clients (`weekend%3A2026-06-20`). Returns rendered markdown content for successful briefing files. If a daily file is missing and Hermes has a same-day failed Morning Briefing run, returns a failed briefing payload instead of 404. The failed payload excludes the retry watcher itself from failure detection and surfaces the watcher's next auto-retry time separately.

**Response**

```typescript
{
  id: string;
  kind: "daily" | "weekend";
  date: string;
  title: string;
  summary: string | null;
  dateRange?: { start: string; end: string };
  content: string;
  status?: "ready" | "failed";
  run?: BriefingRunFailure;
}
```

### GET /api/bridge/briefings/link-target

**File**: `src/app/api/bridge/briefings/link-target/route.ts`

Resolve a briefing markdown link into a native Hilt destination when possible. This keeps briefing links such as Library report/memo links inside Hilt instead of opening raw rendered report pages.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `href` | string | Required. Link URL from the briefing markdown. |
| `date` | string | Optional briefing ISO date. Used to resolve reports/memos as-of that briefing. |

**Response**

```typescript
{
  target: null | {
    kind: "library-morning-report" | "library-editors-memo";
    view: "docs" | "library";
    scope: string; // absolute Docs path or Library item scope
    path: string;  // Bridge-vault-relative file path
  };
}
```

### POST /api/bridge/briefings/retry

**File**: `src/app/api/bridge/briefings/retry/route.ts`

Queue a retry for a failed briefing by invoking the existing Hermes cron job with `hermes cron run --accept-hooks <job-id>`. This does not run a separate Hilt generator; Hermes remains the owner of briefing generation.

**Request Body**

```typescript
{ id?: string; date?: string } // id preferred; daily only, defaults to today's ET date
```

**Response**

```typescript
{
  ok: true;
  status: "queued";
  date: string;
  jobId: string;
  message: string;
}
```

### POST /api/bridge/tasks

**File**: `src/app/api/bridge/tasks/route.ts`

Add a new task to the current weekly list.

**Request Body**

```typescript
{ title: string }
```

**Response**

```typescript
{ task: BridgeTask }
```

### PUT /api/bridge/tasks/[id]

**File**: `src/app/api/bridge/tasks/[id]/route.ts`

Update a task by ID. Supports toggling done, renaming, editing details, moving position, and assigning a project path.

**Request Body**

```typescript
{
  done?: boolean;
  title?: string;
  details?: string[];
  moveTo?: "top" | "bottom";
  projectPath?: string | null;
}
```

**Response**

```typescript
{ tasks: BridgeTask[] }
```

### DELETE /api/bridge/tasks/[id]

**File**: `src/app/api/bridge/tasks/[id]/route.ts`

Delete a task by ID.

**Response**

```typescript
{ ok: true }
```

### PUT /api/bridge/tasks/reorder

**File**: `src/app/api/bridge/tasks/reorder/route.ts`

Reorder tasks by providing the full ordered list of task IDs.

**Request Body**

```typescript
{ order: string[] }
```

**Response**

```typescript
{ success: true }
```

### GET /api/bridge/projects

**File**: `src/app/api/bridge/projects/route.ts`

Get all projects parsed from the vault.

**Response**

```typescript
BridgeProject[]
```

### GET /api/bridge/areas

**File**: `src/app/api/bridge/areas/route.ts`

Get all area files parsed from `areas/*/index.md`, enriched with matching North Star lines from `areas/index.md`.

**Response**

```typescript
{
  vaultPath: string;
  rollupPath: string | null;
  areas: BridgeArea[];
}
```

### PUT /api/bridge/projects/status

**File**: `src/app/api/bridge/projects/status/route.ts`

Update a project's status.

**Request Body**

```typescript
{
  projectPath: string;
  status: "considering" | "refining" | "doing" | "done";
}
```

**Response**

```typescript
{ ok: true }
```

### PUT /api/bridge/notes

**File**: `src/app/api/bridge/notes/route.ts`

Update the notes section of the current weekly list.

**Request Body**

```typescript
{ notes: string }
```

**Response**

```typescript
{ success: true }
```

### POST /api/bridge/upload

**File**: `src/app/api/bridge/upload/route.ts`

Upload a file (image, etc.) to a media directory within the vault. Uses multipart form data.

**Form Fields**

| Field | Type | Description |
|-------|------|-------------|
| `file` | File | The file to upload |
| `scope` | string | Base vault path |
| `fileDir` | string | Directory within scope for the media subfolder |

**Response**

```typescript
{ relativePath: string }  // e.g., "media/screenshot.png"
```

### POST /api/bridge/recycle

**File**: `src/app/api/bridge/recycle/route.ts`

Create a new weekly list, optionally carrying over incomplete tasks from the current week.

**Request Body**

```typescript
{
  carry: string[];   // Task IDs to carry forward
  newWeek: string;   // ISO date string for the new week
}
```

**Response**

```typescript
{ filename: string }
```

---

## Docs Routes

Routes for the Docs view, which provides a file browser and editor for project files.

### GET /api/docs/tree

**File**: `src/app/api/docs/tree/route.ts`

Build and return the file tree for a given scope directory.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Required. Root directory path |

**Response**

```typescript
{
  root: FileNode;
  scope: string;
  modTime: number;
}
```

### GET /api/docs/file

**File**: `src/app/api/docs/file/route.ts`

Read a file's content and metadata. Returns text content for viewable file types, null for binary files.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Required. Absolute file path |
| `scope` | string | Required. Scope for path validation |

**Response**

```typescript
{
  path: string;
  content: string | null;
  isBinary: boolean;
  isViewable: boolean;
  mimeType: string;
  size: number;
  modTime: number;
}
```

### PUT /api/docs/file

Save content to a file. Only viewable (text) file types can be saved.

**Request Body**

```typescript
{
  path: string;
  content: string;
  scope: string;
}
```

**Response**

```typescript
{ success: true; modTime: number }
```

### GET /api/docs/raw

**File**: `src/app/api/docs/raw/route.ts`

Serve a file's raw binary content with appropriate MIME type headers. Used for rendering images, PDFs, and other binary files in the browser.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Required. Absolute file path |
| `scope` | string | Required. Scope for path validation |

**Response**: Raw file bytes with `Content-Type` and `Cache-Control` headers.

---

## Stack Routes

Routes for the Stack view, which inspects Claude configuration files (CLAUDE.md, settings, MCP configs) across system/user/project layers.

### GET /api/claude-stack

**File**: `src/app/api/claude-stack/route.ts`

Discover the full Claude configuration stack for a given scope.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Required. Project directory path |

**Response**

```typescript
{ stack: ConfigStack }
```

### GET /api/claude-stack/file

**File**: `src/app/api/claude-stack/file/route.ts`

Read a specific configuration file's parsed content.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Required. Absolute path to the config file |
| `scope` | string | Optional. Scope for stack-aware metadata lookup |

**Response**

```typescript
{ file: ConfigFileContent }
```

### PUT /api/claude-stack/file

Save content to a configuration file.

**Request Body**

```typescript
{
  path: string;
  content: string;
  createDirectories?: boolean;
}
```

**Response**

```typescript
{ success: true }
```

### DELETE /api/claude-stack/file

Delete a configuration file.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Required. Absolute path to the config file |

**Response**

```typescript
{ success: true }
```

### PUT /api/claude-stack/mcp

**File**: `src/app/api/claude-stack/mcp/route.ts`

Toggle an MCP server's enabled state in `~/.claude/settings.json`.

**Request Body**

```typescript
{
  pluginId: string;
  enabled: boolean;
}
```

**Response**

```typescript
{ success: true; pluginId: string; enabled: boolean }
```

### POST /api/claude-stack/mcp

Update a user-defined MCP server configuration in `~/.claude/.mcp.json`.

**Request Body**

```typescript
{
  serverName: string;
  config: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
}
```

**Response**

```typescript
{ success: true; serverName: string }
```

---

## Chat Config

### GET /api/chat/config

**File**: `src/app/api/chat/config/route.ts`

Get OpenClaw gateway configuration for the chat interface. Reads from environment variables or `~/.openclaw/openclaw.json`.

**Response**

```typescript
{
  url: string;     // Gateway WebSocket URL
  token: string;   // Auth token
  agents: string[];
}
```

---

## Utility Routes

### GET /api/cwd

**File**: `src/app/api/cwd/route.ts`

Get current working directory.

**Response**

```typescript
{ cwd: string }
```

### POST /api/reveal

**File**: `src/app/api/reveal/route.ts`

Open a path in macOS Finder.

**Request Body**

```typescript
{ path: string }
```

**Response**

```typescript
{ success: true }
```

### GET /api/inbox-counts

**File**: `src/app/api/inbox-counts/route.ts`

Get inbox item counts grouped by scope.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Base scope path |

**Response**

```typescript
{
  counts: Record<string, number>;  // path -> count
}
```

### GET /api/ws-port

**File**: `src/app/api/ws-port/route.ts`

Get the WebSocket server port. Reads from `~/.hilt-ws-port` file written by the event server on startup.

**Response**

```typescript
{ port: number }
```

Returns `503` if the WebSocket server is not running.

---

## Preferences

**File**: `src/app/api/preferences/route.ts`

Server-side storage for user preferences. Persists across Electron rebuilds (unlike localStorage).

### GET /api/preferences

Get all or specific preferences.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `key` | string | Optional. Specific preference key to fetch |

**Response (no key)**

```typescript
{
  pinnedFolders: PinnedFolder[];
  sidebarCollapsed: boolean;
  theme: "light" | "dark" | "system";
  recentScopes: string[];
  viewMode: "briefings" | "bridge" | "docs" | "library" | "people" | "system";
}
```

**Response (key=pinnedFolders)**

```typescript
PinnedFolder[]  // Array of pinned folder objects
```

**Response (key=sidebarCollapsed|theme|viewMode)**

```typescript
{ value: boolean | string }
```

**Response (key=recentScopes)**

```typescript
string[]  // Array of recent scope paths
```

### POST /api/preferences

Create/add operations.

**Request Body**

```typescript
{
  action: "pinFolder";
  path: string;  // Folder path to pin
}

// OR

{
  action: "addRecentScope";
  scope: string;  // Scope path to add to recents
}
```

**Response**

```typescript
// pinFolder
PinnedFolder  // The created pinned folder

// addRecentScope
string[]  // Updated recent scopes array
```

### PATCH /api/preferences

Update operations.

**Request Body**

```typescript
// Reorder pinned folders
{
  action: "reorderPinnedFolders";
  activeId: string;
  overId: string;
}

// OR simple key-value update
{
  key: "sidebarCollapsed" | "theme" | "viewMode";
  value: boolean | string;
}
```

**Response**

```typescript
// reorderPinnedFolders
PinnedFolder[]  // Reordered array

// key-value update
{ success: true }
```

### DELETE /api/preferences

Delete operations.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `action` | `"unpinFolder"` | Action to perform |
| `id` | string | Pinned folder ID to unpin |

**Response**

```typescript
{ success: true }
```

---

## External Integration Routes

### POST /api/firecrawl

**File**: `src/app/api/firecrawl/route.ts`

Scrape and extract content from URLs using Firecrawl service.

**Request Body**

```typescript
{
  url: string;
}
```

**Response**

```typescript
{
  content: string;
  title?: string;
  url: string;
}
```

### GET /api/youtube-transcript

**File**: `src/app/api/youtube-transcript/route.ts`

Fetch transcript for a YouTube video.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `videoId` | string | YouTube video ID |

**Response**

```typescript
{
  transcript: string;
  videoId: string;
}
```

---

## Reference Library APIs

The Library APIs expose the file-native reference system in the bridge vault. Durable references are markdown files under `references/`; discovery candidates are hidden markdown files under `references/.cache/library-candidates/`. All routes use the shared artifact contract from `src/lib/library/types.ts`.

Saved references that predate source configs and have no `source_id:` are exposed as the synthetic source `manual` / `Manual`. This is a read-time grouping so older hand-filed references can be isolated without rewriting their frontmatter.

### GET /api/library

Lists saved references and, by default, unexpired candidates.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Keyword search over title, description, summary, tags, URL, and connections |
| `status` | string | `saved`, `candidate`, `promoted`, `skipped`, or `expired` |
| `source` | string | Source config id |
| `channel` | string | Source channel such as `youtube`, `raindrop`, `twitter`, `rss`, or `manual` |
| `tag` | string | Tag/facet filter. Matches semantic tags plus source-native taxonomy such as Raindrop tags/collections and X bookmark folders. |
| `mode` | string | `study`, `keep`, or `all`. Defaults to `study`; `keep` is quiet durable-save material such as products, clothing, recipes, restaurants, and other saved-for-later items. |
| `unread` | boolean | When `true`, returns only artifacts that are still unread in local Hilt read state |
| `includeCandidates` | boolean | Defaults to `true` |
| `offset` | number | Offset for incremental loading |
| `limit` | number | Maximum rows for this page |

When no lifecycle `status` is requested, the list returns saved references plus active `candidate` review items. Skipped, expired, and promoted candidate-cache records stay hidden from the active Library feed unless requested explicitly with `status=skipped`, `status=expired`, or `status=promoted`. When no `mode` is requested, the list defaults to `study` so quiet keep-mode items remain durable and searchable without crowding the main review feed.

Study-mode artifacts include dynamic `eval_attrs` when the list can score them. `eval_attrs.worth` is the compact priority score; `relevance`, `substance`, `freshness`, `lifecycle`, and `why` are the progressive-disclosure breakdown. Keep-mode artifacts omit `eval_attrs`.

**Response**

```typescript
{
  artifacts: LibraryArtifact[];
  total: number;        // Count after all active filters, including unread=true when present
  unread_total: number; // Count for the active filter/search slice
  offset: number;
  limit: number;
}
```

### GET /api/library/:id

Returns a single saved reference or candidate with full summary, key points, assessment, metadata, and body content.

Optional query parameter:

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Vault-relative markdown path from the list response. When present and the path hash matches `:id`, the route parses that exact file directly instead of walking the whole Library tree. |

### POST /api/library/resolve-wikilink

Resolves an Obsidian wikilink from a Library reader context to the Hilt tab that should open it. Resolution is server-side so the UI can respect the actual bridge vault rather than guessing from link text.

```typescript
{
  target: string;       // Required. Wikilink target, with optional |alias or #heading
  currentPath?: string; // Vault-relative markdown path for relative links
}
```

Response for a resolved link:

```typescript
{
  exists: true;
  target: string;                 // Resolved vault-relative markdown path
  view: "library" | "people" | "docs";
  scope: string;                  // Scope passed to navigateTo(view, scope)
  href: string;                   // Hilt URL for the destination
  path: string;                   // Resolved vault-relative markdown path
}
```

Routing rules:

| Resolved path | Destination |
|---------------|-------------|
| `references/**` | Library item URL |
| `people/index.md` or `people/<slug>.md` | People tab |
| Any other markdown file | Docs tab |

Unresolved links return `{ exists: false, target }`.

### GET /api/library/unread

Returns whether any active Library item is unread. This is a lightweight shell endpoint for the top-level Library navigation dot; it short-circuits after the first unread saved reference or active candidate.

```typescript
{
  has_unread: boolean;
}
```

### POST /api/library/read

Marks one or more Library artifacts read in local Hilt read-state storage. This does not mutate reference markdown or candidate files.

```typescript
{
  ids: string | string[];
}
```

Returns `{ marked, ids, read_at }`.

### POST /api/library/:id/archive

Archives a saved reference by stamping `archived`, `archived_at`, and `archived_from` frontmatter, then moving its markdown file into a local `.archive/` folder beside the original file. Archived references are hidden from normal Library lists, unread counts, and source counts, but automated ingestion still scans them as durable suppression records so explicit-save sources such as X/Raindrop do not recreate the same URL on the next source check. Candidate review items should use Dismiss instead of archive; the file-level status remains `skipped`.

### GET /api/library/candidates

Lists hidden candidate records from `references/.cache/library-candidates/`.

### PATCH /api/library/candidates/:id

Updates candidate review status. Supported status values are `candidate` and `skipped`. The UI labels `skipped` as Dismissed because it means "remove from active review"; the hidden candidate record remains available until cleanup/expiry.

### POST /api/library/candidates/:id/promote

Promotes a candidate to a durable reference and marks the candidate as promoted.

```typescript
{
  reason?: "explicit_signal" | "manual_save" | "auto_threshold" | "for_you_selected" | "briefing_selected";
}
```

### GET /api/library/sources

Returns loaded `meta/sources/*.yaml` source configs plus source-state status.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Keyword filter applied before source counts are calculated |
| `status` | string | `saved`, `candidate`, or `all`; counts reflect the active lifecycle slice |
| `channel` | string | Source channel such as `youtube`, `raindrop`, `twitter`, `rss`, or `manual` |
| `tag` | string | Tag/facet filter applied before source counts are calculated |
| `mode` | string | `study`, `keep`, or `all`; counts and source child facets reflect the active mode slice |

Source summaries include source-native child facets under `facets`: Raindrop collections/tags when available, X bookmark folders when configured, and any other adapter-provided source taxonomy. They also include `study_count`, `keep_count`, and matching unread counts so the filter rail can separate the main study feed from the quiet keep archive.

### POST /api/sources/ingest

Runs the shared source runner for selected sources or every enabled source. Credential-gated sources return `424` with blocked source details instead of pretending live access succeeded.

```typescript
{
  sourceIds?: string[];
  cadence?: "manual" | "hourly" | "daily" | "weekly"; // when sourceIds is omitted, run enabled sources with this cadence
  useSummarize?: boolean;
  dryRun?: boolean;      // fetch + digest + report without writing refs/candidates/state/dead letters
  ignoreState?: boolean; // ignore source checkpoints; dryRun implies this
  useCursor?: boolean;   // use source-state/backfill cursor for resumable historical batches
  limit?: number;        // canary/backfill batch cap
  reweaveTimeoutMs?: number; // optional per-item cap for the Bridge-aware reweave pass
}
```

The response includes `dry_run`, `use_cursor`, `limit`, aggregate counts, per-source `cursor`/`next_cursor`, per-source counts, and per-artifact statuses. In dry-run mode, `saved`, `candidate`, `promoted`, and `skipped` mean "would write" outcomes; the vault is not mutated.

The Library UI uses this route for `Check sources`, separate from local list revalidation and `/api/library/health` status refresh. If a source is selected in the Library source rail, the check runs only that source. Otherwise it runs enabled hourly sources with a small batch limit. Manual UI checks pass a short `reweaveTimeoutMs` so long transcript/vault-weave work can fall back to `reweave_pending` instead of blocking visible source refresh; scheduler/backfill jobs may omit it to use the deeper default.

### GET /api/sources/status

Returns current source configs and checkpoint state without running ingestion.

### GET /api/library/health

Returns the operational Reference Library dashboard contract: launchd scheduler job load state, source last-success/blocker status, and dead-letter counts.

```typescript
{
  checked_at: string;
  ok: boolean;
  scheduler: {
    loaded: number;
    expected: number;
    jobs: Array<{
      id: string;
      label: string;
      schedule: string;
      loaded: boolean;
      installed: boolean;
      last_exit_code: number | null;
      stderr_bytes: number;
      stdout_updated_at: string | null;
      stderr_updated_at: string | null;
      stdout_excerpt: string | null;
      stderr_excerpt: string | null;
      message: string | null;
      status: "ok" | "warning" | "blocked";
    }>;
  };
  sources: Array<LibrarySourceSummary & {
    status: "ok" | "warning" | "blocked" | "disabled";
    last_checked: string | null;
    last_error: string | null;
  }>;
  dead_letters: {
    total: number;
    recent_24h: number;
    last_at: string | null;
    by_source: Array<{ source_id: string; count: number }>;
  };
}
```

### CLI Source Utilities

- `npm run library:auth` verifies required source credential names and live access where Hilt can call the source directly. It reports only env key presence, never secret values.
- `npm run library:ingest:dry-run -- <source-id>` runs the same ingestion path in canary mode with no writes.
- `npm run library:ingest -- --dry-run --limit 5 <source-id>` is the explicit form for one source.
- `npm run library:backfill -- --limit 50 <source-id>` runs cursor-backed historical ingestion for checkpointed sources. Cursors are stored in `meta/sources/.source-state.json`; dry runs report `next_cursor` but do not advance it.
- `npm run library:audit-quality -- --queue /path/to/queue.json` scans saved references and candidates for warm/cold digestion quality, source-policy mismatches, fallback notes, short summaries, and missing key points.
- `npm run library:redigest -- --queue /path/to/queue.json --limit 5 --write` re-runs queued items through `summarize` and updates the existing note with `digestion_status`, `digested_with`, `digested_at`, and refreshed summary/key points. Omit `--write` for a dry run.
- `npm run library:x:videos -- --limit 100` scans saved references/candidates for X/Twitter `/video/1` links that do not have transcript capture. Add `-- --write` to redigest them with X video subtitles/audio transcription and stamp terminal unavailable states (`x_video_transcript_status`) for silent, suspended, private, or deleted videos.
- `npm run library:book:import -- --input /path/to/book-capture/output --raw-text-json /path/to/raw_text.json --title "Book" --author "Author" --thumbnail "/api/docs/raw?path=..."` imports generated book-capture markdown as a manual durable reference. It dry-runs by default; add `--write` to create `references/books/<book>/index.md`, copy generated topic markdown, add optional cover media, cache the full capture/OCR under `references/.cache/book-captures/`, and run the Bridge-aware reweave/connection pass. Use `--skip-reweave` only when intentionally importing without connection enrichment.
- `npm run library:reweave -- --vault /path/to/bridge --path references/example.md --write` reruns the durable-reference reweave pass manually. It preserves existing Media/Raw Content blocks, rewrites the digest body, updates `connection_suggestions`, and registers optional review items with `--review-batch`.
- `npm run library:repair-legacy -- --path references/example.md` performs a non-destructive legacy reference repair: it preserves existing summaries/connections, adds missing `published`, `thumbnail`, `video_url`, `## Media`, and `## Raw Content` where available, and only writes with `-- --write`. Source cache snippets shorter than 500 characters are ignored by default; use `-- --min-cache-chars <n>` only for an intentional source-limited repair.
- `npm run library:repair-body-cruft` reports saved references with old manual-capture body chrome such as `← [[index|References]]`, bold source/author/date/format blocks, or `## Media` before `# Title`. Add `-- --write` to remove only that chrome, translate missing body metadata into frontmatter, and normalize the body section order.
- `npm run library:repair-media -- --source manual --include-candidates` performs a report-first media repair for references/candidates missing representative images. It fetches Open Graph/Twitter card image metadata, adds `thumbnail:` plus `## Media` when safe, and only writes with `-- --write`.
- `npm run library:migrate-references` reports durable references still using legacy `source:` frontmatter. Add `-- --apply` to rewrite only those legacy source URLs to `url:`.
- `npm run library:youtube:oauth -- --client-file /path/to/client_secret.json` opens Google OAuth for YouTube liked videos and writes token fields to `.env.local` without printing token values.
- YouTube playlist sources use `url: youtube://playlist/<playlist-id>` or `metadata.playlist_id`. The configured `youtube-bookmarks` playlist is explicit-save/durable; other YouTube playlists default to candidate/review unless their source config says otherwise. Watch Later is not enabled because the YouTube Data API does not reliably expose it as a normal playlist.
- `npm run library:repair-youtube-liked -- --write` converts older YouTube-liked durable references into candidate review records after a dry-run check.
- `npm run library:scheduler:plan` prints the launchd schedule without installing anything.
- `npm run library:scheduler:install` writes and loads user-level launchd jobs for hourly ingestion, daily newsletter ingestion, retry replay, candidate cleanup, and recommendation refresh.
- `npm run library:scheduler:uninstall` unloads and removes those launchd jobs.

X/Twitter bookmarks can use `xurl` instead of raw env tokens. Configure the source with `metadata.auth_provider: xurl`, install or build the scoped Bridge xurl binary, register an X API app with `/Users/jruck/go/bin/xurl-bridge-scoped auth apps add bridge-library --client-id ... --client-secret ... --redirect-uri http://localhost:8080/callback`, set it as the default app, and complete `/Users/jruck/go/bin/xurl-bridge-scoped auth oauth2 --app bridge-library`; then the adapter shells out to the configured xurl binary. The callback URL in the X Developer Portal must exactly match `http://localhost:8080/callback`. The Bridge source currently points at `/Users/jruck/go/bin/xurl-bridge-scoped`, which requests only `tweet.read`, `users.read`, `bookmark.read`, and `offline.access`. When the X response includes media expansions, Hilt stores the first image as `thumbnail:` and keeps the source media list for the `## Media` renderer.

X/Twitter bookmark titles are normalized before writing: trailing `t.co`/HTTP URLs are stripped, and URL-only wrappers fall back to `X bookmark by <author>` instead of using the shortlink as the title. If a linked X URL is an article route such as `/i/article/...` rather than a standard status URL, redigestion marks the item warm/metadata-limited unless recoverable source text exists.

Newsletters use the `superhuman-news` source id and `mcp-remote` against `https://mcp.mail.superhuman.com/mcp`; OAuth is cached under `~/.mcp-auth` rather than `.env.local`. Run `npm run library:auth -- superhuman-news` to verify live access. The email adapter only calls `list_threads` and `get_thread`, filters mutating MCP tools at the proxy layer, and writes News split items as discovery candidates, not durable references. It does not fall back to Gmail.

### GET /api/library/recommendations

Returns the file-native For You ranking over recent saved references and unexpired candidates. The v0 ranker caps responses at eight items, scores against active projects, current weekly tasks, North Stars, people notes, recent saves, and persisted `connection_suggestions`, and returns numeric eval fields (`worth`, `relevance`, `substance`, `freshness`, `lifecycle`, `eval_attrs`), `why`, and `matched_terms`. It does not return artificial priority labels such as `must_read`, `recommended`, or `interesting`.

### GET /api/search

Stable v0 keyword search contract over saved references and candidates. This route is intentionally swappable for the later Memory & Search implementation.

---

## Reports

### GET /api/reports/:name

Serves a rendered HTML report from `~/.hilt/reports/<name>/index.html` (generated by
`scripts/report-html.ts`). The remote-viewing surface for agent-written reports — rides the existing
Tailscale Serve mount of the dev server, so reports are tailnet-reachable at
`https://<machine>.<tailnet>.ts.net/api/reports/<name>` without root-only `tailscale serve` file
mounts. `name` is allowlist-validated (`[a-z0-9-]`, max 64) — never a path. Returns `text/html`
(no-store); `400` on invalid name, `404` when the report doesn't exist.

## WebSocket Protocol (EventServer)

**Server**: `ws://localhost:{port}/events` (port discovered via `GET /api/ws-port`)

**Files**: `server/event-server.ts`, `server/ws-server.ts`

The EventServer provides a channel-based pub/sub system for real-time updates. Clients subscribe to channels with optional filtering parameters (e.g., scope) and receive broadcast events when watched resources change.

### Client -> Server Messages

**Subscribe**
```typescript
{
  type: "subscribe";
  channel: string;               // Channel name (see below)
  params?: Record<string, unknown>;  // Filtering params (e.g., { scope: "/path" })
}
```

**Unsubscribe**
```typescript
{
  type: "unsubscribe";
  channel: string;
}
```

**Ping**
```typescript
{ type: "ping" }
```

### Server -> Client Messages

**Connected** (sent on connection)
```typescript
{ type: "connected"; clientId: string }
```

**Subscribed** (acknowledgment)
```typescript
{ type: "subscribed"; channel: string }
```

**Unsubscribed** (acknowledgment)
```typescript
{ type: "unsubscribed"; channel: string }
```

**Pong**
```typescript
{ type: "pong" }
```

**Error**
```typescript
{ type: "error"; message: string }
```

**Event Broadcast** (data push to subscribers)
```typescript
{
  channel: string;
  event: string;
  data: unknown;
}
```

### Channels

| Channel | Params | Events | Description |
|---------|--------|--------|-------------|
| `tree` | `{ scope: string }` | `changed` | File tree structure changed (file add/remove/rename) |
| `file` | `{ scope: string }` | `changed` | File content changed within scope |
| `inbox` | `{ scope: string }` | `changed` | Todo.md file changed within scope |
| `bridge` | *(none)* | `weekly-changed`, `projects-changed` | Vault weekly list or project files changed |

### Client Usage (React Hook)

```typescript
const { connected, subscribe, unsubscribe, on } = useEventSocket();

useEffect(() => {
  if (!connected) return;

  subscribe("tree", { scope: "/path/to/project" });
  const unsub = on("tree", "changed", (data) => {
    // Refresh tree data
  });

  return () => {
    unsub();
    unsubscribe("tree");
  };
}, [connected]);
```

---

## Error Responses

All routes return errors in this format:

```typescript
{
  error: string;
}
```

Common HTTP status codes:
- `400` - Bad request (missing/invalid parameters)
- `403` - Forbidden (path traversal, permission denied)
- `404` - Not found
- `500` - Server error
- `503` - Service unavailable (e.g., WebSocket server not running)

---

*Last updated: 2026-06-10*
