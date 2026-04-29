import * as fs from "fs";
import * as path from "path";
import type { Source } from "./types";

// Use DATA_DIR env var if set, otherwise use local ./data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");
const PREFERENCES_FILE = path.join(DATA_DIR, "preferences.json");
const SOURCES_FILE = path.join(DATA_DIR, "sources.json");

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
  workingFolder: undefined,
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

// Bridge vault path — reads from preferences, then active source folder, then env vars (legacy)
export async function getBridgeVaultPath(): Promise<string> {
  const prefs = readPreferencesFile();
  if (prefs.bridgeVaultPath) return prefs.bridgeVaultPath;

  // Try active source's folder
  const folder = getActiveFolder();
  if (folder) return folder;

  // Fall back to the app's saved working folder before generic env/default paths.
  if (prefs.workingFolder) return prefs.workingFolder;

  // Legacy env var fallback (set by Electron spawn or .env)
  return process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(process.env.HOME || "~", "work/bridge");
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

// ============================================================================
// Sources storage (multi-source server configuration)
// ============================================================================

function readSourcesFile(): Source[] {
  ensureDataDir();
  if (!fs.existsSync(SOURCES_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(SOURCES_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function writeSourcesFile(sources: Source[]) {
  ensureDataDir();
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

function generateSourceId(): string {
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** One-time migration: seed sources.json from env vars if it doesn't exist */
function migrateFromEnvVar(): void {
  if (fs.existsSync(SOURCES_FILE)) return;

  const sources: Source[] = [];

  // Migrate from BRIDGE_VAULT_PATH or HILT_WORKING_FOLDER → create a local source with that folder
  const folder = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER;
  if (folder) {
    const folderName = path.basename(folder);
    sources.push({
      id: generateSourceId(),
      name: folderName.charAt(0).toUpperCase() + folderName.slice(1),
      type: "local",
      url: "http://localhost:3000",
      folder,
      rank: 0,
    });
  }

  // Migrate from NEXT_PUBLIC_REMOTE_HOST
  const remoteHost = process.env.NEXT_PUBLIC_REMOTE_HOST;
  if (remoteHost) {
    if (sources.length === 0) {
      sources.push({
        id: generateSourceId(),
        name: "Local",
        type: "local",
        url: "http://localhost:3000",
        rank: 0,
      });
    }
    sources.push({
      id: generateSourceId(),
      name: "Remote",
      type: "remote",
      url: `https://${remoteHost}`,
      rank: sources.length,
    });
  }

  if (sources.length > 0) {
    writeSourcesFile(sources);
  }
}

/** Get the folder for the active local source (matched by current server port or first local source) */
export function getActiveFolder(): string | undefined {
  const sources = readSourcesFile();
  if (sources.length === 0) return undefined;

  // Try matching by current server's port
  const port = process.env.PORT;
  if (port) {
    const match = sources.find(s => s.type === "local" && s.url.includes(`:${port}`));
    if (match?.folder) return match.folder;
  }

  // Fall back to first local source with a folder
  const firstLocal = sources.find(s => s.type === "local" && s.folder);
  return firstLocal?.folder;
}

export async function getSources(): Promise<Source[]> {
  migrateFromEnvVar();
  const sources = readSourcesFile();
  return sources.sort((a, b) => a.rank - b.rank);
}

export async function addSource(name: string, url: string, type: "local" | "remote", folder?: string): Promise<Source> {
  const sources = readSourcesFile();
  const maxRank = sources.length > 0 ? Math.max(...sources.map(s => s.rank)) + 1 : 0;
  // Local sources always need a URL for switching — default to localhost:3000
  const resolvedUrl = url || (type === "local" ? "http://localhost:3000" : "");
  const newSource: Source = {
    id: generateSourceId(),
    name,
    type,
    url: resolvedUrl.replace(/\/+$/, ""),
    ...(folder && { folder }),
    rank: maxRank,
  };
  sources.push(newSource);
  writeSourcesFile(sources);
  return newSource;
}

export async function updateSource(id: string, updates: Partial<Pick<Source, "name" | "url" | "type" | "folder">>): Promise<Source | null> {
  const sources = readSourcesFile();
  const index = sources.findIndex(s => s.id === id);
  if (index === -1) return null;

  if (updates.name !== undefined) sources[index].name = updates.name;
  if (updates.url !== undefined) sources[index].url = updates.url.replace(/\/+$/, "");
  if (updates.type !== undefined) sources[index].type = updates.type;
  if (updates.folder !== undefined) sources[index].folder = updates.folder || undefined;

  writeSourcesFile(sources);
  return sources[index];
}

export async function deleteSource(id: string): Promise<void> {
  const sources = readSourcesFile();
  const filtered = sources.filter(s => s.id !== id);
  // Re-rank to close gaps
  filtered.sort((a, b) => a.rank - b.rank).forEach((s, i) => { s.rank = i; });
  writeSourcesFile(filtered);
}

export async function reorderSources(orderedIds: string[]): Promise<Source[]> {
  const sources = readSourcesFile();
  const byId = new Map(sources.map(s => [s.id, s]));
  const reordered: Source[] = [];

  for (let i = 0; i < orderedIds.length; i++) {
    const source = byId.get(orderedIds[i]);
    if (source) {
      source.rank = i;
      reordered.push(source);
    }
  }

  // Include any sources not in orderedIds (shouldn't happen, but be safe)
  for (const source of sources) {
    if (!orderedIds.includes(source.id)) {
      source.rank = reordered.length;
      reordered.push(source);
    }
  }

  writeSourcesFile(reordered);
  return reordered.sort((a, b) => a.rank - b.rank);
}
