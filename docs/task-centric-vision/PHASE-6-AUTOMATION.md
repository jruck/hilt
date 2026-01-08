# Phase 6: Automation

> **Goal**: Enable automated task creation, chaining, and scheduling. Claude Kanban becomes a work orchestration system, not just a task viewer.

> **Status**: Planning — Questions pending

## Problem Statement

Currently, task management is fully manual:
- Users create tasks one by one
- Users decide when to start each task
- No automatic responses to events (CI failure, PR created, etc.)
- No recurring task patterns

With automation:
- CI failure → task auto-created to fix it
- Task completes → next task auto-starts
- Daily at 9am → run code quality checks
- New PR → task to review it

## What We Discussed

From RESEARCH.md:

### Automation Capabilities

1. **CI/CD webhook integrations** — External events create tasks
2. **Auto-task creation rules** — Patterns that spawn tasks
3. **Task chaining** — On complete → start next
4. **Scheduled tasks** — Run at specified times

### Example Workflow (from RESEARCH.md)

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

This represents the full vision: event → task → execution → approval → completion.

## Proposed Scope

### Automation Types

```typescript
type AutomationType =
  | 'webhook'       // External event triggers task
  | 'chain'         // Task completion triggers next task
  | 'schedule'      // Time-based triggers
  | 'watch'         // File/system changes trigger task
  | 'rule';         // Condition-based triggers

interface Automation {
  id: string;
  name: string;
  description?: string;
  type: AutomationType;
  enabled: boolean;

  // Trigger configuration
  trigger: AutomationTrigger;

  // Action to take
  action: AutomationAction;

  // Conditions (optional filters)
  conditions?: AutomationCondition[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastTriggeredAt?: Date;
  triggerCount: number;
}
```

### Webhook Integrations

```typescript
interface WebhookTrigger {
  type: 'webhook';
  source: WebhookSource;
  events: string[];          // e.g., ["push", "pull_request", "workflow_run"]
  filters?: WebhookFilter[];
}

type WebhookSource =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'circleci'
  | 'custom';

interface WebhookFilter {
  field: string;             // JSON path in webhook payload
  operator: 'equals' | 'contains' | 'matches' | 'exists';
  value: string | RegExp;
}

// Example: GitHub CI failure
const ciFailureAutomation: Automation = {
  id: "auto-ci-fix",
  name: "Auto-create task on CI failure",
  type: "webhook",
  enabled: true,
  trigger: {
    type: "webhook",
    source: "github",
    events: ["workflow_run"],
    filters: [
      { field: "action", operator: "equals", value: "completed" },
      { field: "workflow_run.conclusion", operator: "equals", value: "failure" },
    ],
  },
  action: {
    type: "create_task",
    template: {
      title: "Fix CI failure: {{workflow_run.name}}",
      description: "CI failed on {{workflow_run.head_branch}}",
      context: {
        urls: ["{{workflow_run.html_url}}"],
        notes: "Failed workflow: {{workflow_run.name}}\nCommit: {{workflow_run.head_sha}}",
      },
    },
    autoStart: false,  // or true to auto-run
  },
};
```

### Task Chaining

```typescript
interface ChainTrigger {
  type: 'chain';
  sourceTaskId?: string;     // Specific task, or...
  sourceTaskTags?: string[]; // Tasks with these tags
  onStatus: 'done' | 'review' | 'failed';
}

// Example: After "Write feature" → "Write tests" → "Update docs"
const featureChain: Automation[] = [
  {
    id: "chain-tests",
    name: "Write tests after feature",
    type: "chain",
    trigger: {
      type: "chain",
      sourceTaskTags: ["feature"],
      onStatus: "done",
    },
    action: {
      type: "create_task",
      template: {
        title: "Write tests for: {{source.title}}",
        tags: ["tests"],
        context: {
          notes: "Feature completed: {{source.title}}\nFiles changed: {{source.results.filesChanged}}",
        },
      },
      autoStart: true,
    },
  },
  {
    id: "chain-docs",
    name: "Update docs after tests",
    type: "chain",
    trigger: {
      type: "chain",
      sourceTaskTags: ["tests"],
      onStatus: "done",
    },
    action: {
      type: "create_task",
      template: {
        title: "Update docs for: {{source.relatedFeature}}",
        tags: ["docs"],
      },
      autoStart: true,
    },
  },
];
```

