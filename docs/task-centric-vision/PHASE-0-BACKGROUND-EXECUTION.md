# Phase 0: Background Execution

> **Goal**: Decouple task execution from UI lifecycle. Processes run on the server, survive UI disconnection, and can be reconnected to at any time.

> **Status**: PARTIALLY IMPLEMENTED — See "What's Already Built" section

---

## What's Already Built (January 2026)

Significant infrastructure has been implemented:

### EventServer & WebSocket Infrastructure ✅
- `server/event-server.ts` — Channel-based pub/sub WebSocket server
- `src/hooks/useEventSocket.ts` — React hook with auto-reconnect
- `src/contexts/EventSocketContext.tsx` — App-wide WebSocket context
- Path-based routing: `/terminal` for PTY, `/events` for real-time events

### Session Watchers ✅
- `server/watchers/session-watcher.ts` — Watches `~/.claude/projects` for JSONL changes
- `server/watchers/scope-watcher.ts` — Watches directories for file changes
- `server/watchers/inbox-watcher.ts` — Watches Todo.md files
- Debounced, incremental parsing with event emission

### Session Status Derivation ✅
- `src/lib/session-status.ts` — Derives real-time state from JSONL:
  - `working` — Claude is actively processing
  - `waiting_for_approval` — Claude used a tool, waiting for approval
  - `waiting_for_input` — Claude finished, waiting for user input
  - `idle` — No activity for 5+ minutes
- Tracks `pendingToolUses` for approval detection
- `needsAttention()` helper function

### "Needs Attention" Column ✅
- Virtual column showing sessions awaiting approval/input
- Amber styling for attention cards
- Real-time updates via WebSocket events

---

## What Still Needs to Be Built

The remaining work is focused on **PTY process independence**:

1. **ProcessManager** — Decouple PTY lifecycle from WebSocket connections
2. **Output Buffering** — Store output for reconnection catch-up
3. **Process Registry** — Track running processes independently

---

## Problem Statement (Remaining)

While session *status* is now tracked in real-time, terminal *processes* are still coupled to UI:

1. **WebSocket owns PTY** — Closing browser tab can orphan or kill the PTY
2. **No output buffer** — Reconnecting loses terminal history
3. **No process list API** — Can't see what's running from another client

The goal: start a Claude session, close the browser, come back later, reconnect to the still-running session with full output history.

## Target Architecture

### Process Manager

A dedicated service that:
- Spawns and manages PTY processes independently of WebSocket connections
- Maintains a registry of running processes
- Buffers output for each process
- Allows multiple WebSocket clients to subscribe/unsubscribe
- Optionally persists state for server restart recovery

```typescript
// process-manager.ts (new)
interface ManagedProcess {
  id: string;                    // Unique process ID (could be task ID)
  pty: IPty;                     // The PTY instance
  status: 'running' | 'waiting' | 'exited';
  exitCode?: number;
  startedAt: Date;
  outputBuffer: RingBuffer;      // Circular buffer of recent output
  subscribers: Set<WebSocket>;   // Connected clients watching this process
  metadata: {
    taskId?: string;
    sessionId?: string;
    projectPath: string;
    command: string;
  };
}

class ProcessManager {
  private processes: Map<string, ManagedProcess>;

  // Spawn a new process (not tied to any WebSocket)
  spawn(config: SpawnConfig): string;

  // Subscribe a WebSocket to receive output from a process
  subscribe(processId: string, ws: WebSocket): void;

  // Unsubscribe without killing the process
  unsubscribe(processId: string, ws: WebSocket): void;

  // Get buffered output (for reconnection catch-up)
  getBuffer(processId: string, fromLine?: number): string[];

  // Send input to a process
  write(processId: string, data: string): void;

  // Resize terminal
  resize(processId: string, cols: number, rows: number): void;

  // Kill a process
  kill(processId: string): void;

  // List all processes
  list(): ManagedProcess[];

  // Get process by ID
  get(processId: string): ManagedProcess | undefined;
}
```

### Output Buffer

Each process maintains a ring buffer of output:

```typescript
class RingBuffer {
  private buffer: string[];
  private maxLines: number;
  private totalLines: number;  // Total lines ever written (for catch-up offset)

  constructor(maxLines: number = 10000);

  // Add output (handles line splitting)
  write(data: string): void;

  // Get lines from offset (for catch-up)
  getFrom(lineNumber: number): { lines: string[], nextLine: number };

  // Get all buffered content
  getAll(): string[];

  // Clear buffer
  clear(): void;
}
```

### WebSocket Protocol Changes

**New Messages (Client → Server):**

