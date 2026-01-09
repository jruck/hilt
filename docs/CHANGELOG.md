# Changelog

All notable changes to Claude Kanban are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Changed

- **Development startup simplified** - `npm run dev:all` now starts all three servers (Next.js, WebSocket, Event)
  - Added `event-server` npm script for the real-time event server
  - Updated `dev:all` to run all servers concurrently
  - Updated README.md, DEVELOPMENT.md, ARCHITECTURE.md to reflect this as the standard dev workflow
  - File: `package.json`

### Fixed

- **WebSocket error noise reduced** - `useEventSocket` no longer spams console when event server isn't running
  - Changed from `console.error` with empty object to single `console.warn` on first failure
  - Removed verbose connection/reconnection logging
  - Silently retries in background with exponential backoff
  - File: `src/hooks/useEventSocket.ts`

- **Session status detection bug** - Sessions waiting for tool approval now correctly appear in "Needs Attention" column
  - Bug: `turn_duration` JSONL entries were incorrectly clearing `pendingToolUses` array
  - This caused `waiting_for_approval` status to never be detected (always showed as `waiting_for_input`)
  - Fix: Removed premature clearing in `deriveSessionState()` - only `tool_result` entries should clear pending tools
  - File: `src/lib/session-status.ts`

- **Card styling priority** - Sessions needing attention now always show amber styling
  - Bug: `isNewlyAdded` check took precedence over `needsAttention`, so new sessions waiting for approval showed green instead of amber
  - Fix: Reordered conditions so `sessionNeedsAttention` is checked first
  - File: `src/components/SessionCard.tsx`

- **Card glow color** - "Newly added" glow effect now uses amber for cards needing attention
  - Bug: Glow was always green (emerald) regardless of card state
  - Fix: Glow color now matches card palette - amber for attention, green for normal active
  - File: `src/components/SessionCard.tsx`

- **Action toolbar color** - Hover toolbar now uses amber for cards needing attention
  - Bug: Toolbar was green when card was newly added, even if it needed attention
  - Fix: Reordered styling priority so `sessionNeedsAttention` takes precedence over `isNewlyAdded`
  - File: `src/components/SessionCard.tsx`

- **Event propagation delay** - Reduced delay for session status updates appearing in UI
  - Reduced SessionWatcher debounce from 200ms to 50ms
  - Reduced Chokidar stability threshold from 100ms to 50ms, poll interval from 50ms to 25ms
  - Added fallback refetch when session:updated event references unknown session
  - File: `server/watchers/session-watcher.ts`, `src/hooks/useSessions.ts`

### Changed

- **Stack View redesigned** - Now matches Docs Viewer polish and layout
  - Two-panel layout: resizable sidebar (180-500px) + content pane
  - Unified view showing all layers (Local, Project, User, System) with dividers
  - Collapsible layer sections with file counts
  - Breadcrumb navigation showing Layer → Type → File
  - Proper content viewers: CodeViewer for JSON, DocsEditor for markdown
  - Fixed CSS variables (`--border-primary` → `--border-default`)
  - Sidebar width persists to localStorage
  - Files: `src/components/stack/StackView.tsx`, `StackFileTree.tsx`, `StackContentPane.tsx`

- **Needs Attention column simplified** - Removed WAITING/IDLE section separators
  - Sessions are now just sorted by recency (most recent first)
  - Cleaner UI without unnecessary grouping dividers
  - File: `src/components/Column.tsx`

### Added

- **Stack View** - New view mode for visualizing and editing Claude Code configuration layers
  - Four-layer hierarchy: System (enterprise), User (~/.claude/), Project (.claude/), Local (gitignored)
  - Discovers all config file types: memory (CLAUDE.md), settings, commands, skills, agents, hooks, MCP servers
  - Three-panel UI: layer navigation, file browser grouped by type, file preview/editor
  - Create missing local files (CLAUDE.local.md, settings.local.json) with templates
  - Parse YAML frontmatter from commands/skills, JSON settings
  - Security: prevents writing to system layer, validates paths
  - Files: `src/lib/claude-config/`, `src/components/stack/`, `src/app/api/claude-stack/`, `src/hooks/useClaudeStack.ts`

- **Elapsed timer on status badges** - Ticking timer shows time since last activity
  - Displays next to Working, Needs Approval, and Waiting status badges
  - Format progresses: seconds (5s) → minutes (5m) → hours (2h 15m) → days (3d 5h)
  - Updates every second for accurate real-time tracking
  - File: `src/components/SessionCard.tsx`

