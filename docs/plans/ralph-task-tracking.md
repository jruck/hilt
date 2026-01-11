# Ralph Task Tracking - Implementation Plan

## Overview

Enhance the Ralph Wiggum integration with visual task tracking. Instead of just running a loop with a prompt, provide a structured flow from seed idea → concept → task plan → execution with live progress visualization.

## Core Concept

Ralph's power is the **task list**, not just the loop. Hilt can provide what Ralph itself doesn't: a visual layer showing tasks being checked off in real-time.

---

## User Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Seed Idea   │ ──► │   Concept    │ ──► │  Task Plan   │ ──► │   Execute    │
│  (inbox)     │     │  (refined)   │     │  (checklist) │     │  (Ralph)     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### Step 1: Seed → Concept
- User clicks Ralph button on inbox item
- Option: "Refine into concept"
- Claude session helps flesh out objectives, scope, criteria
- Output: Clear concept ready for task decomposition

### Step 2: Concept → Task Plan
- New step: "Generate task plan"
- Claude breaks concept into atomic, checkable tasks
- Output: Markdown file with hierarchical checklist
- Saved to `.claude/plans/{slug}-tasks.md`

### Step 3: Execute with Live Tracking
- Ralph loop runs against the task plan
- Claude checks off tasks as it completes them (`- [ ]` → `- [x]`)
- Hilt shows real-time progress in subtasks panel
- Loop exits when all tasks checked OR completion promise output

---

## Phase 1: Subtasks Panel

### 1.1 Task Parser

**File**: `src/lib/task-parser.ts`

```typescript
interface ParsedTask {
  id: string;           // hash of file + heading + text
  text: string;
  completed: boolean;
  sourceFile: string;
  heading: string;      // Parent heading (##, ###)
  headingLevel: number;
  lineNumber: number;
}

interface TaskGroup {
  file: string;
  relativePath: string;
  sections: {
    heading: string;
    tasks: ParsedTask[];
  }[];
  stats: {
    total: number;
    completed: number;
  };
}

// Parse markdown content for checkbox items
function parseTasksFromMarkdown(content: string, filePath: string): ParsedTask[];

// Group tasks by file and heading
function groupTasks(tasks: ParsedTask[]): TaskGroup[];
```

### 1.2 Subtasks Component

**File**: `src/components/SubtasksPanel.tsx`

- Collapsible sections by file
- Nested sections by heading
- Checkbox items (read-only, reflects file state)
- Progress bar at bottom
- Real-time updates via file watcher

### 1.3 Integration Points

- Add to TerminalDrawer as a tab alongside "Plan" and "Terminal"
- Or: Show in sidebar when session has tracked plan files
- Auto-discover task files:
  - `.claude/plans/*.md`
  - Session-specific plan files
  - Files matching `*-tasks.md`, `*-checklist.md`

---

## Phase 2: Task Plan Generation

### 2.1 Task Plan Prompt

Update Ralph flow to include task generation step:

```typescript
export function generateTaskPlanPrompt(concept: string): string {
  return `Based on this concept, create a detailed task plan with checkable items:

---
${concept}
---

Create a markdown checklist that:

1. **Atomic tasks**: Each task is one specific action
2. **Testable**: Each task has a clear done/not-done state
3. **Ordered**: Tasks are in logical execution order
4. **Grouped**: Related tasks under meaningful headings
5. **Complete**: All work needed is captured

Format:

## Setup
- [ ] Task 1
- [ ] Task 2

## Feature: [Name]
- [ ] Task 3
- [ ] Task 4
  - [ ] Subtask 4a
  - [ ] Subtask 4b

## Testing
- [ ] Write unit tests for X
- [ ] Write integration tests for Y
- [ ] All tests pass

## Verification
- [ ] Build succeeds
- [ ] Linter passes
- [ ] Feature works as specified

IMPORTANT:
- Include testing tasks after each feature section
- End with verification tasks
- Each task should be completable in 1-5 minutes of AI work
- Aim for 20-60 tasks depending on scope

Output the plan in a code block:

\`\`\`markdown
# Task Plan: [Title]

## Section 1
- [ ] Task...
\`\`\`
`;
}
```

### 2.2 Modified Ralph Flow

```
1. Seed idea (inbox)
      ↓
