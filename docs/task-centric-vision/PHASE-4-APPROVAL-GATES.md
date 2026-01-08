# Phase 4: Approval Gates

> **Goal**: Intercept potentially dangerous operations, pause execution, and require explicit human approval before proceeding. Track different types of approvals distinctly.

> **Status**: Planning — Questions pending

## Problem Statement

Claude can execute destructive actions:
- `git push` (including force push)
- File deletion
- External API calls
- Database operations
- Package installation

Currently, users either:
1. Watch nervously, hoping Claude doesn't break something
2. Set Claude Code to permissive mode and trust blindly
3. Use Claude Code's built-in permission system (but miss the context)

Users want:
- Review dangerous operations before they execute
- See what's about to happen (diff preview, command details)
- Approve or reject with context
- Track approval history (audit trail)

## What We Discussed

### Two Types of Approvals

User insight:
> "Another kind of approval step is like a decision step like 'hey, you need to pick a direction here'. It actually might be kind of interesting to track those different kinds of approvals and indicate them distinctly."

Types:
1. **Permission approvals** — "Can I edit this file?" "Can I run npm install?"
2. **Decision approvals** — "Which auth provider: OAuth or JWT?" "Should I refactor this?"

These have different UX needs:
- Permission: Show what will happen, approve/reject
- Decision: Show options, user picks one or provides guidance

### Hook-Based Approach

User preference:
> "Leaning towards option A... explore Claude Code PreToolUse hooks"

Claude Code has hooks that fire before tool execution. We could:
1. Register a PreToolUse hook
2. Intercept dangerous operations
3. Pause and request approval
4. Resume or cancel based on response

### Claude Already Pauses

User observation:
> "If Claude needs your approval, it's going to ask anyway and isn't it going to stop at that point?"

True — Claude Code's permission system already pauses for user input. Our job might be:
1. Detect that Claude is waiting (Phase 3 pattern matching)
2. Notify user (Phase 3)
3. Provide richer approval UI than terminal Y/n
4. Track approval history

### Conditioning via CLAUDE.md

User idea:
> "We could condition it to ask for approval when needed in our base layer CLAUDE.md file"

Could add rules like:
```markdown
## Approval Required
Always ask for explicit approval before:
- Pushing to remote repositories
- Deleting files
- Making external API calls
- Installing packages
```

This works with Claude's existing behavior rather than fighting it.

## Proposed Scope

### Approval Types

```typescript
type ApprovalType =
  | 'git_push'          // Pushing to remote
  | 'git_force'         // Force push (always require)
  | 'file_delete'       // Deleting files
  | 'file_bulk_edit'    // Editing many files at once
  | 'external_http'     // HTTP requests to external services
  | 'shell_command'     // Specific shell commands
  | 'package_install'   // npm install, etc.
  | 'database_write'    // Database modifications
  | 'decision'          // Claude asking for direction
  | 'other';            // Catch-all

interface ApprovalRequest {
  id: string;
  taskId: string;
  runId: string;

  // Type and classification
  type: ApprovalType;
  category: 'permission' | 'decision';

  // What's being requested
  title: string;
  description: string;
  details: ApprovalDetails;

  // Status
  status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'auto_approved';
  createdAt: Date;
  respondedAt?: Date;
  respondedBy?: string;       // For multi-user future
  responseNote?: string;      // User's comment

  // Timeout handling
  timeoutAt?: Date;
  timeoutAction?: 'reject' | 'approve' | 'none';
}

type ApprovalDetails =
  | GitPushDetails
  | FileDeleteDetails
  | ShellCommandDetails
  | DecisionDetails
  | GenericDetails;

interface GitPushDetails {
  type: 'git_push';
  branch: string;
  remote: string;
  commits: CommitInfo[];
  filesChanged: number;
  force: boolean;
  diffPreview?: string;
}

interface FileDeleteDetails {
  type: 'file_delete';
  files: string[];
  totalSize?: number;
}

interface ShellCommandDetails {
  type: 'shell_command';
  command: string;
  workingDirectory: string;
  riskLevel: 'low' | 'medium' | 'high';
}

interface DecisionDetails {
  type: 'decision';
  question: string;
  options?: string[];
  context?: string;
}

interface GenericDetails {
  type: 'generic';
  data: Record<string, unknown>;
}
```

### Approval Configuration

```typescript
interface ApprovalConfig {
  enabled: boolean;

  // What requires approval
  requireApproval: {
    git_push: boolean;
    git_force: boolean;         // Always true, non-configurable
    file_delete: boolean;
    file_bulk_edit: boolean;
    external_http: boolean;
    shell_commands: string[];   // Patterns like "rm -rf", "DROP TABLE"
    package_install: boolean;
  };

  // Auto-approve rules (skip approval for trusted operations)
  autoApprove: {
    branches: string[];         // e.g., ["feature/*", "fix/*"]
    files: string[];            // e.g., ["*.test.ts", "*.spec.ts"]
    commands: string[];         // e.g., ["npm test", "npm run lint"]
  };

  // Timeout behavior
  timeout: {
    enabled: boolean;
    duration: number;           // seconds
    action: 'reject' | 'approve' | 'none';
  };

  // Per-task overrides
  taskOverrides: {
    [taskId: string]: Partial<ApprovalConfig['requireApproval']>;
  };
}
```

