# Data Models Reference

This document describes all data structures used in Hilt.

## Core Types

### Session

The primary data structure representing a Claude Code session.

```typescript
interface Session {
  // === From Claude JSONL Files ===

  id: string;
  // UUID from JSONL filename (e.g., "abc12345-1234-5678-9abc-def012345678")

  title: string;
  // First summary or truncated first prompt

  project: string;
  // Encoded project path (e.g., "-Users-jruck-Work-Code-myproject")

  projectPath: string;
  // Decoded project path (e.g., "/Users/jruck/Work/Code/myproject")

  lastActivity: Date;
  // Timestamp of most recent JSONL entry

  messageCount: number;
  // Total user + assistant messages

  gitBranch: string | null;
  // Most recent git branch from session entries

  firstPrompt: string | null;
  // First user message content

  lastPrompt: string | null;
  // Most recent user message content

  slug: string | null;
  // Claude's internal session name (e.g., "dynamic-tickling-thunder")
  // Can change mid-session (e.g., when entering plan mode)

  slugs: string[];
  // All slugs used during session lifetime
  // Used to find associated plan files

  // === From Kanban Database ===

  status: SessionStatus;
  // "inbox" | "active" | "recent"
  // Determines which column the session appears in

  sortOrder?: number;
  // Manual ordering within column (lower = higher)

  starred?: boolean;
  // Pinned to top of Recent column

  // === Runtime State ===

  isNew?: boolean;
  // Session was just started from an inbox draft

  initialPrompt?: string;
  // Prompt to auto-inject when starting new session

  terminalId?: string;
  // Stable ID for terminal tracking
  // IMPORTANT: Use this (not sessionId) as React key
  // Prevents terminal reload when temp ID → real ID

  isRunning?: boolean;
  // JSONL file modified within 30 seconds
  // Used for live indicator and auto-promote to active

  planSlugs?: string[];
  // Which of this session's slugs have plan files
  // Found by checking ~/.claude/plans/{slug}.md

  planMode?: boolean;
  // Open session in plan editor instead of terminal
}

type SessionStatus = "inbox" | "active" | "recent";
```

### TreeNode

Hierarchical structure for Tree View.

```typescript
interface TreeNode {
  path: string;
  // Full folder path (e.g., "/Users/jruck/Work/Code")

  name: string;
  // Display name - last path segment (e.g., "Code")

  depth: number;
  // Depth from current scope root (0 = scope itself)

  sessions: Session[];
  // Sessions where projectPath === this.path (not descendants)

  children: TreeNode[];
  // Child folder nodes

  metrics: TreeMetrics;
  // Rolled-up statistics from all descendants
}

interface TreeMetrics {
  totalSessions: number;
  // All sessions in this node + descendants

  directSessions: number;
  // Sessions in this exact folder only

  activeCount: number;
  // Sessions with status === "active"

  inboxCount: number;
  // Sessions with status === "inbox"

  recentCount: number;
  // Sessions with status === "recent"

  runningCount: number;
  // Sessions with isRunning === true

  lastActivity: number;
  // Timestamp (ms) of most recent session activity

  heatScore: number;
  // Computed sizing metric for treemap
  // Higher = larger rectangle

  normalizedHeat?: number;
  // 0-1 normalized for color mapping
}
```

### InboxItem

Draft prompt waiting to be started as a session.

```typescript
interface InboxItem {
  id: string;
  // UUID generated when created

  prompt: string;
  // The draft prompt text

  projectPath: string | null;
  // Target project path (null = current scope)

  createdAt: Date;
  // When the draft was created

  sortOrder: number;
  // Manual ordering within inbox
}
```

## JSONL Entry Types

Claude Code writes session data to JSONL files in `~/.claude/projects/{encoded-path}/`.

### Summary Entry

Created during context compression.

```typescript
interface SummaryEntry {
  type: "summary";
  summary: string;
  // Compressed summary of conversation so far

  leafUuid?: string;
  // UUID of the message this summarizes up to
}
```

### User Entry

User message in the conversation.

```typescript
interface UserEntry {
  type: "user";
  timestamp: string;
  // ISO 8601 timestamp

  sessionId: string;
  // Session UUID

  message: {
    content: string;
    role: "user";
  };

  gitBranch?: string;
  // Git branch at time of message

  uuid?: string;
  // Message UUID

  cwd?: string;
  // Working directory
}
```

### Assistant Entry

Claude's response.

```typescript
interface AssistantEntry {
  type: "assistant";
  timestamp: string;
  sessionId?: string;
  message?: any;
  // Complex structure with tool calls, etc.

  gitBranch?: string;
  uuid?: string;
}
```

### File History Snapshot

Snapshot of file state (parsed but not used).

```typescript
interface FileHistorySnapshot {
  type: "file-history-snapshot";
  // Additional fields not parsed
}
```

## Persistence Formats

### session-status.json

Stored in `data/session-status.json`.

```typescript
interface SessionStatusDB {
  [sessionId: string]: {
    status: SessionStatus;
    sortOrder?: number;
    starred?: boolean;
    lastKnownMtime?: number;
    // File mtime when marked as "recent"
    // Used to detect new activity after marking done
  };
}
```

