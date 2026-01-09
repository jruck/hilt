# Documentation Viewer Implementation Plan

## Overview

Add a scope-aware Documentation Viewer to the Docs tab in Hilt. Features a file tree sidebar, markdown viewer/editor using existing MDXEditor, wikilink navigation, and real-time updates.

---

## Component Architecture

### New Components

| Component | Path | Purpose |
|-----------|------|---------|
| **DocsView** | `src/components/DocsView.tsx` | Main container - manages layout (file tree + content pane) |
| **DocsFileTree** | `src/components/docs/DocsFileTree.tsx` | Recursive tree browser with expand/collapse |
| **DocsTreeItem** | `src/components/docs/DocsTreeItem.tsx` | Single file/folder row with icon, name, indent |
| **DocsBreadcrumbs** | `src/components/docs/DocsBreadcrumbs.tsx` | Breadcrumb path for open document (Obsidian-style) |
| **DocsContentPane** | `src/components/docs/DocsContentPane.tsx` | Content area with edit toggle, uses PlanEditor |
| **DocsEditToggle** | `src/components/docs/DocsEditToggle.tsx` | Read/Edit mode toggle button |
| **DocsFallbackView** | `src/components/docs/DocsFallbackView.tsx` | For non-viewable files: icon, name, actions |

### Modified Components

| Component | Changes |
|-----------|---------|
| **Board.tsx** | Replace "Coming Soon" with `<DocsView />` when `viewMode === "docs"` |
| **PlanEditor.tsx** | Add wikilink plugin support |

### Layout

```
+------------------------------------------------------------------+
| Status Bar (existing breadcrumbs, view toggle)                    |
+----------+-------------------------------------------------------+
| Sidebar  | DocsView                                              |
| (pinned  | +-------------+-------------------------------------+ |
| folders) | | File Tree   | Content Pane                        | |
|          | | (250px)     | +----------------------------------+ | |
|          | |             | | Breadcrumbs   [Read] [Edit]      | | |
|          | | folder-a/   | +----------------------------------+ | |
|          | |   file1.md  | |                                  | | |
|          | |   file2.md  | | PlanEditor (markdown)            | | |
|          | | folder-b/   | | or                               | | |
|          | |   ...       | | DocsFallbackView (binary)        | | |
|          | +-------------+-------------------------------------+ |
+----------+-------------------------------------------------------+
```

---

## API Routes

### GET `/api/docs/tree?scope=/path`

Returns recursive file tree for scope.

```typescript
interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  extension?: string;
  modTime: number;
}

interface TreeResponse {
  root: FileNode;
  modTime: number;  // Latest across all files (change detection)
}
```

- Recursive fs.readdirSync with max 10 levels
- Skip hidden files, node_modules, .git
- Sort: directories first, then alphabetical

### GET `/api/docs/file?path=/path&scope=/scope`

Reads file content.

```typescript
interface FileResponse {
  path: string;
  content: string | null;  // null for binary
  isBinary: boolean;
  isViewable: boolean;
  mimeType: string;
  size: number;
  modTime: number;
}
```

- Security: validate path starts with scope
- Binary detection: null bytes in first 8KB
- Max 1MB for text files
- Viewable: .md, .txt, .json, .yaml, code files

### PUT `/api/docs/file`

Saves file content.

```typescript
interface SaveRequest {
  path: string;
  content: string;
  scope: string;
}
```

---

## State Management

### Hook: `useDocs(scopePath)`

Located at `src/hooks/useDocs.ts`:

```typescript
export function useDocs(scopePath: string) {
  // SWR for file tree - poll every 5s
  const { data: treeData } = useSWR(
    `/api/docs/tree?scope=${encodeURIComponent(scopePath)}`,
    fetcher,
    { refreshInterval: 5000, keepPreviousData: true }
  );

  // Selected file content - fetch on demand
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const { data: fileData, mutate: mutateFile } = useSWR(...);

  // Save function
  const saveFile = async (content: string) => { ... };

  return { tree, selectedPath, setSelectedPath, fileContent, saveFile, ... };
}
```

### Local State

- `expandedPaths: Set<string>` - persisted to localStorage per scope
- `isEditMode: boolean` - defaults false (read mode)
- `hasUnsavedChanges: boolean` - track dirty state
- `editedContent: string | null` - buffer for unsaved edits

---

## Wikilink Support

### Plugin: `src/lib/mdx-plugins/wikilinks-plugin.tsx`

Custom MDXEditor plugin that:

1. **Parses** `[[target]]` and `[[target|display]]` syntax via remark plugin
2. **Renders** as styled clickable links
3. **Navigates** on click via callback to DocsView

