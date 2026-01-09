# Phase 2: Results & Review

> **Goal**: Capture what Claude changed during a task run and present it for human review. Shift from "watch the terminal scroll" to "see the outcomes and approve."

> **Status**: PARTIALLY IMPLEMENTED — See "What's Already Built" section

---

## What's Already Built (January 2026)

Foundation for git-based results tracking exists:

### Session Isolation Types ✅
```typescript
// src/lib/types.ts
interface SessionIsolation {
  enabled: true;
  workspacePath: string;      // ~/.claude-kanban/workspaces/<id>/workspace
  sourcePath: string;         // Original project path
  branchName: string;         // claude-kanban/<session-id-short>
  baseBranch: string;         // Branch we forked from (usually main)
  baseCommit: string;         // Commit SHA we forked from ← KEY FOR DIFFING
  createdAt: string;
}
```

This provides the git baseline infrastructure needed for results detection:
- `baseCommit` — The SHA to diff against
- `baseBranch` — The branch we started from
- `branchName` — The work branch

### Last Activity Tracking ✅
- `DerivedSessionState.lastActivityTime` — Unix timestamp of last JSONL entry
- `DerivedSessionState.lastMessage` — Most recent message text
- Real-time updates via session watcher

### What's Still Needed
- **Results Capture** — Actually compute git diff on session completion
- **Results Storage** — Store captured results per run
- **Diff Viewer UI** — Display changes in readable format
- **Review Actions** — Approve, reject, request changes
- **Results API** — Endpoints for fetching results

---

## Problem Statement

Currently, understanding what Claude did requires:
1. Watching terminal output in real-time, or
2. Scrolling through terminal history, or
3. Manually running `git diff` or `git log`

This is tedious and error-prone. Users want to:
- See a summary of changes at a glance
- Review diffs in a readable format
- Approve or reject changes
- Request modifications

## What We Discussed

### Results Detection via Git

User preference:
> "I do generally think I should be using git more and more automatically... by using git more regularly we could lean on the git diff"

This suggests:
- Track git state before task run starts (HEAD commit)
- After run completes, diff against that baseline
- Captures all file changes, committed or not

### Work Tree Exploration

User raised the idea of work trees per task:
> "Maybe every task should be a work tree automatically"

But also concerns:
> "A lot of the things I'm doing in different work trees would then need to spin up their own copy of the local host servers"
> "What happens if you need to split a work tree?"

Decision: Don't force work trees, but use git diffing within current branch. Work trees could be a future enhancement.

### Review Workflow

From the proposed UI in RESEARCH.md:
- Results panel shows files changed, commits created
- User can "View Full Diff", "Approve Commit", "Request Changes"
- Review state is explicit: task sits in "review" status until approved

## Proposed Scope

### Results Data Model

```typescript
interface TaskRun {
  id: string;                    // Run ID (could be sessionId)
  taskId: string;
  sessionId: string;             // Link to Claude session

  // Timing
  startedAt: Date;
  completedAt?: Date;
  duration?: number;             // milliseconds

  // Git baseline
  baseline: {
    commit: string;              // HEAD when run started
    branch: string;
    dirty: boolean;              // Were there uncommitted changes?
  };

  // Results (captured on completion)
  results?: TaskResults;

  // Status
  status: 'running' | 'completed' | 'failed' | 'reviewed';
  exitCode?: number;
}

interface TaskResults {
  // Git changes
  git: {
    commits: CommitInfo[];       // Commits created during run
    uncommittedChanges: boolean; // Are there staged/unstaged changes?
    filesChanged: FileChange[];  // All file changes (committed + uncommitted)
    diffStats: {
      additions: number;
      deletions: number;
      filesChanged: number;
    };
  };

  // Artifacts (non-git outputs)
  artifacts?: Artifact[];

  // Summary (could be AI-generated)
  summary?: string;

  // Errors/warnings captured
  errors?: string[];
  warnings?: string[];
}

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  timestamp: Date;
  filesChanged: number;
}

interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  // For renamed files
  oldPath?: string;
}

interface Artifact {
  type: 'file' | 'url' | 'note';
  name: string;
  path?: string;
  url?: string;
  content?: string;
}
```

