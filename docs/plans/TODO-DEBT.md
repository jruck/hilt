# Technical Debt Tracker

This document catalogs areas of technical debt in the codebase for future cleanup and improvement. Each item includes context, location, and suggested fixes to help Claude (or developers) address these efficiently.

---

## Type Safety & Linting Suppressions

### 1. Legacy Status Migration Cast
**File:** `src/lib/db.ts:61-62`
**Issue:** Uses `as any` cast for legacy status migration.
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const status = record.status as any;
```
**Context:** Migrates old "inactive" and "done" statuses to new "recent" status with starred flag.
**Fix:** After sufficient migration time has passed (users have run the app at least once), remove this migration code entirely since all statuses will have been migrated.

### 2. Plans Watcher Type
**File:** `server/ws-server.ts:189-190`
**Issue:** Uses `any` type for chokidar watcher.
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plansWatcher: any = null;
```
**Fix:** Import and use proper `FSWatcher` type from chokidar.

### 3. React Hooks Exhaustive Dependencies
**Files:**
- `src/components/Board.tsx:143`
- `src/components/Terminal.tsx:217`
**Issue:** Dependencies intentionally excluded from useEffect.
**Context:** These are necessary for the current implementation - refs are used to avoid re-triggering effects.
**Fix:** Consider refactoring to use `useCallback` patterns or document why these exclusions are intentional via inline comments explaining the behavior.

---

## Magic Numbers & Hardcoded Values

### 4. Running Detection Threshold
**File:** `src/lib/claude-sessions.ts:15`
```typescript
const RUNNING_THRESHOLD_MS = 30_000; // 30 seconds
```
**Status:** Well-documented but consider making configurable via preferences.

### 5. Cache TTL Values
**Files:**
- `src/lib/session-cache.ts:34` - 30 second cache TTL
- `src/hooks/useDocs.ts:99,165` - 5s/30s refresh intervals
- `src/hooks/useSessions.ts:23,161` - 5s/30s refresh intervals
- `src/components/TerminalDrawer.tsx:126` - 30s port fetch interval
**Fix:** Consider centralizing these timing constants in a config file for easier tuning.

### 6. Claude Detection Delays
**File:** `src/lib/pty-manager.ts:116,136,145,161`
**Issue:** Multiple hardcoded timing values for Claude Code detection:
- 200ms initial delay
- 1500ms ready state watch delay
- 10000ms fallback timeout
**Context:** These are empirically tuned for Claude Code startup detection.
**Fix:** Document these more clearly or make them configurable for different system speeds.

---

## Console Logging (Debug/Development)

### 7. PTY Manager Logging
**File:** `src/lib/pty-manager.ts`
**Lines:** 34, 41, 95, 123, 131, 137, 145, 163, 177, 211
**Issue:** Extensive console.log statements for debugging terminal spawning.
**Fix:** Replace with proper logging system with log levels, or wrap in DEBUG flag:
```typescript
const DEBUG = process.env.DEBUG_PTY === 'true';
if (DEBUG) console.log(...);
```

### 8. WebSocket Server Logging
**File:** `server/ws-server.ts`
**Lines:** 39, 187, 193, 252, 324, 345, 359, 385, 407
**Issue:** Console.log for connection/disconnection and plan watching.
**Fix:** Same as above - use proper logging with levels.

---

## Error Handling Patterns

### 9. Silent Catch with console.error
**Pattern:** `.catch(console.error)` used in multiple places
**Files:**
- `src/components/Column.tsx:496`
- `src/components/TerminalDrawer.tsx:241, 577, 683`
- `src/components/Board.tsx:121, 142`
- `src/components/SessionCard.tsx:284`
- `src/app/api/sessions/route.ts:91, 119, 148`
**Issue:** Errors are logged but not surfaced to user or handled gracefully.
**Fix:** Consider adding toast notifications for user-facing errors, or centralized error reporting.

