# Mobile Responsive Plan

## Context

Hilt is desktop-first. The Bridge tab recently got mobile touch improvements (drag, no-edit), but Docs and Stack tabs are unusable on mobile, and the top navigation bar has small icons with no mobile adaptation. This plan makes all three tabs and the navigation mobile-friendly without disrupting desktop UX.

## Principles

- **Don't break desktop** — all changes gated behind `@media (pointer: coarse)` or `max-width: 768px`
- **Stay warm and dense** — Hilt's design philosophy prizes information density and warm colors; mobile should feel like the same app, just adapted for touch
- **Progressive, not regressive** — adapt layouts for touch, don't dumb them down
- **Separate worktree** — all work on `feature/mobile-responsive` branch via `git worktree`

---

## Phase 0: Setup

### 0.1 Create worktree

```bash
git worktree add ../hilt-mobile feature/mobile-responsive
```

All implementation agents work in `../hilt-mobile`. The dev server runs from there.

### 0.2 Add shared mobile detection

Create `src/hooks/useIsMobile.ts`:

```ts
// Reactive hook for (pointer: coarse) — touch device detection
// Also export a CSS custom property approach via globals.css
```

Add to `globals.css`:

```css
@media (pointer: coarse) {
  :root { --is-touch: 1; }
}
```

This gives both JS (`useIsMobile()`) and CSS (`@media (pointer: coarse)`) paths for mobile adaptation.

---

## Phase 1: Floating Bottom Bar

**Goal**: On mobile, the top toolbar becomes a floating bottom bar. Desktop is unchanged.

### Current top bar structure (44px, `Board.tsx`):

```
┌─────────────────────────────────────────────────┐
│ [🔍] [🌙]  │  [Bridge] [Docs] [Stack]  │  [+ Add] │
│   left      │        center              │   right  │
└─────────────────────────────────────────────────┘
```

### Mobile bottom bar design:

```
                    Content area
                        ...
  ┌──────────────────────────────────────────┐
  │  🔍   🏠Bridge   📄Docs   📦Stack   ＋  │  ← 56px bar
  └──────────────────────────────────────────┘
           safe area padding (34px)
```

### Implementation

1. **Extract navigation into `<NavBar />`** — new component that renders either top (desktop) or bottom (mobile) based on `useIsMobile()`
2. **Desktop**: Renders identically to current top bar (no visual change)
3. **Mobile**:
   - `position: fixed; bottom: 0` with `padding-bottom: env(safe-area-inset-bottom)`
   - Semi-transparent background with `backdrop-filter: blur(12px)` matching Hilt's warm palette
   - Border-top instead of border-bottom
   - ViewToggle icons bumped to 24px (from 16px), labels hidden
   - Search and Add become icon-only buttons flanking the view tabs
   - Theme toggle moves to a settings sheet or long-press gesture (too infrequent for primary nav)
   - Touch targets: 48px minimum per button
4. **Main content**: Add `pb-[calc(56px+env(safe-area-inset-bottom))]` on mobile to prevent overlap
5. **Hide top bar on mobile**: `hidden` at `(pointer: coarse)`, replaced by bottom bar
6. **Scope toolbar** (bottom bar on desktop for breadcrumbs): On mobile, move scope info into a collapsible header within the content area or a swipe-down sheet

### Touch targets

| Element | Desktop | Mobile |
|---------|---------|--------|
| View toggle buttons | 36×32px | 48×48px |
| Search icon | 28px | 48px |
| Add button | auto×32px | 48px |
| Icons | 16px | 24px |

---

## Phase 2: Bridge Tab Mobile Polish

The Bridge tab already has basic mobile support (touch drag, read-only titles). Additional improvements:

1. **Task cards**: Increase vertical padding from `py-2.5` to `py-3` on mobile for better touch targets
2. **Add task**: Move the `+ Add` action into the bottom bar (already planned in Phase 1)
3. **Task detail panel**: On mobile, present as a bottom sheet (slide up) instead of a side panel
4. **Lifecycle dots**: Increase from 8px to 12px on mobile for easier tapping
5. **Project board**: Cards already stack vertically; verify horizontal scroll works for project columns on mobile

---

## Phase 3: Docs Tab Mobile

