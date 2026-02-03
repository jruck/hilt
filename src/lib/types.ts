import { z } from "zod";

// Status for our kanban board (persisted user workflow state)
export type SessionStatus = "inbox" | "active" | "recent";

// Column IDs for the board (includes virtual "attention" column)
export type ColumnId = SessionStatus | "attention";

// Derived status from JSONL parsing (real-time session state)
export type DerivedStatus = "working" | "waiting_for_approval" | "waiting_for_input" | "idle";

// Pending tool use info for approval status
export interface PendingToolUse {
  id: string;
  name: string;
}

// Derived session state from analyzing JSONL entries
export interface DerivedSessionState {
  status: DerivedStatus;
  pendingToolUses: PendingToolUse[];
  lastActivityTime: number;  // Unix timestamp (ms)
  isRunning: boolean;
  isIdle: boolean;  // True if 5+ minutes since last activity (separate from status)
  lastMessage: string | null;  // Most recent message (user or assistant text)
}

// Zod schemas for Claude Code JSONL format
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

// Union of all entry types we care about
export const SessionEntrySchema = z.discriminatedUnion("type", [
  SummaryEntrySchema,
  UserEntrySchema,
  AssistantEntrySchema,
  // Catch-all for other types we don't need to parse fully
  z.object({ type: z.literal("file-history-snapshot") }).passthrough(),
]);

// Session metadata extracted from JSONL files
export interface SessionMetadata {
  id: string;
  title: string;
  project: string;
  projectPath: string;
  lastActivity: Date;
  messageCount: number;
  gitBranch: string | null;
  firstPrompt: string | null;
  lastPrompt: string | null;  // Most recent user prompt
  lastMessage: string | null;  // Most recent message (user or assistant)
  slug: string | null;  // Claude Code's internal session name (e.g., "dynamic-tickling-thunder")
  slugs: string[];      // All slugs used during session (slug can change mid-session, e.g., when entering plan mode)
}

// Isolation state for worktree-based sessions
export interface SessionIsolation {
  enabled: true;
  workspacePath: string;      // ~/.hilt/workspaces/<id>/workspace
  sourcePath: string;         // Original project path
  branchName: string;         // hilt/<session-id-short>
  baseBranch: string;         // Branch we forked from (usually main)
  baseCommit: string;         // Commit SHA we forked from
  createdAt: string;
}

// Session with status from our database
export interface Session extends SessionMetadata {
  status: SessionStatus;
  sortOrder?: number;
  starred?: boolean;
  archived?: boolean;  // Hidden from default views, shown when "Show Archived" is enabled
  // For new sessions started from inbox
  isNew?: boolean;
  initialPrompt?: string;
  // Stable ID for terminal tracking - doesn't change when temp session gets real ID
  terminalId?: string;
  // Worktree isolation
  isolation?: SessionIsolation;
  // Live running indicator (based on file modification time)
  isRunning?: boolean;
  // Derived state from JSONL analysis (tool_use/tool_result tracking)
  derivedState?: DerivedSessionState;
  // Slugs that have associated plan files
  planSlugs?: string[];
  // Open in plan mode (resume with plan editing)
  planMode?: boolean;
  // Ralph Wiggum loop state
  ralphLoop?: RalphLoopState;
}

// Inbox item (draft prompt)
export interface InboxItem {
  id: string;
  prompt: string;
  projectPath: string | null;
  createdAt: Date;
  sortOrder: number;
}

// Summary entry for timeline display
export interface SummaryEntry {
  summary: string;
  messageIndex: number;  // Position in conversation (messages before this summary)
}

// API response types
export interface SessionsResponse {
  sessions: Session[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    inbox: number;
    active: number;
    recent: number;
    archived: number;  // Total archived (always shown, even when filtered out)
  };
}

export interface StatusUpdateRequest {
  sessionId: string;
  status?: SessionStatus;
  sortOrder?: number;
  starred?: boolean;
}

