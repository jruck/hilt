# Data Models Reference

This document describes all data structures used in Hilt.

## Core Types

### FileNode

Represents a file or directory in the Docs view file tree.

```typescript
interface FileNode {
  name: string;           // Display name (e.g., "README.md")
  path: string;           // Absolute path
  type: "file" | "directory";
  children?: FileNode[];  // Only for directories
  extension?: string;     // e.g., "md", "ts", "png"
  size?: number;          // File size in bytes
  modTime: number;        // Unix timestamp (ms)
  ignored?: boolean;      // True for macOS system folders, cloud sync, etc.
}
```

### BridgeTask

A single task item parsed from a weekly markdown file.

```typescript
interface BridgeTask {
  id: string;              // "task-0", "task-1", ...
  title: string;           // Display text only (no markdown link syntax)
  done: boolean;           // [x] vs [ ]
  details: string[];       // Indented sub-bullet lines (raw markdown)
  rawLines: string[];      // All lines in this task block
  startLine?: number;      // 1-based source line of the top-level checkbox
  projectPath: string | null;  // First relative project path, or null
  projectPaths: string[];  // All linked project/thought paths
  dueDate: string | null;  // YYYY-MM-DD from [due:: ...]
  group: string | null;    // ### group heading inside ## Tasks
  // Weekly list v2 (list_format: 2) additive fields — absent on v1 lists
  taskPath?: string | null; // v2: LAST markdown-link target on the line = vault-relative task-file path
  missing?: boolean;       // v2 hydration: true when the task file is absent/unreadable (raw line rendered as-is)
}
```

On a v2 list the parser delegates line parsing to `src/lib/tasks/weekly-v2.ts`
(`parseWeeklyV2Line`): `title`/`done`/`dueDate` come from the line, `taskPath` is the
last link target, and `projectPaths` stays **empty** (the v1 title-link project overload
is dead in v2 — projects live in task frontmatter and arrive via hydration). Hydration
(`src/lib/bridge/weekly-v2-view.ts`) then overlays task-FILE truth onto
`title`/`done`/`dueDate`/`projectPaths` per line, or degrades to the raw line's own data
with `missing: true`.

### BridgeWeekly

Parsed representation of a weekly markdown file from the Bridge vault.

```typescript
type BridgeWeeklySection = "accomplishments" | "notes" | "tasks";

interface BridgeWeekly {
  filename: string;        // "2026-01-27.md"
  week: string;            // "2026-01-27" from frontmatter
  listFormat: 1 | 2;       // frontmatter list_format (default 1); 2 = task-file-backed view
  needsRecycle: boolean;   // Current date in newer ISO week
  sectionOrder: BridgeWeeklySection[]; // Source order of weekly sections
  tasks: BridgeTask[];
  accomplishments: string; // Raw markdown of ## Accomplishments section
  notes: string;           // Raw markdown of ## Notes section
  vaultPath: string;       // Absolute path to vault root
  filePath: string;        // Absolute path to the weekly .md file
  availableWeeks: string[];// All weeks in lists/now, newest first
  latestWeek: string;      // The most recent week (for detecting preview mode)
}
```

### BridgeProject

A project folder parsed from the Bridge vault.

```typescript
type BridgeProjectStatus = "considering" | "refining" | "doing" | "done";

interface BridgeProject {
  slug: string;            // Folder name
  path: string;            // Absolute path to project folder
  relativePath: string;    // Path relative to vault root (e.g., "projects/slug")
  title: string;           // H1 from index.md, or folder name fallback
  status: BridgeProjectStatus;
  area: string;
  tags: string[];
  source: string;          // Display group (e.g., "Projects", "EverPro", "Ventures")
}

interface BridgeProjectsResponse {
  vaultPath: string;       // Absolute path to the bridge vault root
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
}
```

### BridgeArea

An ongoing responsibility or durable goal area parsed from `areas/<slug>/index.md`, with current focus lines from `areas/index.md`.

```typescript
type BridgeAreaFocusSection = "now" | "ongoing" | "long-term";

interface BridgeAreaFocus {
  section: BridgeAreaFocusSection;
  text: string;            // North Star line without the wikilink target
  target: string;          // Raw wikilink target, e.g. "writing" or "family/index"
  label: string;           // Wikilink label or target basename
  raw: string;             // Full source bullet from areas/index.md
}

interface BridgeAreaLink {
  target: string;          // Raw wikilink target when present
  label: string;           // Link label or cleaned item text
  raw: string;             // Full source bullet
}

interface BridgeArea {
  slug: string;            // Folder name
  path: string;            // Absolute path to area folder
  indexPath: string;       // Absolute path to the area's index.md
  relativePath: string;    // Path relative to vault root, e.g. "areas/health"
  title: string;           // H1 from index.md, or folder name fallback
  description: string;     // Frontmatter description or intro paragraph
  goals: string[];         // Bullet items under ## Goals
  standards: string[];     // Bullet items under ## Standards
  activeProjects: BridgeAreaLink[];
  focus: BridgeAreaFocus[];
  primaryFocus: BridgeAreaFocusSection | null;
  lastModified: number;    // Latest modified time in the area folder
}

interface BridgeAreasResponse {
  vaultPath: string;
  rollupPath: string | null;
  areas: BridgeArea[];
}
```

### Briefing

Briefing summaries and details are backed by markdown in the Bridge vault. Weekday daily files live at `briefings/YYYY-MM-DD.md`; weekend editions live at `briefings/weekend/YYYY-MM-DD.md`, where the date is the Saturday start date. Hilt exposes both in one list using stable ids: daily ids are `YYYY-MM-DD`, and weekend ids are `weekend:YYYY-MM-DD`. When today's daily markdown is missing because Hermes failed, Hilt can synthesize a failed daily row from Hermes cron state so the Briefing tab still represents today's run.

```typescript
type BriefingKind = "daily" | "weekend";
type BriefingStatus = "ready" | "failed";
type BriefingFailureKind = "quota" | "rate_limit" | "model" | "unknown";

interface BriefingDateRange {
  start: string;           // YYYY-MM-DD
  end: string;             // YYYY-MM-DD
}

interface BriefingRunFailure {
  status: "failed";
  kind: BriefingFailureKind;
  date: string;            // ET date, YYYY-MM-DD
  jobId: string;           // Hermes cron job id
  jobName: string;         // Usually "Morning Briefing"
  runAt: string;           // ISO timestamp from Hermes jobs.json
  nextRunAt: string | null;     // Next normal Morning Briefing run
  autoRetryNextRunAt: string | null; // Next no-agent retry watcher tick, if installed
  error: string;           // Raw Hermes error string
  outputPath: string | null; // Latest Hermes cron markdown output for this date/job
}

interface BriefingSummary {
  id: string;              // Daily: YYYY-MM-DD; weekend: weekend:YYYY-MM-DD
  kind: BriefingKind;
  date: string;
  title: string;
  summary: string | null;
  dateRange?: BriefingDateRange; // Weekend editions only
  status?: BriefingStatus;
  run?: BriefingRunFailure;
}

interface BriefingDetail extends BriefingSummary {
  content: string;         // Empty for failed synthetic rows
}

interface BriefingNativeLinkTarget {
  kind: "library-morning-report" | "library-editors-memo";
  view: "docs" | "library";
  scope: string;           // Absolute Docs path or Library item scope
  path: string;            // Bridge-vault-relative source markdown path
}

interface LoopEscalationsResponse {
  loops: Array<{
    id: string;
    phase: "live" | "shadow";
    artifact_date: string;
  }>;
  items: Array<LoopItem & {
    loop_phase: "live" | "shadow";
    artifact_date: string;
    verdict?: Verdict;     // Latest existing ask verdict, when present
    // LoopItem also carries task_id?: string (B3) — the proposal task file this ask minted
    // (the A6 ledger stamp), exposed so the briefing editor/canvas can join item ↔ task.
  }>;
  errors: Array<{
    loop?: string;
    phase?: "live" | "shadow";
    message: string;
  }>;
}
```

### PinnedFolder

A folder pinned to the sidebar for quick access.

```typescript
interface PinnedFolder {
  id: string;
  // Unique identifier (timestamp + random)

  path: string;
  // Full folder path

  name: string;
  // Display name (last path segment)

  pinnedAt: number;
  // Timestamp for ordering
}
```

### Source

Configured local or remote Hilt library source.

```typescript
interface Source {
  id: string;                    // "src-<timestamp>-<random>"
  name: string;                  // User label
  type: "local" | "remote";     // Connection behavior and display
  url: string;                   // Local: Electron-assigned URL. Remote: user-provided URL.
  folder?: string;               // Local only: absolute library folder path
  rank: number;                  // 0-based; lower rank is tried first for startup/fallback
}
```

### Local Apps

Monitor-only local service/app discovery. Hilt owns the scanner and exposes only redacted process metadata to the browser.

