# Vision: Task-Centric Claude Kanban

> **Status**: Draft for discussion
> **Goal**: Shift from "watch sessions" to "manage work, review results"

## The Problem with Session-Centric Design

Currently, Claude Kanban treats the **session** as the primary unit:
- Sessions are organized into columns
- Sessions are resumed in terminals
- Sessions show running status

But sessions are an implementation detail of Claude Code. Users don't think in sessions—they think in **tasks**:
- "Fix the login bug"
- "Add dark mode"
- "Review this PR"

A session might span multiple tasks, or a task might span multiple sessions. The mapping is fuzzy and unhelpful.

### What Users Actually Want

| User Goal | Current Experience | Ideal Experience |
|-----------|-------------------|------------------|
| "Queue work for later" | Create draft prompt | Create task with context |
| "What's Claude working on?" | Watch terminal scroll | See task status + ETA |
| "What did Claude do?" | Scroll terminal history | See results, diffs, artifacts |
| "Continue previous work" | Find session, resume, re-explain | Resume task with full context |
| "Run multiple things" | Open terminal tabs, watch all | Queue tasks, get notified |

---

## Proposed Direction: Task-First Architecture

### Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│                         TASK                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Context   │  │   Sessions  │  │   Results   │              │
│  │             │  │             │  │             │              │
│  │ • Goal      │  │ • Run 1     │  │ • Files     │              │
│  │ • Files     │  │ • Run 2     │  │ • Commits   │              │
│  │ • URLs      │  │ • Run 3     │  │ • Plans     │              │
│  │ • Notes     │  │             │  │ • Errors    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

**Task** becomes the first-class citizen:
- A task has a **goal** (what you want done)
- A task accumulates **context** (files, URLs, notes, constraints)
- A task may have multiple **sessions** (runs/attempts)
- A task produces **results** (artifacts, diffs, commits)

Sessions become an implementation detail—the "runs" of a task.

---

## Feature: Notifications

### Problem
Currently, you have to watch the terminal to know when Claude is done or needs input. This forces synchronous attention.

### Solution
Desktop notifications for key events:

| Event | Notification | Action |
|-------|--------------|--------|
| Task completed | "✓ Dark mode implementation complete" | Click to review results |
| Approval needed | "⚠️ Claude wants to push to main" | Click to approve/reject |
| Error/stuck | "❌ Build failed - needs input" | Click to intervene |
| Context limit | "📊 Context at 80% - may need new session" | Click to review |

### Implementation Considerations

1. **Desktop Notifications API** - Browser Notification API for web, Electron's native notifications for desktop app
2. **Notification Preferences** - Per-task or global settings for what triggers notifications
3. **Quiet Hours** - Optional suppression during focus time
4. **Notification History** - Log of all notifications for review

### User Workflow

```
1. Create task "Add user authentication"
2. Add context (relevant files, requirements doc URL)
3. Click "Run" → Claude starts working
4. Minimize/switch to other work
5. Notification: "⚠️ Which auth provider? OAuth or JWT?"
6. Click notification → Quick response UI
7. Continue other work
8. Notification: "✓ Authentication complete - 5 files changed"
9. Click → Review diff, approve commit
```

---

## Feature: Approval Gates

### Problem
Claude can execute potentially destructive actions (push code, delete files, run commands) without explicit approval. Users either:
- Watch nervously in the terminal
- Trust blindly and hope for the best

### Solution
Configurable approval gates that pause execution and request human approval.

### Gate Types

| Gate | Triggers On | User Sees |
|------|-------------|-----------|
| **Git Push** | Any `git push` command | Branch, commit summary, diff preview |
| **Destructive Commands** | `rm`, `drop table`, etc. | Command + affected files/data |
| **External API Calls** | HTTP requests to external services | Endpoint, payload preview |
| **File Deletion** | Removing files outside temp | File list, recovery option |
| **Credential Access** | Reading .env, secrets | Which secrets, why needed |

### Approval UI

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Approval Required                                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Claude wants to push to remote:                            │
│                                                              │
│  Branch: feature/dark-mode                                  │
│  Commits: 3                                                  │
│  Files changed: 12                                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ + src/theme/dark.ts (new)                              │ │
│  │ ~ src/components/App.tsx (+45, -12)                    │ │
│  │ ~ src/styles/globals.css (+89, -23)                    │ │
│  │ ...9 more files                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [View Full Diff]    [Reject]    [Approve & Push]           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
interface ApprovalConfig {
  // Global gates
  requireApprovalFor: {
    gitPush: boolean;
    gitForce: boolean;  // Always true, non-configurable
    fileDelete: boolean;
    externalHttp: boolean;
    shellCommands: string[];  // Pattern matching
  };

  // Per-task overrides
  taskOverrides: {
    [taskId: string]: Partial<ApprovalConfig['requireApprovalFor']>;
  };

