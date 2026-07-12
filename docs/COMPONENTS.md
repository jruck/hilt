# Components Reference

React component architecture and key implementation details.

## Component Hierarchy

```
App (layout.tsx)
└── Board.tsx (~275 lines) ──────────────────────────────────────────────
    │
    ├── Floating Navigation Chrome
    │   ├── Search input (expandable)
    │   ├── ThemeToggle
    │   └── ViewToggle (Briefing/Bridge/Calendar/People/Library/Docs/System) — centered
    │
    ├── Main Content (conditional on viewMode)
    │   │
    │   ├── viewMode === "bridge"
    │   │   └── BridgeView
    │   │       ├── WeekHeader
    │   │       ├── BridgeTaskList
    │   │       │   └── BridgeTaskItem × N
    │   │       ├── BridgeTaskPanel / BridgeTaskDetail / BridgeTaskEditor
    │   │       ├── BridgeNotes
    │   │       ├── ProjectCard × N
    │   │       ├── ProjectKanban
    │   │       ├── ProjectPicker
    │   │       └── RecycleModal
    │   │
    │   ├── viewMode === "docs"
    │   │   └── DocsView
    │   │       ├── DocsBreadcrumbs
    │   │       ├── DocsFileTree
    │   │       │   └── DocsTreeItem × N
    │   │       ├── DocsContentPane
    │   │       │   ├── DocsEditor (markdown editing)
    │   │       │   ├── DocsEditToggle
    │   │       │   ├── CodeViewer
    │   │       │   ├── CSVTableViewer
    │   │       │   ├── ImageViewer
    │   │       │   ├── PDFViewer
    │   │       │   └── DocsFallbackView
    │   │       └── DocsEditToggle
    │   │
    │   ├── viewMode === "stack"
    │   │   └── StackView
    │   │       ├── StackFileTree
    │   │       ├── StackContentPane
    │   │       │   ├── StackSummary
    │   │       │   ├── MCPServerDetail
    │   │       │   └── PluginDetail
    │   │       └── CreateFileDialog
    │   │
    │   └── viewMode === "map"
    │       └── MapView
    │           ├── Compact filter toolbar
    │           ├── Treemap work graph
    │           ├── Paginated sessions panel
    │           └── Session history preview
    │
    └── Bottom Toolbar (hidden on Bridge view)
        ├── ScopeBreadcrumbs
        │   └── PinButton (inline)
        ├── RecentScopesButton
        ├── BrowseButton
        └── PinnedFoldersPopover
```

## Core Components

### Board.tsx

**File**: `src/components/Board.tsx` (~275 lines)

Main container component managing scope, view routing, and toolbar layout.

**Key State**

```typescript
const [homeDir, setHomeDir] = useState<string>("");
const [workingFolder, setWorkingFolder] = useState<string | undefined>(undefined);
const [docsInitialFile, setDocsInitialFile] = useState<string | null>(null);
const [searchQuery, setSearchQuery] = useState<string>("");
```

**View Routing**

Derives `viewMode` from the URL and renders the appropriate view:

```typescript
const viewMode: ViewMode = urlViewMode === "bridge" ? "bridge"
  : urlViewMode === "docs" ? "docs"
  : urlViewMode === "briefings" ? "briefings"
  : urlViewMode === "library" ? "library"
  : urlViewMode === "people" ? "people"
  : urlViewMode === "system" || urlViewMode === "map" || urlViewMode === "local-apps" || urlViewMode === "stack" ? "system"
  : "bridge"; // fallback
```

**Data Fetching**

- Fetches home directory and working folder from `/api/folders`
- Validates scope path against server
- Persists view mode preference via `/api/preferences`

**Key Behaviors**

- Defaults to Bridge view when no URL prefix is present (e.g., Electron app startup)
- Keeps Map, Apps, Stack, and Sync under the System tab
- Includes the Library route for file-native references, hidden candidates, source filtering, and promotion
- Supports cross-view navigation (e.g., Bridge project click navigates to Docs view)
- On mobile, the Docs file tree drawer uses `MobileChromeContent` so its scrollable body starts below the visible hideable document toolbar and does not sit under sticky chrome.

---

### ViewToggle.tsx

**File**: `src/components/ViewToggle.tsx` (~52 lines)

Primary toggle for view modes.

```typescript
type ViewMode = "briefings" | "bridge" | "docs" | "library" | "people" | "system";
```

`ViewToggle` accepts `unreadTabs` for quiet top-level unread dots. Briefing uses its read-state check, and Library uses `/api/library/unread` so the shell can show a dot without loading the full Library feed.

Compact mobile mode uses the mobile nav theme tokens (`--nav-mobile-*`) for active/inactive icon contrast so the floating bottom pill works over both light and dark content.

**View Configuration**

