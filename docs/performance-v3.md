# Performance & Stability Plan (v3)

This document synthesizes infrastructure-level optimizations (bundler, runtime) with application-level improvements (React, polling, stability) for a comprehensive performance strategy.

## Key Insight: Two Optimization Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Infrastructure (NEW in v3)                        │
│  - Bundler: Turbopack vs Webpack                            │
│  - Runtime: Bun vs Node.js                                  │
│  - Affects: Startup time, HMR speed, script execution       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Application (from v2)                             │
│  - React: Memoization, component extraction                 │
│  - Network: SWR consolidation, polling reduction            │
│  - Stability: Process locks, WebSocket reconnection         │
└─────────────────────────────────────────────────────────────┘
```

Both layers are independent—you can optimize either without affecting the other.

---

## Phase 0: Infrastructure Quick Wins (NEW)

These changes have **immediate impact** with **zero risk** to application behavior.

### 0.1 Switch to Turbopack (HIGHEST PRIORITY)

**Current State:**
```json
"dev": "next dev --webpack"
```

**Problem:** Webpack is 5-10x slower than Turbopack for:
- Initial compilation
- Hot Module Replacement (HMR)
- Incremental rebuilds

**Change:**
```json
"dev": "next dev --turbopack",
"dev:webpack": "next dev --webpack"
```

**Expected Impact:**

| Metric | Webpack | Turbopack | Improvement |
|--------|---------|-----------|-------------|
| Initial compile | ~5-8s | ~1-2s | 4-5x |
| HMR update | ~500ms | ~50ms | 10x |
| Full rebuild | ~4s | ~500ms | 8x |

**Validation:**
```bash
# Test immediately
npx next dev --turbopack
```

1. Time from command to "Ready" message
2. Edit a component, time until browser updates
3. Verify no console errors

**Fallback:** Keep `dev:webpack` for edge cases where Turbopack has issues.

**Risk:** Low. Turbopack is stable in Next.js 16. Falls back gracefully.

---

### 0.2 Use Bun Runtime (Optional)

**Current State:** Node.js with tsx for TypeScript

**Problem:** Node.js startup overhead, tsx transpilation on every run

**Change:**
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Update package.json
"ws-server": "bun run server/ws-server.ts",
"dev:all": "bun run --bun concurrently \"bun run dev\" \"bun run ws-server\""
```

**Expected Impact:**

| Metric | Node + tsx | Bun | Improvement |
|--------|------------|-----|-------------|
| ws-server start | ~800ms | ~200ms | 4x |
| Script execution | baseline | ~2x faster | 2x |

**Validation:**
```bash
# Compare startup times
time npx tsx server/ws-server.ts
time bun run server/ws-server.ts
```

**Risk:** Low. Bun is Node-compatible. Falls back to Node if issues arise.

---

### 0.3 Pre-compile WebSocket Server (Alternative to 0.2)

If not using Bun, pre-compile to avoid tsx overhead:

```bash
# One-time compile
npx tsc server/ws-server.ts --outDir server/dist --esModuleInterop --module commonjs

# Update package.json
"ws-server": "node server/dist/ws-server.js"
```

**Expected Impact:** ~500ms faster startup

**Trade-off:** Loses TypeScript hot-reload for ws-server (rarely needed)

---

## Phase 1: Network Optimization (from v2)

### 1.1 Consolidate SWR Polling

**Problem:** 3 independent polls every 5 seconds (sessions, inbox, tree)

**Solution:** Single `/api/data` endpoint returning all data

**Files:** `src/hooks/useSessions.ts`, `src/app/api/data/route.ts`

**Expected Impact:** 3x reduction in API calls

**Validation:**
1. Open Chrome DevTools Network tab
2. Wait 30 seconds idle
3. Count: Should see ~6 requests instead of ~18

---

### 1.2 Remove Plan Polling

**Problem:** Each session polls `/api/plans/` every 3 seconds

**Solution:** Plans already come via WebSocket events—remove polling entirely

**File:** `src/components/TerminalDrawer.tsx`

**Change:**
```typescript
// REMOVE this useEffect entirely (lines ~370-402)
useEffect(() => {
  const fetchPlans = async () => { ... };
  const interval = setInterval(fetchPlans, 3000);  // DELETE
  return () => clearInterval(interval);
}, [...]);

// KEEP: Initial fetch on session open
// KEEP: handlePlanEvent WebSocket callback
```

**Expected Impact:** Eliminates 3+ requests/second with open sessions

**Validation:**
1. Open a session with a plan file
2. Check Network tab—no `/api/plans/` requests after initial load
3. Create new plan file, verify it appears (WebSocket event)

---

## Phase 2: React Optimization (from v2)

### 2.1 Memoize Board Computed Values

**Problem:** `getSessionsByStatus` runs on every render

**Solution:** Move to `useMemo`

**File:** `src/components/Board.tsx`

```typescript
const sessionsByStatus = useMemo(() => {
  const result: Record<SessionStatus, Session[]> = {
    inbox: [], active: [], recent: []
  };
  sessions.forEach(s => {
    if (matchesSearch(s) && matchesFilters(s)) {
      result[s.status].push(s);
    }
  });
  return result;
}, [sessions, searchQuery, filters]);
```

**Expected Impact:** Fewer re-computations per render cycle

---

### 2.2 Extract Heavy Sub-components

**Problem:** Board.tsx has 20+ useState calls, entire tree re-renders

