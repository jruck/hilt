# Architecture Reference

This document provides a comprehensive architectural overview of Hilt for AI agents and developers working on the codebase.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Next.js 16 + React 19                                            │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │  Board.tsx (Main Container)                                  │  │  │
│  │  │  ├── ViewToggle (Briefing / Bridge / People / Library / Docs / System) │  │  │
│  │  │  ├── BridgeView (weekly tasks, projects, notes)              │  │  │
│  │  │  ├── LibraryView (unified feed/list reference workspace)       │  │  │
│  │  │  ├── DocsView (markdown file browser + editor)               │  │  │
│  │  │  ├── SystemView (Sessions / Apps / Stack / Sync inspection)  │  │  │
│  │  │  ├── MapView (local/tailnet work/session map)                │  │  │
│  │  │  ├── PeopleView (people, groups, meeting history)            │  │  │
│  │  │  └── LocalAppsView (local/tailnet service monitor)           │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                    │                              │
          HTTP/REST │                    WebSocket │
                    ▼                              ▼
         ┌──────────────────┐           ┌──────────────────┐
         │  Next.js API     │           │  WebSocket Server │
         │  (port 3000)     │           │  (port 3001)      │
         │                  │           │                   │
         │  /api/bridge/*   │           │  EventServer      │
         │  /api/docs/*     │           │  (channel-based   │
         │  /api/claude-    │           │   subscriptions)  │
         │    stack/*       │           │                   │
         │  /api/inbox      │           │  Watchers:        │
         │  /api/folders    │           │  - scope-watcher  │
         │  /api/plans/[x]  │           │  - inbox-watcher  │
         │  /api/preferences│           │  - bridge-watcher │
         └──────────────────┘           └──────────────────┘
                    │                              │
          ┌─────────┴──────────┐                   │
          ▼                    ▼                   ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Bridge Vault    │  │  Local Storage   │  │  Claude Config   │
│  ~/work/bridge/  │  │                  │  │  ~/.claude/       │
│  lists/now/*.md  │  │  data/           │  │  settings.json   │
│  projects/*/     │  │  preferences.json│  │  *.mcp.json      │
│  (read-write)    │  │  inbox.json      │  │  (read for Stack)│
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Framework | Next.js | 16.2.5 | React framework with API routes |
| UI | React | 19.2.3 | Component library |
| Language | TypeScript | 5 | Type safety |
| Styling | Tailwind CSS | 4 | Utility-first CSS |
| Drag & Drop | @dnd-kit | 6.3.1 | Bridge task reordering |
| Rich Text | Tiptap | 3.18 | Bridge task editor (WYSIWYG markdown) |
| Code Viewer | CodeMirror | 6 | Syntax-highlighted code viewing in Docs |
| Editor | MDXEditor | 3.52 | Plan markdown editing |
| Data Fetching | SWR | 2.3.8 | Server state + polling |
| WebSocket | ws | 8.18.3 | Real-time event subscriptions |
| File Watching | chokidar | 5.0 | File system change detection |
| Validation | Zod | 4.2.1 | Schema validation |
| Icons | Lucide React | 0.562 | Icon library |
| Virtualization | @tanstack/react-virtual | 3.13 | Large list rendering in Docs/Stack |

## Directory Structure

```
hilt/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── [[...path]]/        # Catch-all route for scope URLs
│   │   │   └── page.tsx        # Main board page
│   │   ├── layout.tsx          # Root layout (ScopeProvider, EventSocketProvider, ThemeProvider)
│   │   ├── globals.css         # Tailwind + editor styles
│   │   └── api/                # API routes
│   │       ├── bridge/         # Bridge vault operations
│   │       │   ├── weekly/     # Weekly task files
│   │       │   ├── tasks/      # Task CRUD + reorder
│   │       │   ├── projects/   # Project listing + status
│   │       │   ├── people/     # People list + detail
│   │       │   ├── notes/      # Notes section
│   │       │   ├── recycle/    # Week rollover
│   │       │   └── upload/     # File uploads to vault
│   │       ├── docs/           # File browser operations
│   │       │   ├── tree/       # Directory tree
│   │       │   ├── file/       # File read/write
│   │       │   └── raw/        # Raw file serving (images, etc.)
│   │       ├── claude-stack/   # Claude config inspection
│   │       │   ├── route.ts    # Stack discovery
│   │       │   ├── file/       # Config file read/write
│   │       │   └── mcp/        # MCP server details
│   │       ├── inbox/          # Draft prompts (Todo.md)
│   │       ├── inbox-counts/   # Inbox count by scope
│   │       ├── folders/        # Scope browsing + validation
│   │       ├── plans/[slug]/   # Plan file read/write
│   │       ├── preferences/    # User preferences CRUD
│   │       ├── firecrawl/      # URL scraping
│   │       ├── youtube-transcript/ # Video transcripts
│   │       ├── reveal/         # Open in Finder
│   │       ├── cwd/            # Current working directory
│   │       ├── ws-port/        # WebSocket port discovery
│   │       └── chat/config/    # Chat agent configuration
│   ├── components/             # React components
│   │   ├── Board.tsx           # Main container, view routing (274 lines)
│   │   ├── ViewToggle.tsx      # Grouped global tab toggle
│   │   ├── DocsView.tsx        # File browser + editor (296 lines)
│   │   ├── PlanEditor.tsx      # MDXEditor wrapper (166 lines)
│   │   ├── ThemeProvider.tsx    # Theme context
│   │   ├── ThemeToggle.tsx     # Light/dark/system toggle
│   │   ├── bridge/             # Bridge view components
│   │   │   ├── BridgeView.tsx          # Main bridge layout (177 lines)
│   │   │   ├── BridgeTaskEditor.tsx    # Tiptap task editor (441 lines)
│   │   │   ├── BridgeTaskPanel.tsx     # Task list + detail panel (253 lines)
│   │   │   ├── BridgeTaskItem.tsx      # Single task row (190 lines)
│   │   │   ├── BridgeTaskList.tsx      # Sorted task list (129 lines)
│   │   │   ├── BridgeTaskDetail.tsx    # Task detail view (45 lines)
│   │   │   ├── BridgeNotes.tsx         # Notes section (45 lines)
│   │   │   ├── ProjectPicker.tsx       # Project selector (250 lines)
│   │   │   ├── ProjectKanban.tsx       # Project status board (193 lines)
│   │   │   ├── ProjectCard.tsx         # Single project card (115 lines)
│   │   │   ├── WeekHeader.tsx          # Week navigation (143 lines)
│   │   │   └── RecycleModal.tsx        # Week rollover dialog (156 lines)
│   │   ├── people/             # People view components
│   │   │   ├── PeopleView.tsx         # Main people layout (109 lines)
│   │   │   ├── PersonCard.tsx         # Person list card (73 lines)
│   │   │   ├── PersonDetailPanel.tsx  # Person detail panel (112 lines)
│   │   │   └── MeetingEntry.tsx       # Meeting timeline entry (78 lines)
│   │   ├── docs/               # Docs view components
│   │   │   ├── DocsEditor.tsx          # Tiptap markdown editor (522 lines)
│   │   │   ├── DocsContentPane.tsx     # File content display (434 lines)
│   │   │   ├── CodeViewer.tsx          # CodeMirror viewer (215 lines)
│   │   │   ├── DocsFileTree.tsx        # Directory tree (143 lines)
│   │   │   ├── DocsTreeItem.tsx        # Tree node (162 lines)
│   │   │   ├── DocsFallbackView.tsx    # Non-editable files (138 lines)
│   │   │   ├── DocsBreadcrumbs.tsx     # Path breadcrumbs (65 lines)
│   │   │   ├── DocsEditToggle.tsx      # Edit/view mode (48 lines)
│   │   │   ├── CSVTableViewer.tsx      # CSV display (134 lines)
│   │   │   ├── ImageViewer.tsx         # Image display (43 lines)
│   │   │   └── PDFViewer.tsx           # PDF display (45 lines)
│   │   ├── stack/              # Stack view components
│   │   │   ├── StackFileTree.tsx       # Config file tree (525 lines)
│   │   │   ├── StackContentPane.tsx    # Config content display (494 lines)
│   │   │   ├── MCPServerDetail.tsx     # MCP server inspector (488 lines)
│   │   │   ├── PluginDetail.tsx        # Plugin inspector (332 lines)
│   │   │   ├── StackView.tsx           # Main stack layout (284 lines)
│   │   │   ├── StackSummary.tsx        # Overview dashboard (178 lines)
│   │   │   └── CreateFileDialog.tsx    # New config file (170 lines)
│   │   └── ui/                 # Shared UI components
│   │       └── LiveIndicator.tsx       # Animated dot (18 lines)
│   ├── contexts/               # React contexts
│   │   ├── ScopeContext.tsx     # Scope path + view mode (URL-based routing)
│   │   └── EventSocketContext.tsx # WebSocket event subscriptions
│   ├── hooks/                  # Custom React hooks
│   └── lib/                    # Core utilities
│       ├── bridge/             # Bridge vault parsing
│       │   ├── weekly-parser.ts        # Weekly .md file parser (298 lines)
│       │   ├── project-parser.ts       # Project discovery + status (215 lines)
│       │   └── vault.ts                # Vault path resolution (44 lines)
│       ├── claude-config/      # Claude configuration parsing
│       │   ├── mcp-discovery.ts        # MCP server discovery (450 lines)
│       │   ├── plugin-discovery.ts     # Plugin discovery (252 lines)
│       │   ├── types.ts                # Config type definitions (241 lines)
│       │   ├── discovery.ts            # Config file discovery (243 lines)
│       │   ├── parsers.ts              # JSON/JSONC parsing (195 lines)
│       │   ├── writers.ts              # Config file writing (131 lines)
│       │   └── index.ts                # Module exports (5 lines)
│       ├── docs/               # Docs view utilities
│       │   └── wikilink-resolver.ts    # [[wikilink]] resolution (254 lines)
│       ├── db.ts               # Preferences + inbox persistence (373 lines)
│       ├── todo-md.ts          # Todo.md parsing (487 lines)
│       ├── types.ts            # Shared TypeScript interfaces (81 lines)
│       ├── user-config.ts      # User settings loading (56 lines)
│       ├── url-utils.ts        # View URL building/parsing (35 lines)
│       └── chat-types.ts       # Chat type definitions
├── server/
│   ├── app-server.ts           # Web service entrypoint: Next handler + ${basePath}/events upgrade proxy
│   ├── ws-server.ts            # HTTP + EventServer setup, 127.0.0.1-only (239 lines)
│   ├── event-server.ts         # WebSocket event pub/sub (213 lines)
│   └── watchers/               # File system watchers
│       ├── scope-watcher.ts    # Directory tree + file changes (237 lines)
│       ├── inbox-watcher.ts    # Todo.md change detection (202 lines)
│       ├── bridge-watcher.ts   # Bridge vault changes (108 lines)
│       └── index.ts            # Watcher exports (19 lines)
├── electron/                   # Electron native app
│   ├── main.ts                 # Main process, window management, plan watcher
│   ├── preload.ts              # contextBridge API
│   ├── launcher.cjs            # tsx loader for dev
│   ├── types.d.ts              # TypeScript declarations
│   └── tsconfig.json           # Electron-specific config
├── build/                      # Build assets
│   ├── icon.svg                # Source icon
│   ├── icon.icns               # macOS icon
│   └── entitlements.mac.plist  # Code signing entitlements
├── data/                       # Persistent storage (gitignored)
│   ├── preferences.json        # Theme, view mode, working folder, vault path
│   └── inbox.json              # Draft prompts (fallback)
├── scripts/
│   └── generate-icons.mjs      # Icon generation script
└── electron-builder.yml        # Distribution config
```

