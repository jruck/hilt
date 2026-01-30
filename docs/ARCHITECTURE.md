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
│  │  │  ├── ViewToggle (Tree / Board / Docs)                       │  │  │
│  │  │  ├── ScopeBreadcrumbs (Navigation)                          │  │  │
│  │  │  ├── Sidebar (Pinned folders)                               │  │  │
│  │  │  ├── Column × 3 (To Do / In Progress / Recent)              │  │  │
│  │  │  │   └── SessionCard / InboxCard                            │  │  │
│  │  │  ├── TreeView (Alternate visualization)                     │  │  │
│  │  │  └── TerminalDrawer (Right panel)                           │  │  │
│  │  │      └── Terminal (xterm.js)                                │  │  │
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
         │  /api/sessions   │           │  PTY spawning     │
         │  /api/inbox      │           │  Title extraction │
         │  /api/folders    │           │  Plan file watch  │
         │  /api/plans/[x]  │           │                   │
         │  /api/firecrawl  │           │                   │
         └──────────────────┘           └──────────────────┘
                    │                              │
          ┌─────────┴──────────┐                   │
          ▼                    ▼                   ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Claude Sessions │  │  Local Storage   │  │  Claude CLI      │
│  ~/.claude/      │  │                  │  │  (via PTY)       │
│  projects/       │  │  data/sessions.  │  │                  │
│  *.jsonl         │  │  json (registry) │  │  claude --resume │
│  (read-only)     │  │  data/inbox.json │  │  or new session  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Framework | Next.js | 16.1.0 | React framework with API routes |
| UI | React | 19.2.3 | Component library |
| Language | TypeScript | 5 | Type safety |
| Styling | Tailwind CSS | 4 | Utility-first CSS |
| Drag & Drop | @dnd-kit | 6.3.1 | Kanban card movement |
| Terminal | xterm.js | 5.5.0 | Terminal emulation |
| Editor | MDXEditor | 3.24 | Plan markdown editing |
| Data Fetching | SWR | 2.3.8 | Server state + polling |
| WebSocket | ws | 8.18.3 | Real-time terminal I/O |
| PTY | node-pty | 0.10.2 | Pseudo-terminal spawning |
| Validation | Zod | 4.2.1 | Schema validation |
| Icons | Lucide React | 0.562 | Icon library |

## Directory Structure

```
hilt/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── [[...path]]/        # Catch-all route for scope URLs
│   │   │   └── page.tsx        # Main board page
│   │   ├── layout.tsx          # Root layout
│   │   ├── globals.css         # Tailwind + MDXEditor styles
│   │   └── api/                # API routes
│   │       ├── sessions/       # Session CRUD
│   │       ├── inbox/          # Draft prompts
│   │       ├── folders/        # Scope browsing
│   │       ├── plans/[slug]/   # Plan files
│   │       └── ...
│   ├── components/             # React components
│   │   ├── Board.tsx           # Main container (1046 lines)
│   │   ├── Column.tsx          # Kanban column (759 lines)
│   │   ├── SessionCard.tsx     # Session display
│   │   ├── TerminalDrawer.tsx  # Terminal panel (821 lines)
│   │   ├── TreeView.tsx        # Treemap visualization
│   │   ├── scope/              # Navigation components
│   │   └── sidebar/            # Sidebar components
│   ├── hooks/                  # Custom React hooks
│   │   ├── useSessions.ts      # SWR for sessions
│   │   └── usePinnedFolders.ts # Pinned folder state
│   └── lib/                    # Core utilities
│       ├── claude-sessions.ts  # JSONL parsing (471 lines)
│       ├── tree-utils.ts       # Tree building (360 lines)
│       ├── treemap-layout.ts   # Squarified layout (328 lines)
│       ├── pty-manager.ts      # PTY lifecycle (246 lines)
│       ├── db.ts               # JSON persistence (205 lines)
│       ├── todo-md.ts          # Todo.md parsing (487 lines)
│       └── types.ts            # TypeScript types
├── server/
│   └── ws-server.ts            # WebSocket + PTY server (318 lines)
├── data/                       # Persistent storage (gitignored)
│   ├── sessions.json     # Kanban states
│   └── inbox.json              # Draft prompts (fallback)
├── electron/                   # Electron native app
│   ├── main.ts                 # Main process, IPC handlers
│   ├── preload.ts              # contextBridge API
│   ├── launcher.cjs            # tsx loader for dev
│   ├── types.d.ts              # TypeScript declarations
│   └── tsconfig.json           # Electron-specific config
├── build/                      # Build assets
│   ├── icon.svg                # Source icon (🗡️)
│   ├── icon.icns               # macOS icon
│   └── entitlements.mac.plist  # Code signing entitlements
├── scripts/
│   └── generate-icons.mjs      # Icon generation script
└── electron-builder.yml        # Distribution config
```

