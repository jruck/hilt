# Claude Kanban

A Kanban-style board for managing Claude Code sessions. Visualize, organize, and run your Claude Code sessions from a clean, drag-and-drop interface.

## Features

### Session Management
- **Three-Column Board** - Organize sessions across To Do (drafts), In Progress (active), and Recent (completed)
- **Drag & Drop** - Move sessions between columns with smooth animations
- **Multi-Select** - Batch move multiple sessions at once
- **Session Starring** - Pin important sessions to the top of Recent

### Live Session Detection
- **Running Indicator** - Pulsing green dot shows when a session is actively running
- **Auto-Promote** - Running sessions automatically move to In Progress
- **New Session Glow** - Green highlight effect for newly discovered sessions
- **Real-Time Updates** - Board refreshes every 5 seconds to detect new sessions

### Draft Prompts (To Do Column)
- **Queue Prompts** - Write prompts before starting sessions
- **Section Organization** - Group drafts with markdown headers in Todo.md
- **Quick Start** - Launch a new session from any draft with one click
- **In-Card Editing** - Edit and delete drafts without leaving the board

### Terminal Integration
- **Resizable Drawer** - Terminal panel slides in from the right (400-1200px)
- **Multiple Tabs** - Open and switch between multiple sessions simultaneously
- **Live Output** - Real-time terminal emulation via xterm.js
- **Status Extraction** - Displays Claude's current task from terminal title
- **Context Tracking** - Shows Claude's context window usage percentage

### Plan Mode
- **Plan Detection** - Automatically detects when Claude creates plans
- **Rich Editor** - MDXEditor with full markdown support (tables, code blocks, syntax highlighting)
- **Plan-Only View** - Review plans without starting a terminal session
- **Multi-Plan Support** - Sessions with multiple plans show badge count
- **Unsaved Changes** - Visual indicator when plan has unsaved edits

### Scope Navigation
- **Breadcrumb Nav** - Click path segments to navigate project hierarchy
- **All Projects View** - Root "/" shows sessions across all projects
- **Subfolder Dropdown** - Browse into nested folders
- **Recent Scopes** - Quick access to frequently visited folders
- **URL-Based State** - Scope persisted in URL for bookmarking/sharing

### Search & Filtering
- **Global Search** - Filter by title, prompt, slug, project, or git branch
- **Plan Filter** - Show only sessions with associated plan files
- **Time Groupings** - Recent column groups by Today, Yesterday, This Week, etc.

### Session Metadata
- **Live Status** - Current task from terminal title
- **Last Prompt** - Preview of most recent user message
- **Project Path** - Clickable link to open in Finder
- **Git Branch** - Current branch for sessions with git context
- **Message Count** - Number of messages in session
- **Relative Time** - "3m ago", "Yesterday", etc.

## Claude Code Integration

Custom slash commands for use within Claude Code sessions:

| Command | Description |
|---------|-------------|
| `/kanban` | Open the Kanban UI in your browser |
| `/track [type] [desc]` | Track bugs, tasks, ideas, or decisions |
| `/plan [description]` | Create a feature plan document |

Commands are defined in `.claude/commands/` and work in any Claude Code session within this project.

## Tech Stack

**Frontend**
- Next.js 16 with React 19
- TypeScript 5
- Tailwind CSS 4
- dnd-kit for drag-and-drop
- xterm.js + addon-fit for terminal emulation
- MDXEditor with CodeMirror for plan editing
- SWR for data fetching with real-time polling
- Lucide React for icons

**Backend**
- Next.js API routes
- WebSocket server (ws) for PTY management
- node-pty for pseudo-terminal spawning
- Zod for schema validation

## Getting Started

### Prerequisites

- Node.js 20+
- Claude Code CLI installed (`claude` command available)

### Installation

```bash
git clone https://github.com/yourusername/claude-kanban.git
cd claude-kanban
npm install
```

### Running the App