### Results Capture Flow

```
Task Run Starts
      │
      ▼
┌─────────────────────────────┐
│ Capture baseline:           │
│ • Current HEAD commit       │
│ • Current branch            │
│ • Dirty state (git status)  │
└─────────────────────────────┘
      │
      ▼
   [Claude works...]
      │
      ▼
Task Run Completes (or fails)
      │
      ▼
┌─────────────────────────────┐
│ Capture results:            │
│ • git log from baseline     │
│ • git diff from baseline    │
│ • Parse file changes        │
│ • Calculate stats           │
│ • Detect artifacts          │
└─────────────────────────────┘
      │
      ▼
Store results in task run
      │
      ▼
Update task status → 'review'
```

### Results API

```typescript
// GET /api/tasks/:taskId/runs
// List all runs for a task
Response: { runs: TaskRun[] }

// GET /api/tasks/:taskId/runs/:runId
// Get run details including results
Response: { run: TaskRun }

// GET /api/tasks/:taskId/runs/:runId/diff
// Get full diff for a run
Query: { file?: string }  // Optional: specific file
Response: { diff: string, parsed: ParsedDiff[] }

// POST /api/tasks/:taskId/runs/:runId/review
// Mark run as reviewed
Body: { action: 'approve' | 'reject', notes?: string }

// POST /api/tasks/:taskId/runs/:runId/rerun
// Start a new run with optional modifications
Body: { additionalContext?: string }
```

### Git Integration Utilities

```typescript
// src/lib/git-utils.ts

interface GitUtils {
  // Get current state
  getCurrentHead(projectPath: string): Promise<string>;
  getCurrentBranch(projectPath: string): Promise<string>;
  isDirty(projectPath: string): Promise<boolean>;

  // Diff operations
  diffFromCommit(projectPath: string, baseCommit: string): Promise<DiffResult>;
  getCommitsSince(projectPath: string, baseCommit: string): Promise<CommitInfo[]>;

  // File-level operations
  getFileChanges(projectPath: string, baseCommit: string): Promise<FileChange[]>;
  getFileDiff(projectPath: string, baseCommit: string, filePath: string): Promise<string>;

  // Stats
  getDiffStats(projectPath: string, baseCommit: string): Promise<DiffStats>;
}
```

### Review UI Components

**ResultsSummary** — Shows at-a-glance what changed:
```
┌─────────────────────────────────────────────────┐
│  Run #2 completed 5 minutes ago                 │
│                                                 │
│  📊 +142 -38 across 5 files                     │
│  📝 2 commits                                   │
│                                                 │
│  Files:                                         │
│  + src/auth/oauth.ts (new)                      │
│  ~ src/auth/session.ts (+45, -12)               │
│  ~ src/config/auth.ts (+8, -2)                  │
│  ~ package.json (+3, -0)                        │
│  ~ package-lock.json (+86, -24)                 │
│                                                 │
│  [View Diff]  [Approve]  [Request Changes]      │
└─────────────────────────────────────────────────┘
```

**DiffViewer** — Full diff display:
- Syntax highlighted
- Side-by-side or unified view
- File tree navigation
- Expand/collapse hunks

**CommitList** — Shows commits created:
```
┌─────────────────────────────────────────────────┐
│  Commits (2)                                    │
│                                                 │
│  a1b2c3d  Add OAuth2 authentication flow        │
│           Jan 8, 3:45pm                         │
│                                                 │
│  d4e5f6g  Add refresh token support             │
│           Jan 8, 3:52pm                         │
└─────────────────────────────────────────────────┘
```

**ReviewActions** — Approval workflow:
- "Approve" — Mark as reviewed, move task to done
- "Request Changes" — Add notes, optionally re-run
- "Revert" — Undo changes (git reset)
- "Re-run" — Start fresh run with additional context

## Implementation Steps (Draft)

1. **Git utilities** — `src/lib/git-utils.ts`
2. **TaskRun data model** — Extend types
3. **Baseline capture** — Hook into run start (Phase 0 integration)
4. **Results capture** — Hook into run completion
5. **Results API routes** — `/api/tasks/:id/runs/`
6. **ResultsSummary component** — Compact results view
7. **DiffViewer component** — Full diff display
8. **ReviewActions component** — Approve/reject UI
9. **Integration with TaskDetail** — Wire it all together

