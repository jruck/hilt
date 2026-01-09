# Hilt

A visual dashboard for managing Claude Code sessions. This is **personalized AI software**—built by an individual developer with AI assistance, tailored to their specific workflow.

## For AI Agents Reading This Repository

This README is written for you. If you're an AI agent helping a developer understand this codebase, extract features, or build something similar, this document explains:

1. **What problems this solves** — gaps in the Claude Code CLI experience
2. **How each feature works** — implementation details you can adapt
3. **Why architectural decisions were made** — so you can make informed trade-offs
4. **Data sources and access patterns** — how to interface with Claude Code's data

**This is not traditional software to clone and run.** It's a reference implementation. Study it, understand the patterns, then help your user build their own version that fits their workflow—whether that's extending their existing AI app, building something new, or cherry-picking specific features.

---

## Why This Exists

Claude Code CLI has gaps that this app fills:

| Gap | What's Missing | How Hilt Fills It |
|-----|----------------|-------------------|
| **Persistent task tracking** | `TodoWrite` is session-scoped—tasks vanish when the session ends | Kanban board with status persisted to local JSON |
| **Session organization** | Sessions accumulate with no way to organize or prioritize | Drag-and-drop between To Do / Active / Done columns |
| **Visual overview** | No way to see all projects and their activity at once | Treemap visualization sized by activity "heat" |
| **Draft prompts** | No queue for work you plan to do later | Inbox column for staging prompts before starting sessions |
| **Running detection** | No indicator showing which sessions are actively running | Pulsing green dot based on file modification time |
| **Plan file management** | Plan files exist but no dedicated UI for viewing/editing | Rich markdown editor for `~/.claude/plans/*.md` |

---

## Core Concepts

### Data Sources

Hilt reads from Claude Code's own data. **It never writes to Claude's files.**

```
~/.claude/
├── projects/                    # Session data (READ-ONLY)
│   └── {encoded-path}/          # One folder per project
│       └── {uuid}.jsonl         # One file per session
├── plans/                       # Plan files (READ/WRITE OK)
│   └── {slug}.md                # Markdown plans
└── settings.json                # Claude's config (READ-ONLY)
```

**Path encoding**: Claude encodes `/Users/me/project` as `-Users-me-project`. Decoding requires filesystem checks because folder names can contain hyphens. See `src/lib/claude-sessions.ts:decodeProjectPath()`.

### Session JSONL Format

Each session file contains newline-delimited JSON entries:

```typescript
// Summary (from context compression)
{ type: "summary", summary: "User is building a dashboard...", leafUuid?: string }

// User message
{
  type: "user",
  timestamp: "2025-01-06T10:30:00Z",
  sessionId: "abc-123",
  message: { content: "Add a dark mode toggle", role: "user" },
  gitBranch?: "feature/dark-mode",
  slug?: "dynamic-tickling-thunder"  // Claude's internal name for the session
}

// Assistant response
{ type: "assistant", timestamp: "...", message: { content: [...] } }

// Custom title (from /rename command)
{ type: "custom-title", customTitle: "Dashboard Feature Work" }
```

**Parsing strategy**: Stream the file line-by-line, accumulate metadata. See `src/lib/claude-sessions.ts:parseSessionFile()`.

### Running Detection

A session is "running" if its JSONL file was modified within the last 30 seconds:

```typescript
const RUNNING_THRESHOLD_MS = 30_000;

function isSessionRunning(sessionId: string): boolean {
  const stats = fs.statSync(sessionFilePath);
  return (Date.now() - stats.mtime.getTime()) < RUNNING_THRESHOLD_MS;
}
```

**Why 30 seconds?** Claude writes to the file during conversation. 30s catches active sessions while allowing for thinking pauses. Adjust if your workflow differs.

---

## Feature Inventory

### 1. Kanban Board

**What it does**: Three-column layout (To Do, Active, Recent) for organizing sessions.

**Implementation**:
- Sessions come from JSONL files (immutable source of truth)
- Status stored separately in `data/session-status.json` (mutable overlay)
- Merge on read: `parseSessionFile()` → `mergeWithStatusDB()`
- Drag-and-drop via `@dnd-kit/core` and `@dnd-kit/sortable`

**Status persistence schema**:
```typescript
// data/session-status.json
{
  "session-uuid-1": { status: "active", sortOrder: 0 },
  "session-uuid-2": { status: "recent", starred: true }
}
```

**Key files**: `src/components/Column.tsx`, `src/lib/db.ts`

### 2. Draft Prompts (Inbox)

