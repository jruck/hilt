# Changelog

All notable changes to Hilt are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Fixed

- **Mobile bottom sheet too short** - Increased task detail bottom sheet maxHeight from 70vh to 85vh so "Add details" and delete dropdown are fully reachable.
  - File: `src/components/bridge/BridgeView.tsx`

- **Browser zoom on input focus** - Added viewport meta with `maximum-scale=1, user-scalable=no` to prevent iOS Safari from zooming when tapping text fields.
  - File: `src/app/layout.tsx`

### Added

- **Bridge tab search filtering** - The NavBar search box now filters Bridge content live. Tasks filter by title and detail lines, notes section hides when content doesn't match, projects filter by title, area, tags, and index.md body content. Shows "No matching items" when everything is filtered out.
  - Files: `src/lib/types.ts`, `src/lib/bridge/project-parser.ts`, `src/components/Board.tsx`, `src/components/bridge/BridgeView.tsx`

- **Local/Remote source toggle** - Toolbar dropdown (next to theme toggle) to switch between local and remote Hilt instances. Detects current source via hostname, passes return URL via `?from=` param, persists local URL in localStorage for return navigation.
  - Files: `src/hooks/useSource.ts` (new), `src/components/SourceToggle.tsx` (new), `src/components/NavBar.tsx`

- **Per-folder sort order toggle (A-Z vs Recent)** - Docs file tree folders now have a three-dot menu to toggle between alphabetical (default) and "sort by recent" (descending modTime). Preference persists per scope in localStorage. Menu icon appears on hover (desktop) or always visible (mobile).
  - Files: `src/hooks/useDocs.ts`, `src/components/docs/DocsFileTree.tsx`, `src/components/docs/DocsTreeItem.tsx`, `src/components/DocsView.tsx`

- **Add task button in top toolbar** - "+" button on the right side of the toolbar creates a new Bridge task. If not already on Bridge tab, switches to it first, then adds the task. Auto-focuses title in the detail panel with select-all so typing immediately replaces "New task". Enter/Tab moves focus to the details editor.
  - Files: `src/components/Board.tsx`, `src/components/bridge/BridgeView.tsx`, `src/components/bridge/BridgeTaskPanel.tsx`

### Changed

- **Removed inline Add button from Bridge task list** - The toolbar Add button is now the single entry point for creating tasks. Removed the duplicate Add button next to the "Tasks" heading and the associated `autoFocus` logic from `BridgeTaskItem`.
  - Files: `src/components/bridge/BridgeTaskList.tsx`, `src/components/bridge/BridgeTaskItem.tsx`

### Fixed

- **Bridge notes not saving** - Fixed stale closure bug where the `onChange` callback in `BridgeTaskEditor` was captured in TipTap's initial config and never updated. Added `onChangeRef` to keep the callback current, matching the existing pattern for `vaultPathRef` and `filePathRef`.
  - File: `src/components/bridge/BridgeTaskEditor.tsx`

- **Clickable links in task notes** - Links in Bridge task notes are now clickable. TipTap Link extension changed from `openOnClick: false` to `openOnClick: true` with `target="_blank"`. URLs open in external browser.
  - File: `src/components/bridge/BridgeTaskEditor.tsx`

### Changed

- **Project status "thinking" renamed to "considering"** - Better reflects the deliberative nature of the initial project stage. Updated across all files: project parser, board columns, picker restore options.
  - Files: `src/lib/bridge/project-parser.ts`, `src/components/bridge/ProjectBoard.tsx`, `src/components/bridge/ProjectPicker.tsx`, `src/components/bridge/ProjectCard.tsx`, `src/app/api/bridge/projects/status/route.ts`

