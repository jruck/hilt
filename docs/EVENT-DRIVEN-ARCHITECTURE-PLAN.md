# Event-Driven Architecture Migration Plan

## Overview

Migrate from polling-based data fetching to event-driven architecture using WebSocket + Chokidar file watching. This enables real-time session status detection ("Needs Attention" column) and improves performance across the board.

**Scope:**
- Session list updates (currently 5s polling)
- Session status derivation (new: tool_use/tool_result detection)
- Docs tree updates (currently 5s polling)
- Docs file content updates (currently 5s polling)
- Inbox updates (currently 5s polling)
- New "Needs Attention" column with derived states

**Out of Scope:**
- Terminal WebSocket (already event-driven)
- Terminal port checking (polling appropriate)

---

## Architecture

### Current State (Polling)

```
┌────────────┐     GET /api/sessions      ┌────────────┐
│   Client   │ ◄─────── every 5s ────────►│   Server   │
│            │                             │            │
│  useSWR    │     GET /api/docs/tree     │  Next.js   │
│  polling   │ ◄─────── every 5s ────────►│    API     │
│            │                             │            │
│            │     GET /api/docs/file     │            │
│            │ ◄─────── every 5s ────────►│            │
└────────────┘                             └────────────┘
```

### Target State (Event-Driven)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Server                                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      File Watchers (Chokidar)                       │ │
│  │                                                                      │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │ │
│  │  │ Session Watcher  │  │  Scope Watcher   │  │  Inbox Watcher   │  │ │
│  │  │                  │  │                  │  │                  │  │ │
│  │  │ ~/.claude/       │  │ /path/to/scope/* │  │ inbox.md files   │  │ │
│  │  │ projects/*.jsonl │  │ (per client)     │  │ (per scope)      │  │ │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │ │
│  └───────────┼─────────────────────┼─────────────────────┼────────────┘ │
│              │                     │                     │              │
│              ▼                     ▼                     ▼              │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      Event Processor                                │ │
│  │                                                                      │ │
│  │  • Debounce: 200ms per file                                         │ │
│  │  • Incremental JSONL parsing (track byte offset)                    │ │
│  │  • Session status derivation (tool_use/tool_result tracking)        │ │
│  │  • Batch related events                                             │ │
│  └────────────────────────────────┬───────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      WebSocket Server                               │ │
│  │                                                                      │ │
│  │  Port: Same as ws-server.ts (terminal)                              │ │
│  │  Path: /events                                                       │ │
│  │                                                                      │ │
│  │  Events:                                                             │ │
│  │    session:created   { session }                                    │ │
│  │    session:updated   { session, changes }                           │ │
│  │    session:deleted   { sessionId }                                  │ │
│  │    tree:changed      { scope, type, path }                          │ │
│  │    file:changed      { scope, path, modTime }                       │ │
│  │    inbox:changed     { scope }                                      │ │
│  │                                                                      │ │
│  │  Subscriptions (per client):                                        │ │
│  │    subscribe:sessions    { scope? }                                 │ │
│  │    subscribe:tree        { scope }                                  │ │
│  │    subscribe:file        { scope, path }                            │ │
│  │    subscribe:inbox       { scope }                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   │ WebSocket
                                   │
┌──────────────────────────────────▼──────────────────────────────────────┐
│                              Client                                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      useEventSocket Hook                            │ │
│  │                                                                      │ │
│  │  • Single WebSocket connection                                      │ │
│  │  • Auto-reconnect with exponential backoff                          │ │
│  │  • Subscription management                                          │ │
│  │  • Event routing to subscribers                                     │ │
│  └────────────────────────────────┬───────────────────────────────────┘ │
│                                   │                                      │
│              ┌────────────────────┼────────────────────┐                │
│              ▼                    ▼                    ▼                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │   useSessions    │  │     useDocs      │  │   useInboxItems  │      │
│  │                  │  │                  │  │                  │      │
│  │  On event:       │  │  On event:       │  │  On event:       │      │
│  │  mutate() SWR    │  │  mutate() SWR    │  │  mutate() SWR    │      │
│  │                  │  │                  │  │                  │      │
│  │  Fallback:       │  │  Fallback:       │  │  Fallback:       │      │
│  │  30s polling     │  │  30s polling     │  │  30s polling     │      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Session Status Derivation

### States

| State | Detection | Column | Section |
|-------|-----------|--------|---------|
| `working` | Last entry is user prompt | Active | Working |
| `waiting_for_approval` | Has pending `tool_use` without `tool_result` | Needs Attention | Approval |
| `waiting_for_input` | Assistant finished, no pending tools | Needs Attention | Input |
| `idle` | No activity for 5+ minutes | Active | Idle |

### Detection Algorithm

```typescript
interface DerivedSessionState {
  status: 'working' | 'waiting_for_approval' | 'waiting_for_input' | 'idle';
  pendingToolUses: Array<{ id: string; name: string }>;
  lastActivityTime: number;
  isRunning: boolean;
}

function deriveSessionState(entries: JournalEntry[]): DerivedSessionState {
  const pendingToolUses: Array<{ id: string; name: string }> = [];
  let lastActivityTime = 0;
  let lastEntryType: 'user' | 'assistant' | 'system' | null = null;

  for (const entry of entries) {
    if (entry.timestamp) {
      lastActivityTime = Math.max(lastActivityTime, entry.timestamp);
    }

    if (isUserEntry(entry)) {
      lastEntryType = 'user';
      // Tool results clear pending tools
      if (Array.isArray(entry.content)) {
        for (const block of entry.content) {
          if (block.type === 'tool_result') {
            const idx = pendingToolUses.findIndex(t => t.id === block.tool_use_id);
            if (idx !== -1) pendingToolUses.splice(idx, 1);
          }
        }
      }
    } else if (isAssistantEntry(entry)) {
      lastEntryType = 'assistant';
      // Tool uses add to pending
      if (Array.isArray(entry.content)) {
        for (const block of entry.content) {
          if (block.type === 'tool_use') {
            pendingToolUses.push({ id: block.id, name: block.name });
          }
        }
      }
    } else if (isSystemEntry(entry)) {
      // turn_duration or stop_hook_summary indicates turn end
      if (entry.type === 'turn_duration' || entry.type === 'stop_hook_summary') {
        lastEntryType = 'system';
        pendingToolUses.length = 0; // Clear on turn end
      }
    }
  }

  const now = Date.now();
  const idleThreshold = 5 * 60 * 1000; // 5 minutes
  const isIdle = lastActivityTime > 0 && (now - lastActivityTime) > idleThreshold;

  let status: DerivedSessionState['status'];
  if (isIdle) {
    status = 'idle';
  } else if (pendingToolUses.length > 0) {
    status = 'waiting_for_approval';
  } else if (lastEntryType === 'assistant' || lastEntryType === 'system') {
    status = 'waiting_for_input';
  } else {
    status = 'working';
  }

  return {
    status,
    pendingToolUses,
    lastActivityTime,
    isRunning: !isIdle && (status === 'working' || status === 'waiting_for_approval'),
  };
}
```

---

## Column Structure

### Before

```
┌─────────┐  ┌─────────────┐  ┌─────────────────────┐
│  Inbox  │  │ In Progress │  │       Recent        │
│         │  │             │  │  ┌───────────────┐  │
│ (drafts)│  │ (running)   │  │  │ Today         │  │
│         │  │             │  │  │ Yesterday     │  │
│         │  │             │  │  │ This Week     │  │
│         │  │             │  │  │ Older         │  │
└─────────┘  └─────────────┘  └───────────────────┘
```

### After

```
┌─────────┐  ┌─────────────────┐  ┌─────────────┐  ┌─────────────────────┐
│  Inbox  │  │ Needs Attention │  │   Active    │  │       Recent        │
│         │  │  ┌───────────┐  │  │ ┌─────────┐ │  │  ┌───────────────┐  │
│ (drafts)│  │  │ Approval  │  │  │ │ Working │ │  │  │ Today         │  │
│         │  │  │ Input     │  │  │ │ Idle    │ │  │  │ Yesterday     │  │
│         │  │  └───────────┘  │  │ └─────────┘ │  │  │ This Week     │  │
│         │  │                 │  │             │  │  │ Older         │  │
│         │  │  (locked -      │  │             │  │  └───────────────┘  │
│         │  │   can't drag    │  │             │  │                     │
│         │  │   out)          │  │             │  │                     │
└─────────┘  └─────────────────┘  └─────────────┘  └─────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation - WebSocket Infrastructure

**Goal:** Add WebSocket event system alongside existing polling (no behavior change yet)

#### Files to Create

| File | Purpose |
|------|---------|
| `server/event-server.ts` | WebSocket server for events |
| `server/watchers/index.ts` | Watcher orchestration |
| `server/watchers/session-watcher.ts` | Chokidar for ~/.claude/projects |
| `server/watchers/scope-watcher.ts` | Chokidar for scope directories |
| `server/watchers/inbox-watcher.ts` | Chokidar for inbox.md files |
| `src/hooks/useEventSocket.ts` | Client WebSocket hook |
| `src/contexts/EventSocketContext.tsx` | Provider for WebSocket |

#### Files to Modify

| File | Changes |
|------|---------|
| `server/ws-server.ts` | Add /events endpoint alongside /terminal |
| `package.json` | Add chokidar dependency |

#### Implementation Details

**server/event-server.ts**
```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

interface Subscription {
  clientId: string;
  channel: string;
  params: Record<string, unknown>;
}

export class EventServer extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();
  private subscriptions: Map<string, Subscription[]> = new Map();

  constructor(server: http.Server, path: string) {
    super();
    this.wss = new WebSocketServer({ server, path });
    this.wss.on('connection', this.handleConnection.bind(this));
  }

  private handleConnection(ws: WebSocket) {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, ws);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this.handleMessage(clientId, msg);
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.subscriptions.delete(clientId);
      this.emit('client:disconnected', clientId);
    });

    ws.send(JSON.stringify({ type: 'connected', clientId }));
  }

  private handleMessage(clientId: string, msg: { type: string; channel?: string; params?: Record<string, unknown> }) {
    if (msg.type === 'subscribe' && msg.channel) {
      this.subscribe(clientId, msg.channel, msg.params || {});
    } else if (msg.type === 'unsubscribe' && msg.channel) {
      this.unsubscribe(clientId, msg.channel);
    }
  }

  subscribe(clientId: string, channel: string, params: Record<string, unknown>) {
    const subs = this.subscriptions.get(clientId) || [];
    subs.push({ clientId, channel, params });
    this.subscriptions.set(clientId, subs);
    this.emit('subscription:added', { clientId, channel, params });
  }

  unsubscribe(clientId: string, channel: string) {
    const subs = this.subscriptions.get(clientId) || [];
    const filtered = subs.filter(s => s.channel !== channel);
    this.subscriptions.set(clientId, filtered);
    this.emit('subscription:removed', { clientId, channel });
  }

  broadcast(channel: string, event: string, data: unknown, filter?: (params: Record<string, unknown>) => boolean) {
    for (const [clientId, subs] of this.subscriptions) {
      const sub = subs.find(s => s.channel === channel);
      if (sub && (!filter || filter(sub.params))) {
        const ws = this.clients.get(clientId);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ channel, event, data }));
        }
      }
    }
  }
}
```

**src/hooks/useEventSocket.ts**
```typescript
import { useEffect, useRef, useCallback, useState } from 'react';

interface EventSocketState {
  connected: boolean;
  clientId: string | null;
}

type EventHandler = (data: unknown) => void;

export function useEventSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const [state, setState] = useState<EventSocketState>({ connected: false, clientId: null });
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/events`);

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      setState(s => ({ ...s, connected: true }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') {
        setState(s => ({ ...s, clientId: msg.clientId }));
      } else if (msg.channel && msg.event) {
        const key = `${msg.channel}:${msg.event}`;
        const handlers = handlersRef.current.get(key);
        handlers?.forEach(h => h(msg.data));
      }
    };

    ws.onclose = () => {
      setState({ connected: false, clientId: null });
      // Exponential backoff reconnect
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((channel: string, params: Record<string, unknown> = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel, params }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  const on = useCallback((channel: string, event: string, handler: EventHandler) => {
    const key = `${channel}:${event}`;
    if (!handlersRef.current.has(key)) {
      handlersRef.current.set(key, new Set());
    }
    handlersRef.current.get(key)!.add(handler);

    return () => {
      handlersRef.current.get(key)?.delete(handler);
    };
  }, []);

  return { ...state, subscribe, unsubscribe, on };
}
```

#### Tests - Phase 1

**Unit Tests: `server/__tests__/event-server.test.ts`**
```typescript
describe('EventServer', () => {
  describe('connection handling', () => {
    it('assigns unique clientId on connection');
    it('sends connected message with clientId');
    it('cleans up on client disconnect');
    it('handles multiple simultaneous clients');
  });

  describe('subscriptions', () => {
    it('adds subscription on subscribe message');
    it('removes subscription on unsubscribe message');
    it('emits subscription:added event');
    it('emits subscription:removed event');
    it('clears all subscriptions on disconnect');
  });

  describe('broadcast', () => {
    it('sends to all subscribers of channel');
    it('respects filter function');
    it('skips closed connections');
    it('handles empty subscriber list');
  });
});
```

**Unit Tests: `src/hooks/__tests__/useEventSocket.test.ts`**
```typescript
describe('useEventSocket', () => {
  describe('connection', () => {
    it('connects on mount');
    it('sets connected state when open');
    it('stores clientId from server');
    it('reconnects on close with exponential backoff');
    it('cleans up on unmount');
  });

  describe('subscriptions', () => {
    it('sends subscribe message');
    it('sends unsubscribe message');
    it('queues subscriptions if not connected');
  });

  describe('event handling', () => {
    it('routes events to registered handlers');
    it('supports multiple handlers per event');
    it('returns unsubscribe function from on()');
  });
});
```

**Integration Tests: `server/__tests__/event-integration.test.ts`**
```typescript
describe('Event System Integration', () => {
  it('client connects and receives clientId');
  it('client subscribes and receives events');
  it('multiple clients receive broadcast');
  it('unsubscribed client does not receive events');
  it('reconnection restores subscriptions');
});
```

#### Chrome Verification - Phase 1

| # | Test | Steps | Expected | Pass |
|---|------|-------|----------|------|
| 1 | WebSocket connects | Open app, check DevTools Network | WS connection to /events established | [ ] |
| 2 | ClientId received | Check console/state | clientId populated | [ ] |
| 3 | Reconnection | Kill server, restart | WS reconnects automatically | [ ] |
| 4 | No behavior change | Use app normally | All polling still works | [ ] |

---

### Phase 2: Session Watcher & Status Derivation

**Goal:** Add file watching for sessions, derive status, push events (polling still active as fallback)

#### Files to Create

| File | Purpose |
|------|---------|
| `server/watchers/session-watcher.ts` | Watch ~/.claude/projects |
| `src/lib/session-status.ts` | Status derivation logic |
| `src/lib/__tests__/session-status.test.ts` | Status derivation tests |

#### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/types.ts` | Add DerivedSessionState, ToolUseBlock types |
| `src/lib/claude-sessions.ts` | Add incremental parsing, status derivation |
| `server/ws-server.ts` | Initialize session watcher |
| `src/hooks/useSessions.ts` | Subscribe to session events |

#### Implementation Details

**server/watchers/session-watcher.ts**
```typescript
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';

interface SessionFileState {
  byteOffset: number;
  lastModTime: number;
  derivedStatus: DerivedSessionState;
}

export class SessionWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private fileStates: Map<string, SessionFileState> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly debounceMs = 200;
  private readonly claudeDir: string;

  constructor() {
    super();
    this.claudeDir = path.join(os.homedir(), '.claude', 'projects');
  }

  start() {
    this.watcher = chokidar.watch(this.claudeDir, {
      depth: 2,
      ignored: [
        /agent-.*\.jsonl$/,  // Ignore agent sub-sessions
        /node_modules/,
      ],
      ignoreInitial: false,
      persistent: true,
    });

    this.watcher.on('add', (filePath) => this.handleFile(filePath, 'created'));
    this.watcher.on('change', (filePath) => this.debouncedHandle(filePath, 'updated'));
    this.watcher.on('unlink', (filePath) => this.handleDelete(filePath));
  }

  stop() {
    this.watcher?.close();
    this.debounceTimers.forEach(t => clearTimeout(t));
  }

  private debouncedHandle(filePath: string, event: string) {
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.handleFile(filePath, event);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private async handleFile(filePath: string, event: string) {
    if (!filePath.endsWith('.jsonl')) return;

    const sessionId = path.basename(filePath, '.jsonl');
    const state = this.fileStates.get(filePath);

    // Incremental read from last offset
    const { entries, newOffset } = await this.readIncremental(
      filePath,
      state?.byteOffset || 0
    );

    if (entries.length === 0 && event !== 'created') return;

    // Derive status from all entries (need full state)
    const allEntries = await this.readAllEntries(filePath);
    const derivedStatus = deriveSessionState(allEntries);

    // Update state
    this.fileStates.set(filePath, {
      byteOffset: newOffset,
      lastModTime: Date.now(),
      derivedStatus,
    });

    // Emit event
    this.emit(event === 'created' ? 'session:created' : 'session:updated', {
      sessionId,
      filePath,
      derivedStatus,
      newEntries: entries,
    });
  }

  private handleDelete(filePath: string) {
    if (!filePath.endsWith('.jsonl')) return;
    const sessionId = path.basename(filePath, '.jsonl');
    this.fileStates.delete(filePath);
    this.emit('session:deleted', { sessionId, filePath });
  }

  private async readIncremental(filePath: string, offset: number): Promise<{ entries: unknown[]; newOffset: number }> {
    // Implementation: read file from offset, parse JSONL lines
  }

  private async readAllEntries(filePath: string): Promise<unknown[]> {
    // Implementation: read and parse full file
  }
}
```

**src/lib/session-status.ts**
```typescript
// Full implementation of deriveSessionState as shown in Architecture section
```

#### Tests - Phase 2

**Unit Tests: `src/lib/__tests__/session-status.test.ts`**
```typescript
describe('deriveSessionState', () => {
  describe('working state', () => {
    it('returns working when last entry is user prompt', () => {
      const entries = [{ type: 'human', content: 'Hello' }];
      expect(deriveSessionState(entries).status).toBe('working');
    });

    it('returns working when user sent prompt after assistant response', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
        { type: 'human', content: 'Follow up' },
      ];
      expect(deriveSessionState(entries).status).toBe('working');
    });

    it('returns working after tool_result clears all pending tools', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }] },
        { type: 'human', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      ];
      const state = deriveSessionState(entries);
      expect(state.status).toBe('working');
      expect(state.pendingToolUses).toEqual([]);
    });
  });

  describe('waiting_for_approval state', () => {
    it('returns waiting_for_approval when tool_use has no tool_result', () => {
      const entries = [
        { type: 'human', content: 'Read file' },
        { type: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }] },
      ];
      const state = deriveSessionState(entries);
      expect(state.status).toBe('waiting_for_approval');
      expect(state.pendingToolUses).toEqual([{ id: 't1', name: 'Read' }]);
    });

    it('tracks multiple pending tool uses', () => {
      const entries = [
        { type: 'assistant', content: [
          { type: 'tool_use', id: 't1', name: 'Read' },
          { type: 'tool_use', id: 't2', name: 'Glob' },
        ]},
      ];
      expect(deriveSessionState(entries).pendingToolUses).toHaveLength(2);
    });

    it('clears specific tool when result received, keeps others pending', () => {
      const entries = [
        { type: 'assistant', content: [
          { type: 'tool_use', id: 't1', name: 'Read' },
          { type: 'tool_use', id: 't2', name: 'Glob' },
        ]},
        { type: 'human', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      ];
      const state = deriveSessionState(entries);
      expect(state.status).toBe('waiting_for_approval');
      expect(state.pendingToolUses).toEqual([{ id: 't2', name: 'Glob' }]);
    });
  });

  describe('waiting_for_input state', () => {
    it('returns waiting_for_input when assistant finished without tool_use', () => {
      const entries = [
        { type: 'human', content: 'Hello' },
        { type: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ];
      expect(deriveSessionState(entries).status).toBe('waiting_for_input');
    });

    it('returns waiting_for_input after turn_duration system entry', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }] },
        { type: 'human', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
        { type: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
        { type: 'system', subtype: 'turn_duration' },
      ];
      expect(deriveSessionState(entries).status).toBe('waiting_for_input');
    });

    it('clears pending tools on turn_duration', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }] },
        { type: 'system', subtype: 'turn_duration' },
      ];
      const state = deriveSessionState(entries);
      expect(state.pendingToolUses).toEqual([]);
    });
  });

  describe('idle state', () => {
    it('returns idle when last activity > 5 minutes ago', () => {
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      const entries = [{ type: 'human', content: 'Hello', timestamp: sixMinutesAgo }];
      expect(deriveSessionState(entries).status).toBe('idle');
    });

    it('returns non-idle when activity is recent', () => {
      const oneMinuteAgo = Date.now() - (1 * 60 * 1000);
      const entries = [{ type: 'human', content: 'Hello', timestamp: oneMinuteAgo }];
      expect(deriveSessionState(entries).status).not.toBe('idle');
    });

    it('idle takes precedence over other states', () => {
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      const entries = [
        { type: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }], timestamp: sixMinutesAgo },
      ];
      expect(deriveSessionState(entries).status).toBe('idle');
    });
  });

  describe('edge cases', () => {
    it('handles empty entries', () => {
      expect(deriveSessionState([]).status).toBe('idle');
    });

    it('handles entries without content arrays', () => {
      const entries = [{ type: 'summary', summary: 'Previous conversation' }];
      expect(deriveSessionState(entries)).toBeDefined();
    });

    it('handles malformed tool_use blocks', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'tool_use' }] }, // missing id/name
      ];
      expect(() => deriveSessionState(entries)).not.toThrow();
    });

    it('handles tool_result without matching tool_use', () => {
      const entries = [
        { type: 'human', content: [{ type: 'tool_result', tool_use_id: 'unknown' }] },
      ];
      expect(() => deriveSessionState(entries)).not.toThrow();
    });
  });

  describe('isRunning flag', () => {
    it('isRunning true when working and not idle', () => {
      const entries = [{ type: 'human', content: 'Hello', timestamp: Date.now() }];
      expect(deriveSessionState(entries).isRunning).toBe(true);
    });

    it('isRunning true when waiting_for_approval and not idle', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }], timestamp: Date.now() },
      ];
      expect(deriveSessionState(entries).isRunning).toBe(true);
    });

    it('isRunning false when waiting_for_input', () => {
      const entries = [
        { type: 'assistant', content: [{ type: 'text', text: 'Done' }], timestamp: Date.now() },
      ];
      expect(deriveSessionState(entries).isRunning).toBe(false);
    });

    it('isRunning false when idle', () => {
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      const entries = [{ type: 'human', content: 'Hello', timestamp: sixMinutesAgo }];
      expect(deriveSessionState(entries).isRunning).toBe(false);
    });
  });
});
```

**Unit Tests: `server/watchers/__tests__/session-watcher.test.ts`**
```typescript
describe('SessionWatcher', () => {
  describe('file watching', () => {
    it('watches ~/.claude/projects directory');
    it('ignores agent-*.jsonl files');
    it('handles new .jsonl file creation');
    it('handles .jsonl file changes');
    it('handles .jsonl file deletion');
  });

  describe('debouncing', () => {
    it('debounces rapid file changes (200ms)');
    it('processes after debounce period');
    it('resets timer on subsequent changes');
  });

  describe('incremental parsing', () => {
    it('tracks byte offset per file');
    it('only reads new content on change');
    it('resets offset on file truncation');
  });

  describe('event emission', () => {
    it('emits session:created for new files');
    it('emits session:updated for changed files');
    it('emits session:deleted for removed files');
    it('includes derivedStatus in events');
  });
});
```

#### Chrome Verification - Phase 2

| # | Test | Steps | Expected | Pass |
|---|------|-------|----------|------|
| 1 | Session created event | Start new Claude session | session:created event received | [ ] |
| 2 | Session updated event | Send message in Claude | session:updated event received | [ ] |
| 3 | Working status | Send user prompt, don't wait | derivedStatus = 'working' | [ ] |
| 4 | Approval status | Claude uses tool, don't approve | derivedStatus = 'waiting_for_approval' | [ ] |
| 5 | Input status | Claude responds, await user | derivedStatus = 'waiting_for_input' | [ ] |
| 6 | Idle status | Wait 5+ minutes | derivedStatus = 'idle' | [ ] |
| 7 | Debounce | Rapid file changes | Only one event per 200ms | [ ] |
| 8 | Polling fallback | Disconnect WebSocket | Polling still updates UI | [ ] |

---

### Phase 3: New Column Structure

**Goal:** Add "Needs Attention" column, rename "In Progress" to "Active", add sections

#### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/types.ts` | Add 'attention' status, section types |
| `src/components/Board.tsx` | Add Attention column, update column definitions |
| `src/components/Column.tsx` | Support sections within columns |
| `src/components/SessionCard.tsx` | Add status badge, pending tool count |
| `src/lib/db.ts` | Update status resolution logic |

#### Implementation Details

**src/lib/types.ts additions**
```typescript
export type SessionStatus = 'inbox' | 'active' | 'recent' | 'archived';

export type DerivedStatus = 'working' | 'waiting_for_approval' | 'waiting_for_input' | 'idle';

export interface DerivedSessionState {
  status: DerivedStatus;
  pendingToolUses: Array<{ id: string; name: string }>;
  lastActivityTime: number;
  isRunning: boolean;
}

export interface Session {
  // ... existing fields
  derivedState?: DerivedSessionState;
}

export interface ColumnSection {
  id: string;
  title: string;
  filter: (session: Session) => boolean;
}

export interface ColumnConfig {
  id: string;
  title: string;
  sections?: ColumnSection[];
  canDragInto: boolean;
  canDragOutOf: boolean;
}
```

**src/components/Board.tsx changes**
```typescript
const COLUMN_CONFIG: ColumnConfig[] = [
  {
    id: 'inbox',
    title: 'Inbox',
    canDragInto: true,
    canDragOutOf: true,
  },
  {
    id: 'attention',
    title: 'Needs Attention',
    canDragInto: false,  // Derived state only
    canDragOutOf: false, // Locked by derived state
    sections: [
      {
        id: 'approval',
        title: 'Waiting for Approval',
        filter: (s) => s.derivedState?.status === 'waiting_for_approval',
      },
      {
        id: 'input',
        title: 'Waiting for Input',
        filter: (s) => s.derivedState?.status === 'waiting_for_input',
      },
    ],
  },
  {
    id: 'active',
    title: 'Active',
    canDragInto: true,
    canDragOutOf: true,
    sections: [
      {
        id: 'working',
        title: 'Working',
        filter: (s) => s.derivedState?.status === 'working',
      },
      {
        id: 'idle',
        title: 'Idle',
        filter: (s) => s.derivedState?.status === 'idle' || !s.derivedState,
      },
    ],
  },
  {
    id: 'recent',
    title: 'Recent',
    canDragInto: true,
    canDragOutOf: true,
    sections: [/* existing time-based sections */],
  },
];