### 10. Empty Catch Blocks
**Files:**
- `src/lib/db.ts:25-27` - Silent catch for mtime
- `src/lib/db.ts:82-84` - Silent catch for status file read
- `src/lib/db.ts:173-175` - Silent catch for inbox file read
- `src/lib/db.ts:307-308` - Silent catch for preferences read
**Context:** These return safe defaults when files don't exist or are corrupted.
**Fix:** Add minimal logging to catch unexpected errors vs expected "file not found" scenarios.

---

## Async/Sync Inconsistency

### 11. Fake Async Functions
**File:** `src/lib/db.ts`
**Issue:** Multiple functions declared as `async` but only use synchronous operations:
- `getSessionStatus`
- `setSessionStatus`
- `getAllSessionStatuses`
- `getInboxItems`
- All preference functions
**Context:** Originally designed for potential future database migration.
**Fix:** Either convert to sync functions or document the async interface contract for future DB migration.

---

## Duplicated Logic

### 12. Bracketed Paste Mode
**File:** `src/lib/pty-manager.ts:101-110, 148-155`
**Issue:** Identical bracketed paste logic duplicated in two places.
**Fix:** Extract to helper function:
```typescript
function sendWithBracketedPaste(pty: pty.IPty, text: string, forcePaste = false) {
  const usesBracketedPaste = forcePaste || text.includes("\n") || text.length > 200;
  if (usesBracketedPaste) {
    pty.write("\x1b[200~");
    pty.write(text);
    pty.write("\x1b[201~");
  } else {
    pty.write(text);
  }
}
```

### 13. Enter Delay Calculation
**File:** `src/lib/pty-manager.ts:112, 156`
**Issue:** Same delay calculation duplicated:
```typescript
const enterDelay = Math.min(500, 100 + Math.floor(initialPrompt.length / 100) * 50);
```
**Fix:** Extract to constant or function.

---

## Potential Improvements

### 14. Session Cache Invalidation
**File:** `src/lib/session-cache.ts`
**Issue:** Cache invalidation relies on file mtime which has 1-second resolution.
**Context:** Works well in practice but could miss rapid updates.
**Fix:** Consider adding a write counter or version number alongside mtime.

### 15. File System Operations
**Files:** `src/lib/db.ts`, `src/lib/todo-md.ts`
**Issue:** All file operations are synchronous which can block the event loop.
**Fix:** For high-frequency operations, consider using async fs operations or worker threads.

### 16. Terminal ID vs Session ID Key Pattern
**File:** `src/components/Terminal.tsx`
**Documented in:** `CLAUDE.md`
**Issue:** Must use `terminalId` not `sessionId` as React key to prevent reload.
**Context:** This is intentional but non-obvious behavior.
**Fix:** Add JSDoc comment explaining this constraint at the component level.

---

## Documentation TODOs (from code comments)

### 17. Recent Scopes API
**File:** `src/lib/recent-scopes.ts:97`
```typescript
// Note: Add API endpoint for this if needed
```
**Context:** Recent scopes are managed client-side, API endpoint not yet needed.

---

## Low Priority / Nice-to-Have

### 18. CSS Variable Naming
**File:** `src/app/globals.css`
**Issue:** `--status-todo` naming reflects old "todo" terminology.
**Context:** Changed to "inbox" in UI but CSS vars kept for compatibility.
**Fix:** Rename to `--status-inbox-*` if doing larger CSS refactor.

### 19. Component File Sizes
**Files:**
- `src/components/Board.tsx` - Large component with many responsibilities
- `src/components/TerminalDrawer.tsx` - Complex state management
**Fix:** Consider splitting into smaller components with hooks for state.

---

## How to Use This Document

When addressing technical debt:

1. **Pick an item** from above based on priority or opportunity
2. **Read the full context** in the referenced file(s)
3. **Implement the fix** following the suggested approach
4. **Remove or update** the item in this document
5. **Update CHANGELOG.md** under `[Unreleased]` section

Priority guide:
- **High:** Type safety issues, error handling gaps
- **Medium:** Magic numbers, code duplication
- **Low:** Logging improvements, nice-to-have refactors
