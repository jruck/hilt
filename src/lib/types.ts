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
  availableWeeks: string[];// All weeks in lists/now, newest first
  latestWeek: string;      // The most recent week (for detecting preview mode)
}

export type BridgeProjectStatus = "considering" | "refining" | "doing" | "done";

export interface BridgeProject {
  slug: string;            // Folder name
  path: string;            // Absolute path to project folder
  relativePath: string;    // Path relative to vault root (e.g., "projects/slug" or "libraries/everpro/projects/slug")
  title: string;           // H1 from index.md, or folder name fallback
  status: BridgeProjectStatus;
  area: string;
  tags: string[];
  icon: string;            // Emoji icon from frontmatter (empty string if none)
  source: string;          // Display group (e.g., "Projects", "EverPro", "Ventures")
  description: string;     // Body text from index.md (post-frontmatter, minus H1)
}

export interface BridgeProjectsResponse {
  vaultPath: string;       // Absolute path to the bridge vault root
  columns: Record<BridgeProjectStatus, BridgeProject[]>;
}

// ============ Bridge Thoughts Types ============

export type BridgeThoughtStatus = "next" | "later";

export interface BridgeThought {
  slug: string;            // Folder name
  path: string;            // Absolute path to thought folder
  relativePath: string;    // Path relative to vault root
  title: string;           // H1 from index.md, or folder name fallback
  status: BridgeThoughtStatus;
  icon: string;            // Emoji icon from frontmatter (empty string if none)
  created: string;         // ISO date string from frontmatter
  description: string;     // Body text from index.md (post-frontmatter, minus H1)
}

export interface BridgeThoughtsResponse {
  vaultPath: string;
  columns: Record<BridgeThoughtStatus, BridgeThought[]>;
}
