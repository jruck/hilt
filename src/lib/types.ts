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
  dueDate: string | null;      // YYYY-MM-DD from [due:: ...] inline field
}

export interface BridgeWeekly {
  filename: string;        // "2026-01-27.md"
  week: string;            // "2026-01-27" from frontmatter
  needsRecycle: boolean;   // Current date in newer ISO week
  tasks: BridgeTask[];
  accomplishments: string; // Raw markdown of ## Accomplishments section
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

// ============ People Types ============

export interface BridgePerson {
  slug: string;              // Filename without .md (e.g., "amrit")
  name: string;              // H1 from file (e.g., "Amrit")
  type: "person" | "group";  // From frontmatter type field
  description: string;       // From index.md descriptions (e.g., "Product counterpart")
  nextTopics: string[];      // Bullet items from ## Next section
  meetingCount: number;       // Number of linked meetings (inline + Granola)
  lastMeetingDate: string | null;  // ISO date of most recent meeting
  created: string;           // From frontmatter
  updated: string;           // From frontmatter
}

export interface PersonMeeting {
  source: "inline" | "granola" | "next";  // Where it came from
  date: string;                    // ISO date (YYYY-MM-DD)
  title: string;                   // Meeting title or "Notes" for inline
  // For inline meetings (from ## Notes):
  notes?: string;                  // Raw markdown of the dated section
  // For Granola meetings:
  filePath?: string;               // Path to meeting .md file
  transcriptPath?: string;         // Path to transcript file
  summary?: string;                // Full meeting body (markdown)
}

export interface PersonDetail extends BridgePerson {
  nextRaw: string;                 // Raw markdown of ## Next section
  nextDate: string | null;         // YYYY-MM-DD from "date: ..." line in ## Next, or null
  meetings: PersonMeeting[];       // Sorted timeline (newest first), not merged
  personFilePath: string;          // Absolute path to person .md file (for editing)
}

export interface BridgePeopleResponse {
  vaultPath: string;
  people: BridgePerson[];          // Flat list, not columns
}