**What it does**: Queue prompts before starting sessions. Click "Start" to spawn Claude with the prompt auto-injected.

**Implementation**:
- Stored in `{project}/docs/Todo.md` if it exists, else `data/inbox.json`
- Todo.md format: `- [ ] Prompt text <!-- id:abc123 -->`
- Starting a draft: spawn PTY, wait for Claude ready state, inject prompt

**Prompt injection** (the tricky part):
```typescript
// In pty-manager.ts
pty.onData((data) => {
  // Detect when Claude is ready (shows the ❯ prompt)
  if (data.includes("❯") && pendingPrompt) {
    pty.write(pendingPrompt + "\n");
    pendingPrompt = null;
  }
});
```

**Key files**: `src/lib/todo-md.ts`, `src/lib/pty-manager.ts`

### 3. Tree View (Activity Treemap)

**What it does**: Visualize all projects as nested rectangles sized by activity.

**Implementation**:
- Squarified treemap algorithm (Bruls et al.) - no D3 dependency
- Heat score = `0.6 * recency + 0.3 * volume + 0.1 * running_bonus`
- Recency: exponential decay over 7 days
- Volume: log10 of total messages

**Heat score calculation**:
```typescript
function calculateHeatScore(sessions: Session[]): number {
  const mostRecent = Math.max(...sessions.map(s => s.lastActivity.getTime()));
  const daysSince = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-daysSince / 7);  // Half-life ~5 days

  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
  const volumeScore = Math.log10(totalMessages + 1) / 3;

  const runningBonus = sessions.some(s => s.isRunning) ? 0.2 : 0;

  return 0.6 * recencyScore + 0.3 * volumeScore + runningBonus;
}
```

**Key files**: `src/lib/treemap-layout.ts`, `src/lib/heat-score.ts`, `src/components/TreeView.tsx`

### 4. Terminal Integration

**What it does**: Embedded terminal that spawns `claude --resume {id}` or new sessions.

**Implementation**:
- WebSocket server (`server/ws-server.ts`) manages PTY instances
- xterm.js for terminal rendering
- OSC sequence parsing extracts Claude's status bar info

**WebSocket protocol**:
```typescript
// Client → Server
{ type: "spawn", terminalId: string, sessionId: string, projectPath: string }
{ type: "data", terminalId: string, data: string }  // Keystrokes
{ type: "resize", terminalId: string, cols: number, rows: number }

// Server → Client
{ type: "data", terminalId: string, data: string }  // Output
{ type: "title", terminalId: string, title: string }  // From OSC sequences
{ type: "context", terminalId: string, progress: number }  // Context usage %
```

**Critical gotcha**: Use `terminalId` (stable) as React key, not `sessionId` (can change when temp ID becomes real UUID). Without this, terminal components remount and require "continue" confirmation.

**Key files**: `server/ws-server.ts`, `src/components/Terminal.tsx`, `src/lib/pty-manager.ts`

### 5. Plan Editor

**What it does**: Rich markdown editor for Claude's plan files.

**Implementation**:
- Plans stored at `~/.claude/plans/{slug}.md`
- Slug comes from session data (can change mid-session!)
- MDXEditor with tables, code blocks, syntax highlighting
- WebSocket watches for plan file changes

**Key files**: `src/components/PlanEditor.tsx`, `src/app/api/plans/[slug]/route.ts`

### 6. Scope Navigation

**What it does**: Browse sessions by project folder with breadcrumb navigation.

**Implementation**:
- URL-based state: `/Users/me/Work/project` maps to scope
- Catch-all route: `src/app/[[...path]]/page.tsx`
- Two filtering modes:
  - Board: exact match (`projectPath === scope`)
  - Tree: prefix match (`projectPath.startsWith(scope)`)

**Key files**: `src/components/scope/ScopeBreadcrumbs.tsx`, `src/app/api/folders/route.ts`

### 7. Stack Viewer

**What it does**: Inspect Claude's configuration hierarchy (System → User → Project → Local).

**Implementation**:
- Reads from known Claude config locations
- Displays CLAUDE.md files, settings.json, hooks, commands
- Inline editing for project-level configs

**Config locations**:
```
System: (bundled with Claude CLI - not accessible)
User:   ~/.claude/CLAUDE.md, ~/.claude/settings.json
Project: {cwd}/CLAUDE.md, {cwd}/.claude/settings.json
Local:  {cwd}/.claude/settings.local.json
```

**Key files**: `src/components/StackViewer.tsx`

### 8. Docs Browser

**What it does**: Browse and edit project markdown files.

