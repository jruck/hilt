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

*Last updated: 2026-05-19*