### Resolution Logic: `src/lib/docs/wikilink-resolver.ts`

```typescript
function resolveWikilink(target, currentFile, scope, fileTree): ResolvedLink
```

Resolution order:
1. Exact relative path from current file
2. Filename match anywhere in scope (case-insensitive)
3. Mark as broken if not found (red styling)

---

## Real-Time Updates

### File Tree
- Poll `/api/docs/tree` every 5 seconds
- Compare `modTime` to detect changes
- Merge new tree preserving expanded state
- New files: appear in sorted position
- Deleted files: remove from tree; if open, show "File deleted"

### Document Content
- **Read mode**: Poll every 5s, auto-reload if changed externally
- **Edit mode**: Stop polling to prevent conflicts
- **External change while editing**: Show banner "File changed externally. Reload or keep?"

### Visibility-Aware
- 5s interval when tab visible
- 30s interval when hidden (reduce load)

---

## UI Details

### File Tree Sidebar
- Width: 250px fixed
- Icons by extension (FileText for .md, FileCode for .ts, Image for .png, etc.)
- Indent: 16px per level
- Selected: highlighted background
- Expand/collapse via chevron or row click

### Breadcrumbs
- Format: `scope / folder / subfolder / file.md`
- Each segment clickable (reveals in tree)
- Muted separators

### Edit Toggle
- Two buttons: Read (book icon) / Edit (pencil icon)
- Active state: filled background
- Default: Read
- Switch to Read with unsaved changes: confirm dialog

### Non-Viewable Files (DocsFallbackView)
- Centered layout
- Large file type icon (48px)
- Filename + type + size
- Buttons: "Open in Finder" / "Copy Path"

---

## Implementation Phases

### Phase 1: Core Infrastructure
1. Create `/api/docs/tree/route.ts`
2. Create `/api/docs/file/route.ts`
3. Create `src/hooks/useDocs.ts`
4. Add types to `src/lib/types.ts`

### Phase 2: Basic UI
5. Create `DocsView.tsx` (main container)
6. Create `DocsFileTree.tsx` + `DocsTreeItem.tsx`
7. Create `DocsBreadcrumbs.tsx`
8. Create `DocsContentPane.tsx` (read-only with PlanEditor)
9. Create `DocsFallbackView.tsx`
10. Integrate in `Board.tsx`

### Phase 3: Edit Mode
11. Create `DocsEditToggle.tsx`
12. Add edit mode to `DocsContentPane.tsx`
13. Add save functionality with Cmd+S
14. Add unsaved changes confirmation

### Phase 4: Wikilinks
15. Create `src/lib/mdx-plugins/wikilinks-plugin.tsx`
16. Create `src/lib/docs/wikilink-resolver.ts`
17. Integrate plugin with PlanEditor
18. Add broken link styling

### Phase 5: Polish
19. External change detection + conflict UI
20. Large file warnings
21. Error handling (permissions, missing files)
22. localStorage persistence for expanded paths

---

## Edge Cases

| Case | Handling |
|------|----------|
| Large files (>1MB) | Warning message, option to load anyway |
| Binary files | DocsFallbackView with file info |
| Deep nesting (>10 levels) | Show "..." indicator, drill-down option |
| Broken wikilinks | Red styling, tooltip "File not found" |
| External changes during edit | Banner with Reload/Keep options |
| File deleted while open | "File deleted" message, close option |
| Permission errors | User-friendly error in UI |

---

## Critical Files

**Modify:**
- `src/components/Board.tsx` - Add DocsView integration
- `src/components/PlanEditor.tsx` - Add wikilink plugin
- `src/lib/types.ts` - Add FileNode, TreeResponse, FileResponse types

**Create:**
- `src/app/api/docs/tree/route.ts`
- `src/app/api/docs/file/route.ts`
- `src/hooks/useDocs.ts`
- `src/components/DocsView.tsx`
- `src/components/docs/DocsFileTree.tsx`
- `src/components/docs/DocsTreeItem.tsx`
- `src/components/docs/DocsBreadcrumbs.tsx`
- `src/components/docs/DocsContentPane.tsx`
- `src/components/docs/DocsEditToggle.tsx`
- `src/components/docs/DocsFallbackView.tsx`
- `src/lib/mdx-plugins/wikilinks-plugin.tsx`
- `src/lib/docs/wikilink-resolver.ts`

**Reference (patterns to follow):**
- `src/hooks/useSessions.ts` - SWR polling pattern
- `src/app/api/folders/route.ts` - File system API pattern
- `src/components/scope/ScopeBreadcrumbs.tsx` - Breadcrumb pattern
