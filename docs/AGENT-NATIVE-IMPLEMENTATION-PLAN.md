# Agent-Native Implementation Plan

Transform Hilt from a human-native dashboard into an agent-native platform where Claude Code sessions can observe, modify, and orchestrate their own work environment.

**Goal**: Any outcome achievable through the UI should be achievable by an agent through tools, enabling emergent workflows without code changes.

---

## Table of Contents

1. [Phase 1: MCP Server Foundation](#phase-1-mcp-server-foundation)
2. [Phase 2: Context Injection](#phase-2-context-injection)
3. [Phase 3: Agent-to-UI Communication](#phase-3-agent-to-ui-communication)
4. [Phase 4: Workflow Automation](#phase-4-workflow-automation)
5. [Phase 5: Multi-Agent Coordination](#phase-5-multi-agent-coordination)
6. [Implementation Details](#implementation-details)
7. [Migration & Rollout](#migration--rollout)

---

## Phase 1: MCP Server Foundation

**Objective**: Expose Hilt's capabilities as MCP tools that any Claude Code session can call.

### 1.1 Create MCP Server Package

**Location**: `server/mcp/`

```
server/mcp/
├── index.ts              # MCP server entry point
├── tools/
│   ├── sessions.ts       # Session management tools
│   ├── drafts.ts         # Inbox/draft tools
│   ├── navigation.ts     # Scope and folder tools
│   ├── ui.ts             # UI control tools
│   └── discovery.ts      # Capability introspection
├── resources/
│   ├── sessions.ts       # Session resource provider
│   ├── drafts.ts         # Draft resource provider
│   └── plans.ts          # Plan file resource provider
└── types.ts              # MCP-specific type definitions
```

### 1.2 Tool Definitions

#### Session Management Tools

| Tool | Parameters | Returns | Description |
|------|------------|---------|-------------|
| `hilt_list_sessions` | `scope?: string`, `status?: string`, `limit?: number` | `Session[]` | List sessions with optional filters |
| `hilt_get_session` | `id: string` | `Session` | Get single session by ID |
| `hilt_update_session_status` | `id: string`, `status: "inbox" \| "active" \| "recent"` | `{success: true}` | Move session between columns |
| `hilt_star_session` | `id: string`, `starred: boolean` | `{success: true}` | Toggle starred state |
| `hilt_archive_session` | `id: string` | `{success: true}` | Archive a session |
| `hilt_get_running_sessions` | `scope?: string` | `Session[]` | List currently running sessions |

#### Draft/Inbox Tools

| Tool | Parameters | Returns | Description |
|------|------------|---------|-------------|
| `hilt_list_drafts` | `scope?: string`, `section?: string` | `TodoItem[]` | List draft prompts |
| `hilt_create_draft` | `prompt: string`, `scope: string`, `section?: string` | `{id: string}` | Create new draft |
| `hilt_update_draft` | `id: string`, `prompt?: string`, `section?: string` | `{success: true}` | Update draft content |
| `hilt_complete_draft` | `id: string`, `notes?: string` | `{success: true}` | Mark draft as completed |
| `hilt_delete_draft` | `id: string` | `{success: true}` | Delete a draft |
| `hilt_claim_draft` | `id: string`, `session_id: string` | `{success: true}` | Associate draft with session |
| `hilt_reorder_drafts` | `item_ids: string[]` | `{success: true}` | Reorder draft list |

#### Navigation Tools

| Tool | Parameters | Returns | Description |
|------|------------|---------|-------------|
| `hilt_get_scope` | none | `{scope: string, homeDir: string}` | Get current UI scope |
| `hilt_list_folders` | `scope?: string` | `string[]` | List subfolders with sessions |
| `hilt_pin_folder` | `path: string` | `{success: true}` | Pin folder to sidebar |
| `hilt_unpin_folder` | `path: string` | `{success: true}` | Unpin folder |
| `hilt_list_pinned` | none | `PinnedFolder[]` | List pinned folders |

#### UI Control Tools

| Tool | Parameters | Returns | Description |
|------|------------|---------|-------------|
| `hilt_navigate_to` | `scope: string` | `{success: true}` | Change UI scope |
| `hilt_open_session` | `id: string` | `{success: true}` | Open session in terminal drawer |
| `hilt_close_session` | `id: string` | `{success: true}` | Close terminal tab |
| `hilt_show_notification` | `message: string`, `type?: "info" \| "success" \| "warning"` | `{success: true}` | Show toast notification |
| `hilt_set_view_mode` | `mode: "board" \| "tree" \| "docs"` | `{success: true}` | Switch view mode |

#### Discovery Tools

| Tool | Parameters | Returns | Description |
|------|------------|---------|-------------|
| `hilt_list_capabilities` | none | `Capability[]` | List all available tools |
| `hilt_get_context` | `scope?: string` | `HiltContext` | Get full context snapshot |
| `hilt_get_stats` | `scope?: string` | `Stats` | Session counts, activity metrics |

### 1.3 MCP Resources

Resources allow agents to read Hilt data without explicit tool calls:

| Resource URI | Description |
|--------------|-------------|
| `hilt://sessions` | All sessions (respects current scope) |
| `hilt://sessions/{id}` | Single session details |
| `hilt://drafts` | All draft prompts |
| `hilt://drafts/{id}` | Single draft |
| `hilt://plans/{slug}` | Plan file content |
| `hilt://context` | Full context snapshot |
| `hilt://scope` | Current scope path |

### 1.4 Implementation Steps

```
□ 1.1.1  Create server/mcp/ directory structure
□ 1.1.2  Add @modelcontextprotocol/sdk dependency
□ 1.1.3  Implement MCP server bootstrap in index.ts
□ 1.1.4  Wire up to existing WebSocket server (port 3001 or new port)

□ 1.2.1  Implement session tools (wrapping existing API logic)
□ 1.2.2  Implement draft tools (wrapping todo-md.ts functions)
□ 1.2.3  Implement navigation tools
□ 1.2.4  Implement UI control tools (via EventServer broadcasts)
□ 1.2.5  Implement discovery tools

□ 1.3.1  Implement session resource provider
□ 1.3.2  Implement draft resource provider
□ 1.3.3  Implement plan resource provider
□ 1.3.4  Add resource change notifications via watchers

□ 1.4.1  Add MCP server to npm scripts (npm run mcp)
□ 1.4.2  Document MCP server setup in README
□ 1.4.3  Create .claude/settings.json entry for auto-discovery
□ 1.4.4  Test with Claude Code CLI
```

### 1.5 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Claude Code CLI                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Session (claude --resume abc123)                              │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  MCP Client                                              │  │  │
│  │  │  - Tool calls: hilt_list_drafts, hilt_complete_draft    │  │  │
│  │  │  - Resource reads: hilt://context                        │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    MCP Protocol (stdio or SSE)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Hilt MCP Server (server/mcp/)                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Tool Handlers          │  Resource Providers                  │  │
│  │  - sessions.ts          │  - Sessions from claude-sessions.ts │  │
│  │  - drafts.ts            │  - Drafts from todo-md.ts           │  │
│  │  - navigation.ts        │  - Plans from ~/.claude/plans/      │  │
│  │  - ui.ts                │                                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                    Internal APIs                                     │
│                              │                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Existing Hilt Backend                                         │  │
│  │  - claude-sessions.ts (session parsing)                        │  │
│  │  - db.ts (status persistence)                                  │  │
│  │  - todo-md.ts (draft management)                               │  │
│  │  - EventServer (real-time broadcasts)                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    EventServer broadcasts
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Hilt UI (Browser)                                                   │
│  - Receives UI control commands (navigate, open session, notify)    │
│  - Shows agent activity in real-time                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 2: Context Injection

**Objective**: Provide agents with rich context about their environment automatically.

### 2.1 Context File Generation

When a Claude session starts (especially from Hilt), generate a context file:

**Location**: `~/.hilt/context/{session-id}.md` (ephemeral, auto-cleaned)

**Template**:

```markdown
# Hilt Context

Generated: {timestamp}
Session: {session-id}
Scope: {project-path}

## Current State

### Active Sessions ({count})
{for each active session}
- **{slug}**: "{title}" - {status}
  - Last activity: {relative-time}
  - Running: {yes/no}
{end for}

### To Do Items ({count})
{for each draft in scope}
- [ ] {prompt} (Section: {section or "Unsectioned"})
{end for}

### Recent Completions
{for each recently completed session}
- ✓ "{title}" - completed {relative-time}
{end for}

## Available Actions

You can use the following Hilt MCP tools:
- `hilt_list_drafts` - See all pending tasks
- `hilt_complete_draft` - Mark a task as done
- `hilt_create_draft` - Add a new task
- `hilt_update_session_status` - Move sessions between columns
- `hilt_show_notification` - Alert the user in the UI

## Project Context

Git branch: {current-branch}
Last commit: {commit-message} ({relative-time})
Files changed: {count} since last session

## Notes

{Any user-defined notes from project CLAUDE.md or similar}
```

### 2.2 Context API Endpoint

**Endpoint**: `GET /api/context`

**Query Parameters**:
- `scope` - Project path (required)
- `session_id` - Current session ID (optional, for personalization)
- `format` - `markdown` (default) or `json`

**Response** (JSON format):
```typescript
interface HiltContext {
  scope: string;
  timestamp: string;
  sessions: {
    active: Session[];
    recent: Session[];
    running: Session[];
  };
  drafts: {
    items: TodoItem[];
    sections: string[];
    totalCount: number;
  };
  stats: {
    totalSessions: number;
    activeCount: number;
    completedToday: number;
    avgSessionLength: number;
  };
  git?: {
    branch: string;
    lastCommit: string;
    uncommittedChanges: number;
  };
  capabilities: string[];  // Available MCP tools
}
```

### 2.3 Auto-Injection via Hooks

Create a Claude Code hook that injects Hilt context:

**File**: `.claude/hooks/hilt-context.sh`

```bash
#!/bin/bash
# Inject Hilt context at session start

SCOPE=$(pwd)
CONTEXT=$(curl -s "http://localhost:3000/api/context?scope=$SCOPE&format=markdown")

if [ -n "$CONTEXT" ]; then
  echo "$CONTEXT"
fi
```

**Hook Configuration** (`.claude/settings.json`):

```json
{
  "hooks": {
    "session_start": [
      {
        "command": ".claude/hooks/hilt-context.sh",
        "timeout": 5000
      }
    ]
  }
}
```

### 2.4 Implementation Steps

```
□ 2.1.1  Create HiltContext type definition
□ 2.1.2  Implement context aggregation function (pulls from all sources)
□ 2.1.3  Add markdown template renderer
□ 2.1.4  Create context file cleanup job (delete files > 24h old)

□ 2.2.1  Create /api/context route
□ 2.2.2  Support both markdown and JSON formats
□ 2.2.3  Add caching (5-second TTL to match session polling)

□ 2.3.1  Create hilt-context.sh hook script
□ 2.3.2  Document hook setup in README
□ 2.3.3  Test with new Claude sessions
□ 2.3.4  Add fallback for when Hilt server isn't running
```

---

## Phase 3: Agent-to-UI Communication

**Objective**: Make agent actions visible to users and enable agents to request user attention.

### 3.1 Activity Feed Component

**Location**: `src/components/ActivityFeed.tsx`

A collapsible panel showing recent agent actions:

```typescript
interface ActivityEvent {
  id: string;
  timestamp: Date;
  sessionId: string;
  sessionSlug: string;
  action: string;        // "created_draft", "completed_task", "moved_session", etc.
  details: string;       // Human-readable description
  target?: string;       // ID of affected item
}
```

**UI Design**:
- Collapsed: Small badge showing unread count
- Expanded: Scrollable list of recent events
- Events grouped by session
- Click event to navigate to affected item
- Auto-dismiss after 30 seconds (configurable)

### 3.2 Toast Notification System

**Location**: `src/components/Notifications.tsx`

Agents can request user attention via `hilt_show_notification`:

```typescript
interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  sessionId?: string;    // Which session triggered it
  action?: {             // Optional action button
    label: string;
    href?: string;       // Navigate to URL
    callback?: string;   // Event to emit on click
  };
  duration?: number;     // Auto-dismiss (default: 5000ms)
}
```

**Example notifications**:
- "Completed: Implement dark mode toggle" (success, from session xyz)
- "Waiting for review: PR #42 ready" (info, with "Open PR" action)
- "Found 3 type errors - created follow-up tasks" (warning)

### 3.3 Agent Attribution

Items created by agents should be visually distinguished:

**Data Model Addition**:
```typescript
interface TodoItem {
  // ... existing fields
  createdBy?: "user" | "agent";
  createdBySession?: string;  // Session ID that created it
}

interface StatusRecord {
  // ... existing fields
  lastModifiedBy?: "user" | "agent";
  lastModifiedBySession?: string;
}
```

**Visual Treatment**:
- Subtle robot icon (🤖) or "A" badge on agent-created items
- Hover tooltip: "Created by session dynamic-tickling-thunder"
- Filter option: "Show agent-created only"

### 3.4 EventServer Extensions

Add new event types for agent activity:

```typescript
// New event types
interface AgentActivityEvent {
  type: "agent:activity";
  sessionId: string;
  action: "draft_created" | "draft_completed" | "session_moved" | "notification";
  details: Record<string, unknown>;
  timestamp: string;
}

interface UICommandEvent {
  type: "ui:command";
  command: "navigate" | "open_session" | "show_notification" | "refresh";
  params: Record<string, unknown>;
}
```

**Broadcast Flow**:
1. MCP tool called by agent
2. Tool handler executes action
3. Tool handler emits event to EventServer
4. EventServer broadcasts to all connected UI clients
5. UI updates (activity feed, toast, board refresh)

### 3.5 Implementation Steps

```
□ 3.1.1  Create ActivityEvent type and storage (in-memory, last 100 events)
□ 3.1.2  Implement ActivityFeed component
□ 3.1.3  Add collapsed/expanded states with badge
□ 3.1.4  Wire up to EventServer subscription
□ 3.1.5  Add to Board.tsx layout (bottom-right corner)

□ 3.2.1  Create Notification type and context provider
□ 3.2.2  Implement toast component with animations
□ 3.2.3  Add action button support
□ 3.2.4  Wire up hilt_show_notification tool to emit events

□ 3.3.1  Add createdBy/lastModifiedBy fields to data models
□ 3.3.2  Update MCP tools to set attribution
□ 3.3.3  Add visual badge to InboxCard and SessionCard
□ 3.3.4  Add filter for agent-created items

□ 3.4.1  Define new event types in EventServer
□ 3.4.2  Update MCP tools to emit activity events
□ 3.4.3  Add UI command handling in Board.tsx
□ 3.4.4  Test end-to-end agent → UI flow
```

---

## Phase 4: Workflow Automation

**Objective**: Enable agents to manage their own task lifecycle and coordinate multi-step work.

### 4.1 Task Claiming & Ownership

When an agent picks up a task from the To Do column:

**New Tool**: `hilt_claim_draft`

```typescript
interface ClaimDraftParams {
  draft_id: string;
  session_id: string;
}

interface ClaimDraftResult {
  success: boolean;
  draft: TodoItem;
  session_created?: boolean;  // If this started a new session
}
```

**Behavior**:
1. Mark draft as "claimed" (add `claimedBy` field)
2. Move associated session to "In Progress" if not already
3. Emit activity event
4. Return draft details for agent context

**UI Changes**:
- Claimed drafts show which session is working on them
- Prevent other sessions from claiming same draft
- "Unclaim" action if session abandons task

### 4.2 Task Completion with Notes

**Enhanced Tool**: `hilt_complete_draft`

```typescript
interface CompleteDraftParams {
  draft_id: string;
  notes?: string;           // Completion notes
  create_followup?: {       // Optional follow-up task
    prompt: string;
    section?: string;
  }[];
  move_session_to?: "recent" | "done";  // Where to move the session
}

interface CompleteDraftResult {
  success: boolean;
  followup_ids?: string[];  // IDs of created follow-up tasks
}
```

**Behavior**:
1. Mark draft as completed in Todo.md (checkbox)
2. Add completion notes as sub-item or comment
3. Create follow-up drafts if specified
4. Optionally move associated session to Recent/Done
5. Show success notification in UI

### 4.3 Agent-Generated Tasks

**New Tool**: `hilt_create_subtasks`

```typescript
interface CreateSubtasksParams {
  parent_id?: string;       // Parent draft ID (optional)
  scope: string;
  tasks: {
    prompt: string;
    section?: string;
    priority?: "high" | "normal" | "low";
  }[];
}

interface CreateSubtasksResult {
  created: { id: string; prompt: string }[];
}
```

**Use Cases**:
- Agent discovers additional work during task
- Breaking down a large task into subtasks
- Creating follow-up tasks from code review findings

### 4.4 Session Handoff

**New Tool**: `hilt_request_review`

```typescript
interface RequestReviewParams {
  session_id: string;
  notes: string;
  reviewer?: string;        // @mention or "user"
  artifacts?: {             // Links to review
    type: "pr" | "file" | "url";
    path: string;
    label?: string;
  }[];
}
```

**Behavior**:
1. Move session to "Review" column (new status)
2. Attach review notes visible in SessionCard
3. Show notification to user
4. Create deep link for user to jump to session

**UI Changes**:
- New "Review" column (between Active and Recent)
- Review notes displayed on card
- "Approve" / "Request Changes" actions

### 4.5 Automatic Status Transitions

**Logic in Session Route**:

```typescript
// When a session completes its claimed draft
if (draft.completed && session.status === "active") {
  if (session.hasPendingDrafts) {
    // Keep active if more work to do
  } else if (session.requestedReview) {
    session.status = "review";
  } else {
    session.status = "recent";
  }
}
```

### 4.6 Implementation Steps

```
□ 4.1.1  Add claimedBy, claimedAt fields to TodoItem
□ 4.1.2  Implement hilt_claim_draft tool
□ 4.1.3  Add claim indicator to InboxCard
□ 4.1.4  Prevent double-claiming (return error if already claimed)
□ 4.1.5  Add unclaim action (manual or on session exit)

□ 4.2.1  Extend hilt_complete_draft with notes and followup
□ 4.2.2  Update Todo.md writer to handle completion notes
□ 4.2.3  Implement follow-up task creation
□ 4.2.4  Add completion animation in UI

□ 4.3.1  Implement hilt_create_subtasks tool
□ 4.3.2  Add parent-child relationship to TodoItem
□ 4.3.3  Update InboxCard to show subtask hierarchy
□ 4.3.4  Add "expand/collapse subtasks" UI

□ 4.4.1  Add "review" status to Session type
□ 4.4.2  Create Review column in Board
□ 4.4.3  Implement hilt_request_review tool
□ 4.4.4  Add review notes display to SessionCard
□ 4.4.5  Add approve/reject actions

□ 4.5.1  Implement auto-transition logic in session route
□ 4.5.2  Add transition events to activity feed
□ 4.5.3  Test full lifecycle: create → claim → work → complete → review → done
```

---

## Phase 5: Multi-Agent Coordination

**Objective**: Enable multiple Claude sessions to coordinate work and share context.

### 5.1 Session-to-Session Notes

**New Resource**: `hilt://sessions/{id}/notes`

Agents can leave notes for other sessions (or future sessions of the same project):

```typescript
interface SessionNote {
  id: string;
  sessionId: string;        // Which session wrote it
  targetSessionId?: string; // Specific target (or null for "all")
  content: string;
  timestamp: Date;
  read: boolean;
}
```

**New Tools**:
- `hilt_add_session_note(target_session_id, content)`
- `hilt_get_session_notes(session_id?)` - Get notes for current/specific session
- `hilt_mark_note_read(note_id)`

### 5.2 Shared Context Pool

**Concept**: A scope-level knowledge base that agents can contribute to:

**Location**: `{scope}/docs/hilt-context.md` (persisted to project)

**Structure**:
```markdown
# Project Context (Auto-generated by Hilt)

## Key Decisions
- 2024-01-15: Chose React Query over SWR for data fetching (session xyz)
- 2024-01-14: Using Tailwind v4 with CSS variables for theming

## Known Issues
- [ ] Memory leak in WebSocket reconnection (tracked in #42)
- [x] Fixed: SSR hydration mismatch (session abc)

## Architecture Notes
- API routes in /api, no tRPC
- State management: React Context + SWR
```

**Tools**:
- `hilt_add_context_note(category, content)` - Add to shared context
- `hilt_get_shared_context()` - Read full context file
- `hilt_search_context(query)` - Search within context

### 5.3 Work Queue Management

**Concept**: Agents can see and coordinate on available work:

**New Tool**: `hilt_get_available_work`

```typescript
interface AvailableWork {
  drafts: TodoItem[];       // Unclaimed drafts
  reviews: Session[];       // Sessions awaiting review
  blocked: {                // Items blocked on something
    item: TodoItem | Session;
    blockedBy: string;
  }[];
}
```

**Use Case**: An agent finishing early can ask "what else needs doing?" and pick up unclaimed work.

### 5.4 Capability Delegation

**Concept**: One agent can request another agent handle specific work:

**New Tool**: `hilt_delegate_task`

```typescript
interface DelegateTaskParams {
  task: string;             // What to do
  scope: string;            // Where to do it
  context?: string;         // Additional context
  wait_for_completion?: boolean;  // Block until done
}
```

**Behavior**:
1. Create a new draft with the task
2. Optionally spawn a new Claude session
3. If `wait_for_completion`, poll until task is marked done
4. Return result/notes from delegated session

### 5.5 Implementation Steps

```
□ 5.1.1  Create SessionNote type and storage (data/session-notes.json)
□ 5.1.2  Implement note CRUD tools
□ 5.1.3  Add notes indicator to SessionCard
□ 5.1.4  Add notes panel in TerminalDrawer

□ 5.2.1  Define shared context file format
□ 5.2.2  Implement context file read/write functions
□ 5.2.3  Create context management tools
□ 5.2.4  Add context viewer in Docs view

□ 5.3.1  Implement work queue aggregation
□ 5.3.2  Create hilt_get_available_work tool
□ 5.3.3  Add "Available Work" panel to UI

□ 5.4.1  Design delegation protocol
□ 5.4.2  Implement hilt_delegate_task tool
□ 5.4.3  Add delegation tracking to activity feed
□ 5.4.4  Handle delegation failures gracefully
```

---

## Implementation Details

### File Structure (Final)

```
server/
├── mcp/
│   ├── index.ts              # MCP server entry
│   ├── server.ts             # Server implementation
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── sessions.ts       # Session tools
│   │   ├── drafts.ts         # Draft/inbox tools
│   │   ├── navigation.ts     # Scope/folder tools
│   │   ├── ui.ts             # UI control tools
│   │   ├── discovery.ts      # Introspection tools
│   │   ├── workflow.ts       # Task lifecycle tools
│   │   └── coordination.ts   # Multi-agent tools
│   ├── resources/
│   │   ├── index.ts          # Resource registry
│   │   ├── sessions.ts
│   │   ├── drafts.ts
│   │   ├── plans.ts
│   │   └── context.ts
│   └── types.ts
├── ws-server.ts              # Existing WebSocket server
├── event-server.ts           # Existing event server
└── watchers/                 # Existing file watchers

src/
├── components/
│   ├── ActivityFeed.tsx      # New: Agent activity log
│   ├── Notifications.tsx     # New: Toast system
│   └── ...existing
├── lib/
│   ├── context-generator.ts  # New: Context file generation
│   └── ...existing
└── app/
    └── api/
        ├── context/route.ts  # New: Context API
        └── ...existing
```

### Dependencies to Add

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

### Configuration Files

**.claude/settings.json** (project-level):
```json
{
  "mcpServers": {
    "hilt": {
      "command": "node",
      "args": ["./server/mcp/index.js"],
      "env": {
        "HILT_PORT": "3000"
      }
    }
  }
}
```

### Type Definitions Summary

```typescript
// server/mcp/types.ts

export interface HiltContext {
  scope: string;
  timestamp: string;
  sessions: {
    active: Session[];
    recent: Session[];
    running: Session[];
    review: Session[];
  };
  drafts: {
    items: TodoItem[];
    sections: string[];
    claimed: Map<string, string>;  // draftId -> sessionId
  };
  stats: SessionStats;
  capabilities: string[];
}

export interface ActivityEvent {
  id: string;
  timestamp: Date;
  sessionId: string;
  sessionSlug?: string;
  action: ActivityAction;
  details: string;
  target?: string;
  targetType?: "draft" | "session" | "folder";
}

export type ActivityAction =
  | "draft_created"
  | "draft_completed"
  | "draft_claimed"
  | "session_moved"
  | "session_starred"
  | "review_requested"
  | "notification_sent"
  | "note_added"
  | "context_updated";

export interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  sessionId?: string;
  action?: NotificationAction;
  duration?: number;
}

export interface NotificationAction {
  label: string;
  href?: string;
  event?: string;
}

export interface SessionNote {
  id: string;
  fromSessionId: string;
  toSessionId?: string;
  content: string;
  timestamp: Date;
  read: boolean;
}

export interface DelegatedTask {
  id: string;
  fromSessionId: string;
  toSessionId?: string;
  task: string;
  scope: string;
  context?: string;
  status: "pending" | "claimed" | "completed" | "failed";
  result?: string;
}
```

---

## Migration & Rollout

### Phase Rollout Schedule

| Phase | Scope | Prerequisite | Estimated Effort |
|-------|-------|--------------|------------------|
| **Phase 1** | MCP Server Foundation | None | 3-4 sessions |
| **Phase 2** | Context Injection | Phase 1 | 1-2 sessions |
| **Phase 3** | Agent-to-UI Communication | Phase 1 | 2-3 sessions |
| **Phase 4** | Workflow Automation | Phases 1-3 | 3-4 sessions |
| **Phase 5** | Multi-Agent Coordination | Phases 1-4 | 3-4 sessions |

### Backwards Compatibility

- All changes are additive - existing UI workflows unchanged
- MCP server is optional - Hilt works without it
- New fields have sensible defaults
- Activity feed and notifications can be dismissed/hidden

### Testing Strategy

**Phase 1 Testing**:
1. Start Hilt MCP server
2. In Claude Code, use `/mcp` to verify tools visible
3. Call each tool and verify response
4. Check UI updates after tool calls

**Integration Testing**:
1. Create draft via MCP → verify appears in UI
2. Complete draft via MCP → verify checkbox in Todo.md
3. Move session via MCP → verify column change
4. Show notification via MCP → verify toast appears

**End-to-End Workflow Test**:
1. Create draft in Hilt UI: "Implement feature X"
2. Start Claude session from CLI
3. Agent calls `hilt_get_context` → sees the draft
4. Agent calls `hilt_claim_draft` → draft shows claimed
5. Agent works on feature
6. Agent calls `hilt_complete_draft` with notes
7. Agent calls `hilt_request_review`
8. User sees session in Review column with notes
9. User approves → session moves to Done

### Success Metrics

- **Parity**: 100% of UI actions have MCP tool equivalents
- **Adoption**: Agents use Hilt tools in >50% of sessions
- **Efficiency**: Task completion time reduced (fewer manual board updates)
- **Discovery**: Agents successfully complete tasks not explicitly designed for

---

## Appendix: Tool Reference Card

Quick reference for all MCP tools:

```
SESSION MANAGEMENT
  hilt_list_sessions     - List sessions (scope, status, limit)
  hilt_get_session       - Get single session (id)
  hilt_update_status     - Move session (id, status)
  hilt_star_session      - Toggle star (id, starred)
  hilt_archive_session   - Archive session (id)
  hilt_get_running       - List running sessions (scope)

DRAFT MANAGEMENT
  hilt_list_drafts       - List drafts (scope, section)
  hilt_create_draft      - Create draft (prompt, scope, section)
  hilt_update_draft      - Update draft (id, prompt, section)
  hilt_complete_draft    - Mark done (id, notes, followups)
  hilt_delete_draft      - Delete draft (id)
  hilt_claim_draft       - Claim for session (id, session_id)
  hilt_create_subtasks   - Batch create (parent_id, tasks[])

NAVIGATION
  hilt_get_scope         - Current scope
  hilt_list_folders      - Subfolders (scope)
  hilt_pin_folder        - Pin folder (path)
  hilt_unpin_folder      - Unpin folder (path)
  hilt_list_pinned       - List pinned

UI CONTROL
  hilt_navigate_to       - Change scope (scope)
  hilt_open_session      - Open terminal (id)
  hilt_close_session     - Close terminal (id)
  hilt_show_notification - Toast message (message, type)
  hilt_set_view_mode     - Change view (mode)

DISCOVERY
  hilt_list_capabilities - All available tools
  hilt_get_context       - Full context snapshot (scope)
  hilt_get_stats         - Activity metrics (scope)

WORKFLOW
  hilt_request_review    - Request user review (session_id, notes)
  hilt_get_available_work - Unclaimed tasks

COORDINATION
  hilt_add_session_note  - Leave note (target_session, content)
  hilt_get_session_notes - Read notes (session_id)
  hilt_add_context_note  - Add to shared context (category, content)
  hilt_delegate_task     - Delegate to new session (task, scope)
```

---

*Last updated: 2025-01-09*
