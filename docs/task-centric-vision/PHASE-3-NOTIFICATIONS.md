# Phase 3: Notifications

> **Goal**: Build a notification system that alerts users when tasks need attention, enabling truly asynchronous workflows. Core engine with pluggable delivery mechanisms.

> **Status**: Planning — Questions pending

## Problem Statement

Currently, knowing when Claude needs you requires:
1. Watching the terminal constantly
2. Periodically checking the app
3. User's custom "ding" hack for terminal prompts

This forces synchronous attention. Users want to:
- Queue work, walk away
- Get notified when attention is needed
- Click notification to jump directly to the task

## What We Discussed

### Core Engine + Pluggable Delivery

User specification:
> "We need a core like notification sending queuing system... the mechanism we're choosing to deliver them through can change"
> "Start with just like native browser push notifications... maybe we'll do Electron notifications, maybe WhatsApp or something else down the road"

Architecture:
```
┌─────────────────────────────────────┐
│       Notification Engine           │
│  • Event detection                  │
│  • Queue management                 │
│  • Content formatting               │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│       Delivery Adapters             │
│  ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ Browser │ │Electron │ │ Future│ │
│  │  Push   │ │ Native  │ │ (SMS, │ │
│  │         │ │         │ │ etc.) │ │
│  └─────────┘ └─────────┘ └───────┘ │
└─────────────────────────────────────┘
```

### Browser Push (Not In-Browser)

User clarified:
> "I don't want notifications like in the browser chrome I want you know like where the browser asks you for your permission that sends it to your system"

This means using the Web Push API with service workers, not just in-page toasts.

### Notification Types

From our discussion:
1. **Task completed** — "Dark mode implementation complete"
2. **Approval needed** — "Claude wants to push to main"
3. **Error/stuck** — "Build failed - needs input"
4. **Context limit** — "Context at 80% - may need new session"
5. **Input needed** — Claude is waiting for response (permission prompt)

User also noted two types of "waiting":
- Permission prompts (can I edit this file?)
- Decision prompts (which approach should I take?)

## Proposed Scope

### Notification Data Model

```typescript
interface Notification {
  id: string;
  taskId: string;
  runId?: string;

  // Content
  type: NotificationType;
  title: string;
  body: string;
  icon?: string;

  // Action
  actionUrl?: string;           // Where to navigate on click
  actions?: NotificationAction[]; // Quick actions

  // Status
  status: 'pending' | 'delivered' | 'clicked' | 'dismissed';
  createdAt: Date;
  deliveredAt?: Date;
  clickedAt?: Date;

  // Delivery
  deliveryChannel?: string;     // Which adapter delivered it
  deliveryError?: string;
}

type NotificationType =
  | 'task_completed'
  | 'task_failed'
  | 'approval_needed'
  | 'input_needed'
  | 'context_warning'
  | 'error';

interface NotificationAction {
  action: string;               // Action identifier
  title: string;                // Button text
  icon?: string;
}
```

### Notification Engine

```typescript
// src/lib/notification-engine.ts

class NotificationEngine {
  private queue: Notification[];
  private adapters: Map<string, NotificationAdapter>;
  private preferences: NotificationPreferences;

  // Register delivery adapter
  registerAdapter(name: string, adapter: NotificationAdapter): void;

  // Queue a notification
  notify(notification: Omit<Notification, 'id' | 'status' | 'createdAt'>): string;

  // Process queue (called periodically or on event)
  processQueue(): Promise<void>;

  // Get notification history
  getHistory(taskId?: string): Notification[];

  // Mark notification as clicked/dismissed
  markClicked(notificationId: string): void;
  markDismissed(notificationId: string): void;

  // Preferences
  setPreferences(prefs: NotificationPreferences): void;
  getPreferences(): NotificationPreferences;
}

interface NotificationAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  send(notification: Notification): Promise<boolean>;
}

interface NotificationPreferences {
  enabled: boolean;
  quietHours?: { start: string; end: string };  // "22:00" - "08:00"
  channels: {
    [channel: string]: boolean;  // Enable/disable per channel
  };
  types: {
    [type in NotificationType]?: boolean;  // Enable/disable per type
  };
}
```

### Browser Push Adapter

