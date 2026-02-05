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
│  │  │  ├── ViewToggle (Bridge / Docs / Stack)                      │  │  │
│  │  │  ├── ScopeBreadcrumbs (bottom toolbar, Docs + Stack)         │  │  │
│  │  │  ├── BridgeView (weekly tasks, projects, notes)              │  │  │
│  │  │  ├── DocsView (markdown file browser + editor)               │  │  │
│  │  │  └── StackView (Claude config inspector)                     │  │  │
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
| Framework | Next.js | 16.1.0 | React framework with API routes |
| UI | React | 19.2.3 | Component library |
| Language | TypeScript | 5 | Type safety |
| Styling | Tailwind CSS | 4 | Utility-first CSS |
| Drag & Drop | @dnd-kit | 6.3.1 | Bridge task reordering, pinned folder reordering |
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
│   │   ├── ViewToggle.tsx      # Bridge/Docs/Stack toggle (52 lines)
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
│   │   ├── scope/              # Navigation components
│   │   │   ├── ScopeBreadcrumbs.tsx    # Path segments (188 lines)
│   │   │   ├── PinnedFoldersPopover.tsx# Pinned folders menu (182 lines)
│   │   │   ├── RecentScopesButton.tsx  # Recent scopes (141 lines)
│   │   │   ├── SubfolderDropdown.tsx   # Child folder picker (122 lines)
│   │   │   └── BrowseButton.tsx        # File dialog trigger (37 lines)
│   │   ├── sidebar/            # Sidebar components
│   │   │   ├── SortablePinnedFolderItem.tsx # Drag-sortable folder (234 lines)
│   │   │   ├── Sidebar.tsx             # Sidebar container (158 lines)
│   │   │   ├── PinnedFolderItem.tsx    # Folder display (69 lines)
│   │   │   ├── SidebarSection.tsx      # Collapsible section (64 lines)
│   │   │   └── SidebarToggle.tsx       # Collapse toggle (27 lines)
│   │   └── ui/                 # Shared UI components
│   │       └── LiveIndicator.tsx       # Animated dot (18 lines)
│   ├── contexts/               # React contexts
│   │   ├── ScopeContext.tsx     # Scope path + view mode (URL-based routing)
│   │   └── EventSocketContext.tsx # WebSocket event subscriptions
│   ├── hooks/                  # Custom React hooks
│   │   └── usePinnedFolders.ts # Pinned folder state
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
│       ├── recent-scopes.ts    # LRU scope history (98 lines)
│       ├── user-config.ts      # User settings loading (56 lines)
│       ├── url-utils.ts        # View URL building/parsing (35 lines)
│       ├── pinned-folders.ts   # Re-export from db.ts (14 lines)
│       └── chat-types.ts       # Chat type definitions
├── server/
│   ├── ws-server.ts            # HTTP + EventServer setup (239 lines)
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
│   ├── preferences.json        # Pinned folders, theme, view mode, recent scopes
│   └── inbox.json              # Draft prompts (fallback)
├── scripts/
│   └── generate-icons.mjs      # Icon generation script
└── electron-builder.yml        # Distribution config
```

## Data Flow Patterns

### 1. View Routing Flow

```
URL: /bridge or /docs/Users/jruck/work/project or /stack/Users/jruck/work/project
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
         │ Derives ViewMode: "bridge" | "docs" | "stack"
         ▼
Conditionally renders:
  - "bridge" → BridgeView
  - "docs"   → DocsView (with scope + search)
  - "stack"  → StackView (with scope + search)
```

### 2. Bridge View Data Flow

```
Bridge vault (e.g., ~/work/bridge/)
         │
         ├── lists/now/{date}.md      (weekly task files)
         ├── projects/{slug}/index.md (project definitions)
         └── libraries/*/projects/*/  (nested project areas)
         │
         ▼
GET /api/bridge/weekly
         │ weekly-parser.ts reads current week file
         │ Extracts: tasks, notes, frontmatter, available weeks
         ▼
BridgeView.tsx
  ├── WeekHeader (week navigation, recycle button)
  ├── BridgeTaskPanel
  │   ├── BridgeTaskList (sortable via dnd-kit)
  │   │   └── BridgeTaskItem × N
  │   └── BridgeTaskDetail (selected task editor)
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

### 4. Stack View Data Flow

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

### 5. Real-Time Event Flow