**Current**: Two-column layout (file tree sidebar + content pane) with 180-500px resizable sidebar.

### Mobile layout: Full-screen panels with drill-down navigation

```
State 1: File tree (full screen)          State 2: File content (full screen)
┌──────────────────────────┐              ┌──────────────────────────┐
│ [< Scope] ~/project  [⋮] │              │ [< Back]  README.md  [⋮] │
│────────────────────────── │              │────────────────────────── │
│ 📁 src                 > │   tap →      │                           │
│ 📁 docs                > │              │  # My Project             │
│ 📄 README.md           > │              │                           │
│ 📄 package.json          │              │  This is the readme...    │
│                           │              │                           │
└──────────────────────────┘              └──────────────────────────┘
```

### Implementation

1. **`DocsView.tsx`**: On mobile, render a single-panel layout instead of side-by-side
   - Default: show file tree full-width
   - When a file is selected: push to content view with back button
   - Use CSS transitions (slide left/right) for the panel switch
2. **File tree rows**: Increase height to 48px, icon to 20px, font to 15px
3. **Content pane**: Full-width, reduce `px-12` padding to `px-4` on mobile
4. **Edit mode**: On mobile, tapping the edit toggle enters a full-screen editor
5. **Breadcrumbs**: Horizontal scroll with gradient fade (already works), but increase height to 44px
6. **File actions** (copy, reveal): Move to a `⋮` overflow menu (bottom sheet) instead of hover-only icon buttons
7. **Resize handle**: Hidden on mobile (single-panel, no split to resize)

---

## Phase 4: Stack Tab Mobile

**Current**: Two-column layout (file tree + detail pane) with 200-600px sidebar, hover-dependent tooltips.

### Mobile layout: Same drill-down pattern as Docs

```
State 1: Config tree (full screen)        State 2: Detail view (full screen)
┌──────────────────────────┐              ┌──────────────────────────┐
│ Stack                 [⋮] │              │ [< Back]  MCP Servers    │
│────────────────────────── │              │────────────────────────── │
│ ▼ Project                 │              │ claude-in-chrome          │
│   📝 CLAUDE.md            │   tap →      │ Status: Connected ●      │
│   ⚙️ settings.json        │              │ Type: stdio              │
│   🔌 MCP Servers       > │              │                           │
│   🧩 Plugins           > │              │ [Enable] [Edit] [Reveal] │
│ ▼ User                    │              │                           │
│   📝 CLAUDE.md            │              │ Auth: Valid (expires 2h)  │
└──────────────────────────┘              └──────────────────────────┘
```

### Implementation

1. **`StackView.tsx`**: Same single-panel pattern as Docs on mobile
   - File tree full-screen as default
   - Selecting an item pushes to detail view
   - Back button returns to tree
2. **Tree rows**: 48px height minimum, 20px icons
3. **StackSummary filter buttons**: Replace hover tooltips with tap-to-toggle (already functional, just needs larger targets)
4. **MCP/Plugin detail panes**: Full-width on mobile, increase button sizes
5. **Enable/disable toggles**: 48px touch target minimum
6. **Auth status dots**: Increase from 4px to 8px, or use text labels on mobile
7. **Resize handle**: Hidden on mobile

---

## Phase 5: Scope Toolbar Adaptation

The bottom scope toolbar (breadcrumbs, pinned folders, browse) conflicts with the mobile bottom nav bar.

### Mobile approach

- **Remove the fixed bottom scope bar** on mobile
- **Scope breadcrumb**: Move to a compact header row at the top of the content area (below the content header)
- **Pinned folders / Browse**: Accessible via the `⋮` overflow or a dedicated "Folders" button in the bottom nav
- **Recent scopes**: Move to a bottom sheet triggered from the scope breadcrumb

---

## Phase 6: Browser-Driven Testing

**Goal**: Verify every tab and key interaction on both mobile and desktop viewports using `agent-browser` automation. Read-only — no data modification.

### Test matrix

Each test path is run at two viewports:
- **Desktop**: 1440×900 (standard laptop)
- **Mobile**: 393×852 (iPhone 14 Pro)

### Test paths

#### 6.1 Navigation (both viewports)

