# Changelog

All notable changes to Claude Kanban are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added

- **Electron IPC Transport** - Native desktop app with IPC-based terminal communication
  - Replaces WebSocket with Electron IPC for PTY communication when running as native app
  - `electron/main.ts` - Main process with IPC handlers, embedded Next.js server, PTY manager
  - `electron/preload.ts` - contextBridge API for secure renderer-to-main communication
  - `electron/launcher.cjs` - tsx loader for TypeScript execution in development
  - Dual-mode transport in `Terminal.tsx` - auto-detects Electron vs browser environment
  - macOS hardened runtime with code signing entitlements
  - electron-builder configuration for DMG distribution
  - App icon using 🧱 (bricks) emoji

- **Tree View Action Buttons** - Session cards in Tree View now show action toolbar on hover
  - Select, Open, and Mark as Done buttons appear on larger cards (render levels 1-2)
  - Matches floating toolbar pattern from Kanban SessionCard
  - Smaller cards (levels 3-4) omit buttons due to space constraints
  - Files: `src/components/TreeSessionCard.tsx`, `src/components/TreeView.tsx`

### Fixed

- **Tree View Title Priority** - Session cards now always show title first, not last message
  - Level 1: Title, optional slug, lastPrompt preview (only if different from title)
  - Level 2: Title only (removed lastPrompt to focus on what matters)
  - Level 3-4: Truncated title or status dot
  - Previously could show lastPrompt when title should be primary

- **Design Philosophy Document** - Living document capturing UI/UX preferences for AI assistants
  - `docs/DESIGN-PHILOSOPHY.md` - Core principles, specific patterns, interaction preferences
  - Evolution Log section for tracking design decisions over time
  - Integrated into commit hooks, `/commit`, `/docs-check` workflows
  - Added to CLAUDE.md as required reading before UI work

- **Documentation System** - Comprehensive docs for AI agents and developers
  - `docs/ARCHITECTURE.md` - System design, data flow, constraints (556 lines)
  - `docs/API.md` - All API routes and WebSocket protocol (509 lines)
  - `docs/DATA-MODELS.md` - TypeScript types and schemas (438 lines)
  - `docs/COMPONENTS.md` - React component hierarchy (626 lines)
  - `docs/DEVELOPMENT.md` - Setup, debugging, patterns (350 lines)
  - `docs/CHANGELOG.md` - Version history with technical notes

- **Documentation Enforcement** - Hooks and commands to ensure docs stay updated
  - PostToolUse hook reminds agents to update docs after code changes
  - `/commit` command checks documentation before committing
  - `/docs-check` command verifies docs are in sync with code
  - Files: `.claude/settings.json`, `.claude/hooks/docs-reminder.sh`, `.claude/commands/commit.md`, `.claude/commands/docs-check.md`

### Changed

- **CLAUDE.md** - Added documentation protocol instructions for AI agents
- **README.md** - Reorganized with documentation index, relative links to docs/, contributing section

---

## [0.2.0] - 2025-01-06

Major release introducing Tree View visualization, collapsible sidebar, and significant UI polish.

### Added

- **Tree View** - Fractal workspace visualization using squarified treemap layout
  - Heat-score based sizing (recency + volume + running status)
  - Four render levels adapting to rectangle size
  - Click folders to navigate, click sessions to open terminal
  - Files: `src/components/TreeView.tsx`, `src/components/TreeNodeCard.tsx`, `src/components/TreeSessionCard.tsx`, `src/lib/tree-utils.ts`, `src/lib/treemap-layout.ts`, `src/lib/heat-score.ts`

- **View Toggle** - Switch between Tree, Board, and Docs views
  - Centered in status bar with absolute positioning
  - Persists preference in localStorage
  - Files: `src/components/ViewToggle.tsx`, `src/components/Board.tsx`

- **Docs Tab** - Placeholder for future documentation view
  - Shows "Coming Soon" message when selected

- **Collapsible Sidebar** - Left sidebar with pinned folders
  - Pin/unpin folders from breadcrumb navigation
  - Drag-and-drop reordering of pinned folders (dnd-kit)
  - Session count badges (blue: To Do, green: In Progress, pulsing: running)
  - 256px expanded, 48px collapsed
  - Files: `src/components/sidebar/*`, `src/lib/pinned-folders.ts`, `src/hooks/usePinnedFolders.ts`, `src/hooks/useSidebarState.ts`

- **Reference Processing** - Process URLs as reference material
  - Bookmark icon action on inbox cards
  - YouTube transcript extraction via API
  - Firecrawl/WebFetch fallback for other URLs
  - Files: `src/app/api/firecrawl/route.ts`, `src/app/api/youtube-transcript/route.ts`

- **Todo Refinement Mode** - Refine drafts with AI assistance
  - Brain icon action on inbox cards
  - Routes to Claude with refinement instructions
  - File: `src/components/InboxCard.tsx`

- **Floating Action Toolbar** - Notion-style toolbar for card actions
  - Replaces gradient background approach
  - Contextual colors (blue for To Do, emerald for active)
  - Files: `src/components/SessionCard.tsx`, `src/components/InboxCard.tsx`

### Changed

- **Renamed "Kanban" to "Board"** in UI for cleaner naming
  - Migration for users with 'kanban' stored in localStorage

