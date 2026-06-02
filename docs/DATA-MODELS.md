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
}
```

### BridgeWeekly

Parsed representation of a weekly markdown file from the Bridge vault.

```typescript
type BridgeWeeklySection = "accomplishments" | "notes" | "tasks";

interface BridgeWeekly {
  filename: string;        // "2026-01-27.md"
  week: string;            // "2026-01-27" from frontmatter
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
  features?: {
    map: boolean;
    apps: boolean;
    stack: boolean;
    sync: boolean;
  };
  error?: string | null;
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
    inSyncFiles: number;
    inSyncBytes: number;
    needFiles: number;
    needBytes: number;
    pullErrors: number;
    versioning: { enabled: boolean; type: string | null; maxAgeDays: number | null };
    maxConflicts: number | null;
    ignore: { includePresent: boolean; localHash: string | null; sharedHash: string | null };
    conflicts: { count: number; truncated: boolean; files: Array<{ path: string; modifiedAt: string | null; sizeBytes: number | null }> };
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
reweave_candidates?: Array<{ target: string; why: string }>;
connected_projects?: string[];                          // Subset of connection targets matching project-folder slugs
```

Connections are produced only when an artifact will be durably saved (explicit-save sources, or discovery items recommended to `file`); plain review candidates get the summarize-based Summary/Key Points, empty connections, and blank reasoning until promoted or re-judged. Saved references and candidates may include `connection_suggestions`, `connection_reasoning`, and `reweave_candidates` in frontmatter.

The **durable reference body is now a free-form digest**: when `digest_markdown` is present, the model-chosen `##` sections replace the fixed `## Summary` / `## Key Points` template, followed by `## Connections` and `## Raw Content` (and `## Media` when present). Connections render as `- [[target|Title]] - relationship` (the neighbor's human title as the wikilink alias; `- Title - relationship` for a null target); when there are none the section body is empty and reasoning/reweave candidates live in frontmatter. The frontmatter `description` uses `processed.description || processed.summary`. **Candidate** bodies are unchanged — they keep the legacy Summary/Key Points format and render the same `- [[target|Title]] - relationship` shape under `## Suggested Connections`. `connected_projects` remains the compact wiki-target list for filtering and compatibility. New durable references also include precise `captured_at` metadata; `Recent` keeps `created_at` as the source date and uses precise fields such as `captured_at` or `digested_at` only to order items that land on the same source date.

For X/Twitter bookmarks, `title` is source-normalized before file writes: short URLs are removed from human-readable tweet text, URL-only wrappers use an author fallback title, and non-status linked X routes remain `warm`/metadata-limited until a recoverable source body exists. The source URL still lives in `url:` and any cached source stays under `## Raw Content`; titles, descriptions, summaries, and key points should not be raw `t.co` links.

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
  source_id: string | null;
  source_name: string | null;
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
  library_mode: "study" | "keep";
  score: number;
  save_recommendation: "file" | "review" | "skip";
  destination?: string;
  is_unread: boolean;      // Hilt-local read state, not markdown frontmatter
  read_at: string | null;  // ISO timestamp when the current user last marked it read
  connections: string[];
  raw_frontmatter?: {
    thumbnail?: string;
    connection_suggestions?: ConnectionSuggestion[];
    connection_reasoning?: string;
    reweave_candidates?: Array<{ target: string; why: string }>;
  };
}
```

Library read state is stored outside the bridge vault in `${DATA_DIR}/library-read-state/<vault-hash>.json`. The first Library API read creates a baseline timestamp so historical stock is treated as already seen; newly ingested artifacts become unread until marked read by the UI. Unread status is based on source-aware arrival metadata (`captured_at`/`saved_at` for saved references, `digested_at` for candidates) with stable source dates as fallback, not file modification time, so redigestion, metadata repair, and formatting cleanup do not light up old stock as "New." `/api/library?unread=true` applies the same local read state before filtering, which powers the Library `New` ranking without adding unread flags to reference markdown. `/api/library/unread` returns a boolean shell hint for the top-level Library nav dot.

`pipeline_version` is the **provenance stamp**: the digest/connection/reweave logic is a single versioned skill (`PIPELINE_VERSION` in `src/lib/library/pipeline.ts`), and every durable reference and candidate records the version that produced it in frontmatter, surfaced on `LibraryArtifact`. See [`docs/PIPELINE-VERSIONS.md`](./PIPELINE-VERSIONS.md) for the (non-executable) version registry.

`video_duration_seconds` is captured for video sources via the locally-installed `yt-dlp` (server-only `src/lib/library/video-duration.ts`; no API key). It is written during ingestion (`digestArtifact`, gated to `format: video` / video-host URLs) and backfilled onto existing notes by `scripts/library-video-durations.ts`. Cards render it as a duration pill via the pure `formatVideoDuration` helper in `media.ts`.

`source_tags`, `source_collection`, and `source_folder` preserve source-native organization without polluting semantic tags. The Library UI displays these facets as useful chips and exposes them as child filters under each source. Newsletter sender addresses are normalized through `friendlyNewsletterSender()` before display, while `source_folder_id` can retain the raw sender identity. `artifactDisplayTags()` is the shared helper for chips/filter text; callers should not render raw `tags` when they want the user-facing taxonomy.

### ReviewQueueEntry / LibraryReviewQueue

The **"Updated" review lane** (`src/lib/library/review-queue.ts`) isolates pipeline-version evaluation batches from organic ingestion. It is **Hilt-local state, not vault markdown** — the manifest lives at `${DATA_DIR}/library-review-queue/<vault-hash>.json` (the vault hash is `hashId(resolve(vaultPath), 16)`), written atomically.

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
  priority: "must_read" | "recommended" | "interesting";
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
  | "project" | "north_star" | "library_cluster" | "tag"; // tag OFF by default

type GraphEdgeKind =
  | "wikilink" | "connection" | "connected_project" | "meeting" | "tag"; // tag OFF by default

interface GraphNode {
  id: string;                  // note:/ref:/cand:/person:/project:/north_star:areas/libcluster:/tag:
  type: GraphNodeType;
  label: string;
  refPath: string | null;      // absolute vault path, person slug, or null for synthetic nodes
  degree: number;
  colorKey: string | null;
  attrs: Record<string, unknown>;
}

interface GraphEdge {
  id: string;                  // hash(source|target|kind)
  source: string;              // node ids (NOT array indices)
  target: string;
  kind: GraphEdgeKind;
  weight: number;              // wikilink=1, connected_project=1.5, etc.
  attrs: Record<string, unknown>;
}
```

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

*Last updated: 2026-06-01*