## Data Flow Patterns

### 1. View Routing Flow

```
URL: /bridge, /people, /briefings, /library, /docs/Users/you/work/project, or /system/sessions
         │
         ▼
[[...path]]/page.tsx (catch-all route)
         │ parseViewUrl() extracts viewMode + scopePath
         ▼
ScopeProvider (ScopeContext.tsx)
         │ Manages scopePath, viewMode state
         │ Handles pushState / popstate for SPA navigation
         ▼
Board.tsx receives context via useScope()
         │ Derives ViewMode: "briefings" | "bridge" | "docs" | "library" | "people" | "system"
         ▼
Conditionally renders:
  - "bridge" → BridgeView
  - "briefings" → BriefingsView
  - "library" → LibraryView
  - "docs"   → DocsView (with scope + search)
  - "people" → PeopleView (scope = person slug for deep links)
  - "system" → SystemView (Sessions / Apps / Stack / Sync modes)
```

Legacy `/map`, `/local-apps`, and `/stack/...` URLs remain valid compatibility entrypoints, but Board treats them as the System top-level view and selects the matching internal mode.

### 2. Bridge View Data Flow

```
Bridge vault (e.g., ~/work/bridge/)
         │
         ├── lists/now/{date}.md      (weekly task files)
         ├── areas/index.md           (North Stars rollup)
         ├── areas/{slug}/index.md    (area goals, standards, projects)
         ├── projects/{slug}/index.md (project definitions)
         └── libraries/*/projects/*/  (nested project areas)
         │
         ▼
GET /api/bridge/weekly
         │ weekly-parser.ts reads current week file
         │ Extracts: tasks, notes, accomplishments, section order, frontmatter, available weeks
GET /api/bridge/areas
         │ area-parser.ts reads areas/index.md + area index files
         │ Extracts: focus lanes, goals, standards, active project links
         ▼
BridgeView.tsx
  ├── WeekHeader (week navigation, recycle button)
  ├── Weekly sections rendered in source-file order
  ├── BridgeTaskPanel
  │   ├── BridgeTaskList (sortable via dnd-kit)
  │   │   └── BridgeTaskItem × N
  │   └── BridgeTaskDetail (selected task editor)
  ├── AreaBoard (Now / Ongoing / Long-Term / Other goal lanes)
  │   └── AreaCard × N (shows area goals, opens backing markdown in Docs)
  ├── ProjectKanban (status columns: considering → doing → done)
  │   └── ProjectCard × N
  └── BridgeNotes (raw markdown notes section)
```

### 3. Docs View Data Flow

```
User navigates to scope folder
         │
         ▼
GET /api/docs/tree?scope={path}
         │ Builds FileNode tree (excludes node_modules, .git, etc.)
         ▼
DocsView.tsx
  ├── DocsFileTree (left sidebar, recursive tree)
  │   └── DocsTreeItem × N (expandable folders, clickable files)
  └── DocsContentPane (right panel)
      │
      ├── Markdown files → DocsEditor (Tiptap WYSIWYG) or read-only render
      ├── Code files → CodeViewer (CodeMirror, syntax highlighted)
      ├── Images → ImageViewer
      ├── PDFs → PDFViewer
      ├── CSVs → CSVTableViewer
      └── Other → DocsFallbackView
```

### 4. System View Data Flow

```
SystemView
         │
         ├── Sessions → MapView using /api/system/sessions/*
         ├── Apps     → LocalAppsView using /api/local-apps*
         ├── Stack    → local StackView or remote read-only Stack inspector
         ├── Sync     → read-only Syncthing health via /api/system/sync*
         └── Graph    → GraphView (cosmos.gl WebGL2) using /api/system/graph*
                        — flag-gated (HILT_GRAPH_ENABLED), tab + branch inert when off
```

System is the parent inspection area. It uses Hilt-to-Hilt peer discovery only: the serving machine asks Tailscale for online peers, probes those peers for `/api/system/machine?scope=local`, and only aggregates machines that identify as Hilt. `HILT_SYSTEM_NETWORK_ENABLED=false` disables peer aggregation while keeping local System inspection available.

Sessions mode keeps a local SQLite Map index on each machine. `/api/system/sessions/graph` queries each peer's local Map graph, namespaces machine/tree/session ids, and returns a normal Map graph with top-level machine nodes. `/api/system/sessions` and `/api/system/sessions/detail` route pagination/history reads back to the machine that owns the selected tree node or session id. This avoids central transcript storage while letting the UI show Xochipilli, Mercury, and future Hilt machines in one session map.

Apps mode reuses the Local Apps monitor and its existing peer aggregation, screenshot cache, and machine grouping.

Stack mode reads each machine's Claude/Codex configuration stack through `/api/system/stack`. Local Stack keeps the existing edit/toggle behavior. Remote Stack is read-only in v1: file previews go through `/api/system/stack/file`, and the remote server validates the requested path against its own discovered stack before reading content.

Sync mode reads local Syncthing through a Hilt-local adapter only. `/api/system/sync?scope=local` reads the serving machine's loopback Syncthing REST API using an API key file, while aggregate `/api/system/sync` asks peer Hilt instances for their own local snapshots. Hilt never exposes the Syncthing API key or proxies arbitrary Syncthing API calls over the tailnet. The adapter caches expensive folder status reads with a short TTL and single-flight refresh. Peer feature flags are treated as discovery hints, not authority: a reachable peer is still probed for `/api/system/sync?scope=local` so a stale `/api/system/machine` response cannot hide a healthy Sync endpoint.

System inspection views share the `SecondaryToolbar` 44px chrome row. `SystemView` owns the mode switcher and passes it into the active mode, so Sessions can place Map filters/diagnostics/refresh beside it, Apps can place machine/app/service freshness beside it, Stack can place machine selection/status beside it, and Sync can place health summary/refresh beside it. Library uses the same toolbar primitive for source visibility, Feed/List density, ranking, counts, and health, keeping secondary navigation height and narrow-width overflow behavior aligned across the newest workspace views. System inspection views also use a client-side stale-while-refresh pattern. Sessions, Apps, Stack, and Sync keep their last successful client snapshot and selection in module memory, render it immediately when the user switches back, and refresh in the background. Refresh failures should not blank the view; they surface as status chrome while stale content remains visible.

