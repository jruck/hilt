# Startup Loading Screen

## Overview

A technical loading screen that shows the actual activities happening during app initialization, with a progress bar. Works in both web and Electron contexts.

## Startup Activities (in order)

### Phase 1: Server (Electron-only)
| Activity | Description | Timing |
|----------|-------------|--------|
| `Checking for dev server` | Probing ports 3000-3004 | ~2s max |
| `Starting dev server on port {port}` | Spawning npm run dev | Variable |
| `Waiting for server ready` | HTTP polling until 200 | Up to 60s |

### Phase 2: App Bootstrap (both Web & Electron)
| Activity | Description | Timing |
|----------|-------------|--------|
| `Loading preferences` | Theme, viewMode, pinnedFolders, inboxPath | ~50ms |
| `Resolving home directory` | GET /api/folders | ~20ms |
| `Validating scope` | Checking if current path exists | ~20ms |

### Phase 3: Data Loading (both Web & Electron)
| Activity | Description | Timing |
|----------|-------------|--------|
| `Connecting to event socket` | WebSocket to /api/ws-port | ~100ms |
| `Loading sessions` | GET /api/sessions (can be slow) | 100ms-15s |
| `Loading inbox items` | GET /api/inbox | ~50ms |
| `Loading inbox counts` | GET /api/inbox-counts | ~50ms |
| `Building tree view` | GET /api/sessions?mode=tree | 100ms-15s |

## Technical Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ StartupProvider (Context)                                        │
│  - Manages startup state machine                                 │
│  - Tracks activity progress                                      │
│  - Determines when to show/hide loading screen                   │
├─────────────────────────────────────────────────────────────────┤
│ StartupScreen (Component)                                        │
│  - Full-screen overlay with logo                                 │
│  - Progress bar (determinate during known phases)                │
│  - Activity log showing current + completed activities           │
│  - Fade out transition when complete                             │
├─────────────────────────────────────────────────────────────────┤
│ useStartupActivity (Hook)                                        │
│  - Register an activity with the startup tracker                 │
│  - Report progress/completion                                    │
│  - Used by existing hooks (useSessions, etc.)                    │
└─────────────────────────────────────────────────────────────────┘
```

### State Machine

```typescript
type StartupPhase =
  | "server"      // Electron: checking/starting dev server
  | "bootstrap"   // Loading preferences, validating scope
  | "data"        // Loading sessions, inbox, tree
  | "complete";   // All critical activities done

interface StartupActivity {
  id: string;
  label: string;           // e.g., "Loading sessions"
  phase: StartupPhase;
  status: "pending" | "active" | "complete" | "error";
  progress?: number;       // 0-100 for activities with known progress
  detail?: string;         // e.g., "port 3000" or "1,234 sessions"
  startTime?: number;
  endTime?: number;
}

interface StartupState {
  phase: StartupPhase;
  activities: StartupActivity[];
  overallProgress: number; // 0-100
  isComplete: boolean;
  error?: string;
}
```

### Skip Conditions

The loading screen should be **skipped** (or shown very briefly) when:

1. **Hot reload in dev** - React Fast Refresh shouldn't show loading
2. **Returning to already-loaded tab** - Data is cached
3. **Server already warm** - Most data loads in <200ms

**Detection strategy:**
- Track `sessionStorage.getItem("hilt-loaded")` - set after first complete load
- If set, show loading only if any activity takes >500ms
- Always show in Electron until server is ready

### Progress Calculation

```typescript
// Weighted progress by phase
const PHASE_WEIGHTS = {
  server: 30,     // 30% of progress bar (Electron only)
  bootstrap: 10,  // 10% of progress bar
  data: 60,       // 60% of progress bar
};