## Data Flow Patterns

### 1. Session Discovery Flow

```
Claude JSONL Files (~/.claude/projects/{encoded-path}/*.jsonl)
         │
         ▼
parseSessionFile() in claude-sessions.ts
         │ Extracts: id, title, slug, branch, messages, prompts
         ▼
mergeWithStatusDB() in db.ts
         │ Adds: status, sortOrder, starred, isRunning
         ▼
GET /api/sessions
         │ Filters by scope, detects running, builds tree if requested
         ▼
useSessions() hook (SWR with 5-second polling)
         │
         ▼
Board.tsx → Column.tsx → SessionCard.tsx
```

### 2. Terminal Integration Flow

```
User clicks "Open Terminal" on SessionCard
         │
         ▼
TerminalDrawer adds tab, creates Terminal component
         │
         ▼
Terminal.tsx sends WebSocket "spawn" message
         │ { type: "spawn", terminalId, sessionId, projectPath, isNew?, initialPrompt? }
         ▼
ws-server.ts receives, calls ptyManager.spawn()
         │
         ▼
pty-manager.ts spawns PTY in project directory
         │ Writes: "claude --resume {sessionId}" or "claude" for new
         │ If new + initialPrompt: waits for ready, injects prompt
         ▼
PTY stdout → ws-server.ts
         │ Extracts OSC title, context progress
         │ Broadcasts to connected WebSockets
         ▼
Terminal.tsx receives data, writes to xterm instance
```

### 3. Scope Navigation Flow

```
URL: /Users/jruck/Work/Code/project
         │
         ▼
[[...path]]/page.tsx (catch-all route)
         │ Decodes path segments → scopePath
         ▼
Board.tsx receives initialScope prop
         │ Sets scopePath state
         ▼
useSessions(scopePath) triggers fetch
         │
         ▼
GET /api/sessions?scope={path}&mode=exact (Board)
    or
GET /api/sessions?scope={path}&mode=tree (Tree View)
         │
         ▼
Board view: Filter projectPath === scopePath
Tree view: Filter projectPath.startsWith(scopePath)
```

### 4. View Mode Flow

```
ViewToggle click
         │
         ▼
setViewMode("tree" | "board" | "docs")
         │ Persists to localStorage
         ▼
Board.tsx conditionally renders:
  - "board" → Columns with SessionCards
  - "tree"  → TreeView component
  - "docs"  → Coming Soon placeholder
         │
         ▼
TreeView uses different API mode:
  useTreeSessions(scope) → mode=tree
  Builds TreeNode hierarchy
  Renders squarified treemap
```

## State Management

| State | Location | Persistence | Purpose |
|-------|----------|-------------|---------|
| Session metadata | `~/.claude/projects/` | Claude-owned | Session content |
| Kanban status | `data/sessions.json` | Local JSON | Column, order, starred |
| Draft prompts | `Todo.md` or `data/inbox.json` | Local | Queued prompts |
| View preference | localStorage `VIEW_MODE_KEY` | Browser | Board/Tree/Docs |
| Recent scopes | localStorage | Browser | Navigation history |
| Pinned folders | localStorage | Browser | Sidebar pins |
| Terminal state | In-memory (ptyManager) | None | Active PTY sessions |
| Running detection | File mtime | None | 30-second threshold |