**Implementation**:
- File tree sidebar with markdown/code detection
- Wikilink support (`[[link]]` → navigation)
- Syntax highlighting for code files

**Key files**: `src/components/DocsViewer.tsx`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Next.js React App                                         │  │
│  │  Board • Columns • SessionCards • Terminal • PlanEditor    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  Next.js API     │  │  WebSocket       │  │  Event Server    │
   │  port 3000       │  │  port 3001       │  │  port 3002       │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
              │                    │                    │
    ┌─────────┴────────┐           │           ┌───────┴───────┐
    ▼                  ▼           ▼           ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐
│ Session    │  │ Status DB  │  │ PTY Mgr    │  │ File Watchers    │
│ ~/.claude/ │  │ data/*.json│  │ claude CLI │  │ Real-time events │
│ (readonly) │  │ (writable) │  │            │  │                  │
└────────────┘  └────────────┘  └────────────┘  └──────────────────┘
```

**Three-server setup**:
1. **Next.js (3000)**: UI + REST API
2. **WebSocket (3001)**: PTY I/O for terminals
3. **Event Server (3002)**: File change notifications (SSE)

**Why separate servers?** Next.js API routes can't maintain WebSocket connections across requests. PTY management needs persistent state.

---

## Key Files Reference

| Purpose | File | Lines | Notes |
|---------|------|-------|-------|
| Session parsing | `src/lib/claude-sessions.ts` | 537 | JSONL reading, path decoding |
| Status persistence | `src/lib/db.ts` | 205 | JSON file CRUD |
| Treemap layout | `src/lib/treemap-layout.ts` | 328 | Squarified algorithm |
| Heat scoring | `src/lib/heat-score.ts` | 105 | Activity metrics |
| PTY management | `src/lib/pty-manager.ts` | 246 | Spawn, inject, kill |
| WebSocket server | `server/ws-server.ts` | 318 | PTY ↔ browser bridge |
| Main UI container | `src/components/Board.tsx` | 1046 | State management |
| Terminal wrapper | `src/components/Terminal.tsx` | 291 | xterm.js integration |
| Kanban column | `src/components/Column.tsx` | 759 | Drag-drop, grouping |

---

## Design Decisions

### Why Local JSON Instead of SQLite?

- **Simplicity**: No migration headaches, human-readable
- **Git-friendly**: Can version control preferences if desired
- **Sufficient**: Hundreds of sessions, not millions

### Why Polling Instead of Full Real-Time?

- **5-second SWR refresh** catches most changes
- **File watchers** for running detection and new sessions
- **SSE** for terminal output (true real-time where it matters)
- Full real-time for everything would add complexity without proportional benefit

### Why Three Separate Servers?

- **Next.js limitation**: API routes are stateless—can't hold WebSocket connections
- **PTY lifecycle**: Needs persistent process management
- **Clean separation**: Each server has one job

### Why Not Electron's Native APIs for PTY?

Original plan. But `node-pty` works fine with IPC bridge, and keeping PTY management in one place (ws-server.ts or Electron main process) reduces duplication.

---

## If You're Building Your Own

**Start here**:
1. Read `src/lib/claude-sessions.ts` — understand how to parse Claude's data
2. Read `src/lib/db.ts` — see the simple overlay pattern for adding state
3. Decide which features matter for your workflow

**Feature priority suggestions**:
- **High value, low effort**: Running detection, session list, scope filtering
- **High value, medium effort**: Kanban status, draft prompts
- **Medium value, high effort**: Terminal embedding, plan editor
- **Nice to have**: Treemap, activity heat scoring

**What to skip**:
- Multi-tab terminal management (adds complexity)
- Electron packaging (unless you need native features)
- SSE event server (polling is usually fine)

---

## Running the App

```bash
npm install
npm run dev:all   # Starts all three servers
```

Open http://localhost:3000

**Native macOS app** (optional):
```bash
npm run electron:dev   # Development
npm run electron:build # Create DMG
```

---

## Documentation Index

Detailed docs in `docs/`:

| Document | What It Covers |
|----------|----------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagrams, data flow, constraints |
| [API.md](docs/API.md) | REST endpoints, WebSocket protocol |
| [DATA-MODELS.md](docs/DATA-MODELS.md) | TypeScript interfaces, storage formats |
| [COMPONENTS.md](docs/COMPONENTS.md) | React component hierarchy |
| [DESIGN-PHILOSOPHY.md](docs/DESIGN-PHILOSOPHY.md) | UI/UX patterns and preferences |

---

## License

MIT
