# Phase 1: Task Layer

> **Goal**: Introduce "Task" as the primary unit of work, replacing session-centric thinking. Tasks contain context, link to sessions (runs), and track state through a meaningful lifecycle.

> **Status**: Planning — Questions pending

## Problem Statement

Currently, the app organizes around **sessions** — Claude Code's implementation detail. But users think in **tasks**:

- "Fix the login bug" (not "session abc-123")
- "Add dark mode" (not "three sessions over two days")

Sessions are created outside the app (via CLI), have cryptic IDs, and don't carry persistent context. The Task Layer adds a user-meaningful abstraction on top.

## What We Discussed

### Task as Goal-Level Abstraction

From our conversation:
- Tasks represent **goals**, not individual prompts
- A task like "Add OAuth" might span multiple sessions/runs
- Tasks should accumulate **context** (files, URLs, notes) that persists across runs

### Session → Task Relationship

Key insight from user:
> "The current advantage to having sessions is that it also forces sessions to happen outside of the app... not 100% of work is going to flow through the UI as a task."

This means:
- Sessions created via CLI (outside app) should **auto-become tasks**
- We're not replacing sessions, we're wrapping them in a task abstraction
- Tasks created in-app (from drafts) are the intentional path
- Sessions discovered externally are the organic path

### Migration Strategy

User preference:
> "Each session a task by default... most old standalone sessions are archived"

This suggests:
- Auto-create task for each session
- Old sessions become archived tasks
- Active work gets promoted to active tasks

## Proposed Scope

### Task Data Model

```typescript
interface Task {
  id: string;                    // UUID
  title: string;                 // User-meaningful name
  description?: string;          // Longer explanation

  // Lifecycle
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;

  // Context (persists across runs)
  context: {
    files?: string[];            // Relevant file paths
    urls?: string[];             // Reference URLs
    notes?: string;              // Freeform instructions
    branch?: string;             // Git branch
  };

  // Linked sessions (runs)
  sessionIds: string[];          // Sessions that belong to this task

  // Organization
  projectPath: string;           // Which project this task belongs to
  tags?: string[];               // User-defined tags
  priority?: number;             // Sort order in inbox

  // Metadata
  source: 'manual' | 'auto';     // How task was created
  archived: boolean;
}

type TaskStatus =
  | 'inbox'      // Queued, not started
  | 'active'     // Currently running
  | 'review'     // Completed, needs review
  | 'done'       // Reviewed and approved
  | 'archived';  // Hidden from default view
```

### Task CRUD API

```typescript
// GET /api/tasks
// List tasks with filtering
Query: {
  projectPath?: string,
  status?: TaskStatus | TaskStatus[],
  includeArchived?: boolean,
  search?: string
}

// POST /api/tasks
// Create new task
Body: {
  title: string,
  description?: string,
  context?: TaskContext,
  projectPath: string,
  sessionId?: string  // Link existing session
}

// GET /api/tasks/:id
// Get task with linked sessions

// PATCH /api/tasks/:id
// Update task
Body: Partial<Task>

// DELETE /api/tasks/:id
// Delete task (or archive?)

// POST /api/tasks/:id/sessions
// Link a session to a task
Body: { sessionId: string }

// DELETE /api/tasks/:id/sessions/:sessionId
// Unlink a session from a task
```

### Session Auto-Discovery

When sessions are discovered (existing flow):
1. Check if session already linked to a task
2. If not, auto-create task with:
   - Title from session title (first prompt summary)
   - Source: 'auto'
   - Status: derived from session activity

### UI Changes

**Board Columns** show tasks, not sessions:
- Inbox: Tasks with status='inbox'
- Active: Tasks with status='active'
- Review: Tasks with status='review'
- Done: Tasks with status='done' (or collapsed)

**Task Card** replaces Session Card:
- Shows task title, description preview
- Shows linked session count
- Shows latest activity
- Click opens Task Detail (not terminal)

**Task Detail Panel** (new):
- Full context (files, URLs, notes)
- List of runs/sessions
- Results from each run
- Actions: Run, Edit, Archive

### Storage

