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

### 3. Content Surfaces Over Warm Canvas

In light mode, distinguish user/work content from app chrome by placing content on white elevated surfaces over Hilt's warm off-white canvas. The active toolbar selection, task rows, writing/project cards, people cards, document bodies, and Local Apps preview/fallback tiles should read as content. Use the warm canvas for surrounding page structure, sidebars, gutters, and inactive chrome.

**Implementation pattern**:
- Use `--content-surface` for content cards and readable document/app bodies.
- Use `--bg-primary` for the broad app canvas and structural empty space.
- Use `--bg-secondary`/`--bg-tertiary` for controls, hover states, gutters, and hierarchy inside chrome.
- In light mode, content shadows should be compact but perceptible against the warm canvas; avoid shadows so pale they disappear around white cards. Keep dark-mode shadows subdued and neutral.

### 4. Contextual Color Meaning

Colors should communicate state, not decorate:
- **Blue/indigo tints**: Items needing attention (To Do, inbox)
- **Emerald tints**: Active/running/live states
- **Amber tints**: Starred/pinned items
- **Zinc tones**: Default/neutral states

### 5. Progressive Disclosure

Don't show everything at once. Reveal complexity through interaction:
- Action buttons appear on hover (floating toolbar pattern)
- Collapsible sidebar for pinned folders
- Expandable sections in columns (time-based grouping)

### 6. Immediate Feedback

Every action should have visible feedback:
- Pulsing indicators for running sessions
- Glow effects for newly appearing items
- Loading states that don't cause layout shift
- Prefer stale-while-refresh over blank reloads. Once a tab/view has loaded, switching away and back should render the last known content immediately, show refresh activity in existing chrome, and report refresh failures as non-blocking status instead of replacing the view with a full-screen error or spinner.

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

**Global tab IA**:
- Treat Briefing as the synthesized output surface across work, knowledge, people, sessions, and systems.
- Treat Bridge, People, Library, and Docs as the user's workspace/knowledge cluster.
- Treat System as the parent for inspection/observability views: Sessions/Map, Apps, Stack/configuration, and Sync.
- Keep the top-level nav simple and legible: `[Briefing Bridge People Library Docs System]`. Put inspection sub-modes inside System instead of making every system lens a primary destination.
- Let primary navigation chrome float over the canvas instead of painting a full-width desktop toolbar strip, but keep the top row's layout reservation so content does not jump upward. Mobile should use one floating pill for section icons; avoid nested inset pills inside the pill.
- Full-bleed workspace views with sidebars or secondary toolbars should leave an optically balanced gutter below the floating primary nav, then begin the body with a top border attached to the body rather than to the nav. Keep right-side controls and native window controls vertically centered within that top chrome.
- The Electron shell should allow the app to reach phone-width responsive layouts. Keep the minimum native window size no wider than the small iPhone/SE viewport class (`375px` wide) unless a specific feature has a documented hard constraint.
- Mobile layout mode should be reachable by viewport width as well as by touch hardware. A narrow Electron or desktop browser window should use the same bottom nav and staged mobile structure as a phone once it is below the `sm` breakpoint.
- Mobile-width Electron still needs native window chrome affordances. Reserve a quiet top drag/titlebar strip for the macOS traffic lights before content starts, and make any floating bottom navigation chrome draggable only in its empty/padded regions so tab buttons remain normal controls.
- The floating mobile bottom nav is a theme-aware material surface, not a hardcoded glass effect. Light mode should read as warm translucent white with a soft border; dark mode should use a denser dark translucent fill, stronger shadow, and higher-contrast inactive icons so the pill remains legible over media cards and dark content.
- Mobile content that sits under a hideable top toolbar must use the shared mobile chrome offset contract. Drawers and sidebars count as body content too; their first actionable row should start below visible top chrome and only reclaim that space through the same chrome translation behavior.
- Scrollbars are interaction chrome, not persistent layout chrome. Across the app they should remain invisible until the user is actively scrolling, then appear as thin, transparent-track thumbs only long enough to orient the user.
- Secondary navigation rows should be one shared 44px toolbar pattern. Library and System controls should not invent separate heights or wrapping rules; keep segmented mode controls, filters, health/status, and refresh actions in one non-wrapping row that can horizontally overflow on narrow screens before it overlaps or changes height. Body content below that row should use the shared 13px optical gutter before attached borders or full-bleed panes begin, and toolbar badges/popovers need enough inset or fixed positioning to avoid clipping at scroll edges.
- Use a compact secondary segmented control inside System for `Sessions`, `Apps`, `Stack`, and `Sync`; this is mode chrome, not explanatory copy.
- Keep System mode chrome to one row where possible: mode switcher on the left, mode-specific filters/status/refresh controls right-aligned on the same line. Let this row sit directly on the canvas without a strip background, enclosing border, or extra vertical padding. When a full-width body needs structure, place its top border below the secondary toolbar after the standard optical gutter, not above the toolbar.
- Top-level shortcuts follow the visible top-level order: Briefing, Bridge, People, Library, Docs, System. Hilt still defaults to Bridge on startup until Briefing is strong enough to be the landing surface.