### Scheduled Tasks

```typescript
interface ScheduleTrigger {
  type: 'schedule';
  cron: string;              // Cron expression
  timezone?: string;         // Default: system timezone
}

// Example: Daily code quality check
const dailyQualityCheck: Automation = {
  id: "daily-quality",
  name: "Daily code quality check",
  type: "schedule",
  enabled: true,
  trigger: {
    type: "schedule",
    cron: "0 9 * * 1-5",     // 9am weekdays
    timezone: "America/New_York",
  },
  action: {
    type: "create_task",
    template: {
      title: "Daily code quality review",
      description: "Run linters, check for TODOs, review test coverage",
      context: {
        notes: "Focus areas:\n- New code from yesterday\n- Outstanding TODOs\n- Coverage gaps",
      },
    },
    autoStart: true,
  },
  conditions: [
    { type: "day_has_commits", value: true },  // Only if commits yesterday
  ],
};
```

### File/System Watchers

```typescript
interface WatchTrigger {
  type: 'watch';
  paths: string[];           // Glob patterns
  events: ('create' | 'change' | 'delete')[];
  debounce?: number;         // ms to wait before triggering
}

// Example: Auto-task on new TODO comments
const todoWatcher: Automation = {
  id: "todo-watcher",
  name: "Create task for new TODOs",
  type: "watch",
  trigger: {
    type: "watch",
    paths: ["src/**/*.ts", "src/**/*.tsx"],
    events: ["change"],
    debounce: 5000,
  },
  action: {
    type: "custom",
    handler: "detectNewTodos",  // Custom logic to parse TODOs
  },
  conditions: [
    { type: "pattern_added", pattern: /\/\/ TODO:/ },
  ],
};
```

### Actions

```typescript
type AutomationAction =
  | CreateTaskAction
  | UpdateTaskAction
  | StartTaskAction
  | NotifyAction
  | CustomAction;

interface CreateTaskAction {
  type: 'create_task';
  template: TaskTemplate;
  autoStart: boolean;
  requireApproval?: boolean;  // Pause for approval before creating
}

interface UpdateTaskAction {
  type: 'update_task';
  taskSelector: TaskSelector;
  updates: Partial<Task>;
}

interface StartTaskAction {
  type: 'start_task';
  taskSelector: TaskSelector;
}

interface NotifyAction {
  type: 'notify';
  message: string;
  channels?: string[];
}

interface CustomAction {
  type: 'custom';
  handler: string;           // Name of custom handler function
  params?: Record<string, unknown>;
}

interface TaskTemplate {
  title: string;             // Supports {{variable}} interpolation
  description?: string;
  projectPath?: string;
  context?: {
    files?: string[];
    urls?: string[];
    notes?: string;
  };
  tags?: string[];
  priority?: number;
}
```

### Conditions

```typescript
interface AutomationCondition {
  type: string;
  value: unknown;
  negate?: boolean;          // NOT condition
}

// Example conditions
const conditions = {
  // Time-based
  day_of_week: ["monday", "tuesday"],
  time_range: { start: "09:00", end: "17:00" },

  // Git-based
  branch_matches: /^feature\//,
  has_uncommitted_changes: true,
  day_has_commits: true,

  // Task-based
  inbox_count_below: 5,
  no_active_tasks: true,

  // Custom
  custom: { handler: "myConditionCheck" },
};
```

### Webhook Endpoint

```typescript
// POST /api/webhooks/:source
// Receive webhooks from external services

// POST /api/webhooks/github
app.post("/api/webhooks/github", async (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  // Verify signature
  if (!verifyGitHubSignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Find matching automations
  const automations = await getAutomationsForWebhook("github", event);

  for (const automation of automations) {
    if (matchesFilters(automation.trigger.filters, payload)) {
      await executeAutomation(automation, { event, payload });
    }
  }

  res.json({ processed: automations.length });
});
```

### Automation Engine

