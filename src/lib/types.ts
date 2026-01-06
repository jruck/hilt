import { z } from "zod";

// Status for our kanban board
export type SessionStatus = "inbox" | "active" | "recent";

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
  slug: string | null;  // Claude Code's internal session name (e.g., "dynamic-tickling-thunder")
  slugs: string[];      // All slugs used during session (slug can change mid-session, e.g., when entering plan mode)
}

// Isolation state for worktree-based sessions
export interface SessionIsolation {
  enabled: true;
  workspacePath: string;      // ~/.claude-kanban/workspaces/<id>/workspace
  sourcePath: string;         // Original project path
  branchName: string;         // claude-kanban/<session-id-short>
  baseBranch: string;         // Branch we forked from (usually main)
  baseCommit: string;         // Commit SHA we forked from
  createdAt: string;
}

// Session with status from our database
export interface Session extends SessionMetadata {
  status: SessionStatus;
  sortOrder?: number;
  starred?: boolean;
  // For new sessions started from inbox
  isNew?: boolean;
  initialPrompt?: string;
  // Worktree isolation
  isolation?: SessionIsolation;
  // Live running indicator (based on file modification time)
  isRunning?: boolean;
  // Slugs that have associated plan files
  planSlugs?: string[];
  // Open in plan mode (resume with plan editing)
  planMode?: boolean;
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