  // Auto-approve patterns (for trusted operations)
  autoApprove: {
    branches: string[];  // e.g., ["feature/*"]
    files: string[];     // e.g., ["*.test.ts"]
  };
}
```

### Implementation Notes

1. **Hook Integration** - Leverage Claude Code's hook system to intercept commands
2. **Pause/Resume** - Need mechanism to pause Claude's execution while awaiting approval
3. **Timeout Handling** - What happens if user doesn't respond? Options: timeout reject, keep waiting, notify again
4. **Audit Log** - Record all approvals/rejections for review

---

## Feature: MCP Integration

### Problem
Claude Code sessions can't query the kanban board. If you ask "what tasks do I have queued?" Claude has no way to know.

### Solution
Expose Claude Kanban as an MCP server that Claude Code can query.

### MCP Resources

```typescript
// Available resources
resources: [
  {
    uri: "kanban://tasks",
    name: "All Tasks",
    description: "List all tasks across all states"
  },
  {
    uri: "kanban://tasks/inbox",
    name: "Queued Tasks",
    description: "Tasks waiting to be started"
  },
  {
    uri: "kanban://tasks/active",
    name: "Active Tasks",
    description: "Tasks currently in progress"
  },
  {
    uri: "kanban://tasks/{id}",
    name: "Task Details",
    description: "Full context for a specific task"
  },
  {
    uri: "kanban://tasks/{id}/results",
    name: "Task Results",
    description: "Artifacts and outcomes from a task"
  }
]
```

### MCP Tools

```typescript
// Available tools
tools: [
  {
    name: "kanban_create_task",
    description: "Create a new task in the inbox",
    parameters: {
      title: string,
      description?: string,
      context?: { files?: string[], urls?: string[] }
    }
  },
  {
    name: "kanban_update_task",
    description: "Update task status or add results",
    parameters: {
      taskId: string,
      status?: "inbox" | "active" | "done",
      results?: { files?: string[], commits?: string[], notes?: string }
    }
  },
  {
    name: "kanban_get_next_task",
    description: "Get the next prioritized task from inbox",
    parameters: {
      project?: string  // Filter by project path
    }
  }
]
```

### Use Cases

1. **Task Chaining** - Claude completes one task, queries for next task, continues
2. **Context Injection** - Task includes files/URLs, Claude fetches them automatically
3. **Result Recording** - Claude records what it accomplished back to the task
4. **Cross-Session Continuity** - New session can query previous task's results

### Example Interaction

```
User: "Work through my task queue"

Claude: *calls kanban_get_next_task()*
→ Returns: { id: "abc", title: "Fix login bug", context: { files: ["src/auth.ts"] } }

Claude: *reads src/auth.ts, fixes bug, commits*
Claude: *calls kanban_update_task({ taskId: "abc", status: "done", results: { commits: ["a1b2c3"] } })*

Claude: *calls kanban_get_next_task()*
→ Returns: { id: "def", title: "Add rate limiting", ... }

Claude: *continues to next task...*
```

---

## Revised Information Architecture

### Current Structure (Session-Centric)

```
Board
├── To Do (drafts)
├── In Progress (active sessions)
└── Recent (completed sessions)
```

### Proposed Structure (Task-Centric)

```
Board
├── Inbox (queued tasks)
│   └── TaskCard
│       ├── Title & description
│       ├── Context (files, URLs, notes)
│       ├── Priority/tags
│       └── Actions: [Run] [Edit] [Archive]
│
├── Active (running tasks)
│   └── TaskCard
│       ├── Title & current status
│       ├── Progress indicator
│       ├── Latest output summary
│       ├── Pending approvals (if any)
│       └── Actions: [View Terminal] [Pause] [Stop]
│
├── Review (completed, needs review)
│   └── TaskCard
│       ├── Title & completion status
│       ├── Results summary (files, commits)
│       ├── Diff preview
│       └── Actions: [Review] [Approve] [Re-run]
│
└── Done (archived)
    └── TaskCard (collapsed)
        ├── Title & outcome
        ├── Duration
        └── Actions: [View] [Clone]
```

### Task Detail View

When you click a task, instead of opening a terminal, open a **Task Detail Panel**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Fix authentication timeout bug                          [Edit] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CONTEXT                                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Files:  src/auth/session.ts, src/middleware/auth.ts       │ │
│  │ URLs:   https://github.com/org/repo/issues/123            │ │
│  │ Notes:  Users report 5-minute timeout instead of 30-min   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  RUNS                                                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ #1  Jan 8, 2:30pm  ✓ Completed  [View Terminal] [Results] │ │
│  │ #2  Jan 8, 3:15pm  ⚠️ Needs Review  [View Terminal]        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  RESULTS (Run #2)                                                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Files Changed:                                              │ │
│  │   ~ src/auth/session.ts (+12, -3)                          │ │
│  │   ~ src/config/defaults.ts (+1, -1)                        │ │
│  │                                                             │ │
│  │ Commits:                                                    │ │
│  │   a1b2c3d "Fix session timeout from 5min to 30min"        │ │
│  │                                                             │ │
│  │ [View Full Diff]  [Approve Commit]  [Request Changes]      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [Archive Task]                              [Run Again]         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Terminal as Secondary

The terminal becomes **optional detail**, not the main interface:
- Click "View Terminal" to see raw output
- Most users won't need it for completed tasks
- Still available for debugging or live monitoring
- Could be a popout/modal rather than persistent drawer

---

## User Workflows

### Workflow 1: Queue and Batch Process

**Goal**: Queue up several tasks, let Claude work through them, review results at end of day.

```
Morning:
1. Open Claude Kanban
2. Create task "Fix login bug" with context (issue link, relevant files)
3. Create task "Add rate limiting" with context
4. Create task "Update dependencies"
5. Click "Run All" or run individually
6. Minimize, do other work