```
WebSocket connection: ws://localhost:3001/events
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

## State Management

| State | Location | Persistence | Purpose |
|-------|----------|-------------|---------|
| Pinned folders | `data/preferences.json` | Server JSON | Sidebar folder pins with emoji |
| Theme preference | `data/preferences.json` | Server JSON | Light/dark/system |
| View mode | `data/preferences.json` + URL | Server JSON + URL | Bridge/Docs/Stack |
| Recent scopes | `data/preferences.json` | Server JSON | Navigation history (LRU, max 10) |
| Bridge vault path | `data/preferences.json` | Server JSON | Path to bridge vault |
| Working folder | `data/preferences.json` | Server JSON | Default scope for all views |
| Folder emojis | `data/preferences.json` | Server JSON | Emoji by path (persists across unpin/re-pin) |
| Draft prompts | `Todo.md` / `data/inbox.json` | Local files | Queued prompts |
| Scope path | URL + ScopeContext | URL state | Current folder scope |
| Home directory | localStorage | Browser | Cached home dir path |
| Sidebar collapsed | `data/preferences.json` | Server JSON | Sidebar visibility |

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
| `/api/docs/tree` | GET | Directory tree | `scope` |
| `/api/docs/file` | GET/PUT | Read/write file | `path`, `scope`, `content` |
| `/api/docs/raw` | GET | Raw file serving | `path` |
| `/api/claude-stack` | GET | Stack discovery | `scope` |
| `/api/claude-stack/file` | GET/PUT | Config file read/write | `path` |
| `/api/claude-stack/mcp` | GET | MCP server details | `scope` |
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

**Server**: `ws://localhost:3001/events`

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
{ channel: "bridge", event: "weekly-changed" | "projects-changed", data: {} }

// Error
{ type: "error", message: string }
```

## Component Hierarchy

```
Board.tsx (274 lines)
├── State: scopePath, viewMode, homeDir, workingFolder, searchQuery
├── Contexts: useScope (ScopeContext)
│
├── Top Toolbar
│   ├── Search input
│   ├── ThemeToggle
│   └── ViewToggle (Bridge / Docs / Stack) — centered
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
│   └── viewMode === "stack"
│       └── StackView
│           ├── StackFileTree (sidebar, config files)
│           └── StackContentPane
│               ├── StackSummary (overview dashboard)
│               ├── MCPServerDetail (MCP inspector)
│               ├── PluginDetail (plugin inspector)
│               └── CreateFileDialog (new config)
│
└── Bottom Toolbar (hidden on Bridge view)
    ├── ScopeBreadcrumbs (clickable path segments)
    ├── RecentScopesButton
    ├── BrowseButton
    └── PinnedFoldersPopover
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
  tasks: BridgeTask[];
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
  pinnedFolders: PinnedFolder[];
  sidebarCollapsed: boolean;
  theme: "light" | "dark" | "system";
  recentScopes: string[];
  viewMode: "bridge" | "docs" | "stack";
  folderEmojis?: Record<string, string>;
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
- Vault path configured in preferences (`bridgeVaultPath`)

### 3. Scope Context and URL Routing
- URLs encode both view mode and scope: `/bridge`, `/docs/Users/jruck/work/project`, `/stack/...`
- `ScopeContext` manages scope + view state, syncs with browser history
- `replaceViewMode` used for initial redirect (no history entry)
- `navigateTo` for atomic view + scope changes (single history entry)

### 4. dnd-kit Usage
- Bridge: task reordering within the weekly task list
- Sidebar: pinned folder reordering
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
| `bridge/vault.ts` | 44 | Vault path resolution |
| `claude-config/mcp-discovery.ts` | 450 | MCP server discovery + parsing |
| `claude-config/plugin-discovery.ts` | 252 | Plugin discovery |
| `claude-config/discovery.ts` | 243 | Config file discovery |
| `claude-config/types.ts` | 241 | Config type definitions |
| `claude-config/parsers.ts` | 195 | JSON/JSONC parsing |
| `claude-config/writers.ts` | 131 | Config file writing |
| `docs/wikilink-resolver.ts` | 254 | [[wikilink]] resolution for markdown |
| `recent-scopes.ts` | 98 | LRU scope history |
| `types.ts` | 81 | Shared TypeScript interfaces |
| `user-config.ts` | 56 | User settings loading |
| `url-utils.ts` | 35 | View URL building/parsing |
| `pinned-folders.ts` | 14 | Re-export from db.ts |

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
| `ViewToggle.tsx` | 52 | Bridge/Docs/Stack tabs |

---

*Last updated: 2026-02-05*