| View | Icon | Description |
|------|------|-------------|
| Briefing | CalendarDays | Daily briefing |
| Bridge | Compass | Weekly tasks and projects |
| Calendar | CalendarDays | Read-only unified calendar |
| People | Users | People and meeting history |
| Library | Bookmark | Reference feed, candidates, source browse, and search |
| Docs | FileText | Documentation browser/editor |
| System | Layers | System inspection modes |

---

### CalendarView.tsx

**File**: `src/components/calendar/CalendarView.tsx`

Read-only unified calendar backed by local ICS sync and Schedule X.

**Key behaviors**

- Uses Schedule X for day, week, month, and agenda views, while Hilt owns the toolbar, source menu, event detail content, and read-only data model.
- Uses Schedule X plugins for event updates, calendar controls, current-time indication, scroll control, anchored event modal positioning, and background availability bands.
- Keeps EverCommerce punctuation blockers (`!` and `-`) out of the visible event query, but returns them as availability blocks so the UI can render subtle background blocked-time hints.
- Adds a purple US Holidays source from a public ICS feed and filters that feed to public-holiday all-day events, excluding broad observances.
- Shows EverCommerce blocker background hints only on Monday-Friday non-holiday business days.
- Marks non-EverCommerce timed events during 9 AM-5 PM Eastern business days with a compact warning when no EverCommerce event or hidden blocker fully covers that range.
- Adds daily weather forecast chips to the Schedule X day/week headers through the `weekGridDate` custom component. Forecast data comes from Hilt's `/api/weather/forecast` route, defaults to Atlanta ZIP 30310, and links to weather.gov for fuller details.
- Keeps event detail content Hilt-native through the `eventModal` custom component hook, so future meeting notes, people records, docs, and Bridge tasks can attach to stable Hilt calendar event IDs.
- Collects every event action into one row at the top of the detail popover: live join links (Teams/Meet/Zoom, first one styled as the primary action), a `Notes` button that jumps to the linked Granola meeting note in People, and an `Open in Google`/`Open in Outlook` external link derived from the provider URL. The free-text event body is labeled `Description` to disambiguate it from linked meeting notes.
- Accepts a `/event/<encoded id>/<YYYY-MM-DD>` deep link via the scope path. On arrival it lands on the event's date, focuses the event, scrolls it into view, and opens its popover once the date's events load. A guard ref keeps later manual navigation from being yanked back to the deep-linked event.

**Custom Plugin Breadcrumb**

Schedule X custom plugins can add behavior to the shared calendar app object through `beforeRender`, `onRender`, range/timezone hooks, and Hilt-prefixed app fields. Prefer this path when calendar intelligence needs cross-cutting state, for example meeting-note links, people-directory badges, Bridge task indicators, transcript/prep status, or availability audits. Keep provider sync and event storage in Hilt services; use plugins only for calendar surface behavior and metadata overlays.

---

### MapView.tsx

**File**: `src/components/map/MapView.tsx`

Local work-state map backed by `/api/map/local/*`.

**Key behaviors**

- Uses a compact top control bar for activity window, visibility status (`Foreground`/`Background`), source, refresh, counts, and collapsed diagnostics.
- Fetches `/api/map/local/work-graph` for tree/count data and `/api/map/local/sessions` for paginated session summaries.
- Fetches `/api/map/local/session-detail` only after the user selects a session.
- Shows copyable Map session ids in session rows and history preview so a session can be referenced from chat or searched later.
- Desktop presents tree, sessions, and history as separate panes. Mobile keeps a staged flow: tree first, sessions after a non-root tree selection, history after session selection.

---

### LibraryView.tsx

**File**: `src/components/library/LibraryView.tsx`

Reference Library workspace backed by markdown reference files and hidden candidate files in the bridge vault.

**Key behaviors**