```typescript
// src/lib/notifications/browser-push-adapter.ts

class BrowserPushAdapter implements NotificationAdapter {
  name = 'browser-push';

  async isAvailable(): Promise<boolean> {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  async requestPermission(): Promise<boolean> {
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  async send(notification: Notification): Promise<boolean> {
    // Use Service Worker to show notification
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(notification.title, {
      body: notification.body,
      icon: notification.icon || '/icon.png',
      tag: notification.id,
      data: {
        taskId: notification.taskId,
        actionUrl: notification.actionUrl,
      },
      actions: notification.actions,
    });
    return true;
  }
}
```

### Service Worker

```typescript
// public/sw.js

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { taskId, actionUrl } = event.notification.data;

  // Handle action buttons
  if (event.action === 'approve') {
    // Call approval API
    fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' });
    return;
  }

  // Default: open app to task
  event.waitUntil(
    clients.openWindow(actionUrl || `/tasks/${taskId}`)
  );
});

self.addEventListener('push', (event) => {
  // Handle push from server (for future server-side push)
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      data: data,
    })
  );
});
```

### Event Detection

Integrate with ProcessManager (Phase 0) to detect notification-worthy events:

```typescript
// In process-manager.ts or separate event-detector.ts

processManager.on('processExit', (process, exitCode) => {
  if (exitCode === 0) {
    notificationEngine.notify({
      type: 'task_completed',
      taskId: process.metadata.taskId,
      title: 'Task Completed',
      body: `${taskTitle} finished successfully`,
      actionUrl: `/tasks/${process.metadata.taskId}`,
    });
  } else {
    notificationEngine.notify({
      type: 'task_failed',
      taskId: process.metadata.taskId,
      title: 'Task Failed',
      body: `${taskTitle} exited with error`,
      actionUrl: `/tasks/${process.metadata.taskId}`,
    });
  }
});

processManager.on('outputMatch', (process, pattern, match) => {
  // Detect patterns in output that indicate waiting
  if (pattern === 'permission_prompt') {
    notificationEngine.notify({
      type: 'input_needed',
      taskId: process.metadata.taskId,
      title: 'Input Needed',
      body: 'Claude is waiting for your response',
      actionUrl: `/tasks/${process.metadata.taskId}?terminal=true`,
    });
  }
});
```

### Pattern Detection for "Waiting" State

Need to detect when Claude is waiting for input. Possible patterns:

```typescript
const WAITING_PATTERNS = [
  // Permission prompts
  /Allow .+ to .+\? \[Y\/n\]/i,
  /Do you want to .+\?/i,

  // Decision prompts
  /Which .+ would you like/i,
  /Please choose/i,
  /Select .+:/i,

  // General input waiting
  /Press Enter to continue/i,
  /\(y\/N\)/i,
  /\[yes\/no\]/i,
];
```

### Notification API

```typescript
// GET /api/notifications
// List notifications
Query: { taskId?: string, status?: string, limit?: number }
Response: { notifications: Notification[] }

// PATCH /api/notifications/:id
// Update notification status
Body: { status: 'clicked' | 'dismissed' }

// GET /api/notifications/preferences
// Get notification preferences
Response: { preferences: NotificationPreferences }

// PUT /api/notifications/preferences
// Update preferences
Body: NotificationPreferences

// POST /api/notifications/test
// Send a test notification
Response: { success: boolean }
```

### UI Components

**NotificationPreferences** — Settings panel:
```
┌─────────────────────────────────────────────────┐
│  Notification Settings                          │
│                                                 │
│  ☑ Enable notifications                         │
│                                                 │
│  Notify me when:                                │
│  ☑ Task completes                               │
│  ☑ Task fails                                   │
│  ☑ Approval needed                              │
│  ☑ Input needed                                 │
│  ☐ Context warning (80%)                        │
│                                                 │
│  Quiet Hours:                                   │
│  ☐ Enable quiet hours                           │
│     From: [22:00] To: [08:00]                   │
│                                                 │
│  [Test Notification]  [Save]                    │
└─────────────────────────────────────────────────┘
```

**NotificationHistory** — Log of past notifications:
```
┌─────────────────────────────────────────────────┐
│  Recent Notifications                           │
│                                                 │
│  ✓ Task Completed — "Add OAuth"     2 min ago  │
│  ⚠ Input Needed — "Fix login bug"   15 min ago │
│  ✓ Task Completed — "Update deps"   1 hour ago │
│                                                 │
│  [Clear All]                                    │
└─────────────────────────────────────────────────┘
```

**Permission Banner** — Request permission if not granted:
```
┌─────────────────────────────────────────────────┐
│  🔔 Enable notifications to know when tasks     │
│     complete or need your attention.            │
│                                                 │
│  [Enable Notifications]  [Not Now]              │
└─────────────────────────────────────────────────┘
```

