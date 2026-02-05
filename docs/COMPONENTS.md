# Components Reference

React component architecture and key implementation details.

## Component Hierarchy

```
App (layout.tsx)
└── Board.tsx (~275 lines) ──────────────────────────────────────────────
    │
    ├── Top Toolbar
    │   ├── Search input (expandable)
    │   ├── ThemeToggle
    │   └── ViewToggle (Bridge/Docs/Stack) — centered
    │
    ├── Main Content (conditional on viewMode)
    │   │
    │   ├── viewMode === "bridge"
    │   │   └── BridgeView
    │   │       ├── WeekHeader
    │   │       ├── BridgeTaskList
    │   │       │   └── BridgeTaskItem × N
    │   │       ├── BridgeTaskPanel / BridgeTaskDetail / BridgeTaskEditor
    │   │       ├── BridgeNotes
    │   │       ├── ProjectCard × N
    │   │       ├── ProjectKanban
    │   │       ├── ProjectPicker
    │   │       └── RecycleModal
    │   │
    │   ├── viewMode === "docs"
    │   │   └── DocsView
    │   │       ├── DocsBreadcrumbs
    │   │       ├── DocsFileTree
    │   │       │   └── DocsTreeItem × N
    │   │       ├── DocsContentPane
    │   │       │   ├── DocsEditor (markdown editing)
    │   │       │   ├── DocsEditToggle
    │   │       │   ├── CodeViewer
    │   │       │   ├── CSVTableViewer
    │   │       │   ├── ImageViewer
    │   │       │   ├── PDFViewer
    │   │       │   └── DocsFallbackView
    │   │       └── DocsEditToggle
    │   │
    │   └── viewMode === "stack"
    │       └── StackView
    │           ├── StackFileTree
    │           ├── StackContentPane
    │           │   ├── StackSummary
    │           │   ├── MCPServerDetail
    │           │   └── PluginDetail
    │           └── CreateFileDialog
    │
    └── Bottom Toolbar (hidden on Bridge view)
        ├── ScopeBreadcrumbs
        │   └── PinButton (inline)
        ├── RecentScopesButton
        ├── BrowseButton
        └── PinnedFoldersPopover
```

## Core Components

### Board.tsx

**File**: `src/components/Board.tsx` (~275 lines)

Main container component managing scope, view routing, and toolbar layout.

**Key State**

```typescript
const [homeDir, setHomeDir] = useState<string>("");
const [workingFolder, setWorkingFolder] = useState<string | undefined>(undefined);
const [docsInitialFile, setDocsInitialFile] = useState<string | null>(null);
const [searchQuery, setSearchQuery] = useState<string>("");
```

**View Routing**

Derives `viewMode` from the URL and renders the appropriate view:

```typescript
const viewMode: ViewMode = urlViewMode === "bridge" ? "bridge"
  : urlViewMode === "docs" ? "docs"
  : urlViewMode === "stack" ? "stack"
  : "bridge"; // fallback
```

**Data Fetching**

- Fetches home directory and working folder from `/api/folders`
- Validates scope path against server
- Persists view mode preference via `/api/preferences`

**Key Behaviors**

- Defaults to Bridge view when no URL prefix is present (e.g., Electron app startup)
- Hides the bottom scope toolbar when in Bridge view
- Supports cross-view navigation (e.g., Bridge project click navigates to Docs view)

---

### ViewToggle.tsx

**File**: `src/components/ViewToggle.tsx` (~52 lines)

Three-way toggle for view modes.

```typescript
type ViewMode = "docs" | "stack" | "bridge";
```

**View Configuration**

| View | Icon | Description |
|------|------|-------------|
| Bridge | Compass | Weekly tasks and projects |
| Docs | FileText | Documentation browser/editor |
| Stack | Layers | Claude configuration stack |

---

## Bridge Components

### BridgeView.tsx

**File**: `src/components/bridge/BridgeView.tsx`

Main Bridge view showing weekly tasks, projects, and notes. Supports navigating to projects in Docs view via the `onNavigateToProject` callback.

### BridgeTaskList.tsx

**File**: `src/components/bridge/BridgeTaskList.tsx`

List of tasks for the current week.

### BridgeTaskItem.tsx

**File**: `src/components/bridge/BridgeTaskItem.tsx`

Individual task item with status management.