### 5. Stack View Data Flow

```
GET /api/claude-stack?scope={path}
         │ discovery.ts scans for Claude config files:
         │   ~/.claude/settings.json (global)
         │   {scope}/.claude/settings.json (project)
         │   *.mcp.json files (MCP configurations)
         │   Plugin directories
         ▼
StackView.tsx
  ├── StackFileTree (left sidebar, config file tree)
  └── StackContentPane (right panel)
      ├── StackSummary (overview: file counts, MCP servers, plugins)
      ├── MCPServerDetail (individual MCP server inspector)
      ├── PluginDetail (individual plugin inspector)
      └── Raw JSON/JSONC config editor
```

### 6. People View Data Flow

```
Bridge vault
         │
         ├── people/{slug}.md          (person/group definitions)
         ├── people/index.md           (slug → description mapping)
         └── meetings/*.md             (Granola meeting summaries)
         │
         ▼
GET /api/bridge/people
         │ people-parser.ts reads index, each person file, matches meetings
         │ Returns: BridgePeopleResponse (flat list of BridgePerson)
         ▼
PeopleView.tsx
  ├── PersonCard × N (list mode, searchable)
  └── PersonDetailPanel (selected person)
      │
      GET /api/bridge/people/{slug}
      │ Returns: PersonDetail (meeting timeline, personFilePath)
      │ PUT /api/bridge/people/{slug}/notes — saves edited inline notes
      │ PUT /api/bridge/people/{slug}/next — saves edited ## Next section
      │
      └── MeetingEntry × N (card with tabs: Written Notes / Summary / Transcript)
          ├── inline notes (from ## Notes ### YYYY-MM-DD sections)
          └── Granola meetings (matched by name tokenization)

URL deep links: /people → list, /people/{slug} → detail
Scope context carries the slug (not a filesystem path)
```

### 7. Map View Data Flow

```
Codex state sqlite + Claude JSONL/JSON files
         │
         ▼
ensureMapIndexFresh(maxAgeMs=15000)
         │ compares source mtimeMs + size
         │ extracts metadata-only title/workspace/activity/path-footprint signals
         ▼
${DATA_DIR}/map.sqlite
         │ normalized metadata only; no raw transcripts
         ├── map_sessions
         ├── map_source_files
         ├── map_overrides
         └── map_checkpoints
         │
         ├── GET /api/map/local/work-graph
         │     returns filtered tree, counts, diagnostics
         ├── GET /api/map/local/sessions
         │     returns paginated session summaries
         └── GET /api/map/local/session-detail
               reads provider history file on explicit click
```

The Map feature is local-first per machine and designed for Tailscale-served access to Hilt-running development machines. Convex/cloud replication is intentionally deferred unless Hilt needs multi-machine collaboration, offline cloud availability, or cross-mothership replication. Browser requests never provide file paths for history reads; the server resolves `sourcePath` from indexed session metadata. Map visibility is classified as `foreground` or `background`: foreground is the default human-legible work view, while background keeps workers, sidechains, unmapped, stale, and automation-like sessions available without letting them dominate the default map.

Map tree specificity comes from both launch workspace and work footprint metadata. Codex/Claude tool calls are scanned for file/folder path signals and summarized into small `workFootprint` entries in session metadata; the tree groups those under workspace-level `folder` nodes so a session launched from a parent repo can still show activity in `src/lib/map`, `apps/web`, or another nested area. Raw tool transcripts stay in provider files and are only read for explicit history previews.

### 8. Local Apps Data Flow

```
macOS TCP listeners
         │
         ├── lsof -nP -iTCP -sTCP:LISTEN -F pcLunPT
         ├── ps process metadata
         ├── git/package project metadata
         └── Tailscale/tailnet URL helpers
         │
         ▼
src/lib/local-apps scanner
         │ classifies services, groups by app/worktree, probes HTTP health
         │ treats package-manager roots like /opt/homebrew as infrastructure
         │ and groups those listeners by service command
         │ redacts process args before API/UI exposure
         │ maintains a cached single-flight snapshot
         ▼
GET /api/local-apps
         │ returns visible app groups, machine identity, diagnostics
         ├── optionally probes tailnet peers for /api/local-apps?scope=local
         │   and includes only peers that identify as hilt-local-apps
         ├── POST /api/local-apps/refresh forces a scan and can wait for fresh
         │   local screenshot capture before returning updated preview metadata
         ▼
LocalAppsView
         └── machine sections with app-first monitor cards, service chips, and open links
```

Local Apps is monitor-only in v1: no stop, kill, restart, or hide/show controls. It is gated by `HILT_LOCAL_APPS_ENABLED=true`. Optional screenshot capture is gated separately by `HILT_LOCAL_APPS_PREVIEWS=true`; preview files live under `${DATA_DIR}/local-apps/previews` and are served only by safe filename through `/api/local-apps/previews/[filename]`. Remote preview images are served through `/api/local-apps/remote-preview`, which proxies only safe filenames from already-discovered Hilt peer machines so an HTTPS Tailscale Serve page never has to embed insecure HTTP image URLs. Preview capture is limited to healthy HTTP services, uses a `1280x720` viewport to match the Apps cards' 16:9 frame, prefers the public/tailnet URL that the UI opens, falls back to local probe URLs, and uses `HILT_LOCAL_APPS_PREVIEW_CACHE_MS` with a 2-minute default. Ordinary `GET /api/local-apps` requests attach cached previews only and never trigger capture. Cached previews are presentation state, not correctness gates: Hilt keeps the last successful PNG attached even when it is stale or a later recapture fails, and records the latest failure on `service.preview.error`/`error_at` instead of replacing the tile with an error fallback. LocalAppsView calls `POST /api/local-apps/refresh` on visible first load, manual refresh, visible tab return when stale, and every two minutes while the page is visible; that refresh can fan out to peer Hilt instances through their own `scope=local` refresh endpoints. Tailnet peer aggregation is Hilt-to-Hilt only: the serving instance uses Tailscale status for machine discovery, then accepts only `/api/local-apps?scope=local` responses that match Hilt's API contract. Discovery tries the peer's Tailscale Serve HTTPS URL plus common Hilt dev ports `3000`-`3004`, because Electron may assign a non-3000 port when another local app is already using it. It does not remotely scrape processes or call Port Authority.

### 9. Real-Time Event Flow

```
WebSocket connection: same-origin `${basePath}/events` (e.g. ws://localhost:3000/events,
wss://xochipilli.tailc0acaa.ts.net/hilt/events via Tailscale Serve) — app-server
proxies the upgrade to the internal ws-server on 127.0.0.1
         │
         ▼
EventSocketProvider (wraps entire app)
         │ Manages single shared WebSocket connection
         ▼
Client subscribes to channels:
  - { channel: "tree", params: { scope } }    → directory changes
  - { channel: "file", params: { scope } }    → file content changes
  - { channel: "inbox", params: { scope } }   → Todo.md changes
  - { channel: "bridge" }                     → vault file changes

Server watchers detect filesystem changes:
  scope-watcher.ts  → chokidar watches scope directory
  inbox-watcher.ts  → chokidar watches Todo.md files
  bridge-watcher.ts → chokidar watches bridge vault

EventServer broadcasts matching events to subscribed clients
         │
         ▼
Components receive events and trigger SWR revalidation
```

### 10. Reference Library Digestion & Connection Data Flow

The digest / connection / reweave logic is a **single versioned skill**: `src/lib/library/pipeline.ts` (which exports `PIPELINE_VERSION` and re-exports the active `REWEAVE_PROMPT` / `CONNECTION_PROMPT` / `DIGEST_PROMPT`) plus the digestion glue in `digestion.ts` / `connections.ts`. Only the current version is runnable — prior versions are recovered from git history, not kept as parallel files. Every ingested item is **stamped** with the version that produced it: `pipeline_version` is written into the durable reference and the candidate frontmatter and surfaced on `LibraryArtifact`, giving each note a provenance trail. On any change to the digest/connection/reweave logic, bump `PIPELINE_VERSION` and add a row to **[`docs/PIPELINE-VERSIONS.md`](./PIPELINE-VERSIONS.md)** (the non-executable version registry; current = `v1.3`, `v1.4` concision pending).

The **"Updated" review lane** isolates evaluation from organic ingestion. When a batch is regenerated by a new pipeline version (e.g. a `library-reweave --write` pass), `src/lib/library/review-queue.ts` records each regenerated item in a Hilt-local manifest under `${DATA_DIR}/library-review-queue/<vault-hash>.json` (a `LibraryReviewQueue` of `ReviewQueueEntry { path, pipeline_version, batch, status, … }`). This keeps a human-reviewable set of pipeline-version evaluation batches separate from the steady stream of newly ingested artifacts — the manifest is Hilt-local state, never written into vault markdown, so re-running a batch resets it to `pending` without touching the reference files themselves.