- **Scope Navigation** - URL path-based routing instead of query params
  - URL now reflects scope directly: `/Users/jruck/Work/Code/project`
  - Root "/" shows all projects
  - Files: `src/app/[[...path]]/page.tsx`, `src/components/scope/*`

- **Scope Filtering** - Exact match for Board, prefix match for Tree
  - Board: `projectPath === scopePath`
  - Tree: `projectPath.startsWith(scopePath)` for hierarchy rollup

- **Terminal Stability** - Added `terminalId` field to sessions
  - Stable ID that doesn't change when temp session matches real UUID
  - Prevents terminal reload/continue issues
  - Files: `src/lib/types.ts`, `src/components/Terminal.tsx`, `src/components/TerminalDrawer.tsx`

- **Color Palette** - Replaced all `green-*` with `emerald-*` throughout app

- **Status Bar** - Reduced height from 56px to 44px for compactness

### Fixed

- Terminal reload when session ID changes from temp to real
- Breadcrumb navigation glitch and state sync issues
- Root navigation clicking "/" now goes directly to all projects
- Todos appearing in All Projects view (was showing kanban's own Todo.md)
- Scope navigation page reloads (now instant with SWR `keepPreviousData`)
- Breadcrumb flash during navigation (cache homeDir in localStorage)
- Duplicate React key errors in Tree View
- All ESLint errors (14 → 0)
- Tree View height bug (container was 56px instead of full height)

### Technical Notes

- New squarified treemap algorithm in `src/lib/treemap-layout.ts` (no D3 dependency)
- Heat score formula: `0.6*recency + 0.3*volume + runningBonus`
- Tree building uses prefix filtering and metrics aggregation in `src/lib/tree-utils.ts`
- Client-side page component with React `use()` hook for instant navigation

---

## [0.1.1] - 2024-12-20

UI polish and live session detection.

### Added

- **Running Session Detection** - Pulsing green dot for active sessions
  - Auto-detection based on 30-second file modification threshold
  - Automatically promotes running sessions to In Progress
  - Files: `src/lib/claude-sessions.ts`, `src/components/SessionCard.tsx`

- **New Session Glow** - Green highlight effect for newly discovered sessions
  - 60-second fade animation with "NEW" label
  - Files: `src/components/Board.tsx`, `src/components/SessionCard.tsx`

- **Time-Based Dividers** - Group Recent column by time period
  - Starred, Today, Yesterday, This Week, Last Week, This Month, Older
  - Collapsible headers with session counts
  - File: `src/components/Column.tsx`

- **Custom Session Titles** - Support for `/rename` command titles
  - Uses most recent summary for session title
  - File: `src/lib/claude-sessions.ts`

- **Plan Filter** - Show only sessions with associated plan files
  - Plan-only viewing mode (view plans without starting terminal)
  - Files: `src/components/Board.tsx`, `src/components/SessionCard.tsx`

- **MDXEditor Dark Theme** - Comprehensive styling for plan editor
  - Tables, tooltips, CodeMirror syntax highlighting
  - File: `src/app/globals.css`

### Changed

- Session action icon from trash to checkmark (reflects "Mark as done" action)
- Drawer resize handle lightens border on hover (not thickens)
- Moved drawer toggle to In Progress column header
- Moved search to right side of toolbar

### Fixed

- Board scroll when drawer is resized wide (dynamic padding)
- Plan view layout shift and false unsaved indicator
- Running session bounce-back issues
- Subfolder dropdown alignment
- Recent column spacing to match To Do column

---

## [0.1.0] - 2024-12-15

Initial release of Claude Kanban.

### Added

- **Three-Column Kanban Board** - To Do, In Progress, Recent
  - Drag-and-drop session management with dnd-kit
  - Multi-select for batch operations
  - Session starring to pin to top of Recent

- **Session Discovery** - Reads Claude's JSONL files from `~/.claude/projects/`
  - Parses session metadata (title, branch, messages, slugs)
  - Merges with persistent kanban status
  - Real-time updates via 5-second SWR polling

- **Terminal Integration** - Embedded xterm.js terminal
  - Resizable drawer (400-1200px)
  - Multiple tabs for concurrent sessions
  - OSC sequence parsing for dynamic titles
  - Context progress extraction

- **Plan Mode** - MDXEditor for plan markdown files
  - Full markdown support (tables, code blocks, syntax highlighting)
  - Detects plans created during sessions
  - Unsaved changes indicator

- **Scope Navigation** - Browse projects by folder
  - Breadcrumb navigation
  - All Projects view
  - Recent scopes dropdown
  - Subfolder browser

- **Draft Prompts (Inbox)** - Queue prompts before starting sessions
  - In-card editing
  - Section organization via markdown headers in Todo.md
  - Quick start sessions from drafts

- **Electron Wrapper** - Native macOS app
  - Custom kanban-style icon
  - Server lifecycle management
  - DMG distribution via electron-builder

- **Session Metadata Display**
  - Current task from terminal title
  - Last prompt preview
  - Project path (clickable)
  - Git branch
  - Message count
  - Relative timestamps

### Technical Notes

- Next.js 16 + React 19 frontend
- Separate WebSocket server for PTY management (port 3001)
- Status persisted in `data/session-status.json`
- Inbox persisted in `data/inbox.json` or project's `Todo.md`
- Electron main process in `electron/main.js`