```typescript
type ServiceKind =
  | "frontend"
  | "backend"
  | "fullstack"
  | "database"
  | "queue"
  | "infra"
  | "browser_debug"
  | "system"
  | "unknown";

interface LocalAppService {
  id: string;                    // FNV-1a over svc:{pid}:{host}:{port}:{args}
  listener: {
    protocol: string;
    host: string;
    port: number;
    pid: number;
    command: string;
    user?: string | null;
    parent_pid?: number | null;
  };
  process: {
    pid: number;
    parent_pid?: number | null;
    parent_chain: number[];
    cwd?: string | null;
    executable?: string | null;
    args: string;                // Redacted before API/UI exposure
    start_time?: string | null;
  };
  kind: ServiceKind;
  title: string;
  description: string;
  confidence: number;
  visible: boolean;
  hidden_reason?: string | null;
  source_signals: string[];
  project: {
    git_root?: string | null;
    branch?: string | null;
    worktree?: string | null;
    package_name?: string | null;
  };
  preview_url?: string | null;
  url_candidates: string[];
  health: {
    status: "up" | "down" | "unknown";
    label: string;
    http_status?: number | null;
    latency_ms?: number | null;
    checked_at?: string | null;
    error?: string | null;
    url?: string | null;
  };
  page_title?: string | null;
  favicon_url?: string | null;
  framework_hints: string[];
  preview?: {
    path?: string | null;        // last successful screenshot, if one exists
    captured_at: string;         // screenshot mtime when path exists; error time otherwise
    error?: string | null;       // latest capture error, if the last refresh failed
    error_at?: string | null;    // when the latest capture error occurred
    stale?: boolean;             // true when older than the recapture interval
  } | null;
}

interface LocalAppGroup {
  id: string;                    // FNV-1a over group:{path-or-command}:{branch}:{first-command}
  title: string;
  description: string;
  path?: string | null;
  git_root?: string | null;
  branch?: string | null;
  package_name?: string | null;
  confidence: number;
  visible: boolean;
  hidden_reason?: string | null;
  services: LocalAppService[];
  ports: number[];
  primary_url?: string | null;
  source_signals: string[];
  ai?: null;
  updated_at: string;
}

interface LocalAppsMachineSnapshot {
  id: string;                    // tailscale DNS, IP, or hostname
  self: boolean;
  reachable: boolean;
  source_url?: string | null;    // base URL used for remote Hilt preview/API reads
  machine: {
    hostname: string;
    tailscale_dns?: string | null;
    tailscale_ip4?: string | null;
    origin: "local" | "remote";
  };
  groups: LocalAppGroup[];
  diagnostics: ScanDiagnostics;
  error?: string | null;
}
```

### System machine snapshots

System uses the same machine identity model across Sessions, Apps, Stack, and Sync. Only Hilt-running peers are included; arbitrary tailnet devices are not inspected.

```typescript
interface SystemMachine {
  id: string;                    // tailscale DNS, IP, or hostname
  self: boolean;
  reachable: boolean;
  source_url?: string | null;    // base URL for peer Hilt API calls
  machine: {
    hostname: string;
    tailscale_dns?: string | null;
    tailscale_ip4?: string | null;
    origin: "local" | "remote";
  };
  role?: "full" | "agent";       // full Hilt server vs read-only System Agent; absent peers treated as "full"
  features?: {
    map: boolean;
    apps: boolean;
    stack: boolean;
    sync: boolean;
  };
  app_server?: AppServerInfo | null; // dev/prod mode + build age (src/lib/system/app-server-info.ts); null for agents
  error?: string | null;
}

// SystemMachineResponse (src/lib/system/types.ts) — what /api/system/machine returns.
// Same identity/features, plus a required additive `role`. A read-only System Agent
// (server/system-agent.ts, docs/plans/system-agent-mode.md) emits role:"agent" with
// app_server:null; a full Hilt server emits role:"full".
interface SystemMachineResponse {
  app: "hilt-system";
  enabled: true;
  role: "full" | "agent";
  machine: MachineIdentity;
  features: { map: boolean; apps: boolean; stack: boolean; sync: boolean };
  app_server?: AppServerInfo | null;
}

interface AppServerInfo {
  mode: "dev" | "prod";        // how this Next.js instance runs
  dist_dir: string;            // ".next" or ".next-prod"
  build_id: string | null;     // prod only
  built_at: string | null;     // ISO build-completion time (rebuild stamp preferred)
  supervised: boolean;         // fresh supervisor heartbeat on the serving machine
  supervisor: { kind: "electron" | "daemon"; state: SupervisorState; detail?: string } | null;
}

// Supervisor protocol files under ${DATA_DIR} (server/server-mode.ts,
// docs/plans/supervisor-v1.md). All derived/operational state — never vault markdown.
interface SupervisorHeartbeat {       // app-supervisor.json — written every 30s + on state change
  kind: "electron" | "daemon";
  pid: number;
  started_at: string;
  beat_at: string;                    // >90s old (or dead pid) ⇒ unsupervised
  state: "idle" | "rebuilding" | "switching" | "reverting";
  detail?: string;
  children?: Record<string, number>;  // child name → pid
}

interface AppModeIntent {             // app-mode-intent.json — written by POST /api/system/app-mode
  mode: "dev" | "prod";
  ts: number;                         // dedupe key; supervisors ignore already-seen ts
  requested_by?: string;
}

interface SystemStackSnapshot {
  machine: SystemMachine;
  stack: ClaudeStack | null;
  readOnly: boolean;             // true for remote peers in v1
  projectPath: string | null;
  error: string | null;
}
```

System Sessions wraps each machine's local Map graph with machine-level ids. Session ids use `{machineId}::{localSessionId}` and tree ids use either `machine:{machineId}` or `node:{machineId}::{localNodeId}`, so history reads can route back to the owning Hilt instance without storing raw transcripts centrally.

### System Sync snapshots

System Sync is read-only Hilt observability over a local Syncthing daemon. Aggregate responses include enabled and disabled machine entries so the UI can show missing env vars, peer version gaps, or daemon/API failures without hiding machines.

```typescript
interface SystemSyncMachineSnapshot {
  machine: SystemMachine;
  provider: "syncthing";
  enabled: true;
  readOnly: true;
  daemon: {
    reachable: boolean;
    version: string | null;
    deviceId: string | null;
    startTime: string | null;
    error: string | null;
  };
  folder: {
    id: string;
    path: string;
    type: string;
    state: string;
    stateChanged: string | null;
    lastScan: string | null;
    lastFile: { at: string | null; filename: string | null; deleted: boolean } | null;
    inSyncFiles: number;
    inSyncBytes: number;
    needFiles: number;
    needBytes: number;
    pullErrors: number;
    versioning: { enabled: boolean; type: string | null; maxAgeDays: number | null };
    maxConflicts: number | null;
    ignore: { includePresent: boolean; localHash: string | null; sharedHash: string | null };
    conflicts: { count: number; truncated: boolean; files: Array<{ path: string; modifiedAt: string | null; sizeBytes: number | null }> };
    disk: {
      totalBytes: number | null;
      syncedBytes: number;
      ignoredBytes: number | null;
      otherBytes: number | null;
      ignoredPathCount: number;
      largestIgnoredPaths: Array<{ path: string; sizeBytes: number }>;
    };
  } | null;
  peers: Array<{ deviceId: string; label: string; connected: boolean; address: string | null }>;
  refreshedAt: string;
  error: string | null;
}
```

The Syncthing API key, raw Syncthing config, and arbitrary file contents are never included in System Sync responses.

## Persistence Formats

### map.sqlite

Stored at `${DATA_DIR}/map.sqlite`. This is the local-first Map index for Codex and Claude session metadata. It stores normalized metadata only; raw transcripts remain in provider files and are read on explicit history-preview requests.

```typescript
interface MapSessionRow {
  id: string;
  provider: "codex" | "claude";
  harness: string;                 // cli, state-sqlite, project-jsonl, code-session-json, etc.
  external_id: string;
  external_key: string;            // Stable provider/harness/session key
  title?: string;
  cwd?: string;
  workspace_root?: string;
  workspace_label?: string;
  space_label?: string;
  repo_remote?: string;
  git_branch?: string;
  role: "orchestrator" | "worker" | "peer" | "unknown";
  observed_state: "active" | "idle" | "archived" | "unknown";
  tracking_state: "foreground" | "background"; // Visibility state: human-legible work or lower-salience background work
  source_path?: string;            // Server-only history lookup; not exposed in graph/session pages
  last_seen_at: number;
  last_activity_at?: number;
  event_count: number;
  token_estimate?: number;
  metadata_json: string;           // JSON object for bounded derived metadata such as workFootprint
  activity_heat_24h: number;
  activity_heat_7d: number;
  activity_heat_30d: number;
  activity_heat_all: number;
}
```

`metadata_json.workFootprint` is capped metadata derived from tool/path activity, not transcript content:

```typescript
interface WorkFootprintEntry {
  path: string;                    // Server-derived absolute folder path
  label: string;                   // Workspace-relative label when possible
  weight: number;                  // Aggregate path-signal strength
  eventCount: number;
  kinds: Array<"read" | "write" | "shell" | "search">;
}
```

Additional Map tables:

| Table | Purpose |
|-------|---------|
| `map_source_files` | Tracks provider file path, harness, mtime, size, last scan status/error, and associated session id |
| `map_overrides` | Manual tracking/workspace overrides that take precedence over inferred metadata |
| `map_checkpoints` | Schema-ready local resume checkpoints for future human-written sign-offs |
| `map_meta` | Last scan timestamp and diagnostics JSON |

