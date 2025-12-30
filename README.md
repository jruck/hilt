# Claude Kanban

A Kanban-style board for managing Claude Code sessions. Visualize, organize, and run your Claude Code sessions from a clean, drag-and-drop interface.

![Claude Kanban](build/icon.svg)

## Features

- **Native macOS App** - Standalone app with custom icon and proper window controls
- **Kanban Board** - Organize sessions across four columns: To Do, In Progress, Saved, and Done
- **Draft Prompts** - Queue up prompts in the inbox before starting sessions
- **Live Terminal** - Run Claude Code sessions directly in the app with real-time terminal output
- **Session Discovery** - Automatically reads existing sessions from `~/.claude/projects/`
- **Project Scoping** - Filter sessions by project folder
- **Drag & Drop** - Reorder and move sessions between columns
- **Multi-Select** - Batch move multiple sessions at once
- **Session Metadata** - View git branch, message count, and last activity at a glance

## Tech Stack

**Desktop**
- Electron 39 for native macOS app
- electron-builder for packaging and distribution

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

**Native App (Recommended)**

Run as a native macOS application with Electron:

```bash
npm run electron:dev
```

This starts Next.js, the WebSocket server, and opens the Electron window automatically.

**Browser Mode**

Alternatively, run in the browser:

```bash
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Distribution

Create a distributable `.dmg` file:

```bash
npm run electron:build
```

The output will be in the `release/` directory.

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  App Lifecycle • Window Management • Server Spawning  │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│         ┌────────────────────┼────────────────────┐         │
│         ▼                    ▼                    ▼         │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────┐    │
│  │  Renderer  │    │   Next.js    │    │  WebSocket   │    │
│  │  (Window)  │◄──►│  port 3000   │    │  port 3001   │    │
│  └────────────┘    └──────────────┘    └──────────────┘    │
│                           │                    │            │
│                           ▼                    ▼            │
│                    ┌─────────────────────────────────┐     │
│                    │         PTY Manager             │     │
│                    │    Spawns Claude Code shells    │     │
│                    └─────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Storage                                                     │
│  - data/session-status.json (UI state)                      │
│  - data/inbox.json (draft prompts)                          │
│  - ~/.claude/projects/*.jsonl (Claude Code sessions)        │
└─────────────────────────────────────────────────────────────┘
```

The Electron main process manages the app lifecycle and spawns both the Next.js server and WebSocket server as child processes. When the app window closes, all servers are gracefully shut down.

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
├── electron/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # IPC bridge for renderer
│   └── tsconfig.json        # TypeScript config for Electron
├── build/
│   ├── icon.svg             # App icon source
│   ├── icon.icns            # macOS app icon
│   └── entitlements.mac.plist
├── scripts/
│   ├── generate-icons.mjs   # SVG → PNG → ICNS converter
│   └── patch-electron.mjs   # Dev mode branding patch
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
├── electron-builder.json      # Build configuration
├── package.json
└── tsconfig.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run electron:dev` | Run native app in development mode |
| `npm run electron:build` | Build distributable DMG |
| `npm run dev` | Start Next.js dev server only |
| `npm run ws-server` | Start WebSocket server only |
| `npm run dev:all` | Start both servers (browser mode) |
| `npm run build` | Production build (Next.js) |
| `npm run lint` | Run ESLint |

## License

MIT
