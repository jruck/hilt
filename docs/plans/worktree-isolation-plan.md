# Session Isolation (Worktrees) Feature Plan

## Design Philosophy

**"One toggle, zero cognitive load."**

Users should never need to understand git worktrees. They make one simple choice:

- **Normal mode**: Work in my project directory (default)
- **Isolated mode**: Work in a safe sandbox

Everything else—branch creation, directory management, cleanup—happens invisibly.

### UX Principles

1. **Hide the plumbing** - Never show `git worktree` commands or paths to users
2. **Simple vocabulary** - "Isolated session" not "worktree", "Keep changes" not "squash and rebase"
3. **Two outcomes only** - Keep the changes, or throw them away
4. **Graceful defaults** - If something fails, fall back to normal mode silently
5. **No orphans** - Aggressive cleanup; never leave dangling worktrees

---

## User Experience

### Starting a Session

When launching a session in a git repository, show a simple toggle:

```
┌─────────────────────────────────────────────┐
│  Start Session                              │
│                                             │
│  ~/Work/my-app                              │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ ○ Normal      ● Isolated            │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Isolated sessions run in a sandbox.        │
│  Your main branch stays untouched.          │
│                                             │
│            [Cancel]  [Start]                │
└─────────────────────────────────────────────┘
```

**No branch name input.** Auto-generate: `hilt/<session-id-short>`

**No path selection.** Auto-manage in `~/.hilt/workspaces/`

### During the Session

SessionCard shows a subtle indicator:

```
┌──────────────────────────────┐
│ 🔒 Add user authentication   │  ← Lock icon = isolated
│ ~/Work/my-app                │
│ 12 messages · 2 min ago      │
└──────────────────────────────┘
```

TerminalDrawer info tab shows:

```
Status: Isolated session
Changes: 3 files modified, 47 insertions

[View Changes]  [Open Folder]
```

**No branch names. No paths. No git jargon.**

### Finishing a Session

When user moves session to "Done" or clicks "Finish":

```
┌─────────────────────────────────────────────┐
│  Finish Isolated Session                    │
│                                             │
│  3 files changed, 47 lines added            │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ src/auth/login.ts         +32 -4     │  │
│  │ src/components/Header.tsx +12 -1     │  │
│  │ src/lib/session.ts        +3  -0     │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  [View Full Diff]                           │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Commit message (optional)           │    │
│  │ ┌─────────────────────────────────┐ │    │
│  │ │ Add user authentication        │ │    │
│  │ └─────────────────────────────────┘ │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [Discard Changes]      [Keep Changes]      │
└─────────────────────────────────────────────┘
```

**"Keep Changes"** = squash all commits, rebase onto main, fast-forward merge, cleanup worktree

**"Discard Changes"** = delete worktree, delete branch, done

User never sees: rebase, squash, merge, worktree, branch names, conflict resolution.

### Handling Conflicts

If rebase has conflicts (main diverged significantly):

```
┌─────────────────────────────────────────────┐
│  Can't auto-merge                           │
│                                             │
│  Your main branch changed while you were    │
│  working. Choose how to proceed:            │
│                                             │
│  [Keep as Branch]  [Open in Terminal]       │
│  [Discard Changes]                          │
└─────────────────────────────────────────────┘
```

- **Keep as Branch**: Leave the branch, user can manually merge later
- **Open in Terminal**: Drop into terminal at worktree for manual resolution
- **Discard**: Throw it all away

---

## Technical Implementation

### Directory Structure

```
~/.hilt/
└── workspaces/
    └── <session-id>/
        ├── .source → /Users/you/Work/my-app  (symlink for reference)
        └── workspace/                           (the actual worktree)
            ├── src/
            ├── package.json
            └── ...
```

### Data Model

```typescript
// src/lib/types.ts

interface SessionIsolation {
  enabled: true;
  workspacePath: string;      // ~/.hilt/workspaces/<id>/workspace
  sourcePath: string;         // Original project path
  branchName: string;         // hilt/<session-id-short>
  baseBranch: string;         // Branch we forked from (usually main)
  baseCommit: string;         // Commit SHA we forked from
  createdAt: string;
}

interface Session {
  // ... existing fields
  isolation?: SessionIsolation;
}
```