Throughout day:
- Notifications appear for approvals (review, approve)
- Notifications appear for completions

End of day:
1. Open Claude Kanban
2. Review column shows 3 tasks awaiting review
3. Click each, review diff, approve or request changes
4. Move approved tasks to Done
```

### Workflow 2: Interactive Development

**Goal**: Work alongside Claude on a complex feature.

```
1. Create task "Implement OAuth2 flow"
2. Add context: design doc URL, relevant files, constraints
3. Click "Run"
4. Click "View Terminal" to watch/interact
5. Claude asks question → answer in terminal
6. Claude requests approval for package install → approve
7. Claude completes → notification
8. Review results in task panel
9. Request changes: "Also add refresh token support"
10. Claude continues from context
11. Review again → approve
```

### Workflow 3: Exploration and Research

**Goal**: Have Claude research something, review findings later.

```
1. Create task "Research state management options for our React app"
2. Add context: current tech stack, requirements
3. Set task type: "Research" (no code changes expected)
4. Run
5. Claude researches, writes findings to task results
6. Later: review research summary
7. Create follow-up task: "Implement Zustand based on research"
```

### Workflow 4: Continuous Integration

**Goal**: Claude monitors and fixes CI failures.

```
1. Task auto-created from CI webhook: "CI failed on main: test/auth.spec.ts"
2. Context auto-populated: failed test output, recent commits
3. Notification: "New CI failure task"
4. Claude auto-runs (if configured) or awaits approval
5. Claude fixes, creates PR
6. Approval gate: "Push PR for CI fix?"
7. Approve → PR created
8. Task marked done when CI passes
```

---

## Migration Path

### Phase 1: Task Layer (Minimum Viable)

Add task abstraction on top of existing sessions:
- New Task data model
- Task CRUD API
- Basic task UI (create, list, view)
- Link tasks to sessions (1:many)
- Keep existing session/terminal flow working

### Phase 2: Results & Review

- Capture results when sessions complete
- Results view in task detail
- Diff preview component
- Review workflow (approve/reject/re-run)

### Phase 3: Notifications

- Desktop notification system
- Notification preferences
- Notification history log
- Click-to-action from notifications

### Phase 4: Approval Gates

- Hook into Claude Code command execution
- Approval request/response flow
- Approval UI components
- Approval configuration
- Audit logging

### Phase 5: MCP Server

- Implement MCP server for kanban
- Resource endpoints for tasks
- Tool endpoints for task management
- Documentation for Claude Code integration
- Auto-discovery configuration

### Phase 6: Automation

- CI/CD webhook integrations
- Auto-task creation rules
- Task chaining (on complete → start next)
- Scheduled tasks

---

## Open Questions

1. **Backward Compatibility** - How do existing sessions map to tasks? Auto-create task per session? Or fresh start?

2. **Task Granularity** - Should one task = one prompt? Or can a task be "Add feature X" spanning multiple prompts/sessions?

3. **Results Detection** - How do we know what Claude changed? Parse git diff? Watch file system? Claude self-reports via MCP?

4. **Approval Mechanism** - How do we actually pause Claude mid-execution? Does Claude Code support this? Or do we need upstream changes?

5. **MCP Registration** - How does Claude Code discover our MCP server? Auto-configure in project settings?

6. **Multi-Project** - Does each project have its own task board? Or one unified board with project filtering (current approach)?

7. **Collaboration** - Is this single-user? Could multiple people share a task board?

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time watching terminal | High (synchronous) | Low (async with notifications) |
| Tasks queued per day | ~3 (drafts underused) | 10+ (primary workflow) |
| Context re-explaining | Often (session resume) | Rare (task context persists) |
| Missed completions | Common (no notifications) | Zero (always notified) |
| Accidental destructive actions | Possible | Zero (approval gates) |

---

## Next Steps

1. **Review this document** - Discuss, refine, challenge assumptions
2. **Prioritize phases** - Which brings most value soonest?
3. **Prototype task UI** - Low-fidelity mockup of task-centric board
4. **Investigate approval feasibility** - Can we actually pause Claude Code?
5. **MCP spike** - Minimal MCP server to prove the concept

---

*Draft created: January 8, 2026*