- **Event-Driven Architecture (Phase 1)** - WebSocket infrastructure for real-time updates
  - New EventServer class for channel-based subscriptions and event broadcasting
  - `useEventSocket` hook for client-side WebSocket connection with auto-reconnect
  - `EventSocketProvider` context for app-wide WebSocket access
  - Path-based WebSocket routing: `/terminal` for PTY, `/events` for real-time events
  - Manual upgrade handling for multiple WebSocket servers on same HTTP server
  - Unit test scaffolding for EventServer and useEventSocket
  - Files: `server/event-server.ts`, `src/hooks/useEventSocket.ts`, `src/contexts/EventSocketContext.tsx`, `server/ws-server.ts`

- **Event-Driven Architecture (Phase 2)** - Session file watching and status derivation
  - SessionWatcher class using Chokidar to watch `~/.claude/projects` for JSONL changes
  - Real-time status derivation from JSONL entries: `working`, `waiting_for_approval`, `waiting_for_input`, `idle`
  - Detects pending tool uses by tracking `tool_use` and `tool_result` blocks
  - 5-minute idle threshold for marking inactive sessions
  - Broadcasts `session:created`, `session:updated`, `session:deleted` events via EventServer
  - `useSessions` hook subscribes to session events for real-time UI updates
  - Optimistic updates when session status changes
  - Reduced polling interval (30s) when WebSocket connected, fallback to 5s otherwise
  - Unit test coverage for status derivation logic
  - Files: `server/watchers/session-watcher.ts`, `src/lib/session-status.ts`, `src/lib/types.ts`, `src/hooks/useSessions.ts`

- **Event-Driven Architecture (Phase 3)** - Needs Attention column and status badges
  - New "Needs Attention" column for sessions awaiting tool approval or user input
  - Column auto-populates based on `derivedState.status` (waiting_for_approval, waiting_for_input)
  - Virtual column - sessions aren't persisted with "attention" status, just filtered there
  - Locked column - prevents drag-and-drop in/out (uses `useDroppable({ disabled })`)
  - "All clear" empty state when no sessions need attention
  - Renamed "In Progress" column to "Active"
  - Added `ColumnId` type as union of `SessionStatus | "attention"`
  - Added `needsAttention()` helper function for status checking
  - **Amber card styling** - Cards needing attention have amber border/background to match column icon
  - **Unified CardBadge component** - All status badges (New, Working, Needs Approval, Waiting) use same component
  - Badge colors match card state (amber for attention, emerald for active)
  - Pulsing "running" dot color changes to amber when card needs attention
  - **isIdle separation** - `DerivedSessionState.isIdle` is now separate from status
    - Sessions waiting for input/approval remain in attention column even when idle (5+ min inactive)
    - Allows proper grouping: actively waiting vs abandoned/idle waiting
  - **Waiting/Idle dividers** - Attention column groups sessions with collapsible headers
    - "Waiting" section: Sessions actively awaiting response (not idle)
    - "Idle" section: Sessions needing attention but idle for 5+ minutes
  - **derivedState API integration** - Sessions API now populates derivedState
    - New `getSessionDerivedState()` in claude-sessions.ts reads and parses JSONL
    - Only computed for running/active sessions to minimize overhead
  - Files: `src/lib/types.ts`, `src/lib/session-status.ts`, `src/lib/claude-sessions.ts`, `src/app/api/sessions/route.ts`, `src/components/Board.tsx`, `src/components/Column.tsx`, `src/components/SessionCard.tsx`

