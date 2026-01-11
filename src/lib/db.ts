import * as fs from "fs";
import * as path from "path";
import { SessionStatus } from "./types";
import { getCachedStatus, setCachedStatus, invalidateStatusCache } from "./session-cache";

// Use DATA_DIR env var if set, otherwise use local ./data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const STATUS_FILE = path.join(DATA_DIR, "session-status.json");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");
const PREFERENCES_FILE = path.join(DATA_DIR, "preferences.json");

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Get file mtime for cache validation
function getStatusFileMtime(): number {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return fs.statSync(STATUS_FILE).mtime.getTime();
    }
  } catch {
    // Ignore errors
  }
  return 0;
}

// Status storage
interface StatusRecord {
  status: SessionStatus;
  sortOrder: number;
  starred?: boolean;
  updatedAt: string;
  // When set to "recent", store the JSONL mtime so we only auto-promote
  // back to "active" if there's NEW activity after marking done
  lastKnownMtime?: number;
  // Archival state - hidden from default views
  archived?: boolean;
  archivedAt?: string;  // ISO timestamp of when archived
}

interface StatusData {
  [sessionId: string]: StatusRecord;
}

function readStatusFile(): StatusData {
  ensureDataDir();
  if (!fs.existsSync(STATUS_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(STATUS_FILE, "utf-8");
    const data = JSON.parse(content) as StatusData;

    // Migrate old statuses to new "recent" status
    let needsWrite = false;
    for (const [sessionId, record] of Object.entries(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = record.status as any;
      if (status === "inactive") {
        // Saved sessions become starred in recent
        record.status = "recent";
        record.starred = true;
        needsWrite = true;
      } else if (status === "done") {
        // Done sessions become unstarred in recent
        record.status = "recent";
        record.starred = false;
        needsWrite = true;
      }
    }

    // Write back migrated data
    if (needsWrite) {
      writeStatusFile(data);
    }

    return data;
  } catch {
    return {};
  }
}

function writeStatusFile(data: StatusData) {
  ensureDataDir();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
  // Invalidate cache after write
  invalidateStatusCache();
}

export async function getSessionStatus(
  sessionId: string
): Promise<{ status: SessionStatus; sortOrder: number; starred?: boolean } | null> {
  const data = readStatusFile();
  const record = data[sessionId];
  if (!record) return null;
  return { status: record.status, sortOrder: record.sortOrder, starred: record.starred };
}

export async function setSessionStatus(
  sessionId: string,
  status?: SessionStatus,
  sortOrder?: number,
  starred?: boolean,
  lastKnownMtime?: number
): Promise<void> {
  const data = readStatusFile();
  const existing = data[sessionId];

  data[sessionId] = {
    status: status ?? existing?.status ?? "recent",
    sortOrder: sortOrder ?? existing?.sortOrder ?? 0,
    starred: starred !== undefined ? starred : existing?.starred,
    updatedAt: new Date().toISOString(),
    // Store mtime when marking as recent so we can detect new activity
    lastKnownMtime: lastKnownMtime ?? existing?.lastKnownMtime,
  };

  writeStatusFile(data);
}

export async function getAllSessionStatuses(): Promise<
  Map<string, { status: SessionStatus; sortOrder: number; starred?: boolean; lastKnownMtime?: number; archived?: boolean; archivedAt?: string }>
> {
  // Check cache first using file mtime for validation
  const currentMtime = getStatusFileMtime();
  const cached = getCachedStatus(currentMtime);
  if (cached) {
    return cached as Map<string, { status: SessionStatus; sortOrder: number; starred?: boolean; lastKnownMtime?: number; archived?: boolean; archivedAt?: string }>;
  }

  // Cache miss - read file
  const data = readStatusFile();
  const map = new Map<string, { status: SessionStatus; sortOrder: number; starred?: boolean; lastKnownMtime?: number; archived?: boolean; archivedAt?: string }>();

  for (const [sessionId, record] of Object.entries(data)) {
    map.set(sessionId, {
      status: record.status,
      sortOrder: record.sortOrder,
      starred: record.starred,
      lastKnownMtime: record.lastKnownMtime,
      archived: record.archived,
      archivedAt: record.archivedAt,
    });
  }

  // Cache the result
  setCachedStatus(map, currentMtime);

  return map;
}

// Inbox storage
interface InboxItem {
  id: string;
  prompt: string;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

function readInboxFile(): InboxItem[] {
  ensureDataDir();
  if (!fs.existsSync(INBOX_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(INBOX_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function writeInboxFile(items: InboxItem[]) {
  ensureDataDir();
  fs.writeFileSync(INBOX_FILE, JSON.stringify(items, null, 2));
}

export async function createInboxItem(
  id: string,
  prompt: string,
  projectPath?: string,
  sortOrder?: number
): Promise<void> {
  const items = readInboxFile();
  // Add new items at the beginning so they appear at the top
  items.unshift({
    id,
    prompt,
    projectPath: projectPath ?? null,
    createdAt: new Date().toISOString(),
    sortOrder: sortOrder ?? 0,
  });
  writeInboxFile(items);
}

export async function getInboxItems(): Promise<
  Array<{
    id: string;
    prompt: string;
    projectPath: string | null;
    createdAt: string;
    sortOrder: number;
  }>
> {
  return readInboxFile();
}

export async function updateInboxItem(
  id: string,
  prompt?: string,
  sortOrder?: number
): Promise<void> {
  const items = readInboxFile();
  const index = items.findIndex((item) => item.id === id);

  if (index === -1) return;

  if (prompt !== undefined) {
    items[index].prompt = prompt;
  }
  if (sortOrder !== undefined) {
    items[index].sortOrder = sortOrder;
  }

  writeInboxFile(items);
}

export async function deleteInboxItem(id: string): Promise<void> {
  const items = readInboxFile();
  const filtered = items.filter((item) => item.id !== id);
  writeInboxFile(filtered);
}

// Archive a session (hide from default views)
export async function archiveSession(sessionId: string): Promise<void> {
  const data = readStatusFile();
  const existing = data[sessionId];

  data[sessionId] = {
    status: existing?.status ?? "recent",
    sortOrder: existing?.sortOrder ?? 0,
    starred: existing?.starred,
    lastKnownMtime: existing?.lastKnownMtime,
    archived: true,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeStatusFile(data);
}

// Unarchive a session (restore to default views)
export async function unarchiveSession(sessionId: string): Promise<void> {
  const data = readStatusFile();
  const existing = data[sessionId];

  if (existing) {
    delete existing.archived;
    delete existing.archivedAt;
    existing.updatedAt = new Date().toISOString();
    writeStatusFile(data);
  }
}

// ============================================================================
// Preferences storage (pinned folders, sidebar state, theme, recent scopes)
// ============================================================================

interface PinnedFolder {
  id: string;
  path: string;
  name: string;
  pinnedAt: number;
  emoji?: string;
}

interface UserPreferences {
  pinnedFolders: PinnedFolder[];
  sidebarCollapsed: boolean;
  theme: "light" | "dark" | "system";
  recentScopes: string[];
  viewMode: "board" | "tree" | "docs";
  // Separate storage for folder emojis by path - persists across unpin/re-pin
  folderEmojis?: Record<string, string>;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  pinnedFolders: [],
  sidebarCollapsed: false,
  theme: "system",
  recentScopes: [],
  viewMode: "board",
  folderEmojis: {},
};

function readPreferencesFile(): UserPreferences {
  ensureDataDir();
  if (!fs.existsSync(PREFERENCES_FILE)) {
    return { ...DEFAULT_PREFERENCES };
  }
  try {
    const content = fs.readFileSync(PREFERENCES_FILE, "utf-8");
    const data = JSON.parse(content);
    // Merge with defaults for any missing fields
    return { ...DEFAULT_PREFERENCES, ...data };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function writePreferencesFile(prefs: UserPreferences) {
  ensureDataDir();
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2));
}

// Pinned folders
export async function getPinnedFolders(): Promise<PinnedFolder[]> {
  const prefs = readPreferencesFile();
  // Sort by pinnedAt ascending (oldest first = stable ordering)
  return prefs.pinnedFolders.sort((a, b) => a.pinnedAt - b.pinnedAt);
}

export async function pinFolder(path: string): Promise<PinnedFolder> {
  const prefs = readPreferencesFile();

  // Check if already pinned
  const existing = prefs.pinnedFolders.find(f => f.path === path);
  if (existing) {
    return existing;
  }

  // Extract name from path
  const name = path.split("/").filter(Boolean).pop() || path;

  // Restore emoji if previously set for this path
  const savedEmoji = prefs.folderEmojis?.[path];

  const newFolder: PinnedFolder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    path,
    name,
    pinnedAt: Date.now(),
    ...(savedEmoji && { emoji: savedEmoji }),
  };

  prefs.pinnedFolders.push(newFolder);
  writePreferencesFile(prefs);

  return newFolder;
}

export async function unpinFolder(id: string): Promise<void> {
  const prefs = readPreferencesFile();
  prefs.pinnedFolders = prefs.pinnedFolders.filter(f => f.id !== id);
  writePreferencesFile(prefs);
}

export async function reorderPinnedFolders(activeId: string, overId: string): Promise<PinnedFolder[]> {
  const prefs = readPreferencesFile();
  const folders = prefs.pinnedFolders;

  const activeIndex = folders.findIndex(f => f.id === activeId);
  const overIndex = folders.findIndex(f => f.id === overId);

  if (activeIndex === -1 || overIndex === -1) {
    return folders;
  }

  // Remove from old position and insert at new position
  const [removed] = folders.splice(activeIndex, 1);
  folders.splice(overIndex, 0, removed);

  // Update pinnedAt timestamps to reflect new order
  const now = Date.now();
  folders.forEach((folder, index) => {
    folder.pinnedAt = now + index;
  });

  prefs.pinnedFolders = folders;
  writePreferencesFile(prefs);

  return folders;
}

export async function setFolderEmoji(id: string, emoji: string | null): Promise<PinnedFolder | null> {
  const prefs = readPreferencesFile();
  const folder = prefs.pinnedFolders.find(f => f.id === id);

  if (!folder) {
    return null;
  }

  // Initialize folderEmojis if needed
  if (!prefs.folderEmojis) {
    prefs.folderEmojis = {};
  }

  if (emoji === null || emoji === "") {
    delete folder.emoji;
    delete prefs.folderEmojis[folder.path];
  } else {
    folder.emoji = emoji;
    // Also save by path so it persists across unpin/re-pin
    prefs.folderEmojis[folder.path] = emoji;
  }

  writePreferencesFile(prefs);
  return folder;
}

// Sidebar state
export async function getSidebarCollapsed(): Promise<boolean> {
  const prefs = readPreferencesFile();
  return prefs.sidebarCollapsed;
}

export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  const prefs = readPreferencesFile();
  prefs.sidebarCollapsed = collapsed;
  writePreferencesFile(prefs);
}

// Theme
export async function getTheme(): Promise<"light" | "dark" | "system"> {
  const prefs = readPreferencesFile();
  return prefs.theme;
}

export async function setTheme(theme: "light" | "dark" | "system"): Promise<void> {
  const prefs = readPreferencesFile();
  prefs.theme = theme;
  writePreferencesFile(prefs);
}

// Recent scopes
export async function getRecentScopes(): Promise<string[]> {
  const prefs = readPreferencesFile();
  return prefs.recentScopes;
}

export async function addRecentScope(scope: string): Promise<string[]> {
  const prefs = readPreferencesFile();
  // Remove if already exists (will re-add at front)
  prefs.recentScopes = prefs.recentScopes.filter(s => s !== scope);
  // Add to front
  prefs.recentScopes.unshift(scope);
  // Keep only last 10
  prefs.recentScopes = prefs.recentScopes.slice(0, 10);
  writePreferencesFile(prefs);
  return prefs.recentScopes;
}

// View mode
export async function getViewMode(): Promise<"board" | "tree" | "docs"> {
  const prefs = readPreferencesFile();
  return prefs.viewMode;
}

export async function setViewMode(mode: "board" | "tree" | "docs"): Promise<void> {
  const prefs = readPreferencesFile();
  prefs.viewMode = mode;
  writePreferencesFile(prefs);
}

// Get all preferences at once (for initial load)
export async function getAllPreferences(): Promise<UserPreferences> {
  return readPreferencesFile();
}