// Within data phase, weight by typical duration
const DATA_ACTIVITY_WEIGHTS = {
  "event-socket": 5,
  "sessions": 40,
  "inbox": 10,
  "inbox-counts": 5,
  "tree": 40,
};
```

### UI Design

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           🗡️                                    │
│                          Hilt                                   │
│                                                                 │
│           ████████████████░░░░░░░░░░░░░░  45%                  │
│                                                                 │
│           ✓ Checking for dev server                             │
│           ✓ Starting dev server on port 3000                    │
│           ✓ Loading preferences                                 │
│           ● Loading sessions (1,234 found)                      │
│           ○ Loading inbox items                                 │
│           ○ Building tree view                                  │
│                                                                 │
│                         3.2s elapsed                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Legend:
  ✓ = complete (muted color)
  ● = active (animated pulse)
  ○ = pending (dim)
```

### Styling

- Dark background matching app theme (`var(--bg-primary)`)
- Logo centered, subtle glow
- Progress bar with gradient (matches accent color)
- Monospace font for activity list
- Timestamps optional (right-aligned, dim)
- Smooth fade-out transition (300ms) when complete

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `src/contexts/StartupContext.tsx` | State machine, activity tracking |
| `src/components/StartupScreen.tsx` | Full-screen loading overlay |
| `src/hooks/useStartupActivity.ts` | Hook for registering activities |

### Files to Modify

| File | Change |
|------|--------|
| `src/app/layout.tsx` | Wrap with StartupProvider, render StartupScreen |
| `src/hooks/useSessions.ts` | Register "Loading sessions" activity |
| `src/hooks/useTreeSessions.ts` | Register "Building tree view" activity |
| `src/hooks/usePinnedFolders.ts` | Register as part of "Loading preferences" |
| `src/contexts/EventSocketContext.tsx` | Register "Connecting to event socket" |
| `electron/main.ts` | Send IPC events for server startup progress |
| `electron/preload.ts` | Expose server startup events to renderer |

### Electron Integration

The Electron main process needs to communicate server startup progress to the renderer:

```typescript
// main.ts - during startNextServer()
mainWindow.webContents.send("startup:activity", {
  id: "dev-server-check",
  label: "Checking for dev server",
  status: "active"
});

// After finding server
mainWindow.webContents.send("startup:activity", {
  id: "dev-server-check",
  label: "Checking for dev server",
  status: "complete",
  detail: `Found on port ${port}`
});
```

```typescript
// preload.ts
contextBridge.exposeInMainWorld("electronStartup", {
  onActivity: (callback) => ipcRenderer.on("startup:activity", (_, data) => callback(data))
});
```

```typescript
// StartupContext.tsx
useEffect(() => {
  if (window.electronStartup) {
    window.electronStartup.onActivity((activity) => {
      dispatch({ type: "UPDATE_ACTIVITY", activity });
    });
  }
}, []);
```

## Edge Cases

### Background Tab Load
If the app loads in a background tab:
- Don't animate (waste of CPU)
- Still track progress
- Show completion state when tab becomes visible

### Error Handling
If an activity fails:
- Show error state (red) for that activity
- Continue with other activities if possible
- Show "Retry" button for critical failures
- Log to console with details

### Timeout
If any activity exceeds expected duration:
- Show warning icon (yellow)
- Add "taking longer than expected" note
- Don't block other activities

### Already Loaded (Fast Path)
For subsequent visits with warm cache:
- Set minimum display time of 0ms (instant)
- If all activities complete in <200ms, skip loading screen entirely
- Prevents flash of loading for fast reconnects

## Design Decisions (Resolved)

1. **Activity detail verbosity** → **Verbose** - Show counts like "1,234 sessions found" to help identify bottlenecks

2. **Skip for power users** → **No** - Not implementing a skip preference for now

3. **Error recovery** → **Block on error** - Don't load the app partially; show relevant errors during boot

4. **Minimum display time** → **None** - Instant if not needed, but use smooth CSS transitions to avoid glitchy feel

## Estimated Effort

| Task | Estimate |
|------|----------|
| StartupContext + state machine | 2-3 hours |
| StartupScreen component + styling | 2-3 hours |
| useStartupActivity hook | 1 hour |
| Integrate with existing hooks | 2-3 hours |
| Electron IPC integration | 1-2 hours |
| Testing + edge cases | 2-3 hours |
| **Total** | **10-15 hours** |
