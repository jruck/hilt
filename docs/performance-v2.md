# Performance & Stability Plan (v2)

This document outlines the comprehensive performance and stability audit of Hilt, identifying issues and providing an implementation plan with iterative validation.

## Architecture Overview

### Web App vs Electron Intersection

| Component | Web App Mode | Electron Mode |
|-----------|--------------|---------------|
| **Next.js Server** | External process via `npm run dev` | Internal: dev uses external, prod embeds standalone |
| **Terminal Transport** | WebSocket via `ws-server.ts` on port 3001 | IPC via Electron main process |
| **PTY Manager** | Runs in `ws-server.ts` process | Runs in Electron main process |
| **Port Discovery** | Reads `~/.hilt-ws-port` file | N/A (uses IPC) |
| **Session Data** | API routes fetch from filesystem | Same API routes (localhost) |

**Key Insight**: In web mode, we run TWO servers (Next.js on 3000, WebSocket on 3001). In Electron mode, we run ONE Next.js server and use IPC for terminals.

### Server Startup Flow

```
npm run dev:all
├── Next.js dev server (port 3000)
└── WebSocket server (port 3001)
    ├── Writes port to ~/.hilt-ws-port
    ├── Creates PTY processes for terminals
    └── Watches ~/.claude/plans for plan files
```

---

## Performance Issues Identified

### 1. Board.tsx - Heavy Component (HIGH PRIORITY)

**Problem**: The main Board component has 20+ useState calls and triggers frequent re-renders.

**Evidence**:
- Every state change re-renders the entire component tree
- `getSessionsByStatus` filters sessions on every render
- Temp session matching logic runs on every `sessions` array change
- Many inline function handlers aren't memoized

**Specific Issues**:
```typescript
// Line 353-404: getSessionsByStatus runs on every render
const getSessionsByStatus = useCallback(
  (status: SessionStatus) => {
    let realSessions = sessions.filter((s) => s.status === status);
    // ... filtering logic
  },
  [sessions, openSessions, searchQuery, matchesSearch, filters]
);

// Line 278-341: Temp session matching effect
useEffect(() => {
  // Complex matching logic runs whenever sessions change
}, [sessions, openSessions]);
```

**Impact**: UI feels sluggish when switching scopes or during session updates.

---

### 2. SWR Polling & Network Requests (HIGH PRIORITY)

**Problem**: Multiple independent polling intervals causing excessive network requests.

**Evidence**:
- `useSessions`: 5s polling (visible), 30s (hidden)
- `useInboxItems`: 5s polling (visible), 30s (hidden)
- `useTreeSessions`: 5s polling (visible), 30s (hidden)
- `revalidateOnFocus: true` causes immediate re-fetch on window focus

**Impact**: 3 API calls every 5 seconds in board view, 6+ in tree view.

---

### 3. TerminalDrawer Plan Polling (MEDIUM PRIORITY)

**Problem**: Each open session polls for plan files every 3 seconds.

**Evidence** (TerminalDrawer.tsx:370-402):
```typescript
useEffect(() => {
  const fetchPlans = async () => {
    for (const slug of slugs) {
      const res = await fetch(`/api/plans/${encodeURIComponent(slug)}`);
      // ...
    }
  };
  fetchPlans();
  const interval = setInterval(fetchPlans, 3000);
  return () => clearInterval(interval);
}, [activeSession?.slug, activeSession?.slugs]);
```

**Impact**: With 3 open sessions, that's 9+ API calls every 3 seconds.

---

### 4. Server-Side Session Parsing (MEDIUM PRIORITY)

**Problem**: `/api/sessions` can be slow with many JSONL files.

**Evidence** (claude-sessions.ts):
- `getSessions()` parses every JSONL file on cache miss
- `getRunningSessionIds()` stats every JSONL file on every request
- `getPlannedSlugs()` reads directory contents (30s cache helps)

**Current Caching**:
- Sessions: 10s cache in `session-cache.ts`
- Planned slugs: 30s cache

**Impact**: First load after cache expiry can be slow (200-500ms with many sessions).

---

### 5. Terminal Component Overhead (MEDIUM PRIORITY)

**Problem**: Each terminal instance adds overhead even when hidden.

**Evidence** (Terminal.tsx):
- ResizeObserver on every terminal instance
- Multiple useRef updates per render for callback stability
- WebSocket connection maintained even for hidden terminals

**Impact**: Memory and CPU usage scales with open terminal count.