```typescript
// src/lib/automation-engine.ts

class AutomationEngine {
  private automations: Map<string, Automation>;
  private scheduler: Scheduler;
  private watcher: FileWatcher;

  // Register automation
  register(automation: Automation): void;

  // Unregister automation
  unregister(automationId: string): void;

  // Process webhook event
  processWebhook(source: string, event: string, payload: unknown): Promise<void>;

  // Process task completion (for chaining)
  processTaskComplete(task: Task): Promise<void>;

  // Start scheduler
  startScheduler(): void;

  // Start file watcher
  startWatcher(): void;

  // Execute automation action
  private executeAction(automation: Automation, context: AutomationContext): Promise<void>;

  // Check conditions
  private checkConditions(conditions: AutomationCondition[], context: AutomationContext): boolean;

  // Interpolate template variables
  private interpolate(template: string, context: AutomationContext): string;
}
```

### Automation API

```typescript
// GET /api/automations
// List all automations
Response: { automations: Automation[] }

// POST /api/automations
// Create automation
Body: Omit<Automation, 'id' | 'createdAt' | 'updatedAt' | 'triggerCount'>
Response: { automation: Automation }

// GET /api/automations/:id
// Get automation details
Response: { automation: Automation }

// PATCH /api/automations/:id
// Update automation
Body: Partial<Automation>
Response: { automation: Automation }

// DELETE /api/automations/:id
// Delete automation
Response: { success: boolean }

// POST /api/automations/:id/trigger
// Manually trigger automation (for testing)
Body: { context?: Record<string, unknown> }
Response: { result: AutomationResult }

// GET /api/automations/:id/history
// Get trigger history
Response: { history: AutomationExecution[] }
```

### Automation UI

**Automation List**:
```
┌─────────────────────────────────────────────────────────────┐
│  Automations                                    [+ New]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ☑ CI Failure → Auto-fix task          webhook  12 runs   │
│  ☑ Feature → Tests → Docs chain        chain    8 runs    │
│  ☐ Daily quality check                 schedule  paused   │
│  ☑ New TODO watcher                    watch     3 runs   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Automation Editor**:
```
┌─────────────────────────────────────────────────────────────┐
│  Edit Automation                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Name: [CI Failure → Auto-fix task                    ]    │
│                                                             │
│  Type: ○ Webhook  ○ Chain  ○ Schedule  ○ Watch            │
│                                                             │
│  ─── Trigger ───────────────────────────────────────────   │
│  Source: [GitHub           ▼]                              │
│  Events: [workflow_run     ▼]                              │
│                                                             │
│  Filters:                                                   │
│  [action        ] [equals    ] [completed    ] [+]         │
│  [conclusion    ] [equals    ] [failure      ] [+]         │
│                                                             │
│  ─── Action ────────────────────────────────────────────   │
│  Create task with:                                         │
│  Title: [Fix CI: {{workflow_run.name}}              ]      │
│  Description: [                                      ]      │
│  ☐ Auto-start when created                                 │
│  ☐ Require approval before creating                        │
│                                                             │
│  ─── Conditions ────────────────────────────────────────   │
│  Only trigger if:                                          │
│  [No existing task for this failure    ] [+]               │
│                                                             │
│  [Cancel]                              [Save Automation]   │
└─────────────────────────────────────────────────────────────┘
```

**Execution History**:
```
┌─────────────────────────────────────────────────────────────┐
│  Execution History: CI Failure → Auto-fix                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✓ Jan 8, 3:45pm   workflow_run   Created task #45        │
│  ✓ Jan 8, 11:20am  workflow_run   Created task #44        │
│  ✗ Jan 7, 4:00pm   workflow_run   Condition not met       │
│  ✓ Jan 7, 2:30pm   workflow_run   Created task #42        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps (Draft)

1. **Automation types & model** — `src/lib/types.ts`
2. **Automation storage** — `src/lib/automation-db.ts`
3. **Automation engine** — `src/lib/automation-engine.ts`
4. **Webhook receiver** — `/api/webhooks/[source]/route.ts`
5. **GitHub webhook handler** — Signature verification, payload parsing
6. **Chain trigger integration** — Hook into task completion
7. **Scheduler (cron)** — node-cron or similar
8. **File watcher** — chokidar integration
9. **Template interpolation** — Variable substitution
10. **Condition evaluation** — Condition checker
11. **Automation API routes** — CRUD endpoints
12. **Automation list UI** — List and toggle
13. **Automation editor UI** — Create/edit form
14. **Execution history UI** — Log view

## Test Plan (Draft)

### Unit Tests

| Test | Description |
|------|-------------|
| `webhook filter matches` | Filter logic works |
| `chain trigger activates` | Task completion triggers chain |
| `schedule cron parses` | Cron expressions work |
| `conditions evaluate` | Condition checks accurate |
| `template interpolation` | Variables substituted |
| `action executes` | Tasks created correctly |