- Uses one composable Library surface instead of separate Feed and Browse destinations.
- Defaults to Feed density with `Recent` ranking, `All` lifecycle status, no source sidebar, and no reader pane until an item is opened.
- Independent controls: `Filters` toggles the filter rail, `Feed/List` controls density, and `Recent/For You/New` controls ranking. `New` is the unread-only slice across saved references and candidates. Lifecycle status is filtered inside the filter rail under `Status` (`All`, `Saved`, `Candidates`), not in the top toolbar.
- The filter rail owns `Mode` at the bottom: `Study` is the default review/weaving surface, and `Keep` is the quiet durable archive for products, shopping, recipes, restaurants, clothing, furniture, and similar saved-for-later material. Keep-mode items remain searchable but do not light the top-level Library unread dot.
- Selected sources can expose child facets from source-native taxonomy. Raindrop uses collection names and bookmark tags where available; X/Twitter can use bookmark-folder metadata when configured. YouTube sources are grouped under a single `YouTube` parent with Bookmarks, Watch Later, liked videos, and channel sources beneath it. Email sources are grouped under `Newsletters`, with sender facets such as `AI News` or `Lenny` beneath the group. These facets are distinct from the source label itself, so cards show useful chips like `AI`, `furniture`, or `agents` rather than plumbing labels like `bookmark` or `raindrop`.
- `Recent` ranks by source publication/capture date first, then uses precise ingestion metadata such as `captured_at` and `digested_at` only as a same-day tie-breaker.
- `For You` is one cursor-paginated feed, not an eight-item score view or a set of daily sections. Pages deduplicate by stable artifact id; a new episode for an existing artifact updates the same card's recommendation pitch, shows a restrained `Recommended again` marker, and moves it to the top.
- `FeedCard` has explicit `standard` and `recommendation` variants. For You renders the episode pitch as the sole unlabeled description. Recent/New/Search render only the evergreen source description; a current recommendation adds a quiet sparkle with an `In For You · recommended …` tooltip rather than injecting a second paragraph. Numeric eval scores stay in detail/admin disclosure.
- Recommendation dismiss/comment actions are distinct from Save, Skip, and Archive. Dismissal hides only the recommendation episode, accepts optional thread-backed feedback, and uses a toast Undo. Impressions fire only after a card is visible.
- WebSocket recommendation batches insert immediately near the top. When the feed is scrolled deeper, the first visible card remains anchored and a quiet `N new items` control defers the jump.
- Feed density stays full-width until an item is selected. Selecting the active Feed card again clears the reader and restores the full-width feed.
- List density gives the old Browse/inbox scanning behavior, always reserves the reader slot on desktop, auto-selects the first visible row when possible, and shows a placeholder when no item is selected.
- Unread indicators are deliberately quiet: Feed cards and List rows show a small blue dot, the toolbar shows a `new` count beside the current item/pick count, and the source rail shows per-status/per-source unread badges.
- Feed/List scrolling never marks unread items read. A Library item becomes read only after it has been opened and the reader moves away from it by selecting another item, closing the reader, or backing out of detail. Auto-selection does not count as reading.
- Desktop filter/content columns use slim persisted resize handles; defaults keep the filter rail narrow, the list/feed pane scannable, and the detail reader as the largest pane. On narrower widths the filter rail floats as a popover with its own shadow and no page-dimming backdrop.
- `LibraryArtifactDetailPane` is shared across densities so rendered Markdown, media embeds, cache/source tabs, Save/Dismiss, and archive behavior stay consistent.
- The detail pane separates both copy roles: an unframed `Recommended for you` callout carries the pitch and recommendation date, followed by the normal source digest. Links from For You and Briefing carry `rec=<episode-id>` and passively hydrate that exact historical pitch; ordinary Library opens use the current active episode. Neither standard-feed indicators nor detail hydration report recommendation impressions.
- `LibraryArtifactDetailPane` strips legacy manual-capture body chrome before rendering summaries, so old `← References` links and bold source/author/date clusters do not leak into the reader. The underlying repair CLI removes the same cruft from markdown files.
- YouTube media is rendered through `YouTubeEmbed`, which uses the YouTube IFrame API plus direct embed commands to prefer 2x playback, keep the same iframe alive as a floating mini-player only while playback is active after the inline embed scrolls away, and accept seek requests from transcript rows. The floating player has hover controls to move, resize, or return it inline, and the reader adds bottom clearance while it is visible.
- X/Twitter media is rendered through `XPostEmbed`, which lets the X widgets API size the embedded post at its native tweet width. Do not wrap X embeds in an additional Hilt card/border; the third-party embed already owns that chrome, and fixed-height iframe wrappers can crop text or video footers.
- Media alignment is centered by default when the media is narrower than the reader. Keep `mx-auto` on X posts, YouTube embeds, generic iframes, and markdown images; full-width embeds still fill their available width, but constrained embeds should not sit awkwardly left-aligned in the reader.
- Generated media markdown should not include duplicate source-navigation links under embeds. The detail toolbar and Source tab own outbound source access; the reference body should stay focused on media, summary, connections, and cached content.
- Timestamped YouTube cache content renders through `VideoTranscript` instead of generic Markdown. Transcript rows use a compact time/text layout, highlight the active playhead line, and click-to-seek the active video. Highlighting is passive by default; the `Jump to Live` control opt-in scrolls to and follows the playhead until the user manually scrolls away.
- Item opens preserve the current Library context: desktop uses split panes, while mobile opens detail over the current list and returns with Back without losing scroll position.
- Opened Library items are addressable at `/library/item/<id>`. Feed/List/Recent/For You/New/status/source controls are reflected as query state so browser Back/Forward works inside Library and direct item links can reopen the detail pane.
- Detail panes expose icon buttons for copying the Hilt item link and the underlying markdown path.
- Candidate Dismiss is an active review operation: it marks the candidate `skipped`, removes it from the active Feed/List immediately, and shows an undo toast. Skipped/expired/promoted candidate cache records are excluded from default Library lists so dismissed candidates do not linger as ordinary feed items.
- Header includes a compact health panel backed by `/api/library/health` for scheduler, source, and dead-letter visibility. Health refresh is status-only; the separate `Check sources` action runs a bounded live ingest for the selected source or all hourly sources, then revalidates the local Library view.
- Uses `/api/library`, `/api/library/unread`, `/api/library/candidates/*`, `/api/library/sources`, the recommendation feed/episode/impression/dismiss/restore APIs, `/api/library/health`, and `/api/search`.
- Manual, explicit-save, and discovery records share the same artifact shape, so UI actions do not need source-specific handling.

