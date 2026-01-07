# Documentation System Plan

## Overview

Create a self-maintaining documentation system that:
1. Provides comprehensive architectural reference for AI agents working on the codebase
2. Tracks all changes via a structured changelog
3. Auto-updates when agents make changes
4. Lives in the repository and is version-controlled

## Documentation Structure

```
docs/
├── ARCHITECTURE.md          # Core architecture reference (AI-optimized)
├── CHANGELOG.md             # Structured change log
├── API.md                   # API route documentation
├── DATA-MODELS.md           # Types, schemas, data flow
├── COMPONENTS.md            # React component reference
├── DEVELOPMENT.md           # Setup, scripts, debugging
└── existing files...        # (keep current docs)
```

## Phase 1: Core Architecture Document

**File: `docs/ARCHITECTURE.md`**

Purpose: Single source of truth for AI agents to understand the codebase before making changes.

### Sections

1. **System Overview**
   - High-level diagram (ASCII art for easy parsing)
   - Tech stack summary table
   - Key directories and their purposes

2. **Data Flow Patterns**
   - Session discovery pipeline
   - Terminal integration flow
   - State management strategy
   - View mode switching

3. **Component Hierarchy**
   - Board → Column → SessionCard structure
   - Terminal drawer architecture
   - Scope navigation components
   - Sidebar and pinned folders

4. **API Routes Reference**
   - Each route with: purpose, method, params, response shape
   - WebSocket message protocols

5. **Data Models**
   - Session interface (full breakdown)
   - TreeNode structure
   - Inbox/draft items
   - Status persistence format

6. **Key Implementation Details**
   - Squarified treemap algorithm
   - Heat score calculation
   - Running session detection (30-second threshold)
   - OSC sequence parsing for terminal titles

7. **File Index**
   - Critical files table with line counts and purposes
   - Dependency graph (which files import which)

8. **Constraints & Gotchas**
   - Claude JSONL files are read-only
   - Terminal stability via terminalId
   - Scope filtering: exact vs prefix mode
   - LocalStorage keys and their purposes

---

## Phase 2: Changelog System

**File: `docs/CHANGELOG.md`**

Format: Keep a Changelog (https://keepachangelog.com) with AI-specific additions.

### Structure

```markdown
# Changelog

All notable changes to this project are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added
- Feature X (files: `src/foo.ts`, `src/bar.tsx`)

### Changed
- Modified Y behavior (files: `src/baz.ts`)

### Fixed
- Bug Z (files: `src/qux.ts`)

### Removed
- Deprecated feature W

---

## [0.2.0] - 2025-01-06

### Added
- Tree View visualization with squarified treemap layout
- Collapsible sidebar with pinned folders
- View toggle (Tree / Board / Docs)
- Reference processing for URLs and YouTube videos

### Changed
- Renamed "Kanban" to "Board" in UI
- Scope navigation now uses URL paths instead of query params

### Technical Notes
- New files: `src/components/TreeView.tsx`, `src/lib/tree-utils.ts`, `src/lib/treemap-layout.ts`
- Key architectural change: Added prefix-based scope filtering for tree view

---

## [0.1.0] - Initial Release

### Added
- Three-column kanban board (To Do, In Progress, Recent)
- Live terminal integration via xterm.js + node-pty
- Session discovery from Claude JSONL files
- Drag-and-drop session management
- Plan mode with MDXEditor
- Scope navigation with breadcrumbs
```

### Changelog Update Protocol

When an AI agent completes work:

1. **Always update `docs/CHANGELOG.md`** under `[Unreleased]`
2. Include:
   - Category: Added/Changed/Fixed/Removed/Deprecated/Security
   - Brief description
   - Files modified (parenthetical)
3. For significant changes, add a "Technical Notes" subsection

---

## Phase 3: CLAUDE.md Integration

Update `CLAUDE.md` to reference the documentation system:

```markdown
## Documentation

Before making architectural changes, read:
- `docs/ARCHITECTURE.md` - System design, data flow, component structure
- `docs/CHANGELOG.md` - Recent changes and technical context

After completing work:
1. Update `docs/CHANGELOG.md` under `[Unreleased]`
2. If architectural changes were made, update `docs/ARCHITECTURE.md`
```

---

## Phase 4: Supporting Documents

### `docs/API.md`
- All 9 API routes with:
  - Method, path, query params
  - Request/response TypeScript interfaces
  - Example curl commands
  - Error responses

### `docs/DATA-MODELS.md`
- Full TypeScript interfaces with field descriptions
- JSONL entry format specification
- LocalStorage key reference
- File persistence formats (session-status.json, inbox.json)

### `docs/COMPONENTS.md`
- Component tree visualization
- Props interfaces for major components
- State management patterns per component
- Styling conventions (Tailwind classes used)

### `docs/DEVELOPMENT.md`
- Setup instructions
- Script reference (npm run dev:all, etc.)
- Debugging tips
- Common issues and solutions
- Testing strategy (when tests exist)

---

## Implementation Order

1. **Create `docs/CHANGELOG.md`** - Retroactively document v0.1.0 and recent v0.2.0 changes
2. **Create `docs/ARCHITECTURE.md`** - Comprehensive architecture reference
3. **Update `CLAUDE.md`** - Add documentation protocol
4. **Create `docs/API.md`** - API route documentation
5. **Create `docs/DATA-MODELS.md`** - Type and schema reference
6. **Create `docs/COMPONENTS.md`** - Component documentation
7. **Create `docs/DEVELOPMENT.md`** - Developer guide

---

## Maintenance Protocol

### For AI Agents

When completing any task:

1. **Check ARCHITECTURE.md** - Does your change affect documented patterns?
   - If yes, update the relevant section

2. **Update CHANGELOG.md** - Always add entry under `[Unreleased]`
   - Use present tense ("Add feature X" not "Added")
   - Include file paths for significant changes

3. **Check DATA-MODELS.md** - Did you add/modify types?
   - If yes, update the type documentation

4. **Check API.md** - Did you add/modify API routes?
   - If yes, update the route documentation

### Version Releases

When cutting a release:

1. Move `[Unreleased]` content to new version heading
2. Add release date
3. Update version in `package.json`
4. Create git tag

---

## File Size Guidelines

Keep documentation scannable:
- ARCHITECTURE.md: ~500-800 lines (comprehensive but not exhaustive)
- CHANGELOG.md: Unlimited (grows over time)
- API.md: ~200-400 lines
- DATA-MODELS.md: ~200-300 lines
- COMPONENTS.md: ~300-500 lines
- DEVELOPMENT.md: ~150-250 lines

---

## Success Criteria

The documentation system is successful when:

1. An AI agent can read ARCHITECTURE.md and understand where to make changes
2. CHANGELOG.md accurately reflects the last 10+ significant changes
3. New features can be implemented without breaking existing patterns
4. Code review can reference documentation for architectural decisions
5. Onboarding time for new contributors is reduced

---

## Questions Before Implementation

1. Should CHANGELOG entries include commit hashes?
2. Preferred format for ASCII diagrams in ARCHITECTURE.md?
3. Should API.md include curl examples or just TypeScript types?
4. Any existing versioning conventions to follow?
