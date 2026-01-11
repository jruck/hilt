# Scope Switching Performance Optimization Plan

## Executive Summary

This plan addresses the sluggish scope switching experience in Hilt. The goal is to make scope transitions feel instant and confident through both **actual performance improvements** and **perceived performance improvements** via better UX.

**Success Metrics:**
- Scope switch time: < 100ms perceived (currently ~300-500ms)
- No mixed old/new data visible during transition
- Return to recently-visited scope: < 50ms
- Visual confidence: user always knows what scope they're looking at

---

## Phase 0: Instrumentation & Baseline (Pre-work)

### 0.1 Add Performance Logging Infrastructure

Create a performance logging module that captures timing data for scope switches.

**Files to create:**
- `src/lib/perf-logger.ts` - Performance measurement utilities
- `src/lib/perf-report.ts` - Report generation for final analysis

**Metrics to capture:**
| Metric | Description |
|--------|-------------|
| `scope_switch_start` | Timestamp when user clicks to change scope |
| `scope_switch_state_update` | Time for React state + URL update |
| `sessions_api_start` | When /api/sessions fetch begins |
| `sessions_api_end` | When /api/sessions response received |
| `inbox_api_start` | When /api/inbox fetch begins |
| `inbox_api_end` | When /api/inbox response received |
| `tree_api_start` | When /api/sessions?mode=tree fetch begins |
| `tree_api_end` | When /api/sessions?mode=tree response received |
| `render_complete` | When all columns have rendered with new data |
| `scope_switch_end` | Total time from click to stable UI |

**Server-side metrics:**
| Metric | Description |
|--------|-------------|
| `sessions_parse_time` | Time to parse JSONL files |
| `sessions_filter_time` | Time to filter by scope |
| `cache_hit` | Whether server cache was used |
| `session_count` | Number of sessions returned |

### 0.2 Establish Baseline Measurements

Run 10 scope switches between different folders and record:
- Cold switch (first visit to scope)
- Warm switch (return to recently visited scope)
- Deep scope (many levels deep)
- Shallow scope (near root)
- Scope with many sessions vs few sessions

**Baseline test script location:** `scripts/perf-baseline.ts`

### 0.3 Deliverable

- [ ] Performance logging infrastructure in place
- [ ] Baseline measurements documented in `docs/SCOPE-PERF-BASELINE.md`
- [ ] Console logging enabled for development (disabled in production)

---

## Phase 1: UX Improvements (Perceived Performance)

These changes make scope switching *feel* faster without changing actual data fetch times.

### 1.1 Remove `keepPreviousData` Confusion

**Problem:** SWR's `keepPreviousData: true` shows old scope's data while new data loads. This creates cognitive dissonance where breadcrumbs say "Folder X" but cards show "Folder Y" content.

**Solution:** Track scope transition state explicitly and show coordinated loading UI.

**Files to modify:**
- `src/contexts/ScopeContext.tsx` - Add `isTransitioning` state
- `src/hooks/useSessions.ts` - Respect transition state
- `src/hooks/useTreeSessions.ts` - Respect transition state
- `src/components/Board.tsx` - Show transition overlay
- `src/components/Column.tsx` - Enhanced loading state

**Implementation:**
```typescript
// ScopeContext.tsx additions
interface ScopeContextValue {
  scopePath: string;
  setScopePath: (path: string) => void;
  isTransitioning: boolean;  // NEW
  previousScope: string | null;  // NEW - for animation direction
}
```

**Test:**
- Switch scope 5 times rapidly
- Verify no mixed old/new data visible
- Measure perceived transition time

### 1.2 Add Smooth Transition Animation

**Problem:** Abrupt content swap feels jarring.

**Solution:** 150ms coordinated fade transition when scope changes.

**Files to modify:**
- `src/app/globals.css` - Add transition keyframes
- `src/components/Board.tsx` - Apply transition classes
- `src/components/Column.tsx` - Fade out old, fade in new

**CSS additions:**
```css
.scope-transitioning {
  opacity: 0.5;
  pointer-events: none;
  transition: opacity 150ms ease-out;
}

.scope-ready {
  opacity: 1;
  transition: opacity 150ms ease-in;
}
```