### BridgeTaskPanel.tsx / BridgeTaskDetail.tsx / BridgeTaskEditor.tsx

**Files**: `src/components/bridge/BridgeTaskPanel.tsx`, `BridgeTaskDetail.tsx`, `BridgeTaskEditor.tsx`

Task detail view with editing capabilities.

### BridgeNotes.tsx

**File**: `src/components/bridge/BridgeNotes.tsx`

Notes section within the Bridge view.

### ProjectCard.tsx / ProjectKanban.tsx / ProjectPicker.tsx

**Files**: `src/components/bridge/ProjectCard.tsx`, `ProjectKanban.tsx`, `ProjectPicker.tsx`

Project display and organization components.

### WeekHeader.tsx

**File**: `src/components/bridge/WeekHeader.tsx`

Week navigation header for the Bridge view.

### RecycleModal.tsx

**File**: `src/components/bridge/RecycleModal.tsx`

Modal for recycling/archiving completed items.

---

## Docs Components

### DocsView.tsx

**File**: `src/components/DocsView.tsx`

Documentation browser and editor view. Accepts `scopePath`, `searchQuery`, optional `initialFilePath`, and scope change callbacks.

### DocsFileTree.tsx

**File**: `src/components/docs/DocsFileTree.tsx`

File tree sidebar for navigating documentation files within the current scope.

### DocsTreeItem.tsx

**File**: `src/components/docs/DocsTreeItem.tsx`

Individual tree node (file or folder) in the docs file tree.

### DocsEditor.tsx

**File**: `src/components/docs/DocsEditor.tsx`

Markdown editor for documentation files.

### DocsContentPane.tsx

**File**: `src/components/docs/DocsContentPane.tsx`

Content display pane that routes to the appropriate viewer based on file type.

### DocsBreadcrumbs.tsx

**File**: `src/components/docs/DocsBreadcrumbs.tsx`

Breadcrumb navigation within the docs view.

### DocsEditToggle.tsx

**File**: `src/components/docs/DocsEditToggle.tsx`

Toggle between read and edit modes for documentation.

### Specialized Viewers

- **CodeViewer.tsx** - Syntax-highlighted code display
- **CSVTableViewer.tsx** - Tabular CSV rendering
- **ImageViewer.tsx** - Image file display
- **PDFViewer.tsx** - PDF document rendering
- **DocsFallbackView.tsx** - Fallback for unsupported file types

---

## Stack Components

### StackView.tsx

**File**: `src/components/stack/StackView.tsx`

Claude configuration stack viewer. Displays CLAUDE.md files, MCP servers, and plugins for the current scope.

### StackFileTree.tsx

**File**: `src/components/stack/StackFileTree.tsx`

File tree showing configuration files in the stack hierarchy.

### StackContentPane.tsx

**File**: `src/components/stack/StackContentPane.tsx`

Content pane that routes to the appropriate detail view.

### StackSummary.tsx

**File**: `src/components/stack/StackSummary.tsx`

Overview summary of the current configuration stack.

### MCPServerDetail.tsx

**File**: `src/components/stack/MCPServerDetail.tsx`

Detail view for an individual MCP server configuration.

### PluginDetail.tsx

**File**: `src/components/stack/PluginDetail.tsx`

Detail view for a Claude plugin.

### CreateFileDialog.tsx

**File**: `src/components/stack/CreateFileDialog.tsx`

Dialog for creating new configuration files.

---

## Scope Navigation Components

### ScopeBreadcrumbs.tsx

**File**: `src/components/scope/ScopeBreadcrumbs.tsx`

Clickable path navigation with inline pin button.

```typescript
// Path: /Users/jruck/Work/Code/myproject
// Renders: / > Users > jruck > Work > Code > myproject
//          ^   ^       ^       ^      ^      ^
//          All clickable segments
```

### SubfolderDropdown.tsx

**File**: `src/components/scope/SubfolderDropdown.tsx`

Dropdown showing child folders.

### RecentScopesButton.tsx

**File**: `src/components/scope/RecentScopesButton.tsx`

Clock icon with dropdown of recent scopes.

### BrowseButton.tsx

**File**: `src/components/scope/BrowseButton.tsx`

Opens native macOS folder picker.

### PinnedFoldersPopover.tsx

**File**: `src/components/scope/PinnedFoldersPopover.tsx`

