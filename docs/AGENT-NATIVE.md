# Agent-Native Architecture

Transform Hilt from a human-only dashboard into an agent-native platform where Claude Code sessions can observe, modify, and orchestrate their own work environment.

**Core Principle**: Files are the universal interface. Agents already know `cat`, `grep`, `mv`. Make state accessible via files first, then add convenience layers.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Current State](#current-state)
3. [Target Architecture](#target-architecture)
4. [Action Taxonomy](#action-taxonomy)
5. [File Schemas](#file-schemas)
6. [Context Injection](#context-injection)
7. [Convenience Layer](#convenience-layer)
8. [Implementation Phases](#implementation-phases)
9. [Success Criteria](#success-criteria)

---

## Philosophy

### Core Principles

| Principle | Meaning |
|-----------|---------|
| **Parity** | Whatever user can do via UI, agent can do via files |
| **Granularity** | Atomic primitives, not bundled workflows |
| **Composability** | New features = new prompts, not new code |
| **Emergent Capability** | Agent handles things you didn't design for |
| **Files as Interface** | Use what agents already know |
| **Context Injection** | Agent starts with awareness of state |
| **Explicit Completion** | No heuristics - explicit signals |

### Why File-First?

1. **Universal Access**: Works in any Claude Code session without setup
2. **Inspectable**: User can `cat` the files to see/debug state
3. **Portable**: Files sync, backup, version control
4. **No Dependencies**: No server process required for agent access
5. **Atomic Operations**: File writes are atomic, avoiding race conditions

### Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Alternative |
|--------------|--------------|-------------|
| Workflow-shaped tools | Bundles judgment with action | Atomic primitives |
| MCP-only access | Requires setup, server running | File-first with MCP as optimization |
| UI control tools | Agent shouldn't control human's view | Agent modifies data, UI reflects it |
| Heuristic completion | Unreliable, can't be overridden | Explicit signal file/field |
| Context starvation | Agent doesn't know what exists | Generate context.md |

---

## Current State

### Parity Audit

| User Action | Agent Can Do? | Blocker |
|-------------|---------------|---------|
| View sessions | ✅ Partial | Can read `~/.claude/projects/*.jsonl` |
| Move session to column | ❌ No | Status in `data/session-status.json` (internal) |
| Star a session | ❌ No | Same |
| Archive a session | ❌ No | Same |
| Create draft prompt | ✅ Yes | Can write to `docs/Todo.md` |
| Edit/delete draft | ✅ Yes | Same |
| Pin a folder | ❌ No | Stored in `data/preferences.json` |
| Search sessions | ❌ No | Could grep but no structured way |
| Detect running sessions | ❌ No | Heuristic (file mtime) |
| View/edit plans | ✅ Yes | Plans in `~/.claude/plans/*.md` |

**Current Parity: 4/10 (40%)**

### Data Location Issues

| Data | Current Location | Problem |
|------|------------------|---------|
| Session status | `data/session-status.json` | Inside Hilt install directory |
| Preferences | `data/preferences.json` | Inside Hilt install directory |
| Draft prompts | `docs/Todo.md` | ✅ Already accessible |
| Plans | `~/.claude/plans/*.md` | ✅ Already accessible |

---

## Target Architecture

### File Structure

```
~/.hilt/
├── session-status.json   # Kanban state for all sessions
├── preferences.json      # User preferences (pinned folders, theme)
├── context.md           # Auto-generated context for agents
├── activity.log         # Append-only changelog (agent attribution)
└── README.md            # Schema documentation
```

### Design Decisions

1. **Single location** (`~/.hilt/`) - not scattered per-project
2. **JSON for structured data** - easy to parse/modify
3. **Markdown for context** - agents read it naturally
4. **Append-only log** - audit trail, no data loss

---

## Action Taxonomy

Everything an agent might need to do, mapped to file operations:

### Session Management

| Action | File Operation |
|--------|---------------|
| List sessions | Read `~/.claude/projects/*/` + `~/.hilt/session-status.json` |
| Get session details | Read specific `.jsonl` file |
| Set session status | Update `session-status.json[sessionId].status` |
| Star session | Update `session-status.json[sessionId].starred` |
| Archive session | Update `session-status.json[sessionId].archived` |
| Check if running | Read file mtime (< 30s = running) |

### Draft/Inbox Management

| Action | File Operation |
|--------|---------------|
| List drafts | Read `{project}/docs/Todo.md` |
| Create draft | Append to `Todo.md` |
| Update draft | Edit line in `Todo.md` |
| Complete draft | Change `[ ]` to `[x]` in `Todo.md` |
| Delete draft | Remove line from `Todo.md` |

### Preferences

| Action | File Operation |
|--------|---------------|
| List pinned folders | Read `preferences.json.pinnedFolders` |
| Pin folder | Append to `preferences.json.pinnedFolders` |
| Unpin folder | Remove from `preferences.json.pinnedFolders` |
| Get/set theme | Read/write `preferences.json.theme` |

### Context & Discovery

| Action | File Operation |
|--------|---------------|
| Get current state | Read `~/.hilt/context.md` |
| See recent activity | Read `~/.hilt/activity.log` |
| Understand schema | Read `~/.hilt/README.md` |

### Completion Signals

| Action | File Operation |
|--------|---------------|
| Signal work complete | Update `session-status.json[sessionId].status = "recent"` |
| Add completion notes | Append to `activity.log` |

---

## File Schemas

### session-status.json

```typescript
interface SessionStatusFile {
  [sessionId: string]: {
    status: "inbox" | "active" | "review" | "recent";
    sortOrder: number;
    starred?: boolean;
    archived?: boolean;
    archivedAt?: string;      // ISO timestamp
    updatedAt: string;        // ISO timestamp
    updatedBy?: "user" | "agent";
    updatedBySession?: string; // Session ID that made the change
    lastKnownMtime?: number;  // For running detection
  };
}
```

### preferences.json

```typescript
interface PreferencesFile {
  pinnedFolders: Array<{
    id: string;
    path: string;
    name: string;
    pinnedAt: number;
    emoji?: string;
  }>;
  sidebarCollapsed: boolean;
  theme: "light" | "dark" | "system";
  recentScopes: string[];
  viewMode: "board" | "tree" | "docs";
  folderEmojis?: Record<string, string>;
}
```

### activity.log

Append-only, newline-delimited JSON:

```jsonl
{"ts":"2025-01-10T12:00:00Z","action":"session_status_changed","sessionId":"abc123","from":"active","to":"recent","by":"agent","bySession":"xyz789"}
{"ts":"2025-01-10T12:01:00Z","action":"draft_completed","scope":"/Users/x/project","text":"Fix auth bug","by":"agent","bySession":"xyz789"}
{"ts":"2025-01-10T12:02:00Z","action":"session_starred","sessionId":"abc123","starred":true,"by":"user"}
```

### context.md

Auto-generated, read by agents:

```markdown
# Hilt Context

Generated: 2025-01-10T12:00:00Z

## Quick Stats
- Active sessions: 3
- Drafts pending: 5
- Running now: 1

## Active Sessions

| Slug | Project | Status | Last Activity |
|------|---------|--------|---------------|
| dynamic-tickling-thunder | ~/Work/myproject | active | 2 hours ago |
| cosmic-dancing-fire | ~/Work/api | review | 30 min ago |

## Drafts (To Do)

### ~/Work/myproject
- [ ] Fix authentication bug
- [ ] Add dark mode toggle

### ~/Work/api
- [ ] Update API documentation

## Starred Sessions
- cosmic-dancing-fire (~/Work/api)

## Pinned Folders
- ~/Work/myproject
- ~/Work/api

## Recent Activity (last 24h)
- Session "dynamic-tickling-thunder" marked active (1 hour ago)
- Draft completed: "Fix login redirect" (3 hours ago)
- Session starred: "cosmic-dancing-fire" (5 hours ago)

## Available Actions

You can modify Hilt state by editing files in ~/.hilt/:

- **Change session status**: Edit `session-status.json`
- **Star/archive session**: Edit `session-status.json`
- **Create/complete drafts**: Edit `{project}/docs/Todo.md`
- **Pin folders**: Edit `preferences.json`

See ~/.hilt/README.md for schema documentation.
```

### README.md

Schema documentation so agents understand the format:

```markdown
# ~/.hilt

State files for Hilt (Claude Code session manager).

## Files

### session-status.json

Tracks Kanban column placement for sessions.

**Schema:**
- `status`: "inbox" | "active" | "review" | "recent"
- `starred`: boolean (pins to top of column)
- `archived`: boolean (hides from default views)
- `updatedBy`: "user" | "agent" (for attribution)

**Example - Move session to active:**
```json
{
  "abc-123-uuid": {
    "status": "active",
    "updatedAt": "2025-01-10T12:00:00Z",
    "updatedBy": "agent"
  }
}
```

### preferences.json

User preferences for the UI.

### activity.log

Append-only log of changes. Add a line when you modify state:
```json
{"ts":"...","action":"session_status_changed","sessionId":"...","to":"active","by":"agent"}
```

### context.md

Auto-generated summary. Read this to understand current state.
Do NOT edit - it's regenerated periodically.
```

---

## Context Injection

### How Agents Get Context

1. **On session start**: Agent reads `~/.hilt/context.md`
2. **During work**: Agent can re-read for fresh state
3. **After changes**: Agent appends to `activity.log`

### Auto-Generation

Hilt regenerates `context.md`:
- On any session-status.json change
- On any preferences.json change
- Every 60 seconds (background refresh)

### Hook Integration (Optional)

Project can add a hook to inject context:

```bash
# .claude/hooks/session-start.sh
cat ~/.hilt/context.md 2>/dev/null
```

---

## Convenience Layer

Slash commands as shortcuts (not requirements):

### /hilt-status

```markdown
Set the Kanban status of a session.

Usage: /hilt-status <session-slug-or-id> <active|review|recent|inbox>

This is a shortcut for editing ~/.hilt/session-status.json directly.
```

### /hilt-star

```markdown
Star or unstar a session.

Usage: /hilt-star <session-slug-or-id> [on|off]
```

### /hilt-done

```markdown
Mark current session as done and move to Recent.

Usage: /hilt-done [completion notes]

Updates session-status.json and appends to activity.log.
```

### /hilt-context

```markdown
Show current Hilt context.

Usage: /hilt-context

Outputs the contents of ~/.hilt/context.md
```

---

## Implementation Phases

### Phase 1: File Migration (Foundation)

**Goal**: Move state to `~/.hilt/` so agents can access it.

```
[ ] Create ~/.hilt/ directory on first run
[ ] Migrate session-status.json to ~/.hilt/
[ ] Migrate preferences.json to ~/.hilt/
[ ] Update db.ts to use new location
[ ] Add fallback for existing data/ location (migration)
[ ] Generate README.md with schema docs
```

**Parity after Phase 1**: ~80% (agents can read/write all state)

### Phase 2: Context Generation

**Goal**: Agents start with awareness of state.

```
[ ] Implement context.md generation
[ ] Add auto-regeneration on state changes
[ ] Add periodic refresh (every 60s)
[ ] Document context.md format in README.md
```

### Phase 3: Activity Logging

**Goal**: Track who changed what (agent attribution).

```
[ ] Create activity.log on first change
[ ] Update all write operations to append log entry
[ ] Add updatedBy/updatedBySession fields to schemas
[ ] UI: Show agent attribution badge on items
```

### Phase 4: Convenience Commands

**Goal**: Make common operations easier.

```
[ ] Create /hilt-status command
[ ] Create /hilt-star command
[ ] Create /hilt-done command
[ ] Create /hilt-context command
```

### Phase 5: Polish

**Goal**: Complete the experience.

```
[ ] Add "review" status to session workflow
[ ] UI indicator for agent-modified items
[ ] Filter for agent-created drafts
[ ] End-to-end testing
```

---

## Success Criteria

### Parity Test

For each UI action, agent can accomplish it:
- ✅ Move session to Active column
- ✅ Star a session
- ✅ Create a draft
- ✅ Mark work as done
- ✅ Query current state

### Composability Test

Agent combines primitives for new workflows:
- "Review all starred sessions and summarize their status"
- "Archive all sessions older than 30 days"
- "Create drafts for each TODO comment in the codebase"

### Emergent Capability Test

Agent handles unexpected requests:
- "Organize my sessions by git branch"
- "Find sessions related to authentication work"
- "Show me my most active projects this week"

### Ultimate Test

> Describe an outcome in your domain that you didn't build a feature for. Can the agent figure it out by reading/writing files?

---

## Future Considerations

### MCP Layer (If Needed)

If file access proves insufficient, add MCP as optimization layer:
- MCP tools would be thin wrappers around file operations
- See `docs/AGENT-NATIVE-MCP-APPROACH.md` for detailed MCP design

### Multi-Agent Coordination

Deferred until single-agent works well:
- Session-to-session notes
- Task claiming/ownership
- Delegation between agents

---

*Last updated: 2025-01-10*