### BriefingContent.tsx Library modules

**File**: `src/components/briefings/BriefingContent.tsx`

- A dedicated partitioner recognizes `### Recommended for you`, `### Editor's memo`, and `### Library health` inside `Library & knowledge`; historical briefings without this contract retain generic rendering.
- Recommendations render as an editorial lead, compact Library cards, and an attached native `View all`. The lead explains the shared tension or consequence instead of recapping card titles.
- The weekly memo is a prominent full-width band, not another nested card. Health is the quiet final footer and links only to that day's report; missing reports render an explicit unavailable warning.

### BriefingContent.tsx Decisions queue

- `⏭ Decisions awaiting you` is a separate top-level briefing card, not part of Work. Its header owns the current unresolved count; markdown does not repeat a generated count sentence.
- Each meeting group stays collapsed by default and leads with the dated meeting pill, model-written or stored meeting context, unresolved count, and a restrained amber marker only when overdue or explicitly escalated. A group with no available context shows identity and count only; task titles are never concatenated into preview prose.
- At every width the meeting pill and unresolved count form a compact metadata row, with editorial context on a full-width second row. Long meeting names truncate inside the pill instead of taking width from the prose; the context is never a leftover grid track.
- Generated task IDs define historical membership. The current daily or Saturday-anchored weekend briefing may absorb newly-created canonical proposal files, including a new meeting group; older briefings hydrate only their stamped IDs.
- A successful active-file append broadcasts `briefings-changed`; the open briefing reloads its Markdown in place so the new group advances from identity-only fallback to stored meeting context without a page refresh.
- Expansion renders existing `TaskCard` verdict controls. Accepted and dismissed stamped items stop contributing to pending counts and move behind one compact `Resolved · N` disclosure.
- Legacy `⏭ Next steps` sections retain their prior live meeting join and rendering behavior.

### BriefingRecommendationRow.tsx

**File**: `src/components/briefings/BriefingRecommendationRow.tsx`

Compact Library recommendation card presentation inside the Briefing's Library section.

- Hydrates the exact frozen `rec:<episode-id>` placement through the passive episode endpoint; later batches do not replace the morning's pitch.
- Uses current artifact title, source metadata, thumbnail, lifecycle, and read state. The stored episode pitch is the card's only description: no visible `Why now` label and no repeated source summary.
- Reports a briefing impression only when visible. Clicking the card navigates natively to Library with `rank=for-you` and opens the artifact; hydration itself is never treated as an open.
- Reuses recommendation comment and dismiss controls. A dismissed placement becomes a quiet inline Undo state instead of collapsing the whole Library section.
- Cards use the standard Hilt content-card border, radius, and action-row treatment while staying denser than full Library FeedCards. Long pitches clamp on mobile, media dimensions stay reserved, and action controls remain above the bottom navigation.

### SecondaryToolbar.tsx

**File**: `src/components/layout/SecondaryToolbar.tsx`

Shared 44px toolbar chrome for secondary navigation rows.

**Key behaviors**

- Used by Library and System so mode switchers, filters, health/status, and refresh controls share one height and spacing contract.
- Keeps narrow widths to a single non-wrapping horizontal row with hidden scrollbars instead of wrapping controls into a taller toolbar.
- Provides shared segmented-control, segmented-button, and icon-button primitives for consistent active, hover, and compact-label states.
- Exports `SECONDARY_TOOLBAR_BODY_GUTTER_CLASS` for the standard 13px space between the toolbar and attached full-bleed body panes.

---

## Graph Components

All graph components live under `src/components/graph/` and are flag-gated: `GraphView` is loaded only via the `dynamic({ ssr: false })` branch in `SystemView` guarded by `isGraphEnabled()`, so nothing renders or imports when `HILT_GRAPH_ENABLED` is unset.

### GraphView.tsx

**File**: `src/components/graph/GraphView.tsx`