**Solution:** Extract and memoize:
- `StatusBar` component
- `SelectionBar` component
- Wrap `Column`, `SessionCard` in `React.memo()`

**Expected Impact:** Isolated re-renders, smoother UI

**Validation:**
1. React DevTools Profiler
2. Record while switching scopes
3. Only affected components should highlight

---

## Phase 3: Stability (from v2)

### 3.1 Process Lock File

**Problem:** Multiple server instances can start, port conflicts

**Solution:** PID-based lock file with liveness check

**File:** `server/ws-server.ts`

```typescript
const LOCK_FILE = path.join(os.homedir(), '.claude-kanban-server.lock');

async function acquireLock(): Promise<boolean> {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8'));
    try {
      process.kill(pid, 0); // Check if alive
      console.error(`Server already running (PID ${pid})`);
      return false;
    } catch {
      // Process dead, stale lock
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on('exit', () => fs.unlinkSync(LOCK_FILE));
  return true;
}
```

---

### 3.2 WebSocket Auto-Reconnection

**Problem:** Terminal shows "[Connection closed]" with no recovery

**Solution:** Exponential backoff reconnection

**File:** `src/components/Terminal.tsx`

```typescript
function reconnect(attempt = 1) {
  if (attempt > 5) {
    term.write("\r\n\x1b[31m[Failed to reconnect after 5 attempts]\x1b[0m\r\n");
    return;
  }
  term.write(`\r\n\x1b[33m[Reconnecting... attempt ${attempt}]\x1b[0m\r\n`);

  const ws = new WebSocket(wsUrl);
  ws.onopen = () => respawnTerminal(ws);
  ws.onerror = () => setTimeout(() => reconnect(attempt + 1), attempt * 1000);
}
```

---

### 3.3 Port Discovery with Health Check

**Problem:** Stale port file after crash

**Solution:** Verify WebSocket responds before using port

**File:** `src/components/TerminalDrawer.tsx`

```typescript
async function getHealthyPort(attempts = 3): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch("/api/ws-port");
    if (!res.ok) continue;

    const { port } = await res.json();
    const healthy = await testWebSocket(port);
    if (healthy) return port;

    await sleep(1000 * (i + 1)); // Backoff
  }
  return null;
}
```

---

## Phase 4: Advanced (from v2)

### 4.1 Virtual List for Sessions

**When:** Scope has 50+ sessions

**Solution:** Use `@tanstack/react-virtual` (already installed)

**File:** `src/components/Column.tsx`

**Expected Impact:** DOM stays at ~20 elements regardless of session count

---

### 4.2 Lazy Terminal Initialization

**Problem:** Each tab creates full xterm instance even when hidden

**Solution:** Only create xterm when tab becomes active

**Trade-off:** Brief flash on first tab switch

---

## Implementation Priority (Dev Mode Focus)

Given the user's priority of **hot reload and malleability**, here's the recommended order:

| Priority | Task | Effort | Impact on Dev Experience |
|----------|------|--------|--------------------------|
| **1** | 0.1 Turbopack | 5 min | **Massive** - 10x faster HMR |
| **2** | 1.2 Remove plan polling | 15 min | High - less network noise |
| **3** | 3.1 Process lock | 30 min | High - no more port conflicts |
| **4** | 3.2 WS reconnection | 45 min | High - survives server restart |
| **5** | 0.2 Bun runtime | 15 min | Medium - faster script startup |
| **6** | 2.1 Memoize Board | 30 min | Medium - smoother UI |
| **7** | 1.1 Consolidate SWR | 1 hr | Medium - cleaner network |
| **8** | 2.2 Extract components | 2 hr | Medium - better profiling |
| **9** | 4.1 Virtual list | 2 hr | Low (unless 50+ sessions) |
| **10** | 4.2 Lazy terminals | 3 hr | Low (risky) |

---

## Quick Start: Do This Now

```bash
# 1. Test Turbopack immediately (5 min)
npx next dev --turbopack

# 2. If it works, update package.json
# Change: "dev": "next dev --turbopack"

# 3. Optional: Install Bun
curl -fsSL https://bun.sh/install | bash
```

This single change (Turbopack) will give you the biggest improvement in daily dev experience.

---

## Success Criteria

### Dev Mode Targets
- **HMR latency:** < 100ms (currently ~500ms with Webpack)
- **Initial compile:** < 2s (currently ~5-8s)
- **Server restart recovery:** < 5s with auto-reconnect

### Runtime Targets (from v2)
- **Network:** < 3 requests/5 seconds idle
- **Render:** < 5 Board re-renders per user action
- **Memory:** < 200MB with 5 terminals
- **Stability:** Auto-reconnect on server restart

---

## Comparison: vibe-kanban vs claude-kanban Performance

| Aspect | vibe-kanban | claude-kanban (current) | claude-kanban (after v3) |
|--------|-------------|-------------------------|--------------------------|
| **Startup** | ~1s (pre-compiled Rust) | ~8-10s | ~2-3s |
| **HMR** | N/A (compiled) | ~500ms | ~50ms |
| **Binary size** | ~50MB | N/A | N/A |
| **node_modules** | 0 (runtime) | 1.2GB | 1.2GB |
| **Dev flexibility** | Low (compile cycle) | High | High |

**Trade-off acknowledged:** vibe-kanban is faster at runtime because it's a pre-compiled Rust binary. We trade some startup speed for dev-time flexibility (hot reload, instant iteration). With Turbopack, we close most of the gap while keeping the dev experience.

---

*Last updated: 2025-01-07*
