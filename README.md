# Hilt

A Kanban-style board for managing Claude Code sessions. Visualize, organize, and run your Claude Code sessions from a clean, drag-and-drop interface.

## Features

### Session Management
- **Three-Column Board** - Organize sessions across To Do (drafts), In Progress (active), and Recent (completed)
- **Tree View** - Fractal workspace visualization with heat-score based sizing
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
- **Collapsible Sidebar** - Pin frequently used folders for quick access
- **Recent Scopes** - Quick access to frequently visited folders
- **URL-Based State** - Scope persisted in URL for bookmarking/sharing

### Search & Filtering
- **Global Search** - Filter by title, prompt, slug, project, or git branch
- **Plan Filter** - Show only sessions with associated plan files
- **Time Groupings** - Recent column groups by Today, Yesterday, This Week, etc.

### Native Desktop App
- **Electron Wrapper** - Run as a native macOS application
- **IPC Transport** - Terminal communication via Electron IPC (no WebSocket needed)
- **Standalone Build** - Embedded Next.js server for self-contained distribution
- **DMG Installer** - Easy installation via drag-and-drop

## Getting Started

### Prerequisites

- Node.js 20+
- Claude Code CLI installed (`claude` command available)

### Installation

```bash
git clone https://github.com/yourusername/hilt.git
cd hilt
npm install
```

### Running the App

**Browser Mode:**
```bash
npm run dev:all
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

**Native macOS App:**
```bash
npm run electron:dev
```
Launches the Electron app with hot reload for development.

**Build for Distribution:**
```bash
npm run electron:build
```
Creates a DMG installer in the `dist/` folder.

## Documentation

Detailed documentation is available in the [`docs/`](docs/) folder:

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow diagrams, constraints |
| [API Reference](docs/API.md) | All REST endpoints and WebSocket protocol |
| [Data Models](docs/DATA-MODELS.md) | TypeScript interfaces, Zod schemas, storage formats |
| [Components](docs/COMPONENTS.md) | React component hierarchy and props |
| [Development](docs/DEVELOPMENT.md) | Setup, debugging, common patterns |
| [Design Philosophy](docs/DESIGN-PHILOSOPHY.md) | UI/UX preferences and patterns for AI assistants |
| [Changelog](docs/CHANGELOG.md) | Version history with technical notes |

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

For detailed architecture documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Next.js 16 + React 19 | UI and API routes |
| Language | TypeScript 5 | Type safety |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| Drag & Drop | dnd-kit | Kanban card movement |
| Terminal | xterm.js | Terminal emulation |
| Editor | MDXEditor | Plan markdown editing |
| Data Fetching | SWR | Server state + polling |
| WebSocket | ws + node-pty | Real-time PTY I/O |
| Validation | Zod | Schema validation |

## Claude Code Integration

Custom slash commands for use within Claude Code sessions:

| Command | Description |
|---------|-------------|
| `/hilt` | Open Hilt UI in your browser |
| `/track [type] [desc]` | Track bugs, tasks, ideas, or decisions |
| `/plan [description]` | Create a feature plan document |
| `/commit` | Pre-commit checklist with documentation verification |
| `/docs-check` | Verify documentation is in sync with code |

Commands are defined in `.claude/commands/` and work in any Claude Code session within this project.

## Project Structure

```
hilt/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── [[...path]]/        # URL-based scope routing
│   │   └── api/                # REST API routes
│   ├── components/             # React components
│   ├── hooks/                  # Custom React hooks
│   └── lib/                    # Core utilities
├── server/
│   └── ws-server.ts            # WebSocket + PTY server
├── electron/                   # Native desktop app
│   ├── main.ts                 # Main process with IPC handlers
│   ├── preload.ts              # contextBridge API
│   └── launcher.cjs            # tsx loader for dev
├── build/                      # Build assets
│   ├── icon.svg                # Source icon (🗡️)
│   └── icon.icns               # macOS app icon
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md         # System design
│   ├── API.md                  # API reference
│   ├── DATA-MODELS.md          # Type definitions
│   ├── COMPONENTS.md           # Component docs
│   ├── DEVELOPMENT.md          # Dev guide
│   ├── DESIGN-PHILOSOPHY.md    # UI/UX preferences
│   └── CHANGELOG.md            # Version history
├── .claude/
│   ├── commands/               # Slash commands
│   ├── hooks/                  # Automation hooks
│   └── settings.json           # Hook configuration
└── data/                       # Persistent storage (gitignored)
```

For detailed file descriptions, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#directory-structure).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start Next.js and WebSocket servers |
| `npm run dev` | Start Next.js dev server only |
| `npm run ws-server` | Start WebSocket server only |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run electron:dev` | Start Electron app in dev mode |
| `npm run electron:build` | Build native macOS app |
| `npm run electron:rebuild` | Rebuild native modules for Electron |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close terminal drawer / deselect sessions |
| Click + Drag | Move sessions between columns |
| `Cmd/Ctrl + Click` | Multi-select sessions |

## Contributing

Before making changes:
1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system context
2. Check [docs/CHANGELOG.md](docs/CHANGELOG.md) for recent changes
3. **For UI work**: Read [docs/DESIGN-PHILOSOPHY.md](docs/DESIGN-PHILOSOPHY.md) for design preferences

After completing work:
1. Update [docs/CHANGELOG.md](docs/CHANGELOG.md) under `[Unreleased]`
2. Update relevant docs if architecture/API/types changed
3. **For UI work**: Update [docs/DESIGN-PHILOSOPHY.md](docs/DESIGN-PHILOSOPHY.md) if new patterns or preferences were learned

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed development guidelines.

## License

MIT
