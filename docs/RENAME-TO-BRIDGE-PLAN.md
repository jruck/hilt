# Rename Plan: Claude Kanban → Bridge

Renaming the app to "Bridge" (Star Trek reference - the command center of a starship).

## Icon Change

**Old:** 🧱 (bricks)
**New:** 🧭 (compass) - Apple emoji version

---

## Phase 1: Package & Build Configuration

### 1.1 package.json
- [ ] `"name": "claude-kanban"` → `"name": "bridge"`
- [ ] `"appId": "com.claude-kanban.app"` → `"appId": "com.bridge-app.app"`
- [ ] `"productName": "Claude Kanban"` → `"productName": "Bridge"`
- [ ] `"title": "Claude Kanban"` → `"title": "Bridge"` (dmg config)

### 1.2 electron-builder.yml
- [ ] `appId: com.claude-kanban.app` → `appId: com.bridge-app.app`
- [ ] `productName: Claude Kanban` → `productName: Bridge`
- [ ] `title: Claude Kanban` → `title: Bridge` (dmg section)

### 1.3 scripts/create-dev-app.sh
- [ ] `APP_NAME="Claude Kanban"` → `APP_NAME="Bridge"`
- [ ] `CFBundleIdentifier: com.claude-kanban.app` → `CFBundleIdentifier: com.bridge-app.app`
- [ ] `CFBundleName: Claude Kanban` → `CFBundleName: Bridge`

---

## Phase 2: Source Code

### 2.1 localStorage Keys (with migration)
These need both renaming AND migration logic for existing users.

| File | Old Key | New Key |
|------|---------|---------|
| `src/components/Board.tsx` | `claude-kanban-home-dir` | `bridge-home-dir` |
| `src/components/Board.tsx` | `claude-kanban-view-mode` | `bridge-view-mode` |
| `src/components/ThemeProvider.tsx` | `claude-kanban-theme` | `bridge-theme` |
| `src/contexts/ScopeContext.tsx` | `claude-kanban-scope` | `bridge-scope` |
| `src/hooks/useSidebarState.ts` | `claude-kanban-sidebar-collapsed` | `bridge-sidebar-collapsed` |
| `src/hooks/usePinnedFolders.ts` | `claude-kanban-pinned-folders` | `bridge-pinned-folders` |
| `src/lib/recent-scopes.ts` | `claude-kanban-recent-scopes` | `bridge-recent-scopes` |

**Migration approach:** Create a utility that checks for old keys and migrates to new ones on first load.

### 2.2 App Metadata
| File | Change |
|------|--------|
| `src/app/layout.tsx` | `title: "Claude Kanban"` → `title: "Bridge"` |
| `src/app/layout.tsx` | Favicon emoji: `🧱` → `🧭` |

### 2.3 File System Paths
| File | Old Path | New Path |
|------|----------|----------|
| `src/app/api/ws-port/route.ts` | `~/.claude-kanban-ws-port` | `~/.bridge-ws-port` |
| `server/ws-server.ts` | `~/.claude-kanban-ws-port` | `~/.bridge-ws-port` |

### 2.4 Types & Comments
| File | Change |
|------|--------|
| `src/lib/types.ts` | Comment references to `~/.claude-kanban/workspaces/` |
| `src/lib/types.ts` | Comment references to `claude-kanban/<session-id-short>` |

---

## Phase 3: Icon Generation

### 3.1 scripts/generate-icons.mjs
- [ ] Update emoji from `🧱` to `🧭`
- [ ] Update console.log messages
- [ ] Update file comments

### 3.2 Regenerate Icons
```bash
node scripts/generate-icons.mjs
```

This will regenerate:
- `build/icon.icns` (macOS app icon)
- Any other icon assets

---

## Phase 4: Documentation

### 4.1 Root Documentation
| File | Changes |
|------|---------|
| `README.md` | Title, all references, icon mentions |
| `CLAUDE.md` | Title: `# Claude Kanban` → `# Bridge` |

### 4.2 docs/ Directory
| File | Changes |
|------|---------|
| `docs/CHANGELOG.md` | Project name, icon references |
| `docs/ARCHITECTURE.md` | Project name, icon reference in tree |
| `docs/DATA-MODELS.md` | All localStorage key documentation |
| `docs/API.md` | Any project name references |
| `docs/COMPONENTS.md` | Any project name references |
| `docs/DEVELOPMENT.md` | Any project name references |
| `docs/DESIGN-PHILOSOPHY.md` | Any project name references |
| `docs/TAURI-MIGRATION-PLAN.md` | All "Claude Kanban" references |

### 4.3 Plan Documents (historical, lower priority)
- `docs/theme-toggle-plan.md`
- `docs/folder-scoping-plan.md`
- `docs/tree-view-implementation-plan.md`
- `docs/scope-breadcrumb-refactor-plan.md`
- `docs/sidebar-pinned-folders-plan.md`
- `docs/worktree-isolation-plan.md`

---

## Phase 5: Cleanup & Build

### 5.1 Clean Old Artifacts
```bash
rm -rf dist/
rm -rf .next/
rm -rf /Applications/Claude\ Kanban.app  # If installed
```

### 5.2 Rebuild
```bash
npm run build
npm run electron:build  # Or create-dev-app
```

### 5.3 Update Git Worktrees (if active)
Any worktrees with `claude-kanban` in the name should be recreated or renamed.

---

## Phase 6: Directory Rename (Optional - Last Step)

Rename the project directory itself:
```bash
# From parent directory
mv claude-kanban bridge
```

**Note:** This will require updating:
- Any symlinks
- IDE project settings
- Shell aliases or scripts
- The worktree in `~/Bridge/Tools/`

---

## Migration Utility

Create `src/lib/storage-migration.ts`:

```typescript
const MIGRATION_KEY = 'bridge-storage-migrated';

const KEY_MAPPINGS = {
  'claude-kanban-home-dir': 'bridge-home-dir',
  'claude-kanban-view-mode': 'bridge-view-mode',
  'claude-kanban-theme': 'bridge-theme',
  'claude-kanban-scope': 'bridge-scope',
  'claude-kanban-sidebar-collapsed': 'bridge-sidebar-collapsed',
  'claude-kanban-pinned-folders': 'bridge-pinned-folders',
  'claude-kanban-recent-scopes': 'bridge-recent-scopes',
};

export function migrateStorage(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(MIGRATION_KEY)) return;

  for (const [oldKey, newKey] of Object.entries(KEY_MAPPINGS)) {
    const value = localStorage.getItem(oldKey);
    if (value !== null) {
      localStorage.setItem(newKey, value);
      localStorage.removeItem(oldKey);
    }
  }

  localStorage.setItem(MIGRATION_KEY, 'true');
}
```

Call this in `src/app/layout.tsx` or a top-level provider.

---

## Execution Order

1. **Phase 3** - Generate new icon first (standalone task)
2. **Phase 2** - Source code changes (biggest impact)
3. **Phase 1** - Package/build config
4. **Phase 4** - Documentation
5. **Phase 5** - Clean and rebuild
6. **Phase 6** - Directory rename (optional, do last)

---

## Verification Checklist

After completion:
- [ ] App launches with "Bridge" in title bar
- [ ] Favicon shows 🧭 compass
- [ ] macOS app icon shows 🧭 compass
- [ ] localStorage keys migrated correctly
- [ ] No "kanban" or "claude-kanban" in `grep -ri "kanban" src/`
- [ ] No "🧱" references in `grep -r "🧱" .`
- [ ] DMG builds with correct name
- [ ] All docs updated
