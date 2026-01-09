# Task-Centric Vision: Master Plan

> **Purpose**: Transform Claude Kanban from a session-centric terminal viewer into a task-centric work management system where AI work happens in the background and users review results asynchronously.

## Core Principle

**Activity is not contingent on UI state.**

The UI taps into what's happening — it doesn't drive what's happening. Tasks run in the background, survive app restarts, and notify users when attention is needed.

## Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task granularity | Goal-level | Tasks represent meaningful work, not individual prompts |
| Session → Task mapping | Auto-create | Sessions created outside UI still become tasks |
| Results detection | Git-based | Lean on git diffs; explore work trees later |
| Approval mechanism | Hooks-first | Explore Claude Code PreToolUse hooks |
| Notification delivery | Core engine + pluggable delivery | Browser push first, extensible to Electron/other |
| Terminal role | Secondary | Task detail first, terminal on-demand |

## Phase Overview

| Phase | Name | Purpose | Status |
|-------|------|---------|--------|
| 0 | [Background Execution](./PHASE-0-BACKGROUND-EXECUTION.md) | Decouple processes from UI lifecycle | **Partial** ⚡ |
| 1 | [Task Layer](./PHASE-1-TASK-LAYER.md) | Task data model, CRUD, session linking | Planning |
| 2 | [Results & Review](./PHASE-2-RESULTS-REVIEW.md) | Capture what changed, review UI | **Partial** ⚡ |
| 3 | [Notifications](./PHASE-3-NOTIFICATIONS.md) | Core engine + browser push delivery | **Partial** ⚡ |
| 4 | [Approval Gates](./PHASE-4-APPROVAL-GATES.md) | Intercept and approve destructive actions | **Partial** ⚡ |
| 5 | [MCP Server](./PHASE-5-MCP-SERVER.md) | Expose kanban to Claude Code sessions | Planning |
| 6 | [Automation](./PHASE-6-AUTOMATION.md) | CI webhooks, task chaining, scheduling | Planning |

### Implementation Progress (January 2026)

Significant infrastructure has been built that advances multiple phases:

**Already Implemented:**
- ✅ **EventServer** — Channel-based pub/sub WebSocket (`server/event-server.ts`)
- ✅ **Session Watcher** — JSONL file watching with debouncing (`server/watchers/session-watcher.ts`)
- ✅ **Status Derivation** — working/waiting_for_approval/waiting_for_input/idle (`src/lib/session-status.ts`)
- ✅ **Pending Tool Use tracking** — For approval detection (`src/lib/types.ts`)
- ✅ **"Needs Attention" column** — Virtual column for waiting sessions
- ✅ **useEventSocket hook** — Auto-reconnect, subscription management
- ✅ **Session Isolation types** — Worktree infrastructure (`SessionIsolation` in types.ts)
- ✅ **Scope & Inbox Watchers** — Real-time file/docs updates
- ✅ **needsAttention() helper** — Status checking for approval state

**Still Needed:**
- ⏳ ProcessManager (PTY independence from WebSocket)
- ⏳ Output buffering (reconnection catch-up)
- ⏳ Browser push notifications delivery
- ⏳ Approval response UI (respond to tool approval requests)
- ⏳ Task abstraction layer
- ⏳ Results capture & diff viewer
- ⏳ MCP server
- ⏳ Automation engine

## Dependencies

```
Phase 0 (Background Execution)
    │
    ▼
Phase 1 (Task Layer)
    │
    ├──────────────────┐
    ▼                  ▼
Phase 2            Phase 3
(Results)          (Notifications)
    │                  │
    └────────┬─────────┘
             ▼
      Phase 4 (Approvals)
             │
             ▼
      Phase 5 (MCP)
             │
             ▼
      Phase 6 (Automation)
```

Phase 0 is foundational — everything else depends on background execution working.

Phases 2 and 3 can be developed in parallel after Phase 1.

## Architectural Shift

### Current Model (UI-Driven)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  WebSocket  │────▶│     PTY     │
│   (xterm)   │◀────│   Server    │◀────│   Process   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                                        │
      └────── UI closes = Process dies ────────┘
```

### Target Model (Background-First)

```
┌─────────────────────────────────────────────────────────┐
│                    Task Manager Service                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Process Pool                                     │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│  │  │ Task A  │  │ Task B  │  │ Task C  │  ...     │   │
│  │  │  (PTY)  │  │  (PTY)  │  │  (PTY)  │          │   │
│  │  └─────────┘  └─────────┘  └─────────┘          │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Output Buffer (per task)                         │   │
│  │  - Stores terminal output                         │   │
│  │  - Allows reconnection catch-up                   │   │
│  │  - Persists across restarts (optional)            │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Notification Engine                              │   │
│  │  - Detects "needs attention" state                │   │
│  │  - Queues notifications                           │   │
│  │  - Pluggable delivery (browser, electron, etc.)   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
              │                           │
              ▼                           ▼
    ┌─────────────────┐         ┌─────────────────┐
    │  Browser UI     │         │  Push Service   │
    │  (connects on   │         │  (always on)    │
    │   demand)       │         │                 │
    └─────────────────┘         └─────────────────┘
```

## Success Criteria (End State)

1. **Queue work, walk away** — Create tasks, start them running, close the app, get notified when done
2. **Review results, not process** — See what changed (diffs, commits) without watching terminal scroll
3. **Parallel execution** — Multiple tasks running simultaneously, each in isolation
4. **Interruption-friendly** — App crash, browser close, machine restart — tasks survive or resume
5. **Notification-driven** — Know when something needs you without polling/watching

## Testing Philosophy

Each phase includes a test plan. A feature is not done until:

1. Unit tests pass (where applicable)
2. Integration tests pass
3. Manual testing in browser confirms expected behavior
4. Tested via Claude using Chrome (dogfooding)

## Reference Documents

- [RESEARCH.md](./RESEARCH.md) — Original vision document with detailed feature exploration
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — Current system architecture
- [../DESIGN-PHILOSOPHY.md](../DESIGN-PHILOSOPHY.md) — UI/UX principles

---

*Created: January 8, 2026*
*Last Updated: January 9, 2026*