New file: `data/tasks.json`

```typescript
interface TaskStore {
  tasks: Task[];
  sessionTaskMap: Record<string, string>;  // sessionId → taskId lookup
}
```

## Implementation Steps (Draft)

1. **Define Task types** — `src/lib/types.ts`
2. **Create Task storage** — `src/lib/task-db.ts`
3. **Build Task API routes** — `src/app/api/tasks/`
4. **Add auto-discovery hook** — Modify session discovery to create tasks
5. **Create TaskCard component** — Replace SessionCard on board
6. **Create TaskDetail panel** — New component for task view
7. **Update Board to use tasks** — Fetch tasks instead of sessions
8. **Migration script** — Convert existing sessions to tasks

## Test Plan (Draft)

### Unit Tests
- Task CRUD operations
- Session-to-task linking
- Auto-discovery creates tasks
- Status transitions

### Integration Tests
- API endpoints return correct data
- Task creation links session properly
- Duplicate session doesn't create duplicate task

### Manual Testing
- Create task from UI
- Session outside app becomes task
- Link multiple sessions to one task
- Archive task hides it
- Task detail shows all runs

### Browser Testing (Claude via Chrome)
- Full workflow: create task → run → review → done
- Verify task persists across page refresh
- Verify session auto-discovery works

---

## Open Questions

These questions need answers before implementation:

### Task Identity

**Q1: Auto-created task titles**
For tasks auto-created from sessions discovered outside the app, what should the title be?
- Option A: Use session's title (first prompt summary)
- Option B: Generic "Untitled Task" requiring user edit
- Option C: Derive from git branch if available, else session title

**Q2: Task vs Session relationship model**
- Option A: 1:1 by default (each session = one task), with ability to merge tasks later
- Option B: Tasks are containers, sessions grouped by heuristic (branch? timeframe?)
- Option C: Hybrid — auto-tasks are 1:1, manual tasks can have multiple sessions

### Task States

**Q3: Task lifecycle states**
Proposed: `inbox → active → review → done → archived`

Is this right? Or different states? What triggers each transition?
- inbox → active: When first run starts?
- active → review: When run completes?
- review → done: User explicitly approves?
- done → archived: User archives or auto after X days?

**Q4: Multiple runs state handling**
If a task has multiple runs (sessions), how does task state work?
- Option A: Task stays `active` while any run is active
- Option B: Task state = latest run's state
- Option C: Each run has state, task state is derived (e.g., "2 runs, 1 active, 1 done")

### Task Context

**Q5: Context fields**
What fields should task context include?
```typescript
context: {
  files?: string[];      // Relevant file paths
  urls?: string[];       // Reference URLs
  notes?: string;        // Freeform notes/instructions
  branch?: string;       // Git branch to work on
  // What else? Constraints? Dependencies? Acceptance criteria?
}
```

**Q6: Context inheritance**
When starting a new run on a task, should context be:
- Option A: Injected into Claude's initial prompt automatically
- Option B: Available for Claude to query via MCP (Phase 5)
- Option C: Just displayed to user for reference, not sent to Claude

### Storage

**Q7: Storage format**
- Option A: JSON file (`data/tasks.json`) — simple, current pattern
- Option B: SQLite — better querying as task count grows
- Option C: Extend existing `session-status.json`

### Migration

**Q8: Existing sessions on launch**
When Phase 1 deploys, what happens to existing sessions?
- Option A: Auto-create task for each existing session
- Option B: Only create tasks for sessions going forward
- Option C: Prompt user to "import" old sessions
- Option D: Auto-create but mark old ones as archived

**Q9: Inbox items migration**
Current "drafts" in inbox — do they become tasks?
- Option A: Yes, drafts are tasks with status='inbox' and no sessions
- Option B: Keep drafts separate, tasks only created when run starts

---

## Dependencies

- **Phase 0** must be complete (background execution) so tasks can run independently
- Informs **Phase 2** (Results) — results attach to tasks, not sessions
- Informs **Phase 3** (Notifications) — notifications are about tasks

---

*Created: January 8, 2026*
*Status: Awaiting answers to open questions*
