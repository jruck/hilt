# Performance Implementation Checklist

Every task must be completed and validated. A task is not done until it's confirmed working in the real browser.

## Pre-Implementation: Establish Baselines

Before any changes, capture current performance metrics.

### Baseline Capture Checklist

```
[ ] Record startup time: `time npm run dev:all` (from command to "Ready")
[ ] Record HMR time: Edit Board.tsx, measure time to browser update
[ ] Record scope switch time: Click scope in breadcrumbs, time to content update
[ ] Record new session time: Click "New Session", time to terminal ready
[ ] Record Network tab: Count requests over 30 seconds idle
[ ] Screenshot React Profiler: Record scope switch, save flamegraph
[ ] Record memory: Chrome DevTools → Memory → Heap snapshot with 3 terminals open
```

**Store baselines in:** `docs/performance-baselines.md`

---

## Phase 0: Infrastructure (Highest Impact)

### Task 0.1: Switch to Turbopack

**Change:**
```json
// package.json
"dev": "next dev --turbopack",
"dev:webpack": "next dev --webpack"
```

**Validation Steps:**

```
[ ] 1. Kill any running dev servers
[ ] 2. Run: `npx next dev --turbopack`
[ ] 3. Record time from command to "Ready in Xms" message
[ ] 4. Open http://localhost:3000 - app loads without errors
[ ] 5. Edit src/components/Board.tsx - add a comment
[ ] 6. Measure time from save to browser update (should be <100ms)
[ ] 7. Navigate to different scope - no console errors
[ ] 8. Open terminal, type command - terminal works
[ ] 9. If all pass: Update package.json with new "dev" script
[ ] 10. Run `npm run dev:all` - both servers start correctly
```

**Success Criteria:**
- Initial compile: < 3 seconds (was ~8s)
- HMR update: < 100ms (was ~500ms)
- No console errors
- All features work

**Rollback:** If issues, use `npm run dev:webpack`

---

### Task 0.2: Install and Test Bun (Optional)

**Install:**
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.zshrc  # or restart terminal
```

**Validation Steps:**

```
[ ] 1. Verify install: `bun --version`
[ ] 2. Test ws-server: `time bun run server/ws-server.ts`
[ ] 3. Compare to: `time npx tsx server/ws-server.ts`
[ ] 4. Record both times
[ ] 5. Open terminal in app - verify it connects
[ ] 6. Type commands - verify they execute
[ ] 7. If faster and working: Update package.json ws-server script
```

**Success Criteria:**
- ws-server starts 2x+ faster
- Terminal functionality unchanged

---

## Phase 1: Network Optimization

### Task 1.1: Remove Plan Polling

**Problem:** TerminalDrawer polls /api/plans every 3 seconds per session

**File:** `src/components/TerminalDrawer.tsx`

**Change:** Remove the setInterval polling, keep initial fetch and WebSocket events

**Validation Steps:**

```
[ ] 1. Open Chrome DevTools → Network tab
[ ] 2. Filter by "plans"
[ ] 3. Open a session that has a plan file
[ ] 4. Wait 30 seconds
[ ] 5. BEFORE: See repeated /api/plans requests every 3s
[ ] 6. Make the code change
[ ] 7. Refresh app
[ ] 8. Open same session
[ ] 9. Wait 30 seconds
[ ] 10. AFTER: See only 1 initial /api/plans request
[ ] 11. Create new plan file manually: `echo "# Test" > ~/.claude/plans/test-plan.md`
[ ] 12. Verify plan appears in app (via WebSocket event)
[ ] 13. Delete test file
```

**Success Criteria:**
- Zero /api/plans polling requests after initial load
- New plans still appear via WebSocket

---

### Task 1.2: Consolidate SWR Polling

**Problem:** 3 separate polls: sessions, inbox, tree (each 5s)

**Solution:** Single /api/data endpoint returning all data

**Files to create/modify:**
- `src/app/api/data/route.ts` (new)
- `src/hooks/useData.ts` (new)
- `src/hooks/useSessions.ts` (modify to use useData)
- `src/hooks/useInboxItems.ts` (modify to use useData)

**Validation Steps:**

```
[ ] 1. Open Network tab, filter to localhost API calls
[ ] 2. BEFORE: Count distinct /api/sessions, /api/inbox requests over 30s
[ ] 3. Record count (expect ~18 requests)
[ ] 4. Implement /api/data endpoint
[ ] 5. Implement useData hook
[ ] 6. Update useSessions to derive from useData
[ ] 7. Update useInboxItems to derive from useData
[ ] 8. Refresh app
[ ] 9. AFTER: Count requests over 30s (expect ~6)
[ ] 10. Switch scopes - data updates correctly
[ ] 11. Drag card between columns - persists correctly
[ ] 12. Create inbox item - appears correctly
```

**Success Criteria:**
- Request count reduced by ~60%
- All functionality preserved

---

## Phase 2: React Optimization

### Task 2.1: Memoize Board Computed Values

**File:** `src/components/Board.tsx`

**Change:** Replace `getSessionsByStatus` useCallback with useMemo

**Validation Steps:**

```
[ ] 1. Add temporary logging:
     ```typescript
     console.count('Board render');
     console.count('sessionsByStatus compute');
     ```