## Implementation Steps (Draft)

1. **Notification types & model** — `src/lib/types.ts`
2. **Notification storage** — `src/lib/notification-db.ts`
3. **Notification engine** — `src/lib/notification-engine.ts`
4. **Browser push adapter** — `src/lib/notifications/browser-push-adapter.ts`
5. **Service worker** — `public/sw.js`
6. **Event detection integration** — Hook into ProcessManager
7. **Pattern detection** — Detect "waiting" in terminal output
8. **Notification API routes** — `/api/notifications/`
9. **Preferences UI** — Settings component
10. **Permission request flow** — Banner + handler
11. **Notification history UI** — Log component

## Test Plan (Draft)

### Unit Tests

| Test | Description |
|------|-------------|
| `engine queues notification` | notify() adds to queue |
| `engine processes queue` | processQueue() delivers |
| `adapter checks availability` | isAvailable() accurate |
| `adapter requests permission` | requestPermission() works |
| `adapter sends notification` | send() triggers browser API |
| `preferences filtering` | Disabled types not sent |
| `quiet hours respected` | No notifications during quiet |
| `pattern detection` | Waiting patterns matched |

### Integration Tests

| Test | Description |
|------|-------------|
| `process exit triggers notification` | Completion event sent |
| `process error triggers notification` | Failure event sent |
| `output pattern triggers notification` | Input needed detected |
| `API returns notifications` | Endpoints work |
| `preferences persist` | Settings saved/loaded |

### Manual Testing

- [ ] Permission request shows system dialog
- [ ] Test notification appears in system tray
- [ ] Click notification opens app to task
- [ ] Task completion triggers notification
- [ ] Task failure triggers notification
- [ ] Input waiting triggers notification
- [ ] Preferences save correctly
- [ ] Quiet hours prevent notifications
- [ ] Notification history shows all

### Browser Testing (Claude via Chrome)

- [ ] Request permission, grant it
- [ ] Start long-running task
- [ ] Switch away from browser
- [ ] Receive system notification on completion
- [ ] Click notification, lands on task
- [ ] Test with task that requires input
- [ ] Verify notification appears when waiting

---

## Open Questions

### Detection

**Q1: How to detect "waiting for input" reliably?**
- Option A: Pattern matching on terminal output (proposed above)
- Option B: Claude Code hook/event (if available)
- Option C: Timeout-based (no output for X seconds = probably waiting)
- Option D: Combination of patterns + timeout

**Q2: False positives**
Pattern matching may trigger incorrectly. How to handle?
- Option A: Aggressive matching, accept some false positives
- Option B: Conservative matching, miss some
- Option C: User can configure patterns
- Option D: Learn from user dismissals

### Delivery

**Q3: Server-side push vs client-side?**
Current proposal is client-side (browser generates notification). Should we add server-side push?
- Pro: Works even if browser tab is closed
- Con: Requires push service subscription, more complexity
- Recommendation: Start client-side, add server push later

**Q4: Electron adapter**
For native app, should we use Electron's native notifications?
- Option A: Yes, separate adapter for Electron
- Option B: Browser push works in Electron too (verify)
- Option C: Defer to later, focus on browser first

**Q5: Sound/vibration**
Should notifications have sound?
- Option A: Yes, with option to disable
- Option B: No, rely on system defaults
- Option C: Configurable sound selection

### UX

**Q6: In-app notification center?**
Besides system notifications, should there be an in-app notification list?
- Option A: Yes, notification bell icon with dropdown
- Option B: No, rely on system notifications only
- Option C: Just a history/log page, no prominent indicator

**Q7: Notification grouping**
If multiple tasks complete while away, should they:
- Option A: Each get separate notification
- Option B: Group into single "3 tasks completed"
- Option C: Configurable behavior

**Q8: Action buttons**
Should notifications have action buttons?
- Example: "Approve" button on completion notification
- Pro: Quick actions without opening app
- Con: More complex, may not work on all platforms

### Storage

**Q9: Notification history retention**
How long to keep notification history?
- Option A: Forever (user clears manually)
- Option B: Auto-delete after X days
- Option C: Keep last N notifications

---

## Dependencies

- **Phase 0** — Need process events (exit, output) to trigger notifications
- **Phase 1** — Notifications reference tasks
- Enables **Phase 4** — Approval notifications

---

*Created: January 8, 2026*
*Status: Awaiting answers to open questions*
