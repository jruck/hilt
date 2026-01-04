/**
 * Pinned folders tracking via localStorage
 */

export interface PinnedFolder {
  id: string;
  path: string;
  name: string;
  pinnedAt: number;
}

const STORAGE_KEY = "claude-kanban-pinned-folders";

/**
 * Generate a unique ID for a pinned folder
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get pinned folders from localStorage, sorted by pinnedAt (oldest first for stable ordering)
 */
export function getPinnedFolders(): PinnedFolder[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const folders: PinnedFolder[] = JSON.parse(stored);
    // Sort by pinnedAt ascending (oldest first = stable ordering)
    return folders.sort((a, b) => a.pinnedAt - b.pinnedAt);
  } catch {
    return [];
  }
}

/**
 * Pin a folder path
 */
export function pinFolder(path: string): PinnedFolder {
  if (typeof window === "undefined") {
    throw new Error("Cannot pin folder on server");
  }

  const folders = getPinnedFolders();

  // Check if already pinned
  const existing = folders.find(f => f.path === path);
  if (existing) {
    return existing;
  }

  // Extract name from path
  const name = path.split("/").filter(Boolean).pop() || path;

  const newFolder: PinnedFolder = {
    id: generateId(),
    path,
    name,
    pinnedAt: Date.now(),
  };

  folders.push(newFolder);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));

  return newFolder;
}

/**
 * Unpin a folder by ID
 */
export function unpinFolder(id: string): void {
  if (typeof window === "undefined") return;

  try {
    const folders = getPinnedFolders();
    const filtered = folders.filter(f => f.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Check if a path is pinned
 */
export function isPinned(path: string): boolean {
  const folders = getPinnedFolders();
  return folders.some(f => f.path === path);
}

/**
 * Find a pinned folder by path
 */
export function findPinnedByPath(path: string): PinnedFolder | undefined {
  const folders = getPinnedFolders();
  return folders.find(f => f.path === path);
}

/**
 * Clear all pinned folders
 */
export function clearPinnedFolders(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Reorder pinned folders by moving a folder to a new position
 */
export function reorderFolders(activeId: string, overId: string): PinnedFolder[] {
  if (typeof window === "undefined") return [];

  try {
    const folders = getPinnedFolders();
    const activeIndex = folders.findIndex(f => f.id === activeId);
    const overIndex = folders.findIndex(f => f.id === overId);

    if (activeIndex === -1 || overIndex === -1) return folders;

    // Remove from old position and insert at new position
    const [removed] = folders.splice(activeIndex, 1);
    folders.splice(overIndex, 0, removed);

    // Update pinnedAt timestamps to reflect new order
    const now = Date.now();
    folders.forEach((folder, index) => {
      folder.pinnedAt = now + index;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
    return folders;
  } catch {
    return getPinnedFolders();
  }
}