---

### 6. Port/Server Startup Instability (HIGH PRIORITY)

**Problem**: Multiple server copies, stale port files, race conditions.

**Evidence**:
- Port file can become stale if server crashes without cleanup
- No process locking mechanism
- WebSocket reconnection not robust (just shows error message)

**Symptoms**:
- "Port 3000 already in use" errors
- Terminal shows "WebSocket connection error"
- Multiple `node` processes consuming resources

---

## Stability Issues Identified

### 1. Server Process Management

**Problems**:
- No PID file to track running servers
- `SIGINT` cleanup can be missed if process crashes
- No health check mechanism

### 2. WebSocket Reconnection

**Problems** (Terminal.tsx):
- On WebSocket close, just shows "[Connection closed]"
- No automatic reconnection attempt
- No indication to user how to recover

### 3. Port Discovery Race

**Problems**:
- Client fetches `/api/ws-port` which reads file
- If server restarts, port file may be stale briefly
- No retry mechanism with exponential backoff

---

## Implementation Plan

### Phase 1: Quick Wins (Reduce Render Frequency)

#### 1.1 Consolidate SWR Polling

**Goal**: Reduce from 3 independent polls to 1 coordinated poll.

**Files**: `src/hooks/useSessions.ts`

**Changes**:
- Create single `/api/data` endpoint that returns sessions + inbox + tree
- Single SWR hook with 5s polling
- Remove individual hooks

**Validation**:
1. Open Chrome DevTools Network tab
2. Navigate to app, wait 30 seconds
3. Count API requests (should be ~6 instead of ~18)

#### 1.2 Reduce Plan Polling

**Goal**: Replace polling with WebSocket events (already implemented for real-time).

**Files**: `src/components/TerminalDrawer.tsx`

**Changes**:
- Remove the 3-second plan polling interval
- Rely on `handlePlanEvent` callback from Terminal component
- Fetch plans only on session open, not continuously

**Validation**:
1. Open Network tab
2. Open a session with a plan
3. Verify no `/api/plans/` requests after initial load
4. Create new plan file, verify it appears (WebSocket event)

---

### Phase 2: Component Optimization

#### 2.1 Memoize Board Computed Values

**Goal**: Prevent unnecessary re-computation on every render.

**Files**: `src/components/Board.tsx`

**Changes**:
```typescript
// Move filtering into useMemo
const sessionsByStatus = useMemo(() => {
  const result: Record<SessionStatus, Session[]> = {
    inbox: [], active: [], recent: []
  };
  // ... filtering logic
  return result;
}, [sessions, openSessions, searchQuery, filters]);
```

**Validation**:
1. Add `console.count('Board render')` temporarily
2. Click around, change scope
3. Count should not increase excessively

#### 2.2 Extract Heavy Sub-components

**Goal**: Isolate re-renders to specific areas.

**Files**: `src/components/Board.tsx`

**Changes**:
- Extract `StatusBar` component (memoized)
- Extract `SelectionBar` component (memoized)
- Use `React.memo()` on Column, SessionCard

**Validation**:
1. Open React DevTools Profiler
2. Record while switching scopes
3. Verify only affected components re-render

---

### Phase 3: Server Stability

#### 3.1 Add Process Lock File

**Goal**: Prevent multiple server instances.

**Files**: `server/ws-server.ts`, `package.json`

**Changes**:
```typescript
const LOCK_FILE = path.join(os.homedir(), '.hilt-server.lock');

async function acquireLock(): Promise<boolean> {
  try {
    // Check if lock exists and process is alive
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8'));
      if (isProcessRunning(pid)) {
        console.error(`Server already running (PID ${pid})`);
        return false;
      }
    }
    // Write our PID
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch (e) {
    return false;
  }
}
```

**Validation**:
1. Start server with `npm run ws-server`
2. Try starting another in new terminal
3. Should see "Server already running" error

#### 3.2 WebSocket Reconnection

**Goal**: Auto-reconnect when WebSocket drops.

**Files**: `src/components/Terminal.tsx`

**Changes**:
```typescript
// Add reconnection logic
ws.onclose = () => {
  term.write("\r\n\x1b[33m[Connection lost, reconnecting...]\x1b[0m\r\n");
  setTimeout(() => reconnect(), 1000);
};

function reconnect(attempt = 1) {
  if (attempt > 5) {
    term.write("\r\n\x1b[31m[Failed to reconnect]\x1b[0m\r\n");
    return;
  }
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => { /* re-spawn terminal */ };
  ws.onerror = () => setTimeout(() => reconnect(attempt + 1), attempt * 1000);
}
```