### graph.sqlite

Stored at `${DATA_DIR}/graph.sqlite` (override `HILT_GRAPH_DB_PATH`). The flag-gated (`HILT_GRAPH_ENABLED`) **derived** knowledge-graph index for System → Graph — markdown remains source of truth. Mirrors `calendar/db.ts` (better-sqlite3, WAL, `synchronous=NORMAL`, path-keyed singleton, `ensureGraphSchema()` with `IF NOT EXISTS`). Created and read only when the flag is on.

| Table | Columns (key) | Purpose |
|-------|---------------|---------|
| `graph_nodes` | `id` PK, `type`, `label`, `ref_path`, `degree`, `color_key`, `source_file`, `attrs_json`, `updated_at` | One row per node. `source_file` powers incremental delete-by-file; indexed on `type`/`ref_path`/`source_file`. |
| `graph_edges` | `id` PK, `source_id`, `target_id`, `kind`, `weight`, `source_file`, `attrs_json`, `updated_at` | One row per edge; indexed on `source_id`/`target_id`/`kind`/`source_file`. |
| `node_positions` | `id` PK, `x`, `y`, `z` (reserved, 2D in v1), `dirty`, `layout_version`, `updated_at` | Precomputed force-layout coordinates. `dirty` marks the region a scoped relayout must relax; `layout_version` gates warm-start reuse. |
| `graph_meta` | `key` PK, `value` | Key/value store assembled into `GraphMeta` (counts exclude `type='tag'`/`kind='tag'`; `dirty` derived from `node_positions`). |

### semantic.sqlite

Stored at `${DATA_DIR}/semantic.sqlite` (override `HILT_SEMANTIC_DB_PATH`). The flag-gated (`HILT_SEMANTIC_ENABLED`) **third derived cache** alongside `graph.sqlite` and `calendar.sqlite` for the Phase-2 Semantic Knowledge Layer — markdown stays source of truth (`rm semantic.sqlite*` + a cold-start rebuild reproduces it). Mirrors the graph/calendar db conventions (better-sqlite3, WAL, `synchronous=NORMAL`, path-keyed singleton, `IF NOT EXISTS`) with one deliberate deviation: **`PRAGMA foreign_keys = ON`** (ruling R4) so deleting an item cascades to its chunks/mentions/memberships. Tables: `semantic_items` (one row per source unit, `item_id` = the graph node id), `chunks` (canonical LE-float32 `embedding_blob`), `entities`/`entity_aliases`/`item_entities`/`item_entity_mentions`/`entity_merges` (Layer B), hierarchical `topics` + `item_topics` + `topic_lineage` (Layer C), and `semantic_meta`. The `vec0` KNN virtual tables (`chunk_vectors`/`entity_vectors`/`topic_vectors`) exist only when the optional `sqlite-vec` extension loads; the BLOBs are canonical so search degrades to an in-process cosine scan.

**Versioning (P2.4).** Every derived row carries `semantic_version` (`SEMANTIC_VERSION`, the `vN`/`vN.M` integer-published/decimal-test scheme from `src/lib/semantic/pipeline.ts`, mirroring the Library `PIPELINE_VERSION`). A model/prompt bump is a **backfill, not a migration**: new-version rows are written **alongside** prior-version rows until blessed (coexistence), then `gcStaleVersions()` drops `version != active_version`. `semantic_meta` keys:

| Key | Purpose |
|-----|---------|
| `db_format_version` | `SEMANTIC_DB_FORMAT_VERSION` — orthogonal to `SEMANTIC_VERSION` (the `LAYOUT_VERSION` precedent). On open, a lagging value **discards every derived table and rebuilds** (schema/wire change invalidates the cache file independently of a model upgrade). |
| `active_version` | The "of record" version queries default to (`getActiveVersion()`); defaults to the headline `SEMANTIC_VERSION` until a cold-start blesses one. Surfaced in `query.status()` as `activeVersion` (+ `versions`, the coexistence window). |
| `active_embedding` / `active_extraction` / `active_taxonomy` | The component versions recorded at the blessed baseline (the upgrade blast-radius record). |
| `built_at` / `blessed_at` / `gc_at` / `last_backfill_version` / `last_backfill_at` | Operational timestamps. |

### local-apps/settings.json

Stored at `${DATA_DIR}/local-apps/settings.json`, falling back to `~/.hilt/local-apps/settings.json` when `DATA_DIR` is unset. If no Hilt settings exist, Hilt imports Port Authority settings once from `~/Library/Application Support/Port Authority/settings.json`.

```typescript
interface LocalAppsSettings {
  dev_roots: string[];
  rules: Array<{
    id: string;
    action: "hide" | "show";
    scope: "process_name" | "command_contains" | "path_prefix" | "port" | "service_id" | "group_id";
    pattern: string;
    note?: string | null;
    created_at: string;
  }>;
  scan_interval_ms: number;      // default 5000
  api_port: number;              // compatibility metadata only
  ai: {
    enabled: boolean;            // unused in Hilt v1
    endpoint: string;
    model: string;
  };
}
```

Optional screenshots are cached under `${DATA_DIR}/local-apps/previews` and served only by filename through `/api/local-apps/previews/[filename]`. Preview metadata keeps the last successful screenshot path even when a later capture fails; the failure is exposed as `preview.error`/`preview.error_at` so the UI can continue showing the last good frame while marking it stale or failed. Screenshots from remote Hilt peers are proxied by machine id and safe filename through `/api/local-apps/remote-preview`; arbitrary remote preview URLs are not part of the public model.

### preferences.json

Stored in `data/preferences.json`. Persists user preferences across app restarts and Electron rebuilds.

```typescript
interface UserPreferences {
  pinnedFolders: PinnedFolder[];
  // Folders pinned to sidebar for quick access

  sidebarCollapsed: boolean;
  // Whether sidebar is collapsed or expanded

  theme: "light" | "dark" | "system";
  // UI theme preference

  recentScopes: string[];
  // Last 10 visited folder paths (most recent first)

  viewMode: "briefings" | "bridge" | "docs" | "library" | "people" | "system";
  // Current top-level view mode. Legacy map/local-apps/stack URLs resolve into system modes.

  folderEmojis?: Record<string, string>;
  // Separate storage for folder emojis by path
  // Persists across unpin/re-pin

  inboxPath?: string;
  // Global inbox folder path for quick capture

  bridgeVaultPath?: string;
  // Bridge vault path for weekly tasks and projects

  workingFolder?: string;
  // Default working folder — used as initial scope for Docs, Stack, and Bridge views

  chatAgent?: string;
  // Chat view: last used agent label

  chatSessionKey?: string;
  // Chat view: session key for continuity across app restarts
}
```

**Note**: Preferences were previously stored in localStorage, which would be cleared when Electron app cache was rebuilt. Server-side storage ensures persistence.

### Todo.md Format

Primary inbox storage when project has a `docs/Todo.md` file.

```markdown
# Section Heading

- [ ] Uncompleted item with id <!-- id:abc123 -->
- [x] Completed item <!-- id:def456 -->

## Subsection

- [ ] Another item <!-- id:ghi789 -->
```

Parsing rules:
- `#` headings create sections
- `- [ ]` creates uncompleted item
- `- [x]` creates completed item
- `<!-- id:xxx -->` contains item ID (auto-generated if missing)
- Items before first heading are "orphans"

### inbox.json (Fallback)

Stored in `data/inbox.json` when no Todo.md exists.

```typescript
interface InboxDB {
  items: Array<{
    id: string;
    prompt: string;
    projectPath: string | null;
    createdAt: string;  // ISO timestamp
    sortOrder: number;
  }>;
}
```

## Task Object Models (v3 Phase 1)

