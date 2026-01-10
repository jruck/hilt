# Agent-Native Architecture Plan

This document outlines how to transform Hilt from a human-only UI into an agent-native application where Claude agents are first-class citizens.

---

## Current State Analysis

### Parity Audit

| User Action | Agent Can Do It? | Notes |
|-------------|-----------------|-------|
| View sessions | ✅ Partial | Can read `~/.claude/projects/*.jsonl` directly |
| Move session to column | ❌ No | Status in `data/session-status.json` (internal) |
| Star a session | ❌ No | No tool/command exists |
| Archive a session | ❌ No | No tool/command exists |
| Create draft prompt | ✅ Yes | Can write to `docs/Todo.md` |
| Edit/delete draft | ✅ Yes | Same file-based access |
| Pin a folder | ❌ No | Stored in `data/preferences.json` |
| Search sessions | ❌ No | Could grep JSONL but no structured way |
| View running sessions | ❌ No | Heuristic based on file mtime |
| Open terminal | ✅ Yes | Agent IS Claude Code |
| View/edit plans | ✅ Yes | Plans in `~/.claude/plans/*.md` |

**Parity Score: 4/11 (36%)**

### Data Location Issues

| Data | Current Location | Agent Accessible? | Problem |
|------|------------------|-------------------|---------|
| Session status | `data/session-status.json` | ❌ | Internal to Hilt install |
| User preferences | `data/preferences.json` | ❌ | Internal to Hilt install |
| Draft prompts | `docs/Todo.md` | ✅ | Already good! |
| Plans | `~/.claude/plans/*.md` | ✅ | Already good! |
| Pinned folders | preferences.json | ❌ | Not in user space |

### Missing Agent-Native Patterns

1. **No context.md** - Agent starts sessions without knowing Hilt state
2. **Heuristic completion** - Running detection based on file mtime (30s threshold)
3. **No capability discovery** - Agent can't query what Hilt offers
4. **UI actions orphaned** - Many actions only available via browser

---

## Phase 1: File-Based State (Achieve Parity)

**Goal:** Move state to file locations agents can read/write.

### 1.1 Session Status → User Space

Move `data/session-status.json` to `~/.hilt/session-status.json`:

```typescript
// New location
const HILT_DIR = path.join(os.homedir(), '.hilt');
const STATUS_FILE = path.join(HILT_DIR, 'session-status.json');
```

**Benefits:**
- Agent can read status with `cat ~/.hilt/session-status.json`
- Agent can write status with standard file tools
- Survives Hilt reinstalls

### 1.2 Preferences → User Space

Move `data/preferences.json` to `~/.hilt/preferences.json`:
- Pinned folders
- Theme settings
- Recent scopes
- View mode

### 1.3 Document the Schema

Create `~/.hilt/README.md` (auto-generated) documenting the file formats:

```markdown
# ~/.hilt

Configuration and state files for Hilt (Claude Code session manager).

## Files

### session-status.json
Tracks Kanban column placement and starring for sessions.
```json
{
  "session-uuid": {
    "status": "active" | "inbox" | "recent",
    "sortOrder": 0,
    "starred": false,
    "updatedAt": "ISO timestamp"
  }
}
```

### preferences.json
User preferences for the Hilt UI.
```

---

## Phase 2: Slash Commands for Parity

**Goal:** Every UI action should have a command equivalent.

### 2.1 Session Management Commands

Create `.claude/commands/hilt-status.md`:
```markdown
Set the Kanban status of a Claude session.

Usage: /hilt-status <session-id-or-slug> <active|inbox|recent>

Examples:
- /hilt-status dynamic-tickling-thunder active
- /hilt-status abc123 recent
```

Create `.claude/commands/hilt-star.md`:
```markdown
Star or unstar a session for quick access.

Usage: /hilt-star <session-id-or-slug> [on|off]
```

Create `.claude/commands/hilt-archive.md`:
```markdown
Archive a session (hide from default views).

Usage: /hilt-archive <session-id-or-slug>
```

### 2.2 Query Commands

Create `.claude/commands/hilt-sessions.md`:
```markdown
List sessions with optional filtering.

Usage: /hilt-sessions [--status active|inbox|recent] [--starred] [--scope <path>]

Output: Markdown table of matching sessions with IDs, slugs, and status.
```

### 2.3 Implementation

Commands should:
1. Read/write `~/.hilt/session-status.json` directly
2. Use session slug OR UUID for identification
3. Output confirmation in markdown format

---

## Phase 3: Context Injection

**Goal:** Agent starts with awareness of Hilt state.

### 3.1 Generate context.md

Create `~/.hilt/context.md` (auto-updated by Hilt):

```markdown
# Hilt Context

## Summary
- 3 active sessions
- 5 drafts in inbox
- 12 total sessions

## Active Sessions
| Slug | Project | Last Activity |
|------|---------|---------------|
| dynamic-tickling-thunder | ~/Work/myproject | 2 hours ago |

## Inbox (Drafts)
1. "Fix the authentication bug"
2. "Add dark mode support"

## Starred Sessions
- cosmic-dancing-fire (~/Work/api)

## Pinned Folders
- ~/Work/myproject
- ~/Work/api

## Recent Activity
- Session "dynamic-tickling-thunder" marked active (1 hour ago)
- Draft created: "Fix authentication bug" (3 hours ago)
```

### 3.2 Hook Integration

Add a `SessionStart` hook that injects context:

```json
// .claude/settings.json (project-level)
{
  "hooks": {
    "SessionStart": {
      "command": "cat ~/.hilt/context.md 2>/dev/null || echo 'Hilt context not available'"
    }
  }
}
```

Or create a CLAUDE.md section agents can reference:

```markdown
## Hilt Integration

To see current Hilt state, read `~/.hilt/context.md`.
To manage sessions, use these commands:
- /hilt-sessions - List sessions
- /hilt-status - Change status
- /hilt-star - Star/unstar
```

### 3.3 Auto-Update context.md

Hilt should regenerate context.md:
- On session status change
- On draft creation/deletion
- Periodically (every 30 seconds)

---

## Phase 4: Explicit Completion Signals

**Goal:** Replace heuristic running detection with explicit signals.

### 4.1 Signal File Pattern

When Claude finishes a task, it can signal completion:

```bash
# Signal completion
echo "completed" > ~/.hilt/signals/{session-id}.signal

# Signal in-progress with status
echo "implementing feature X" > ~/.hilt/signals/{session-id}.signal
```

Hilt watches `~/.hilt/signals/` for changes.

### 4.2 Completion Command

Create `.claude/commands/hilt-done.md`:
```markdown
Mark the current session as done (moves to Recent column).

Usage: /hilt-done [optional note about what was completed]

This moves the session to the Recent column in Hilt.
```

### 4.3 Hybrid Detection

Keep file mtime detection as fallback, but prefer explicit signals:
1. Check for signal file first
2. Fall back to mtime-based detection
3. Signal file takes precedence

---

## Phase 5: Dynamic Capability Discovery

**Goal:** Agent discovers Hilt capabilities at runtime.

### 5.1 Capabilities File

Create `~/.hilt/capabilities.json`:

```json
{
  "version": "1.0",
  "entities": {
    "session": {
      "actions": ["view", "setStatus", "star", "archive"],
      "statuses": ["inbox", "active", "recent"]
    },
    "draft": {
      "actions": ["create", "update", "delete"],
      "location": "docs/Todo.md"
    },
    "folder": {
      "actions": ["pin", "unpin"]
    }
  },
  "commands": [
    "/hilt-sessions",
    "/hilt-status",
    "/hilt-star",
    "/hilt-done",
    "/hilt-archive"
  ],
  "files": {
    "status": "~/.hilt/session-status.json",
    "preferences": "~/.hilt/preferences.json",
    "context": "~/.hilt/context.md",
    "signals": "~/.hilt/signals/"
  }
}
```

### 5.2 Agent Usage

Agent can read capabilities to understand what's possible:

```
Read ~/.hilt/capabilities.json to see what Hilt supports.
```

---

## Implementation Roadmap

### Milestone 1: Foundation (File-Based State)
- [ ] Move session-status.json to ~/.hilt/
- [ ] Move preferences.json to ~/.hilt/
- [ ] Create ~/.hilt/README.md schema documentation
- [ ] Update db.ts to use new locations
- [ ] Migration for existing users

### Milestone 2: Commands (Achieve Parity)
- [ ] Create /hilt-sessions command
- [ ] Create /hilt-status command
- [ ] Create /hilt-star command
- [ ] Create /hilt-archive command
- [ ] Create /hilt-done command
- [ ] Test each command works standalone

### Milestone 3: Context Injection
- [ ] Implement context.md generation
- [ ] Add auto-update on state changes
- [ ] Create SessionStart hook example
- [ ] Document in CLAUDE.md

### Milestone 4: Completion Signals
- [ ] Implement signal file watching
- [ ] Update /hilt-done to write signal
- [ ] Hybrid detection (signal + mtime fallback)
- [ ] UI indicator for signal-based status

### Milestone 5: Polish
- [ ] Generate capabilities.json
- [ ] Update all documentation
- [ ] End-to-end testing (user → agent → user)

---

## Success Criteria

**Parity Test:** For each UI action, verify the agent can accomplish it:
- ✅ Agent can move session to Active column
- ✅ Agent can star a session
- ✅ Agent can create a draft
- ✅ Agent can mark work as done
- ✅ Agent can query current session states

**Composability Test:** Agent can combine primitives for new workflows:
- "Review all starred sessions and summarize their status"
- "Archive all sessions older than 30 days"
- "Create drafts for each TODO comment in the codebase"

**Emergent Capability Test:** Agent handles unexpected requests:
- "Organize my sessions by git branch"
- "Find sessions related to authentication work"
- "Show me my most active projects this week"

---

## Anti-Patterns to Avoid

| Anti-Pattern | How to Avoid |
|--------------|--------------|
| Agent as router only | Commands should DO things, not just display info |
| Workflow-shaped tools | Keep primitives atomic (set status, star, archive separately) |
| Orphan UI actions | Every button should have a command equivalent |
| Context starvation | Generate and maintain context.md |
| Gates without reason | Files readable/writable by agent, not locked |
| Heuristic completion | Explicit /hilt-done signal |

---

## Notes

### Why Not MCP?

MCP (Model Context Protocol) tools are another option, but slash commands have advantages:
1. Work in any Claude Code session without setup
2. Portable across projects
3. User can invoke them too
4. Simpler implementation

MCP could be added later for richer integration (streaming updates, etc.).

### Backwards Compatibility

- Keep reading from `data/` locations as fallback
- Migrate on first access to `~/.hilt/`
- Don't break existing installations

### Security Considerations

- `~/.hilt/` should have 700 permissions
- Session IDs are UUIDs (not guessable)
- No sensitive data in signal files

---

*Created: 2026-01-10*
*Status: Planning*
