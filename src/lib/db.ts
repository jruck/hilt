import * as fs from "fs";
import * as path from "path";

// Use DATA_DIR env var if set, otherwise use local ./data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");
const PREFERENCES_FILE = path.join(DATA_DIR, "preferences.json");

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
  viewMode: "board" | "tree" | "docs" | "stack" | "bridge" | "chat";
  // Separate storage for folder emojis by path - persists across unpin/re-pin
  folderEmojis?: Record<string, string>;
  // Global inbox folder path for quick capture
  inboxPath?: string;
  // Bridge vault path for weekly tasks and projects
  bridgeVaultPath?: string;
  // Default working folder — used as initial scope for Docs, Stack, and Bridge views
  workingFolder?: string;
  // Chat view: last used agent label
  chatAgent?: string;
  // Chat view: session key for continuity across app restarts
  chatSessionKey?: string;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  pinnedFolders: [],
  sidebarCollapsed: false,
  theme: "system",
  recentScopes: [],
  viewMode: "bridge",
  folderEmojis: {},
  workingFolder: process.env.HILT_WORKING_FOLDER || undefined,
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
export async function getViewMode(): Promise<string> {
  const prefs = readPreferencesFile();
  return prefs.viewMode;
}

export async function setViewMode(mode: string): Promise<void> {
  const prefs = readPreferencesFile();
  prefs.viewMode = mode as UserPreferences["viewMode"];
  writePreferencesFile(prefs);
}

// Bridge vault path
export async function getBridgeVaultPath(): Promise<string> {
  const prefs = readPreferencesFile();
  return prefs.bridgeVaultPath || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(process.env.HOME || "~", "work");
}

export async function setBridgeVaultPath(vaultPath: string): Promise<void> {
  const prefs = readPreferencesFile();
  prefs.bridgeVaultPath = vaultPath;
  writePreferencesFile(prefs);
}

// Get all preferences at once (for initial load)
export async function getAllPreferences(): Promise<UserPreferences> {
  return readPreferencesFile();
}

// Inbox path
export async function getInboxPath(): Promise<string | undefined> {
  const prefs = readPreferencesFile();
  return prefs.inboxPath;
}

export async function setInboxPath(path: string | null): Promise<void> {
  const prefs = readPreferencesFile();
  if (path === null) {
    delete prefs.inboxPath;
  } else {
    prefs.inboxPath = path;
  }
  writePreferencesFile(prefs);
}

// Chat agent
export async function getChatAgent(): Promise<string | undefined> {
  const prefs = readPreferencesFile();
  return prefs.chatAgent;
}

export async function setChatAgent(agent: string | null): Promise<void> {
  const prefs = readPreferencesFile();
  if (agent === null) {
    delete prefs.chatAgent;
  } else {
    prefs.chatAgent = agent;
  }
  writePreferencesFile(prefs);
}

// Chat session key
export async function getChatSessionKey(): Promise<string | undefined> {
  const prefs = readPreferencesFile();
  return prefs.chatSessionKey;
}

export async function setChatSessionKey(key: string | null): Promise<void> {
  const prefs = readPreferencesFile();
  if (key === null) {
    delete prefs.chatSessionKey;
  } else {
    prefs.chatSessionKey = key;
  }
  writePreferencesFile(prefs);
}