The System → Graph sub-mode shell. Hosts the `SecondaryToolbar` with the System mode switcher (`left`) and the `GraphToolbar` (`right`), runs the first-run state machine off `/api/system/graph/meta` (disabled state with no WebGL context when the flag is off, a "Building graph index…" progress panel while `builtAt === null`, ready → mount canvas + freeze), owns the renderer instance across data refetches, maps click-throughs and hover off the parallel `meta[]` array (index-vs-id), focuses a deep-linked node two-phase once data arrives, and exposes `window.__hiltGraphStats` for e2e.

### CosmosRenderer.ts / renderer.ts

**Files**: `src/components/graph/CosmosRenderer.ts`, `src/components/graph/renderer.ts`

`renderer.ts` defines the renderer-agnostic `GraphRenderer` interface so a WebGPU engine can swap in over the same binary buffers. `CosmosRenderer.ts` is the **only** file importing `@cosmos.gl/graph` (pinned 2.6.4): it owns one `Graph` on a container div, uploads precomputed coordinates into GPU buffers, freezes at rest via `render()` then `pause()` (`enableSimulation: false`), and wires hover/click. Note: cosmos.gl 2.6.4 mounts to a container `<div>` (it owns the `<canvas>`), so `mount` takes the container, not a bare canvas.

### GraphToolbar.tsx

**File**: `src/components/graph/GraphToolbar.tsx`

Global/Local segmented control (Lucide `Globe`/`Locate`), a local-scope hop stepper, a flag-gated Show-tags toggle (`isGraphTagsEnabled()`), a legend popover, the read-only refresh button, and the "updated <relative> · updating" staleness chip.

### decode.ts / device-budget.ts / graph-style.ts

**Files**: `src/components/graph/{decode,device-budget,graph-style}.ts`

`decode.ts` is the client-side `decodeGraphBinary` mirroring the wire contract (throws `GraphFormatError` on magic/version mismatch). `device-budget.ts` is a pure device-class → `GraphBudget` map (desktop GLOBAL default, mobile/tablet LOCAL, DPR clamped per class). `graph-style.ts` resolves the interned color-key table to RGBA per theme, derives `sqrt(degree)` sizes with a North-Star floor, and builds hover adjacency.

### useGraphMeta.ts / useGraphData.ts / graph-deeplink.ts

**Files**: `src/components/graph/{useGraphMeta,useGraphData,graph-deeplink}.ts`

`useGraphMeta` drives the meta poll + WS `graph` channel subscription (10s `/meta` fallback when the socket is down). `useGraphData` fetches + decodes the binary payload (scope-aware). `graph-deeplink.ts` is the single source of the scope grammar (`buildGraphScope`/`parseGraphScope`, path-segment only) shared by `GraphView` and the three "Show in graph" surfaces.

---

## Performance Components

All live under `src/components/performance/` and render the System → Performance subtab (Mercury closet/compute telemetry). No chart library — the chart is hand-rolled SVG per Hilt's design philosophy.

### PerformanceView.tsx

**File**: `src/components/performance/PerformanceView.tsx`

The subtab shell: `SecondaryToolbar` with the System mode switcher (`left`) and range segmented control (6h/24h/7d/all) + Detail/Util layer toggles + freshness + refresh (`right`); a **stat strip** that doubles as legend, per-series visibility toggle (colored items), and hover readout (retargets to the hovered sample); and the chart filling remaining height. Data via `useMercurySeries(range)` + `useMercuryLatest()` (SWR, 60s). Shows a clean error card when Mercury is unreachable.

### PerfChart.tsx

**File**: `src/components/performance/PerfChart.tsx`

Hand-rolled, responsive SVG time-series ("Closet Climate Strip"). Two °F axes — left auto-fits ambient (closet/room/outdoor) so closet variation stays legible, right carries hot cpu/gpu die temps — plus a hidden 0–100 scale for utilization lines and a power-draw wash behind the lines. `CHANNELS`/`COLOR` are exported and shared with the stat strip. Null samples break the line; height tracks the container via `ResizeObserver`; hover lifts the nearest sample to the parent via `onHover`.

---

## Bridge Components

### BridgeView.tsx

**File**: `src/components/bridge/BridgeView.tsx`

Main Bridge view showing weekly tasks, projects, and notes. Supports navigating to projects in Docs view via the `onNavigateToProject` callback.

### BridgeTaskList.tsx

**File**: `src/components/bridge/BridgeTaskList.tsx`

List of tasks for the current week.

### BridgeTaskItem.tsx

**File**: `src/components/bridge/BridgeTaskItem.tsx`

Individual task item with status management.

### BridgeTaskPanel.tsx / BridgeTaskDetail.tsx / BridgeTaskEditor.tsx

**Files**: `src/components/bridge/BridgeTaskPanel.tsx`, `BridgeTaskDetail.tsx`, `BridgeTaskEditor.tsx`