**Test:**
- Visual inspection of transition smoothness
- Verify transition completes before data swap
- No content flash or layout shift

### 1.3 Immediate Skeleton on Scope Change

**Problem:** Old data visible during load creates confusion.

**Solution:** Show skeleton cards immediately when scope changes, don't wait for `isLoading` from SWR.

**Files to modify:**
- `src/components/Column.tsx` - Check both `isLoading` AND `isTransitioning`
- `src/components/Board.tsx` - Pass transition state to columns

**Test:**
- Skeletons appear within 16ms of click
- No old data visible during transition

### 1.4 Deliverable

- [ ] Transition state management implemented
- [ ] Fade animation working
- [ ] Skeleton cards show immediately on scope change
- [ ] Measure: perceived time should feel < 200ms even if actual fetch takes longer
- [ ] Update `docs/SCOPE-PERF-PHASE1.md` with measurements

---

## Phase 2: Client-Side Filtering Architecture

This is the biggest performance win - eliminate API round-trips on scope change.

### 2.1 Global Sessions Store

**Problem:** Each scope change triggers new API calls that re-parse JSONL files.

**Solution:** Fetch ALL sessions once, store in client memory, filter by scope client-side.

**Files to create:**
- `src/stores/sessions-store.ts` - Zustand store for global session data
- `src/hooks/useGlobalSessions.ts` - Hook to access store

**Files to modify:**
- `src/hooks/useSessions.ts` - Use store instead of per-scope SWR
- `src/hooks/useTreeSessions.ts` - Use store instead of per-scope SWR
- `src/app/api/sessions/route.ts` - Add "all sessions" endpoint mode

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                    Global Sessions Store                     │
│  - All sessions loaded once on app init                     │
│  - WebSocket updates mutate store directly                  │
│  - Scope filtering is pure client-side function             │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   useSessions()      useTreeSessions()      useInboxItems()
   (filtered view)    (filtered + tree)     (still per-scope)
```

**Store structure:**
```typescript
interface SessionsStore {
  // Data
  allSessions: Session[];
  lastFetched: number;
  isLoading: boolean;

  // Actions
  fetchAllSessions: () => Promise<void>;
  updateSession: (id: string, updates: Partial<Session>) => void;

