# Design Philosophy

This document captures design preferences, principles, and patterns observed while building Hilt. It serves as actionable guidance for AI assistants working on this project to produce designs that align with the user's aesthetic and interaction preferences.

**Purpose**: Help future AI assistants design features and interfaces that the user will likely approve without extensive iteration.

**How to use this document**:
1. Read this before proposing or implementing UI changes
2. Apply these principles as defaults unless explicitly overridden
3. When this document conflicts with a direct user request, follow the user's request
4. After completing UI work, consider what was learned and update this document

---

## Core Principles

### 1. Information Density Over Whitespace

Prefer compact layouts that show more information at once. The user works on a laptop and values screen real estate. Reduce padding, margins, and decorative spacing where it doesn't harm readability.

**Examples observed**:
- Status bar height reduced from 56px to 44px
- Column headers kept minimal
- Cards designed to show maximum metadata without expanding

### 2. Subtle Over Loud

Use restraint with visual effects. Prefer subtle borders, gentle color tints, and understated hover states over bold shadows, bright colors, or dramatic animations.

**Color approach**:
- Use tinted backgrounds (e.g., `emerald-500/5`) rather than solid colors
- Borders should be semi-transparent (e.g., `border-emerald-500/20`)
- Avoid pure white or pure black in dark mode - use zinc tones

### 3. Contextual Color Meaning

Colors should communicate state, not decorate:
- **Blue/indigo tints**: Items needing attention (To Do, inbox)
- **Emerald tints**: Active/running/live states
- **Amber tints**: Starred/pinned items
- **Zinc tones**: Default/neutral states

### 4. Progressive Disclosure

Don't show everything at once. Reveal complexity through interaction:
- Action buttons appear on hover (floating toolbar pattern)
- Collapsible sidebar for pinned folders
- Expandable sections in columns (time-based grouping)

### 5. Immediate Feedback

Every action should have visible feedback:
- Pulsing indicators for running sessions
- Glow effects for newly appearing items
- Loading states that don't cause layout shift

---

## Specific Patterns

### Cards

**Floating Action Toolbar** (Notion-style):
- Action buttons grouped in a floating toolbar inside the card
- Appears on hover, positioned top-right
- Background color matches card state (blue for todo, emerald for active)
- Icons are neutral (zinc-200), no colored hover states on icons themselves

**Card States**:
- Active/running: emerald border tint, emerald background tint
- Selected: blue border tint, blue background tint
- New: green glow that fades over 60 seconds
- Default: zinc background, subtle border

### Navigation

**Breadcrumb-style scope navigation**:
- Clickable path segments
- Dropdown for subfolders
- Pin button to save frequently used paths
- Recent scopes accessible via clock icon

### Drawers/Panels

**Right-side drawer pattern**:
- Resizable via drag handle
- Handle should lighten on hover (not thicken)
- Content area adjusts padding dynamically
- Tabs for multiple items within drawer

### Icons

- Use Lucide React icons consistently
- Prefer outlined icons over filled
- Size 16-20px for inline/button icons
- Don't use emojis in UI (unless in user content)

---

## Interaction Preferences

### What to Avoid

- **Over-the-top animations**: No bouncing, no dramatic transitions
- **Modal dialogs for simple actions**: Prefer inline editing
- **Confirmation dialogs**: Only for truly destructive actions
- **Tooltips that obscure content**: Use native title attributes or subtle positioning
- **Multiple focus rings/highlights**: One visual indicator per state

### What Works Well

- Instant visual feedback (color change on hover)
- Keyboard shortcuts for power users
- Drag-and-drop for reordering
- Click-to-edit for text fields
- Persistent state (localStorage for preferences)

---

## Technical Patterns

### CSS/Styling

- Tailwind CSS with semantic color usage
- CSS variables for theming (`--status-active-*`, `--status-todo-*`)
- Prefer `ring-*` utilities over `outline-*` for focus states
- Use `transition-colors` for hover effects, not `transition-all`

### Component Structure

- Keep components focused on single responsibility
- Extract reusable UI pieces (LiveIndicator, floating toolbar)
- Use React refs for stable values that shouldn't trigger re-renders

---

## Evolution Log

