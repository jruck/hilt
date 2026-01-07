# Components Reference

React component architecture and key implementation details.

## Component Hierarchy

```
App (layout.tsx)
└── Board.tsx (1046 lines) ─────────────────────────────────────────────
    │
    ├── Header
    │   ├── Sidebar toggle button
    │   ├── ScopeBreadcrumbs
    │   │   ├── "/" All Projects button
    │   │   ├── Path segments (clickable)
    │   │   ├── SubfolderDropdown
    │   │   ├── PinButton
    │   │   ├── RecentScopesButton
    │   │   └── BrowseButton
    │   ├── ViewToggle (Tree/Board/Docs)
    │   └── Search input
    │
    ├── Sidebar (collapsible, 256px/48px)
    │   ├── PinnedFolderList
    │   │   └── SortablePinnedFolderItem × N (draggable)
    │   └── Collapse button
    │
    ├── Main Content (conditional on viewMode)
    │   │
    │   ├── viewMode === "board"
    │   │   └── Column × 3
    │   │       ├── Column "To Do"
    │   │       │   ├── NewDraftCard (input)
    │   │       │   └── InboxCard × N (draggable)
    │   │       ├── Column "In Progress"
    │   │       │   └── SessionCard × N (draggable)
    │   │       └── Column "Recent"
    │   │           └── SessionCard × N (grouped by time)
    │   │
    │   ├── viewMode === "tree"
    │   │   └── TreeView
    │   │       ├── TreeNodeCard × N (folders)
    │   │       │   └── Session thumbnails
    │   │       └── TreeSessionCard × N (sessions)
    │   │
    │   └── viewMode === "docs"
    │       └── "Coming Soon" placeholder
    │
    └── TerminalDrawer (fixed right, resizable)
        ├── Tab bar
        │   └── Tab × N (closable)
        └── Terminal × N
            └── xterm.js instance
```

## Core Components

### Board.tsx

**File**: `src/components/Board.tsx` (1046 lines)

Main container component managing all state.

**Key State**

```typescript
const [scopePath, setScopePath] = useState(initialScope);
const [viewMode, setViewMode] = useState<ViewMode>("board");
const [search, setSearch] = useState("");
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [drawerOpen, setDrawerOpen] = useState(false);
const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
const [sidebarCollapsed, setSidebarCollapsed] = useSidebarState();
const [firstSeenAt, setFirstSeenAt] = useState<Map<string, number>>(new Map());
```

**Key Props**

```typescript
interface BoardProps {
  initialScope: string;  // From URL path
}
```

**Data Fetching**

```typescript
// Board mode - exact scope match
const { sessions, counts, isLoading, mutate } = useSessions(scopePath);

// Tree mode - prefix match with tree structure
const { sessions: treeSessions, tree } = useTreeSessions(scopePath);

// Inbox items
const { items: inboxItems } = useInboxItems(scopePath);
```

**Important Functions**

- `handleStatusChange(id, status)` - Move session between columns
- `handleOpenTerminal(session)` - Open terminal drawer with session
- `handleStartFromInbox(item)` - Start new session from draft
- `handleScopeChange(path)` - Navigate to different scope

---

### Column.tsx

**File**: `src/components/Column.tsx` (759 lines)

Kanban column with drag-drop support and time grouping.

**Props**

```typescript
interface ColumnProps {
  title: string;
  status: SessionStatus;
  sessions: Session[];
  inboxItems?: InboxItem[];
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onStatusChange: (id: string, status: SessionStatus) => void;
  onOpenTerminal: (session: Session) => void;
  onStartFromInbox?: (item: InboxItem) => void;
  // ... more handlers
}
```

**Time Grouping** (Recent column only)

Groups sessions into:
- Starred (pinned)
- Today
- Yesterday
- This Week
- Last Week
- This Month
- Older

**Drag & Drop**

Uses `@dnd-kit/core` and `@dnd-kit/sortable`.

```typescript
<SortableContext items={sortedItems.map(s => s.id)}>
  {sortedItems.map(session => (
    <SortableSessionCard key={session.id} session={session} />
  ))}
</SortableContext>
```

---

### SessionCard.tsx

**File**: `src/components/SessionCard.tsx` (300 lines)

Individual session display with actions.

**Props**

```typescript
interface SessionCardProps {
  session: Session;
  isSelected: boolean;
  isNew?: boolean;      // Show green glow
  newness?: number;     // 0-1 fade for new indicator
  firstSeenAt?: number; // When session first appeared
  onSelect: (multi: boolean) => void;
  onStatusChange: (status: SessionStatus) => void;
  onOpenTerminal: () => void;
  onOpenPlan?: () => void;
  onStar?: () => void;
}
```