[ ] 2. Open app, switch scopes 5 times
[ ] 3. BEFORE: Record render count vs compute count
[ ] 4. Make the useMemo change
[ ] 5. Repeat scope switches
[ ] 6. AFTER: Compute count should be lower
[ ] 7. Open React DevTools Profiler
[ ] 8. Record a scope switch
[ ] 9. Verify Board doesn't have unnecessary renders
[ ] 10. Remove console.count statements
```

**Success Criteria:**
- Fewer computations per render cycle
- Profiler shows reduced render time

---

### Task 2.2: Add React.memo to Heavy Components

**Files:**
- `src/components/Column.tsx`
- `src/components/SessionCard.tsx`
- `src/components/InboxCard.tsx`

**Change:** Wrap exports with React.memo()

**Validation Steps:**

```
[ ] 1. Open React DevTools Profiler
[ ] 2. Start recording
[ ] 3. Switch between 3 different scopes
[ ] 4. Stop recording
[ ] 5. BEFORE: Note which components re-render on scope switch
[ ] 6. Add React.memo to Column, SessionCard, InboxCard
[ ] 7. Repeat profiler recording
[ ] 8. AFTER: Unchanged cards should NOT re-render
[ ] 9. Drag a card - verify it still works
[ ] 10. Star a session - verify UI updates
```

**Success Criteria:**
- Only changed components re-render
- All interactions still work

---

## Phase 3: Stability

### Task 3.1: Add Process Lock File

**File:** `server/ws-server.ts`

**Validation Steps:**

```
[ ] 1. Start server: `npm run ws-server`
[ ] 2. Verify lock file exists: `cat ~/.claude-kanban-server.lock`
[ ] 3. Should show PID number
[ ] 4. Open new terminal, try: `npm run ws-server`
[ ] 5. Should see "Server already running (PID X)" and exit
[ ] 6. Kill original server (Ctrl+C)
[ ] 7. Verify lock file deleted: `ls ~/.claude-kanban-server.lock` (should not exist)
[ ] 8. Start server again - should work
[ ] 9. Force kill server: `kill -9 $(cat ~/.claude-kanban-server.lock)`
[ ] 10. Start server - should detect stale lock and proceed
```

**Success Criteria:**
- Can't start duplicate servers
- Stale locks are cleaned up
- Clean shutdown removes lock

---

### Task 3.2: WebSocket Auto-Reconnection

**File:** `src/components/Terminal.tsx`

**Validation Steps:**

```
[ ] 1. Start app with `npm run dev:all`
[ ] 2. Open a terminal session
[ ] 3. Type a command, verify it works
[ ] 4. Kill ONLY the ws-server: `pkill -f ws-server`
[ ] 5. Terminal should show "[Connection lost, reconnecting...]"
[ ] 6. Restart ws-server: `npm run ws-server`
[ ] 7. Terminal should auto-reconnect within 5 seconds
[ ] 8. Terminal should show "[Reconnected]" or similar
[ ] 9. Type another command - should work
[ ] 10. Repeat test 3 times for reliability
```

**Success Criteria:**
- Auto-reconnect within 5 seconds
- Terminal session recovers
- No manual refresh needed

---

### Task 3.3: Port Discovery with Health Check

**File:** `src/components/TerminalDrawer.tsx` (or new utility)

**Validation Steps:**

```
[ ] 1. Stop ws-server
[ ] 2. Manually create stale port file: `echo "9999" > ~/.claude-kanban-ws-port`
[ ] 3. Start app (Next.js only, not ws-server)
[ ] 4. Try to open a terminal
[ ] 5. BEFORE: Would hang or error immediately
[ ] 6. Implement health check
[ ] 7. Repeat steps 1-4
[ ] 8. AFTER: Should retry and show helpful error after timeout
[ ] 9. Start ws-server
[ ] 10. Terminal should connect on next attempt
```

**Success Criteria:**
- Stale port files don't cause hangs
- Clear error message shown
- Recovery when server starts

---

## Phase 4: Stress Testing

### Task 4.1: High Session Count Test

**Validation Steps:**

```
[ ] 1. Navigate to a scope with 30+ sessions
[ ] 2. Measure initial load time
[ ] 3. Scroll through Recent column
[ ] 4. Check for jank (should be smooth 60fps)
[ ] 5. Open Chrome DevTools → Performance
[ ] 6. Record while scrolling
[ ] 7. Check for long tasks (red bars)
[ ] 8. If janky: Implement virtual list (Task 4.2)
```

---

### Task 4.2: Virtual List for Sessions (If Needed)

**File:** `src/components/Column.tsx`

**Validation Steps:**

```
[ ] 1. Navigate to scope with 50+ sessions
[ ] 2. Open Elements tab in DevTools
[ ] 3. BEFORE: Count DOM nodes in column (expect 50+)
[ ] 4. Implement @tanstack/react-virtual
[ ] 5. Refresh
[ ] 6. AFTER: Count DOM nodes (should be ~15-20)
[ ] 7. Scroll - all sessions appear correctly
[ ] 8. Drag a session - still works
[ ] 9. Search - filters correctly
```

---

## Final Validation: End-to-End Performance Test

Run this complete test after all changes are implemented.

### Startup Test
```
[ ] Time `npm run dev:all` from command to "Ready"
    Target: < 3 seconds
    Actual: _______

