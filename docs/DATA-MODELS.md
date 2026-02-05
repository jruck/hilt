# Data Models Reference

This document describes all data structures used in Hilt.

## Core Types

### FileNode

Represents a file or directory in the Docs view file tree.

```typescript
interface FileNode {
  name: string;           // Display name (e.g., "README.md")
  path: string;           // Absolute path
  type: "file" | "directory";
  children?: FileNode[];  // Only for directories
  extension?: string;     // e.g., "md", "ts", "png"
  size?: number;          // File size in bytes
  modTime: number;        // Unix timestamp (ms)
  ignored?: boolean;      // True for macOS system folders, cloud sync, etc.
}
```

### BridgeTask

A single task item parsed from a weekly markdown file.

```typescript
interface BridgeTask {
  id: string;              // "task-0", "task-1", ...
  title: string;           // Display text only (no markdown link syntax)
  done: boolean;           // [x] vs [ ]
  details: string[];       // Indented sub-bullet lines (raw markdown)
  rawLines: string[];      // All lines in this task block
  projectPath: string | null;  // Relative path from vault root, or null
}
```

### BridgeWeekly

Parsed representation of a weekly markdown file from the Bridge vault.

```typescript
interface BridgeWeekly {
  filename: string;        // "2026-01-27.md"
  week: string;            // "2026-01-27" from frontmatter
  needsRecycle: boolean;   // Current date in newer ISO week
  tasks: BridgeTask[];
  notes: string;           // Raw markdown of ## Notes section
  vaultPath: string;       // Absolute path to vault root
  filePath: string;        // Absolute path to the weekly .md file
  availableWeeks: string[];// All weeks in lists/now, newest first
  latestWeek: string;      // The most recent week (for detecting preview mode)
}
```

### BridgeProject

A project folder parsed from the Bridge vault.

```typescript
type BridgeProjectStatus = "considering" | "refining" | "doing" | "done";

interface BridgeProject {
  slug: string;            // Folder name
  path: string;            // Absolute path to project folder
  relativePath: string;    // Path relative to vault root (e.g., "projects/slug")
  title: string;           // H1 from index.md, or folder name fallback
  status: BridgeProjectStatus;
  area: string;
  tags: string[];
  source: string;          // Display group (e.g., "Projects", "EverPro", "Ventures")
}

interface BridgeProjectsResponse {
  vaultPath: string;       // Absolute path to the bridge vault root
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
}
```

### PinnedFolder

A folder pinned to the sidebar for quick access.

```typescript
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

## Persistence Formats

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

  viewMode: "docs" | "stack" | "bridge" | "chat";
  // Current view mode

  folderEmojis?: Record<string, string>;
  // Separate storage for folder emojis by path
  // Persists across unpin/re-pin

  inboxPath?: string;
  // Global inbox folder path for quick capture

  bridgeVaultPath?: string;
  // Bridge vault path for weekly tasks and projects

  workingFolder?: string;
  // Default working folder — used as initial scope for Docs, Stack, and Bridge views

  chatAgent?: string;
  // Chat view: last used agent label

  chatSessionKey?: string;
  // Chat view: session key for continuity across app restarts
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

## API Response Types

### DocsTreeResponse

Returned by the `/api/docs/tree` endpoint. Provides the file tree for a given scope.

```typescript
interface DocsTreeResponse {
  root: FileNode;
  scope: string;
  modTime: number;        // Latest modTime across all files (for change detection)
}
```

### DocsFileResponse

Returned by the `/api/docs/file` endpoint. Provides file content and metadata.

```typescript
interface DocsFileResponse {
  path: string;
  content: string | null;  // null for binary files
  isBinary: boolean;
  isViewable: boolean;     // true for markdown, txt, code files
  mimeType: string;
  size: number;
  modTime: number;
}
```

### DocsSaveRequest / DocsSaveResponse

Used by the `/api/docs/file` POST endpoint to save file changes.

```typescript
interface DocsSaveRequest {
  path: string;
  content: string;
  scope: string;  // For validation
}

interface DocsSaveResponse {
  success: boolean;
  modTime: number;
  error?: string;
}
```

## localStorage Keys

Browser-side persistence (limited -- most preferences now server-side).

| Key | Type | Description |
|-----|------|-------------|
| `hilt-home-dir` | `string` | Cached home directory path |

**Note**: View mode, recent scopes, pinned folders, sidebar state, and theme are now stored server-side in `data/preferences.json` to persist across Electron rebuilds.

---

*Last updated: 2026-02-05*