### Git Operations

All git operations wrapped in a `src/lib/git-isolation.ts` module:

```typescript
// Public API - all implementation details hidden

export async function createIsolatedWorkspace(
  projectPath: string,
  sessionId: string
): Promise<SessionIsolation | null>

export async function getWorkspaceChanges(
  isolation: SessionIsolation
): Promise<FileChange[]>

export async function getDiff(
  isolation: SessionIsolation
): Promise<string>

export async function keepChanges(
  isolation: SessionIsolation,
  commitMessage: string
): Promise<MergeResult>

export async function discardChanges(
  isolation: SessionIsolation
): Promise<void>

export async function cleanupOrphanedWorkspaces(): Promise<void>
```

### Implementation Phases

#### Phase 1: Core Infrastructure
- [ ] Create `src/lib/git-isolation.ts` module
- [ ] Implement `createIsolatedWorkspace()` - worktree creation
- [ ] Implement `discardChanges()` - worktree + branch deletion
- [ ] Add `isolation` field to Session type
- [ ] Update `db.ts` to persist isolation state

#### Phase 2: Terminal Integration
- [ ] Update `pty-manager.ts` to spawn in workspace path when isolated
- [ ] Update `ws-server.ts` to pass correct cwd
- [ ] Test Claude session resume works in worktree context

#### Phase 3: Launch UI
- [ ] Create `IsolationToggle` component
- [ ] Add launch dialog/modal to Board or InboxCard
- [ ] Wire up isolation creation on session start
- [ ] Add isolated indicator to SessionCard

#### Phase 4: Completion Flow
- [ ] Implement `getWorkspaceChanges()` - file change summary
- [ ] Implement `getDiff()` - full diff for viewer
- [ ] Implement `keepChanges()` - squash + rebase + merge + cleanup
- [ ] Create completion dialog component
- [ ] Add diff viewer (use shiki for syntax highlighting)
- [ ] Handle merge conflicts gracefully

#### Phase 5: Cleanup & Polish
- [ ] Implement `cleanupOrphanedWorkspaces()` - startup cleanup
- [ ] Add cleanup on app quit
- [ ] Add manual "Cleanup" button in settings
- [ ] Error handling and fallbacks throughout
- [ ] Hide isolation option for non-git projects

---

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Project is not a git repo | Don't show isolation option |
| Worktree creation fails | Show toast, fall back to normal mode |
| User has uncommitted changes in main | Warn, but allow (worktree still works) |
| Workspace disk full | Error toast, session continues in-place |
| Rebase conflicts | Offer "Keep as Branch" escape hatch |
| App crashes mid-session | Cleanup orphans on next startup |
| User deletes worktree manually | Detect missing path, clear isolation state |
| Branch name collision | Append random suffix |

---

## What We're NOT Building

To keep this lightweight:

- **No branch picker** - Auto-generate names
- **No path customization** - Fixed location
- **No partial keeps** - All or nothing
- **No conflict resolution UI** - Escape hatches only
- **No worktree list/management** - Invisible infrastructure
- **No stash integration** - Out of scope
- **No submodule support** - Too complex, fail gracefully

---

## Success Metrics

1. User can start an isolated session in <2 clicks
2. User can finish and keep changes in <3 clicks
3. Zero git terminology visible in happy path
4. Orphaned worktrees cleaned up within 24 hours
5. Graceful degradation: any failure → normal mode still works

---

## Open Questions

1. **Default behavior**: Should isolation be opt-in (default off) or opt-out (default on) for git projects?
   - Recommendation: Opt-in initially, gather feedback

2. **Workspace location**: `~/.hilt/workspaces/` or inside project `.hilt/`?
   - Recommendation: Home directory to avoid polluting projects

3. **Session resume**: Does `claude --resume` work correctly when cwd differs from original session?
   - Needs testing

4. **Multiple isolations same project**: Allow multiple isolated sessions for same project simultaneously?
   - Recommendation: Yes, each gets unique branch/workspace