1. App loads, correct tab is active
2. Click/tap each tab (Bridge → Docs → Stack → Bridge) — verify content switches
3. On mobile: bottom bar is visible, top bar is hidden
4. On desktop: top bar is visible, no bottom bar
5. Search icon opens search, typing filters, clearing restores
6. Add button is reachable and opens add flow

#### 6.2 Bridge tab

1. Task list renders with To Do / Done sections
2. Tasks with 🆕 markers show yellow dot in left margin
3. Tasks with ⁉️ markers show blue dot, appear unchecked in Done section
4. Tap a task row → detail panel opens (side panel on desktop, bottom sheet on mobile)
5. Tap back/close → returns to list
6. On mobile: title text is NOT editable (no keyboard popup on tap)
7. On mobile: checkbox is tappable (verify hit target)
8. Scroll through full task list — no layout breaks

#### 6.3 Docs tab

1. File tree renders with folders and files
2. Tap a folder → expands (desktop) or drills in (mobile)
3. Tap a markdown file → content renders in pane (desktop: side-by-side, mobile: full-screen push)
4. On mobile: back button returns to file tree
5. Breadcrumbs are visible and horizontally scrollable
6. On desktop: resize handle works, file actions visible on hover
7. On mobile: no resize handle, file actions in overflow menu
8. Content is readable — no horizontal overflow, adequate padding

#### 6.4 Stack tab

1. Config tree renders with layer groups (Project, User, System)
2. Expand a layer → see file types
3. Tap a config file → detail pane opens (desktop: side-by-side, mobile: full-screen push)
4. On mobile: back button returns to tree
5. MCP server items show status indicators
6. Plugin items expand to show children
7. Filter buttons are tappable on mobile (48px targets)
8. On desktop: hover tooltips appear on filter buttons

#### 6.5 Cross-cutting checks

1. Theme toggle works (light → dark → system) on both viewports
2. No content hidden behind bottom bar on mobile (scroll to bottom of each view)
3. No horizontal scrollbar on any view at mobile width
4. All text is readable (minimum 14px on mobile)
5. Safe area padding present on mobile (content not behind notch/home indicator)

### Implementation approach

Each test uses `agent-browser` CLI via Bash:

```bash
# Desktop test session
agent-browser --session hilt-test open http://localhost:3000 --headed
agent-browser --session hilt-test set viewport 1440 900
agent-browser --session hilt-test snapshot -i  # verify layout
agent-browser --session hilt-test screenshot desktop-bridge.png

# Mobile test session
agent-browser --session hilt-mobile open http://localhost:3000 --headed
agent-browser --session hilt-mobile set viewport 393 852
agent-browser --session hilt-mobile snapshot -i
agent-browser --session hilt-mobile screenshot mobile-bridge.png
```

Key rules:
- **Read-only**: Only click navigation elements, tabs, expand/collapse. Never edit text fields, toggle checkboxes, or modify data.
- **Snapshot over screenshot**: Use `snapshot -i` for DOM text verification, screenshots for visual layout checks.
- **Separate sessions**: `hilt-test` (desktop) and `hilt-mobile` (mobile) to run in parallel.
- **Evidence**: Save screenshots to `docs/plans/mobile-responsive-evidence/` for review.

---

## Claude Code Team Execution

### Team setup

```
TeamCreate: "mobile-responsive"
```

### Task list and agent assignments

Tasks are created with `TaskCreate`, assigned to agents spawned with `Task` tool using `team_name: "mobile-responsive"`.

#### Tasks

| ID | Task | Agent | Blocked by | Phase |
|----|------|-------|-----------|-------|
| 1 | Create worktree, useIsMobile hook, CSS variables | `lead` | — | 0 |
| 2 | Extract NavBar component, implement floating bottom bar | `nav` | 1 | 1 |
| 3 | Bridge tab mobile polish (padding, dots, bottom sheet) | `bridge` | 1 | 2 |
| 4 | Docs tab single-panel mobile layout | `docs` | 1, 2 | 3 |
| 5 | Stack tab single-panel mobile layout | `stack` | 1, 2 | 4 |
| 6 | Scope toolbar mobile adaptation | `scope` | 2 | 5 |
| 7 | Desktop regression test (agent-browser, 1440×900) | `test-desktop` | 2,3,4,5,6 | 6 |
| 8 | Mobile UX test (agent-browser, 393×852) | `test-mobile` | 2,3,4,5,6 | 6 |