Task detail view with editing capabilities. BridgeTaskPanel is keyed to a WEEKLY-LIST row
(positional selection resolved against `weekly.tasks`).

### TaskFilePanel.tsx

**File**: `src/components/bridge/TaskFilePanel.tsx`

The FILE-addressable task detail pane — keyed to a task-file id (`t-…`), decoupled from weekly
list position. Data flows entirely through `useTaskFile` → `/api/tasks/[id]`, so proposals,
done/dropped tasks, and past-week tasks open with no weekly row. Editability follows the store:
accepted/in-progress → title + body editable (body edits preserve the read-only `## History`
audit section via `src/lib/tasks/task-body.ts` split/join); proposed → read-only fields + the
shared verdict buttons (POST `/api/loops/verdicts`), pane stays open showing the new state after
a verdict; done/dropped → read-only. BridgeView renders it whenever the selection is a bare file
id (`selectedFileTaskId`) — clicking any TaskCard anywhere (Proposals section, briefing canvas,
meeting Next steps, task object pills) lands here or, when the task IS on this week's list, in
BridgeTaskPanel. Cross-view opens arrive via the task-open channel
(`src/lib/tasks/deeplink.ts` → Board → `openTaskRequest`); the CLI navigate API accepts
`{view:"bridge", path:"/task/t-…"}`.

### BridgeNotes.tsx

**File**: `src/components/bridge/BridgeNotes.tsx`

Notes section within the Bridge view.

### ProjectCard.tsx / ProjectKanban.tsx / ProjectPicker.tsx

**Files**: `src/components/bridge/ProjectCard.tsx`, `ProjectKanban.tsx`, `ProjectPicker.tsx`

Project display and organization components.

### WeekHeader.tsx

**File**: `src/components/bridge/WeekHeader.tsx`

Week navigation header for the Bridge view.

### RecycleModal.tsx

**File**: `src/components/bridge/RecycleModal.tsx`

Modal for recycling/archiving completed items.

---

## Docs Components

### DocsView.tsx

**File**: `src/components/DocsView.tsx`

Documentation browser and editor view. Accepts `scopePath`, `searchQuery`, optional `initialFilePath`, and scope change callbacks.

### DocsFileTree.tsx

**File**: `src/components/docs/DocsFileTree.tsx`

File tree sidebar for navigating documentation files within the current scope.

### DocsTreeItem.tsx

**File**: `src/components/docs/DocsTreeItem.tsx`

Individual tree node (file or folder) in the docs file tree.

### DocsEditor.tsx

**File**: `src/components/docs/DocsEditor.tsx`

Markdown editor for documentation files.

### DocsContentPane.tsx

**File**: `src/components/docs/DocsContentPane.tsx`

Content display pane that routes to the appropriate viewer based on file type.

### DocsBreadcrumbs.tsx

**File**: `src/components/docs/DocsBreadcrumbs.tsx`

Breadcrumb navigation within the docs view.

### DocsEditToggle.tsx

**File**: `src/components/docs/DocsEditToggle.tsx`

Toggle between read and edit modes for documentation.

### Specialized Viewers

- **CodeViewer.tsx** - Syntax-highlighted code display
- **CSVTableViewer.tsx** - Tabular CSV rendering
- **ImageViewer.tsx** - Image file display
- **PDFViewer.tsx** - PDF document rendering
- **DocsFallbackView.tsx** - Fallback for unsupported file types

---

## Stack Components

### StackView.tsx

**File**: `src/components/stack/StackView.tsx`

Claude configuration stack viewer. Displays CLAUDE.md files, MCP servers, and plugins for the current scope.

### StackFileTree.tsx

**File**: `src/components/stack/StackFileTree.tsx`

File tree showing configuration files in the stack hierarchy.

### StackContentPane.tsx

**File**: `src/components/stack/StackContentPane.tsx`

Content pane that routes to the appropriate detail view.

### StackSummary.tsx

**File**: `src/components/stack/StackSummary.tsx`

Overview summary of the current configuration stack.

### MCPServerDetail.tsx

**File**: `src/components/stack/MCPServerDetail.tsx`

Detail view for an individual MCP server configuration.

### PluginDetail.tsx

**File**: `src/components/stack/PluginDetail.tsx`

Detail view for a Claude plugin.

### CreateFileDialog.tsx

**File**: `src/components/stack/CreateFileDialog.tsx`

Dialog for creating new configuration files.

---

## Scope Navigation Components

### ScopeBreadcrumbs.tsx

**File**: `src/components/scope/ScopeBreadcrumbs.tsx`

Clickable path navigation with inline pin button.

```typescript
// Path: /Users/you/Work/Code/myproject
// Renders: / > Users > you > Work > Code > myproject
//          ^   ^       ^       ^      ^      ^
//          All clickable segments
```

