# Claude Kanban

A Kanban-style board for managing Claude Code sessions. Visualize, organize, and run your Claude Code sessions from a clean, drag-and-drop interface.

## Features

- **Kanban Board** - Organize sessions across four columns: To Do, In Progress, Saved, and Done
- **Draft Prompts** - Queue up prompts in the inbox before starting sessions
- **Live Terminal** - Run Claude Code sessions directly in the browser with real-time terminal output
- **Session Discovery** - Automatically reads existing sessions from `~/.claude/projects/`
- **Project Scoping** - Filter sessions by project folder
- **Drag & Drop** - Reorder and move sessions between columns
- **Multi-Select** - Batch move multiple sessions at once
- **Session Metadata** - View git branch, message count, and last activity at a glance

## Tech Stack

**Frontend**
- Next.js 16 with React 19
- TypeScript 5
- Tailwind CSS 4
- dnd-kit for drag-and-drop
- xterm.js for terminal emulation
- SWR for data fetching

**Backend**
- WebSocket server for real-time terminal I/O
- node-pty for pseudo-terminal management
- chokidar for file system watching

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

Start both the Next.js dev server and WebSocket server:

```bash
npm run dev:all
```

Or run them separately:

```bash
npm run dev        # Next.js on port 3000
npm run ws-server  # WebSocket server on port 3001
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Next.js Frontend (port 3000)               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Board → Columns → Cards → Terminal Drawer      │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↕ SWR                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  API Routes: /sessions, /inbox, /folders        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          ↕ WebSocket
┌─────────────────────────────────────────────────────────┐
│            WebSocket Server (port 3001)                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  PTY Manager → Spawns shells, streams I/O       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          ↕ Reads/Writes
┌─────────────────────────────────────────────────────────┐
│  Storage                                                │
│  - data/session-status.json (UI state)                 │
│  - data/inbox.json (draft prompts)                     │
│  - ~/.claude/projects/*.jsonl (Claude Code sessions)   │
└─────────────────────────────────────────────────────────┘
```

### Session Discovery

The app reads Claude Code's JSONL session files from `~/.claude/projects/`. Each project folder is encoded (e.g., `/Users/you/project` becomes `-Users-you-project`), and the app decodes these paths to display human-readable project names.

### Terminal Integration

When you open a session, the app:
1. Spawns a PTY (pseudo-terminal) via the WebSocket server
2. Runs `claude --resume {sessionId}` for existing sessions
3. For new sessions, spawns Claude Code and injects your prompt
4. Streams terminal output back to the browser in real-time

## Project Structure

```
claude-kanban/
├── src/
│   ├── app/
│   │   ├── page.tsx           # Main board page
│   │   ├── layout.tsx         # Root layout
│   │   ├── globals.css        # Tailwind styles
│   │   └── api/
│   │       ├── sessions/      # Session CRUD
│   │       ├── inbox/         # Draft prompts
│   │       └── folders/       # Folder discovery
│   ├── components/
│   │   ├── Board.tsx          # Kanban board
│   │   ├── Column.tsx         # Board column
│   │   ├── SessionCard.tsx    # Session card
│   │   ├── InboxCard.tsx      # Draft prompt card
│   │   ├── TerminalDrawer.tsx # Terminal side panel
│   │   └── Terminal.tsx       # xterm.js wrapper
│   ├── hooks/
│   │   ├── useSessions.ts     # Session data hook
│   │   └── useInboxItems.ts   # Inbox data hook
│   └── lib/
│       ├── types.ts           # TypeScript types
│       ├── db.ts              # JSON file storage
│       └── claude-sessions.ts # JSONL parsing
├── server/
│   └── ws-server.ts           # WebSocket + PTY server
├── data/                      # Persistent storage
├── package.json
└── tsconfig.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run ws-server` | Start WebSocket server |
| `npm run dev:all` | Start both servers |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |

## License

MIT
