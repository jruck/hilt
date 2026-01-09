# Ralph Wiggum Integration Plan

## Overview

Integrate Ralph Wiggum's iterative loop methodology into Hilt as a new "run method" for inbox items. Users will be guided through creating a proper PRD from their seed idea, converting it to Ralph's required format, and running the loop within a session card.

---

## Background

### What is Ralph Wiggum?

A Claude Code plugin that creates iterative feedback loops:
- Runs within a **single session** (not multiple)
- Uses a **stop hook** to intercept exit attempts and re-feed the same prompt
- Requires: **prompt**, **max-iterations**, **completion-promise**
- Claude sees its previous work in files/git on each iteration

### Current Hilt Run Methods

| Method | Icon | Behavior |
|--------|------|----------|
| Plain | Play | Direct execution |
| Refine | Brain | Wraps prompt with "think before implementing" instructions |
| Process Reference | Bookmark | Wraps prompt for knowledge base processing |

### Proposed Addition

| Method | Icon | Behavior |
|--------|------|----------|
| **Ralph Loop** | Repeat/Loop | Multi-step wizard: PRD → Config → Run Loop |

---

## Architecture Decision: Bundle vs. Reference Plugin

### Option A: Reference Installed Plugin (Recommended)

**Pros:**
- Plugin stays up-to-date with official releases
- No maintenance burden for Hilt
- Users may already have it installed
- Follows Claude Code's plugin ecosystem

**Cons:**
- Requires user to install plugin first
- Dependency on external plugin availability

**Implementation:**
1. Check if plugin is installed: `~/.claude/plugins/ralph-wiggum/` or via `claude /plugins` command
2. If not installed, prompt user with installation command:
   ```bash
   claude plugins install anthropics/ralph-wiggum
   ```
3. Generate config and use plugin's `/ralph-loop` command

### Option B: Bundle Core Ralph Logic

**Pros:**
- Self-contained, works out of the box
- Can customize behavior for Hilt

**Cons:**
- Maintenance burden (must track upstream changes)
- May diverge from official plugin
- Duplicates functionality

**Recommendation:** **Option A** - Reference the plugin. Less maintenance, better ecosystem alignment.

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  User has inbox item with seed idea                                  │
│  "Build a user authentication system with OAuth"                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Clicks Ralph (Loop) icon on InboxCard                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: Plugin Check                                                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ ⚠️ Ralph Wiggum plugin not detected                             ││
│  │                                                                  ││
│  │ Run this command to install:                                    ││
│  │ ┌──────────────────────────────────────────────────────────┐   ││
│  │ │ claude plugins install anthropics/ralph-wiggum           │   ││
│  │ └──────────────────────────────────────────────────────────┘   ││
│  │                                                                  ││
│  │ [Check Again]  [Cancel]                                         ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │ (plugin installed)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: PRD Generation (in Claude session)                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Claude helps expand seed idea into structured PRD:              ││
│  │                                                                  ││
│  │ • Clear objective                                               ││
│  │ • Success criteria (testable!)                                  ││
│  │ • Constraints and scope                                         ││
│  │ • Completion promise definition                                 ││
│  │                                                                  ││
│  │ User iterates with Claude until PRD is solid                    ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: Ralph Configuration                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Review Ralph Loop Configuration:                                ││
│  │                                                                  ││
│  │ Prompt (from PRD):                                              ││
│  │ ┌──────────────────────────────────────────────────────────┐   ││
│  │ │ [Generated prompt preview, editable]                      │   ││
│  │ └──────────────────────────────────────────────────────────┘   ││
│  │                                                                  ││
│  │ Max Iterations:  [10 ▼]                                         ││
│  │                                                                  ││
│  │ Completion Promise:                                             ││
│  │ ┌──────────────────────────────────────────────────────────┐   ││
│  │ │ RALPH_COMPLETE: All tests passing                         │   ││
│  │ └──────────────────────────────────────────────────────────┘   ││
│  │                                                                  ││
│  │ [Start Loop]  [Edit PRD]  [Cancel]                              ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: Running Loop                                                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Session Card shows:                                             ││
│  │ ┌──────────────────────────────────────────────────────────┐   ││
│  │ │ 🔄 Ralph Loop: Auth System                                │   ││
│  │ │    Iteration 3/10                                         │   ││
│  │ │    Status: Working on OAuth integration...                │   ││
│  │ │                                                            │   ││
│  │ │    [View Terminal] [Cancel Loop]                          │   ││
│  │ └──────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Plugin Detection & Installation UI

**Files to modify:**
- `src/lib/ralph.ts` (new) - Ralph plugin utilities
- `src/components/RalphSetupModal.tsx` (new) - Setup wizard modal

**API:**
```typescript
// src/lib/ralph.ts

interface RalphConfig {
  prompt: string;
  maxIterations: number;
  completionPromise: string;
}

// Check if Ralph plugin is installed
async function isRalphInstalled(): Promise<boolean> {
  // Check for plugin directory or use claude CLI
  const pluginPath = path.join(os.homedir(), '.claude/plugins/ralph-wiggum');
  return fs.existsSync(pluginPath);
}

// Generate the /ralph-loop command
function generateRalphCommand(config: RalphConfig): string {
  return `/ralph-loop "${escapePrompt(config.prompt)}" --max-iterations ${config.maxIterations} --completion-promise "${config.completionPromise}"`;
}
```

**New API Route:**
```typescript
// src/app/api/ralph/route.ts
// GET - Check plugin status
// Returns: { installed: boolean, version?: string }
```

### Phase 2: PRD Generation Flow