### Detection Approaches

#### Approach A: Claude Code Hooks

If Claude Code's PreToolUse hook supports blocking:

```typescript
// .claude/hooks/approval-gate.ts
export async function preToolUse(event: ToolUseEvent): Promise<HookResult> {
  const { tool, params } = event;

  // Check if this tool use requires approval
  if (requiresApproval(tool, params)) {
    // Create approval request
    const request = await createApprovalRequest(tool, params);

    // Wait for response (blocking)
    const response = await waitForApproval(request.id);

    if (response.status === 'rejected') {
      return { action: 'block', reason: response.note };
    }
  }

  return { action: 'allow' };
}
```

**Challenge**: Does Claude Code support blocking hooks that wait for external input?

#### Approach B: Pattern Detection + Notification

If hooks can't block, use detection + notification:

1. Detect when Claude asks for permission (terminal pattern matching)
2. Parse what it's asking for
3. Create approval request
4. Notify user
5. User approves in our UI
6. We type "y" or "n" into the terminal

```typescript
// Pattern matching
const APPROVAL_PATTERNS = [
  {
    pattern: /Allow .+ to (?<action>push) to (?<branch>\S+)\?/i,
    type: 'git_push',
  },
  {
    pattern: /Delete (?<files>.+)\? \[Y\/n\]/i,
    type: 'file_delete',
  },
  // etc.
];

// When pattern matched
function onApprovalDetected(match: PatternMatch, process: ManagedProcess) {
  const request = createApprovalRequest(match);

  notificationEngine.notify({
    type: 'approval_needed',
    taskId: process.metadata.taskId,
    title: 'Approval Needed',
    body: request.title,
    actions: [
      { action: 'approve', title: 'Approve' },
      { action: 'reject', title: 'Reject' },
    ],
  });

  // When user responds
  onApprovalResponse(request.id, (response) => {
    processManager.write(process.id, response.approved ? 'y\n' : 'n\n');
  });
}
```

#### Approach C: CLAUDE.md Conditioning

Add to project's CLAUDE.md:

```markdown
## Approval Protocol

Before executing any of the following, STOP and explicitly ask for approval.
Format your request clearly with:
- What you want to do
- Why
- What will change

Requires approval:
- [ ] git push (any branch)
- [ ] Deleting files
- [ ] External API calls
- [ ] Installing packages
- [ ] Database modifications

Wait for explicit "approved" before proceeding.
```

Then detect "asking for approval" patterns and create UI for response.

### Approval UI

**Approval Request Panel**:
```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Approval Required                                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Claude wants to push to remote:                            │
│                                                              │
│  Branch: feature/oauth                                      │
│  Remote: origin                                             │
│  Commits: 3                                                  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  a1b2c3d  Add OAuth2 flow                               │ │
│  │  d4e5f6g  Add token refresh                             │ │
│  │  h8i9j0k  Add logout endpoint                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Files changed: 8 (+245, -32)                               │
│                                                              │
│  [View Diff]                                                │
│                                                              │
│  Note (optional):                                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Reject]                              [Approve & Push]      │
│                                                              │
│  ⏱️ Auto-reject in 5:00 if no response                       │
└─────────────────────────────────────────────────────────────┘
```

**Decision Request Panel**:
```
┌─────────────────────────────────────────────────────────────┐
│  🤔  Decision Needed                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Claude is asking:                                          │
│                                                              │
│  "Which authentication approach should I use?"              │
│                                                              │
│  Options:                                                   │
│  ○ OAuth2 with Google/GitHub providers                      │
│  ○ JWT with email/password                                  │
│  ○ Magic link (passwordless)                                │
│                                                              │
│  Or provide custom guidance:                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Send Response]                                            │
└─────────────────────────────────────────────────────────────┘
```

**Approval History**:
```
┌─────────────────────────────────────────────────────────────┐
│  Approval History                                            │
│                                                              │
│  ✓ Approved  git push feature/oauth      Today, 3:45pm     │
│  ✗ Rejected  delete /config/old.json     Today, 2:30pm     │
│  ✓ Approved  npm install zod             Yesterday         │
│                                                              │
│  [Export Log]                                               │
└─────────────────────────────────────────────────────────────┘
```

### Approval API

```typescript
// GET /api/approvals
// List approval requests
Query: { taskId?: string, status?: string }
Response: { approvals: ApprovalRequest[] }

// GET /api/approvals/:id
// Get approval details
Response: { approval: ApprovalRequest }

// POST /api/approvals/:id/respond
// Respond to approval request
Body: { action: 'approve' | 'reject', note?: string }
Response: { success: boolean }

// GET /api/approvals/config
// Get approval configuration
Response: { config: ApprovalConfig }

// PUT /api/approvals/config
// Update configuration
Body: ApprovalConfig
```