- **URL-based view mode routing** - Active view (bridge/docs/stack) is now encoded as the first URL path segment. Browser Back/Forward naturally switches between views. URL structure: `/docs/Users/jruck/work/bridge`, `/bridge`, `/stack/Users/jruck/work/bridge`. Legacy URLs without prefix (e.g., `/Users/jruck/...`) are resolved from server prefs via `replaceState`.
  - Files: `src/lib/url-utils.ts` (new), `src/app/[[...path]]/page.tsx`, `src/contexts/ScopeContext.tsx`, `src/components/Board.tsx`, `src/hooks/useDocs.ts`, `src/components/DocsView.tsx`
  - Added `navigateTo(mode, scope)` to ScopeContext for atomic view+scope changes (single history entry)
  - Fixed double-push on Bridge→Docs project navigation: `navigateTo` replaces separate `setScopePath`+`setViewMode` calls
  - Fixed `useDocs` auto-selection pushing extra history entries: `setSelectedPath` now accepts `{ replace: true }` for auto-selections (initial file, root index.md)
  - Removed: `pushViewState`, `onViewRestore`, `HistoryState` type, `viewRestoreListeners` — all replaced by URL-based routing through `viewMode`/`setViewMode`/`replaceViewMode`/`navigateTo` on `ScopeContext`
  - Added Cmd+[/Cmd+] keyboard shortcuts and trackpad swipe gestures for back/forward in Electron (`electron/main.ts`). Uses `executeJavaScript("window.history.back()")` for SPA-style popstate navigation instead of `webContents.goBack()` which would trigger full page loads.

---

## [2.1.0] - 2026-02-05

Remove Sessions tab and all session-related code. Hilt now focuses on three views: Bridge, Docs, and Stack.

### Removed

- **Sessions tab** — Kanban board, tree view, and all session management UI
  - Deleted components: `Column`, `SessionCard`, `InboxCard`, `NewDraftCard`, `QuickAddButton`, `QuickAddModal`, `RalphSetupModal`, `Terminal`, `TerminalDrawer`, `TreeView`, `TreeNodeCard`, `TreeSessionCard`
  - Deleted hooks: `useSessions`, `useTreeSessions`, `useInboxPath`
  - Deleted lib: `claude-sessions`, `session-status`, `session-cache`, `tree-utils`, `treemap-layout`, `heat-score`, `ralph`, `ralph-server`, `pty-manager`
  - Deleted API routes: `/api/sessions`, `/api/ralph`, `/api/suggest-destination`
  - Deleted server watcher: `session-watcher`
  - Deleted tests: `session-status.test.ts`

- **Terminal integration** — PTY management, xterm.js rendering, and Electron IPC PTY handlers
  - Removed `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` dependencies
  - Removed `@electron/rebuild` dev dependency and rebuild scripts
  - Cleaned `electron/main.ts` and `electron/preload.ts` of all PTY code
  - Removed `node-pty` webpack external from `next.config.ts`

- **Ralph Wiggum integration** — Iterative AI development loop feature

### Changed

- **ViewToggle** — Removed "Sessions" option; only Bridge, Docs, Stack remain
- **Board.tsx** — Stripped all session view logic, session state, and session-related imports
- **Sidebar** — Removed `needsAttention` indicators
- **ws-server.ts** — Removed SessionWatcher and PTY WebSocket handlers
- **electron/types.d.ts** — Rewritten to match new preload API (plan events + startup only)
- **`ProjectKanban` renamed to `ProjectBoard`** — Consistent with app's "Board" naming convention
- **Dead code cleanup** — Removed unused `PinnedFolderItem` component
- **Stale references** — Updated "sessions" language in SubfolderDropdown, LiveIndicator, folders API, url-utils, and test files
- All documentation rewritten: README, ARCHITECTURE, API, COMPONENTS, DATA-MODELS, DEVELOPMENT

### Changed (previous)