## API Routes

| Route | Method | Purpose | Key Params |
|-------|--------|---------|------------|
| `/api/sessions` | GET | List sessions | `scope`, `mode`, `search`, `planFilter` |
| `/api/sessions` | PATCH | Update status | `sessionId`, `status`, `sortOrder`, `starred` |
| `/api/inbox` | GET | List drafts | `scope` |
| `/api/inbox` | POST | Create draft | `prompt`, `projectPath` |
| `/api/inbox` | PATCH | Update draft | `id`, `prompt` |
| `/api/inbox` | DELETE | Delete draft | `id` |
| `/api/folders` | GET | List subfolders | `path` |
| `/api/plans/[slug]` | GET | Read plan | - |
| `/api/plans/[slug]` | PUT | Write plan | `content` |
| `/api/reveal` | POST | Open in Finder | `path` |
| `/api/cwd` | GET | Current directory | - |
| `/api/firecrawl` | POST | Scrape URL | `url` |
| `/api/youtube-transcript` | GET | Get transcript | `videoId` |
| `/api/inbox-counts` | GET | Count by scope | `scope` |

## WebSocket Protocol

**Server**: `ws://localhost:3001`

### Client → Server Messages

```typescript
// Spawn terminal
{ type: "spawn", terminalId: string, sessionId: string, projectPath?: string, isNew?: boolean, initialPrompt?: string }

// Send keystrokes
{ type: "data", terminalId: string, data: string }

// Resize terminal
{ type: "resize", terminalId: string, cols: number, rows: number }

// Kill terminal
{ type: "kill", terminalId: string }
```

### Server → Client Messages

```typescript
// Terminal spawned
{ type: "spawned", terminalId: string }

// Terminal output
{ type: "data", terminalId: string, data: string }

// Title change (from OSC sequence)
{ type: "title", terminalId: string, title: string }

// Context progress
{ type: "context", terminalId: string, progress: number }

// Terminal exited
{ type: "exit", terminalId: string, exitCode: number }

// Plan file events
{ type: "plan", event: "created" | "updated", slug: string, content: string }

// Error
{ type: "error", message: string }
```

## Key Algorithms

### Running Session Detection

```typescript
// claude-sessions.ts:isSessionRunning()
const RUNNING_THRESHOLD_MS = 30_000; // 30 seconds

function isSessionRunning(sessionPath: string): boolean {
  const stats = fs.statSync(sessionPath);
  const msSinceModified = Date.now() - stats.mtimeMs;
  return msSinceModified < RUNNING_THRESHOLD_MS;
}
```

### Heat Score Calculation

```typescript
// heat-score.ts
function calculateHeatScore(sessions: Session[]): number {
  // Recency: exponential decay based on last activity
  const recencyScore = Math.exp(-daysSinceActivity / 7);

  // Volume: log scale of message count
  const volumeScore = Math.log10(totalMessages + 1) / 3;

  // Running bonus
  const runningBonus = hasRunningSessions ? 0.2 : 0;

  return 0.6 * recencyScore + 0.3 * volumeScore + runningBonus;
}
```

### Squarified Treemap Layout

```typescript
// treemap-layout.ts
// Implements Bruls et al. squarified treemap algorithm
// No D3 dependency - pure TypeScript implementation

function squarify(items: LayoutItem[], rect: Rectangle): LayoutRect[] {
  // Recursively partition rectangle into sub-rectangles
  // Optimizes for aspect ratio closest to 1 (squares)
  // Returns positioned rectangles for rendering
}
```

### Scope Filtering Modes

```typescript
// sessions/route.ts
if (mode === "tree") {
  // Prefix match: include all sessions in scope and subfolders
  sessions = sessions.filter(s => s.projectPath.startsWith(scope));
} else {
  // Exact match: only sessions in this exact folder
  sessions = sessions.filter(s => s.projectPath === scope);
}
```

## Component Hierarchy