**Validation**:
1. Open terminal in browser
2. Kill WebSocket server (`pkill -f ws-server`)
3. Restart server
4. Terminal should auto-reconnect

#### 3.3 Port Discovery with Retry

**Goal**: Handle stale port files gracefully.

**Files**: `src/components/TerminalDrawer.tsx`

**Changes**:
```typescript
async function fetchPortWithRetry(attempts = 3): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch("/api/ws-port");
    if (res.ok) {
      const { port } = await res.json();
      // Verify port is actually responding
      try {
        const ws = new WebSocket(`ws://localhost:${port}`);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
          setTimeout(reject, 1000);
        });
        ws.close();
        return port;
      } catch {
        // Port stale, wait and retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  return null;
}
```

**Validation**:
1. Stop WebSocket server
2. Delete port file manually
3. Start server
4. App should connect after brief delay

---

### Phase 4: Advanced Optimizations

#### 4.1 Virtual List for Sessions

**Goal**: Only render visible session cards.

**Files**: `src/components/Column.tsx`

**Changes**:
- Use `@tanstack/react-virtual` (already a dependency)
- Virtualize session list when > 20 items

**Validation**:
1. Load a scope with 50+ sessions
2. Scroll through list
3. DOM should have ~20 elements, not 50+

#### 4.2 Lazy Terminal Initialization

**Goal**: Don't create xterm instance until visible.

**Files**: `src/components/Terminal.tsx`

**Changes**:
- Only create XTerm instance when `isActive && isDrawerOpen`
- Store terminal output in buffer before render
- Replay buffer on first show

**Validation**:
1. Open 5 sessions (tabs)
2. Check memory usage in Chrome DevTools
3. Should be lower than current (only 1 xterm active)

---

## Validation Checklist

Before each phase, establish baseline metrics:

### Baseline Metrics to Capture

```
[ ] Time to initial paint (Lighthouse)
[ ] Time to interactive (Lighthouse)
[ ] Network requests per minute (DevTools)
[ ] Memory usage with 5 open sessions (DevTools)
[ ] CPU usage during idle (Activity Monitor)
[ ] CPU usage during scope switch (Activity Monitor)
```

### Manual Testing Scenarios

```
[ ] App startup time (from `npm run dev:all` to usable)
[ ] Scope switch latency (click to content update)
[ ] Open terminal latency (click to cursor blink)
[ ] Search responsiveness (keystroke to filtered results)
[ ] Drag-and-drop smoothness (60fps check)
[ ] Multiple tab switching (no flicker)
```

### Stability Testing

```
[ ] Kill server, restart - terminals reconnect
[ ] Close laptop, open - app recovers
[ ] Open app in two browser tabs - no conflicts
[ ] Rapid scope switching - no state corruption
[ ] Kill terminal process - proper cleanup
```

---

## Implementation Order

| Priority | Task | Estimated Impact | Risk |
|----------|------|------------------|------|
| 1 | 3.1 Process Lock File | High (stability) | Low |
| 2 | 1.2 Reduce Plan Polling | Medium (network) | Low |
| 3 | 3.2 WebSocket Reconnection | High (UX) | Medium |
| 4 | 2.1 Memoize Board Values | Medium (render) | Low |
| 5 | 1.1 Consolidate SWR Polling | High (network) | Medium |
| 6 | 3.3 Port Discovery Retry | Medium (stability) | Low |
| 7 | 2.2 Extract Sub-components | Medium (render) | Medium |
| 8 | 4.1 Virtual List | High (large data) | Medium |
| 9 | 4.2 Lazy Terminal Init | Medium (memory) | High |

---

## Success Criteria

After completing all phases:

- **Network**: < 3 requests/5 seconds in idle state
- **Render**: < 5 Board re-renders per user action
- **Startup**: < 3 seconds to interactive
- **Memory**: < 200MB with 5 open terminals
- **Stability**: 0 crashes over 8-hour session
- **Recovery**: Auto-reconnect within 5 seconds of server restart

---

## Notes

- All changes should be tested in BOTH web app and Electron modes
- Electron mode doesn't need WebSocket fixes (uses IPC)
- Keep the existing session caching - it works well
- Don't break the terminal ID stability (prevents terminal remounting)