## Test Plan (Draft)

### Unit Tests

| Test | Description |
|------|-------------|
| `getCurrentHead returns commit` | Git HEAD retrieval |
| `diffFromCommit shows changes` | Diff calculation |
| `getCommitsSince lists commits` | Commit enumeration |
| `handles dirty state` | Uncommitted changes tracked |
| `handles no changes` | Empty diff case |
| `handles deleted files` | Deletion detection |
| `handles renamed files` | Rename detection |

### Integration Tests

| Test | Description |
|------|-------------|
| `baseline captured on run start` | Run stores baseline |
| `results captured on completion` | Run stores results |
| `API returns results` | Endpoints work |
| `diff API returns correct content` | File diffs accurate |

### Manual Testing

- [ ] Start task, make changes, complete
- [ ] Results summary shows correct stats
- [ ] File list matches actual changes
- [ ] Diff viewer shows correct content
- [ ] Approve action moves task to done
- [ ] Request changes keeps task in review
- [ ] Re-run starts new run

### Browser Testing (Claude via Chrome)

- [ ] Full cycle: run → review → approve
- [ ] Verify diff viewer renders correctly
- [ ] Verify commit list accurate
- [ ] Test with various change types (add, modify, delete, rename)

---

## Open Questions

### Results Detection

**Q1: What triggers results capture?**
- Option A: Process exit (exitCode received)
- Option B: Explicit "complete" action from user
- Option C: Both — auto-capture on exit, user can trigger re-capture

**Q2: Uncommitted changes handling**
If Claude makes changes but doesn't commit, how do we capture them?
- Option A: Diff working tree against baseline (includes uncommitted)
- Option B: Only track commits (uncommitted changes shown as warning)
- Option C: Auto-commit on completion (controversial)

**Q3: Baseline for dirty repos**
If repo has uncommitted changes when task starts:
- Option A: Warn user, capture baseline anyway
- Option B: Stash changes before run, restore after
- Option C: Include pre-existing changes in diff (inaccurate but simple)

### Diff Display

**Q4: Diff viewer implementation**
- Option A: Build custom with syntax highlighting (monaco-editor, prism)
- Option B: Use existing library (react-diff-viewer, etc.)
- Option C: Simple pre-formatted text (minimal, fast)

**Q5: Large diffs**
If run produces thousands of lines of changes:
- Option A: Paginate/virtualize
- Option B: Collapse by default, expand on demand
- Option C: Summary only, link to external diff tool

### Artifacts

**Q6: Non-git artifacts**
Should we track outputs beyond git changes?
- Files created outside repo
- URLs generated (deployed previews, etc.)
- Log files, screenshots, etc.

If yes, how does Claude report these?
- Option A: Parse terminal output for patterns
- Option B: Claude reports via MCP (Phase 5)
- Option C: User manually adds artifacts

### Review Workflow

**Q7: What does "Approve" mean?**
- Option A: Just marks task done (informational)
- Option B: Triggers git push (if not already pushed)
- Option C: Creates PR (if on feature branch)

**Q8: What does "Request Changes" do?**
- Option A: Just adds notes for next run
- Option B: Auto-starts new run with notes as context
- Option C: Opens terminal for interactive follow-up

**Q9: Revert capability**
Should we offer "undo" for approved changes?
- Option A: Yes, git reset to baseline
- Option B: No, too dangerous, user can revert manually
- Option C: Soft revert — create revert commit

### AI Summary

**Q10: Auto-generate summary?**
Should we use AI to summarize what changed?
- Option A: Yes, send diff to Claude for summary
- Option B: No, just show raw data
- Option C: Optional — user can request summary

---

## Dependencies

- **Phase 0** — Need run lifecycle events (start, complete)
- **Phase 1** — Results attach to task runs
- Enables **Phase 4** — Approval gates can show results before approving

---

*Created: January 8, 2026*
*Status: Awaiting answers to open questions*