- **Self-contained one-click dev app** - `Hilt.app` now launches Electron directly, which starts all dev servers (Next.js + WS/event server) as child processes. No more Terminal.app window opening via `osascript`. Electron manages the full lifecycle: startup, port discovery, and cleanup on quit.
  - `electron/main.ts`: Added `startWsServer()` to spawn WS server alongside Next.js in dev mode, with log output to `userData/logs/ws-server.log` and cleanup in `window-all-closed`/`before-quit` handlers
  - `scripts/create-dev-app.sh`: Removed `check_server()`, `find_port()`, port scanning, `osascript` Terminal.app launch, and `HILT_DEV_PORT` env var. Launcher now just sets up nvm PATH and `exec`s Electron directly

### Added

- **Project status management** - Projects can be moved between board columns (considering/refining/doing/done) via a three-dot menu on each project card. Status is persisted to frontmatter in each project's `index.md`. Done projects are hidden from the board. The project picker shows done projects in a separate view with restore-to-column functionality.
  - Files: `src/lib/bridge/project-parser.ts`, `src/app/api/bridge/projects/status/route.ts` (new), `src/hooks/useBridgeProjects.ts`, `src/components/bridge/ProjectCard.tsx`, `src/components/bridge/ProjectBoard.tsx`, `src/components/bridge/ProjectPicker.tsx`

- **Expanded project discovery** - Project parser now scans both `projects/` and `libraries/*/projects/` folders. Projects without `index.md` or frontmatter are included with sensible defaults (folder name as title, "considering" as status). Projects are grouped by source folder in the picker (e.g., "Projects", "EverPro").
  - Files: `src/lib/bridge/project-parser.ts`, `src/lib/types.ts` (`source` and `relativePath` added to `BridgeProject`), `src/components/bridge/ProjectPicker.tsx`

- **Project linking for Bridge tasks** - Tasks can be linked to a project folder. The link is stored as a standard markdown link in the task title: `- [ ] [Task Title](projects/slug)`. The parser extracts display text and project path. A project card is pinned above the editor in the task detail panel showing project title, area badge, and path. A three-dot menu opens a picker popover to attach/change/detach projects. Clicking the card navigates to the project in Docs view.
  - Files: `src/lib/types.ts`, `src/lib/bridge/weekly-parser.ts`, `src/app/api/bridge/tasks/[id]/route.ts`, `src/hooks/useBridgeWeekly.ts`, `src/components/bridge/BridgeTaskPanel.tsx`, `src/components/bridge/ProjectPicker.tsx` (new), `src/components/bridge/BridgeView.tsx`

- **Task panel UI simplification** - Removed edit/preview toggle (editor is always editable). Replaced action buttons with a three-dot menu containing project and delete actions. Close button replaced with an invisible full-height clickable strip on the left border using `cursor-e-resize` to indicate retractability.
  - Files: `src/components/bridge/BridgeTaskPanel.tsx`

- **Drag-and-drop file upload in Bridge editor** - Drop or paste any file into Bridge task/notes editors. Images and videos embed inline (as markdown image syntax); other files (PDFs, zips, etc.) insert as linked filenames. All files upload to `media/` alongside the weekly file and save as relative paths. Image nodes are `atom: true` for proper click-to-select with a focus-only selection ring.
  - Files: `src/app/api/bridge/upload/route.ts` (new), `src/components/bridge/BridgeTaskEditor.tsx`, `src/app/globals.css`

- **`workingFolder` preference** - New user preference that sets the default scope for Docs, Stack, and Sessions views on initial load (when no localStorage scope exists). Set in `data/preferences.json` as `"workingFolder": "/path/to/folder"`. Falls back to home directory when not configured.
  - Files: `src/lib/db.ts`, `src/app/api/folders/route.ts`, `src/components/Board.tsx`

- **Bridge view** - Weekly task management and project board integrated as a new view mode
  - Weekly tasks with drag-and-drop reordering, inline title editing, checkbox toggling
  - Side panel for task details with full markdown editing
  - Inline editable notes section (zero-padding, borderless — just text on the page)
  - Project board with four columns: considering, refining, doing
  - Clicking a project card opens its folder in the docs viewer with bridge as scope, project folder expanded, and index.md selected
  - Real-time updates via WebSocket events
  - Files: `src/components/bridge/*`, `src/hooks/useBridgeWeekly.ts`, `src/hooks/useBridgeProjects.ts`, `src/lib/bridge/*`, `src/app/api/bridge/*`