### Drawers/Panels

**Right-side drawer pattern**:
- Resizable via drag handle
- Handle should lighten on hover (not thicken)
- Content area adjusts padding dynamically
- Tabs for multiple items within drawer
- User-controlled drawer/sidebar/HUD visibility is a preference, not temporary render state. Persist open/collapsed state in localStorage so refreshes and tab switches preserve the user's workspace shape.

### Icons

- Use Lucide React icons consistently
- Prefer outlined icons over filled
- Size 16-20px for inline/button icons
- Don't use emojis in UI (unless in user content)
- Standalone utility actions in dense secondary chrome should usually be icon-only with native titles/aria labels. A refresh/status/more button does not need a text label when the icon is familiar and the surrounding toolbar already supplies context.
- Binary toggle buttons should use a quiet pressed/depressed surface for active state, close to the hover background. Reserve the raised white segmented-control treatment for mutually exclusive choices where the selected option needs to be read at a glance.

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

### List Virtualization

- **Every unbounded list virtualizes** (`@tanstack/react-virtual` + `measureElement` for variable heights): Library feed, Library list density (ArtifactList), People meeting timeline. Bounded lists (the ~27-person sidebar) stay plain — virtualization there is complexity without payoff.
- Standard shape: scroll-element ref on the overflow container → relative inner div sized by `getTotalSize()` → absolutely-positioned rows with `translateY(start)` + `data-index` + `measureElement` ref.
- Gotchas encoded in the feed: row bottom-padding replaces flex `gap` (gaps don't exist between absolute rows); descending per-row `zIndex` keeps a card's downward-opening menus above later rows (each transformed row is a stacking context); `position: sticky` content must live OUTSIDE the transformed rows; element-anchored scroll restoration needs a `scrollToIndex` fallback for unmounted rows.

---

## Evolution Log

This section tracks design decisions and refinements over time. Each entry should note what was tried, what was rejected, and why.

### 2026-06-02: Briefing Reliability — Failure Is Today's Briefing State

**Principle**: The Briefing tab represents the expected daily briefing loop, not merely the newest successful markdown file. If today's briefing generation failed, the UI should show today's failed state directly instead of silently falling back to yesterday and making the user infer that something is missing.

**UI rule**:
- Render failed generation as a compact content card with the time, readable cause, next scheduled run, and a direct retry affordance.
- Keep the card quiet and diagnostic: amber status tint, no modal, no alarming full-screen error.
- Hilt may queue the existing Hermes job for retry, but Hermes remains the owner of generation. Hilt should not create a second hidden briefing generator.

**Rationale**: Briefing is a morning trust surface. A missing briefing is itself useful information, and showing it in place preserves the daily habit while keeping recovery close to the failure.

### 2026-05-30: Library Reweave — One Pass, Free-Form Digest, Disciplined Connections

**Principle (durable)**: When a reference is durably saved, Hilt does ONE Claude pass that *weaves the reference into Justin's corpus* — the way Justin would ask a sharp friend to read something, distill it, and tell him how it bears on his work. That single pass produces both the digest and the connections; there is no separate summarize-then-judge handoff for durable saves.

**Free-form digest — minimum structure, maximum room**:
- **The model picks the form per source.** There is no fixed `## Summary` / `## Key Points` template for durable saves. Depending on what serves *this* content, the digest may be a short summary, bespoke thematic sections named after the actual ideas, key points, key insights, key quotes, a "why it matters to your work" weave, or a mix. Forcing every reference into the same skeleton was rejected — it flattened thin tweets and rich talks into the same shape.
- **Depth matches the source.** A thin tweet gets a few lines; a rich talk gets more. Never pad to look thorough. This mirrors the connection discipline: honesty over volume.
- **Honest about weaknesses.** The digest should name recycled material, thin/partial sources, and hype rather than dressing them up. The goal is a trustworthy distillation, not a flattering one.
- **Practitioner voice.** Write as Justin's plain-spoken practitioner voice — a sharp friend distilling the idea, not an academic grader or a recommendation engine.
- **This came from studying his manual captures.** Justin's own hand-filed references vary in structure — some are a paragraph, some are bullets, some are a single quote with a note. The fixed template fought that variety. The reweave model gives the model *minimum structure, maximum room* so generated notes read like the ones Justin writes himself.

**Disciplined connections**:
- **The gate for every tie is "would Justin be glad I surfaced this when looking at this note, or is it noise he'd scroll past?"** This is the same abstain-biased judgment as the earlier connections work, applied per candidate link.
- **First-party ties are comprehensive.** Connections to Justin's own authored work (projects, areas, thoughts, his strategy docs) should surface *all* the genuine ones — they almost always earn attention.
- **Library cross-references must earn a second look.** Ties to other external references he saved are held to a much higher bar: include one only if it genuinely *sharpens or surprises* (a real contrast, a lineage, an unexpected/illuminating parallel). A surprising-but-illuminating "weird" tie is wanted; mere same-topic neighbors are cut. Fewer, stronger; if none earn it, return none.
- **The model decides the form of the relationship**, written as a short plain predicate that reads naturally after "Title — …", not an academic run-on or a similarity score.
- **No candidate targets.** Connections never point into the temporary candidate cache (`references/.cache/`); only durable, real vault notes are valid targets.
- **Titles are the labels.** Connections render with the neighbor note's human title as the wikilink label (`- [[target|Title]] - relationship`), so the body reads in plain language rather than exposing slugs.

**Rationale**: Studying Justin's manual captures showed that a good knowledge note is shaped by its source, not by a form. The reweave pass trades the predictability of a template for notes that actually fit what they're about — while keeping the connection discipline that makes the Library trustworthy: comprehensive about his own work, stingy about everything else, and silent when there is nothing to say.

### 2026-06-01: Library Source Taxonomy — Study vs Keep

**Change**: Library source labels, source-native taxonomy, and user-facing tags are separated. The source rail can expand into Raindrop collections/tags or X bookmark-folder facets, while card chips hide plumbing tags like `bookmark`, `raindrop`, and `twitter`.

**Principles**:
- Source says where an item came from; taxonomy says how that source organized it; semantic tags say what the item is about. Do not blur those into one chip list.
- The default Library surface is for study: material worth reading, evaluating, weaving, or filing into active context.
- Keep-mode material is still useful durable memory, but it should be quiet by default. Products, clothing, furniture, recipes, restaurants, and similar saved-for-later items should remain searchable without crowding the review feed or forcing project connections.
- Mode is lower-priority than status/source filtering, so it belongs at the bottom of the rail as a simple `Study` / `Keep` switch. The UI should not offer an `All` mode by default; mixing both modes weakens the distinction.
- Source families should collapse noisy feeds before exposing detail. YouTube belongs under one parent with playlist/channel children; email newsletters belong under `Newsletters` with friendly sender facets instead of raw email addresses.

**Rationale**: Justin uses bookmarks for both "this may change how I think/work" and "remember this object/place/product later." Treating every saved bookmark as a study item makes the feed noisy and connection prompts silly. A mode split keeps the Library useful for both behaviors without inventing a second archive.

### 2026-06-02: Library Read State — Open Then Leave

**Principle**: "Visible" is not "read." Library items should not become read because a user scrolled past them, even if the viewport is tall enough to expose many cards at once.

**Rule**:
- Opening/selecting an item is necessary but not sufficient.
- The item is marked read only when the reader moves away from it: selecting a different item, closing the reader, or backing out of the detail surface.
- Scrolling Feed/List surfaces only changes position and pagination. It must never mutate read state.

**Rationale**: The Library feed is partly an inbox. Scanning for context should not consume the unread signal; closing/leaving the opened item is the user intent that says "I have dealt with this."

### 2026-05-30: Knowledge Graph — Freeze at Rest, Default Global, Show-in-Graph Everywhere

- **Render-only, frozen at rest.** The graph view ships finished server-computed coordinates straight to the GPU and freezes (`render()` then `pause()`); it does not simulate physics in the browser. Idle is pure GPU render (~0 CPU). A live-jiggling hairball was rejected — it reads as noise, not structure, and burns battery on a laptop/phone.
- **Default scope is GLOBAL on desktop, LOCAL on mobile.** Desktop wants the whole-vault "knowledge map"; a phone can't hold it (jetsam), so mobile defaults to the focused node's neighborhood and the server enforces a hard node cap regardless of what the client asks. Never ship the global buffer to a phone.
- **Degree-0 leaves are hidden by default.** The primary vault has a long isolated-stub tail; showing it makes a dust cloud, not a graph. An opt-in reveals them.
- **Contextual color, not a rainbow.** Nodes color by type, but references/notes/projects prefer their owning North-Star *area* bucket (extends the "Contextual Color Meaning" principle). North Stars get a permanent size floor + emphasis regardless of degree — the anchors of the map should always read as anchors.
- **Hover greys the rest, never blanks it.** Hover-highlight selects a node + its neighbors; clearing must call `unselectPoints()` (passing `[]` would grey out *everything* — a cosmos.gl gotcha). Mobile uses tap-to-select (no hover layer).
- **"Show in graph" is a peer affordance, not a separate destination.** Docs, Library (saved refs **and** candidates), and People each carry a small Lucide `Network` button that deep-links into the graph focused on that item via the one path-segment scope grammar (`buildGraphScope`). It appears only when the flag is on, sits beside the existing copy/reveal/settings controls rather than in a new toolbar, and an un-promoted candidate (no connections by design) lands centered with an honest "showing the full graph" fallback rather than an empty-feeling canvas.
- **The whole feature is inert when off.** The Graph tab, the renderer (and its WebGL context), the cosmos.gl bundle, and the three Show-in-graph buttons all disappear when `HILT_GRAPH_ENABLED` is unset — protecting the live app while the feature is in flight.

### 2026-05-29: Library Connections — LLM Judgment, "Just File It" Is a Win

**Principle (durable)**: Connections between a new reference and the user's existing work are an act of judgment, not string matching. Hilt judges connections with an LLM (Claude) reading a compact index of the user's North Stars, projects, areas, people, and recent references — replacing the earlier deterministic token-overlap scorer. Keyword overlap produced confident-but-shallow ties; what the user actually wants is "does this genuinely relate to my work, and how?"

**What a connection is, and what it is not**:
- **Connect** = a directional relationship to something that already exists in the user's work. This explicitly includes *baseline*, *contrast*, and *foundational* ties (e.g. "this is a peer/alternative to a reference you already saved," "this challenges your current approach in project X," "this is the groundwork the Y note assumes"), not only "same topic." The relationship sentence is the payload, not a similarity score.
- **Reweave** = a separate, stronger signal: this reference would *materially update* a specific neighbor note. Reweave candidates are surfaced for human approval only. Hilt never auto-edits a neighbor note — the user decides whether to fold the new material in. This distinction came directly from the user's own experience asking Claude to reweave summaries: rewriting a note is a human-approved act, while noting a relationship is safe to do automatically.

**Encouraged outcomes**:
- **"No connection / just file it" is a first-class, encouraged result.** Most references do not connect to active work, and saying so is correct, not a failure. The judge is deliberately abstain-biased; a clean `connects: false` with one line of reasoning is a good answer and should never be padded into spurious ties.
- **Few high-signal ties over many weak ones.** When there are connections, prefer two or three that a practitioner would actually act on. Never pad the list to look thorough.
- **Practitioner voice.** Relationship sentences should read like a knowledgeable colleague pointing out a real link, not a recommendation engine ("Related items you may like"). Plain, specific, directional.

**Cost/visibility implications for UI and pipeline**:
- Connections are judged only when a reference will be durably saved, so review candidates do not silently spend LLM budget. Promotion or an explicit re-judge is what earns connections for a candidate.
- When there are no connections, the rendered `## Connections` / `## Suggested Connections` section is simply empty — no placeholder bullet, no apology. Reasoning lives in frontmatter for the curious, not in the visible body.

**Rationale**: The point of the Library is to make the user's own corpus more useful, which means honest, specific links and the discipline to stay quiet when there is nothing to say. An LLM that can abstain models that judgment far better than a scorer that always finds *something* to overlap on.

### 2026-05-29: Calendar ↔ Meeting — One Action Row, Bidirectional Links

**Change**: Consolidated the calendar event popover's scattered links into a single action row at the top, and added reciprocal calendar evidence on Granola meeting notes.

**What was tried and rejected**:
- Links spread across three places in the popover (a "Join" section mid-body, an "Open notes" button under the description, and a primary-styled "Open link" pinned at the bottom). The bottom "Open link" was both the least-used action and the only filled button — emphasis was inverted.
- Generic "Open link" / "Open notes" labels. Rejected — they didn't distinguish an in-app jump (to the Granola note) from an external hop (to Google/Outlook), and "Open link" read as ambiguous next to the join links, which are also links.

**Pattern established**:
- Collect all of an entity's actions/connections into one row at the top of its detail surface, rather than scattering them by type through the body. Order by likelihood of use: live action → in-app cross-link → external link.
- Reserve the single filled/primary button for the live, time-sensitive action (joining the meeting). In-app and external links are secondary outline buttons. One primary affordance per surface.
- Name external destinations explicitly ("Open in Google" / "Open in Outlook"), and use the `ExternalLink` icon, so leaving the app is never a surprise. In-app jumps use a content icon (`NotebookPen`) and a plain label.
- Avoid label collisions: the calendar event's free-text body is "Description," not "Notes," because "Notes" now means the linked meeting record.
- Make cross-surface links bidirectional and visible. If A links to B, B should show evidence of the link and offer the return trip. Granola notes now carry a `Calendar` chip; the calendar event offers `Notes`.
- Encode match certainty in the chip color, reusing the existing amber-warning language: a neutral chip for an exact (iCalUID) match, amber for a fuzzy (title+time) match, with method and confidence in the tooltip. Don't hide that a link was guessed.

**Rationale**: The two systems were already linked in data but the connection was illegible in the UI — actions were scattered and one direction had no visible evidence at all. Grouping actions and making the link reciprocal turns a hidden data relationship into a navigable one.

### 2026-05-27: Library — Feed First, Browse Dense

**Change**: The Library moved from a placeholder to a working reference surface with Feed as the default view and Browse as a dense three-column inspection view.

**Pattern established**:
- Treat Library as an operational knowledge workspace, not a landing page.
- Feed should prioritize triage and resurfacing: For You / Recent, candidate Save / Skip, source and recommendation context.
- Browse should optimize scanning: source list, compact artifact rows, and a stable detail pane.
- Keep source-specific complexity out of the UI where possible; manual links, explicit-save sources, and discovery candidates should share the same artifact contract.
- Candidate material can be useful without being durable. The interface should make that distinction visible without making the cache feel like a second-class trash pile.
- Operational health belongs in compact chrome, not in the content feed. Scheduler/source/dead-letter state should be one click away from the Library header so failures are visible without making normal reading feel like a monitoring dashboard.

### 2026-05-28: Library — One Toolbar, Reading Pane First

**Change**: Library subnavigation was consolidated into a single System-style toolbar. The top row now controls filter rail visibility, Feed/List density, Recent/For You ranking, counts, and compact health. Lifecycle status lives inside the filter rail rather than as another toolbar segment.

**Pattern established**:
- Avoid stacked Library subnav rows. Source visibility, Feed/List density, ranking, status, counts, and health should feel like one coherent control surface.
- Use the same compact segmented-control styling as System for Library modes. Library should not invent a new toggle language for the same interaction.
- Treat health as operational chrome: an icon with a popover, expandable details, and log excerpts. Warnings must explain themselves where they appear.
- List defaults should privilege the reading pane. Source lists should be only as wide as their labels require, artifact/feed lists should stay scannable, and detail panes should get the remaining space.
- Resizable panes should follow the Docs convention: stable defaults, a slim hover handle, and localStorage persistence.
- Saved-reference archive is destructive enough to hide behind an overflow menu and confirmation. It is also a durable source-ingestion suppression signal: keep the hidden `.archive` file around so explicit-save sources do not recreate it. Candidate Skip is a normal review action and can stay direct.
- Lifecycle filters belong with source filters in the rail and must update both the visible item list and source-list counts, so the numbers describe the current slice rather than the whole library.
- Library should be one composable surface, not separate Feed and Browse destinations. Keep ranking (`Recent` / `For You`), lifecycle (`All` / `Saved` / `Candidates`), source visibility, and density (`Feed` / `List`) as independent controls.
- On narrow widths, the Library filter rail should float as a lightweight popover with its own border/shadow. Do not dim the content behind it; the rail is a browsing aid, not a modal.
- Feed density is the default because it is the easiest reviewing surface. Feed can be full-width when nothing is selected, then compress into a split reader when an item is opened. Re-selecting the active Feed item can dismiss the reader.
- Full-width Feed cards should use available horizontal space when media is present. At wider desktop/tablet widths with no reader open, put the text body on the left and the thumbnail on the right so titles and descriptions share the same left edge across cards with and without media. Treat that thumbnail as an inset media object rendered at its natural aspect ratio, not as a cropped background cover. When the reader is open, or on narrow/mobile widths, keep the vertical card so the middle column stays scannable.
- Opening or closing the split reader from Feed must preserve the user's place by anchoring the active card's viewport position through the layout reflow. Do not preserve only raw `scrollTop`; card heights and widths change between full-feed and split-reader layouts, so the same pixel offset can land on a different item.
- List density gives the old Browse/inbox feel. It implies a reader slot: desktop should always reserve detail space, auto-select a visible item when possible, and show a quiet placeholder instead of expanding the list to full width when no item is selected.
- Opening a Library item should preserve the current Library context. Desktop can compress the current Feed/List into a left pane with detail on the right; mobile should open detail over the current list with a Back control and restore scroll position when returning.
- Library detail rendering should use Docs read-mode as the gold master for Markdown typography, links, bullets, tables, and rich text. Reference bodies should not carry navigation chrome or repeated source metadata; source/author/date/format live in frontmatter, while the visible document starts with title, optional media, summary, key points, connections, and raw content.
- Unread state in Library should feel like an inbox hint, not an obligation. Use the same small blue-dot language as top-level unread nav, keep count badges compact, and never mark a dense list read just because it rendered or scrolled past. Feed and List should require an explicit open, then mark read only when the reader moves away from that item.
- New/unread filtering belongs with Library ranking, not lifecycle status. `New` can span saved references and candidates, while source/status filters remain orthogonal controls for narrowing the same surface.
- Video references should behave like media documents, not static notes. Keep the video available while reading by letting it collapse into a small bottom-right player after the inline embed scrolls away, prefer faster playback for review, and make timestamped transcripts feel like an app-native reading surface with seekable rows and playhead context.
- Floating video should be tied to active playback, not mere scroll position. Do not pop out a video that has not been played or is currently paused; when floating, it should be movable/resizable and dismissible back inline without stopping playback.
- Transcript playhead tracking should not steal scroll. Keep active-line highlighting synced to the video, but require an explicit `Jump to Live` / live-follow action before the UI scrolls the transcript; any manual scroll should release that live-follow lock.
- Candidate dismissal should feel like an inbox action: remove the candidate from the active review surface immediately, show a brief undo toast, and keep skipped cache records out of default feeds unless explicitly requested.
- Feed card actions should collect as a left-aligned cluster in a bottom action row under the text block, separated from the body with a quiet divider. Treat `Candidate` as a plain inline review-state dropdown (`Save` / `Dismiss`) and `Updated` as the analogous plain dropdown (`Approve` / `Reject`). These controls should read like social/media action metadata: icon + text + chevron, no colored pills. Put source navigation plus saved-reference actions in the overflow menu. If an item has no general actions, do not render a dead overflow button. Keep filing/source tags below the description as body metadata across card widths; the source/date row should stay quiet and provenance-only.
- Library detail lifecycle state should appear once. For candidate items, put the candidate review dropdown in the top metadata/action line beside the version/score control, using a subtle amber pending-review treatment and a pending/dashed-circle icon. Do not repeat `Candidate` in the lower detail action row. The version/score metadata toggle remains clickable, but it should not show an extra caret; the metadata panel itself provides the expanded/collapsed feedback.
- Library eval metrics use progressive disclosure. Normal reading surfaces show only the compact worth score (`Zap` icon) as the priority signal in the card action row. It should look like an inline count/action, not a blue pill; clicking it opens the reference and expands the metadata panel. Store and compute eval metrics as 0–1 decimals, but render them in the UI as integer 0–100 scores (`0.87` → `87`) so cards and metadata stay legible. Admin/eval review contexts expand the same action row into component metrics: worth (`Zap`), relevance (`Network`), substance (`Layers`), and freshness (`Clock`), plus an `Archive?` lifecycle flag only when the eval suggests `to_archive`. Avoid artificial bucket labels such as `Must Read`, `Recommended`, or `Interesting`; the score is the truth, and the detail metadata panel is where labels, thresholds, and raw ranking explanations belong. Cards should not render the raw For You/eval `why` text.
- Library local refresh and source ingestion must be visibly different operations. Local refresh should be fast and reread file-backed state; `Check sources` should clearly mean a live external-source poll, show in-flight state, and report whether it added items, found duplicates/no new items, or hit a credential/source blocker.

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
- Keep the Apps camera wall at two columns even on mobile-width viewports; use compact port-only chips and hide secondary path/fallback text at the smallest sizes so the view feels like a feed of monitors, not a single-card detail feed.
- Keep three Apps camera columns through tablet and narrower desktop widths when there is enough horizontal room. Two columns should be the narrow/mobile fallback, not the default for ordinary resized desktop windows.
- In the Apps camera wall, the whole tile is the open affordance. Avoid redundant corner open buttons; keep service ports neutral and reveal the bottom service/freshness strip only on hover or keyboard focus.
- Apps preview overlays should follow the active Hilt theme. Use light-biased gradients, dark text, and light chips in light mode; keep dark glass overlays and light text in dark mode. Avoid always-on black overlays over light app screenshots.
- Preview overlays should feel like material, not just tint. Use moderate backdrop blur plus a fading mask behind the overlay content so the screenshot underneath softens near labels but returns naturally to the raw preview. Let blur carry most of the readability weight, but avoid so much blur that the preview looks smeared; keep light/dark tint low enough that the overlay does not become an opaque shade. The top overlay should be tall enough that app title/path text does not collide visually with text inside the screenshot. Keep text and chips on a separate crisp layer.
- Apps fallback/error camera tiles should use Hilt theme variables for their base surface and text. Do not hardcode dark-mode backgrounds for `No web UI`, capture failure, or similar states.
- Preview-backed cards should also use theme-aware loading surfaces before the screenshot image paints. Avoid hardcoded black image backdrops in light mode; the loading state should feel like the rest of the current theme.
- Machine sections are useful in the Apps camera wall when multiple Hilt peers are visible; they make the network view easier to scan than one unified cross-device grid.
- Local Apps tab switches should reuse the last client snapshot while refreshing. Avoid blank `Scanning local apps` flashes when the user is returning to a view they already loaded.
- Package-manager infrastructure should be named by the service command, not by the package manager root. `ollama`, `nginx`, and `mysql` are more useful cards than `homebrew`.
- Infrastructure cards need enough evidence to answer "why is this here?" when they do not have a recognizable app screenshot. Surface compact clues such as package manager ownership, product role, loopback-only binding, and data directories on the card itself instead of forcing a separate process-detail flow.
- Screenshot previews should show the app as the user would open it over the tailnet where possible. Keep fallback states honest: no web UI, HTTP status, or capture error is better than a stale decorative placeholder.
- Apps screenshots should be captured and displayed in the same 16:9 shape as the card. If an older/taller screenshot has to be cropped, anchor the image at the top so browser/app headers remain visible and extra content falls off the bottom.
- Manual refresh should mean "make this view current," including screenshot recapture when previews are enabled. Show screenshot freshness directly on the preview instead of making users infer whether an image is stale.
- Screenshot recapture should be tied to visible viewing intent: first visible load, manual refresh, visible tab return when stale, and a visible two-minute cadence. Background metadata polling should not spend machine resources recapturing previews.
- Preserve the last good screenshot when a later preview refresh fails. A capture error should become status metadata on hover, while the visual tile keeps showing the most recent known-good frame.
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

### 2026-06-09: Channel-Scoped Controls Nest Under Their Channel

**What changed**: The Library sidebar's "Show muted" list moved from a top-level position (sibling of all sources) into the Newsletters group, visible only when Newsletters is expanded.

**Why**: Muting is sender-email-based — it only applies to newsletters. A control that's only meaningful for one channel reads as noise (or worse, as broader than it is) when placed at the global level.

**Pattern**: Place a filter or control at the narrowest scope where it's relevant. If a capability was built generically but in practice serves one channel/section, its UI belongs inside that section — promote it to global only when a second real use appears.

### 2026-06-10: Browse Dimensions vs. Admin Filters

**What changed**: The content-type filter launched inside Admin filters, then moved to a top-level sidebar section (under Sources) with its own state; Admin filters became collapsible (closed by default, state remembered, amber dot when active-but-collapsed).

**Principle**: The sidebar has two species of control. **Browse dimensions** (Status, Sources, Type, Mode) are how the user navigates the collection — top-level, always visible, full-width rows with icon + label + count, an "All" row at top, each with independent state. **Admin filters** (pipeline/eval inspection) are diagnostic — collapsed by default, never entangled with browse state; "clear" resets only admin filters. A new filter belongs to admin only if it inspects the *system*; if it slices the *content*, it's a browse dimension.

**Detail rules learned**: accent colors (e.g. the memo's amber sparkle) belong on cards where attention is the point, not in sidebar chrome; special items (Editor's Memo) anchor the bottom of count-sorted lists rather than sorting as volume peers.

---

*This document should grow as design work continues. After UI changes are committed, consider what preferences or principles the changes reveal and add them here.*
