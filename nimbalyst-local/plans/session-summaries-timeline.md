# Session Summaries Timeline

## Overview

Add a third view mode to the session drawer that displays a timeline of Claude's automatic conversation summaries. These summaries exist in the JSONL session files and provide a high-level overview of what happened during a session.

## Current State

The `TerminalDrawer` component has two view modes:
- **Terminal**: Live terminal with xterm.js
- **Info**: Session details, resume command, metadata

JSONL files contain `summary` entries that look like:
```json
{"type":"summary","summary":"Claude Kanban Board App Setup","leafUuid":"..."}
```

Currently, only the **first** summary is extracted (used as session title). Multiple summaries can exist per session, appearing at various conversation milestones.

## Proposed Changes

### 1. New Type: SummaryEntry

```typescript
export interface SummaryEntry {
  summary: string;
  messageIndex: number;  // Position in conversation (messages before this summary)
}
```

### 2. New Function: getSummariesForSession

Location: `src/lib/claude-sessions.ts`

```typescript
export async function getSummariesForSession(sessionId: string): Promise<SummaryEntry[]>
```

Parses the JSONL and extracts ALL summary entries (not just the first). For each summary, attempts to infer a timestamp from the nearest message entry.

### 3. API Endpoint

Route: `GET /api/sessions/[id]/summaries`

Returns:
```json
{
  "summaries": [
    { "summary": "Project setup complete", "messageIndex": 0 },
    { "summary": "Added authentication flow", "messageIndex": 15 }
  ]
}
```

### 4. UI Changes

**TerminalDrawer.tsx**:
- Add third toggle button with `List` or `FileText` icon
- New `ViewMode`: `"terminal" | "info" | "summaries"`
- Header label: "Session Timeline" when summaries view is active

**New Component: SummaryTimeline.tsx**:
```
┌──────────────────────────────────────┐
│  Session Timeline                    │
├──────────────────────────────────────┤
│  ● Project setup complete            │
│    Start                             │
│    │                                 │
│  ● Added authentication flow         │
│    ~15 messages in                   │
│    │                                 │
│  ● Fixed login bug                   │
│    ~32 messages in                   │
│                                      │
└──────────────────────────────────────┘
```

Features:
- Vertical timeline with dots/connectors
- Summary text as primary content
- Message position indicator (e.g., "~15 messages in")
- Scrollable if many summaries

## Data Flow

```
User clicks Summaries tab
        ↓
SummaryTimeline component mounts
        ↓
useSWR fetches /api/sessions/[id]/summaries
        ↓
API calls getSummariesForSession(sessionId)
        ↓
Parses JSONL, extracts all summaries
        ↓
Renders timeline UI
```

## Files to Modify

| File | Changes |
| --- | --- |
| `src/lib/types.ts` | Add `SummaryEntry` interface |
| `src/lib/claude-sessions.ts` | Add `getSummariesForSession()` |
| `src/app/api/sessions/[id]/summaries/route.ts` | New API endpoint |
| `src/components/TerminalDrawer.tsx` | Add third view mode toggle |
| `src/components/SummaryTimeline.tsx` | New component (create) |

## Decisions

1. **Timestamp inference**: Show message position instead (e.g., "~15 messages in"). No timestamp inference.

2. **Empty state**: Show "No summaries yet" with muted text.

3. **Loading state**: Simple spinner while fetching.

4. **Caching**: No caching initially. Can add later once implementation is stable.

## Status

- [x] Scope approved
- [ ] Implementation started
- [ ] Testing complete