Popover listing pinned folders for quick scope switching.

---

## Sidebar Components

### Sidebar.tsx

**File**: `src/components/sidebar/Sidebar.tsx`

Collapsible sidebar container. Fetches inbox counts for pinned folders and renders them with drag-and-drop reordering.

### SortablePinnedFolderItem.tsx

**File**: `src/components/sidebar/SortablePinnedFolderItem.tsx`

Draggable pinned folder with emoji customization and count badges.

**Badges**

- Blue: To Do / inbox count
- Amber: Needs review count
- Green: Active / in progress count
- Live indicator dot: Running processes

### SidebarSection.tsx

**File**: `src/components/sidebar/SidebarSection.tsx`

Collapsible section container within the sidebar.

### SidebarToggle.tsx

**File**: `src/components/sidebar/SidebarToggle.tsx`

Button to collapse/expand the sidebar.

### PinnedFolderItem.tsx

**File**: `src/components/sidebar/PinnedFolderItem.tsx`

Non-sortable pinned folder display (used in contexts without drag-and-drop).

---

## UI Components

### LiveIndicator.tsx

**File**: `src/components/ui/LiveIndicator.tsx`

Pulsing dot indicator for active/running state.

### ThemeToggle.tsx

**File**: `src/components/ThemeToggle.tsx`

Toggle between light and dark themes.

### ThemeProvider.tsx

**File**: `src/components/ThemeProvider.tsx`

Theme context provider for the application.

### PlanEditor.tsx

**File**: `src/components/PlanEditor.tsx`

MDXEditor wrapper for plan markdown.

**Plugins**

- headingsPlugin
- listsPlugin
- quotePlugin
- markdownShortcutPlugin
- tablePlugin
- codeBlockPlugin
- codeMirrorPlugin
- linkPlugin
- linkDialogPlugin
- toolbarPlugin

---

## Hooks

### usePinnedFolders.ts

```typescript
function usePinnedFolders() {
  // Server-persisted pinned folders with optimistic updates
  return {
    folders: PinnedFolder[],
    isPinned: (path: string) => boolean,
    togglePin: (path: string) => void,
    unpinFolder: (id: string) => void,
    reorderFolders: (activeId: string, overId: string) => void,
    setEmoji: (id: string, emoji: string | null) => Promise<void>,
    isHydrated: boolean,
  };
}
```

### useSidebarState.ts

```typescript
function useSidebarState() {
  // localStorage-persisted sidebar collapsed state
  return {
    isCollapsed: boolean,
    toggle: () => void,
    isHydrated: boolean,
  };
}
```

### useBridgeProjects.ts

Hook for fetching and managing Bridge project data.

### useBridgeWeekly.ts

Hook for fetching weekly task data for the Bridge view.

### useClaudeStack.ts

Hook for fetching Claude configuration stack data (CLAUDE.md files, MCP servers, plugins).

### useDocs.ts

Hook for fetching documentation file trees and content.

### useEventSocket.ts

Hook for WebSocket-based real-time event updates.

### useTheme.ts

Hook for theme state management (light/dark mode).

---

## Styling Conventions

### Color Palette

Uses CSS custom properties for theme support:

| Variable | Usage |
|----------|-------|
| `--bg-primary` | Main background |
| `--bg-secondary` | Toolbar/sidebar background |
| `--bg-tertiary` | Input/hover background |
| `--bg-elevated` | Cards, popovers |
| `--border-default` | Standard borders |
| `--text-primary` | Primary text |
| `--text-secondary` | Secondary text |
| `--text-tertiary` | Muted/placeholder text |
| `--interactive-default` | Focus rings, active elements |
| `--status-todo` | To Do badge color (blue) |
| `--status-active` | Active badge color (green) |

### Common Patterns

```css
/* Card/panel background */
.panel { background: var(--bg-elevated); border: 1px solid var(--border-default); }

/* Interactive hover */
.interactive:hover { background: var(--bg-tertiary); color: var(--text-primary); }

/* Active/selected state */
.active { background: var(--bg-tertiary); color: var(--text-primary); }
```

### Responsive Breakpoints

Not heavily used -- designed for desktop/laptop screens. The `sm:` breakpoint is used sparingly (e.g., hiding view toggle labels on narrow screens).

---

*Last updated: 2026-02-05*
