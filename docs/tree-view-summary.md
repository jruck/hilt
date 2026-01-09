# Tree View Feature Summary

A comprehensive reference for the fractal workspace "Tree View" feature in Hilt.

---

## Functional Overview

### What It Does

Tree View provides an alternate visualization of Claude Code sessions as a **treemap** (nested rectangles), where:

- **Rectangle size** reflects activity level (recency + volume + running sessions)
- **Folders become navigable spaces** - click to zoom in
- **Sessions appear at leaf level** - click to open terminal
- **Child sessions roll up** to parent folders (unlike Kanban's exact-match filtering)

### User Workflow

1. Toggle between **Kanban** ↔ **Tree** views via header button
2. In Tree view, see all folders under current scope sized by activity
3. Click a folder to zoom in (navigate to that scope)
4. Click a session to open terminal drawer
5. Use breadcrumbs to zoom back out
6. View preference persists across sessions (localStorage)

### Render Levels

Rectangles adapt detail based on available space:

| Level | Min Area | Shows |
|-------|----------|-------|
| 1 (Large) | 35,000px² | Full header, session thumbnails grid, metrics footer |
| 2 (Medium) | 12,000px² | Name, session pills, compact counts |
| 3 (Small) | 4,000px² | Name, icon counts (●3 ○2) |
| 4 (Tiny) | < 4,000px² | Truncated name, dot indicator |

---

## Architectural Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  User toggles to Tree View                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useTreeSessions(scopePath) hook                                             │
│  Fetches: GET /api/sessions?mode=tree&scope={path}                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  API: sessions/route.ts                                                      │
│  1. getSessions() - reads all JSONL files                                   │
│  2. isUnderScope() - PREFIX match (vs exact for Kanban)                     │
│  3. buildTree() - constructs hierarchical TreeNode structure                │
│  Returns: { sessions, tree, counts }                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TreeView component                                                          │
│  1. prepareLayoutItems() - flatten children + sessions for layout           │
│  2. layoutTreemap() - squarified algorithm positions rectangles             │
│  3. Render TreeNodeCard (folders) or TreeSessionCard (sessions)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Prefix matching for tree mode** | Allows child sessions to roll up to parent view |
| **Tree built server-side** | Ensures consistent structure, metrics calculated once |
| **Squarified treemap (no d3 dep)** | Optimal aspect ratios, self-contained implementation |
| **Four render levels** | Graceful degradation as rectangles shrink |
| **Pseudo-nodes for sessions** | Sessions laid out alongside folders in same treemap |
| **Heat score formula** | `0.6*recency + 0.3*volume + runningBonus` balances factors |

### Scope Filtering Modes

```typescript
// Kanban view (mode=exact)
sessions.filter(s => s.projectPath === scopePath)
// Shows: Only sessions IN this exact folder

// Tree view (mode=tree)
sessions.filter(s => isUnderScope(s.projectPath, scopePath))
// Shows: Sessions in this folder AND all subfolders
```

---

## Implementation Details

### File Structure

```
src/
├── lib/
│   ├── types.ts              # TreeNode, TreeMetrics, TreeSessionsResponse
│   ├── tree-utils.ts         # buildTree, extractFolderPaths, isUnderScope
│   ├── heat-score.ts         # calculateHeatScore, normalizeHeatScores
│   └── treemap-layout.ts     # layoutTreemap, getRenderLevel, prepareLayoutItems
├── hooks/
│   └── useTreeSessions.ts    # SWR hook for tree data
├── components/
│   ├── ViewToggle.tsx        # Kanban/Tree toggle button
│   ├── TreeView.tsx          # Main treemap container
│   ├── TreeNodeCard.tsx      # Folder rectangle (4 levels)
│   └── TreeSessionCard.tsx   # Session rectangle (4 levels)
└── app/api/sessions/
    └── route.ts              # mode=tree param handling
```

### Core Data Types

```typescript
interface TreeNode {
  path: string;           // "/Users/me/Work/ClientA"
  name: string;           // "ClientA"
  depth: number;          // Relative to scope root
  sessions: Session[];    // Direct sessions (projectPath === this.path)
  children: TreeNode[];   // Child folders
  metrics: TreeMetrics;   // Rolled-up from all descendants
}

interface TreeMetrics {
  totalSessions: number;  // This node + all descendants
  directSessions: number; // Just this node
  activeCount: number;    // status === "active"
  inboxCount: number;     // status === "inbox"
  recentCount: number;    // status === "recent"
  runningCount: number;   // isRunning === true
  lastActivity: number;   // Timestamp (ms)
  heatScore: number;      // Sizing metric
  normalizedHeat?: number; // 0-1 for color mapping
}
```

### Heat Score Algorithm

```typescript
function calculateHeatScore(metrics) {
  const hoursSinceActivity = (Date.now() - metrics.lastActivity) / (1000 * 60 * 60);

  // Exponential decay with 24h half-life
  const recencyScore = Math.exp((-hoursSinceActivity * Math.LN2) / 24);

  // Log-scale to prevent large projects dominating
  const volumeScore = Math.log10(metrics.totalSessions + 1);

  // Immediate attention for running sessions
  const runningBonus = metrics.runningCount * 0.5;

  return (recencyScore * 0.6) + (volumeScore * 0.3) + runningBonus;
}
```

### Treemap Layout Algorithm

The `layoutTreemap()` function implements **squarified treemaps**:

1. Convert heat scores to proportional areas
2. Sort items by area (descending)
3. Recursively subdivide container:
   - Lay out along shorter side
   - Find optimal row that minimizes worst aspect ratio
   - Recurse on remaining items in remaining space

Key functions:
- `squarify()` - Recursive layout
- `findOptimalRow()` - Greedy row building
- `worstAspectRatio()` - Quality metric (closer to 1.0 = better)

### Session Pseudo-Nodes

Sessions in the current folder are converted to TreeNode "pseudo-nodes" for unified layout:

```typescript
function isSessionNode(node: TreeNode): boolean {
  return node.path.includes("/__session__");
}

// Created by prepareLayoutItems()
{
  path: "/Users/me/Work/__session__uuid-123",
  name: "Session Title",
  sessions: [theSession],
  children: [],
  metrics: { /* single session metrics */ }
}
```

---

## Integration Points

### Board.tsx Integration

```typescript
// State
const [viewMode, setViewMode] = useState<ViewMode>(getCachedViewMode);

// Data fetching (only used when in tree view)
const { tree, isLoading: isTreeLoading } = useTreeSessions(scopePath);

// Conditional rendering
{viewMode === "tree" ? (
  <TreeView
    tree={tree}
    scopePath={scopePath}
    onNavigate={handleScopeChange}  // Reuses existing scope navigation
    onOpenSession={handleOpenSession} // Reuses existing session opener
    isLoading={isTreeLoading}
  />
) : (
  <DndContext ...>
    {/* Kanban columns */}
  </DndContext>
)}
```

### Shared Infrastructure

Tree View reuses existing infrastructure:
- `handleScopeChange()` for folder navigation (updates URL)
- `handleOpenSession()` for opening terminal drawer
- `ScopeBreadcrumbs` for showing current location
- `TerminalDrawer` for session terminals
- Session status/starring via existing API

---

## Extension Points

### Adding New Metrics

To add a new metric (e.g., "total messages"):

1. Add to `TreeMetrics` interface in `types.ts`
2. Calculate in `calculateNodeMetrics()` in `tree-utils.ts`
3. Include in heat score formula if desired (`heat-score.ts`)
4. Display in TreeNodeCard render levels

### Adjusting Heat Formula

Modify `DEFAULT_HEAT_CONFIG` in `heat-score.ts`:

```typescript
export const DEFAULT_HEAT_CONFIG: HeatConfig = {
  recencyWeight: 0.6,      // Increase for more recency focus
  volumeWeight: 0.3,       // Increase for more volume focus
  runningBonus: 0.5,       // Bonus per running session
  recencyHalfLifeHours: 24, // Faster decay = shorter half-life
};
```

### Adding New Render Levels

1. Adjust thresholds in `getRenderLevel()` in `treemap-layout.ts`
2. Add new `Level*Content` component in `TreeNodeCard.tsx`
3. Add conditional render in main component

### Future: Custom Spaces (Not Implemented)

The architecture supports future "spaces" abstraction:

```typescript
// Potential future addition
interface Space {
  id: string;
  name: string;
  rules: SpaceRule[];  // Path patterns, tags, explicit sessions
  parentId?: string;   // Hierarchical spaces
}

// Session membership would be:
// 1. Derived from path rules
// 2. Explicit assignment via explicitSpaceIds
```

---

## Known Limitations

1. **No drag-and-drop in Tree View** - Kanban columns support dnd-kit, tree does not
2. **No status changes from Tree View** - Must open session or switch to Kanban
3. **No inbox items in Tree View** - Drafts only visible in Kanban
4. **Fixed heat formula** - Not user-configurable (could add settings)
5. **No animation on tree changes** - Rectangles snap to new positions

---

## Testing Checklist

- [ ] Tree builds correctly from flat session list
- [ ] Metrics roll up from children to parents
- [ ] Heat scores differentiate active vs stale folders
- [ ] Treemap layout uses full available space
- [ ] Render levels adapt to rectangle size
- [ ] Click folder navigates (changes scope)
- [ ] Click session opens terminal drawer
- [ ] Toggle between Kanban ↔ Tree preserves scope
- [ ] Running sessions show pulse indicator
- [ ] Empty scope shows appropriate message
- [ ] Resize window triggers re-layout
- [ ] 5-second polling updates tree data
- [ ] View preference persists across page loads

---

## Related Files (Not Modified)

These existing files work with Tree View unchanged:

- `src/lib/claude-sessions.ts` - JSONL parsing (provides session data)
- `src/lib/db.ts` - Status persistence (statuses merged in API)
- `src/components/TerminalDrawer.tsx` - Terminal display (opened from tree)
- `src/components/scope/*` - Breadcrumbs, browse button (shared navigation)