### Integration Tests

| Test | Description |
|------|-------------|
| `webhook endpoint receives` | POST /api/webhooks works |
| `GitHub signature verified` | Invalid signature rejected |
| `automation creates task` | End-to-end webhook → task |
| `chain creates next task` | Completion → new task |
| `schedule triggers` | Cron fires at right time |

### Manual Testing

- [ ] Create webhook automation
- [ ] Send test webhook, verify task created
- [ ] Create chain automation
- [ ] Complete task, verify chain fires
- [ ] Create schedule automation
- [ ] Wait for trigger, verify task created
- [ ] Disable automation, verify no trigger
- [ ] Check execution history accurate

### External Integration Testing

- [ ] Configure GitHub webhook in repo settings
- [ ] Trigger CI failure
- [ ] Verify webhook received
- [ ] Verify task auto-created
- [ ] Claude fixes issue
- [ ] Verify CI passes
- [ ] Verify task marked done

### Browser Testing (Claude via Chrome)

- [ ] View automation list
- [ ] Create new automation via UI
- [ ] Trigger automation manually
- [ ] Verify task appears in kanban
- [ ] Check execution history

---

## Open Questions

### Webhook Security

**Q1: Webhook authentication**
How to secure webhook endpoints?
- Option A: Secret token in URL (simple)
- Option B: Signature verification per-source (GitHub HMAC, etc.)
- Option C: Both options available

**Q2: Webhook source support**
Which webhook sources to support initially?
- Option A: GitHub only (most common)
- Option B: GitHub + GitLab + Bitbucket
- Option C: Generic webhook + specific handlers

### Task Chaining

**Q3: Chain scope**
Should chains work across projects or within?
- Option A: Within project only
- Option B: Cross-project allowed
- Option C: Configurable

**Q4: Chain cycles**
How to prevent infinite loops (A → B → A)?
- Option A: Detect cycles, refuse to create
- Option B: Max chain depth limit
- Option C: Allow cycles but rate limit

### Scheduling

**Q5: Scheduler reliability**
If server restarts, what happens to scheduled tasks?
- Option A: Missed triggers are lost
- Option B: Catch up on missed triggers (risky)
- Option C: Record schedule state, resume accurately

**Q6: Timezone handling**
How to handle timezones?
- Option A: Server timezone only
- Option B: Per-automation timezone
- Option C: User's timezone preference

### Auto-Start

**Q7: Auto-start safety**
If automation auto-starts tasks, what safeguards?
- Option A: Always require manual approval
- Option B: Configurable per-automation
- Option C: Rate limiting (max N auto-starts per hour)

**Q8: Auto-start vs auto-create**
Distinguish between:
- Auto-create: Task appears in inbox
- Auto-start: Task runs immediately

Should these be separate options?

### Conditions

**Q9: Condition complexity**
How sophisticated should conditions be?
- Option A: Simple key-value matches
- Option B: Logical operators (AND, OR, NOT)
- Option C: Full expression language

**Q10: Custom conditions**
Should users be able to write custom condition code?
- Option A: No, too risky
- Option B: Yes, sandboxed JavaScript
- Option C: Webhook to external service

### UI Complexity

**Q11: Visual automation builder?**
Should there be a visual flow builder (like Zapier)?
- Option A: No, form-based is sufficient
- Option B: Yes, for chains/complex flows
- Option C: Future enhancement

### Notifications

**Q12: Automation notifications?**
Should automations generate their own notifications?
- Option A: Always notify when triggered
- Option B: Configurable per-automation
- Option C: Only notify on errors

---

## Dependencies

- **All previous phases** — This is the capstone phase
- **Phase 0** — Background execution for auto-started tasks
- **Phase 1** — Task creation
- **Phase 3** — Notifications for automation events
- **Phase 4** — Approval gates for sensitive automations

---

## Future Enhancements

Beyond initial implementation:

1. **More webhook sources** — Slack, Linear, Jira, etc.
2. **Workflow templates** — Pre-built automation patterns
3. **Marketplace** — Share automations with others
4. **Analytics** — Automation performance metrics
5. **AI-suggested automations** — Claude suggests based on patterns

---

*Created: January 8, 2026*
*Status: Awaiting answers to open questions*