**Visual States**

- **Default**: `bg-zinc-800` border
- **Selected**: `border-blue-500/50 bg-blue-500/5`
- **Active/Running**: `border-emerald-500/20 bg-emerald-500/5`
- **New**: Green glow fading over 60 seconds

**Actions (Floating Toolbar)**

- Open terminal
- View plan (if has plan)
- Star/unstar
- Move to Recent (checkmark)

---

### InboxCard.tsx

**File**: `src/components/InboxCard.tsx` (270 lines)

Draft prompt card with inline editing.

**Props**

```typescript
interface InboxCardProps {
  item: InboxItem;
  isSelected: boolean;
  onSelect: (multi: boolean) => void;
  onStart: () => void;           // Start session with this prompt
  onUpdate: (prompt: string) => void;
  onDelete: () => void;
  onRefine?: () => void;         // Refine with AI
  onProcessReference?: () => void; // Process as reference
}
```

**Actions**

- Start session (play icon)
- Edit inline (pencil icon)
- Refine with AI (brain icon)
- Process as reference (bookmark icon)
- Delete (trash icon)

---

### TerminalDrawer.tsx

**File**: `src/components/TerminalDrawer.tsx` (821 lines)

Resizable terminal panel with multi-tab support.

**Props**

```typescript
interface TerminalDrawerProps {
  isOpen: boolean;
  sessions: OpenSession[];
  activeTabId: string | null;
  onClose: () => void;
  onTabChange: (id: string) => void;
  onCloseTab: (id: string) => void;
  onWidthChange?: (width: number) => void;
}

interface OpenSession {
  session: Session;
  terminalId: string;  // IMPORTANT: Use as React key
}
```

**Resizing**

- Min width: 400px
- Max width: 1200px
- Drag handle on left edge
- Persists width in state (not localStorage)

**Tab Management**

- Each tab has unique `terminalId`
- Closing last tab closes drawer
- Active tab indicator

---

### Terminal.tsx

**File**: `src/components/Terminal.tsx` (291 lines)

xterm.js wrapper with WebSocket connection.

**Props**

```typescript
interface TerminalProps {
  sessionId: string;
  terminalId: string;  // Stable ID
  projectPath: string;
  isNew?: boolean;
  initialPrompt?: string;
  onTitleChange?: (title: string) => void;
  onContextChange?: (progress: number) => void;
  onExit?: () => void;
}
```

**Key Implementation**

```typescript
// CRITICAL: Use refs for spawn-time values to prevent re-renders
const sessionIdRef = useRef(sessionId);
const isNewRef = useRef(isNew);
const initialPromptRef = useRef(initialPrompt);

// Don't include sessionId in deps - use ref instead
useEffect(() => {
  const ws = new WebSocket("ws://localhost:3001");
  ws.send(JSON.stringify({
    type: "spawn",
    terminalId,
    sessionId: sessionIdRef.current,
    projectPath,
    isNew: isNewRef.current,
    initialPrompt: initialPromptRef.current,
  }));
}, [terminalId, projectPath]); // NOT sessionId
```

---

### TreeView.tsx

**File**: `src/components/TreeView.tsx` (175 lines)

Treemap visualization container.

**Props**

```typescript
interface TreeViewProps {
  tree: TreeNode;
  sessions: Session[];
  onNavigate: (path: string) => void;
  onOpenSession: (session: Session) => void;
}
```

**Layout**

Uses `squarify()` from `src/lib/treemap-layout.ts`:

```typescript
const rects = useMemo(() => {
  const items = prepareLayoutItems(tree, sessions);
  return squarify(items, { x: 0, y: 0, width, height });
}, [tree, sessions, width, height]);
```

---

### TreeNodeCard.tsx

**File**: `src/components/TreeNodeCard.tsx` (249 lines)

Folder rectangle in treemap.

**Render Levels**

| Level | Min Area | Content |
|-------|----------|---------|
| 1 | 40000px² | Full: name, metrics, session thumbnails |
| 2 | 10000px² | Compact: name, count badge |
| 3 | 2500px² | Minimal: just name |
| 4 | < 2500px² | Tiny: colored box only |

**Visual States**

- **Has active sessions**: Emerald border/background
- **No active sessions**: Zinc border/background
- **Hover**: Lighter background

---

### TreeSessionCard.tsx

**File**: `src/components/TreeSessionCard.tsx` (140 lines)

Session leaf in treemap.

**Content**

- Title (truncated to fit)
- Running indicator (pulsing dot)
- Click to open terminal

---

## Scope Navigation Components

