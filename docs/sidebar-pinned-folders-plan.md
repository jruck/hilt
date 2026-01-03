# Collapsible Sidebar with Pinned Folders

## Summary
Add a left-side collapsible sidebar to Claude Kanban for pinning frequently-used folders. Features: pin current scope from breadcrumbs, show folder name + path + session count + live indicator.

## Files to Create

### 1. `src/lib/pinned-folders.ts`
localStorage utility for pinned folders (pattern mirrors `recent-scopes.ts`)
```ts
interface PinnedFolder {
  id: string;
  path: string;
  name: string;
  pinnedAt: number;
}
```

### 2. `src/hooks/useSidebarState.ts`
Hook for sidebar collapsed/expanded state with localStorage persistence
- Default: expanded (open)
- Key: `claude-kanban-sidebar-collapsed`

### 3. `src/hooks/usePinnedFolders.ts`
Hook for pinned folders CRUD operations
- `folders`, `pinFolder(path)`, `unpinFolder(id)`, `isPinned(path)`
- Key: `claude-kanban-pinned-folders`

### 4. `src/components/sidebar/Sidebar.tsx`
Main collapsible sidebar container
- Width: 256px expanded, 48px collapsed
- Smooth width transition with `transition-all duration-300`
- Contains toggle button + SidebarSection(s)

### 5. `src/components/sidebar/SidebarSection.tsx`
Reusable collapsible section wrapper (for extensibility)
- Props: `title`, `icon`, `children`, `defaultExpanded`
- First section: "Pinned Folders"

### 6. `src/components/sidebar/PinnedFolderItem.tsx`
Individual pinned folder row
- Folder icon + name + truncated path
- Session count badge
- Live indicator (green pulse) if running sessions
- Unpin button on hover
- Click to navigate to scope

### 7. `src/components/sidebar/SidebarToggle.tsx`
Collapse/expand button with rotating chevron icon

### 8. `src/components/scope/PinButton.tsx`
Pin icon button for scope breadcrumbs
- Filled when pinned, outline when not
- Toggle pin on click

### 9. `src/components/ui/LiveIndicator.tsx`
Reusable green pulsing dot (matches existing session running indicator)

## Files to Modify

### `src/components/Board.tsx` (lines 604-809)
**Current layout:**
```tsx
<div className="flex flex-col h-screen bg-zinc-950">
  <StatusBar />
  <div className="flex flex-1 overflow-hidden">
    <DndContext>...</DndContext>
    <TerminalDrawer />
  </div>
</div>
```

**New layout:**
```tsx
<div className="flex flex-col h-screen bg-zinc-950">
  <StatusBar />
  <div className="flex flex-1 overflow-hidden">
    <Sidebar />  {/* NEW: Left sidebar */}
    <DndContext>...</DndContext>
    <TerminalDrawer />
  </div>
</div>
```

### `src/components/scope/ScopeBreadcrumbs.tsx` (line 118)
Add PinButton after the breadcrumbs navigation:
```tsx
<div className="flex items-center gap-1">
  <div className="relative flex items-center gap-0.5">
    {/* existing breadcrumbs */}
  </div>
  <PinButton scope={value} />  {/* NEW */}
</div>
```

### `src/components/scope/index.ts`
Export new PinButton component

## Live Sessions Detection
Leverage existing `useSessions` hook to compute live session counts per scope:
- Sessions with `isRunning: true` are live
- Aggregate counts by `projectPath`
- Parent folders show live if any child has live sessions

## Styling Guidelines (match existing patterns)
- Background: `bg-zinc-900`
- Border: `border-r border-zinc-700`
- Hover: `hover:bg-zinc-800`
- Text: `text-zinc-400` secondary, `text-zinc-200` primary
- Live indicator: `bg-green-500` with `animate-ping` overlay
- Transitions: `transition-all duration-300`

## Implementation Order
1. Create `src/lib/pinned-folders.ts` - localStorage utility
2. Create `src/hooks/useSidebarState.ts` - collapse state hook
3. Create `src/hooks/usePinnedFolders.ts` - CRUD hook
4. Create `src/components/ui/LiveIndicator.tsx` - reusable component
5. Create `src/components/sidebar/SidebarToggle.tsx`
6. Create `src/components/sidebar/SidebarSection.tsx`
7. Create `src/components/sidebar/PinnedFolderItem.tsx`
8. Create `src/components/sidebar/Sidebar.tsx` - main component
9. Create `src/components/sidebar/index.ts` - barrel export
10. Create `src/components/scope/PinButton.tsx`
11. Update `src/components/scope/index.ts` - add PinButton export
12. Update `src/components/scope/ScopeBreadcrumbs.tsx` - add PinButton
13. Update `src/components/Board.tsx` - integrate sidebar
