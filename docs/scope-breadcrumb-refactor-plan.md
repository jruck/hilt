# Scope Controls Refactor Plan

## Summary

Replace the monolithic `FolderPicker` dropdown with a breadcrumb-based navigation system featuring:
- Clickable path segments (breadcrumbs) for navigating up
- Subfolder dropdown on the last segment for navigating down
- Standalone Browse button in toolbar
- Separate Recent Scopes dropdown (clock icon)

## Component Architecture

```
Board.tsx (toolbar)
  ├── ScopeBreadcrumbs.tsx (clickable path segments)
  │     └── SubfolderDropdown.tsx (last segment, shows child folders with sessions)
  ├── RecentScopesButton.tsx (clock icon, opens recent scopes dropdown)
  └── BrowseButton.tsx (Finder button, standalone)
```

## UI Layout

```
[~] / [Work] / [Code] / [claude-kanban v]   [Clock]  [Browse]  [Filter...]
 ^      ^        ^           ^                 ^        ^
 |      |        |           |                 |        └── Opens Finder
 |      |        |           |                 └── Recent scopes dropdown
 |      |        |           └── Chevron opens SubfolderDropdown
 |      |        └── Click: navigate to ~/Work/Code
 └── Click: navigate to ~ (home)
```

## Design Decisions

- **Subfolders**: Only show folders that have Claude sessions (current behavior)
- **Recent scopes**: Separate dropdown with clock icon button
- **Long paths**: Show all segments, toolbar can grow horizontally

## Implementation Steps

### Phase 1: Create New Components

1. **Create `src/components/scope/ScopeBreadcrumbs.tsx`**
   - Parse path into segments
   - Render each as clickable button
   - Last segment has chevron, opens SubfolderDropdown
   - Props: `{ value: string, homeDir: string, onChange: (path) => void }`

2. **Create `src/components/scope/SubfolderDropdown.tsx`**
   - Fetch subfolders via existing `/api/folders?scope=X`
   - Show only folders with sessions
   - Positioned below last breadcrumb segment
   - Click folder → append to path → call onChange

3. **Create `src/components/scope/BrowseButton.tsx`**
   - Extract browse logic from FolderPicker
   - Standalone button: `<FolderOpen /> Browse`
   - Calls POST /api/folders to open native picker

4. **Create `src/components/scope/RecentScopesButton.tsx`**
   - Clock icon button
   - Opens dropdown showing recent scopes
   - Uses localStorage for storage

5. **Create `src/lib/recent-scopes.ts`**
   - `getRecentScopes(): RecentScope[]`
   - `recordScopeVisit(path: string): void`
   - Max 10 entries, sorted by lastVisited
   - localStorage key: `claude-kanban-recent-scopes`

### Phase 2: Integrate into Board.tsx

6. **Update Board.tsx toolbar**
   - Replace `<FolderPicker>` with new components
   - Layout: `Scope: [Breadcrumbs] [RecentButton] [BrowseButton] [Search]`
   - Wire onChange to existing handleScopeChange
   - Add recordScopeVisit call to handleScopeChange

### Phase 3: Cleanup

7. **Delete FolderPicker.tsx**
   - Remove after all functionality migrated

## Data Structures

### RecentScope (localStorage)
```typescript
interface RecentScope {
  path: string;
  lastVisited: string;  // ISO timestamp
  visitCount: number;
}
// Key: claude-kanban-recent-scopes
// Max 10 entries
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/scope/ScopeBreadcrumbs.tsx` | Create new |
| `src/components/scope/SubfolderDropdown.tsx` | Create new |
| `src/components/scope/BrowseButton.tsx` | Create new |
| `src/components/scope/RecentScopesButton.tsx` | Create new |
| `src/lib/recent-scopes.ts` | Create new |
| `src/components/Board.tsx` | Replace FolderPicker with new components |
| `src/components/FolderPicker.tsx` | Delete after migration |

## Styling Notes

- Keep existing zinc dark theme
- Breadcrumb segments: `bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1`
- Separators: `text-zinc-500` (non-interactive)
- Dropdowns: `bg-zinc-900 border border-zinc-700`
- Active state: `text-blue-400`
- All buttons match toolbar height (h-11 container, py-1.5 for buttons)

## API Usage

- Existing: `GET /api/folders?scope=X` - Returns child folders with sessions
- Existing: `POST /api/folders` - Opens native macOS folder picker
- No API changes needed
