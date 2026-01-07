# API Reference

All API routes are Next.js App Router API routes under `src/app/api/`.

## Sessions

**File**: `src/app/api/sessions/route.ts`

### GET /api/sessions

List and filter sessions with optional tree structure.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | string | - | Filter by project path |
| `mode` | `"exact"` \| `"tree"` | `"exact"` | Filtering mode |
| `page` | number | 1 | Pagination page |
| `pageSize` | number | 50 | Items per page |

**Mode Behavior**
- `exact`: Only sessions where `projectPath === scope`
- `tree`: All sessions where `projectPath.startsWith(scope)` (includes subfolders)

**Response**

```typescript
{
  sessions: Session[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    inbox: number;
    active: number;
    recent: number;
  };
  tree?: TreeNode;  // Only when mode=tree
}
```

**Example**

```bash
curl "http://localhost:3000/api/sessions?scope=/Users/jruck/Work/Code/myproject&mode=exact"
```

### PATCH /api/sessions

Update session status, sort order, or starred state.

**Request Body**

```typescript
{
  sessionId: string;       // Required
  status?: "inbox" | "active" | "recent";
  sortOrder?: number;
  starred?: boolean;
}
```

**Response**

```typescript
{ success: true }
```

**Example**

```bash
curl -X PATCH http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "abc-123", "status": "active"}'
```

---

## Inbox (Draft Prompts)

**File**: `src/app/api/inbox/route.ts`

Manages draft prompts stored in `Todo.md` files.

### GET /api/inbox

List all draft prompts for a scope.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Project path (uses `{scope}/docs/Todo.md`) |
| `lastModTime` | number | For polling - skip if unchanged |

**Response**

```typescript
{
  items: Array<{
    id: string;
    prompt: string;
    completed: boolean;
    section: string | null;  // Markdown heading group
    projectPath: string | null;
    createdAt: string;
    sortOrder: number;
  }>;
  sections: Array<{
    heading: string;
    level: number;
  }>;
  lastModTime: number | null;
}
```

### POST /api/inbox

Create a new draft prompt.

**Request Body**

```typescript
{
  prompt: string;          // Required
  section?: string | null; // Target section heading
  scope?: string;          // Project path
}
```

**Response**

```typescript
{ id: string; success: true }
```

### PATCH /api/inbox

Update an existing draft.

**Request Body**

```typescript
{
  id: string;              // Required
  prompt?: string;
  completed?: boolean;
  section?: string | null;
  scope?: string;
}
```

### DELETE /api/inbox

Delete a draft prompt.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Required - Item ID |
| `scope` | string | Project path |

### PUT /api/inbox

Reorder sections or items within the Todo.md file.

**Request Body (Section Reorder)**

```typescript
{
  sectionOrder: string[];  // Headings in new order
  scope?: string;
}
```

**Request Body (Item Reorder)**

```typescript
{
  itemReorder: {
    itemId: string;
    targetSection: string | null;
    targetIndex: number;
  };
  scope?: string;
}
```

---

## Folders

**File**: `src/app/api/folders/route.ts`

Browse project folders and validate paths.

### GET /api/folders

List project folders that have Claude sessions.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Filter to children of this path |
| `validate` | string | Check if specific path exists |

**Response (List)**

```typescript
{
  folders: string[];  // Decoded paths sorted by depth
  homeDir: string;    // User's home directory
}
```

**Response (Validate)**

```typescript
{
  path: string;
  exists: boolean;
  isDirectory: boolean;
  valid: boolean;  // exists && isDirectory
}
```

### POST /api/folders

Open native macOS folder picker dialog.

**Response**

```typescript
{ path: string }
// or
{ cancelled: true }
```

---

## Plans

**File**: `src/app/api/plans/[slug]/route.ts`

Read and write plan markdown files stored in `~/.claude/plans/`.

### GET /api/plans/[slug]

Read a plan file by slug.

**Response (Exists)**

```typescript
{
  exists: true;
  slug: string;
  content: string;
  path: string;
}
```

**Response (Not Found)**

```typescript
{
  exists: false;
  slug: string;
}
```

### PUT /api/plans/[slug]

Write or update a plan file.

**Request Body**

```typescript
{
  content: string;
}
```

**Response**

```typescript
{
  success: true;
  slug: string;
  path: string;
}
```

---

## Utility Routes

### GET /api/cwd

**File**: `src/app/api/cwd/route.ts`

Get current working directory.

**Response**

```typescript
{ cwd: string }
```

### POST /api/reveal

**File**: `src/app/api/reveal/route.ts`

Open a path in macOS Finder.

**Request Body**

```typescript
{ path: string }
```

**Response**

```typescript
{ success: true }
```

### GET /api/inbox-counts

**File**: `src/app/api/inbox-counts/route.ts`

Get inbox item counts grouped by scope.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | Base scope path |

**Response**

```typescript
{
  counts: Record<string, number>;  // path → count
}
```

---

## External Integration Routes

### POST /api/firecrawl

**File**: `src/app/api/firecrawl/route.ts`

Scrape and extract content from URLs using Firecrawl service.

**Request Body**

```typescript
{
  url: string;
}
```

**Response**

```typescript
{
  content: string;
  title?: string;
  url: string;
}
```

### GET /api/youtube-transcript

**File**: `src/app/api/youtube-transcript/route.ts`

Fetch transcript for a YouTube video.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `videoId` | string | YouTube video ID |

**Response**

```typescript
{
  transcript: string;
  videoId: string;
}
```

---

## WebSocket Protocol

**Server**: `ws://localhost:3001` (configurable via `WS_PORT`)

**File**: `server/ws-server.ts`

### Client → Server Messages

**Spawn Terminal**
```typescript
{
  type: "spawn";
  terminalId: string;   // Stable ID for terminal tracking
  sessionId: string;    // Claude session UUID
  projectPath?: string; // Working directory
  isNew?: boolean;      // Start new session vs resume
  initialPrompt?: string; // Auto-inject prompt for new sessions
}
```

**Send Input**
```typescript
{
  type: "data";
  terminalId: string;
  data: string;  // Keystrokes/input
}
```

**Resize Terminal**
```typescript
{
  type: "resize";
  terminalId: string;
  cols: number;
  rows: number;
}
```

**Kill Terminal**
```typescript
{
  type: "kill";
  terminalId: string;
}
```

### Server → Client Messages

**Spawned**
```typescript
{ type: "spawned"; terminalId: string }
```

**Data Output**
```typescript
{ type: "data"; terminalId: string; data: string }
```

**Title Change** (from OSC sequences)
```typescript
{ type: "title"; terminalId: string; title: string }
```

**Context Progress**
```typescript
{ type: "context"; terminalId: string; progress: number }
```

**Exit**
```typescript
{ type: "exit"; terminalId: string; exitCode: number }
```

**Plan Events** (file watcher)
```typescript
{
  type: "plan";
  event: "created" | "updated";
  slug: string;
  path: string;
  content: string;
}
```

**Error**
```typescript
{ type: "error"; message: string }
```

---

## Error Responses

All routes return errors in this format:

```typescript
{
  error: string;
}
```

Common HTTP status codes:
- `400` - Bad request (missing/invalid parameters)
- `500` - Server error

---

*Last updated: 2025-01-06*