One markdown file per task at `<vault>/tasks/<id>.md`; proposals are task files from birth at `<vault>/tasks/.proposals/<id>.md` (approve = rename into `tasks/`, dismiss = unlink — the meeting loop's ledger is the memory). Frontmatter keys are snake_case in the file. Source: `src/lib/tasks/types.ts`.

### TaskFile

```typescript
type TaskStatus = "proposed" | "accepted-me" | "accepted-agent" | "in-progress" | "done" | "dropped";

interface TaskFile {
  id: string;                 // t-YYYYMMDD-NNN, collision-checked across tasks/ AND tasks/.proposals/
  title: string;
  status: TaskStatus;
  due?: string;               // YYYY-MM-DD
  projects?: string[];        // vault-relative project paths (replaces the weekly title-link overload)
  origin?: { loop?: string; meeting?: string; list?: string; item_id?: string; thread?: string };
                              // list = vault-relative weekly-list path the task was carried
                              // from by the weekly recycle (e.g. "lists/now/2026-07-13.md")
  created_at: string;         // ISO 8601
  provenance?: { quote: string; source: string };
  extra?: Record<string, unknown>; // unknown frontmatter keys — preserved across parse/serialize
  body: string;               // running context/work ledger; status transitions append
                              // "- <ISO> status: a → b (via …)" under "## History"
}
```

Round-trip byte fidelity is the parse/serialize contract (`src/lib/tasks/task-file.ts`): `parse(serialize(x)) === x` and `serialize(parse(text)) === text` for files Hilt wrote; bodies are never reformatted. Allowed status transitions live in `src/lib/tasks/status.ts` (`done → in-progress` is the checkbox-uncheck reopen; `dropped` is terminal).

### WeeklyV2Line / HydratedWeeklyV2Line

```typescript
interface WeeklyV2Line {           // parsed from "- [ ] [Title](tasks/t-….md) [due:: YYYY-MM-DD]"
  raw: string;                     // the exact source line
  checked: boolean;                // checked = done, unchecked = in-progress (write-through mirror)
  title: string;
  taskPath: string | null;         // first link target — the task file is the source of truth
  due: string | null;
}

interface HydratedWeeklyV2Line {
  line: WeeklyV2Line;
  task?: TaskFile;
  missing: boolean;                // per-line degradation: unreadable file → raw line kept, never dropped
}
```

Weekly lists opt in via frontmatter `list_format: 2` (`listFormatFromFrontmatter`); the v1 parser (`src/lib/bridge/weekly-parser.ts`) is untouched.

### Proposal minting from loop ledgers (v3 unit A6)

Meeting-loop asks become proposal task files at ESCALATION time (`src/lib/loops/proposal-mint.ts`). Mapping — LedgerEntry → TaskFile: `action` → `title`; first citation's `anchor`+`source` → `provenance { quote, source }`; meeting path + ledger id + loop id → `origin { loop, meeting, item_id }`; `due` carries; `context` (when present) becomes the proposal BODY's leading paragraph (a non-ISO stated due follows as its own `Due (as stated): …` line — entries without context mint the pre-context body byte-for-byte). The verdict item id IS the ledger id IS `origin.item_id` — that triple join is how the verdict route finds the file.

```typescript
// LedgerEntry (src/lib/loops/meeting-ledger.ts) gains:
interface LedgerEntry {
  // …
  context?: string;   // extractor-written SURROUNDING DISCUSSION, sized to the verdict (prompt
                      // v2.2 purpose-based rule: usually a couple sentences, a short paragraph
                      // when warranted; 1500-char runaway cap via cleanExtractedContext) —
                      // rides into the
                      // minted proposal's body. Forward-only: pre-v2.2 entries lack it; a later
                      // sighting may fill an empty one (fillContextIfEmpty) but existing prose
                      // is never overwritten.
  task_id?: string;   // proposal file minted from this entry — the idempotency stamp:
                      // a stamped entry NEVER re-mints (survives re-runs AND the deliberate
                      // file deletion of a dismiss)
}

// RegistryLoop (src/lib/loops/types.ts, meta/loops/registry.yml) gains:
interface RegistryLoop {
  // …
  proposal_sink?: "vault";  // where escalation-time proposals land; "vault" = tasks/.proposals/
                            // (the auditable graduation of just this one write). Absent = shadow
                            // default <loopHome>/proposals/.
}
```

Sink precedence (`resolveProposalSink`, exact order): `--proposals-dir` flag → that dir; `--ledger-home` flag → `<home>/proposals/` (eval isolation); registry `proposal_sink: "vault"` → `<vault>/tasks/.proposals/`; else `<loopHome>/proposals/`. Ids are minted by `createProposalIn` (store.ts): collision-checked against the sink dir AND the vault's canonical `tasks/` + `.proposals/`, so a shadow-minted id never collides in the vault.

### Post-meeting extraction trigger state (v3 unit B1)

`$DATA_DIR/loops/meeting-trigger-state.json` — the granola-daemon-hosted trigger's memory (`src/lib/granola/extraction-trigger.ts`; atomic writes, entries pruned after 14 unobserved days):

```typescript
interface TriggerState {
  version: 1;
  meetings: Record<string, TriggerMeetingState>;  // keyed by granola_id
}

interface TriggerMeetingState {
  meeting_path: string;        // vault-relative note path — the loop's meeting key
  transcript_measure: number;  // transcript entry count at last poll (growth detector)
  stable_polls: number;        // consecutive no-growth sync observations (incl. current)
  stable_since: string;        // ISO of the first observation at the current measure
  last_observed_at: string;    // ISO; drives pruning
  fired_at?: string;           // once set, this meeting NEVER fires again (survives restarts)
  fired_reason?: "settled" | "already-processed"; // "already-processed" = nightly got it first
}
```

Settled = enhanced notes present ∧ `transcript_measure > 0` ∧ `stable_polls ≥ 3` ∧ `now − stable_since ≥ 120s` (knobs: `HILT_MEETING_TRIGGER_SETTLE_POLLS` / `HILT_MEETING_TRIGGER_SETTLE_MS`). The trigger also consults the loop's own `processed-meetings.json` (registry-resolved home) before firing.

## Comment Primitive (gate-B pre-build for Phase C)

**File**: `src/lib/comments/types.ts` (the target model), `src/lib/comments/post.ts` (the router)

ONE "leave a comment" gesture across the app: `CommentTarget` is the typed anchor union, `postComment(target, text)` is the only client entry point, and `CommentBox` / `VerdictNoteField` (`src/components/comments/`) are the only inputs. **`CommentTarget` is explicitly the anchor contract C2's thread store adopts VERBATIM** — a comment is the first message of a chat session with a deferred agent turn; C2 swaps `postComment`'s internals for the thread store and retires the Revise button. Do not fork per-surface target shapes.

```typescript
type CommentTarget =
  | { kind: "task"; id: string }                       // task-object file (tasks/ or .proposals/)
  | { kind: "loop-item"; loop: string; itemId: string; artifactDate?: string }
  | { kind: "briefing"; date: string }                 // whole morning briefing
  | { kind: "briefing-section"; date: string; section: string }
  | { kind: "briefing-anchor"; date?: string;          // synthesized bullet without a minted id
      anchor: { section?: string; citation?: string; text: string } }
  | { kind: "library"; id: string }                    // NOT ROUTED until C2 (typed out)
  | { kind: "meeting"; rel: string };                  // NOT ROUTED until C2 (typed out)

// What postComment accepts today — library/meeting are compile-time excluded (and throw
// at runtime through a cast) until C2's thread store absorbs them.
type ImplementedCommentTarget = Exclude<CommentTarget, { kind: "library" } | { kind: "meeting" }>;
```

Routing (kind → store TODAY): `loop-item` / `briefing` / `briefing-section` / `briefing-anchor` → `POST /api/loops/feedback` (faithful `FeedbackTarget` translation; briefing kinds post under the `briefing` loop). `task` → the task's ORIGIN loop item when `origin.loop + origin.item_id` exist (a task comment IS feedback on its source ask); origin-less tasks get a `- <iso> note: <text>` line appended to the task-file body via `PUT /api/tasks/[id]` (the file is the record; C2 lifts these into threads).

Verdict notes are the SIBLING path, not postComment: `useVerdictNote` + `VerdictNoteField` let typed text ride ANY verdict click as `note` in the single `POST /api/loops/verdicts` request (what revise alone did before); the loop's pass 0 persists it as `entry.verdict = { verdict, at, note? }`, and dismiss notes surface in the A7 dismissed digest as `… — declined: <note ≤100 chars>` so the extractor learns why.

Supporting type change: `FeedbackTarget` (`src/lib/loops/types.ts`) gains `section?: string` — valid ONLY at `level: "section"`, carrying the briefing section heading for the `briefing-section` kind.

## Thread Models (v3 unit C2)

**File**: `src/lib/threads/types.ts` (models), `src/lib/threads/store.ts` (store), `src/lib/threads/feedback-bridge.ts` (FeedbackTarget↔CommentTarget), `src/lib/threads/migrate.ts` + `scripts/threads-migrate.ts` (one-shot migration)

Comments are THREADS: one store, one write API (`POST /api/threads`). A thread anchors to a `CommentTarget` (the union above, adopted verbatim). The two legacy stores migrated in; their function signatures survive as thin adapters — `appendFeedback`/`readFeedback`/`readUnprocessedFeedback`/`markFeedbackProcessed` (`src/lib/loops/stores.ts`) still speak `FeedbackRecord`, and the library feedback functions (`src/lib/library/library-feedback.ts`) still speak `LibraryComment`, both thread-backed.

```typescript
interface ThreadMessage {
  id: string;
  author: string;          // "justin" | "claude-sim" | "agent:<loop>"
  text: string;
  created_at: string;
  edited_at?: string;
}

interface Thread {
  id: string;              // crypto.randomUUID(), validated before every path join
  target: CommentTarget;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  messages: ThreadMessage[];                              // ≥1 — last delete removes the file
  processed?: { at: string; run_at: string };             // loop-consumption stamp; implies resolved
  resolution?: { action: string; at: string; run_at?: string; by: string };
  source_ref?: string;     // migration provenance: the original record/comment id (idempotency key)
}
```

**Persistence**: one JSON file per thread at `DATA_DIR/threads/<uuid>.json` (app state, never the vault) — atomic temp+rename, normalize-on-read never throws (chat-store contract: reads degrade to missing, mutations throw).

**Append-to-open semantics**: a new comment on a target with an OPEN thread appends to it; a resolved/processed target starts a fresh thread. Target identity = `targetKey` (kind + naming ids; `loop-item.artifactDate` and `briefing-anchor.anchor.citation` are deliberately NOT identity).

**FeedbackTarget → CommentTarget mapping** (migration + live adapter, `feedback-bridge.ts`): level `item`+anchor → `briefing-anchor`; level `item`+item_id → `loop-item {loop, itemId, artifactDate?}`; level `section` → `briefing-section`; level `briefing` → `briefing {date}` (dateless legacy records borrow the record's created_at day). Reading back, a home (`<base>/meta/loops/<domain>`) resolves to its loop ids via the registry (`loopIdsForHome` — domain "briefings" ↔ loop id "briefing"), and each human message maps to one `FeedbackRecord` (message id = record id; `agent:*` consumption messages are excluded).

**C2 amendments to the Comment Primitive section above**: `ImplementedCommentTarget` now equals `CommentTarget` (library and meeting kinds are live); `postComment` routes EVERY kind to `POST /api/threads` (task-with-origin still lands on the origin loop-item; origin-less tasks thread under the task id — the pre-C2 note-line body write is retired, existing note lines untouched). The old stores (`<loopHome>/feedback/records.jsonl`, `DATA_DIR/library-feedback/*.json`) are frozen history after `scripts/threads-migrate.ts --write`.

## Object Reference Models (v3 unit B5)

**File**: `src/lib/objects/types.ts` (the shared contract), `src/lib/objects/uri.ts` (grammar)

Universal object references: everywhere Hilt name-drops a system object it renders as a
consistent inline pill (ObjectPill) that previews the object's card and navigates to its
native view.

```typescript
type ObjectKind = "meeting" | "task" | "person" | "project" | "library";

interface ObjectRef {
  kind: ObjectKind;
  id: string;   // the kind's native identifier — may contain "/" (vault-relative paths)
}
```

**`hilt:` URI grammar** — markdown carries object references as ordinary links, so files stay
portable and degrade to plain links anywhere else:

```
[display text](hilt:meeting/<vault-rel-path>)   hilt:meeting/meetings/2026-07-05/Floyds….md
[display text](hilt:task/<task-id>)             hilt:task/t-20260705-003
[display text](hilt:person/<slug>)              hilt:person/art-vandelay
[display text](hilt:project/<vault-rel-path>)   hilt:project/projects/everpro-migration
[display text](hilt:library/<artifact-id>)      hilt:library/9f3a…
```

`parseHiltUri` splits on the FIRST `/` after the scheme (path ids keep their internal slashes)
and returns `null` for any non-`hilt:` href — that null is the injection seam: the briefing's
`BriefingLink` renders an `ObjectPill` for a parsed ref and falls through to its normal anchor
for everything else, so pre-B5 briefings render byte-identically. `buildHiltUri`
percent-encodes per id segment (spaces/unicode stay markdown-safe); hand-written un-encoded
ids still parse.

The resolver contract (`ResolvedObject`: `card: ObjectCardData` + `nav: ObjectNavTarget |
null`) lives in the same file — see `GET /api/objects/resolve` in API.md.

## Reference Library Models

The Reference Library is file-native first. Durable references live under `references/` in the bridge vault, while discovery candidates live under `references/.cache/library-candidates/`. Source definitions live in bridge-owned YAML files under `meta/sources/`.

### LibrarySourceConfig

```typescript
interface LibrarySourceConfig {
  id: string;
  name: string;
  channel: "rss" | "youtube" | "twitter" | "email" | "raindrop" | "manual" | "fixture";
  url: string;
  enabled: boolean;
  intent: "explicit_save" | "discovery";
  cadence: "manual" | "hourly" | "daily" | "weekly";
  signal?: string;
  tags: string[];
  library_mode?: "study" | "keep"; // Optional source-level default; item taxonomy can still infer keep.
  retention: {
    mode: "durable" | "candidate";
    ttl_days?: number;
    candidate_ttl_days: number;
    auto_promote_threshold: number;
  };
  auth: {
    required: boolean;
    env?: string | string[];
    scopes?: string[];
    stop_on_missing_credential: boolean;
  };
  backfill: {
    enabled: boolean;
    cursor?: string;
    limit?: number;
    mode: "none" | "checkpointed" | "full";
  };
  metadata: Record<string, unknown>;
}
```

Source auth checks report env key presence only. Real credential values live in `.env.local`, which is gitignored and loaded by the Library CLI before ingestion/auth verification.

Checkpointed historical backfills store their current resume token in `meta/sources/.source-state.json` rather than mutating source YAML. A completed cursor-based run records `cursor` when another page exists, or `backfill_complete_at` when an adapter explicitly reports no next cursor. Raindrop cursors are page-based, so cursor checks should use the same batch size as the live run to avoid overlap from changing `perpage`.

Books use a normal `manual` source config with `id: book-capture`, `intent: explicit_save`, and `format: book` on the written reference. They are imported, not scheduled: `references/books/<book>/index.md` is the durable Library item, generated topic markdown is copied under `references/books/<book>/topics/`, optional cover art is stored as `thumbnail:`/`## Media`, and the full generated capture plus page-level OCR is cached under `references/.cache/book-captures/<book>/capture.md`. Write imports run the same reweave/connection enrichment used for other durable saves unless `--skip-reweave` is passed intentionally.

Source configs should not use `tags` for source/type labels such as `bookmark`, `raindrop`, `twitter`, or `youtube`; the artifact already carries `source_id`, `source_name`, and `channel`. Source-provided taxonomy lives separately on the artifact as `source_tags`, `source_collection`, or `source_folder`. `tags` is reserved for semantic/display tags generated by digestion or manually authored into the note.

Playlist/course sources can declare series metadata in `metadata`: `series_id`, `series_title`, `series_url`, `series_total`, and `series_parent`. The YouTube playlist adapter adds child-level `series_index` from the playlist item position. Ingest still writes one durable/candidate item per video; series metadata only links those first-class children to a parent note generated by `npm run library:series:synthesize`.

`library_mode` separates the two Library use cases:

- `study` — the default mode for articles, videos, books, newsletters, and posts that should be reviewed, woven into Bridge context, and shown in the main Library Feed/List.
- `keep` — a quiet durable-save mode for shopping, products, clothing, furniture, restaurants, recipes, and other "remember this later" material. Keep items are still searchable and durable, but the default Library list hides them and the digestion path avoids forced project-connection weaving.

### LibrarySourceSummary

```typescript
interface LibrarySourceSummary {
  id: string;
  name: string;
  channel: LibrarySourceConfig["channel"];
  enabled: boolean;
  intent: LibrarySourceConfig["intent"];
  artifact_count: number;  // Saved refs after any active source-list filters
  candidate_count: number; // Candidates after any active source-list filters
  unread_count: number;    // Unread refs/candidates after any active source-list filters
  saved_unread_count: number;
  candidate_unread_count: number;
  study_count: number;
  keep_count: number;
  study_unread_count: number;
  keep_unread_count: number;
  facets: Array<{
    id: string;
    kind: "tag" | "collection" | "folder";
    label: string;
    value: string;
    count: number;
    unread_count: number;
    review_count: number;
  }>;
  last_fetched: string | null;
  blocked: string | null;
}
```

`facets` are child filters for a source. Raindrop uses collection and bookmark tags where the API exposes them; X/Twitter can use bookmark-folder metadata when the source adapter/config provides it; email/newsletter sources use `source_folder` as the sender facet and normalize raw sender addresses to friendly labels such as `AI News` or `Lenny`. Counts reflect the same status/mode/search slice as the source rail so the UI does not advertise hidden rows. The Library source rail can also group source summaries by channel for presentation, such as `YouTube` for playlist/channel sources and `Newsletters` for email sources; the API still returns the underlying source ids.

### IngestionReport

```typescript
interface IngestionReport {
  started_at: string;
  finished_at: string;
  dry_run: boolean;
  use_cursor: boolean;
  limit: number | null;
  checked: number;
  candidates: number;
  promoted: number;
  saved: number;
  skipped: number;
  duplicates: number;
  blocked: Array<{ source_id: string; reason: string }>;
  errors: string[];
  sources: Array<{
    source_id: string;
    source_name: string;
    cursor?: string | null;
    next_cursor?: string | null;
    checked: boolean;
    blocked: boolean;
    fetched: number;
    candidates: number;
    promoted: number;
    saved: number;
    skipped: number;
    duplicates: number;
    errors: string[];
    artifacts: Array<{
      url: string;
      title: string;
      status: "candidate" | "saved" | "promoted" | "duplicate" | "skipped" | "error";
      path?: string;
      reason?: string;
    }>;
  }>;
}
```

### LibraryArtifact

Digestion produces connections through LLM judgment (the Claude CLI), not deterministic token overlap. A connection is a directional relationship to an existing piece of the user's work — including baseline, contrast, and foundational ties — and a clean "no connection / just file it" verdict is a first-class outcome. The judge returns a `ConnectionJudgment`; its surviving connections are stored as structured `ConnectionSuggestion` entries:

```typescript
interface ConnectionSuggestion {
  target?: string | null; // Wiki-link target (slug) when one exists, or null for a peer/theme tie
  label: string;          // Display label for the connection
  relationship: string;   // LLM-written directional relationship (was `reason`)
  kind?: "project" | "task" | "area" | "person" | "recent_save"; // Optional classification
}

interface ConnectionJudgment {
  connects: boolean;
  reasoning: string;       // One-line rationale; explains an abstain too
  connections: ConnectionSuggestion[];
  reweave_candidates?: Array<{ target: string; why: string }>;
}
```

A connection (directional relationship, auto-written into the note) is distinct from a reweave candidate (a neighbor note that would be materially improved by this reference). Reweave candidates are surfaced for human review only; Hilt never auto-edits a neighbor note. The judge is deliberately abstain-biased and emits few high-signal ties rather than padding.

#### Reweave (durable saves)

Durable references are produced by a single **reweave** pass (`reweaveArtifact` in `src/lib/library/connections.ts`, prompt in `src/lib/library/reweave-prompt.ts`): one in-vault, read-only Claude run that both digests the source into a free-form note and discovers its connections. It returns a `ReweaveResult`:

```typescript
interface ReweaveConnection {
  target: string | null;    // Real vault-relative path without ".md", or null (null targets are dropped on parse)
  title: string;            // The neighbor note's human title (used as the wikilink label)
  relationship: string;     // Short plain predicate that reads after "Title — …"
}

interface ReweaveResult {
  description: string;           // 1–2 plain sentences for the feed card
  proposed_title: string;        // Clean descriptive title (files are NOT auto-renamed from this)
  digest_markdown: string;       // Free-form digest body; model picks ## sections per source
  connections_first_party: ReweaveConnection[]; // Justin's own authored work — surface all genuine ties
  connections_library: ReweaveConnection[];     // External refs he saved — only ties that sharpen/surprise
  reweave_candidates?: Array<{ target: string; why: string }>;
  attention_judgment?: { tier: "high" | "medium" | "low"; reason: string };
}
```

`parseReweaveOutput` is tolerant (raw JSON, ```json fences, or embedded JSON via brace-balanced extraction), drops connections whose target is empty or points into `references/.cache/`, strips a trailing `.md` from targets, requires a non-empty relationship, and coerces missing fields to safe defaults.

`digestion.ts` maps the `ReweaveResult` onto the processed artifact. For durable saves it sets `digest_markdown` + `description`, builds `connection_suggestions = [...connections_first_party, ...connections_library]` as `{ target, label: title, relationship }` (first-party ordered first), and sets `connected_projects` to the first-party targets under `projects/<slug>/`. When `reweaveArtifact` returns `null` (failure, timeout, `LIBRARY_CONNECTIONS_DISABLED=1`, or no vault path), it falls back to the legacy `judgeConnections` + `parseDigestOutput` Summary/Key Points path.

`judgeConnections` (the fallback) returns a `ConnectionJudgment` that `digestion.ts` maps onto the same fields. `ProcessedArtifact` carries:

```typescript
// Fields added to ProcessedArtifact:
digest_markdown?: string;                               // Free-form reweave digest body (durable saves)
description?: string;                                   // Reweave feed-card description; falls back to summary
summary: string;                                        // Legacy Summary text (candidates + reweave fallback)
key_points: string[];                                   // Legacy Key Points (candidates + reweave fallback)
connection_suggestions?: ConnectionSuggestion[];
connection_reasoning?: string;                          // Short reasoning, also folded into the assessment `why` tail
reconnected_at?: string;                                // Positive pass marker, including clean no-connection abstentions
reweave_candidates?: Array<{ target: string; why: string }>;
attention_judgment?: { tier: "high" | "medium" | "low"; reason: string };
connected_projects?: string[];                          // Subset of connection targets matching project-folder slugs
```

Study-mode artifacts (saved references and active candidates) may run the same reweave/connection pass. A successful pass writes either `connection_suggestions` (state `has`) or a positive abstention marker (`reconnected_at`, `connection_reasoning`, or the v2.2 `attention_judgment`, state `abstained`). A hot study item with none of those markers is treated as `missing_connection_pass` and is eligible for deferred repair. Saved references and candidates may include `connection_suggestions`, `connection_reasoning`, `reconnected_at`, `attention_judgment`, and `reweave_candidates` in frontmatter.

The **durable reference body is now a free-form digest**: when `digest_markdown` is present, the model-chosen `##` sections replace the fixed `## Summary` / `## Key Points` template, followed by `## Connections` and `## Raw Content` (and `## Media` when present). Connections render as `- [[target|Title]] - relationship` (the neighbor's human title as the wikilink alias; `- Title - relationship` for a null target); when there are none the section body is empty and reasoning/reweave candidates live in frontmatter. The frontmatter `description` uses `processed.description || processed.summary`. **Candidate** bodies are unchanged — they keep the legacy Summary/Key Points format and render the same `- [[target|Title]] - relationship` shape under `## Suggested Connections`. `connected_projects` remains the compact wiki-target list for filtering and compatibility. New durable references also include precise `captured_at` metadata; `Recent` keeps `created_at` as the source date and uses precise fields such as `captured_at` or `digested_at` only to order items that land on the same source date.

For X/Twitter bookmarks, `title` is source-normalized before file writes: short URLs are removed from human-readable tweet text, URL-only wrappers use an author fallback title, and non-status linked X routes remain `warm`/metadata-limited until a recoverable source body exists. The source URL still lives in `url:` and any cached source stays under `## Raw Content`; titles, descriptions, summaries, and key points should not be raw `t.co` links.

For X/Twitter video posts, `video_url` is persisted when discovered from bookmark URL entities, attached X media, linked X posts, or legacy Raw Content links. The canonical source cache is the video transcript, not the wrapper tweet. Successful transcript captures use `cached_source_extractor: x-video-subtitles` or `x-video-audio` with `source_cache.kind: "transcript"` and may stamp `source_recovered_from: <video_url>` plus `x_video_transcript_status: captured` / `x_video_transcript_method: subtitles|audio`. Terminal non-transcriptable videos are explicit: `x_video_transcript_status: unavailable_no_audio` for silent/no-audio media and `unavailable_source` for suspended/private/deleted/unavailable sources. Any X video without a transcript cache or terminal unavailable status is treated as a capture-health failure and routes to `needs_refetch`.

Login-walled captures (LinkedIn pulse, and any source whose fetched content is dominated by a sign-in gate) are detected by `loginWallVerdict` in `capture-health.ts` (shared phrase set + a prose-word threshold, env `LIBRARY_LOGIN_WALL_MIN_PROSE_WORDS`, default 50). A capture that leads with sign-in chrome but carries the real article underneath — the common Raindrop case, since Raindrop's permanent copy is a logged-in full-DOM snapshot — is summarized and woven normally. A capture that is *only* a wall (no article) is never graded `hot`; it is stamped `needs_auth_recovery: true`, treated as a `captureFailed` item (excluded from reweave), and routed to authenticated browser recovery (`npm run library:recover`), which clears the flag once real content is recovered. Source acquisition prefers a fresh live extract, then the Raindrop permanent copy, then source-metadata; the text summarizer runs on whichever full source is acquired (not the short Raindrop excerpt).

PDF sources (a file uploaded to Raindrop, or any bookmarked `.pdf` URL) are extracted to text rather than stored as binary. The cache is read as **bytes** and, when a PDF is detected (content-type `application/pdf` or the `%PDF` magic), run through `pdftotext` (`src/lib/library/pdf.ts`, `extractPdfText`; poppler, `PDFTOTEXT_BIN` override) — producing `source_cache.kind: "document"` with `cached_source_extractor: "raindrop-pdf"` (Raindrop cache) or `"pdftotext"` (a direct `.pdf` URL via `extractSourceContent`). The clean text then flows through the normal summarize + reweave path. A backstop, `looksLikeBinaryGarbage` (capture-health, wired into `captureFailed`), treats any undecodable binary dumped as text — a PDF/image read with the wrong reader — as a failed capture so it routes to re-extraction instead of landing as garbage.

```typescript
interface LibraryArtifact {
  id: string;
  title: string;
  description: string;
  url: string;
  path: string;
  source_type: "reference" | "reference-candidate";
  lifecycle_status: "saved" | "candidate" | "promoted" | "skipped" | "expired" | "dead_letter";
  channel: LibrarySourceConfig["channel"] | null;
  source_id: string | null;     // Primary (canonical) source.
  source_name: string | null;
  cited_from?: Citation[];      // Other sources that cited the SAME content (cross-source merge). See below.
  created_at: string;       // Visible Library date: source published date when available, otherwise capture/file date.
  updated_at: string;       // File mtime used for read-state freshness and as a last-resort ordering fallback.
  pipeline_version?: string; // Which pipeline version produced this note (provenance). See PIPELINE-VERSIONS.md.
  video_duration_seconds?: number; // Total video length (whole seconds) for video sources; powers the card duration badge.
  tags: string[];           // Semantic/display tags only; source/type labels are filtered out.
  source_tags: string[];    // Source-native taxonomy, e.g. Raindrop bookmark tags.
  source_collection: string | null;
  source_collection_id: string | null;
  source_folder: string | null;
  source_folder_id: string | null;
  series?: LibrarySeriesMetadata;
  library_mode: "study" | "keep";
  score: number;
  save_recommendation: "file" | "review" | "skip";
  destination?: string;
  is_unread: boolean;      // Hilt-local read state, not markdown frontmatter
  read_at: string | null;  // ISO timestamp when the current user last marked it read
  eval_attrs?: LibraryEvalAttrs; // Dynamic worth eval for study items; absent for keep items
  connections: string[];
  raw_frontmatter?: {
    thumbnail?: string;
    connection_suggestions?: ConnectionSuggestion[];
    connection_reasoning?: string;
    reconnected_at?: string;
    attention_judgment?: { tier: "high" | "medium" | "low"; reason: string };
    reweave_candidates?: Array<{ target: string; why: string }>;
  };
}
```

```typescript
interface LibrarySeriesMetadata {
  id: string;             // Stable grouping id, e.g. "stanford-cs153-frontier-systems"
  title: string;          // Human series/course/playlist title
  url?: string | null;    // Canonical playlist/course URL when available
  index?: number | null;  // 1-based child order; absent on parent notes
  total?: number | null;  // Expected child count when known
  parent_path?: string | null; // Vault-relative parent note path
}
```

Series metadata is orthogonal to duplicate/citation handling. A child item in a playlist/course/newsletter series is not a duplicate of the series parent; it is an individual Library item with its own source cache, digest, connections, and optional `series` link. Parent notes use `series_role: parent`, keep a source-appropriate `format` such as `video-series` or `newsletter`, and store a `child_references` manifest for the current child set.

`eval_attrs` is computed at read time for `study` items and is never a markdown storage field in this shape:

```typescript
interface LibraryEvalAttrs {
  worth: number;       // relevance × substance × freshness
  relevance: number;   // active-context and first-party connection fit
  substance: number;   // source depth / idea density
  freshness: number;   // recency multiplier
  lifecycle: "active" | "to_archive" | "archived";
  why: string;         // Compact explanation for the scores
}
```

The UI uses `worth` as the compact priority signal in normal reading surfaces. Admin/eval review surfaces can progressively disclose the component scores (`relevance`, `substance`, `freshness`) and the non-destructive `to_archive` lifecycle flag. Artificial label buckets such as `must_read`, `recommended`, and `interesting` are not part of the artifact contract.

Library read state is stored outside the bridge vault in `${DATA_DIR}/library-read-state/<vault-hash>.json`. The first Library API read creates a baseline timestamp so historical stock is treated as already seen; newly ingested artifacts become unread until marked read by the UI. Unread status is based on source-aware arrival metadata (`captured_at`/`saved_at` for saved references, `digested_at` for candidates) with stable source dates as fallback, not file modification time, so redigestion, metadata repair, and formatting cleanup do not light up old stock as "New." `/api/library?unread=true` applies the same local read state before filtering, which powers the Library `New` ranking without adding unread flags to reference markdown. `/api/library/unread` returns a boolean shell hint for the top-level Library nav dot.

`pipeline_version` is the **provenance stamp**: the digest/connection/reweave logic is a single versioned skill (`PIPELINE_VERSION` in `src/lib/library/pipeline.ts`), and every durable reference and candidate records the version that produced it in frontmatter, surfaced on `LibraryArtifact`. See [`docs/PIPELINE-VERSIONS.md`](./PIPELINE-VERSIONS.md) for the (non-executable) version registry.

### Citation (entry vs. sources)

A library **entry** is the *content*; the **sources** are the places it was cited from. The same article/video/episode can arrive from more than one source with different URLs (e.g. a podcast episode via its YouTube channel feed *and* the newsletter announcing it). Rather than store these as duplicate entries, one canonical entry records the others as `cited_from` citations:

```typescript
interface Citation {
  source_id: string;
  source_name: string;
  url: string;
  channel?: string;
  at?: string;      // ISO/date this source surfaced the content
  title?: string;   // title as it appeared in that source
}
```

Cross-source merging (content match by YouTube video-id or normalized title) is implemented in `src/lib/library/citations.ts` and wired into ingestion (`processArtifact` folds duplicates into the canonical entry), the `library:dedupe` backfill, and the reader ("· also via …"). Canonical preference: primary content (a YouTube video / direct article) outranks a newsletter announcement (`sourceRank`); connections are **unioned** across merges. This is distinct from `relevance_signals` (why an item is relevant) — `cited_from` is specifically *which other sources referenced the same content*.

`video_duration_seconds` is captured for video sources via the locally-installed `yt-dlp` (server-only `src/lib/library/video-duration.ts`; no API key). It is written during ingestion (`digestArtifact`, gated to `format: video` / video-host URLs / `video_url`) and backfilled onto existing notes by `scripts/library-video-durations.ts`. Cards render it as a duration pill via the pure `formatVideoDuration` helper in `media.ts`.

`source_tags`, `source_collection`, and `source_folder` preserve source-native organization without polluting semantic tags. The Library UI displays these facets as useful chips and exposes them as child filters under each source. Newsletter sender addresses are normalized through `friendlyNewsletterSender()` before display, while `source_folder_id` can retain the raw sender identity. `artifactDisplayTags()` is the shared helper for chips/filter text; callers should not render raw `tags` when they want the user-facing taxonomy.

### ReviewQueueEntry / LibraryReviewQueue

The **"Updated" review lane** (`src/lib/library/review-queue.ts`) isolates pipeline-version evaluation batches from organic ingestion. It is **Hilt-local state, not vault markdown** — the manifest lives at `${DATA_DIR}/library-review-queue/<vault-hash>.json` (the vault hash is `hashId(resolve(vaultPath), 16)`), written atomically.

The queue's data model is **not Library-specific**, so the Phase-2 semantic layer reuses it verbatim via a `kind` parameter (ruling R10): the internal store dir is `reviewQueueDir(kind)` and every public function (`readReviewQueue`/`addToReviewQueue`/`setReviewStatus`/`listPendingReview`/`getActiveBatchNotes`/`removeFromReviewQueue`) takes an optional `kind: "library" | "semantic"` that **defaults to `"library"`** (so existing callers are unchanged). `kind = "semantic"` (`semanticReviewQueueDir()`) writes to the **sibling** `${DATA_DIR}/semantic-review-queue/<vault-hash>.json`, so the two queues never collide. The decimal/integer badge semantics carry straight over.

```typescript
type ReviewQueueStatus = "pending" | "approved" | "rejected";

interface ReviewQueueEntry {
  path: string;            // Vault-relative reference path under review
  pipeline_version: string; // Version that regenerated this item (e.g. "v1.3")
  batch: string;           // Batch label grouping a single evaluation run
  status: ReviewQueueStatus;
  note?: string;           // Optional reviewer note
  added_at: string;        // ISO timestamp
  reviewed_at?: string;    // ISO timestamp set when status changes
}

interface ReviewBatchNote {        // The generation note rendered atop the Updated lane
  version: string;         // Pipeline version that produced the batch (e.g. "v1.3")
  title: string;           // Human name of the generation (the note's `# ` heading)
  markdown: string;        // Brief "what to review / why" body
  created_at: string;      // ISO timestamp
}

interface LibraryReviewQueue {
  version: 1;
  items: Record<string, ReviewQueueEntry>;   // Keyed by artifact id
  batches: Record<string, ReviewBatchNote>;  // Keyed by batch label
}
```

`addToReviewQueue(vaultPath, entries, { batch, note? })` records a regenerated batch; **re-adding an item resets it to `pending`** with a fresh `added_at`, `batch`, and `pipeline_version` (no prior status is preserved), and an optional `note` is stored under `batches[batch]`. `setReviewStatus` stamps `reviewed_at`, `listPendingReview` returns the `pending` set, `removeFromReviewQueue` drops an entry, and `getActiveBatchNotes` returns one note per batch that still has pending items (newest first, annotated with `pending_count`) — `GET /api/library/review` surfaces these as `notes`. A corrupt manifest falls back to a fresh empty baseline. This keeps an explicit, human-reviewable set of "items a new pipeline version touched" — with a card explaining what changed and what feedback is wanted — out of the steady stream of newly ingested artifacts, without ever editing the reference files themselves.

Notes are authored as `docs/review-notes/<version>.md` and carried into the queue at batch-creation by `scripts/library-reweave.ts --review-batch <label> [--review-note <path>]`. See [`docs/PIPELINE-VERSIONS.md`](./PIPELINE-VERSIONS.md) for the integer/decimal versioning convention and the generation cycle.

### RecommendedArtifact

```typescript
interface RecommendedArtifact extends LibraryArtifact {
  why: string;
  worth: number;
  relevance: number;
  substance: number;
  freshness: number;
  lifecycle: "active" | "to_archive" | "archived";
  matched_terms: string[];
}
```

### LibraryOperationalHealth

```typescript
interface LibraryOperationalHealth {
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
    unresolved: number; // Failures whose source has not succeeded since — drives the warning count + ok flag
    last_at: string | null;
    by_source: Array<{ source_id: string; count: number }>;
  };
}
```

A dead letter is **unresolved** only if its source has no `last_success_at` later than the failure's timestamp; transient failures that a later run recovered are treated as self-healed and don't count as warnings (so the health panel doesn't read "N warnings" while every row is green).

## Knowledge Graph Models (System → Graph)

Flag-gated behind `HILT_GRAPH_ENABLED` (`isGraphEnabled()`). The graph is a **derived cache** over the vault (markdown stays canonical). Domain types live in `src/lib/graph/types.ts`.

> **Index-vs-ID gotcha (baked in everywhere):** cosmos.gl `onPointClick` returns the point-array **index**, not a node id, and `setLinks`/`setPointPositions` consume `Float32Array`. The encoder assigns a deterministic index per node; the decoded payload's `nodes[]` sidecar is the index → `GraphNode` (hence index → id/refPath) map the renderer uses for click-through and hover.

### GraphNode / GraphEdge

```typescript
type GraphNodeType =
  | "note" | "reference" | "candidate" | "person"
  | "project" | "north_star" | "library_cluster" | "tag" // tag OFF by default
  | "topic" | "entity"; // semantic overlay (Phase 2) — OFF unless HILT_GRAPH_SEMANTIC

type GraphEdgeKind =
  | "wikilink" | "connection" | "connected_project" | "meeting" | "tag" // tag OFF by default
  // Semantic overlay (Phase 2) — OFF unless HILT_GRAPH_SEMANTIC. `similar`/`co_occurrence`
  // are further off in GLOBAL scope unless `?semanticEdges=1`; LOCAL scope includes them.
  | "item_topic"     // item → emergent topic (item_topics.score)
  | "topic_parent"   // topic hierarchy, directed child → parent (weight 2)
  | "item_entity"    // item → resolved entity (item_entities.salience)
  | "co_occurrence"  // entity ↔ entity, shared-item count
  | "similar";       // item ↔ item, embedding-KNN cosine

interface GraphNode {
  id: string;                  // note:/ref:/cand:/person:/project:/north_star:areas/libcluster:/tag:/topic:/entity:
  type: GraphNodeType;
  label: string;
  refPath: string | null;      // absolute vault path, person slug, or null for synthetic nodes (tag/topic/entity)
  degree: number;
  colorKey: string | null;     // topic→"topic" (fuchsia), entity→"entity" (cyan)
  attrs: Record<string, unknown>;
}

interface GraphEdge {
  id: string;                  // hash(source|target|kind)
  source: string;              // node ids (NOT array indices)
  target: string;
  kind: GraphEdgeKind;
  weight: number;              // wikilink=1, connected_project=1.5, item_topic=score, similar=cosine, etc.
  attrs: Record<string, unknown>;
}
```

The `topic`/`entity` nodes and the five semantic edge kinds are a derived **overlay** written into the same `graph_nodes`/`graph_edges` tables by `src/lib/graph/semantic-overlay.ts` (`buildSemanticOverlay()`/`removeSemanticOverlay()`), reading `semantic.sqlite` via `query.ts` bulk variants (ruling R3). A `topic`/`entity` node carries `source_file = null` (cleared by `type`); `item_topic`/`item_entity` edges carry the owning item's abs path as `source_file` (so a re-digest's `deleteEdgesBySourceFile` wipes them); `co_occurrence`/`similar`/`topic_parent` carry `source_file = null` (cleared by `kind`). `topic` `attrs`: `{ topicId, level, parentId, memberCount, summary, trending, recentCount }`; `entity` `attrs`: `{ entityId, entityType, aliases[], salienceTotal }`. The overlay is fully reversible and the transport ordinals are append-only (`topic`=8, `entity`=9) — no `TRANSPORT_FORMAT_VERSION` bump.

### GraphMeta

Returned by `GET /api/system/graph/meta`. Drives the client first-run state machine and scope/limit choice.

```typescript
type GraphScope = "global" | "local";
type GraphLayoutState = "idle" | "building" | "running" | "frozen" | "stale";

interface GraphMeta {
  enabled: boolean;
  nodeCount: number;
  edgeCount: number;
  tagNodeCount: number;        // reported only; tags never ship in the default payload
  topicNodeCount: number;      // semantic overlay; gate the legend on this + semanticBuilt
  entityNodeCount: number;
  semanticBuilt: boolean;      // true once buildSemanticOverlay() has populated the overlay
  builtAt: string | null;      // null => first-run "building" state
  layoutVersion: number;
  layoutState: GraphLayoutState;
  layoutPhase: string | null;  // coarse first-run progress (null until a build is in flight)
  nodesPlaced: number | null;
  totalNodes: number | null;
  dirty: boolean;
  stale: boolean;
  lastError: string | null;
  truncated?: boolean;
  budgets: {
    mobileMaxNodes: number;
    desktopMaxNodes: number;
    defaultHops: number;
    defaultScope: { desktop: "global"; mobile: "local" };
  };
}
```

### GraphPayload (decoded, in-memory)

The decoded shape of `GET /api/system/graph` (NOT the wire layout — see `encode.ts` / the Binary Transport in the API reference). `positions` and `links` carry array **indices**, index-aligned to `nodes[]`.

```typescript
interface GraphPayload {
  positions: Float32Array;     // [x0,y0, x1,y1, ...] index-aligned to nodes[]
  links: Float32Array;         // [src0,tgt0, ...] node-array INDICES (consumed by cosmos.gl setLinks)
  colorKeys: Uint8Array;       // enum index per node
  nodes: GraphNode[];          // sidecar; index i <-> positions[2i..2i+1]
  truncated: boolean;
}

class GraphFormatError extends Error {} // thrown on magic/version mismatch → client hard-refresh
```

## API Response Types

### DocsTreeResponse

Returned by the `/api/docs/tree` endpoint. Provides the file tree for a given scope.

```typescript
interface DocsTreeResponse {
  root: FileNode;
  scope: string;
  modTime: number;        // Latest modTime across all files (for change detection)
}
```

### DocsFileResponse

Returned by the `/api/docs/file` endpoint. Provides file content and metadata.

```typescript
interface DocsFileResponse {
  path: string;
  content: string | null;  // null for binary files
  isBinary: boolean;
  isViewable: boolean;     // true for markdown, txt, code files
  mimeType: string;
  size: number;
  modTime: number;
}
```

### DocsSaveRequest / DocsSaveResponse

Used by the `/api/docs/file` POST endpoint to save file changes.

```typescript
interface DocsSaveRequest {
  path: string;
  content: string;
  scope: string;  // For validation
}

interface DocsSaveResponse {
  success: boolean;
  modTime: number;
  error?: string;
}
```

## localStorage Keys

Browser-side persistence (limited -- most preferences now server-side).

| Key | Type | Description |
|-----|------|-------------|
| `hilt-home-dir` | `string` | Cached home directory path |

**Note**: View mode, recent scopes, pinned folders, sidebar state, and theme are now stored server-side in `data/preferences.json` to persist across Electron rebuilds.

---

## Chat Models (Chat v1 — Workstream 1)

**File**: `src/lib/chat/types.ts`. Sessions are app state under `DATA_DIR/chat-sessions/<chatId>.json` (never the vault); the Claude CLI owns conversational memory via `--resume`, Hilt persists only the rendered transcript. Store I/O in `src/lib/chat/store.ts` (atomic temp+rename writes, normalize-on-read).

```typescript
type ChatContextRef =
  | { kind: "library"; id: string }
  | { kind: "doc"; path: string }                 // absolute path
  | { kind: "person"; slug: string }
  | { kind: "task"; id: string }                  // v3 task file id (t-...)
  | { kind: "meeting"; path: string }             // vault-relative meeting note path
  | { kind: "loop-item"; loop: string; itemId: string }
  | { kind: "briefing-line"; date: string; anchor: string }
  | { kind: "none" };

interface ChatTraceEvent {
  id: string;
  type: "step" | "tool_call" | "tool_result" | "warning";
  status: "running" | "complete" | "warning" | "error";
  label: string;
  detail?: string | null;
  toolName?: string | null;
  input?: Record<string, unknown> | null;  // summarized — full tool inputs never persisted
  outputSummary?: string | null;
  timestamp: number;
  durationMs?: number | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;                // markdown
  timestamp: number;
  trace?: ChatTraceEvent[];       // on assistant messages
  filesTouched?: string[];        // vault-relative, from Edit/Write/MultiEdit calls
}

interface ChatSession {
  id: string;                     // crypto.randomUUID(); doubles as the filename stem
  context: ChatContextRef;
  contextLabel: string;           // e.g. artifact title — shown as subtitle
  title: string;                  // deterministicTitle(first prompt); renamable via PATCH
  claudeSessionId: string | null; // CLI --resume id; Hilt never writes ~/.claude/projects/
  messages: ChatMessage[];
  status: "idle" | "sending";     // no 'pending' — no approval state in Hilt
  archivedAt: number | null;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
}

// GET /api/chat/sessions row shape
interface ChatSessionSummary {
  id: string;
  context: ChatContextRef;
  contextLabel: string;
  title: string;
  status: "idle" | "sending";
  archivedAt: number | null;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageSnippet: string | null;  // ≤120 chars, whitespace-flattened
}

// NDJSON events streamed by POST /api/chat/message (session is always first)
type ChatStreamEvent =
  | { type: "session"; chatId: string }
  | { type: "trace"; trace: ChatTraceEvent }
  | { type: "message"; content: string }          // per assistant text block, as parsed
  | { type: "complete"; claudeSessionId: string | null }
  | { type: "error"; error: string };
```

---

*Last updated: 2026-06-01*
