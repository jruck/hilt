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
}
```

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

### GET /api/system/sync/conflicts

Returns conflict-copy files for the configured Syncthing folder. Parameters:

| Param | Type | Description |
|-------|------|-------------|
| `folder` | string | Folder id, defaults to `work-meta` |
| `scope=local` | string | Return only the serving machine's conflicts |
| `force=true` | string | Bypass cached sync snapshot |

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

### GET /api/library

Lists saved references and, by default, unexpired candidates.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Keyword search over title, description, summary, tags, URL, and connections |
| `status` | string | `saved`, `candidate`, `promoted`, `skipped`, or `expired` |
| `sourceId` | string | Source config id |
| `channel` | string | Source channel such as `youtube`, `raindrop`, `twitter`, `rss`, or `manual` |
| `tag` | string | Tag filter |
| `includeCandidates` | boolean | Defaults to `true` |
| `limit` | number | Maximum rows |

### GET /api/library/:id

Returns a single saved reference or candidate with full summary, key points, assessment, metadata, and body content.

### GET /api/library/candidates

Lists hidden candidate records from `references/.cache/library-candidates/`.

### PATCH /api/library/candidates/:id

Updates candidate review status. Supported status values are `candidate` and `skipped`.

### POST /api/library/candidates/:id/promote

Promotes a candidate to a durable reference and marks the candidate as promoted.

```typescript
{
  reason?: "explicit_signal" | "manual_promotion" | "auto_threshold" | "for_you_selected" | "briefing_selected";
}
```

### GET /api/library/sources

Returns loaded `meta/sources/*.yaml` source configs plus source-state status.

### POST /api/sources/ingest

Runs the shared source runner for selected sources or every enabled source. Credential-gated sources return `424` with blocked source details instead of pretending live access succeeded.

```typescript
{
  sourceIds?: string[];
  useSummarize?: boolean;
}
```

### GET /api/sources/status

Returns current source configs and checkpoint state without running ingestion.

### GET /api/library/recommendations

Returns the file-native For You ranking over recent saved references and unexpired candidates.

### GET /api/search

Stable v0 keyword search contract over saved references and candidates. This route is intentionally swappable for the later Memory & Search implementation.

---

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

*Last updated: 2026-05-27*