2. [Optional] Refine concept
      ↓
3. Generate task plan → saves to .claude/plans/
      ↓
4. Review/edit task plan in Hilt
      ↓
5. Start Ralph loop with task plan as prompt
      ↓
6. Watch tasks get checked off in real-time
```

### 2.3 Ralph Prompt Modification

The Ralph prompt should instruct Claude to:
1. Read the task plan
2. Work through tasks in order
3. Check off each task as completed (edit the file)
4. Output completion promise when all tasks done

```typescript
function generateRalphExecutionPrompt(taskPlanPath: string): string {
  return `Execute the task plan in ${taskPlanPath}.

For each task:
1. Read the current state of the task plan
2. Find the next unchecked task (- [ ])
3. Complete the task
4. Update the task plan, changing - [ ] to - [x]
5. Repeat until all tasks are checked

When ALL tasks are complete (no remaining - [ ] items), output:
<promise>ALL_TASKS_COMPLETE</promise>

Important:
- Complete tasks in order
- Only check off tasks that are truly done
- If a task fails, note why and move to next
- Commit your work after each major section
`;
}
```

---

## Phase 3: Real-Time Updates

### 3.1 Plan File Watcher

Extend existing ScopeWatcher or create PlanWatcher:

```typescript
// Watch .claude/plans/ directory for session
// Emit events when plan files change
// Debounce rapid changes (Claude editing)

interface PlanWatcherEvents {
  'plan:updated': { path: string; content: string };
  'plan:created': { path: string };
  'plan:deleted': { path: string };
}
```

### 3.2 WebSocket Events

Add plan-specific events to ws-server:

```typescript
// New event types
{ type: 'plan:tasks-updated', sessionId, tasks: TaskGroup[] }
{ type: 'plan:progress', sessionId, completed: number, total: number }
```

### 3.3 Subtasks Hook

```typescript
function useSubtasks(sessionId: string) {
  // Subscribe to plan file changes
  // Parse tasks on each update
  // Return { tasks, progress, isLoading }
}
```

---

## Phase 4: UI Polish

### 4.1 Subtasks Tab in Drawer

- Tab alongside Terminal / Plan
- Shows aggregated task view
- Filters: All / Pending / Completed
- Search tasks

### 4.2 Progress in Session Card

Show task progress on session cards:

```
┌─────────────────────────────────────┐
│ 🔄 weather-tracker-swim-meets       │
│ Working • 8/24 tasks                │
│ ████████░░░░░░░░░░░░░░░░ 33%       │
└─────────────────────────────────────┘
```

### 4.3 Ralph Button States

- Idle: "Start Ralph Loop"
- Has plan: "Resume (8/24 tasks)"
- Running: "Running... 33%"
- Done: "Completed ✓"

---

## File Checklist

### New Files

```
src/lib/task-parser.ts          # Parse markdown checkboxes
src/components/SubtasksPanel.tsx # Task list UI
src/hooks/useSubtasks.ts        # Task state hook
server/watchers/plan-watcher.ts # File watching
```

### Modified Files

```
src/components/TerminalDrawer.tsx   # Add subtasks tab
src/components/SessionCard.tsx      # Show task progress
src/components/RalphSetupModal.tsx  # Add task plan step
src/lib/ralph.ts                    # Task plan generation
server/ws-server.ts                 # Plan update events
```

---

## Open Questions

1. **Task plan storage**: `.claude/plans/` or session-specific location?
2. **Multiple plan files**: Aggregate all or just primary?
3. **Task editing**: Allow manual check/uncheck in Hilt UI?
4. **Failed tasks**: How to handle/display tasks Claude couldn't complete?
5. **Subtask nesting**: Support nested checkboxes or flatten?

---

## MVP Scope

For first iteration, focus on:

1. ✅ Task parser for markdown checkboxes
2. ✅ Subtasks panel component
3. ✅ Show in drawer for sessions with plan files
4. ✅ Real-time updates via existing file watcher
5. ✅ Progress bar on session card

Defer to later:
- Task plan generation step
- Modified Ralph execution prompt
- Task editing in UI
- Complex nesting support

---

*Created: 2026-01-11*