  // Selectors (memoized)
  getSessionsForScope: (scope: string, mode: 'exact' | 'tree') => Session[];
  getCountsForScope: (scope: string) => SessionCounts;
}
```

**Test:**
- Initial load time (all sessions)
- Scope switch time (should be < 16ms - pure JS filtering)
- Memory usage with 500+ sessions
- WebSocket update propagation

### 2.2 Update useSessions Hook

**Changes:**
- Remove SWR fetch on scope change
- Subscribe to global store
- Filter + sort client-side
- Return same interface for backward compatibility

```typescript
export function useSessions(scopePath?: string, page = 1, pageSize = 100, showArchived = false) {
  const allSessions = useSessionsStore(state => state.allSessions);
  const isLoading = useSessionsStore(state => state.isLoading);

  // Client-side filtering - instant!
  const filteredSessions = useMemo(() => {
    if (!scopePath) return allSessions;
    return allSessions.filter(s => s.projectPath === scopePath);
  }, [allSessions, scopePath]);

  // ... rest of hook logic unchanged
}
```

### 2.3 Update useTreeSessions Hook

Same pattern as useSessions, but with prefix matching:

```typescript
const filteredSessions = useMemo(() => {
  if (!scopePath) return allSessions;
  return allSessions.filter(s => isUnderScope(s.projectPath, scopePath));
}, [allSessions, scopePath]);
```

### 2.4 Inbox Items - Keep Per-Scope (Different Pattern)

Inbox items come from Todo.md files which are scope-specific. Keep current SWR pattern but:
- Add aggressive caching in SWR
- Prefetch on hover (Phase 3)

### 2.5 Deliverable

- [ ] Global sessions store implemented
- [ ] useSessions using client-side filtering
- [ ] useTreeSessions using client-side filtering
- [ ] WebSocket events update store directly
- [ ] Measure: scope switch should be < 20ms for sessions
- [ ] Update `docs/SCOPE-PERF-PHASE2.md` with measurements

---

## Phase 3: Prefetching & Caching

### 3.1 Scope Prefetching on Hover

**Problem:** Even with client-side session filtering, inbox items still require API call.

**Solution:** Prefetch inbox data when user hovers over a scope (breadcrumb segment, subfolder, pinned folder).

**Files to modify:**
- `src/components/scope/ScopeBreadcrumbs.tsx` - Add prefetch on hover
- `src/components/scope/SubfolderDropdown.tsx` - Add prefetch on hover
- `src/components/sidebar/SortablePinnedFolderItem.tsx` - Add prefetch on hover
- `src/lib/prefetch.ts` - NEW: prefetch utilities

**Implementation:**
```typescript
// On hover over scope link
const handleMouseEnter = () => {
  // Prefetch inbox for this scope (SWR preload)
  mutate(`/api/inbox?scope=${encodeURIComponent(targetScope)}`);
};
```

**Hover delay:** 100ms (don't prefetch on quick pass-through)

### 3.2 Recent Scopes Cache

**Problem:** Returning to a recently-visited scope shouldn't need any network.

**Solution:** Keep inbox data for last 5 scopes in SWR cache with longer TTL.

**Files to modify:**
- `src/hooks/useSessions.ts` - Configure SWR deduping
- `src/lib/recent-scopes.ts` - Track scope visit order

**SWR configuration:**
```typescript
{
  dedupingInterval: 60000,  // 1 minute dedup
  revalidateOnFocus: false,  // Don't refetch on tab focus for cached scopes
}
```

### 3.3 Deliverable

- [ ] Prefetch on hover implemented for all scope selectors
- [ ] Recent scopes maintain warm cache
- [ ] Measure: return to recent scope should be < 50ms
- [ ] Update `docs/SCOPE-PERF-PHASE3.md` with measurements

---

## Phase 4: Server-Side Optimizations

### 4.1 Parallel JSONL Parsing

**Problem:** Sessions are parsed sequentially in `getSessions()`.

**Solution:** Use Promise.all for parallel file parsing.

**Files to modify:**
- `src/lib/claude-sessions.ts` - Parallelize parseSessionFile calls

**Before:**
```typescript
for (const file of jsonlFiles) {
  const metadata = await parseSessionFile(filePath, projectPath);
  if (metadata) sessions.push(metadata);
}
```

**After:**
```typescript
const parsePromises = jsonlFiles.map(file =>
  parseSessionFile(path.join(projectDir, file), projectPath)
);
const results = await Promise.all(parsePromises);
sessions.push(...results.filter(Boolean));
```

**Test:**
- Measure getSessions() time before/after
- Test with 100+ JSONL files

### 4.2 Lightweight Session Index

**Problem:** Full JSONL parse is expensive even with parallelization.

**Solution:** Maintain a lightweight index file that maps session ID → metadata.

**Files to create:**
- `src/lib/session-index.ts` - Index management

**Index structure:**
```typescript
interface SessionIndex {
  version: number;
  lastUpdated: number;
  sessions: Record<string, {
    projectPath: string;
    title: string;
    lastActivity: number;
    messageCount: number;
    // ... lightweight metadata
  }>;
}
```

**Index location:** `~/.claude/hilt-session-index.json`

**Update triggers:**
- File watcher detects JSONL changes
- Full re-index on startup if index is stale

### 4.3 Extended Cache TTL

**Problem:** 10-second cache TTL causes frequent re-parses.

**Solution:** Extend to 60 seconds, rely on WebSocket for real-time updates.

**Files to modify:**
- `src/lib/session-cache.ts` - Increase SESSION_CACHE_TTL_MS

### 4.4 Deliverable

- [ ] Parallel parsing implemented
- [ ] Session index implemented (optional - evaluate need)
- [ ] Cache TTL extended
- [ ] Measure: cold API response time
- [ ] Update `docs/SCOPE-PERF-PHASE4.md` with measurements

---

## Phase 5: Final Testing & Report

### 5.1 Comprehensive Performance Test Suite

Create automated test that:
1. Starts dev server
2. Opens Chrome DevTools MCP
3. Performs 20 scope switches (mix of patterns)
4. Captures all timing metrics
5. Generates report

**Files to create:**
- `scripts/perf-test-suite.ts` - Automated test runner
- `scripts/generate-perf-report.ts` - Report generator

### 5.2 Final Measurements

Run full test suite and document:
- Before/after comparisons for each phase
- P50, P95, P99 latencies
- Memory usage
- Network request counts

### 5.3 Performance Report

Generate `docs/SCOPE-PERF-FINAL-REPORT.md` containing:

1. **Executive Summary**
   - Overall improvement percentages
   - Key wins

2. **Methodology**
   - Test environment
   - Measurement approach
   - Sample sizes

3. **Results by Phase**
   - Phase 1: UX improvements
   - Phase 2: Client-side filtering
   - Phase 3: Prefetching
   - Phase 4: Server optimizations

4. **Detailed Metrics**
   - Tables with before/after timing
   - Charts (if applicable)

5. **UX Assessment**
   - Subjective feel comparison
   - Edge cases handled

6. **Recommendations**
   - Future optimizations
   - Monitoring approach

### 5.4 Deliverable

- [ ] Automated perf test suite
- [ ] Final report generated
- [ ] All phase documents complete
- [ ] CHANGELOG.md updated

---

## Implementation Order

```
Phase 0 (Instrumentation)     ████████░░░░░░░░░░░░  ~2 hours
Phase 1 (UX)                  ████████████░░░░░░░░  ~3 hours
Phase 2 (Client Filtering)    ████████████████░░░░  ~4 hours
Phase 3 (Prefetching)         ████████░░░░░░░░░░░░  ~2 hours
Phase 4 (Server Opts)         ████████░░░░░░░░░░░░  ~2 hours
Phase 5 (Testing & Report)    ████████████░░░░░░░░  ~3 hours
                              ─────────────────────
                              Total: ~16 hours
