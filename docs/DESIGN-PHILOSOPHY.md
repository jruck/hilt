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

### 2026-05-19: Map View — Controls as Operational Chrome

**Change**: Map moved from a title/sidebar prototype to a compact top toolbar with activity, status, source, refresh, counts, and collapsed diagnostics.

**Pattern established**:
- Prefer compact control bars for operational views where the data visualization is the primary surface.
- Selection summaries belong in the control chrome when possible; avoid adding standalone header rows above dense visualizations.
- Click-selected means toggle-selected for exploratory Map surfaces: clicking the selected treemap block or session again should return to the broader state.
- Keep provider/source diagnostics available but collapsed; they are troubleshooting material, not the main mental model.
- Mobile Map should stage the workflow: tree first, sessions after selecting a non-root node, history after selecting a session.
- Source/status controls should filter both the visual tree and session list. Counts can live in the controls as feedback.
- Activity heat is a layout signal, not user-facing language. Use it to size/order the map, but expose plain operational counts like sessions, workspaces, and active sessions instead of raw heat values.
- Responsive Map chrome should shed nonessential summary text before hiding primary controls, but not too early. Use a custom intermediate breakpoint when needed so the selected summary stays visible while there is still comfortable toolbar space; filters should collapse behind the compact filter button only at the next narrower breakpoint.
- Keep selected-session inspection as a three-column desktop/tablet layout whenever there is room for more than mobile flow. The treemap should shrink before the history preview wraps below the map; wrapping the detail panel under the visualization makes the Map feel like it changed modes.
- Map status should describe mental visibility, not only mapping confidence. Foreground means human-legible work; background means disposable workers, sidechains, unmapped, automation-like, stale, or explicitly suppressed sessions.
- Treat preserved first user prompts as strong human intent signals for Codex desktop/Mac-app/remote-control sessions. Some Codex rows do not set explicit human-event flags even when they were human-initiated, so the visible prompt/title is often the best foreground clue.
- Treat readable user turns as sufficient foreground evidence unless an explicit automation/worker signal wins first. Missing generated titles should not hide real human conversations; use the first user turn as the fallback title when needed.
- Treat Codex worker/subagent lineage as part of human intent. A worker spawned by an already-foreground human-led parent belongs with foreground work unless an explicit automation/workspace suppression signal wins.
- The Map should show where work actually happened, not only where a session started. Use metadata-only path/tool signals to add nested folder detail under workspaces. When a parent tile has enough room, show its children inline inside the tile; use click-through drilldown only as the fallback for smaller areas. Parent tile labels must keep their own reserved header space so nested child content never overlaps the parent context.
- For OpenClaw/Claude sessions, classify by prompt source before folder. Slack DMs from Justin and plain prompts are foreground even inside OpenClaw workspaces; `isUser=false` inter-session routes, heartbeat checks, continued transcript bootstraps, update notices, cron prompts, and probe sessions are background even though Claude records them as `user` turns.
- Prefer explainable automatic suppression over manual overrides. Known automation workspaces can be backgrounded by path/workspace heuristics when they otherwise look human-titled, but the reason should remain visible in the session row.
- Background status should not use warning iconography. A small amber dot is enough to signal lower salience without implying something is wrong.

**Rationale**: The Map is meant to restore situational awareness, so the first viewport should be the work state itself. Explanatory headers and always-open filter sidebars dilute that purpose.

### 2026-05-19: Source Management — Order Is Intent

**Change**: Source startup and fallback now follow the order shown in Manage Sources, regardless of whether entries are local or remote.

**Pattern established**:
- Drag order is the default library preference. The top available source should win at app startup.
- Source type should explain behavior and display, not secretly override priority.
- Availability is the only reason to skip a higher-ranked source; fall through the list in order before using a hardcoded local fallback.

**Rationale**: The source picker is the user-facing control for default context. If the app silently privileges local sources, the configured order stops being trustworthy.

### 2026-05-21: Local Apps — App-First Machine Inspection

**Change**: Added Local Apps as a monitor-only Apps tab for local/tailnet service inspection.

**Pattern established**:
- Group services by app/worktree first, not by individual port.
- Keep destructive process controls out of the first surface; opening a URL is the only primary action.
- Show machine identity and scan freshness in the view chrome so remote/Tailscale use is always grounded.
- When multiple Hilt machines are visible on the tailnet, machine context should stay visible but does not need to own the layout. A camera-wall grid can flatten apps across machines as long as each tile labels its source machine clearly.
- Cards should be dense and operational: the screenshot or fallback should be the whole tile, with app title, path, machine label, freshness, and compact service chips overlaid on the visual surface.
- Camera-wall tiles can use a larger `rounded-2xl` radius and pronounced shadow without an outer stroke, with matching rounded overlay chips/buttons, so preview cards read as lifted monitor tiles without becoming decorative.
- Screenshot previews should show the app as the user would open it over the tailnet where possible. Keep fallback states honest: no web UI, HTTP status, or capture error is better than a stale decorative placeholder.
- Manual refresh should mean "make this view current," including screenshot recapture when previews are enabled. Show screenshot freshness directly on the preview instead of making users infer whether an image is stale.
- Screenshot recapture should be tied to visible viewing intent: first visible load, manual refresh, visible tab return when stale, and a visible two-minute cadence. Background metadata polling should not spend machine resources recapturing previews.
- Use source signals, hidden reasons, and diagnostics for explainability, but keep them secondary to the app overview.

**Rationale**: Local Apps is situational awareness for running dev surfaces. It should answer "what is live on this machine?" without becoming a process manager or generic cloud dashboard.

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