### inbox.json (Fallback)

Stored in `data/inbox.json` when no Todo.md exists.

```typescript
interface InboxDB {
  items: Array<{
    id: string;
    prompt: string;
    projectPath: string | null;
    createdAt: string;  // ISO timestamp
    sortOrder: number;
  }>;
}
```

### preferences.json

Stored in `data/preferences.json`. Persists user preferences across app restarts and Electron rebuilds.

```typescript
interface UserPreferences {
  pinnedFolders: PinnedFolder[];
  // Folders pinned to sidebar for quick access

  sidebarCollapsed: boolean;
  // Whether sidebar is collapsed or expanded

  theme: "light" | "dark" | "system";
  // UI theme preference

  recentScopes: string[];
  // Last 10 visited folder paths (most recent first)

  viewMode: "board" | "tree" | "docs";
  // Current view mode
}

interface PinnedFolder {
  id: string;
  // Unique identifier (timestamp + random)

  path: string;
  // Full folder path

  name: string;
  // Display name (last path segment)

  pinnedAt: number;
  // Timestamp for ordering
}
```

**Note**: Preferences were previously stored in localStorage, which would be cleared when Electron app cache was rebuilt. Server-side storage ensures persistence.

### Todo.md Format

Primary inbox storage when project has a `docs/Todo.md` file.

```markdown
# Section Heading

- [ ] Uncompleted item with id <!-- id:abc123 -->
- [x] Completed item <!-- id:def456 -->

## Subsection

- [ ] Another item <!-- id:ghi789 -->
```

Parsing rules:
- `#` headings create sections
- `- [ ]` creates uncompleted item
- `- [x]` creates completed item
- `<!-- id:xxx -->` contains item ID (auto-generated if missing)
- Items before first heading are "orphans"

## localStorage Keys

Browser-side persistence (limited - most preferences now server-side).

| Key | Type | Description |
|-----|------|-------------|
| `hilt-home-dir` | `string` | Cached home directory path |

**Note**: View mode, recent scopes, pinned folders, sidebar state, and theme are now stored server-side in `data/preferences.json` to persist across Electron rebuilds.

## API Response Types

### SessionsResponse

```typescript
interface SessionsResponse {
  sessions: Session[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    inbox: number;
    active: number;
    recent: number;
  };
}
```

### TreeSessionsResponse

```typescript
interface TreeSessionsResponse extends SessionsResponse {
  tree: TreeNode;
}
```

### StatusUpdateRequest

```typescript
interface StatusUpdateRequest {
  sessionId: string;
  status?: SessionStatus;
  sortOrder?: number;
  starred?: boolean;
}
```

## Zod Schemas

Located in `src/lib/types.ts`.

```typescript
import { z } from "zod";

// JSONL entry validation
export const SummaryEntrySchema = z.object({
  type: z.literal("summary"),
  summary: z.string(),
  leafUuid: z.string().optional(),
});

export const MessageContentSchema = z.object({
  content: z.string(),
  role: z.enum(["user", "assistant"]),
});

export const UserEntrySchema = z.object({
  type: z.literal("user"),
  timestamp: z.string(),
  sessionId: z.string(),
  gitBranch: z.string().optional(),
  message: MessageContentSchema,
  uuid: z.string().optional(),
  cwd: z.string().optional(),
});

export const AssistantEntrySchema = z.object({
  type: z.literal("assistant"),
  timestamp: z.string(),
  sessionId: z.string().optional(),
  gitBranch: z.string().optional(),
  message: z.any().optional(),
  uuid: z.string().optional(),
});

export const SessionEntrySchema = z.discriminatedUnion("type", [
  SummaryEntrySchema,
  UserEntrySchema,
  AssistantEntrySchema,
  z.object({ type: z.literal("file-history-snapshot") }).passthrough(),
]);
```

## Heat Score Algorithm

```typescript
// From src/lib/heat-score.ts

function calculateHeatScore(sessions: Session[]): number {
  if (sessions.length === 0) return 0;

  // Recency: exponential decay
  const mostRecent = Math.max(...sessions.map(s => s.lastActivity.getTime()));
  const daysSince = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-daysSince / 7); // Half-life ~5 days

  // Volume: log scale
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
  const volumeScore = Math.log10(totalMessages + 1) / 3;

  // Running bonus
  const hasRunning = sessions.some(s => s.isRunning);
  const runningBonus = hasRunning ? 0.2 : 0;

  // Weighted combination
  return 0.6 * recencyScore + 0.3 * volumeScore + runningBonus;
}
```

## Path Encoding/Decoding

Claude Code encodes paths by replacing `/` with `-`.

```typescript
// Encoded: "-Users-jruck-Work-Code-my-project"
// Decoded: "/Users/jruck/Work/Code/my-project"

// Challenge: folder names can contain hyphens
// Solution: check filesystem to find valid path
// See: src/app/api/folders/route.ts:decodePath()
```

---

*Last updated: 2025-01-06*