### ScopeBreadcrumbs.tsx

**File**: `src/components/scope/ScopeBreadcrumbs.tsx`

Clickable path navigation.

```typescript
// Path: /Users/jruck/Work/Code/myproject
// Renders: / > Users > jruck > Work > Code > myproject
//          ^   ^       ^       ^      ^      ^
//          All clickable segments
```

### SubfolderDropdown.tsx

**File**: `src/components/scope/SubfolderDropdown.tsx`

Dropdown showing child folders with sessions.

### RecentScopesButton.tsx

**File**: `src/components/scope/RecentScopesButton.tsx`

Clock icon with dropdown of recent scopes.

### BrowseButton.tsx

**File**: `src/components/scope/BrowseButton.tsx`

Opens native macOS folder picker.

### PinButton.tsx

**File**: `src/components/scope/PinButton.tsx`

Pin current scope to sidebar.

---

## Sidebar Components

### Sidebar.tsx

**File**: `src/components/sidebar/Sidebar.tsx`

Collapsible sidebar container.

### SortablePinnedFolderItem.tsx

**File**: `src/components/sidebar/SortablePinnedFolderItem.tsx`

Draggable pinned folder with badges.

**Badges**

- Blue: To Do count
- Green: In Progress count
- Pulsing dot: Running sessions

---

## UI Components

### ViewToggle.tsx

**File**: `src/components/ViewToggle.tsx` (65 lines)

Three-way toggle for view modes.

```typescript
type ViewMode = "tree" | "board" | "docs";
```

### PlanEditor.tsx

**File**: `src/components/PlanEditor.tsx` (166 lines)

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

### NewDraftCard.tsx

**File**: `src/components/NewDraftCard.tsx` (143 lines)

Input field for creating new drafts.

**Features**

- Auto-expand textarea
- Submit on Enter (Shift+Enter for newline)
- Refine and Reference buttons

---

## Hooks

### useSessions.ts

```typescript
function useSessions(scope?: string) {
  const { data, error, mutate } = useSWR(
    `/api/sessions?scope=${scope}&mode=exact`,
    fetcher,
    {
      refreshInterval: 5000,
      keepPreviousData: true,  // Prevents loading flash
    }
  );

  return {
    sessions: data?.sessions ?? [],
    counts: data?.counts,
    isLoading: !error && !data,
    mutate,
  };
}
```

### useTreeSessions.ts

```typescript
function useTreeSessions(scope?: string) {
  const { data, error, mutate } = useSWR(
    `/api/sessions?scope=${scope}&mode=tree`,
    fetcher,
    {
      refreshInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    sessions: data?.sessions ?? [],
    tree: data?.tree,
    isLoading: !error && !data,
    mutate,
  };
}
```

### useInboxItems.ts

```typescript
function useInboxItems(scope?: string) {
  const { data, mutate } = useSWR(
    `/api/inbox?scope=${scope}`,
    fetcher,
    { refreshInterval: 5000 }
  );

  return {
    items: data?.items ?? [],
    sections: data?.sections ?? [],
    mutate,
  };
}
```

### usePinnedFolders.ts

```typescript
function usePinnedFolders() {
  // Lazy initializer for localStorage hydration
  const [folders, setFolders] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem("pinned-folders");
    return stored ? JSON.parse(stored) : [];
  });

  const addFolder = (path: string) => { ... };
  const removeFolder = (path: string) => { ... };
  const reorderFolders = (newOrder: string[]) => { ... };

  return { folders, addFolder, removeFolder, reorderFolders };
}
```

### useSidebarState.ts

```typescript
function useSidebarState() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  // Persist on change
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  return [collapsed, setCollapsed] as const;
}
```

---

## Styling Conventions

### Color Palette

| Color | Usage |
|-------|-------|
| `zinc-900` | Background |
| `zinc-800` | Card background |
| `zinc-700` | Borders, dividers |
| `zinc-400` | Secondary text |
| `zinc-200` | Primary text |
| `emerald-500` | Active/running states |
| `blue-500` | Selected, To Do column |
| `red-500` | Errors, destructive actions |

### Card States

```css
/* Default */
.card { @apply bg-zinc-800 border-zinc-700; }

/* Selected */
.card-selected { @apply border-blue-500/50 bg-blue-500/5; }

/* Active/Running */
.card-active { @apply border-emerald-500/20 bg-emerald-500/5; }

/* New (fading) */
.card-new { @apply ring-2 ring-emerald-500/30 shadow-emerald-500/20; }
```

### Responsive Breakpoints

Not heavily used - designed for desktop/laptop screens.

---

*Last updated: 2025-01-06*