// Column assignment logic
function getColumnForSession(session: Session): string {
  // Running sessions with attention-needed status go to attention column
  if (session.derivedState?.isRunning) {
    if (session.derivedState.status === 'waiting_for_approval' ||
        session.derivedState.status === 'waiting_for_input') {
      return 'attention';
    }
    return 'active';
  }

  // Non-running sessions use manual status
  return session.status || 'recent';
}
```

**src/components/SessionCard.tsx additions**
```typescript
function StatusBadge({ session }: { session: Session }) {
  if (!session.derivedState) return null;

  const { status, pendingToolUses } = session.derivedState;

  const config = {
    working: {
      icon: Loader2,
      className: 'text-emerald-500 animate-spin',
      label: 'Working',
    },
    waiting_for_approval: {
      icon: AlertCircle,
      className: 'text-amber-500',
      label: `Approval${pendingToolUses.length > 1 ? ` (${pendingToolUses.length})` : ''}`,
    },
    waiting_for_input: {
      icon: MessageSquare,
      className: 'text-blue-500',
      label: 'Needs Input',
    },
    idle: {
      icon: Clock,
      className: 'text-gray-400',
      label: 'Idle',
    },
  };

  const cfg = config[status];
  const Icon = cfg.icon;

  return (
    <div className={`flex items-center gap-1 text-xs ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      <span>{cfg.label}</span>
    </div>
  );
}
```

#### Tests - Phase 3

**Unit Tests: `src/components/__tests__/Board.test.tsx`**
```typescript
describe('Board column assignment', () => {
  it('places waiting_for_approval sessions in Attention column', () => {
    const session = mockSession({ derivedState: { status: 'waiting_for_approval', isRunning: true } });
    expect(getColumnForSession(session)).toBe('attention');
  });

  it('places waiting_for_input sessions in Attention column', () => {
    const session = mockSession({ derivedState: { status: 'waiting_for_input', isRunning: true } });
    expect(getColumnForSession(session)).toBe('attention');
  });

  it('places working sessions in Active column', () => {
    const session = mockSession({ derivedState: { status: 'working', isRunning: true } });
    expect(getColumnForSession(session)).toBe('active');
  });

  it('places idle sessions in Active column', () => {
    const session = mockSession({ derivedState: { status: 'idle', isRunning: false } });
    expect(getColumnForSession(session)).toBe('active');
  });

  it('uses manual status for non-running sessions', () => {
    const session = mockSession({ status: 'recent', derivedState: { isRunning: false } });
    expect(getColumnForSession(session)).toBe('recent');
  });

  it('derived status takes precedence for running sessions', () => {
    const session = mockSession({
      status: 'recent', // manual
      derivedState: { status: 'waiting_for_approval', isRunning: true },
    });
    expect(getColumnForSession(session)).toBe('attention');
  });
});

describe('Board drag behavior', () => {
  it('prevents dragging into Attention column');
  it('prevents dragging out of Attention column');
  it('allows dragging between other columns');
});
```

**Unit Tests: `src/components/__tests__/SessionCard.test.tsx`**
```typescript
describe('SessionCard StatusBadge', () => {
  it('shows spinning loader for working status');
  it('shows alert icon for waiting_for_approval');
  it('shows pending count when multiple tools waiting');
  it('shows message icon for waiting_for_input');
  it('shows clock icon for idle');
  it('hides badge when no derivedState');
});
```

#### Chrome Verification - Phase 3

| # | Test | Steps | Expected | Pass |
|---|------|-------|----------|------|
| 1 | Attention column visible | Load app | "Needs Attention" column present | [ ] |
| 2 | Active column renamed | Load app | "In Progress" now "Active" | [ ] |
| 3 | Attention sections | Have sessions in both states | "Approval" and "Input" sections visible | [ ] |
| 4 | Active sections | Have working and idle sessions | "Working" and "Idle" sections visible | [ ] |
| 5 | Approval badge | Session waiting for approval | Shows amber badge with count | [ ] |
| 6 | Input badge | Session waiting for input | Shows blue "Needs Input" badge | [ ] |
| 7 | Working badge | Session actively working | Shows green spinning badge | [ ] |
| 8 | Idle badge | Session idle 5+ min | Shows gray "Idle" badge | [ ] |
| 9 | No drag into Attention | Try drag into Attention | Not allowed, visual feedback | [ ] |
| 10 | No drag out of Attention | Try drag out of Attention | Not allowed, visual feedback | [ ] |
| 11 | Empty Attention column | No sessions need attention | Column visible with empty state | [ ] |
| 12 | Real-time movement | Approve tool in Claude | Session moves to Active immediately | [ ] |

---

### Phase 4: Docs & Inbox Event Migration

**Goal:** Migrate remaining polling to event-driven

#### Files to Create

| File | Purpose |
|------|---------|
| `server/watchers/scope-watcher.ts` | Watch scope directories |
| `server/watchers/inbox-watcher.ts` | Watch inbox.md files |

#### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useDocs.ts` | Subscribe to tree/file events |
| `src/hooks/useSessions.ts` (useInboxItems) | Subscribe to inbox events |

#### Implementation Details

**server/watchers/scope-watcher.ts**
```typescript
export class ScopeWatcher extends EventEmitter {
  private watchers: Map<string, { watcher: chokidar.FSWatcher; clients: Set<string> }> = new Map();

  watchScope(scopePath: string, clientId: string) {
    const existing = this.watchers.get(scopePath);
    if (existing) {
      existing.clients.add(clientId);
      return;
    }

    const watcher = chokidar.watch(scopePath, {
      ignoreInitial: true,
      ignored: /node_modules|\.git/,
    });

    watcher.on('add', (path) => this.emit('tree:changed', { scope: scopePath, type: 'add', path }));
    watcher.on('unlink', (path) => this.emit('tree:changed', { scope: scopePath, type: 'unlink', path }));
    watcher.on('addDir', (path) => this.emit('tree:changed', { scope: scopePath, type: 'addDir', path }));
    watcher.on('unlinkDir', (path) => this.emit('tree:changed', { scope: scopePath, type: 'unlinkDir', path }));
    watcher.on('change', (path) => this.emit('file:changed', { scope: scopePath, path }));

    this.watchers.set(scopePath, { watcher, clients: new Set([clientId]) });
  }

  unwatchScope(scopePath: string, clientId: string) {
    const entry = this.watchers.get(scopePath);
    if (!entry) return;

    entry.clients.delete(clientId);
    if (entry.clients.size === 0) {
      entry.watcher.close();
      this.watchers.delete(scopePath);
    }
  }
}
```

**src/hooks/useDocs.ts changes**
```typescript
export function useDocs(scopePath: string | null): UseDocsResult {
  const { subscribe, unsubscribe, on, connected } = useEventSocket();

  // Subscribe to scope events when connected
  useEffect(() => {
    if (!connected || !scopePath) return;

    subscribe('tree', { scope: scopePath });
    subscribe('file', { scope: scopePath });

    const unsubTree = on('tree', 'changed', () => mutateTree());
    const unsubFile = on('file', 'changed', (data: { path: string }) => {
      if (data.path === selectedPath) mutateFile();
    });

    return () => {
      unsubscribe('tree');
      unsubscribe('file');
      unsubTree();
      unsubFile();
    };
  }, [connected, scopePath, selectedPath]);

  // Keep polling as fallback (30s when not connected)
  const treeRefreshInterval = connected ? 0 : 30000;
  // ... rest of hook
}
```

#### Tests - Phase 4

**Unit Tests: `server/watchers/__tests__/scope-watcher.test.ts`**
```typescript
describe('ScopeWatcher', () => {
  it('watches scope directory');
  it('shares watcher between multiple clients');
  it('emits tree:changed on file add/remove');
  it('emits tree:changed on directory add/remove');
  it('emits file:changed on file modification');
  it('cleans up watcher when all clients unsubscribe');
  it('ignores node_modules and .git');
});
```

**Unit Tests: `server/watchers/__tests__/inbox-watcher.test.ts`**
```typescript
describe('InboxWatcher', () => {
  it('watches inbox.md file');
  it('emits inbox:changed on modification');
  it('handles inbox file creation');
  it('handles inbox file deletion');
});
```

#### Chrome Verification - Phase 4

| # | Test | Steps | Expected | Pass |
|---|------|-------|----------|------|
| 1 | Tree updates on file add | Create file in scope | Tree updates instantly | [ ] |
| 2 | Tree updates on file delete | Delete file in scope | Tree updates instantly | [ ] |
| 3 | File content updates | Edit file externally | Content refreshes instantly | [ ] |
| 4 | Inbox updates | Edit inbox.md externally | Inbox refreshes instantly | [ ] |
| 5 | Fallback polling | Disconnect WebSocket | Falls back to 30s polling | [ ] |
| 6 | Multiple clients | Open 2 browser tabs | Both receive events | [ ] |
| 7 | Scope change | Change scope in UI | Subscribes to new scope | [ ] |

---

### Phase 5: Remove Polling, Final Cleanup

**Goal:** Remove polling fallbacks where events are reliable, optimize

#### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useSessions.ts` | Remove refreshInterval for sessions |
| `src/hooks/useDocs.ts` | Remove refreshInterval for tree/file |
| `src/hooks/useTreeSessions.ts` | Remove refreshInterval |
| `src/components/SessionCard.tsx` | Remove running indicator interval |

#### Changes

- Set `refreshInterval: 0` for event-driven data
- Keep revalidateOnFocus for manual refresh
- Add reconnection logic to re-fetch on WebSocket reconnect
- Monitor for missed events (sequence numbers or heartbeat)

#### Tests - Phase 5

**Integration Tests**
```typescript
describe('Event-driven data flow', () => {
  it('receives all session updates without polling');
  it('receives all tree updates without polling');
  it('handles WebSocket reconnection gracefully');
  it('re-fetches data on reconnection');
  it('detects and recovers from missed events');
});
```

**Performance Tests**
```typescript
describe('Performance', () => {
  it('handles 100 rapid file changes without lag');
  it('maintains <100ms latency from file change to UI');
  it('CPU usage stays low with no activity');
  it('memory stable with long-running session');
});
```

#### Chrome Verification - Phase 5

| # | Test | Steps | Expected | Pass |
|---|------|-------|----------|------|
| 1 | No polling requests | Check Network tab over 1 min | No periodic /api/* calls | [ ] |
| 2 | Events still work | Create/modify sessions | UI updates in <200ms | [ ] |
| 3 | Focus refresh | Switch away and back | Data refreshes on focus | [ ] |
| 4 | Reconnection | Kill/restart server | Reconnects, re-fetches | [ ] |
| 5 | Long session | Leave app open 1 hour | No degradation, no memory leak | [ ] |

---

## Test Summary

### Unit Tests (76 total)

| Category | Count | File |
|----------|-------|------|
| EventServer | 12 | `server/__tests__/event-server.test.ts` |
| useEventSocket | 10 | `src/hooks/__tests__/useEventSocket.test.ts` |
| deriveSessionState | 24 | `src/lib/__tests__/session-status.test.ts` |
| SessionWatcher | 12 | `server/watchers/__tests__/session-watcher.test.ts` |
| Board columns | 8 | `src/components/__tests__/Board.test.tsx` |
| SessionCard badge | 6 | `src/components/__tests__/SessionCard.test.tsx` |
| ScopeWatcher | 7 | `server/watchers/__tests__/scope-watcher.test.ts` |
| InboxWatcher | 4 | `server/watchers/__tests__/inbox-watcher.test.ts` |

### Integration Tests (8 total)

| Test | File |
|------|------|
| Event system end-to-end | `server/__tests__/event-integration.test.ts` |
| Event-driven data flow | `src/__tests__/event-flow.test.ts` |

### Chrome Verification (45 total)

| Phase | Count |
|-------|-------|
| Phase 1: WebSocket Infrastructure | 4 |
| Phase 2: Session Watcher | 8 |
| Phase 3: Column Structure | 12 |
| Phase 4: Docs & Inbox | 7 |
| Phase 5: Final Cleanup | 5 |
| Regression | 9 |

### Regression Tests

| # | Area | Test | Pass |
|---|------|------|------|
| 1 | Sessions | Create session, appears in correct column | [ ] |
| 2 | Sessions | Drag session between columns | [ ] |
| 3 | Sessions | Archive session | [ ] |
| 4 | Sessions | Search filters sessions | [ ] |
| 5 | Inbox | Create inbox item | [ ] |
| 6 | Inbox | Drag inbox item to reorder | [ ] |
| 7 | Docs | Navigate file tree | [ ] |
| 8 | Docs | Edit and save file | [ ] |
| 9 | Terminal | Open terminal, run command | [ ] |

---

## Rollback Strategy

### Phase-Level Rollback

Each phase is independently deployable and rollback-able:

1. **Phase 1**: Just remove WebSocket code, no behavior change
2. **Phase 2**: Keep derivedState, remove watcher, polling continues
3. **Phase 3**: Revert column config, derived status still computed
4. **Phase 4**: Re-enable polling intervals
5. **Phase 5**: Already done in Phase 4 rollback

### Feature Flags (Optional)

```typescript
const FEATURES = {
  EVENT_SOCKET: process.env.NEXT_PUBLIC_EVENT_SOCKET !== 'false',
  DERIVED_STATUS: process.env.NEXT_PUBLIC_DERIVED_STATUS !== 'false',
  ATTENTION_COLUMN: process.env.NEXT_PUBLIC_ATTENTION_COLUMN !== 'false',
};
```

---

## Timeline Estimate

| Phase | Complexity | Dependencies |
|-------|------------|--------------|
| Phase 1 | Medium | None |
| Phase 2 | High | Phase 1 |
| Phase 3 | Medium | Phase 2 |
| Phase 4 | Medium | Phase 1 |
| Phase 5 | Low | Phase 2, 4 |

**Critical Path:** Phase 1 → Phase 2 → Phase 3

**Parallel Work:** Phase 4 can start after Phase 1

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Can users drag out of Attention? | No - locked by derived state |
| Show empty Attention column? | Yes - always visible |
| Refresh mechanism? | Event-driven via chokidar + WebSocket |
| Migrate all polling? | Yes - unified event architecture |

---

## Files Changed Summary

### New Files (10)

| File | Purpose |
|------|---------|
| `server/event-server.ts` | WebSocket event server |
| `server/watchers/index.ts` | Watcher orchestration |
| `server/watchers/session-watcher.ts` | Session file watching |
| `server/watchers/scope-watcher.ts` | Scope directory watching |
| `server/watchers/inbox-watcher.ts` | Inbox file watching |
| `src/hooks/useEventSocket.ts` | Client WebSocket hook |
| `src/contexts/EventSocketContext.tsx` | WebSocket provider |
| `src/lib/session-status.ts` | Status derivation logic |
| `src/lib/__tests__/session-status.test.ts` | Status tests |
| `server/__tests__/event-server.test.ts` | Server tests |

### Modified Files (10)

| File | Changes |
|------|---------|
| `server/ws-server.ts` | Add /events endpoint |
| `package.json` | Add chokidar |
| `src/lib/types.ts` | Add derived state types |
| `src/lib/claude-sessions.ts` | Add incremental parsing |
| `src/hooks/useSessions.ts` | Event subscription |
| `src/hooks/useDocs.ts` | Event subscription |
| `src/components/Board.tsx` | New column structure |
| `src/components/Column.tsx` | Section support |
| `src/components/SessionCard.tsx` | Status badge |
| `src/lib/db.ts` | Status resolution |
