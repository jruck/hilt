# Claude Code Session Kanban

A local web app for visually managing Claude Code sessions as a Kanban board with embedded terminals.

## Data Discovery Summary

Claude Code stores sessions as JSONL files:
- Location: `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl`
- First line: `{type: "summary", summary: "...", leafUuid: "..."}`
- Messages: `{type: "user"|"assistant", timestamp, sessionId, gitBranch, message: {content, role}}`

We can extract per session:
- Session ID (filename)
- Summary/title (first line)
- Project path (parent folder name, decoded)
- Last activity (max timestamp)
- Message count
- Git branch

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Next.js App (localhost:3000)                       │
│  ┌─────────────────────┐  ┌───────────────────────┐ │
│  │ Kanban Board        │  │ Terminal Drawer       │ │
│  │ (React + DnD)       │  │ (xterm.js)            │ │
│  └─────────────────────┘  └───────────────────────┘ │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────┐
│  API Routes              │                          │
│  ┌───────────────────────▼────────────────────────┐ │
│  │ /api/sessions     - List/update sessions       │ │
│  │ /api/terminal     - WebSocket for PTY          │ │
│  │ /api/inbox        - CRUD for draft prompts     │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ SQLite (your-status.db)                        │ │
│  │ - session_status (sessionId, status, order)    │ │
│  │ - inbox_items (id, prompt, created_at)         │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Claude Code JSONL (read-only)                  │ │
│  │ ~/.claude/projects/*/                          │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Project Scoping

The app is **context-aware** based on where you launch it:

```bash
cd ~/Bridge && npm run dev     # Shows Bridge + all subdirectories
cd ~/ && npm run dev           # Shows everything
cd ~/Work/GQ && npm run dev    # Shows just GQ projects
```

At startup, the app reads `process.cwd()` and filters sessions to those whose decoded project path starts with that prefix.

## Statuses

| Status | Source | Behavior |
| --- | --- | --- |
| **Inbox** | Your DB only | Draft prompts not yet started |
| **Active** | Your DB + process detection | Terminal open in drawer |
| **Inactive** | Claude JSONL + Your DB | Session exists but not running |
| **Done** | Your DB only | Marked complete, archived |

## Core Requirements (validated by neighbor projects)

1. **Session resume via embedded terminal** — click a card, resume in drawer
2. **Zero-config startup** — `npx hilt` or `npm run dev` just works
3. **Syntax-highlighted diffs** — render code changes readably
4. **Auto-refresh** — detect new/changed sessions without manual reload
5. **Pagination/virtualization** — handle users with hundreds of sessions

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Terminal**: xterm.js + xterm-addon-fit
- **PTY Backend**: node-pty
- **WebSocket**: ws (for terminal streaming)
- **Database**: better-sqlite3
- **DnD**: @dnd-kit/core
- **Icons**: lucide-react
- **Validation**: zod (for JSONL schema parsing)
- **Syntax Highlighting**: shiki or prism-react-renderer

## File Structure

```
hilt/
├── package.json
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Main Kanban board
│   │   └── api/
│   │       ├── sessions/
│   │       │   └── route.ts            # GET sessions, PATCH status
│   │       ├── inbox/
│   │       │   └── route.ts            # CRUD inbox items
│   │       └── terminal/
│   │           └── route.ts            # WebSocket upgrade
│   ├── components/
│   │   ├── Board.tsx                   # Kanban board container
│   │   ├── Column.tsx                  # Single column (Inbox/Active/etc)
│   │   ├── SessionCard.tsx             # Draggable session card
│   │   ├── InboxCard.tsx               # Draft prompt card
│   │   ├── TerminalDrawer.tsx          # Slide-out terminal panel
│   │   └── Terminal.tsx                # xterm.js wrapper
│   ├── lib/
│   │   ├── claude-sessions.ts          # Read Claude JSONL files
│   │   ├── db.ts                       # SQLite connection + schema
│   │   ├── pty-manager.ts              # node-pty process management
│   │   └── types.ts                    # TypeScript interfaces
│   └── hooks/
│       ├── useSessions.ts              # SWR hook for sessions
│       └── useTerminal.ts              # Terminal WebSocket hook
├── server/
│   └── ws-server.ts                    # WebSocket server for terminals
└── data/
    └── kanban.db                       # SQLite database
```

## Implementation Steps

### Phase 1: Project Setup
1. Initialize Next.js project with TypeScript
2. Install dependencies (tailwind, xterm.js, node-pty, better-sqlite3, ws, @dnd-kit)
3. Configure Tailwind
4. Create SQLite schema

### Phase 2: Claude Session Reader
1. Define Zod schemas for JSONL message types (summary, user, assistant, etc.)
2. Implement `claude-sessions.ts` to:
  - Scan `~/.claude/projects/` directories
  - Parse JSONL files with Zod validation
  - Extract: summary (first line), message count, timestamps, git branch
  - Return session metadata (id, title, project, lastActivity, messageCount, branch)
3. Create `/api/sessions` GET endpoint with pagination support

### Phase 3: Status Tracking Layer
1. SQLite schema:
```sql
   CREATE TABLE session_status (
     session_id TEXT PRIMARY KEY,
     status TEXT CHECK(status IN ('inbox','active','inactive','done')),
     sort_order INTEGER,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );

   CREATE TABLE inbox_items (
     id TEXT PRIMARY KEY,
     prompt TEXT NOT NULL,
     project_path TEXT,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     sort_order INTEGER
   );
```
2. Merge Claude sessions with status data
3. PATCH endpoint to update status

### Phase 4: Kanban UI
1. Board layout with 4 columns
2. SessionCard component showing: title, project, last activity, message count
3. Drag-and-drop between columns (updates status)
4. Inbox column with "Add prompt" button
5. Click card → open terminal drawer

### Phase 5: Terminal Integration
1. WebSocket server (separate process or custom Next.js server)
2. `pty-manager.ts` to spawn `claude --resume <id>`
3. Terminal component with xterm.js
4. Drawer UI that slides in from right
5. Multiple terminal support (one per active session)

### Phase 6: Polish
1. Auto-refresh via file system watching (chokidar on `~/.claude/projects/`)
2. Virtualized session list for large datasets (@tanstack/react-virtual)
3. Syntax-highlighted diff rendering for code blocks
4. Keyboard shortcuts (Cmd+K search, arrow navigation)
5. Session preview on hover

## Key Decisions

1. **Project location**: `~/Work/code/hilt`

2. **Separate WebSocket server**: Next.js API routes don't support long-lived WebSocket connections well. We'll run a small ws server on a different port (e.g., 3001) that the frontend connects to.

3. **Read-only Claude data**: Never write to `~/.claude/`. Our status layer is completely separate.

4. **Default status**: Sessions from Claude that aren't in our DB default to "Inactive".

5. **Active detection**: When a terminal is opened, mark as Active. When closed, mark as Inactive (unless explicitly marked Done).

6. **Terminal drawer**: Single drawer with tabs for multiple active terminals. Each tab shows the session name/summary. Tabs can be closed individually.

7. **Context-aware scope**: App filters sessions based on `process.cwd()` at startup. Run from `~/Bridge` to see Bridge sessions, from `~` to see all.
