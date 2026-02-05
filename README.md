# Hilt

A project dashboard with three views: Bridge (weekly tasks & projects), Docs (markdown editor), and Stack (Claude configuration inspector).

## Core Concepts

Hilt provides three primary views, accessible via the top navigation:

| View | Purpose |
|------|---------|
| **Bridge** | Weekly task management, project tracking, and notes |
| **Docs** | Browse and edit markdown files in your project |
| **Stack** | Inspect Claude's configuration hierarchy (System → User → Project → Local) |

## Features

### Bridge View

Weekly planning and project management:

- **Task List** — Drag-and-drop task ordering with checkboxes
- **Projects** — Track project status, notes, and frontmatter
- **Weekly Notes** — Markdown notes organized by week
- **Real-Time Updates** — File watcher detects changes to vault files

### Docs View

Browse and edit your project's markdown documentation:

- **File Tree Sidebar** — Navigate your project's file structure
- **Markdown Editor** — Edit files with syntax highlighting and live preview
- **Code Viewer** — View non-markdown files with syntax highlighting
- **Wikilinks Support** — Click `[[links]]` to navigate between docs
- **Resizable Panels** — Drag the sidebar edge to resize

### Stack View

Inspect Claude's configuration files across all four layers:

- **Layer Tabs** — Switch between System, User, Project, and Local configs
- **File Browser** — See all config files (CLAUDE.md, settings.json, hooks, commands)
- **Inline Editing** — Edit configuration files directly in the app
- **Search Filtering** — Filter files by name in the sidebar

### Navigation & Filtering

- **Breadcrumb Nav** — Click path segments to navigate project hierarchy
- **Pinned Folders** — Pin frequently used folders to the sidebar
- **Global Search** — Filter content across views
- **URL-Based State** — Scope persisted in URL for bookmarking/sharing

### Native Desktop App

- **Electron Wrapper** — Run as a native macOS application
- **Standalone Build** — Embedded Next.js server for self-contained distribution
- **DMG Installer** — Easy installation via drag-and-drop

## Getting Started

### Prerequisites

- **Node.js 18.18+** — [Download](https://nodejs.org/) or use [nvm](https://github.com/nvm-sh/nvm)
- **Claude Code CLI** — The `claude` command should be available

### Installation

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

**Native macOS App:**
```bash
npm run electron:dev
```

**Build for Distribution:**
```bash
npm run electron:build
```

## Documentation

Detailed documentation is available in the [`docs/`](docs/) folder:

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow diagrams, constraints |
| [API Reference](docs/API.md) | All REST endpoints and WebSocket protocol |
| [Data Models](docs/DATA-MODELS.md) | TypeScript interfaces and storage formats |
| [Components](docs/COMPONENTS.md) | React component hierarchy and props |
| [Development](docs/DEVELOPMENT.md) | Setup, debugging, common patterns |
| [Design Philosophy](docs/DESIGN-PHILOSOPHY.md) | UI/UX preferences and patterns |
| [Changelog](docs/CHANGELOG.md) | Version history with technical notes |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Next.js React App                                         │  │
│  │  Board • Bridge • Docs • Stack                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  Next.js API     │  │  WebSocket       │  │  Event Server    │
   │  port 3000       │  │  port 3001       │  │  port 3002       │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  Plan Files      │  │  Bridge Vault    │  │  File Watchers   │
   │  ~/.claude/      │  │  (configurable)  │  │  Real-time       │
   │  plans/          │  │                  │  │  events           │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Next.js 16 + React 19 | UI and API routes |
| Language | TypeScript 5 | Type safety |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| Drag & Drop | dnd-kit | Task and folder reordering |
| Editor | TipTap + CodeMirror | Rich text and code editing |
| Data Fetching | SWR | Server state + polling |
| WebSocket | ws | Real-time file change events |
| Validation | Zod | Schema validation |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:all` | **Start development** (Next.js + WebSocket + Event servers) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run electron:dev` | Start Electron app in dev mode |
| `npm run electron:build` | Build native macOS app |

## Contributing

Before making changes:
1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system context
2. Check [docs/CHANGELOG.md](docs/CHANGELOG.md) for recent changes
3. **For UI work**: Read [docs/DESIGN-PHILOSOPHY.md](docs/DESIGN-PHILOSOPHY.md) for design preferences

After completing work:
1. Update [docs/CHANGELOG.md](docs/CHANGELOG.md) under `[Unreleased]`
2. Update relevant docs if architecture/API/types changed

## License

MIT
