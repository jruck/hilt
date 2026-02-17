# Folder Scoping Feature Plan

## Overview

Add the ability to choose which folder Hilt operates from. This single choice automatically:
- Filters the board to only show sessions from that folder and its children
- Scopes new sessions to be created in that folder
- Persists the choice across browser sessions

## Current State

- Sessions are fetched from `~/.claude/projects/` via `/api/sessions`
- Each session has a `projectPath` field indicating where it was started
- New sessions currently use `/` (root) as their working directory
- Status bar shows the app's cwd (where Next.js is running), not the scope folder

## Implementation Plan

### Step 1: Add Scope State to Board Component

**File:** `src/components/Board.tsx`

- Add `scopePath` state (string), defaulting to user's home directory
- Load initial value from localStorage on mount
- Save to localStorage when changed

```typescript
const [scopePath, setScopePath] = useState<string>(() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('hilt-scope') || process.env.HOME || '/';
  }
  return '/';
});
```

### Step 2: Update Sessions API to Support Filtering

**File:** `src/app/api/sessions/route.ts`

- Add optional `scopePath` query parameter
- Filter sessions where `projectPath` starts with `scopePath`
- Return filtered results

```typescript
// GET /api/sessions?scope=/Users/you/Work/Code
const scopePath = searchParams.get('scope');
if (scopePath) {
  sessions = sessions.filter(s => s.projectPath?.startsWith(scopePath));
}
```

### Step 3: Update useSessions Hook

**File:** `src/hooks/useSessions.ts`

- Accept `scopePath` parameter
- Pass it to the API call
- Re-fetch when scope changes

```typescript
export function useSessions(scopePath?: string) {
  const url = scopePath
    ? `/api/sessions?scope=${encodeURIComponent(scopePath)}`
    : '/api/sessions';
  // ... fetch logic
}
```

### Step 4: Update Status Bar UI

**File:** `src/components/Board.tsx`

Replace the static cwd display with an interactive folder picker:

- Show current scope path with folder icon
- Click to open folder selection modal/dropdown
- Show recently used folders for quick switching
- Option to browse/type a custom path

UI Design:
```
┌─────────────────────────────────────────────────────┐
│ 📁 /Users/you/Work/Code  ▼                        │
└─────────────────────────────────────────────────────┘
```

Clicking opens a dropdown:
```
┌─────────────────────────────────────────────────────┐
│ Recent Folders                                      │
│ ─────────────────────────────────────────────────── │
│ 📁 /Users/you/Work/Code/hilt            │
│ 📁 /Users/you/Bridge                              │
│ 📁 /Users/you                                     │
│ ─────────────────────────────────────────────────── │
│ 📂 Browse...                                        │
└─────────────────────────────────────────────────────┘
```

### Step 5: Create Folder Picker Component

**File:** `src/components/FolderPicker.tsx` (new)

- Dropdown component for selecting scope folder
- Shows recently used folders (stored in localStorage)
- Text input for typing custom path
- Validates that path exists via API call

### Step 6: Create Folder Validation API

**File:** `src/app/api/folders/route.ts` (new)

- `GET /api/folders?path=/some/path` - Validates path exists, returns info
- `GET /api/folders/recent` - Returns list of folders with sessions (from ~/.claude/projects/)

### Step 7: Update Terminal Spawning

**File:** `src/components/Board.tsx`

When creating new sessions, pass `scopePath` as the project path:

```typescript
const handleStartInboxItem = async (item) => {
  const newSession: Session = {
    // ...
    projectPath: scopePath,  // Use scope instead of '/'
    // ...
  };
};
```

**File:** `src/lib/pty-manager.ts`

Ensure the PTY spawns in the correct directory (already supports this via `projectPath`).

### Step 8: Update TerminalDrawer

**File:** `src/components/TerminalDrawer.tsx`

- Pass `scopePath` to Terminal component for new sessions
- Existing sessions keep their original `projectPath`

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/components/Board.tsx` | Modify | Add scope state, update status bar, pass scope to hooks |
| `src/components/FolderPicker.tsx` | Create | New dropdown component for folder selection |
| `src/hooks/useSessions.ts` | Modify | Accept scope parameter, pass to API |
| `src/app/api/sessions/route.ts` | Modify | Add scope query param filtering |
| `src/app/api/folders/route.ts` | Create | Folder validation and recent folders API |

## UX Considerations

1. **Default Scope**: Start with home directory (`~`) to show all sessions
2. **Persistence**: Remember last used scope in localStorage
3. **Visual Feedback**: Clear indication of current scope in status bar
4. **Quick Access**: Show recently used folders for fast switching
5. **Empty State**: Show helpful message when no sessions exist in current scope

## Edge Cases

- **Invalid path**: Show error, don't change scope
- **No sessions in scope**: Show empty state with message
- **Nested scopes**: `/Users/you/Work` includes `/Users/you/Work/Code/project`
- **Draft prompts**: Keep drafts global (not scoped) since they're not tied to a folder yet

## Testing Plan

1. Set scope to home folder → See all sessions
2. Set scope to specific project → See only that project's sessions
3. Create new session → Verify it's created in scope folder
4. Change scope → Verify board updates immediately
5. Refresh page → Verify scope persists
6. Set invalid path → Verify error handling

## Future Enhancements

- Keyboard shortcut to quickly change scope
- Show session count per folder in picker
- Tree view for folder navigation
- Integration with git repositories for auto-suggestions