- **Event-Driven Architecture (Phase 4)** - Docs and Inbox real-time updates
  - ScopeWatcher class using Chokidar to watch scope directories for file changes
    - Emits `tree:changed` events when files/directories are added/removed
    - Emits `file:changed` events when file content changes
    - Per-client subscription with ref counting (shared watchers between clients)
    - Ignores common non-content paths: node_modules, .git, .DS_Store, etc.
  - InboxWatcher class to watch Todo.md files for inbox changes
    - Watches `{scopePath}/docs/Todo.md` for each subscribed scope
    - Emits `inbox:changed` events on file modifications
    - Same ref counting pattern as ScopeWatcher
  - Updated `useDocs` hook to use WebSocket events instead of polling
    - Subscribes to `tree` and `file` channels on connection
    - Triggers SWR mutate on events for instant UI updates
    - Skips file refresh when in edit mode to prevent losing changes
    - Removed 5s/30s polling interval (now event-driven)
  - Updated `useInboxItems` hook to use WebSocket events
    - Subscribes to `inbox` channel on connection
    - Reduced polling to 30s fallback when connected
  - Wired subscription handlers in ws-server.ts
    - Starts/stops watchers based on client subscriptions
    - Cleans up watchers on client disconnect
  - Files: `server/watchers/scope-watcher.ts`, `server/watchers/inbox-watcher.ts`, `server/watchers/index.ts`, `server/ws-server.ts`, `src/hooks/useDocs.ts`, `src/hooks/useSessions.ts`

- **Event-Driven Architecture (Phase 5)** - Remove polling, rely on WebSocket events
  - Polling completely disabled when WebSocket is connected
    - `useSessions`: No polling when connected, 5s/30s fallback when disconnected
    - `useInboxItems`: No polling when connected, 5s/30s fallback when disconnected
    - `useTreeSessions`: No polling when connected, 5s/30s fallback when disconnected
    - `useDocs`: No polling at all, fully event-driven
  - Reconnection re-fetch logic for all hooks
    - Tracks previous connection state with `useRef`
    - When WebSocket reconnects (false → true), triggers SWR mutate
    - Ensures data is fresh after network interruptions
  - Visibility-aware polling intervals for disconnected state
    - 5 seconds when tab is visible
    - 30 seconds when tab is hidden
    - Reduces resource usage when not actively viewing
  - Files: `src/hooks/useSessions.ts`, `src/hooks/useTreeSessions.ts`, `src/hooks/useDocs.ts`

- **Code File Viewer/Editor** - Code files now render with syntax highlighting in docs panel
  - Uses CodeMirror 6 for viewing and editing code files
  - Supports 30+ file extensions: JS/TS/JSX/TSX, Python, HTML/CSS, JSON/YAML/XML, Rust, Go, Java, C/C++, SQL, PHP, shell scripts, and config files
  - Full edit mode with Save button and unsaved changes detection
  - Dark/light theme support matching app theme
  - Line numbers, code folding, bracket matching, search
  - Files: `src/components/docs/CodeViewer.tsx`, `src/components/docs/DocsContentPane.tsx`

### Fixed

- **Root Folder Auto-Select index.md** - Opening docs panel now auto-selects root index.md
  - Previously, opening docs for a scope showed "select a file to view" even if root had index.md
  - Added useEffect to auto-select root's index.md when tree loads and no file is selected
  - Respects URL params - if `?doc=` is present, uses that instead
  - Files: `src/components/DocsView.tsx`

- **Folder Click Auto-Select index.md** - Clicking on a folder in the docs tree now auto-selects index.md
  - When clicking on a folder row (not the chevron), the folder expands AND its index.md is auto-selected
  - Also works for breadcrumb navigation - clicking a folder navigates and selects index.md
  - Files: `src/components/docs/DocsTreeItem.tsx`, `src/components/DocsView.tsx`

- **Wikilinks Render After Mode Switch** - Wikilinks now render correctly after switching from edit to read mode
  - Previously, wikilinks would show as raw `[[syntax]]` after returning from edit mode
  - Fixed by resetting `editedContent` to `null` when switching to read mode
  - Ensures wikilinks are processed fresh from the original content
  - Files: `src/components/docs/DocsContentPane.tsx`

- **Docs Viewer Scroll Position** - Following wikilinks now loads target file scrolled to top
  - Added `scrollContainerRef` to reset scroll position when `filePath` changes
  - Files: `src/components/docs/DocsContentPane.tsx`

- **Wikilink Path Resolution** - Wikilinks with folder paths now resolve correctly
  - `[[Knowledge/AI Analysis|AI Analysis]]` was marked as broken because resolver only looked up full path
  - Added fallback to extract and lookup just the filename when full path doesn't match
  - Files: `src/lib/docs/wikilink-resolver.ts`