### SubfolderDropdown.tsx

**File**: `src/components/scope/SubfolderDropdown.tsx`

Dropdown showing child folders.

### RecentScopesButton.tsx

**File**: `src/components/scope/RecentScopesButton.tsx`

Clock icon with dropdown of recent scopes.

### BrowseButton.tsx

**File**: `src/components/scope/BrowseButton.tsx`

Opens native macOS folder picker.

### PinnedFoldersPopover.tsx

**File**: `src/components/scope/PinnedFoldersPopover.tsx`

Popover listing pinned folders for quick scope switching.

---

## Sidebar Components

### Sidebar.tsx

**File**: `src/components/sidebar/Sidebar.tsx`

Collapsible sidebar container. Fetches inbox counts for pinned folders and renders them with drag-and-drop reordering.

### SortablePinnedFolderItem.tsx

**File**: `src/components/sidebar/SortablePinnedFolderItem.tsx`

Draggable pinned folder with emoji customization and count badges.

**Badges**

- Blue: To Do / inbox count
- Amber: Needs review count
- Green: Active / in progress count
- Live indicator dot: Running processes

### SidebarSection.tsx

**File**: `src/components/sidebar/SidebarSection.tsx`

Collapsible section container within the sidebar.

### SidebarToggle.tsx

**File**: `src/components/sidebar/SidebarToggle.tsx`

Button to collapse/expand the sidebar.

### PinnedFolderItem.tsx

**File**: `src/components/sidebar/PinnedFolderItem.tsx`

Non-sortable pinned folder display (used in contexts without drag-and-drop).

---

## UI Components

### LiveIndicator.tsx

**File**: `src/components/ui/LiveIndicator.tsx`

Pulsing dot indicator for active/running state.

### ThemeToggle.tsx

**File**: `src/components/ThemeToggle.tsx`

Toggle between light and dark themes.

### ThemeProvider.tsx

**File**: `src/components/ThemeProvider.tsx`

Theme context provider for the application.

### PlanEditor.tsx

**File**: `src/components/PlanEditor.tsx`

MDXEditor wrapper for plan markdown.

**Plugins**

- headingsPlugin
- listsPlugin
- quotePlugin
- markdownShortcutPlugin
- tablePlugin
- codeBlockPlugin
- codeMirrorPlugin
- linkPlugin
- linkDialogPlugin
- toolbarPlugin

---

## Hooks

### usePinnedFolders.ts

```typescript
function usePinnedFolders() {
  // Server-persisted pinned folders with optimistic updates
  return {
    folders: PinnedFolder[],
    isPinned: (path: string) => boolean,
    togglePin: (path: string) => void,
    unpinFolder: (id: string) => void,
    reorderFolders: (activeId: string, overId: string) => void,
    setEmoji: (id: string, emoji: string | null) => Promise<void>,
    isHydrated: boolean,
  };
}
```

### useSidebarState.ts

```typescript
function useSidebarState() {
  // localStorage-persisted sidebar collapsed state
  return {
    isCollapsed: boolean,
    toggle: () => void,
    isHydrated: boolean,
  };
}
```

### useBridgeProjects.ts

Hook for fetching and managing Bridge project data.

### useBridgeWeekly.ts

Hook for fetching weekly task data for the Bridge view.

### useClaudeStack.ts

Hook for fetching Claude configuration stack data (CLAUDE.md files, MCP servers, plugins).

### useDocs.ts

Hook for fetching documentation file trees and content.

### useEventSocket.ts

Hook for WebSocket-based real-time event updates.

### useTheme.ts

Hook for theme state management (light/dark mode).

---

## Object Pills (universal object references, v3 unit B5)

Everywhere Hilt name-drops a system object (meeting, task, person, project, library item) it
renders as ONE inline chip with a popover preview and native-view click-through. Markdown
reaches the pill through the briefing's `BriefingLink` seam (`hilt:kind/id` link hrefs —
`parseHiltUri` returns null for every other href, so non-hilt links render exactly as before);
structured surfaces call `ObjectPill` directly with props.

- **`src/components/objects/ObjectPill.tsx`** — the chip: `<button>` (not `<a>`), tiny lucide
  kind-glyph (meeting=CalendarClock, task=SquareCheck, person=UserRound, project=FolderOpen,
  library=BookMarked) + label, `.hilt-object-pill` tokens (the subtle evidence-chip/weather-chip
  family, NOT the blue `.briefing-link`). Render is ZERO network; the resolve fetch fires on
  OPEN via SWR (`useObjectCard`, deduped per kind+id). Coarse pointers (checked at tap time):
  tap resolves + navigates directly, no popover. Unresolvable ref → the pill keeps its label
  and the popover shows "Couldn't load this <kind>"; `nav: null` disables click-through.