```

## File Change Summary

### New Files
- `src/lib/perf-logger.ts`
- `src/lib/perf-report.ts`
- `src/stores/sessions-store.ts`
- `src/hooks/useGlobalSessions.ts`
- `src/lib/prefetch.ts`
- `src/lib/session-index.ts` (optional)
- `scripts/perf-baseline.ts`
- `scripts/perf-test-suite.ts`
- `scripts/generate-perf-report.ts`
- `docs/SCOPE-PERF-BASELINE.md`
- `docs/SCOPE-PERF-PHASE1.md`
- `docs/SCOPE-PERF-PHASE2.md`
- `docs/SCOPE-PERF-PHASE3.md`
- `docs/SCOPE-PERF-PHASE4.md`
- `docs/SCOPE-PERF-FINAL-REPORT.md`

### Modified Files
- `src/contexts/ScopeContext.tsx`
- `src/hooks/useSessions.ts`
- `src/hooks/useTreeSessions.ts`
- `src/components/Board.tsx`
- `src/components/Column.tsx`
- `src/components/scope/ScopeBreadcrumbs.tsx`
- `src/components/scope/SubfolderDropdown.tsx`
- `src/components/sidebar/SortablePinnedFolderItem.tsx`
- `src/lib/claude-sessions.ts`
- `src/lib/session-cache.ts`
- `src/app/globals.css`
- `docs/CHANGELOG.md`

---

## Success Criteria

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Perceived scope switch | ~400ms | < 100ms | Animation + immediate skeleton |
| Actual data ready | ~300ms | < 50ms | Client-side filtering |
| Return to recent scope | ~300ms | < 20ms | Cache + prefetch |
| Cold API response | ~200ms | < 100ms | Parallel parse + index |
| Mixed old/new data visible | Yes | Never | Transition state management |
| Network requests per switch | 2-3 | 0-1 | Client filtering + cache |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Memory usage with all sessions | Lazy load sessions > 500, paginate in store |
| Stale data after long idle | WebSocket reconnect triggers refresh |
| Index file corruption | Automatic rebuild on parse error |
| Breaking existing functionality | Maintain same hook interfaces |

---

## Rollback Plan

Each phase is independently deployable. If issues arise:
1. Phase 1: Revert transition CSS, restore `keepPreviousData: true`
2. Phase 2: Revert to per-scope SWR fetching
3. Phase 3: Disable prefetch handlers
4. Phase 4: Revert to sequential parsing, restore 10s cache TTL