```typescript
// Subscribe to a process (replaces "spawn" for existing processes)
{ type: "subscribe", processId: string, fromLine?: number }

// Unsubscribe from a process (doesn't kill it)
{ type: "unsubscribe", processId: string }

// Start a new process (returns processId)
{ type: "start", taskId: string, projectPath: string, sessionId?: string, initialPrompt?: string }

// Input to process (renamed from "data" for clarity)
{ type: "input", processId: string, data: string }

// Resize (unchanged but uses processId)
{ type: "resize", processId: string, cols: number, rows: number }

// Kill process
{ type: "kill", processId: string }

// List all processes
{ type: "list" }
```

**New Messages (Server → Client):**

```typescript
// Process started
{ type: "started", processId: string, taskId: string }

// Subscribed to process (includes catch-up buffer)
{ type: "subscribed", processId: string, buffer: string[], fromLine: number }

// Process output (unchanged but includes line number for sync)
{ type: "output", processId: string, data: string, lineNumber: number }

// Process status change
{ type: "status", processId: string, status: "running" | "waiting" | "exited", exitCode?: number }

// Process list response
{ type: "processes", processes: ProcessInfo[] }
```

### REST API Additions

For non-WebSocket interactions:

```typescript
// GET /api/processes
// List all running processes
Response: { processes: ProcessInfo[] }

// POST /api/processes
// Start a new process
Body: { taskId: string, projectPath: string, sessionId?: string, initialPrompt?: string }
Response: { processId: string }

// GET /api/processes/:id
// Get process info + recent output
Response: { process: ProcessInfo, recentOutput: string[] }

// DELETE /api/processes/:id
// Kill a process
Response: { success: boolean }
```

## Implementation Plan

### Step 1: Create ProcessManager Class

**File:** `src/lib/process-manager.ts`

1. Define `ManagedProcess` interface
2. Implement `ProcessManager` class with:
   - `spawn()` — Creates PTY, stores in registry
   - `subscribe()/unsubscribe()` — Manage WebSocket subscribers
   - `write()/resize()/kill()` — Process control
   - `getBuffer()` — Output retrieval
   - `list()/get()` — Registry queries

3. Implement `RingBuffer` class for output storage

**Estimated scope:** ~300 lines

### Step 2: Create ProcessManager Singleton

**File:** `server/ws-server.ts` (modify)

1. Instantiate ProcessManager at server startup
2. Export for use by REST API routes

**Estimated scope:** ~20 lines

### Step 3: Update WebSocket Handler

**File:** `server/ws-server.ts` (modify)