### Agent roles

| Agent name | Type | Tools needed | Description |
|------------|------|-------------|-------------|
| `lead` | team lead (you) | all | Worktree setup, task coordination, final review |
| `nav` | `general-purpose` | edit, write, bash | NavBar extraction + bottom bar |
| `bridge` | `general-purpose` | edit, write, bash | Bridge tab mobile touch refinements |
| `docs` | `general-purpose` | edit, write, bash | Docs tab drill-down mobile layout |
| `stack` | `general-purpose` | edit, write, bash | Stack tab drill-down mobile layout |
| `scope` | `general-purpose` | edit, write, bash | Scope toolbar mobile adaptation |
| `test-desktop` | `general-purpose` | bash (agent-browser) | Desktop viewport regression testing |
| `test-mobile` | `general-purpose` | bash (agent-browser) | Mobile viewport UX testing |

### Execution flow

```
lead: Phase 0 (worktree + shared hook)
  │
  ├─ TaskUpdate: mark task 1 complete
  ├─ SendMessage → nav: "Task 2 is unblocked, begin Phase 1"
  ├─ SendMessage → bridge: "Task 3 is unblocked, begin Phase 2"
  │
  │   nav works on Phase 1          bridge works on Phase 2
  │   ─────────────────────         ────────────────────────
  │   TaskUpdate: task 2 done       TaskUpdate: task 3 done
  │
  ├─ SendMessage → docs: "Tasks 2+1 done, begin Phase 3"
  ├─ SendMessage → stack: "Tasks 2+1 done, begin Phase 4"
  ├─ SendMessage → scope: "Task 2 done, begin Phase 5"
  │
  │   docs works on Phase 3     stack works on Phase 4     scope works on Phase 5
  │   ─────────────────────     ──────────────────────     ──────────────────────
  │   TaskUpdate: task 4 done   TaskUpdate: task 5 done    TaskUpdate: task 6 done
  │
  ├─ All implementation tasks complete
  ├─ SendMessage → test-desktop: "Run desktop regression tests"
  ├─ SendMessage → test-mobile: "Run mobile UX tests"
  │
  │   test-desktop (1440×900)          test-mobile (393×852)
  │   ─────────────────────────        ────────────────────────
  │   agent-browser: all paths         agent-browser: all paths
  │   screenshots + snapshots          screenshots + snapshots
  │   TaskUpdate: task 7 done          TaskUpdate: task 8 done
  │
  └─ lead: Review test results, fix any issues, merge or report
```

### Spawning agents

Each implementation agent is spawned via `Task` tool:

```
Task(
  subagent_type: "general-purpose",
  team_name: "mobile-responsive",
  name: "nav",
  prompt: "You are the nav agent. Your task is..."
)
```

Test agents are also `general-purpose` but their prompts focus on `agent-browser` commands and read-only verification.

### Communication protocol

- **Lead → agents**: `SendMessage` with task assignments and unblock notifications
- **Agents → lead**: `SendMessage` on completion, blocker, or question
- **Between agents**: Direct `SendMessage` only when coordination is needed (e.g., docs-agent needs to know NavBar's mobile content padding class name)
- **Task tracking**: All agents use `TaskUpdate` to mark tasks in_progress/completed
- **No broadcasts**: Use targeted messages only

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useIsMobile.ts` | New: shared mobile detection hook |
| `src/app/globals.css` | Add mobile CSS variables, safe area support |
| `src/components/Board.tsx` | Extract NavBar, add mobile content padding |
| `src/components/ViewToggle.tsx` | Responsive icon/target sizes |
| `src/components/NavBar.tsx` | New: renders top (desktop) or bottom (mobile) |
| `src/components/DocsView.tsx` | Single-panel mobile layout |
| `src/components/DocsFileTree.tsx` | Larger touch targets |
| `src/components/DocsContentPane.tsx` | Full-width mobile, overflow menu |
| `src/components/StackView.tsx` | Single-panel mobile layout |
| `src/components/stack/StackFileTree.tsx` | Larger touch targets |
| `src/components/bridge/BridgeTaskItem.tsx` | Larger padding/dots on mobile |
| `src/components/bridge/BridgeTaskPanel.tsx` | Bottom sheet on mobile |