- **Wikilink Implicit Relative Resolution** - Links like `[[subfolder/file]]` now resolve relative to current file
  - Previously, all wikilinks were resolved from scope root, so `[[Knowledge/index]]` in `Engineering/index.md` would fail to find `Engineering/Knowledge/index.md`
  - Added implicit relative path resolution (step 3) before global file tree lookup (step 4)
  - Resolution order: 1) explicit relative (`./`, `../`), 2) absolute (`/`), 3) implicit relative, 4) global filename match
  - Also improved file map to store files by relative path from scope (e.g., `roadmap/index`) not just filename
  - Files: `src/lib/docs/wikilink-resolver.ts`

- **Docs Editor Toolbar in Edit Mode** - MDXEditor toolbar now appears when switching to edit mode
  - Added `key` prop to force remount when `readOnly` changes, ensuring toolbar plugin initializes
  - Files: `src/components/docs/DocsEditor.tsx`

- **Spurious Save Button in Edit Mode** - Save button no longer appears when simply switching to edit mode
  - Root cause: MDXEditor normalizes markdown on init, causing content to differ from original file
  - Added `baselineContent` tracking to capture MDXEditor's normalized output as comparison baseline
  - `hasUnsavedChanges` now compares against baseline (editor's init state) instead of original file
  - Also removed redundant "(unsaved)" text indicator - Save button alone is sufficient
  - Files: `src/hooks/useDocs.ts`, `src/components/docs/DocsContentPane.tsx`

- **Wikilink Syntax Visible in Edit Mode** - Raw `[[wikilink]]` syntax now editable in edit mode
  - Wikilinks are only converted to clickable links in read mode
  - In edit mode, users see and can modify the raw syntax
  - Files: `src/components/docs/DocsEditor.tsx`

### Changed

- **Docs Viewer Typography** - Beautiful document-style rendering using Tailwind Typography defaults
  - Removed `prose-sm` and tight spacing overrides to let Typography defaults shine
  - Proper heading hierarchy: H1 (2.25em), H2 (1.5em), H3 (1.25em), body (1em)
  - 48px horizontal padding for comfortable reading margins
  - Theme-aware code blocks and table borders
  - Override MDXEditor's default 12px padding via CSS
  - Files: `src/components/docs/DocsEditor.tsx`, `src/app/globals.css`

### Added

- **Mode-Aware Search Filtering** - Search now filters content across all view modes
  - Board mode: Filters session cards (existing behavior)
  - Tree mode: Filters sessions in tree hierarchy
  - Docs mode: Filters files/folders in file tree
  - Search query persists when switching between modes
  - Files: `src/components/Board.tsx`, `src/components/TreeView.tsx`, `src/components/docs/DocsFileTree.tsx`

- **Extended File Type Rendering** - Docs viewer now renders images, PDFs, and CSVs
  - ImageViewer: Displays images with zoom controls (100%, zoom in/out, reset)
  - PDFViewer: Embeds PDFs with "Open in Finder" and "New Tab" buttons
  - CSVTableViewer: Parses CSV and displays as HTML table with sticky headers
  - Files: `src/components/docs/ImageViewer.tsx`, `src/components/docs/PDFViewer.tsx`, `src/components/docs/CSVTableViewer.tsx`, `src/components/docs/DocsContentPane.tsx`, `src/app/api/docs/raw/route.ts`

- **File Viewability Styling** - Non-viewable files are now visually distinguished
  - Viewable files (md, ts, js, json, images, etc.) shown in normal color
  - Non-viewable files (mjs, etc.) shown greyed out with 50% opacity
  - Files: `src/components/docs/DocsTreeItem.tsx`

- **URL Document Selection** - Document selection persists in URL for browser navigation
  - URL format: `/path/to/scope?doc=relative/path/to/file.md`
  - Browser back/forward navigation works with file selections
  - Direct linking to specific files supported
  - Files: `src/hooks/useDocs.ts`

### Changed

- **DocsBreadcrumbs Styling** - Now matches ScopeBreadcrumbs visual style
  - Uses monospace font (`font-mono`)
  - Arrow separators (`→`) instead of chevrons
  - Consistent button styling with hover background
  - Files: `src/components/docs/DocsBreadcrumbs.tsx`

- **DocsFileTree Simplified** - Removed redundant header bar
  - Scope name and refresh button removed (redundant with main breadcrumbs)
  - Cleaner interface with just the file tree
  - Files: `src/components/docs/DocsFileTree.tsx`, `src/components/DocsView.tsx`

- **Filter Button in Docs Mode** - Hidden when in docs view (no filter equivalent)
  - Files: `src/components/Board.tsx`

- **Turbopack by Default** - Switched from Webpack to Turbopack for faster dev experience
  - Initial compile: 585ms (was ~1000ms with Webpack)
  - HMR updates: ~50ms (was ~500ms)
  - Added `dev:webpack` script as fallback if needed
  - Files: `package.json`

- **Server Process Lock** - Prevents multiple WebSocket server instances
  - Lock file at `~/.claude-kanban-server.lock` with PID
  - Detects and cleans up stale locks from crashed processes
  - Clear error message when attempting to start duplicate server
  - Files: `server/ws-server.ts`

- **WebSocket Auto-Reconnection** - Terminals auto-reconnect when server restarts
  - Exponential backoff: 1s, 2s, 4s, 8s, 10s delays
  - Max 5 attempts before giving up with helpful error
  - Shows reconnection status in terminal
  - Files: `src/components/Terminal.tsx`

### Changed

- **Removed Plan Polling** - Plan files no longer poll every 3 seconds
  - Initial fetch on session open only
  - Real-time updates via WebSocket events (already implemented)
  - Reduces network requests significantly with multiple open sessions
  - Files: `src/components/TerminalDrawer.tsx`

- **Server-Side Preferences Persistence** - User preferences now persist across Electron rebuilds
  - Pinned folders, sidebar state, theme, view mode, and recent scopes stored in `data/preferences.json`
  - New `/api/preferences` route for CRUD operations
  - Updated hooks (`usePinnedFolders`, `useSidebarState`, `useTheme`) to use server-side storage
  - Previous localStorage-based storage would be lost when Electron app cache was cleared
  - Files: `src/lib/db.ts`, `src/app/api/preferences/route.ts`, `src/hooks/usePinnedFolders.ts`, `src/hooks/useSidebarState.ts`, `src/hooks/useTheme.ts`, `src/lib/recent-scopes.ts`

- **Electron IPC Transport** - Native desktop app with IPC-based terminal communication
  - Replaces WebSocket with Electron IPC for PTY communication when running as native app
  - `electron/main.ts` - Main process with IPC handlers, embedded Next.js server, PTY manager
  - `electron/preload.ts` - contextBridge API for secure renderer-to-main communication
  - `electron/launcher.cjs` - tsx loader for TypeScript execution in development
  - Dual-mode transport in `Terminal.tsx` - auto-detects Electron vs browser environment
  - macOS hardened runtime with code signing entitlements
  - electron-builder configuration for DMG distribution
  - App icon using 🧱 (bricks) emoji
  - `did-fail-load` error logging for debugging renderer load failures

- **Tree View Action Buttons** - Session cards in Tree View now show action toolbar on hover
  - Select, Open, and Mark as Done buttons appear on larger cards (render levels 1-2)
  - Matches floating toolbar pattern from Kanban SessionCard
  - Smaller cards (levels 3-4) omit buttons due to space constraints
  - Files: `src/components/TreeSessionCard.tsx`, `src/components/TreeView.tsx`

### Fixed

- **Drawer Dismissal on Terminal Start** - Fix drawer closing when terminal session kicks off
  - Root cause: WebSocket `onclose` handler was triggering reconnection attempts during React cleanup
  - When component unmounts/remounts (e.g., during HMR or React StrictMode), the WebSocket close triggered reconnect, which caused race conditions with terminal spawn
  - Solution: Added `intentionalCloseRef` flag to track cleanup closes vs unexpected disconnects
  - Only attempt reconnection when close is unexpected (server disconnect, network error)
  - Files: `src/components/Terminal.tsx`

- **Terminal Not Loading in Electron** - Fix terminals not rendering in Electron app
  - Root cause: `isElectronEnv()` was called directly in render, returning `false` during SSR
  - After hydration, no re-render was triggered because there was no state change
  - Solution: Added `useIsElectron()` hook that detects Electron via useEffect/useState
  - This ensures a re-render occurs after hydration when Electron is detected
  - Files: `src/components/TerminalDrawer.tsx`

- **Sidebar Hydration Mismatch** - Fix SSR/client hydration error in Sidebar component
  - Removed early-return placeholder that had different DOM structure than full render
  - Use `effectiveCollapsed` pattern to ensure consistent initial render
  - Server and client now render identical structure, just with loading state styling
  - Files: `src/components/sidebar/Sidebar.tsx`

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