```
Board.tsx (1046 lines)
├── State: sessions, scope, viewMode, search, selected, drawerOpen
├── Hooks: useSessions, useTreeSessions, useInboxItems
│
├── Header
│   ├── Sidebar toggle
│   ├── ScopeBreadcrumbs
│   │   ├── PathSegments (clickable)
│   │   ├── SubfolderDropdown
│   │   └── PinButton
│   ├── ViewToggle (Tree/Board/Docs)
│   └── Search input
│
├── Sidebar (collapsible)
│   ├── PinnedFolderList (draggable)
│   └── RecentScopesButton
│
├── Main Content (conditional)
│   ├── viewMode === "board"
│   │   ├── Column "To Do" (status: inbox)
│   │   │   ├── NewDraftCard
│   │   │   └── InboxCard × N
│   │   ├── Column "In Progress" (status: active)
│   │   │   └── SessionCard × N
│   │   └── Column "Recent" (status: recent)
│   │       └── SessionCard × N (grouped by time)
│   │
│   ├── viewMode === "tree"
│   │   └── TreeView
│   │       ├── TreeNodeCard × N (folders)
│   │       └── TreeSessionCard × N (sessions)
│   │
│   └── viewMode === "docs"
│       └── "Coming Soon" placeholder
│
└── TerminalDrawer (fixed right)
    ├── Tab bar
    └── Terminal × N (one per tab)
        └── xterm.js instance
```

## Data Models

### Session (Full Interface)

```typescript
interface Session {
  // From Claude JSONL
  id: string;              // UUID from filename
  title: string;           // Summary or first prompt
  project: string;         // Encoded project path
  projectPath: string;     // Decoded project path
  lastActivity: Date;      // Most recent entry timestamp
  messageCount: number;    // Total messages
  gitBranch: string | null;// Current git branch
  firstPrompt: string | null;
  lastPrompt: string | null;
  slug: string | null;     // e.g., "dynamic-tickling-thunder"
  slugs: string[];         // All slugs (can change mid-session)

  // From kanban DB
  status: "inbox" | "active" | "recent";
  sortOrder?: number;
  starred?: boolean;

  // Runtime state
  isNew?: boolean;         // Started from inbox
  initialPrompt?: string;  // Prompt for new session
  terminalId?: string;     // Stable terminal tracking ID
  isRunning?: boolean;     // File modified within 30s
  planSlugs?: string[];    // Slugs with plan files
  planMode?: boolean;      // Open in plan editor
}
```

### TreeNode

```typescript
interface TreeNode {
  path: string;            // Full folder path
  name: string;            // Display name (last segment)
  depth: number;           // Depth from scope root

  sessions: Session[];     // Direct sessions (projectPath === path)
  children: TreeNode[];    // Child folder nodes

  metrics: {
    totalSessions: number; // All in subtree
    directSessions: number;// Only in this folder
    activeCount: number;   // status === "active"
    inboxCount: number;    // status === "inbox"
    recentCount: number;   // status === "recent"
    runningCount: number;  // isRunning === true
    lastActivity: number;  // Timestamp (ms)
    heatScore: number;     // Sizing metric
  };
}
```

### JSONL Entry Types

Claude's session files contain these entry types:

```typescript
// Summary (from context compression)
{ type: "summary", summary: string, leafUuid?: string }

// User message
{ type: "user", timestamp: string, sessionId: string, message: { content: string, role: "user" }, gitBranch?: string, cwd?: string }

// Assistant response
{ type: "assistant", timestamp: string, sessionId?: string, message?: any, gitBranch?: string }

// File snapshots (ignored)
{ type: "file-history-snapshot", ... }
```

## Constraints & Gotchas

### 1. Claude JSONL Files are Read-Only
- Never write to `~/.claude/projects/` - owned by Claude CLI
- All kanban state goes to `data/sessions.json`

### 2. Terminal Stability
- Use `terminalId` (not `sessionId`) as React key
- `terminalId` stays stable when temp ID matches real UUID
- Without this, terminal reloads and requires "continue"

