# Rename Plan: Claude Kanban → Hilt

This document outlines the comprehensive plan to rename the application from "Claude Kanban" to "Hilt".

## Summary

**Total scope:** ~130 occurrences across 52 files

| Category | Files | Occurrences |
|----------|-------|-------------|
| Configuration | 3 | ~12 |
| Source Code | 6 | ~15 |
| Scripts | 1 | ~6 |
| Documentation | ~40 | ~95 |
| Icons | 2 | N/A |

---

## Phase 1: Configuration Files (Critical)

These changes affect runtime behavior and must be done carefully.

### 1.1 Package Identity

**`package.json`:**
- Line 2: `"name": "claude-kanban"` → `"name": "hilt"`
- Line 65: `"appId": "com.claude-kanban.app"` → `"appId": "com.hilt.app"`
- Line 66: `"productName": "Claude Kanban"` → `"productName": "Hilt"`
- Line 95: `"title": "Claude Kanban"` → `"title": "Hilt"`

**`electron-builder.yml`:**
- Line 1: `appId: com.claude-kanban.app` → `appId: com.hilt.app`
- Line 2: `productName: Claude Kanban` → `productName: Hilt`
- Line 31: `title: Claude Kanban` → `title: Hilt`

**`package-lock.json`:**
- Will auto-regenerate after `npm install`

---

## Phase 2: Source Code Changes

### 2.1 Infrastructure File Paths

**`server/ws-server.ts`:**
- Line 9: `.claude-kanban-ws-port` → `.hilt-ws-port`
- Line 10: `.claude-kanban-server.lock` → `.hilt-server.lock`

**`src/app/api/ws-port/route.ts`:**
- Line 5: `.claude-kanban-ws-port` → `.hilt-ws-port`

### 2.2 localStorage Keys

**`src/components/Board.tsx`:**
- Line 47: `claude-kanban-home-dir` → `hilt-home-dir`
- Line 48: `claude-kanban-view-mode` → `hilt-view-mode`

**`src/components/ThemeProvider.tsx`:**
- Line 7: `claude-kanban-theme` → `hilt-theme`

**`src/contexts/ScopeContext.tsx`:**
- Line 6: `claude-kanban-scope` → `hilt-scope`

### 2.3 Page Metadata

**`src/app/layout.tsx`:**
- Line 17: `title: "Claude Kanban"` → `title: "Hilt"`

### 2.4 Type Comments (Optional but recommended)

**`src/lib/types.ts`:**
- Line 64: `~/.claude-kanban/workspaces/` → `~/.hilt/workspaces/`
- Line 66: `claude-kanban/<session-id-short>` → `hilt/<session-id-short>`

---

## Phase 3: Scripts

**`scripts/create-dev-app.sh`:**
- Line 7: `APP_NAME="Claude Kanban"` → `APP_NAME="Hilt"`
- Line 27: `com.claude-kanban.app` → `com.hilt.app`
- Line 29: `Claude Kanban` → `Hilt`
- Line 43: Comment update
- Line 128: Comment update

---

## Phase 4: Documentation

### 4.1 Primary Docs (User-facing)

| File | Changes |
|------|---------|
| `CLAUDE.md` | Title, all references |
| `README.md` | Title, git clone example, file tree |
| `docs/ARCHITECTURE.md` | Title, file tree |
| `docs/CHANGELOG.md` | Intro text, release notes |
| `docs/DATA-MODELS.md` | Intro, localStorage key docs |
| `docs/DESIGN-PHILOSOPHY.md` | Title reference |
| `docs/DEVELOPMENT.md` | Git clone, file tree |

### 4.2 Plan Files (Can be batch-updated)

All files in `docs/` containing "claude-kanban" or "Claude Kanban":
- `Plan.md`
- `Neighbors.md`
- `folder-scoping-plan.md`
- `scope-breadcrumb-refactor-plan.md`
- `sidebar-pinned-folders-plan.md`
- `theme-toggle-plan.md`
- `tree-view-implementation-plan.md`
- `tree-view-summary.md`
- `draft-injection-test-plan.md`
- `worktree-isolation-plan.md`
- `TAURI-MIGRATION-PLAN.md`
- `Claude-Code-Integration-Analysis.md`

---

## Phase 5: Icons

### 5.1 Favicon (Web)

**File:** `src/app/favicon.ico`

**Current design:** Black background with 🧱 (brick) emoji
**New design:** Black background with ⚔️ (crossed swords) or 🗡️ (dagger) emoji

**Action:** Generate new favicon.ico with sword emoji. Tools:
- Use https://favicon.io/emoji-favicons/ or similar
- Or create programmatically with ImageMagick/Canvas

### 5.2 Electron App Icon (macOS)

**Location:** `build/icon.icns` (referenced in electron-builder.yml)

**Note:** The `build/` folder doesn't exist yet - it needs to be created with:
- `icon.icns` (macOS)
- Optionally `icon.png` (512x512 for other platforms)

**Action:** Create new `.icns` file with sword emoji on black background

---

## Phase 6: Git Repository Rename

### 6.1 Pre-rename Preparation
1. Ensure all local changes are committed and pushed
2. Note current remote URL: `git remote -v`

### 6.2 Rename on GitHub (Manual Step)
1. Go to repository Settings → General
2. Under "Repository name", change `claude-kanban` to `hilt`
3. GitHub will automatically redirect the old URL

### 6.3 Update Local Remote
```bash
git remote set-url origin git@github.com:pricelessmisc/hilt.git
```

### 6.4 Rename Local Folder (Optional)
```bash
cd ..
mv claude-kanban hilt
cd hilt
```

---

## Execution Order

### Automated Steps (Claude can execute)

1. **Phase 2.1** - Infrastructure file paths (prevents runtime issues)
2. **Phase 1** - Package configuration
3. **Phase 2.2-2.4** - Source code changes
4. **Phase 3** - Scripts
5. **Phase 4** - Documentation
6. **Run tests** - `npm run lint && npm run build`
7. **Commit and push**

### Manual Steps (User must execute)

8. **Phase 5** - Create new icon assets (or use online generator)
9. **Phase 6** - Rename GitHub repository
10. **Phase 6.3** - Update local git remote
11. **Phase 6.4** - Optionally rename local folder

---

## localStorage Migration Note

Existing users will lose their saved preferences (theme, scope, view mode) after the rename because the localStorage keys are changing. This is acceptable for this early-stage project. If migration were needed, we'd add a one-time migration script in the app initialization.

---

## Testing Checklist

After all changes:

- [ ] `npm install` completes successfully
- [ ] `npm run dev:all` starts without errors
- [ ] App loads at http://localhost:3000
- [ ] Page title shows "Hilt"
- [ ] Theme toggle saves preference (check localStorage for `hilt-theme`)
- [ ] Scope selection works (check localStorage for `hilt-scope`)
- [ ] WebSocket connection works (check for `.hilt-ws-port` file in home dir)
- [ ] Terminal opens and connects successfully
- [ ] `npm run build` completes without errors
- [ ] `npm run lint` passes

---

## Rollback Plan

If issues are discovered:
1. `git checkout .` to discard changes (before commit)
2. Or `git revert HEAD` (after commit)

The git history is preserved regardless of rename approach.