This section tracks design decisions and refinements over time. Each entry should note what was tried, what was rejected, and why.

### 2026-01-09: Hierarchical View Toggle

**Change**: Restructured view toggle from 4 equal options to a hierarchical system.

**Pattern established**:
- **Primary toggle** for conceptually different areas (Tasks, Docs, Stack)
- **Secondary toggle** for view modes within an area (Board vs Tree for Tasks)
- Secondary toggles are compact/icon-only to reduce visual weight
- Contextual controls (Filter, Search) hidden when not applicable

**Rationale**: Tree and Board views are both task-related, showing the same data differently. Docs and Stack are separate domains. Grouping related views reduces cognitive load and clarifies the app's mental model.

**Implementation note**: Single underlying `viewMode` state preserves backwards compatibility. Primary/secondary views derived from it, avoiding state migration.

### 2025-01-06: Initial Documentation

**Established patterns**:
- Floating action toolbar (replaced gradient background approach)
- Emerald color palette (replaced generic green)
- Compact 44px status bar (reduced from 56px)
- Three-level view toggle (Tree, Board, Docs)

**Rejected approaches**:
- Gradient backgrounds behind action buttons (obscured text)
- Thick border on resize handle hover (too aggressive)
- Trash icon for "mark as done" action (misleading)

### 2026-02-17: People Tab — Scope Reuse for Deep Links

**Change**: People tab reuses the URL scope mechanism for person deep links (`/people/amrit`).

**Pattern established**:
- Views that don't use filesystem paths can repurpose the scope segment for their own identifiers
- Board.tsx skips filesystem validation for non-file-based views (bridge, briefings, people)
- PeopleView reads the slug from scopePath and uses `navigateTo("people", "/slug")` for selection
- Browser back/forward works naturally through the existing ScopeContext popstate handling

**Rationale**: Avoids adding a separate query parameter or routing mechanism. The scope is just a string — it works for paths or slugs equally. Validation is the only gotcha, handled by a simple view-type check.

### 2026-02-17: Meeting Feed — Cards with Tabs, Not Merged Artifacts

**Change**: Redesigned meeting display from merged expandable artifacts to a card-per-meeting feed with tabbed views.

**What was tried and rejected**:
- Merging same-date inline notes + Granola summaries into one entry with expandable sections. User found the merge logic confusing — "I don't like merging my notes." The relationship between sources wasn't clear.
- Source badges (Notes/Granola pills) on each card. Removed — the filter bar conveys source info without cluttering every card.

**Pattern established**:
- One card per meeting entry (no merging by date). Each card is a bordered container with date header and content.
- Cards with multiple artifact types show a **tab bar** (Written Notes / Summary / Transcript). Single-source cards render content directly, no tabs.
- **Written notes are the default tab** when available — these are the user's own words and take priority over machine-generated summaries.
- Written notes are **editable in-place** using the same tiptap `BridgeTaskEditor` used for task details. Saves via `PUT /api/bridge/people/:slug/notes`.
- **Feed-level filter** (All / Written / Recorded) with counts lets user focus on just their handwritten notes. Filter sits right-aligned next to the "Meetings" heading.
- No expand/collapse — cards always show full content.

**Rationale**: The user's handwritten notes are the primary artifact. Granola summaries and transcripts are supplementary reference material. The card+tab pattern keeps each meeting self-contained while the feed filter provides the real power: "show me only what I wrote."

### 2026-02-17: Scope Simplification

**What changed**: Removed all scope-switching UI — breadcrumbs, browse button, recent scopes button, pinned folders popover, and the bottom toolbar. Scope now permanently equals the working folder.

**Why**: Hilt evolved from a general session browser (where navigating between project folders was the core interaction) to a Bridge-centric task manager with a docs tab. The scope-switching machinery was vestigial complexity — users weren't switching tree roots, they were navigating within a single tree. The URL path after `/docs/` now represents the selected file for deep linking, not the tree root.

**Pattern**: When a feature's original use case disappears, delete the feature — don't preserve it "just in case." 14 files deleted, zero functionality lost.

---

*This document should grow as design work continues. After UI changes are committed, consider what preferences or principles the changes reveal and add them here.*
