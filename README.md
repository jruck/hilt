# Hilt

A visual dashboard for managing Claude Code sessions. Organize your work with a Kanban board, browse project documentation, and inspect Claude's configuration stack—all from one interface.

## Core Concepts

Hilt provides three primary views, accessible via the top navigation:

| View | Purpose |
|------|---------|
| **Tasks** | Kanban board or tree view for organizing Claude Code sessions |
| **Docs** | Browse and edit markdown files in your project |
| **Stack** | Inspect Claude's configuration hierarchy (System → User → Project → Local) |

## Features

### Tasks View

The Tasks view has two modes, toggled with the icon button next to the view selector:

**Board Mode (Kanban)**
- **Four Columns** - To Do (drafts), Active (in progress), Review (needs attention), Done (completed)
- **Drag & Drop** - Move sessions between columns with smooth animations
- **Multi-Select** - Batch move multiple sessions with Cmd/Ctrl+Click
- **Draft Prompts** - Queue prompts in the To Do column before starting sessions
- **Session Starring** - Pin important sessions to the top of Done

**Tree Mode**
- **Fractal Visualization** - See sessions as nested rectangles sized by activity
- **Heat Scoring** - More active projects appear larger
- **Hierarchical Navigation** - Click into folders to zoom in on project areas

### Docs View

Browse and edit your project's markdown documentation without leaving the app:

- **File Tree Sidebar** - Navigate your project's file structure
- **Markdown Editor** - Edit files with syntax highlighting and live preview
- **Code Viewer** - View non-markdown files with syntax highlighting
- **Wikilinks Support** - Click `[[links]]` to navigate between docs
- **Resizable Panels** - Drag the sidebar edge to resize

### Stack View

Inspect Claude's configuration files across all four layers:

- **Layer Tabs** - Switch between System, User, Project, and Local configs
- **File Browser** - See all config files (CLAUDE.md, settings.json, hooks, commands)
- **Inline Editing** - Edit configuration files directly in the app
- **Search Filtering** - Filter files by name in the sidebar

### Live Session Detection
- **Running Indicator** - Pulsing green dot shows when a session is actively running
- **Auto-Promote** - Running sessions automatically move to Active
- **New Session Glow** - Green highlight for newly discovered sessions
- **Real-Time Updates** - Board refreshes to detect new sessions and file changes

### Terminal Integration
- **Resizable Drawer** - Terminal panel slides in from the right
- **Multiple Tabs** - Open and switch between multiple sessions simultaneously
- **Live Output** - Real-time terminal emulation via xterm.js
- **Status Extraction** - Displays Claude's current task from terminal title
- **Context Tracking** - Shows Claude's context window usage percentage

### Plan Mode
- **Plan Detection** - Automatically detects when Claude creates plan files
- **Rich Editor** - Full markdown support (tables, code blocks, syntax highlighting)
- **Plan-Only View** - Review plans without starting a terminal session
- **Multi-Plan Support** - Sessions with multiple plans show badge count

### Navigation & Filtering
- **Breadcrumb Nav** - Click path segments to navigate project hierarchy
- **Pinned Folders** - Pin frequently used folders to the sidebar
- **Global Search** - Filter by title, prompt, slug, project, or git branch
- **Plan Filter** - Show only sessions with associated plan files
- **URL-Based State** - Scope persisted in URL for bookmarking/sharing

### Native Desktop App
- **Electron Wrapper** - Run as a native macOS application
- **IPC Transport** - Terminal communication via Electron IPC (no WebSocket needed)
- **Standalone Build** - Embedded Next.js server for self-contained distribution
- **DMG Installer** - Easy installation via drag-and-drop

## Getting Started

### Quick Install

```bash
git clone https://github.com/jruck/hilt.git
cd hilt
./install.sh
```

The install script will:
- Check for Node.js 18.18+ and build tools
- Install dependencies (including native module compilation)
- Create the `~/.hilt/data` directory
- Optionally add a `hilt` command to your shell

### Prerequisites

- **Node.js 18.18+** - [Download](https://nodejs.org/) or use [nvm](https://github.com/nvm-sh/nvm)
- **Build tools** - Required for native module compilation:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `sudo apt-get install build-essential python3`
- **Claude Code CLI** - The `claude` command should be available

### Manual Installation

If you prefer not to use the install script:

```bash
git clone https://github.com/jruck/hilt.git
cd hilt
npm install
mkdir -p ~/.hilt/data
```

### Running the App

**Browser Mode:**
```bash
npm run dev:all
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
(If port 3000 is busy, check the terminal output for the actual port)

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
│ Session    │  │ Plan Files │  │ PTY Mgr    │  │ File Watchers    │
│ ~/.claude/ │  │ ~/.claude/ │  │ claude CLI │  │ Real-time events │
│ projects/  │  │ plans/     │  │            │  │                  │
└────────────┘  └────────────┘  └────────────┘  └──────────────────┘
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
| `npm run dev:all` | **Start development** (Next.js + WebSocket + Event servers) |
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

## Troubleshooting

### Installation Issues

**node-pty compilation fails**
```bash
# macOS: Reinstall Xcode CLI tools
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install

# Then retry
rm -rf node_modules
npm install
```

**Permission errors on npm install**
```bash
# Fix npm permissions (don't use sudo with npm install)
sudo chown -R $(whoami) ~/.npm
```

**Port 3000 already in use**

Hilt auto-increments to the next available port. Check the terminal output for the actual URL.

### Runtime Issues

**Sessions not appearing**

Ensure Claude Code has been used in the scoped directory. Sessions are read from `~/.claude/projects/`.

**Terminal not connecting**

The WebSocket server runs on port 3001. Check that it started successfully in the terminal output.

## License

MIT
