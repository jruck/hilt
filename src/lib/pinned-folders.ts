/**
 * Pinned folders type definition
 *
 * NOTE: Pinned folders are now stored server-side via /api/preferences
 * Use the usePinnedFolders hook for CRUD operations
 */

export interface PinnedFolder {
  id: string;
  path: string;
  name: string;
  pinnedAt: number;
  emoji?: string;
}