## Implementation Steps (Draft)

1. **Approval types & model** — `src/lib/types.ts`
2. **Approval storage** — `src/lib/approval-db.ts`
3. **Approval configuration** — `src/lib/approval-config.ts`
4. **Detection system** — Pattern matching or hooks
5. **Approval engine** — Create, track, timeout handling
6. **Integration with ProcessManager** — Intercept or detect
7. **Approval API routes** — `/api/approvals/`
8. **Approval notification integration** — Notify on request
9. **ApprovalRequest component** — Rich approval UI
10. **DecisionRequest component** — Decision-specific UI
11. **ApprovalHistory component** — Audit log
12. **Configuration UI** — Settings panel

## Test Plan (Draft)

### Unit Tests

| Test | Description |
|------|-------------|
| `pattern matches git push` | Detection works |
| `pattern matches file delete` | Detection works |
| `config determines requirement` | Rules applied |
| `auto-approve rules work` | Trusted ops skip |
| `timeout triggers action` | Timeout handling |

### Integration Tests

| Test | Description |
|------|-------------|
| `approval request created` | Detection → request |
| `notification sent` | Request → notification |
| `approval allows operation` | Approve → continue |
| `rejection stops operation` | Reject → blocked |
| `history recorded` | Audit trail saved |

### Manual Testing

- [ ] Trigger git push, see approval UI
- [ ] Approve, verify push happens
- [ ] Reject, verify push blocked
- [ ] Trigger file delete, see approval UI
- [ ] Decision prompt shows options
- [ ] Custom response sent correctly
- [ ] Timeout triggers configured action
- [ ] History shows all approvals

### Browser Testing (Claude via Chrome)

- [ ] Run task that triggers push
- [ ] Receive approval notification
- [ ] Click notification, see approval panel
- [ ] Approve from panel
- [ ] Verify operation completed
- [ ] Check history shows record

---

## Open Questions

### Detection Mechanism

**Q1: Can Claude Code hooks block execution?**
Need to verify if PreToolUse hooks can:
- Pause execution
- Wait for external input
- Resume or cancel based on response

If not, we need Approach B (detection + terminal injection).

**Q2: How reliable is pattern matching?**
If using pattern matching on terminal output:
- What patterns does Claude Code use for permissions?
- Are they consistent enough to match reliably?
- What about custom prompts Claude generates?

**Q3: Should we modify CLAUDE.md?**
Should the kanban app automatically add approval rules to project's CLAUDE.md?
- Pro: Works with Claude's natural behavior
- Con: Modifies user's project files

### Scope

**Q4: What operations need approval by default?**
Proposed defaults:
- git push: Yes
- git force: Always (non-configurable)
- file delete: Yes
- external HTTP: No (too noisy?)
- package install: Yes
- shell commands: Pattern-based

What's the right default set?

**Q5: Bulk file operations**
If Claude is editing 50 files, should that require approval?
- Option A: No, individual file edits are fine
- Option B: Yes, above threshold (e.g., >10 files)
- Option C: Configurable threshold

### Response Mechanism

**Q6: How do we send approval response?**
If Claude is waiting in terminal:
- Option A: Type "y" or "n" into terminal
- Option B: Claude Code API (if available)
- Option C: Signal via file/IPC

**Q7: Custom responses for decisions**
For decision prompts, user might want to type a custom response, not just pick an option. How to handle?
- Option A: Text input, send as-is to terminal
- Option B: Format response ("User chose: ...")
- Option C: Both — quick options + custom text

### Timeout

**Q8: Default timeout behavior?**
If user doesn't respond:
- Option A: Auto-reject (safe default)
- Option B: Auto-approve (risky but keeps flow)
- Option C: Just keep waiting (blocks indefinitely)
- Option D: Configurable per operation type

**Q9: Timeout duration?**
How long to wait?
- Option A: Short (5 minutes) — keeps things moving
- Option B: Long (1 hour) — gives user time
- Option C: Configurable
- Option D: No timeout, wait forever

### Audit

**Q10: What to log?**
For audit trail, should we capture:
- Just request + response?
- Full diff/details at time of request?
- Who approved (for multi-user future)?
- How long they took to respond?

---

## Dependencies

- **Phase 0** — Need process control (pause/resume or input injection)
- **Phase 1** — Approvals linked to tasks
- **Phase 3** — Approval notifications
- **Phase 2** — Can show diff in approval UI

---

## Research Needed

User mentioned:
> "I know that Vibe Kanban has solved for this so it'd be worth checking out their Git repo"

Before implementation, research:
1. How does Vibe Kanban handle approvals?
2. What mechanism do they use (hooks, injection, etc.)?
3. Any patterns we can borrow?

---

*Created: January 8, 2026*
*Status: Awaiting answers to open questions*
