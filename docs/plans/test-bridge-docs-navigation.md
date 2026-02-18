# Test Plan: Bridge → Docs Navigation

Tests the full cycle of clicking project links from Bridge, verifying Docs loads correctly, interacting with the file tree, returning to Bridge, and repeating with different projects.

## Entry Points to Test

There are 4 distinct ways a project link navigates from Bridge to Docs:

1. **Project Board card** — Click a project card in the kanban columns (Considering / Refining / Doing / Done)
2. **Task project badge** — Click the project name badge on a task item (the colored tag showing which project a task belongs to)
3. **Task detail wikilink** — Click a `[[project-folder]]` wikilink inside task detail rich text editor
4. **Thought card** — Click a thought/idea card that has a project path

All of these call `navigateTo("docs", project.path)` which sets the URL to `/docs/{absolute-path}`.

## Test Matrix

For each entry point, run through this sequence:

### A. Navigate from Bridge to Docs

| # | Action | Expected |
|---|--------|----------|
| 1 | Click the project link | URL changes to `/docs/{project-path}` |
| 2 | Docs tab becomes active in nav | Tab highlight moves to "Docs" |
| 3 | File tree shows full working folder tree | Tree root = working folder, not the project folder |
| 4 | Project folder is expanded in tree | Parent folders expanded down to the project |
| 5 | `index.md` is selected (if exists) | Content pane shows the project's index.md |
| 6 | No "path must be a file" error | Folder paths resolve to index.md gracefully |
| 7 | If no index.md exists | Folder expands, no file selected, no error |

### B. Interact with the file tree

| # | Action | Expected |
|---|--------|----------|
| 8 | Click a different file in the project folder | File loads in content pane, URL updates |
| 9 | Expand a subfolder | Subfolder opens, no navigation side effects |
| 10 | Click a file in a completely different folder | File loads, URL updates, tree root unchanged |
| 11 | Click a folder that has index.md | Folder expands, index.md selected and shown |
| 12 | Click a wikilink in rendered markdown | Target file loads, parents expand, tree root unchanged |

### C. Return to Bridge and repeat

| # | Action | Expected |
|---|--------|----------|
| 13 | Click "Bridge" tab | Bridge view loads, previous state preserved |
| 14 | Click a DIFFERENT project link | Navigates to Docs, new project expanded+selected |
| 15 | Browser back button | Returns to Bridge (or previous Docs state) |
| 16 | Browser forward button | Returns to the Docs state you backed out of |

## Specific Projects to Test

Use a mix of project types to cover edge cases:

| Project | Why | Has index.md? |
|---------|-----|---------------|
| A top-level project (`projects/foo`) | Simple path | Yes |
| A nested area project (`libraries/area/projects/bar`) | Deep path, many parents to expand | Yes |
| A project WITHOUT index.md | Tests the no-index fallback | No |
| A project with subfolders | Tests tree expansion depth | Yes |

## Cycle Protocol

Repeat this full cycle **at least 3 times**, using a different entry point and project each time:

```
Round 1: Project Board card → project with index.md → click files → back to Bridge
Round 2: Task project badge → nested area project → click files → back to Bridge
Round 3: Task detail wikilink → project without index.md → click files → back to Bridge
Round 4: Project Board card → same project as Round 1 → verify re-navigation works
Round 5: Rapid switching — click project, immediately click Bridge, click another project
```

## Pass Criteria

- Zero "path must be a file, not a directory" errors
- Tree root never changes (always working folder)
- Every project navigation expands the correct path and selects index.md if available
- Browser back/forward works correctly throughout
- No stale file content shown after switching projects
- Rapid switching doesn't cause race conditions or stale UI