**Approach:** Use a special "PRD refinement" session that guides users through creating a proper PRD.

**PRD Template Prompt:**
```markdown
I have a task I want to run through Ralph Wiggum's iterative loop:

---
${seedIdea}
---

Help me create a proper PRD (Product Requirements Document) for this task. We need:

1. **Clear Objective**: What exactly should be built/achieved?
2. **Success Criteria**: Specific, testable conditions (tests must pass, linter clean, etc.)
3. **Scope Boundaries**: What's in scope, what's explicitly out of scope
4. **Completion Promise**: A specific string Claude should output ONLY when truly done

IMPORTANT: The completion promise should be something like:
- "RALPH_COMPLETE: All tests passing"
- "RALPH_DONE: Feature implemented and documented"

Ask me clarifying questions to ensure the PRD is complete and unambiguous.
When ready, output the final PRD in a structured format.
```

**Files to modify:**
- `src/components/Board.tsx` - Add `handleRalphInboxItem` handler
- `src/components/InboxCard.tsx` - Add Ralph button (Repeat icon)

### Phase 3: Configuration UI

**New Component:** `RalphConfigModal.tsx`

```typescript
interface RalphConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt: string;
  onStart: (config: RalphConfig) => void;
}

// Shows:
// - Editable prompt textarea
// - Max iterations slider (1-50, default 10)
// - Completion promise input
// - Warnings about clear success criteria
```

### Phase 4: Session Card Integration

**Session Card Enhancements:**

When a session is a Ralph loop:
1. Show loop icon and iteration count
2. Parse terminal output for iteration markers
3. Show "Cancel Loop" button (sends `/cancel-ralph`)

**Data Model Extension:**
```typescript
interface Session {
  // ... existing fields

  // Ralph-specific
  ralphLoop?: {
    active: boolean;
    currentIteration: number;
    maxIterations: number;
    completionPromise: string;
  };
}
```

**Terminal Output Parsing:**
```typescript
// Watch for Ralph iteration markers in terminal output
// Pattern: "Ralph Wiggum: Starting iteration X/Y" or similar
const RALPH_ITERATION_PATTERN = /iteration\s+(\d+)\/(\d+)/i;
```

### Phase 5: Loop Monitoring

**WebSocket Enhancement:**
Add Ralph-specific message types:

```typescript
// Server → Client
{ type: "ralph", terminalId: string, event: "iteration", current: number, max: number }
{ type: "ralph", terminalId: string, event: "complete", success: boolean }
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/lib/ralph.ts` | Ralph utilities (plugin check, command generation) |
| `src/components/RalphSetupModal.tsx` | Multi-step wizard modal |
| `src/components/RalphConfigPanel.tsx` | Configuration form component |
| `src/app/api/ralph/route.ts` | Plugin status API |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/Board.tsx` | Add `handleRalphInboxItem` handler |
| `src/components/InboxCard.tsx` | Add Ralph button (Repeat/RefreshCw icon) |
| `src/components/SessionCard.tsx` | Show Ralph loop status when active |
| `src/components/Terminal.tsx` | Parse Ralph iteration markers |
| `src/lib/types.ts` | Add `RalphConfig` and session extension types |
| `server/ws-server.ts` | Add Ralph event parsing |

---

## UI/UX Details

### Icon Choice

Use `RefreshCw` or `Repeat` from Lucide for the Ralph button - suggests iteration/looping.

### Color Scheme

Ralph sessions could use a distinct accent color (amber/orange?) to distinguish from regular sessions.

### Warnings & Guardrails

1. **Before starting loop:**
   - "Ralph loops can run for extended periods. Ensure your success criteria are testable."
   - "Max iterations is a safety limit. Set it higher than expected iterations."

2. **During loop:**
   - Show cost estimate if possible (API tokens used)
   - Prominent "Cancel" button

---

## Alternative Approaches Considered

### A. Fully Integrated (Rejected)

Bundle Ralph's stop hook and loop logic directly into Hilt's terminal management.

**Why rejected:** Too coupled, maintenance burden, diverges from plugin ecosystem.

### B. Simple Command Injection (Minimal)

Just inject the `/ralph-loop` command without any UI guidance.

**Why rejected:** Poor UX, users need help creating good PRDs.

### C. External PRD Editor (Rejected)

Create PRD in separate markdown editor before sending to Ralph.

**Why rejected:** Misses the opportunity to use Claude for PRD refinement.

---

## Open Questions

1. **PRD Storage:** Should generated PRDs be saved as plan files (`.claude/plans/`)?
   - Pro: Persists for future reference
   - Con: Clutters plan namespace

2. **Iteration Tracking:** How reliable is parsing terminal output for iteration count?
   - May need to coordinate with plugin for structured output

3. **Multi-project Loops:** Should Ralph loops respect the current scope, or always run in a specific project?
   - Probably respect current scope (where inbox item lives)

4. **Cancel Behavior:** What happens to partial work when loop is cancelled?
   - Files remain as-is (git shows state)
   - Session can be resumed manually

---

## Success Metrics

1. Users can start a Ralph loop from inbox item in < 2 minutes
2. PRD generation helps users define clear success criteria
3. Loop progress is visible without opening terminal
4. Cancel works reliably mid-loop

---

## Timeline Estimate

| Phase | Effort |
|-------|--------|
| Phase 1: Plugin detection | Small |
| Phase 2: PRD flow | Medium |
| Phase 3: Config UI | Small |
| Phase 4: Session card | Medium |
| Phase 5: Monitoring | Medium |

---

*Created: 2025-01-09*