### 3. Scope Filtering Modes
- **Board mode**: `projectPath === scope` (exact match)
- **Tree mode**: `projectPath.startsWith(scope)` (prefix match)
- Mixing modes causes incorrect counts

### 4. localStorage Keys
```javascript
"view-mode"           // "board" | "tree" | "docs"
"recent-scopes"       // JSON array of paths
"pinned-folders"      // JSON array of paths
"sidebar-collapsed"   // boolean
"home-dir"            // Cached home directory
```

### 5. Running Detection Threshold
- 30 seconds (RUNNING_THRESHOLD_MS)
- Based on JSONL file mtime
- False positives possible if Claude is idle but session open

### 6. Plan Files Location
- Stored in `~/.claude/plans/{slug}.md`
- Slug comes from session, can change mid-session
- WebSocket watches for new/updated plans

### 7. Ports
- Next.js: 3000 (configurable via PORT)
- WebSocket: 3001 (configurable via WS_PORT)
- Event Server: 3002 (for real-time file change events)
- All servers start together via `npm run dev:all`

### 8. Electron IPC Transport
- Native desktop app with IPC-based PTY communication
- `electron/main.ts` - Main process with IPC handlers
- `electron/preload.ts` - contextBridge for secure API exposure
- `Terminal.tsx` detects Electron environment and uses IPC instead of WebSocket
- In development: tsx loader runs TypeScript directly
- In production: Embedded Next.js standalone server
- Uses custom data directory via DATA_DIR env
- macOS hardened runtime with entitlements for code signing

## File Index

### Core Libraries (src/lib/)

| File | Lines | Purpose |
|------|-------|---------|
| `claude-sessions.ts` | 471 | JSONL parsing, session discovery, running detection |
| `todo-md.ts` | 487 | Todo.md parsing, section extraction |
| `tree-utils.ts` | 360 | Tree building, metrics aggregation |
| `treemap-layout.ts` | 328 | Squarified layout algorithm |
| `pty-manager.ts` | 246 | PTY lifecycle, prompt injection |
| `db.ts` | 205 | JSON file persistence |
| `types.ts` | 156 | Zod schemas, TypeScript interfaces |
| `pinned-folders.ts` | 138 | Folder pinning CRUD |
| `heat-score.ts` | 105 | Activity scoring algorithm |
| `recent-scopes.ts` | 86 | LRU scope history |
| `user-config.ts` | 56 | User settings loading |

### Components (src/components/)

| File | Lines | Purpose |
|------|-------|---------|
| `Board.tsx` | 1046 | Main container, state management |
| `TerminalDrawer.tsx` | 821 | Terminal panel, tabs, resizing |
| `Column.tsx` | 759 | Kanban column, grouping, metrics |
| `SessionCard.tsx` | 300 | Session display, actions |
| `Terminal.tsx` | 291 | xterm.js wrapper |
| `InboxCard.tsx` | 270 | Draft prompt card |
| `TreeNodeCard.tsx` | 249 | Folder in treemap |
| `TreeView.tsx` | 175 | Treemap container |
| `PlanEditor.tsx` | 166 | MDXEditor wrapper |
| `NewDraftCard.tsx` | 143 | Create draft input |
| `TreeSessionCard.tsx` | 140 | Session in treemap |

### API Routes (src/app/api/)

| Route | Lines | Purpose |
|-------|-------|---------|
| `firecrawl/route.ts` | 209 | URL scraping |
| `sessions/route.ts` | 194 | Session CRUD |
| `inbox/route.ts` | 176 | Draft prompts |
| `folders/route.ts` | 160 | Scope browsing |
| `plans/[slug]/route.ts` | 81 | Plan files |
| `youtube-transcript/route.ts` | 57 | Video transcripts |
| `inbox-counts/route.ts` | 33 | Count aggregation |
| `reveal/route.ts` | 28 | Finder integration |
| `cwd/route.ts` | 5 | Current directory |

---

*Last updated: 2025-01-06*