1. Replace direct PTY spawning with ProcessManager calls
2. Implement new message types (subscribe, unsubscribe, start, list)
3. Handle client disconnection gracefully (unsubscribe, don't kill)
4. Add reconnection with buffer catch-up

**Estimated scope:** ~150 lines changed

### Step 4: Add REST API Routes

**File:** `src/app/api/processes/route.ts` (new)

1. GET handler — list processes
2. POST handler — start process

**File:** `src/app/api/processes/[id]/route.ts` (new)

1. GET handler — process info + output
2. DELETE handler — kill process

**Estimated scope:** ~100 lines

### Step 5: Update Terminal Component

**File:** `src/components/Terminal.tsx` (modify)

1. Change from "spawn" to "start" or "subscribe"
2. Handle "subscribed" message with buffer catch-up
3. Track line numbers for sync
4. Handle reconnection gracefully

**Estimated scope:** ~50 lines changed

### Step 6: Update TerminalDrawer

**File:** `src/components/TerminalDrawer.tsx` (modify)

1. Track processId instead of/alongside terminalId
2. Support reconnecting to existing processes
3. Show process status (running/waiting/exited)

**Estimated scope:** ~30 lines changed

## Data Persistence (Optional Enhancement)

For surviving server restarts:

```typescript
// Store process metadata to disk
interface PersistedProcess {
  id: string;
  taskId?: string;
  sessionId?: string;
  projectPath: string;
  command: string;
  startedAt: string;
  // Note: PTY itself cannot be persisted, but we can track that it existed
}

// On server start:
// 1. Load persisted process list
// 2. Mark all as "lost" (PTY died with server)
// 3. Optionally: auto-restart processes that were running
```

This is a nice-to-have for Phase 0; could be deferred.

## Test Plan

### Unit Tests

**File:** `src/lib/__tests__/process-manager.test.ts`

| Test | Description |
|------|-------------|
| `spawn creates process` | Spawn returns ID, process is in registry |
| `spawn with options` | sessionId, initialPrompt passed correctly |
| `subscribe adds client` | WebSocket added to subscribers |
| `unsubscribe removes client` | WebSocket removed, process still runs |
| `write sends to PTY` | Input forwarded to process |
| `resize changes dimensions` | PTY resized correctly |
| `kill terminates process` | Process killed, removed from registry |
| `getBuffer returns output` | Buffered output retrievable |
| `buffer respects maxLines` | Old output evicted when full |
| `getFrom returns subset` | Offset-based retrieval works |
| `multiple subscribers` | Output broadcast to all subscribers |
| `exit event emitted` | Status changes on process exit |

**File:** `src/lib/__tests__/ring-buffer.test.ts`

| Test | Description |
|------|-------------|
| `write stores lines` | Basic write/read |
| `handles line splitting` | Partial lines buffered correctly |
| `respects max size` | Eviction works |
| `getFrom with offset` | Catch-up retrieval |
| `totalLines tracks history` | Even after eviction |

### Integration Tests

**File:** `server/__tests__/ws-integration.test.ts`

| Test | Description |
|------|-------------|
| `start creates process` | WebSocket start → process exists |
| `subscribe receives output` | Subscriber gets PTY output |
| `unsubscribe keeps process` | Disconnect doesn't kill |
| `reconnect with catch-up` | New connection gets buffer |
| `multiple clients` | Two clients see same output |
| `kill from any client` | Any subscriber can kill |
| `list returns all` | List message returns registry |

### Manual Testing Checklist

**Basic Flow:**
- [ ] Open browser, start a task
- [ ] See terminal output
- [ ] Close browser tab
- [ ] Reopen browser
- [ ] Reconnect to running process
- [ ] See buffered output (catch-up)
- [ ] Continue interacting

**Multi-Client:**
- [ ] Open two browser windows
- [ ] Both subscribe to same process
- [ ] Both see output
- [ ] Type in one, see in both
- [ ] Close one, other keeps working

**Process Lifecycle:**
- [ ] Start process via UI
- [ ] Process completes naturally
- [ ] Status shows "exited"
- [ ] Can still view output buffer
- [ ] Starting new process works

**Error Cases:**
- [ ] Subscribe to non-existent process → error
- [ ] Kill already-exited process → graceful handling
- [ ] Server restart → processes lost (expected for now)

### Browser Testing (Chrome via Claude)

Claude should test the following scenarios using Chrome:

1. **Start and disconnect test:**
   - Open Claude Kanban in Chrome
   - Start a new task that will run for 30+ seconds
   - Close the browser tab
   - Wait 10 seconds
   - Reopen Claude Kanban
   - Verify process is still running
   - Verify can reconnect and see output

2. **Multi-tab test:**
   - Open Claude Kanban in two Chrome tabs
   - Start a task in Tab A
   - Open same task terminal in Tab B
   - Verify both tabs show output
   - Type in Tab A, verify Tab B sees it

3. **Completion notification test:**
   - Start a quick task
   - Wait for completion
   - Verify status updates to "exited"
   - Verify output buffer still accessible

## Migration Notes

### Backward Compatibility

The existing `terminalId` concept can map to `processId`. During migration:
1. Keep terminalId in UI state for tab management
2. Map terminalId → processId when communicating with server
3. Eventually consolidate to just processId

### Breaking Changes

- WebSocket message format changes (spawn → start, data → input)
- Client must handle new message types
- Existing terminals will disconnect on deploy (one-time)

## Open Questions

1. **Buffer size** — How much output to buffer? 10K lines? Configurable?

2. **Buffer persistence** — Write to disk for server restart recovery? Or accept loss?

3. **Process timeout** — Kill idle processes after X hours? Or keep forever until explicit kill?

4. **Resource limits** — Max concurrent processes? Memory limits?

5. **Electron IPC** — Current Electron app uses IPC not WebSocket. Need to update that path too?

## Acceptance Criteria

Phase 0 is complete when:

- [ ] Processes run independently of WebSocket connections
- [ ] Closing browser does not kill running process
- [ ] Reopening browser allows reconnection to running process
- [ ] Reconnection includes output catch-up (see what you missed)
- [ ] Multiple browser tabs can view same process
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing checklist complete
- [ ] Chrome testing via Claude confirms expected behavior

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/process-manager.ts` | New | ProcessManager class |
| `src/lib/ring-buffer.ts` | New | Output buffer class |
| `server/ws-server.ts` | Modify | Use ProcessManager, new protocol |
| `src/app/api/processes/route.ts` | New | Process list/create API |
| `src/app/api/processes/[id]/route.ts` | New | Process detail/kill API |
| `src/components/Terminal.tsx` | Modify | New protocol, reconnection |
| `src/components/TerminalDrawer.tsx` | Modify | Process status display |
| `src/lib/pty-manager.ts` | Deprecate | Replaced by ProcessManager |

---

*Created: January 8, 2026*