- **`src/components/objects/ObjectPopover.tsx`** — the house popover shell, extracted from the
  AppHud eventPopover pattern + CalendarEventPopoverContent's viewport clamp (fixed z-100,
  getBoundingClientRect anchor, outside-mousedown + Escape dismissal, body portal).
- **`src/components/objects/ObjectCard.tsx`** — kind dispatch over `ObjectCardData`;
  `cards/MeetingObjectCard.tsx` is THE canonical meeting card — the same component renders the
  pill popover body (frontmatter-derived data) AND People's Active meetings section
  (`PersonMeetingList`'s `ActiveMeetingsSection` re-pointed at it in B5); `cards/TaskObjectCard`
  wraps the shared `TaskCard`; `cards/SimpleObjectCards` covers person/project/library.
- **`src/hooks/useObjectCard.ts`** — lazy SWR over `GET /api/objects/resolve` (key is null until
  the popover opens) + `resolveObject()` for the imperative coarse-pointer tap path.

**Adoption (v1: meeting + task):** briefing prose via `BriefingLink`; the B3 canvas
`MeetingCard` header lead (`meetingRel` prop — closes the header-nav gap deferred at B3);
`TaskCard`'s meeting attribution line (`meetingRef?: ObjectRef` prop — pill when passed, plain
text otherwise; passed by the Proposals section and briefing canvas cards, NOT by
meeting-scoped surfaces that pass `hideMeeting`); `EscalationsPanel`'s `LoopItemRow` expanded
citation (first vault-meeting-path citation becomes a pill, `formatCitation` stays as tooltip,
"+N" plain text for extras).

**HUD sibling note:** the HUD's `EventHero`/eventPopover in `AppHud.tsx` and
`CalendarEventPopoverContent` are the SOURCE patterns the popover shell was extracted from —
they are intentionally NOT migrated onto ObjectPill in v1 (scope fence); keep them visually in
step if the shell changes.

## Object references ("Copy reference")

Any object the user might pull into an agent chat should offer a **Copy reference** affordance that
copies a portable pointer (location + a one-line how-to + title). This is centralized so content is
tuned in one place and new surfaces are cheap to add.

- **`src/lib/references/build.ts`** — `buildReference(ref: HiltRef)` is the single formatter. Tune
  what any reference contains here. File-backed kinds lead with an **absolute** path so a local agent
  can open it immediately.
- **`src/lib/references/types.ts`** — `HiltRef` discriminated union; add a variant per object kind.
- **`src/lib/references/clipboard.ts`** — `copyToClipboard(text)` (the only clipboard writer; has the
  legacy textarea fallback). Use it instead of `navigator.clipboard.writeText`.
- **`src/hooks/useCopyReference.ts`** — `{ copy, copied }` (clipboard + 1.5s "Copied!" feedback).
- **`src/components/ui/CopyReferenceButton.tsx`** — drop-in button (`variant="menu-item" | "icon"`).

**To add Copy reference to a new surface:** (1) add a `HiltRef` variant in `types.ts`; (2) add its
`case` in `build.ts` (+ a `build.test.ts` assertion); (3) drop a `<CopyReferenceButton reference={…}>`
into the component. If the surface only has a vault-relative path on the client, surface an absolute
path from the API first (see `LibraryArtifact.abs_path`, `BriefingDetail.absPath`). Covered today:
Bridge task, Library, Docs, Meetings, People, Stack plugin/MCP, Sessions, briefing items, calendar
events. Not yet: Projects, Thoughts, Areas, Weekly lists, Granola meetings.

## Styling Conventions

### Color Palette

Uses CSS custom properties for theme support:

| Variable | Usage |
|----------|-------|
| `--bg-primary` | Main background |
| `--bg-secondary` | Toolbar/sidebar background |
| `--bg-tertiary` | Input/hover background |
| `--bg-elevated` | Cards, popovers |
| `--border-default` | Standard borders |
| `--text-primary` | Primary text |
| `--text-secondary` | Secondary text |
| `--text-tertiary` | Muted/placeholder text |
| `--interactive-default` | Focus rings, active elements |
| `--status-todo` | To Do badge color (blue) |
| `--status-active` | Active badge color (green) |

### Common Patterns

```css
/* Card/panel background */
.panel { background: var(--bg-elevated); border: 1px solid var(--border-default); }

/* Interactive hover */
.interactive:hover { background: var(--bg-tertiary); color: var(--text-primary); }

/* Active/selected state */
.active { background: var(--bg-tertiary); color: var(--text-primary); }
```

### Responsive Breakpoints

Not heavily used -- designed for desktop/laptop screens. The `sm:` breakpoint is used sparingly (e.g., hiding view toggle labels on narrow screens).

---

*Last updated: 2026-05-27*