- **DocsView initial file navigation** - New `initialFilePath` prop allows programmatic navigation to a specific file on view switch, expanding all parent folders in the tree
  - Files: `src/components/DocsView.tsx`

- **Bridge rich media & Notion-like editing** - Extended BridgeTaskEditor with inline images, tables, task lists, and more
  - Image/video rendering: wikilinks (`![[file]]`) and relative paths converted to API URLs on read, normalized to standard markdown on save
  - Video observer: `<img>` with `.mp4/.webm/.mov/.ogg` src auto-replaced with `<video controls>`
  - New extensions: Image, Table, TaskList/TaskItem, Placeholder, Typography
  - MutationObserver video replacement restricted to read-only mode to prevent ProseMirror DOM corruption
  - `vaultPath`/`filePath` props threaded from BridgeView → BridgeTaskPanel/BridgeNotes → BridgeTaskEditor
  - CSS for task list checkboxes, tables, and placeholder text
  - Files: `BridgeTaskEditor.tsx`, `BridgeView.tsx`, `BridgeTaskPanel.tsx`, `BridgeNotes.tsx`, `globals.css`

### Fixed

- **Enter key in tiptap editors** - Pressing Enter at the end of a bullet list now immediately creates a new list item
  - Removed trailing empty list item stripping from `cleanOutput` and `normalizeMd` — was silently reverting the user's new lines
  - Removed trailing blank line stripping from `rebuildContent` — was discarding new content when writing task details to disk
  - Added focus guard to sync `useEffect` — prevents SWR re-fetch from overwriting editor while user is actively editing
  - Files: `BridgeTaskEditor.tsx`, `weekly-parser.ts`

### Changed

- **Bridge editors: MDXEditor → Tiptap** - Replaced MDXEditor with Tiptap for task detail and notes editing in Bridge view
  - New `BridgeTaskEditor` component using StarterKit + Link + tiptap-markdown extensions
  - Wikilink escaping fix: `unescapeWikilinks()` restores `![[file]]` syntax that tiptap-markdown escapes
  - Round-trip stability: normalized comparison prevents spurious saves from tiptap-markdown whitespace differences
  - Trailing node fix: CSS hides ProseMirror's trailing `<p>` and empty `<li>` artifacts to prevent layout shift
  - Weekly parser: `rebuildContent` preserves trailing lines in task rawLines (stripping was preventing Enter key from working)
  - Files: `src/components/bridge/BridgeTaskEditor.tsx` (new), `BridgeTaskPanel.tsx`, `BridgeNotes.tsx`, `src/lib/bridge/weekly-parser.ts`, `src/app/globals.css`

- **Task card click-to-open** - Clicking anywhere on a task card opens the detail panel; text input click still edits title
  - Auto-sizing title input uses inline-grid trick to match text width
  - File: `src/components/bridge/BridgeTaskItem.tsx`

- **Docs editor line height** - Reduced from `1.75` (prose default) to `1.5` (`leading-normal`) to match Obsidian's tighter spacing
  - File: `src/components/docs/DocsEditor.tsx`

- **Compact editor padding** - `.docs-editor-compact` wrapper now strips all padding from both MDXEditor wrapper and contenteditable elements
  - File: `src/app/globals.css`

### Changed

- **Hilt-only session tracking** - Replaced bulk JSONL scanning (3,789 files / 1.4GB) with a Hilt-owned session registry
  - New `data/sessions.json` as single source of truth — replaces both `claude-sessions.ts` scanning and `session-status.json`
  - Sessions registered at creation time via `POST /api/sessions`
  - Startup is now a single JSON file read instead of scanning all JSONL files
  - Running/active sessions still read individual JSONL for derived state (targeted reads, not bulk scan)
  - Temp→real session ID resolution via `PATCH /api/sessions { sessionId, realId }`
  - Session watcher narrowed to only watch registered session files
  - Removed `getSessions()`, `parseSessionFile()`, `getRunningSessionIds()`, `watchSessions()`, `isSessionRunning()`, `getSessionMtime()`, `getSessionById()` from `claude-sessions.ts`
  - Stripped `session-cache.ts` to only planned slugs caching
  - Removed legacy status storage functions from `db.ts`
  - Stale temp sessions (`new-*` entries > 5 min old) purged on startup