// ============ Tree View Types ============

export interface TreeMetrics {
  totalSessions: number;      // All sessions in this node + descendants
  directSessions: number;     // Sessions in this exact folder only
  activeCount: number;        // status === "active"
  inboxCount: number;         // status === "inbox"
  recentCount: number;        // status === "recent"
  runningCount: number;       // isRunning === true
  lastActivity: number;       // Timestamp (ms)
  heatScore: number;          // Computed sizing metric
  normalizedHeat?: number;    // 0-1 normalized for color mapping
}

export interface TreeNode {
  path: string;               // Full folder path
  name: string;               // Display name (last segment)
  depth: number;              // Depth from current scope root

  // Direct data
  sessions: Session[];        // Sessions where projectPath === this.path
  children: TreeNode[];       // Child folder nodes

  // Rolled-up metrics (includes all descendants)
  metrics: TreeMetrics;
}

export interface TreeSessionsResponse extends SessionsResponse {
  tree: TreeNode;
}

// ============ Docs Viewer Types ============

export interface FileNode {
  name: string;           // Display name (e.g., "README.md")
  path: string;           // Absolute path
  type: "file" | "directory";
  children?: FileNode[];  // Only for directories
  extension?: string;     // e.g., "md", "ts", "png"
  size?: number;          // File size in bytes
  modTime: number;        // Unix timestamp (ms)
  ignored?: boolean;      // True for macOS system folders, cloud sync, etc.
}

export interface DocsTreeResponse {
  root: FileNode;
  scope: string;
  modTime: number;        // Latest modTime across all files (for change detection)
}

export interface DocsFileResponse {
  path: string;
  content: string | null;  // null for binary files
  isBinary: boolean;
  isViewable: boolean;     // true for markdown, txt, code files
  mimeType: string;
  size: number;
  modTime: number;
}

export interface DocsSaveRequest {
  path: string;
  content: string;
  scope: string;  // For validation
}

export interface DocsSaveResponse {
  success: boolean;
  modTime: number;
  error?: string;
}

// ============ Ralph Wiggum Loop Types ============

// Ralph loop configuration
export interface RalphConfig {
  prompt: string;
  maxIterations: number;
  completionPromise: string;
}

// Ralph loop state for active sessions
export interface RalphLoopState {
  active: boolean;
  currentIteration: number;
  maxIterations: number;
  completionPromise: string;
  startedAt: string;
}

// ============ Bridge View Types ============

export interface BridgeTask {
  id: string;              // "task-0", "task-1", ...
  title: string;           // Display text only (no markdown link syntax)
  done: boolean;           // [x] vs [ ]
  details: string[];       // Indented sub-bullet lines (raw markdown)
  rawLines: string[];      // All lines in this task block
  projectPath: string | null;  // Relative path from vault root, or null
}

export interface BridgeWeekly {
  filename: string;        // "2026-01-27.md"
  week: string;            // "2026-01-27" from frontmatter
  needsRecycle: boolean;   // Current date in newer ISO week
  tasks: BridgeTask[];
  notes: string;           // Raw markdown of ## Notes section
  vaultPath: string;       // Absolute path to vault root
  filePath: string;        // Absolute path to the weekly .md file
}

export type BridgeProjectStatus = "thinking" | "refining" | "doing" | "done";

export interface BridgeProject {
  slug: string;            // Folder name
  path: string;            // Absolute path to project folder
  relativePath: string;    // Path relative to vault root (e.g., "projects/slug" or "libraries/everpro/projects/slug")
  title: string;           // H1 from index.md, or folder name fallback
  status: BridgeProjectStatus;
  area: string;
  tags: string[];
  source: string;          // Display group (e.g., "Projects", "EverPro", "Ventures")
}

export interface BridgeProjectsResponse {
  vaultPath: string;       // Absolute path to the bridge vault root
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
}