`src/lib/library/taxonomy.ts` runs before reference/candidate writes. It separates semantic display tags from source-native taxonomy (`source_tags`, `source_collection`, `source_folder`) and classifies each item as `library_mode: "study"` or `"keep"`. Study is the default path for material that should be reviewed, recommended, and woven into Bridge context. Keep is a quiet durable-save path for products, shopping, clothing, furniture, recipes, restaurants, and similar saved-for-later objects; keep items are searchable and durable, but the default Library list hides them and durable-save digestion skips forced connection weaving.

Durable references are produced by a single **reweave** pass: one in-vault, read-only Claude run that both digests the source and discovers its connections. The summarize CLI is narrowed to *extraction* (recovering source text), while the model owns the *shaping* of the note. Plain review candidates stay lightweight — they get the summarize-based digest and no LLM connection spend. The old `suggestArtifactConnections` keyword scorer was removed; `judgeConnections` remains as the offline-safe fallback when reweave can't run.

```
Ingestion adapter → digestion.ts (digestArtifact)
         │ summarize CLI runs first as EXTRACTION ONLY: recover/clean source text
         │ (article body, transcript, X post text). It no longer dictates note shape.
         │ X/Twitter video posts are a special source-capture path: yt-dlp resolves
         │ captions first, then audio transcription, and the transcript becomes the
         │ canonical Raw Content. Wrapper tweet text is context, not source completion.
         │
         │ Reweave runs ONLY for durable saves:
         │   source.intent === "explicit_save"  OR  saveRecommendation === "file"
         │ Plain review candidates get the summarize Summary/Key Points and NO
         │ connections / no reweave LLM spend until promoted or re-judged.
         ▼
buildKbIndex(vaultPath)                         (src/lib/library/kb-index.ts)
         │ Assembles NORTH STARS / PROJECTS / AREAS / PEOPLE / RECENT REFERENCES
         │ (~1.25K tokens). Caches to references/.cache/kb-index.md unless noWrite.
         ▼
reweaveArtifact(kbIndex, { title, sourceContent }, { vaultPath })   (connections.ts)
         │ Spawns the Claude CLI (mirrors judgeConnections' plumbing):
         │   claude -p "<KB index + new reference: title + ~8000-char excerpt>"
         │     --append-system-prompt-file <tmp REWEAVE_PROMPT>
         │     --allowed-tools Read Grep Glob --add-dir <vaultPath>
         │     --output-format json [--model <...>]   (cwd = vaultPath)
         │ Runs IN the vault, READ-ONLY: the model explores projects/, areas/,
         │ thoughts/, libraries/*, references/, people/ with its read tools to
         │ ground the digest and find real connection targets. Default timeout 300s.
         │ Parses with parseReweaveOutput (tolerant: raw JSON, ```json fences, or
         │ embedded JSON; drops empty/.cache/ targets, strips trailing .md).
         │ Returns null on any failure, timeout, LIBRARY_CONNECTIONS_DISABLED=1,
         │ or when no vaultPath resolves — pipeline stays offline-safe.
         ▼
ReweaveResult { description, proposed_title, digest_markdown,
                connections_first_party[], connections_library[],
                reweave_candidates[] }
         │ digestion.ts maps onto ProcessedArtifact:
         │   digest_markdown, description (free-form digest replaces the fixed
         │     Summary/Key Points template); files are NOT auto-renamed.
         │   connection_suggestions = [...first_party, ...library] as
         │     { target, label: title, relationship } (first-party ordered first)
         │   connected_projects = first-party targets under projects/<slug>/
         │   connection_reasoning (short line); reweave_candidates passed through
         │ On null → falls back to judgeConnections + the legacy parseDigestOutput
         │   Summary/Key Points path.
         ▼
references.ts / candidate-cache.ts write markdown
         │ Durable body: free-form digest_markdown + "## Connections" + Raw Content.
         │ Connections render "- [[target|Title]] - relationship" (human title as
         │ wikilink alias; "- Title - relationship" for a null target). Empty body
         │ when no connections; reasoning/reweave_candidates live in frontmatter.
         │ Candidates keep "## Suggested Connections" + the legacy Summary/Key Points.
```

Backfill / re-weaving uses `scripts/library-reweave.ts` (modeled on `library-rejudge-connections.ts`): builds the KB index once and runs `reweaveArtifact` per `type: reference` file (deriving `sourceContent` from the Raw Content cache → Summary → frontmatter description). Dry run by default (prints per-item JSON; `--out-dir` writes a preview, never the vault); `--write` rewrites the body with the digest + `## Connections` + the preserved Raw Content/Media blocks and updates frontmatter (`description`, `connection_reasoning`, `reweave_candidates`, `connection_suggestions`, `reconnected_at`). Items where reweave returns null or an empty digest are skipped untouched. Reweave candidates are surfaced for human review only — Hilt never auto-edits a neighbor note. `scripts/library-rejudge-connections.ts` remains the connections-only pass for the `judgeConnections` fallback path.

Book capture is a manual ingress beside automated sources. The upstream `book-capture` tool handles visible-page capture/OCR/markdown generation for Kindle, Apple Books, Kindle Cloud Reader, and PDFs. Hilt's `library:book:import` command then normalizes the generated markdown into the same file-native Library contract: `references/books/<book>/index.md` is the durable `type: reference`, generated topic files are copied under `topics/`, cover art can be attached as Library media, and the full generated capture plus optional page-level OCR is cached under `references/.cache/book-captures/`. Write imports immediately run the same durable-reference reweave pass as other saved sources so books do not bypass Bridge-aware `connection_suggestions`. This path is intentionally not part of scheduler/backfill because it depends on a visible user-controlled reading source and must stop on app/DRM/screenshot blockers.

### 11. Knowledge Graph Data Flow (System → Graph)