```bash
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Next.js React App                                         │  │
│  │  Board • Columns • SessionCards • Terminal • PlanEditor    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
         ┌──────────────────┐        ┌──────────────────┐
         │   Next.js API    │        │  WebSocket Server │
         │   port 3000      │        │   port 3001       │
         └──────────────────┘        └──────────────────┘
                    │                           │
          ┌─────────┴─────────┐                 │
          ▼                   ▼                 ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Session Data    │ │   Plan Files     │ │   PTY Manager    │
│  ~/.claude/      │ │  ~/.claude/plans │ │  Claude Code CLI │
│  projects/*.jsonl│ │  /{slug}.md      │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### Data Flow

1. **Session Discovery** - Reads Claude's JSONL files from `~/.claude/projects/{encoded-path}/`
2. **Status Merge** - Combines Claude's session metadata with persisted Kanban status
3. **Real-Time Updates** - SWR polling every 5 seconds, detects file changes for running sessions
4. **Terminal Spawning** - WebSocket sends spawn message, PTY server starts `claude --resume` or new session
5. **Plan Detection** - WebSocket broadcasts events when plans are created/updated during sessions

### Data Persistence

| File | Purpose |
|------|---------|
| `data/session-status.json` | Kanban column status, sort order, starred state |
| `data/inbox.json` | Draft prompts (fallback when no Todo.md) |
| `~/.claude/projects/` | Session JSONL files (read-only, owned by Claude) |
| `~/.claude/plans/` | Plan markdown files |
| `./Todo.md` | Project-specific draft prompts (per scope) |

## Project Structure

```
claude-kanban/
├── src/
│   ├── app/
│   │   ├── [[...path]]/page.tsx  # URL-based scope routing
│   │   ├── layout.tsx            # Root layout
│   │   ├── globals.css           # Tailwind + MDXEditor styles
│   │   └── api/
│   │       ├── sessions/         # Session list & status updates
│   │       ├── inbox/            # Todo.md parsing & management
│   │       ├── plans/[slug]/     # Plan CRUD
│   │       ├── folders/          # Scope browsing & validation
│   │       ├── reveal/           # Finder integration
│   │       └── cwd/              # Current working directory
│   ├── components/
│   │   ├── Board.tsx             # Main kanban board, state management
│   │   ├── Column.tsx            # Individual column with grouping
│   │   ├── SessionCard.tsx       # Session display with actions
│   │   ├── InboxCard.tsx         # Draft prompt card
│   │   ├── NewDraftCard.tsx      # Create new draft input
│   │   ├── TerminalDrawer.tsx    # Terminal panel with tabs
│   │   ├── Terminal.tsx          # xterm.js wrapper
│   │   ├── PlanEditor.tsx        # MDXEditor for plans
│   │   └── scope/
│   │       ├── ScopeBreadcrumbs.tsx   # Breadcrumb navigation
│   │       ├── BrowseButton.tsx       # File picker
│   │       ├── RecentScopesButton.tsx # Recent folders dropdown
│   │       └── SubfolderDropdown.tsx  # Subfolder browser
│   ├── hooks/
│   │   ├── useSessions.ts        # Session data fetching & mutations
│   │   └── useInboxItems.ts      # Inbox data hook
│   └── lib/
│       ├── types.ts              # Zod schemas & TypeScript types
│       ├── db.ts                 # Status & inbox file I/O
│       ├── claude-sessions.ts    # JSONL parsing & running detection
│       ├── recent-scopes.ts      # localStorage scope tracking
│       ├── todo-md.ts            # Todo.md parsing
│       └── pty-manager.ts        # PTY spawning utilities
├── server/
│   └── ws-server.ts              # WebSocket + PTY server
├── data/                         # Persistent storage (gitignored)
├── package.json
└── tsconfig.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start Next.js and WebSocket servers |
| `npm run dev` | Start Next.js dev server only |
| `npm run ws-server` | Start WebSocket server only |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close terminal drawer / deselect sessions |
| Click + Drag | Move sessions between columns |
| `Cmd/Ctrl + Click` | Multi-select sessions |

## License

MIT
