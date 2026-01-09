# Plan: Restructure View Toggle (Tasks/Docs with Sub-mode)

## Goal

Simplify the conceptual model from 3 equal views (Tree, Board, Docs) to a hierarchical structure:
- **Primary toggle**: Tasks vs Docs
- **Secondary toggle** (within Tasks): Board vs Tree view mode

This groups the related views (Tree and Board are both task-related) and separates Docs as a distinct mode.

## Current State

- `ViewToggle.tsx` renders 3 equal buttons: Tree, Board, Docs
- `Board.tsx` manages `viewMode: "tree" | "board" | "docs"` state
- Toggle is in the status bar right side, after Filter and Search
- Preferences API stores the viewMode

## Proposed Design

### UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [Scope controls]                    [Filter][Search] [Tasks|Docs] │
│                                              ↓ (if Tasks)         │
│                                        [Board|Tree]               │
└──────────────────────────────────────────────────────────────┘
```

**Option A: Inline with Filter/Search** (recommended)
- Primary toggle (Tasks/Docs) replaces current ViewToggle position
- Secondary toggle (Board/Tree) appears to the LEFT of Filter/Search when Tasks is active
- Keeps all controls in a single row, maintains compact status bar

**Option B: Under Status Bar**
- Secondary toggle in a sub-row below status bar
- Adds visual separation but increases vertical space usage
- Against the "Information Density Over Whitespace" principle

**Recommendation**: Option A - keeps everything in one row, just rearranges order

### Visual Design

**Primary Toggle (Tasks/Docs)**:
- Similar to current ViewToggle styling
- Tasks icon: `Kanban` or `CheckSquare`
- Docs icon: `FileText` (current)

**Secondary Toggle (Board/Tree)**:
- Smaller, more subtle style (like a segmented control)
- Only visible when Tasks mode is active
- Board icon: `LayoutGrid` (current)
- Tree icon: `Network` (current)

## Implementation Steps

### 1. Update Type Definitions

**File**: `src/components/ViewToggle.tsx`

Change:
```typescript
export type ViewMode = "tree" | "board" | "docs";
```

To:
```typescript
export type PrimaryView = "tasks" | "docs";
export type TaskViewMode = "board" | "tree";
```

### 2. Create New Toggle Components

**Option A**: Modify existing `ViewToggle.tsx` to export two components:
- `PrimaryViewToggle` - Tasks vs Docs
- `TaskViewModeToggle` - Board vs Tree (conditional)

**Option B**: Keep one component that handles both with conditional rendering

Recommend **Option A** for clarity and flexibility.

### 3. Update Board.tsx State Management

Change from single `viewMode` state to:
```typescript
const [primaryView, setPrimaryView] = useState<PrimaryView>("tasks");
const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>("board");
```

Or keep combined for simpler persistence:
```typescript
const [viewMode, setViewMode] = useState<ViewMode>("board"); // "board" | "tree" | "docs"
// Derive: primaryView = viewMode === "docs" ? "docs" : "tasks"
// Derive: taskViewMode = viewMode as TaskViewMode (when not docs)
```

**Recommendation**: Keep single state for simpler persistence, derive values for UI.

### 4. Update Status Bar Layout

**File**: `src/components/Board.tsx` (lines 848-924)

Rearrange right-side controls:
```tsx
{/* Right side: Task Mode Toggle (conditional), Filter, Search, Primary Toggle */}
<div className="flex items-center gap-2">
  {/* Task view mode toggle - only when in tasks view */}
  {primaryView === "tasks" && (
    <TaskViewModeToggle mode={taskViewMode} onChange={setTaskViewMode} />
  )}

  {/* Filter dropdown */}
  {primaryView === "tasks" && ( /* existing filter code */ )}

  {/* Search */}
  {primaryView === "tasks" && ( /* existing search code */ )}

  {/* Primary view toggle */}
  <PrimaryViewToggle view={primaryView} onChange={setPrimaryView} />
</div>
```

### 5. Update Preferences Persistence

Current API stores: `viewMode: "board" | "tree" | "docs"`

Keep the same - no changes needed. The combined value works for both structures.

### 6. Update Conditional Rendering

No changes needed to the main content rendering logic - it already checks `viewMode` value.

## File Changes Summary

| File | Changes |
|------|---------|
| `src/components/ViewToggle.tsx` | Split into two components or add sub-component |
| `src/components/Board.tsx` | Rearrange status bar controls, add conditional visibility |
| `docs/DESIGN-PHILOSOPHY.md` | Update to reflect new toggle pattern |
| `docs/CHANGELOG.md` | Document the change |

## Edge Cases

1. **Deep linking / URL state**: Currently not implemented, no impact
2. **Persistence**: Keep storing combined value, works seamlessly
3. **Keyboard shortcuts**: If implemented, would need to consider both levels
4. **Mobile**: Labels already hidden on small screens, should still work

## Migration

Existing saved preferences (`viewMode: "board" | "tree" | "docs"`) remain valid:
- `"docs"` → Primary: Docs
- `"board"` → Primary: Tasks, Mode: Board
- `"tree"` → Primary: Tasks, Mode: Tree

No data migration needed.

## Questions for User

1. Should Filter and Search be hidden when in Docs view? (Docs has its own search)
2. Should the secondary toggle have labels or just icons? (More compact with just icons)
3. Any preference on the Tasks icon (Kanban, CheckSquare, ListTodo)?