[ ] Time from browser open to interactive board
    Target: < 2 seconds
    Actual: _______
```

### HMR Test
```
[ ] Edit Board.tsx, add comment, measure update time
    Target: < 100ms
    Actual: _______

[ ] Edit SessionCard.tsx, measure update time
    Target: < 100ms
    Actual: _______
```

### Scope Switch Test
```
[ ] Click different scope in breadcrumbs, measure content update
    Target: < 300ms
    Actual: _______

[ ] Click pinned folder, measure content update
    Target: < 300ms
    Actual: _______
```

### Terminal Test
```
[ ] Click "New Session" to terminal ready
    Target: < 1 second
    Actual: _______

[ ] Resume existing session to terminal ready
    Target: < 1 second
    Actual: _______
```

### Network Test (30 second idle)
```
[ ] Count API requests during idle
    Target: < 10 requests
    Actual: _______
```

### Memory Test
```
[ ] Heap size with 5 terminals open
    Target: < 200MB
    Actual: _______
```

### Stability Test
```
[ ] Kill ws-server, restart - terminals reconnect
    Pass: [ ] Yes [ ] No

[ ] Close laptop lid, open - app recovers
    Pass: [ ] Yes [ ] No

[ ] Rapid scope switching (10x fast clicks) - no errors
    Pass: [ ] Yes [ ] No
```

---

## Completion Checklist

```
Phase 0: Infrastructure
[ ] 0.1 Turbopack - VALIDATED
[ ] 0.2 Bun runtime - VALIDATED (or skipped)

Phase 1: Network
[ ] 1.1 Remove plan polling - VALIDATED
[ ] 1.2 Consolidate SWR - VALIDATED

Phase 2: React
[ ] 2.1 Memoize Board values - VALIDATED
[ ] 2.2 React.memo components - VALIDATED

Phase 3: Stability
[ ] 3.1 Process lock file - VALIDATED
[ ] 3.2 WebSocket reconnection - VALIDATED
[ ] 3.3 Port health check - VALIDATED

Phase 4: Stress (if needed)
[ ] 4.1 High session count test - PASSED
[ ] 4.2 Virtual list - VALIDATED (or not needed)

Final Validation
[ ] All end-to-end tests PASSED
[ ] Baselines document updated with new metrics
[ ] CHANGELOG.md updated
```

---

## How to Track Progress

Update this document as you complete each task:
- Change `[ ]` to `[x]` when validated
- Fill in actual measurements
- Note any issues encountered

Example:
```
[x] 0.1 Turbopack - VALIDATED
    - Startup: 8.2s → 1.8s (4.5x improvement)
    - HMR: 480ms → 45ms (10x improvement)
    - Issue: Had to add --turbopack flag to electron:dev too
```

---

*Created: 2025-01-07*