- **Electron dev launcher redesign** - Server management now handled entirely by Electron main process
  - **No more Terminal.app** - Dev server runs as background child process instead of opening a visible Terminal window
  - **Single app experience** - Only the Electron app appears in dock/cmd-tab, no separate Terminal
  - **Auto-cleanup** - Server automatically terminates when app quits (child process dies with parent)
  - **Warm start support** - Detects existing dev server on ports 3000-3004 and connects to it instead of starting a new one
  - **Logs available** - Server output written to `~/Library/Application Support/Electron/logs/dev-server.log`
  - Files modified: `electron/main.ts`, `scripts/create-dev-app.sh`, `dist/Hilt.app/Contents/MacOS/launcher`

### Fixed

- **Wikilinks broken in markdown tables** - Fixed escaped pipe characters causing link resolution failures
  - Root cause: Wikilinks in markdown tables use `\|` to escape the pipe separator, but the regex captured the trailing backslash as part of the target path (e.g., `index\` instead of `index`)
  - Fix: Strip trailing backslash from captured target in `parseWikilinks()` before resolution
  - File modified: `src/lib/docs/wikilink-resolver.ts`

- **Terminal not loading in Electron app** - Fixed race condition where React component remounting caused double PTY spawns
  - Root cause: Terminal component unmount/remount triggered two rapid spawn calls; second spawn killed the first before initialization
  - Added 500ms debounce window for spawn requests with same terminalId - returns existing terminal instead of killing/re-creating
  - Fix applied to both development (`src/lib/pty-manager.ts`) and production (`electron/main.ts`) PtyManager implementations
  - Files modified: `src/lib/pty-manager.ts`, `electron/main.ts`

- **Port conflicts in Electron dev mode** - Added dynamic port detection script
  - New `scripts/electron-dev.sh` finds an available port before starting Next.js and Electron
  - Eliminates conflicts when running both browser and Electron dev modes simultaneously
  - Environment variable `CLAUDE_KANBAN_DEV_PORT` communicates port to Electron main process
  - Files added: `scripts/electron-dev.sh`
  - Files modified: `package.json` (`electron:dev` script)

### Added

- **Startup Loading Screen** - Technical progress display during app initialization
  - **Progress bar** with overall percentage
  - **Activity list** with circular progress rings for each task:
    - Green checkmark ring when complete
    - Spinning blue ring when active/loading
    - Faded gray ring outline when pending
  - **Verbose details** - Shows specifics like "(viewMode: board)" for preferences, session counts when loaded
  - **Smooth transition** - 300ms fade-out when loading completes
  - **Error handling** - Fatal errors block the app with retry button
  - **Electron integration** - Shows server startup activities (checking for dev server, starting server, loading modules, creating window)
  - **Web mode** - Skips server phase, shows only data loading activities; instant if server is warm
  - **State machine architecture** - StartupContext manages phases: server → bootstrap → data → complete
  - Files: `src/contexts/StartupContext.tsx` (new), `src/components/StartupScreen.tsx` (new)
  - Modified: `src/app/layout.tsx`, `src/components/Board.tsx`, `electron/main.ts`, `electron/preload.ts`

- **Global Inbox System** - Quick capture workflow with two-step modal for tasks from anywhere in the app
  - **Quick Add button** in sidebar footer opens capture modal
  - **Keyboard shortcut**: `Cmd/Ctrl+I` opens Quick Add from anywhere
  - **Two-step flow**: First capture your idea, then choose destination
  - **Smart suggestions**: Matches task text against pinned folder names and CLAUDE.md content
  - **Inbox folder**: Set a default destination for quick captures (persists in preferences)
  - **Destination options**: Inbox (default), Suggested matches, Pinned folders, or Browse for any folder
  - **Draft persistence**: Auto-saves to localStorage while typing, survives modal dismiss
  - **Action buttons**: Save (to Todo.md), Run, Refine, or Process Reference
  - **Navigation**: After action, navigates to destination folder to see task in context
  - Files: `src/components/QuickAddButton.tsx`, `src/components/QuickAddModal.tsx`, `src/hooks/useInboxPath.ts`, `src/app/api/suggest-destination/route.ts`
  - Modified: `src/lib/db.ts`, `src/app/api/preferences/route.ts`, `src/components/sidebar/Sidebar.tsx`, `src/components/Board.tsx`

- **MCP Server Display in Stack View** - Full visibility and control of MCP servers
  - MCP servers now appear in StackFileTree grouped by layer (user/project)
  - New `MCPServerDetail` panel shows complete server info: description, connection type, command/URL, env vars
  - Plugin metadata displayed: author, version, license, homepage, repository, keywords
  - Enable/disable toggle for plugin-based MCP servers (updates `~/.claude/settings.json`)
  - Edit JSON config for user-defined servers (non-plugin) with Save/Cancel UI
  - Enabled/disabled status shown as colored dot indicator in tree view
  - Filter by MCP type to see only MCP servers
  - Discovers servers from: `~/.claude/.mcp.json`, project `.mcp.json`, and plugin system
  - Fixed duplication bug when scope is home directory (both user and project discovery read same file)
  - Files: `src/lib/claude-config/mcp-discovery.ts` (new), `src/components/stack/MCPServerDetail.tsx` (new), `src/app/api/claude-stack/mcp/route.ts` (new)
  - Modified: `types.ts`, `discovery.ts`, `StackFileTree.tsx`, `StackView.tsx`

- **Plugin Display in Stack View** - First-class plugin support in Stack view
  - Plugins appear nested within their scope layer (user/project), not in a separate section
  - **Collapsible plugin containers** - Plugins with children (MCP servers, skills, agents) are collapsible
    - Expanded by default for browsing, can collapse to reduce visual clutter
    - Chevron indicator shows expand/collapse state
  - **Nested MCP servers** - MCP servers from plugins appear nested under their parent plugin
    - Plugin-origin servers no longer appear at the top level with standalone servers
    - Clicking a nested MCP server still opens the full MCPServerDetail panel
  - **Nested skills and agents** - Skills and agents from plugins appear nested under their parent plugin
    - Skills show with rose Sparkles icon
    - Agents show with orange Bot icon and category:name format (e.g., `review:dhh-rails-reviewer`)
  - **Filter counts include plugin children** - Skills and Agents filter counts now include items from plugins
  - New `PluginDetail` panel shows complete plugin info: description, version, author, install path
  - Lists MCP servers, skills, and agents provided by plugin (also visible in tree view nested under plugin)
  - Enable/disable toggle updates `~/.claude/settings.json` enabledPlugins
  - Shows installation metadata: installedAt, lastUpdated, gitCommitSha
  - Links to homepage and repository
  - Filter by plugins type to see only plugins (across all layers)
  - Search filters plugins by name
  - Files: `src/lib/claude-config/plugin-discovery.ts` (new), `src/components/stack/PluginDetail.tsx` (new)
  - Modified: `types.ts`, `discovery.ts`, `StackFileTree.tsx`, `StackSummary.tsx`, `StackView.tsx`

- **MCP Auth Status Display** - OAuth authentication status visibility
  - Auth status indicator (colored dot) shown next to MCP servers in tree view
  - Blue dot = authenticated, yellow = token expired (will auto-refresh), red = needs re-auth, gray = not configured
  - Servers that don't require auth show no indicator
  - New "Authentication" section in MCPServerDetail with detailed status
  - Shows token expiration time for authenticated servers
  - Helpful guidance messages for each auth state
  - Reads OAuth credentials from `~/.claude/.credentials.json`
  - Credential matching supports various formats: plugin:server:name|hash, server|hash, etc.
  - Modified: `mcp-discovery.ts` (enrichWithAuthStatus), `StackFileTree.tsx` (getAuthIndicator), `MCPServerDetail.tsx`, `types.ts` (AuthStatus type)

- **Ralph Wiggum Integration** - New run method for inbox items enabling iterative AI development loops
  - New button on inbox cards (RefreshCw icon) opens Ralph setup wizard
  - Multi-step modal guides users through PRD creation or direct configuration
  - Plugin detection API (`/api/ralph`) checks if Ralph Wiggum plugin is installed
  - Configuration UI for max iterations and completion promise
  - PRD refinement flow helps create structured requirements with testable success criteria
  - Session cards show Ralph emoji with iteration progress (e.g., "3/10") during active loops
  - Terminal output parsing detects iteration changes and loop completion
  - WebSocket events broadcast Ralph progress to all connected clients
  - Files: `src/lib/ralph.ts`, `src/components/RalphSetupModal.tsx`, `src/app/api/ralph/route.ts`, `src/lib/types.ts`
  - Modified: `Board.tsx`, `Column.tsx`, `InboxCard.tsx`, `SessionCard.tsx`, `Terminal.tsx`, `server/ws-server.ts`

- **Custom emoji for pinned folders** - Click the folder icon to set a custom emoji
  - Emoji replaces the folder icon in the sidebar
  - Use native OS emoji picker (⌘⌃Space on macOS) or type/paste directly
  - Emoji persists across unpin/re-pin (stored separately by path in `folderEmojis`)
  - Files: `src/components/sidebar/SortablePinnedFolderItem.tsx`, `src/lib/db.ts`, `src/hooks/usePinnedFolders.ts`

- **One-command install script** - `./install.sh` handles full setup
  - Checks Node.js ≥18.18 and build tools (Xcode CLI / build-essential)
  - Installs dependencies with proper env vars for node-pty compilation
  - Creates `~/.hilt/data` directory
  - Optionally adds `hilt` shell alias to .zshrc/.bashrc
  - Files: `install.sh`, `.nvmrc`, `README.md` (Quick Install + Troubleshooting sections)

- **Hidden macOS system folders in file browser** - Prevent file descriptor exhaustion and reduce clutter
  - macOS home folders completely hidden: Applications, Library, Movies, Music, Pictures, Downloads, Documents, Desktop, Public
  - Cloud sync folders use **partial matching** (case-insensitive) to catch variations:
    - OneDrive, Google Drive, My Drive, Creative Cloud, Dropbox, iCloud Drive, Box Sync
    - Examples: "My Drive (user@email.com)", "Priceless Misc Dropbox", "Creative Cloud Files Company Account"
  - Both docs tree API and scope watcher skip these entirely (prevents EMFILE errors, faster tree loading)
  - Files: `src/app/api/docs/tree/route.ts`, `server/watchers/scope-watcher.ts`

### Changed

- **Wider resizable Stack sidebar** - Better readability for long plugin/skill names
  - Default width increased from 280px to 360px
  - Max width increased from 500px to 600px
  - Files: `src/components/stack/StackView.tsx`

- **Ralph setup skips plugin check** - Modal now goes directly to configuration step
  - Removed the initial plugin detection check that blocked users
  - The Claude CLI handles plugin installation prompts if needed
  - Simplified modal flow: opens straight to "config" step instead of "check" step
  - Files: `src/components/RalphSetupModal.tsx`

- **App Rename: Claude Kanban → Hilt** - Complete rebrand of the application
  - Package name: `claude-kanban` → `hilt`
  - App ID: `com.claude-kanban.app` → `com.hilt.app`
  - Product name: `Claude Kanban` → `Hilt`
  - Infrastructure files: `.claude-kanban-ws-port` → `.hilt-ws-port`, `.claude-kanban-server.lock` → `.hilt-server.lock`
  - localStorage keys: `claude-kanban-*` → `hilt-*`
  - Favicon/icon: 🧱 (brick) → 🗡️ (dagger)
  - All documentation updated with new branding
  - **Note**: Existing localStorage preferences will reset after this update

- **README updated for public audience** - Restructured to explain core concepts (Tasks/Docs/Stack views)
  - Added "Core Concepts" section explaining the three primary views
  - Reorganized features by view type for better discoverability
  - Updated from outdated "Three-Column Board" to current "Four Columns"
  - Documented Docs View and Stack View features
  - File: `README.md`

- **TaskViewModeToggle simplified** - Changed from toggle UI to single button
  - Icon shows target mode (what you'll switch TO), not current mode
  - Uses `Columns3` for board icon, `Network` for tree icon
  - More compact inline with search/filter controls
  - File: `src/components/ViewToggle.tsx`

- **Stack content viewers simplified** - Removed Parsed Metadata section from JSON files
  - JSON files now show only CodeViewer (no redundant parsed view)
  - Shell files (.sh) and other non-markdown files use CodeViewer
  - Only markdown files use DocsEditor
  - File: `src/components/stack/StackContentPane.tsx`

- **View toggle restructured** - Simplified from 4 equal views to hierarchical structure
  - **Primary toggle**: Tasks | Docs | Stack (conceptual categories)
  - **Secondary toggle**: Board | Tree (task view modes, only shown in Tasks)
  - Filter dropdown only shown in Tasks mode
  - Secondary toggle is compact (icon-only) to fit inline with search/filter
  - Switching to Tasks preserves last used view mode (board/tree)
  - Files: `src/components/ViewToggle.tsx`, `src/components/Board.tsx`

- **Development startup simplified** - `npm run dev:all` now starts all three servers (Next.js, WebSocket, Event)
  - Added `event-server` npm script for the real-time event server
  - Updated `dev:all` to run all servers concurrently
  - Updated README.md, DEVELOPMENT.md, ARCHITECTURE.md to reflect this as the standard dev workflow
  - File: `package.json`

- **Stack View search** - Search box now filters files in Stack sidebar
  - Filters file names across all layers (like Docs mode)
  - Summary/filter-by-type section remains unaffected by search
  - Filter button hidden in Stack mode (like Docs mode)
  - Files: `src/components/Board.tsx`, `src/components/stack/StackView.tsx`, `src/components/stack/StackFileTree.tsx`

### Fixed

- **Search visible in all modes** - Search box now appears in Tasks, Docs, and Stack views
  - Previously was hidden in Docs and Stack modes
  - Filters sessions in Tasks, files/folders in Docs, config files in Stack
  - Live filtering as you type
  - File: `src/components/Board.tsx`

- **Stack viewer error message** - Improved messaging when no configuration is available
  - Shows "Select a project folder to view configuration" when no scope is selected
  - Shows "No configuration available" for empty stacks (e.g., system level)
  - Only shows "Failed to load configuration" for actual API errors
  - File: `src/components/stack/StackView.tsx`

- **Default scope at root URL** - App now defaults to home folder instead of system/root
  - When visiting root URL (`localhost:3000`), automatically redirects to home folder
  - Invalid scope paths also redirect to home folder instead of root
  - File: `src/components/Board.tsx`

- **Sidebar pin icon behavior** - Pin icon now properly spaced and clickable when collapsed
  - Spacing from top matches bottom icons (consistent padding)
  - Clicking pin icon when collapsed now expands the sidebar
  - Added `onExpandSidebar` callback to `SidebarSection` component
  - Files: `src/components/sidebar/SidebarSection.tsx`, `src/components/sidebar/Sidebar.tsx`

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
  - Lock file at `~/.hilt-server.lock` with PID
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

Initial release of Hilt.

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