> **Opt-in.** The entire subsystem ships behind `HILT_GRAPH_ENABLED` (`isGraphEnabled()` in `src/lib/graph/config.ts`, the single predicate: `process.env.HILT_GRAPH_ENABLED === "true"`). With the flag off (default) the Graph tab is absent, no graph DB/watcher/build work runs, the four routes 404, and `GraphView`/cosmos.gl stay in dynamic chunks the default bundle never fetches. The graph is a **derived cache** — markdown remains source of truth (Critical Constraint #2). The performance strategy is deliberate: **the renderer is the replaceable half; the data pipeline is the durable investment.** The host does all heavy work (parse → index → precompute layout → serve compact binary); the client loads finished GPU coordinates and freezes at rest.

```
VAULT (~/work/bridge, read-only)
   │  build.ts scans INCLUDED_DIRS (projects/people/meetings/references/
   │  areas/thoughts/lists/now/docs); dotdirs + node_modules excluded;
   │  libraries/ NOT walked (opt-in via HILT_GRAPH_INCLUDE_LIBRARIES,
   │  one library_cluster node per nested sub-vault). Reuses existing
   │  parsers READ-ONLY; wikilink resolver map built ONCE per pass (perf).
   ▼
graph.sqlite (${DATA_DIR}, derived cache — db.ts, mirrors calendar/db.ts:
   │  better-sqlite3, WAL, singleton). Tables: graph_nodes, graph_edges,
   │  node_positions, graph_meta. Node ids: note:/ref:/cand:/person:/
   │  project:/north_star:areas/libcluster:/tag:. Edge kinds: wikilink,
   │  connection, connected_project, meeting, tag. Candidates pulled from
   │  the cache API (never the walker) and carry NO connection edges (leaves
   │  by design). Tags OFF by default (Decision 4 — buildTagLayer() on demand).
   │  buildFullGraph clears+rebuilds in one tx; updateGraphForFile/
   │  removeGraphForFile do incremental delete-by-source_file + 1-hop dirty mark.
   ▼
layout.ts — seeded, deterministic ngraph.forcelayout (Barnes-Hut) run as a
   │  CHUNKED cooperative main-loop (setImmediate yielding; NO worker_threads
   │  in v1), FIXED iteration count (never wall-clock). Warm-start from
   │  persisted (x,y) at the current LAYOUT_VERSION; new nodes seed from the
   │  centroid of placed neighbors. Incremental relayout relaxes only the
   │  dirty seed set + 1-hop and PINS the rest. Single-flight; persists
   │  positions in one tx, marks clean, sets layout_state running → frozen.
   │  Crashed "running" with no in-flight pass self-heals to "stale".
   ▼
encode.ts — canonical BINARY wire format: 32-byte u32 header (magic
   │  0x48474C31, TRANSPORT_FORMAT_VERSION, node/edge counts, flag bits),
   │  Float32 interleaved positions, Uint8 interned color-key enum, Float32
   │  edge INDEX-pairs (the cosmos.gl setLinks type — never Uint32), u32
   │  METALEN + UTF-8 JSON sidecar (ids/labels/interned types/colorKeyTable).
   │  refPaths DROPPED from the bulk sidecar → resolved lazily via /node/:id.
   ▼
GET /api/system/graph (selectGlobalGraph / selectLocalGraph BFS; device
   │  ceilings enforced server-side: desktop=GLOBAL capped at desktopMaxNodes,
   │  mobile=LOCAL capped at mobileMaxNodes — the global buffer is NEVER shipped
   │  to a phone). decode + render in the client.
   ▼
CosmosRenderer.ts (the ONLY @cosmos.gl/graph importer) uploads server coords
   straight into GPU buffers (setPointPositions(.., dontRescale=true), setLinks,
   setPointColors/Sizes) and FREEZES via render() then pause() (enableSimulation
   false). Idle is pure GPU render. GraphView swaps renderers behind the
   renderer-agnostic GraphRenderer interface (WebGPU is a later drop-in).
```

**Incremental updates (server-side, flag-gated).** A long-lived `GraphRunner` (`src/lib/graph/runner.ts`, instantiated by `ws-server` only when the flag is on) hooks the existing vault watchers. BridgeWatcher events trigger a **dir-rescan-by-mtime** (`onDirChanged`) rather than trusting the single collapsed path (BridgeWatcher debounces by type and watches at `depth:2`); a persistent ScopeWatcher client at the vault root covers `references/`+`docs/` (`onFileChanged`/`onFileRemoved`); candidates refresh on an eventual poll; a periodic full mtime reconcile backstops missed drift. The runner coalesces a burst into one debounced scoped relayout of the accumulated dirty seeds plus one notify. `notify.ts touchGraphChanged()` writes a `graph-build-event.json` marker under `DATA_DIR` that `ws-server` watches (mirroring the calendar marker) and broadcasts a `graph` `changed` WS event from; the client subscribes to the `graph` channel and refetches, with a 10s `/meta` poll fallback when the socket is down.

**Device budgets & deep-links.** `device-budget.ts` maps device-class → `GraphBudget` (Electron → desktop GLOBAL; coarse-pointer small viewport → mobile LOCAL with DPR clamped to 1.0, `allowGlobal: false`, `maxHops: 2`). The scope grammar is **path-segment only** (no query strings — `navigateTo(mode, scope)` builds `/${mode}${scope}`), defined once in `src/components/graph/graph-deeplink.ts` (`buildGraphScope`/`parseGraphScope`). A "Show in graph" affordance in Docs / People / Library detail views deep-links into `/system/graph/focus/<encoded-id>` — the reciprocal of node click-through.

### 12. Semantic Knowledge Layer (Phase 2 — `semantic.sqlite`)

The **third derived cache** (`src/lib/semantic/`, flag-gated `HILT_SEMANTIC_ENABLED`) layers continuous semantic analysis over the same vault scope the graph walks: embeddings (gemini-embedding-001@1536), Flash-extracted typed entities, and an emergent hierarchical topic taxonomy. It surfaces the serendipitous through-lines explicit wikilinks structurally can't (the `semantic` CLI + `/api/system/semantic/*` routes + the graph overlay). It is a **pure derived cache** — `rm semantic.sqlite*` + a cold-start rebuilds it — with `foreign_keys=ON` (ruling R4) for cascade-on-item-delete.

**Versioning is a backfill, not a migration.** `SEMANTIC_VERSION` (the Library `PIPELINE_VERSION` integer/decimal scheme) stamps every derived row; a model/prompt bump writes new-version rows **alongside** the prior baseline (coexistence) until blessed, then `gcStaleVersions()` (the `semantic:gc` job) drops the superseded rows. `active_version` in `semantic_meta` is what queries default to. `SEMANTIC_DB_FORMAT_VERSION` is orthogonal (the `LAYOUT_VERSION` precedent): a lagging on-disk `db_format_version` discards and rebuilds the whole cache file on open — a schema/wire change invalidates independently of a model upgrade. The decimal sample lane is reviewed in the **sibling** semantic review queue (`reviewQueueDir("semantic")`, ruling R10), carrying a `docs/semantic-review-notes/<version>.md` note.

**Three cadences.** (1) The **cold-start backfill** (`scripts/semantic-backfill.ts`, `semantic:backfill:cold`) embeds/extracts/clusters the whole corpus once and blesses the baseline. (2) The **SemanticRunner** (`src/lib/semantic/runner.ts`) is the incremental path — structurally a copy of `GraphRunner`, instantiated by `ws-server` only when `isSemanticEnabled()` (dynamic `import()` so the flag-off path never loads it; `ws-server` boots fully inert with the flag off). It keeps a `source_file → content_hash` map, reuses the same BridgeWatcher/ScopeWatcher signals, and on a change embeds the item (one embed call), extracts + resolves its entities, and slots it into the nearest **existing** leaf topic by cosine — **never re-clustering**. A debounce (`SEMANTIC_INCREMENTAL_DEBOUNCE_MS`, 2s) + single-flight + queued-rerun coalesces an edit burst; a 5-min content-hash reconcile self-heals; the scope guard excludes `libraries/` + dotdirs. (3) The **balanced weekly re-fit** (`semantic:refit`) is the heavy launchd job that re-clusters with a warm start and records `topic_lineage`. The `com.hilt.semantic.*` launchd family (cold-start / refit / gc) installs via `scripts/semantic-scheduler.ts`, which reuses the shared `scripts/launchd-scheduler.ts` plist/launchctl helper that the Library scheduler also calls (R10); the scheduled scripts short-circuit on the flag so a stray plist is a no-op.

## State Management

| State | Location | Persistence | Purpose |
|-------|----------|-------------|---------|
| Theme preference | `data/preferences.json` | Server JSON | Light/dark/system |
| View mode | `data/preferences.json` + URL | Server JSON + URL | Briefing/Bridge/People/Library/Docs/System |
| Bridge vault path | `data/preferences.json` | Server JSON | Path to bridge vault |
| Working folder | `data/preferences.json` | Server JSON | Default scope for all views |
| Draft prompts | `Todo.md` / `data/inbox.json` | Local files | Queued prompts |
| Source list | `${DATA_DIR}/sources.json` | Server JSON | Local/remote Hilt sources; rank order controls startup and fallback |
| Granola sync index | `${DATA_DIR}/granola-sync.sqlite` | SQLite | Granola document/linkage state and operational sync timing (`last_synced_at`); Bridge markdown stores durable document/calendar provenance only |
| Map index | `${DATA_DIR}/map.sqlite` | SQLite | Local Codex/Claude session metadata, source scan status, overrides |
| Local Apps settings/previews | `${DATA_DIR}/local-apps/` | Server JSON + PNG cache | Local service monitor settings and optional screenshots |
| Graph index | `${DATA_DIR}/graph.sqlite` | SQLite (derived cache) | Nodes/edges/positions/meta for System → Graph (flag-gated; markdown stays canonical) |
| Semantic index | `${DATA_DIR}/semantic.sqlite` | SQLite (derived cache) | Items/chunks/embeddings/entities/topics/lineage for the Phase-2 Semantic Knowledge Layer (flag-gated `HILT_SEMANTIC_ENABLED`; `foreign_keys=ON`; markdown stays canonical) |
| Semantic review queue | `${DATA_DIR}/semantic-review-queue/<vault>.json` | Server JSON | Sibling of the Library review queue — the semantic sample/decimal lane (ruling R10) |
| Reweave attempt counts | `${DATA_DIR}/library-reweave-attempts/<vault>.json` | Server JSON | Per-item failure counts for the nightly reweave drain — repeat-failers sink to the back of the bounded worklist; cleared on success, pruned when items leave the backlog (operational state, never vault markdown) |
| Briefing markdown | `briefings/YYYY-MM-DD.md`, `briefings/weekend/YYYY-MM-DD.md` | Bridge vault markdown | Weekday daily briefings plus Saturday-start weekend editions; weekend ids use `weekend:YYYY-MM-DD` in Hilt |
| Briefing run status | `~/.hermes/cron/jobs.json` + `~/.hermes/cron/output/` | Read-only Hermes files | Same-day failed weekday Morning Briefing detection when no `briefings/YYYY-MM-DD.md` exists; retry watcher status is read separately from the real generator job |
| Scope path | URL + ScopeContext | URL state | Current folder scope |

## API Routes

| Route | Method | Purpose | Key Params |
|-------|--------|---------|------------|
| `/api/bridge/weekly` | GET | Get weekly tasks + notes | - |
| `/api/bridge/tasks` | GET | List tasks | - |
| `/api/bridge/tasks` | POST | Create task | `title` |
| `/api/bridge/tasks/[id]` | PATCH | Update task | `title`, `done`, `details` |
| `/api/bridge/tasks/[id]` | DELETE | Delete task | - |
| `/api/bridge/tasks/reorder` | POST | Reorder tasks | `activeId`, `overId` |
| `/api/bridge/projects` | GET | List projects by status | - |
| `/api/bridge/projects/status` | PUT | Update project status | `projectPath`, `status` |
| `/api/bridge/notes` | GET/PUT | Read/write notes section | `content` |
| `/api/bridge/recycle` | POST | Roll over to new week | - |
| `/api/bridge/upload` | POST | Upload file to vault | multipart |
| `/api/bridge/briefings` | GET | List daily and weekend briefing markdown plus same-day daily Hermes failure row | - |
| `/api/bridge/briefings/[date]` | GET | Read briefing markdown by id or failed daily Hermes run payload | `date` / `weekend:date` id |
| `/api/bridge/briefings/link-target` | GET | Resolve briefing links to native Hilt destinations | `href`, `date` |
| `/api/bridge/briefings/retry` | POST | Queue existing Hermes Morning Briefing cron job | daily `id` or `date` |
| `/api/bridge/people` | GET | List people + groups | - |
| `/api/bridge/people/[slug]` | GET | Person detail + meetings | `slug` |
| `/api/bridge/people/[slug]/notes` | PUT | Update dated notes section | `slug`, `date`, `notes` |
| `/api/docs/tree` | GET | Directory tree | `scope` |
| `/api/docs/file` | GET/PUT | Read/write file | `path`, `scope`, `content` |
| `/api/docs/raw` | GET | Raw file serving | `path` |
| `/api/claude-stack` | GET | Stack discovery | `scope` |
| `/api/claude-stack/file` | GET/PUT | Config file read/write | `path` |
| `/api/claude-stack/mcp` | GET | MCP server details | `scope` |
| `/api/map/local/work-graph` | GET | Indexed local Map tree + counts | `window`, `status`, `source`, `q` |
| `/api/map/local/sessions` | GET | Paginated indexed session summaries | `nodeId`, `cursor`, `limit` |
| `/api/map/local/session-detail` | GET | Explicit read-only history preview | `id`, `limit` |
| `/api/map/local/refresh` | POST | Force Map index scan | - |
| `/api/map/local/source-status` | GET | Latest Map scan diagnostics | - |
| `/api/system/machine` | GET | Local System machine identity | `scope` |
| `/api/system/machines` | GET | Local + Hilt peer machine list | `scope` |
| `/api/system/sessions/graph` | GET | Cross-machine Map graph | `window`, `status`, `source`, `q` |
| `/api/system/sessions` | GET | Cross-machine session summaries | `nodeId`, `cursor`, `limit` |
| `/api/system/sessions/detail` | GET | Cross-machine session history preview | `id`, `limit` |
| `/api/system/sessions/refresh` | POST | Refresh local/peer Map indexes | - |
| `/api/system/stack` | GET | Local + peer Stack snapshots | `project`, `scope` |
| `/api/system/stack/file` | GET | Stack file preview with discovered-path validation | `machine`, `path`, `project`, `scope` |
| `/api/system/sync` | GET | Local + peer Syncthing sync snapshots | `scope`, `force` |
| `/api/system/sync/conflicts` | GET | Local + peer sync conflict files | `folder`, `scope`, `force` |
| `/api/system/graph` | GET | Binary graph payload (flag-gated) | `scope`, `node`, `hops`, `limit`, `includeTags`, `includeIsolated`, `fmt` |
| `/api/system/graph/meta` | GET | Graph build/layout meta + budgets (flag-gated) | - |
| `/api/system/graph/node/[id]` | GET | Single node + edges + lazy `refPath` (flag-gated) | `id` |
| `/api/system/graph/rebuild` | POST | Full rebuild + relayout, single-flight (flag-gated) | `fullLayout`, `bumpLayoutVersion` |
| `/api/local-apps` | GET | Cached local service monitor snapshot | - |
| `/api/local-apps/refresh` | POST | Force local scan and optional screenshot recapture | `scope`, `previews` |
| `/api/local-apps/settings` | GET | Local Apps settings metadata | - |
| `/api/local-apps/previews/[filename]` | GET | Safe PNG preview serving | `filename` |
| `/api/local-apps/remote-preview` | GET | Safe known-peer PNG preview proxy | `machine`, `filename` |
| `/api/inbox` | GET | List draft prompts | `scope` |
| `/api/inbox` | POST | Create draft | `prompt`, `projectPath` |
| `/api/inbox` | PATCH | Update draft | `id`, `prompt` |
| `/api/inbox` | DELETE | Delete draft | `id` |
| `/api/inbox-counts` | GET | Draft count by scope | `scope` |
| `/api/folders` | GET | List subfolders / validate | `path`, `validate` |
| `/api/plans/[slug]` | GET/PUT | Plan file read/write | `content` |
| `/api/preferences` | GET/PATCH | User preferences | `key`, `value` |
| `/api/reveal` | POST | Open in Finder | `path` |
| `/api/cwd` | GET | Current working directory | - |
| `/api/firecrawl` | POST | Scrape URL | `url` |
| `/api/youtube-transcript` | GET | Get video transcript | `videoId` |
| `/api/ws-port` | GET | WebSocket port | - |
| `/api/chat/config` | GET | Chat agent config | - |

## WebSocket Protocol

**Server**: internal ws-server on `127.0.0.1` (dynamic port in `~/.hilt-ws-port`), reached by clients as **same-origin `${basePath}/events`** — `server/app-server.ts` owns the HTTP origin (`:3000`) and splices `/events` upgrades through to it. Remote devices connect only via the authenticated Tailscale Serve origin; the raw ws port is never exposed off-box. `/navigate` remains a localhost-only POST on the internal server.

The WebSocket server uses a channel-based pub/sub model via `EventServer`. Clients subscribe to channels with optional filter parameters, and the server broadcasts matching events.

### Client -> Server Messages

```typescript
// Subscribe to a channel
{ type: "subscribe", channel: "tree" | "file" | "inbox" | "bridge", params?: { scope: string } }

// Unsubscribe from a channel
{ type: "unsubscribe", channel: string }

// Keepalive
{ type: "ping" }
```

### Server -> Client Messages

```typescript
// Connection established
{ type: "connected", clientId: string }

// Subscription confirmed
{ type: "subscribed", channel: string }

// Unsubscription confirmed
{ type: "unsubscribed", channel: string }

// Keepalive response
{ type: "pong" }

// Event broadcast (channel-specific)
{ channel: "tree", event: "changed", data: { scope, type, path, relativePath } }
{ channel: "file", event: "changed", data: { scope, path, relativePath } }
{ channel: "inbox", event: "changed", data: { scope } }
{ channel: "bridge", event: "weekly-changed" | "projects-changed" | "people-changed", data: {} }

// Error
{ type: "error", message: string }
```

## Component Hierarchy

```
Board.tsx (274 lines)
├── State: scopePath, viewMode, workingFolder, searchQuery
├── Contexts: useScope (ScopeContext)
│
├── Floating Navigation Chrome
│   ├── Search input
│   ├── ThemeToggle
│   └── ViewToggle ([Briefing / Bridge / People / Library / Docs / System]) — centered
│
├── Main Content (conditional on viewMode)
│   ├── viewMode === "bridge"
│   │   └── BridgeView
│   │       ├── WeekHeader (week selector, recycle trigger)
│   │       ├── BridgeTaskPanel
│   │       │   ├── BridgeTaskList (dnd-kit sortable)
│   │       │   │   └── BridgeTaskItem × N
│   │       │   └── BridgeTaskDetail → BridgeTaskEditor (Tiptap)
│   │       ├── ProjectKanban
│   │       │   └── ProjectCard × N (grouped by status columns)
│   │       └── BridgeNotes
│   │
│   ├── viewMode === "docs"
│   │   └── DocsView
│   │       ├── DocsFileTree (sidebar)
│   │       │   └── DocsTreeItem × N (recursive)
│   │       └── DocsContentPane
│   │           ├── DocsEditor (Tiptap, for markdown)
│   │           ├── CodeViewer (CodeMirror, for code)
│   │           ├── ImageViewer / PDFViewer / CSVTableViewer
│   │           └── DocsFallbackView (binary / unknown)
│   │
│   ├── viewMode === "stack"
│   │   └── StackView
│   │       ├── StackFileTree (sidebar, config files)
│   │       └── StackContentPane
│   │           ├── StackSummary (overview dashboard)
│   │           ├── MCPServerDetail (MCP inspector)
│   │           ├── PluginDetail (plugin inspector)
│   │           └── CreateFileDialog (new config)
│   │
│   ├── viewMode === "map"
│   │   └── MapView
│   │       ├── compact activity/status/source toolbar
│   │       ├── treemap work graph
│   │       ├── paginated session list
│   │       └── explicit history preview
│   │
│   ├── viewMode === "people"
│       └── PeopleView (URL: /people or /people/{slug})
│           ├── PersonCard × N (list, searchable)
│           └── PersonDetailPanel (selected person)
│               └── MeetingEntry × N (inline notes + Granola meetings)
│
│   ├── viewMode === "library"
│   │   └── LibraryView (URL: /library)
│   │       ├── Unified controls (Sources, Feed/List, Recent/For You, count, health)
│   │       ├── SourceNav (optional filter rail: Status + Sources)
│   │       ├── FeedCard stream or ArtifactList density
│   │       ├── Library read state (${DATA_DIR}/library-read-state, baseline + per-id read_at)
│   │       ├── Persisted source/content resize handles on desktop
│   │       ├── LibraryArtifactDetailPane (rendered summary/cache/source reader; selection-driven)
│   │       ├── LibraryHealthPanel (/api/library/health scheduler/source/dead-letter state)
│   │       ├── Library APIs (/api/library/*, /api/search)
│   │       └── Source runner API/CLI (manual Check sources, auth verification, dry-run canaries, scheduled ingestion)
│
│   └── viewMode === "local-apps"
│       └── LocalAppsView
│           ├── machine/scan status toolbar
│           └── app-first service cards
```

## Data Models

### FileNode (Docs View)

```typescript
interface FileNode {
  name: string;           // Display name (e.g., "README.md")
  path: string;           // Absolute path
  type: "file" | "directory";
  children?: FileNode[];  // Only for directories
  extension?: string;     // e.g., "md", "ts", "png"
  size?: number;          // File size in bytes
  modTime: number;        // Unix timestamp (ms)
  ignored?: boolean;      // True for system folders, cloud sync, etc.
}
```

### BridgeTask

```typescript
interface BridgeTask {
  id: string;              // "task-0", "task-1", ...
  title: string;           // Display text (no markdown link syntax)
  done: boolean;           // [x] vs [ ]
  details: string[];       // Indented sub-bullet lines (raw markdown)
  rawLines: string[];      // All lines in this task block
  projectPath: string | null;  // Relative path from vault root
}
```

### BridgeWeekly

```typescript
interface BridgeWeekly {
  filename: string;        // "2026-01-27.md"
  week: string;            // "2026-01-27" from frontmatter
  needsRecycle: boolean;   // Current date in newer ISO week
  sectionOrder: ("accomplishments" | "notes" | "tasks")[];
  tasks: BridgeTask[];
  accomplishments: string;
  notes: string;           // Raw markdown of ## Notes section
  vaultPath: string;       // Absolute path to vault root
  filePath: string;        // Absolute path to the weekly .md file
  availableWeeks: string[];// All weeks in lists/now, newest first
  latestWeek: string;      // The most recent week
}
```

### BridgeProject

```typescript
type BridgeProjectStatus = "considering" | "refining" | "doing" | "done";

interface BridgeProject {
  slug: string;            // Folder name
  path: string;            // Absolute path to project folder
  relativePath: string;    // Path relative to vault root
  title: string;           // H1 from index.md, or folder name fallback
  status: BridgeProjectStatus;
  area: string;
  tags: string[];
  source: string;          // Display group (e.g., "Projects", "EverPro")
}
```

### UserPreferences

```typescript
interface UserPreferences {
  theme: "light" | "dark" | "system";
  viewMode: "briefings" | "bridge" | "docs" | "library" | "map" | "people" | "stack" | "system";
  inboxPath?: string;
  bridgeVaultPath?: string;
  workingFolder?: string;
  chatAgent?: string;
  chatSessionKey?: string;
}
```

## Constraints & Gotchas

### 1. Plan Files Location
- Stored in `~/.claude/plans/{slug}.md`
- Electron main process watches this directory for changes
- Sends IPC events (`plan:created`, `plan:updated`) to renderer

### 2. Bridge Vault Structure
- Weekly files: `{vault}/lists/now/{YYYY-MM-DD}.md`
- Projects: `{vault}/projects/{slug}/index.md`
- Nested areas: `{vault}/libraries/{area}/projects/{slug}/index.md`
- People: `{vault}/people/{slug}.md` (person/group files), `{vault}/people/index.md` (descriptions)
- Meetings: `{vault}/meetings/*.md` (Granola summaries), `{vault}/meetings/transcripts/*.md`
- Vault path configured in preferences (`bridgeVaultPath`)

### 3. Scope Context and URL Routing
- Scope (tree root) always equals the working folder — no scope switching
- URLs encode view mode and selection: `/bridge`, `/people`, `/briefings`, `/library`, `/docs/path/to/selected/file`, `/system/...`, `/stack/...`
- The URL path after `/docs/` represents the *selected file* for deep linking, not the tree root
- `ScopeContext` manages scope + view state, syncs with browser history
- `replaceViewMode` used for initial redirect (no history entry)
- `navigateTo` for atomic view + scope changes (single history entry)
- People view reuses scope for deep links: `/people/amrit` → scope is `/amrit` (slug, not filesystem path)
- Board skips filesystem validation for views that don't use file scopes (bridge, briefings, library, people)

### 4. dnd-kit Usage
- Bridge: task reordering within the weekly task list
- Uses `@dnd-kit/core` + `@dnd-kit/sortable`

### 5. Real-Time Events Architecture
- Single WebSocket connection shared via `EventSocketProvider` context
- Channel-based subscriptions with scope filtering
- Watchers use chokidar and are per-client (start/stop on subscribe/unsubscribe)
- Bridge watcher is global (always watching vault directory)

### 6. Ports
- Next.js: 3000 (configurable via PORT)
- WebSocket: 3001 (configurable via WS_PORT)
- All servers start together via `npm run dev:all`
- Lock file (`~/.hilt-server.lock`) prevents duplicate WS servers

### 7. Electron Wrapper
- macOS native app with hidden title bar (traffic light buttons)
- Renderer marks app-region drag areas: desktop top statusbar, mobile Electron titlebar reservation, and empty space in the mobile bottom nav pill
- Manages Next.js and WS server as child processes
- Startup activity tracking with loading screen
- Keyboard shortcuts: Cmd+[ / Cmd+] for history back/forward
- Trackpad swipe gestures for navigation
- Plan file watcher sends IPC events to renderer
- No PTY or terminal IPC handlers
- In development: tsx loader runs TypeScript directly
- In production: Embedded Next.js standalone server
- Uses custom data directory via `DATA_DIR` env (`~/Library/Application Support/hilt/data`)
- macOS hardened runtime with entitlements for code signing
- The daily-driver `dist/Hilt.app` uses a native Mach-O `Contents/MacOS/launcher`
  stub generated by `scripts/create-dev-app.sh`, which then execs
  `Contents/MacOS/launcher.sh` for the PATH/project-resolution logic. Keeping
  `CFBundleExecutable` native avoids LaunchServices showing a Rosetta prompt on
  Apple Silicon systems that do not have Rosetta installed.
- The daily-driver app is a **source launcher**, not a standalone distribution
  bundle: it must live at `dist/Hilt.app` inside a complete local checkout. The
  shell helper resolves the project relative to the app bundle, refuses `/Volumes`
  checkouts, prefers the Node major declared in `.nvmrc` (Node 22), and fails fast
  when Electron or native modules are missing. `npm run doctor:local` checks the
  local runtime/dependency prerequisites, and `npm run verify:desktop` checks the
  generated app bundle and Electron/native launcher architecture.

**Daily-driver server modes (dev vs prod).** The server mode is **runtime state**, not a
launch decision: `${DATA_DIR}/app-mode.json` (the UI's durable choice) wins over the
`HILT_APP_MODE` env the `.app` launcher bakes (`npm run app` → dev default, `npm run
app:prod` → prod default — both create the same bundle; the env only seeds a fresh
install). Dev mode spawns the dev app-server (hot reload, React development mode); prod
mode spawns the production app-server against a build in **`.next-prod`** — its own dist
dir via `HILT_DIST_DIR`, so builds never fight a dev server over `.next`. Prod is the
recommended daily driver: React production mode renders roughly twice as fast and ships
minified bundles.

*Switching from the UI — the supervisor protocol (`docs/plans/supervisor-v1.md`).* The
SourceToggle dropdown shows a mode badge for the server the window is connected to
(`dev` / `prod · built 2h ago`, self-reported via `GET /api/system/app-server` and folded
into the System machine identity payload as `app_server`). Supervision is reported by the
**server**, not inferred by the window: a supervisor (Electron when it spawned the
children, or the headless daemon below) writes a heartbeat to
`${DATA_DIR}/app-supervisor.json` every 30s; `supervised` is true only while the
heartbeat is ≤90s old with a live pid. When true, the dropdown offers the switch — for
local **and remote** sources alike: the UI POSTs same-origin
`/api/system/app-mode`, the route writes `${DATA_DIR}/app-mode-intent.json` on the
serving machine, and that machine's supervisor performs the swap. The window then polls
`/api/system/app-server` until `mode` flips and reloads itself (a dev↔prod swap changes
the client bundle; remote viewers can't be reloaded by the supervisor). Switching to dev
kills the current child and respawns the dev server **on the same port** (~5–15s, first
compile included). Switching to prod always **rebuilds first** (the current server keeps
serving during the ~30s build — after a dev session the prod build is stale by
definition), then swaps (~1s). If the new mode's server fails to come up, the supervisor
auto-reverts to the previous mode so the server is never left dead. All transitions share
a single-flight guard with the rebuild watcher. There is exactly one switch mechanism —
the former Electron-IPC path was removed. Security note: `/api/system/app-mode` is
tailnet-reachable (unlike loopback-only `/navigate`) — accepted as single-user,
non-destructive, and auto-reverting.

*The headless supervisor (`server/supervisor.ts`, `com.hilt.supervisor`).* On server
machines (the Mini), the serving stack runs as an appliance: a ~500-line tsx daemon under
a KeepAlive LaunchAgent owns app-server (:3000) + ws-server (:3100; events, file
watchers, Calendar sync, and Granola sync),
restarts crashed children with capped exponential backoff, detects **wedged** servers
(live pid, ~4 consecutive failed HTTP probes after a 90s startup grace) and restarts
them, acts on mode intents and rebuild stamps exactly like Electron-as-supervisor
(a stamp written by a switch's own rebuild is absorbed, never double-restarted),
persists its children's pids (`app-supervisor-children.json`) so a supervisor crash
**re-adopts** still-healthy children instead of double-spawning (with one policy check:
when `HILT_GRANOLA_SYNC_DAEMON=1`, ws-server adoption requires a fresh Granola daemon
heartbeat with a live pid), and **stands by**
without fighting when an external healthy Hilt (e.g. a terminal dev session) owns the
port — claiming it when it goes away. A dev TTL (`HILT_SUPERVISOR_DEV_TTL_HOURS`,
default 12, 0 disables) returns a forgotten dev switch to prod automatically. Env knobs:
`HILT_SUPERVISOR_PORT` (default 3000), `HILT_SUPERVISOR_CHILDREN` (default
`appServer,wsServer`; scratch/test instances set `appServer` to avoid the machine's
singleton ws-server lock). The wrapper (`scripts/hilt-supervisor.sh`) sets the same PATH
discipline as the .app launcher (Homebrew before /usr/local, nvm wins) because launchd hands agents a
minimal environment — the exact trap that broke Mercury's spawns — and exports
`HILT_GRANOLA_SYNC_DAEMON=1` by default so the supervised ws-server keeps meeting-note
sync alive after reboot/cutover. Install/uninstall/status via
`npm run supervisor:install|uninstall|status`; status also reports the Granola daemon
heartbeat. Electron apps launched on a daemon-supervised machine find the existing
server and attach as pure viewers.

**Known same-checkout constraints (accepted, by design after the Mini cutover):**
(1) `npm run rebuild` (`next build`, even with `HILT_DIST_DIR=.next-prod`) damages a
RUNNING `next dev` instance sharing the checkout — Next rewrites/deletes parts of
`.next/dev` (observed twice live: `required-server-files.json` ENOENT, every dynamic
route 500s until the dev server restarts). The supervisor topology is immune (its prod
server reads `.next-prod`; its dev child is replaced by the switch that triggered the
build), but **do not run a terminal `next dev` beside rebuilds**. (2) Next's dev-server
singleton lock is keyed on the default `.next` dir, so the supervisor's dev mode cannot
start while another `next dev` runs from the same checkout — the switch fails readiness
and auto-reverts to prod. Both disappear once the only server on the machine is the
supervisor's.

*The rebuild loop (prod mode).* `npm run rebuild` (~30s) builds into `.next-prod` and
touches `.next-prod/.hilt-rebuild-stamp` as the build-complete signal (BUILD_ID is
written mid-build and can't be trusted). The running Electron main watches the stamp,
restarts only its owned Next.js children on their existing ports
(`spawnSourceServerProcess`/`spawnPrimaryServerProcess` are shared between startup and
restart), and reloads the window — the Electron wrapper itself never restarts. A stamp
change while in dev mode is deliberately ignored (the refreshed build is picked up on
the next switch to prod). Electron-side changes (`electron/*.ts`) still require
re-running `npm run app` / `app:prod`. If prod mode is active but `.next-prod/BUILD_ID`
is missing, startup falls back to the dev server with a console warning. Note: prod
builds inline `next.config.ts` `env` flags (graph/semantic) at build time — flipping
those in `.env*` requires a rebuild, not just an app relaunch.

### 8. Preferences Migration
- `data/preferences.json` stores all user state server-side
- Legacy `viewMode` values ("board", "tree") may exist but default to "bridge"
- Working folder defaults to `~/work/bridge` if unset

## File Index

### Core Libraries (src/lib/)

| File | Lines | Purpose |
|------|-------|---------|
| `todo-md.ts` | 487 | Todo.md parsing, section extraction |
| `db.ts` | 373 | Preferences + inbox JSON persistence |
| `bridge/weekly-parser.ts` | 298 | Weekly .md file parser |
| `bridge/project-parser.ts` | 215 | Project discovery + status updates |
| `bridge/people-parser.ts` | 359 | People + meeting parsing, name matching |
| `bridge/vault.ts` | 44 | Vault path resolution |
| `claude-config/mcp-discovery.ts` | 450 | MCP server discovery + parsing |
| `claude-config/plugin-discovery.ts` | 252 | Plugin discovery |
| `claude-config/discovery.ts` | 243 | Config file discovery |
| `claude-config/types.ts` | 241 | Config type definitions |
| `claude-config/parsers.ts` | 195 | JSON/JSONC parsing |
| `claude-config/writers.ts` | 131 | Config file writing |
| `docs/wikilink-resolver.ts` | 254 | [[wikilink]] resolution for markdown |
| `graph/build.ts` | 1075 | Vault → graph index (scan, node/edge extraction, incremental, tag layer) — flag-gated |
| `graph/db.ts` | 626 | `graph.sqlite` substrate + global/local selection helpers — flag-gated |
| `graph/layout.ts` | 611 | Seeded deterministic ngraph.forcelayout, chunked main-loop, warm/incremental — flag-gated |
| `graph/runner.ts` | 454 | Long-lived incremental index runner wired into watchers — flag-gated |
| `graph/encode.ts` | 316 | Canonical binary wire format encode/decode — flag-gated |
| `graph/config.ts` | 149 | `isGraphEnabled()` predicate + bounded env getters |
| `graph/types.ts` | 102 | Graph domain types (nodes/edges/meta/payload) |
| `graph/notify.ts` | 26 | `graph-build-event.json` marker writer (WS notify) — flag-gated |
| `types.ts` | 81 | Shared TypeScript interfaces |
| `user-config.ts` | 56 | User settings loading |
| `url-utils.ts` | 35 | View URL building/parsing |

### Server (server/)

| File | Lines | Purpose |
|------|-------|---------|
| `ws-server.ts` | 239 | HTTP server, EventServer setup, watcher wiring |
| `event-server.ts` | 213 | WebSocket pub/sub with channel subscriptions |
| `watchers/scope-watcher.ts` | 237 | Directory tree + file change detection |
| `watchers/inbox-watcher.ts` | 202 | Todo.md change detection |
| `watchers/bridge-watcher.ts` | 108 | Bridge vault change detection |

### Components (src/components/)

| File | Lines | Purpose |
|------|-------|---------|
| `Board.tsx` | 274 | Main container, view routing, toolbar |
| `graph/GraphView.tsx` | 489 | System → Graph shell, first-run state machine, deep-link focus — flag-gated |
| `graph/CosmosRenderer.ts` | 182 | Only `@cosmos.gl/graph` importer; uploads coords + freezes — flag-gated |
| `bridge/BridgeTaskEditor.tsx` | 441 | Tiptap WYSIWYG task editor |
| `docs/DocsEditor.tsx` | 522 | Tiptap markdown editor |
| `docs/DocsContentPane.tsx` | 434 | File content display + routing |
| `stack/StackFileTree.tsx` | 525 | Config file tree with search |
| `stack/StackContentPane.tsx` | 494 | Config content display |
| `stack/MCPServerDetail.tsx` | 488 | MCP server inspector |
| `stack/PluginDetail.tsx` | 332 | Plugin inspector |
| `DocsView.tsx` | 296 | File browser + editor layout |
| `stack/StackView.tsx` | 284 | Claude config inspector layout |
| `bridge/ProjectPicker.tsx` | 250 | Project selector dropdown |
| `bridge/BridgeTaskPanel.tsx` | 253 | Task list + detail panel |
| `docs/CodeViewer.tsx` | 215 | CodeMirror syntax viewer |
| `bridge/ProjectKanban.tsx` | 193 | Project status board |
| `bridge/BridgeTaskItem.tsx` | 190 | Single task row |
| `bridge/BridgeView.tsx` | 177 | Bridge layout container |
| `PlanEditor.tsx` | 166 | MDXEditor wrapper |
| `bridge/RecycleModal.tsx` | 156 | Week rollover dialog |
| `bridge/WeekHeader.tsx` | 143 | Week navigation |
| `bridge/BridgeTaskList.tsx` | 129 | Sorted task list |
| `bridge/ProjectCard.tsx` | 115 | Single project card |
| `ViewToggle.tsx` | 135 | Grouped global tabs |

---

*Last updated: 2026-06-01*
