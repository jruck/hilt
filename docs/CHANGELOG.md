# Changelog

All notable changes to Hilt are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added

- **Graph — reflow-on-demand + edge-kind mixer (wire format v2)** — The two interactivity upgrades from the legend-mixer conversation. **(1) Reflow visible.** The canonical layout is the server's whole-graph equilibrium — every edge kind pulling at once — so a filtered view still sits in positions shaped by hidden nodes' springs ("ghost forces"). The legend footer now has **Reflow**: cosmos.gl's own GPU force simulation (shipped disabled for the static plot) is enabled at runtime over the CURRENT visible subset, seeded from current positions — the graph visibly relaxes for a few seconds and freezes. Mechanics verified against cosmos.gl 2.6.4 source: `setConfig({enableSimulation:true})` merges, velocity framebuffers materialize lazily in `updatePositions()`, so the renderer re-pushes current positions then `start(0.5)`; `onSimulationTick` drives the label overlay; `onSimulationEnd` + an 8s hard timeout freeze and restore render-only config. Explicit + ephemeral by design: never auto-fires, never persists, any filter change/refetch supersedes it (a **Restore** button snaps back to canonical without touching pan/zoom). Solo Topics → Reflow = a pure theme-space map; solo `similar` edges → Reflow = the corpus arranged by embedding meaning alone. **(2) Edge kinds on the wire (TRANSPORT_FORMAT_VERSION 2).** The binary payload shipped edges as bare index pairs — kind existed only server-side, so connection families couldn't be filtered client-side. v2 adds `EDGE_KINDS Uint8Array(edgeCount)` (+pad) after EDGES and a per-payload-interned `edgeKindTable` in the sidecar (~1 byte/edge); encoder + server decode + client decode updated in lockstep; a stale client throws `GraphFormatError` and hard-refreshes (existing contract). The legend's Connections section is now a second mixer — hide/solo per edge kind with honest raw-payload counts (single-select solo, same `effectiveHiddenSet` resolution, persisted separately) — and `filterDecodedByEdgeKinds` drops links client-side without touching nodes. Live-verified: the served global payload decodes as v2 with per-kind counts (meeting 11,994 / item_entity 2,749 / wikilink 1,382 / topic_parent 825 / item_topic 776 / connection 701). Tests: kind round-trip in `encode.test.ts`, kind-lockstep + edge-kind filter in `decode-filter.test.ts` (graph 76 green, tsc 0).

- **Tailnet gateway mode — base path, single-origin /events, custom app server** (`~/work/meta/internal-app-gateway-plan.md`) — Hilt can now be served behind a path-routing gateway (Tailscale Serve `https://xochipilli.tailc0acaa.ts.net/hilt/ → localhost:3000`) while ordinary unprefixed dev/Electron behavior is untouched. **(1) Base path**: `NEXT_PUBLIC_BASE_PATH` (normalized leading-slash/no-trailing-slash in `next.config.ts`, inlined canonically) drives Next's `basePath` plus a new helper `src/lib/base-path.ts` (`withBasePath()`/`getBasePath()`); ~120 app-owned root-relative URLs (every client `fetch("/api/…")`, generated img/iframe srcs, `window.open`) now route through it. External/data:/blob:/hash URLs pass through; SWR **cache keys stay unprefixed** (helpers wrap inside fetchers) so `mutate("/api/…")` invalidation keeps matching; `BridgeTaskEditor`'s markdown save-path strips the prefix so vault files round-trip unprefixed. PWA manifest moved from static `public/manifest.json` to `src/app/manifest.ts` so `start_url`/`scope`/icons follow the base path (`/hilt/` via gateway). **(2) Single-origin real-time events**: new `server/app-server.ts` — one `http.Server` that delegates HTTP to Next and owns the `${basePath}/events` WebSocket upgrade, raw-splicing it to the internal ws-server on loopback (`~/.hilt-ws-port` read per-upgrade; ws-server keeps all watch/broadcast logic). `useEventSocket` now dials **same-origin + base path, no explicit port** (`wss://host/hilt/events` via gateway; the `/api/ws-port` fetch is gone), which is what makes live updates and `/navigate` work over Serve from laptop/phone — supersedes plan 005's host:port derivation. Gotcha worth keeping: in dev, Next's custom-server integration lazily attaches its own `upgrade` listener (via `req.socket.server`) that kills foreign upgrades — app-server guards later-registered upgrade listeners away from `/events` (HMR passes through). **(3) ws-server hardened**: binds `127.0.0.1` only (was `0.0.0.0` — closes the ws half of the advisor audit's network-exposure finding); `/navigate` stays a localhost-only POST. **(4) Scripts/supervision**: `npm run dev` now boots the custom server (replaces `next dev --turbopack`; `dev:webpack` remains as escape hatch — note it has no `/events` proxy); `start` = production custom server; `build:gateway`/`start:gateway`/`serve:gateway` build+run the prefixed service in an isolated `HILT_DIST_DIR=.next-gateway` (gitignored — **Tailwind v4 scans non-gitignored build dirs and 500s dev with garbage utility classes**, hence `.next-gateway`/`.next-devtest` in `.gitignore`); `scripts/hilt-launchd-gateway.sh` + `com.hilt.gateway` LaunchAgent replace `com.hilt.dev-server` for always-on supervision. Electron's source probe (`isHiltSourceUrl`) appends to the source URL's path instead of root-resolving so a `https://host/hilt` source probes `/hilt/api/ws-port`. Known limitation: the packaged-Electron standalone server (`.next/standalone/server.js`, `electron:dist` path) doesn't host the `/events` upgrade — the daily-driver dev app and the launchd service both use app-server and are unaffected.

- **X content recovery via browser session + prose-vs-link capture health** — The X API doesn't expose X *Articles* (a separate product) or protected posts, so link-shares of walled content captured as 127-char stubs (`the-untrainable`). New `scripts/library-x-recover.ts` (`npm run library:x:recover -- --path … | --bucket`) reads them through the **`browser-use` CLI against the real, already-logged-in Chrome profile** — no separate login, no stored credential, no rate-limit risk (agent-browser was evaluated first but only offers throwaway temp profiles; an automated-login attempt tripped X's rate limit — both dead ends, recorded). It extracts post/article text with a deterministic `eval` (no LLM call), caches with `browser:` provenance, redigests, and stamps `reweave_pending`. **Manual-only** (drives a real browser; must not fight the live Chrome in the nightly drain). Proven on a tweet (vimota) and the untrainable article. **Capture-health predicate refined** (`capture-health.ts`): a metadata-fallback capture is now "failed" by **prose-word-count after stripping URLs/timestamps/`Author:`-`Published:`-`Links:` scaffolding** (< 6 alphabetic words), not raw char length — length misfired both ways (short-but-complete tweets read as stubs; padded link-lists read as content). Live buckets corrected: refetch 65→44, X stubs 122→40 (~80 false-positive short tweets cleared). The shared predicate already gates the eval's needs_refetch lifecycle, the scorecard, and the reweave/refetch drains, so this sharpens all of them at once.

### Added

- **Capture health as a first-class, VISIBLE state** — Prompted by `the-untrainable`: an X post whose entire text is one t.co link to a login-walled X Article. The X fetch "succeeded" (127 chars of nothing), got graded `hot`, and evaded the needs_refetch gate — a stub wearing a passing grade. **(1) Shared predicate** (`capture-health.ts`): failed = the explicit no-source marker OR a `source-metadata` digest under 150 chars (the bare-link stub case; real short posts clear it). Wired into the eval gate, the metrics scorecard, the refetch drain (bucket + success check), AND the weave drain — **a stub is never re-woven** (it needs FETCH, not weave; the refetch drain re-stamps `reweave_pending` on recovery). **(2) Card-visible error state**: `EvalMetricPills` renders an amber ⊘ (Ban) in PLACE of the worth pill for `needs_refetch` items — no worth score is shown until the data behind it is real (user direction: "I don't want to be surprised that it didn't fetch — I want to see it on the cover"); same amber convention as Library Health. **(3) The item itself recovered**: the essay is Sarah Guo's "The Untrainable," found publicly on her Substack; cached with provenance, description set, queued for tonight's weave. Known limitation worth recording: digestion's X-source path takes precedence over cached content, so X link-shares of walled content can't self-heal through redigest — recovery is cache-then-weave.

### Changed

- **Library and Calendar toolbar control polish** — Library's live source check action now uses an icon-only refresh button in the secondary toolbar, and the Library health button's normal state uses the same neutral outlined treatment instead of a filled surface. Calendar's actions menu button now swaps the three-dot icon for a spinning refresh icon while sync is running, and the mini-month toggle's active state uses the same quiet depressed shade as hover rather than a raised/white selected treatment.

### Fixed

- **"Show in graph" was broken on every surface** — The buttons passed what each surface naturally has (Library: artifact id = relative-path hash; Docs: raw file path; People: bare slug), but graph node ids are `ref:`/`note:` + ABSOLUTE-path hash, `cand:<id>`, `person:<slug>` — so every click landed on "isn't in the graph yet." The items were in the graph all along (saved refs and candidates both have nodes; candidates are semantically embedded too); the buttons spoke the wrong dialect. Fix: new `GET /api/system/graph/resolve?ref=` resolves any external ref form (node id, `cand:`/`person:`/`project:` prefixes, abs/rel vault paths via refPath + path-hash schemes, library artifact id via path lookup) to the canonical node id, and GraphView retries a focus miss through it ONCE before showing the fallback banner (attempted-set prevents resolve→navigate loops when a node is genuinely LOD-filtered). Verified live for all four forms. Surfaces stay dumb — they never need to learn the graph's id scheme.

### Added

- **Refetch drain — archive.org fallback + redigest date fix** — When the live re-fetch leaves the no-source marker in place (paywall, bot-block, dead page), `library-refetch.ts` now tries the most recent Wayback Machine snapshot (availability API → `summarize --extract` on the snapshot — archive.org doesn't bot-block; <800-char extracts are rejected as archive chrome/error pages). Recovered text is cached into Raw Content with a `source_recovered_from` provenance stamp, then a cache-preferring redigest rebuilds the digest and the item gets `reweave_pending` for the nightly weave. Proven first by hand on the openai harness-engineering essay (403s every non-browser fetch, even with a Chrome UA; wayback recovered the full 19KB article). Also fixed: `library-redigest.ts` invented TODAY as `raw.date` when a file had no published/captured/digested — a *failed* refetch could clobber `published` with the current date (it did, on the harness essay: Feb → June). The chain now includes `created` and falls back to empty, which preserves `existing.published`.

- **Hardening batch (plans/001–006)** — Six planned improvements implemented and independently verified (full report: `plans/IMPLEMENTATION-REPORT.md`). **(Security)** The `/api/reveal` route's interpolated `exec()` — a shell-injection RCE — replaced with `execFile("open", ["-R", path])` so metacharacters are inert, with a regression test. **(Durability)** The docs-save route and all three JSON state stores (inbox, preferences, sources) now use `atomicWriteFile` — no more torn writes on crash. **(Performance)** Library scoring entry points share a 2s-TTL cache keyed on vault path + directory-mtime fingerprint, eliminating the per-call full-vault reload; scores byte-identical to baseline. **(Remote)** The `/events` WebSocket URL derives from `window.location.hostname` with protocol-aware `ws:`/`wss:` instead of hardcoded localhost, so tailnet clients connect back to the host that served them (iPhone-via-Tailscale-Serve follow-up documented in `plans/README.md`). **(UX)** New `chooseLandingView()`: the app lands on Briefings when any exist, else Bridge. **(CI)** One-command verification: `npm test` = all ten node:test suites + vitest (33 tests across the new reveal/db/landing/useEventSocket files) + `tsc --noEmit`.

- **Library content-type icon system + Type filter** — Icons now describe WHAT an item is, not which pipe it arrived through (the old `ChannelIcon` keyed on capture channel, so a manually-saved YouTube video rendered as a document — the audit found the data itself was ~clean: only 2 mislabeled videos and 15 unlabeled repos across 871 items; the display logic was the bug). Master reference: ✨ memo (amber, source_id wins) · ▶ video (`video`, `video-workshop-transcript`) · `</>` code (`code`, new) · 💬 post (`tweet`/`tweet-thread`/`x-article` — chat bubble per Twitter's text-messaging origins, user preference) · ✉ newsletter (Mail — it came over email) · 📖 book/guide · 🎙 podcast · 📊 slides · 🖼 image · 📰 article · 📄 page (default). Codified in ONE resolver (`src/lib/library/content-type.ts`, pure/client-safe: format first; URL/duration evidence only UPGRADES generic link/bookmark/document formats — never downgrades a specific one, so a video-tweet stays a post) + ONE component (`ContentTypeIcon.tsx`) used by every surface. `LibraryArtifact` gained `format` on the wire. **Ingest learns the same rules**: `inferFormat` now detects video URLs (youtube/vimeo/loom) and code hosts (github/gitlab/bitbucket/gist) before falling back to the channel default, so future Raindrop/manual saves classify correctly; `code` added to the substance format table (0.45). **One-time repair**: 2 videos + 15 repos re-stamped. **Sidebar "Type" filter**: new `content_type` workbench facet + list-route param, promoted to a TOP-LEVEL sidebar section under Sources (per user direction) — full-width rows with the content-type icon + label + live count (391 posts, 207 pages, 128 videos, 98 newsletters, 25 articles, 15 code, …); click toggles. **Admin filters are now collapsible**: closed by default, last state remembered (`hilt-library-admin-filters-open` localStorage), with an amber dot on the collapsed header whenever admin filters are active so a filtered feed is never a mystery. Follow-up refinements (user direction): Type got its own first-class filter state (`typeFilter` in LibraryView — admin "clear"/active-dot semantics never touch it, exactly like Source), an **All types** row at the top, the Editor's Memo pinned to the bottom of the list, and the memo's sparkle renders unaccented in sidebar chrome (`ContentTypeIcon accent={false}`) while staying amber on cards.

- **Graph — docked legend mixer (hide + solo)** — The legend moved out of the toolbar dropdown onto the canvas as an always-visible left-docked panel (`GraphLegendPanel`; the inspector owns the right edge; vertical screens have the real estate). Each node type is a mixer channel strip: swatch + name + **honest count from the raw payload** (a hidden type still shows what it would contribute), an eye to hide, and an **"S" to solo** — audio-console semantics where any solo shows ONLY the soloed types (multi-solo unions) and suspends the hide flags until cleared (`effectiveHiddenTypes` in graph-labels.ts, unit-tested). Hide and solo sets persist independently in localStorage; a `reset` affordance appears when anything is filtered; the panel collapses to a pill (default-collapsed on mobile); edge-kind descriptions stay as a collapsed informational section. The toolbar's dropdown legend (and its dead env-flag gating) is gone. Filtering still happens pre-renderer with positions preserved — the layout stays the whole-graph equilibrium; toggling only lifts the veil. Suites: graph 75 green.

- **Graph legibility loop (items 1–4 of `docs/plans/graph-legibility-loop.md`)** — The System → Graph semantic layer made legible and trustworthy, working the loop's gated criteria. **(1) Topic labeling fixed at scale.** Root cause of the all-placeholder taxonomy: ONE labeling call over all 847 clusters (~480K-token prompt expecting 847 labels in one JSON response) blew output limits and the global fail-soft named every topic "Theme L0-N". Labeling now runs in batches of `SEMANTIC_LABEL_BATCH` (48) with one retry and per-batch fail-soft (`runLabelBatches` in gemini.ts); the refit labels in two phases — leaves from member excerpts, parents from their children's resolved labels+summaries, deepest first (a 1,148-item root labeled from 8 raw excerpts was unanswerable; from its child themes it's a synthesis question). New **label-only repair mode** `semantic:refit -- --relabel-only [--all]` (`relabelTopics`) renames without re-clustering — no membership/lineage churn — and bumps the watermark so the overlay picks up new names. Second real-run fix: the labeler must echo cluster ids, and ~40% of raw `topic:<16-hex>` ids came back mangled (updates hit nothing while "relabeled" counted returned labels); the repair now hands the model SHORT aliases (`c0…cN`) and maps back locally, never trusting it with hashes. Real-corpus result: top themes named in the user's own vocabulary — "Product & Engineering Syncs", "AI-Native Product Strategy", "GuildQuality sprint standups", "Jason 1:1 Operations & Features", "Automated yard monitoring logs"… **(2) Entity mention floor.** 60% of entities were single-mention noise (2,736 of 4,591) and every one was minted as a graph node — the cyan dust flood. The overlay now plots only entities with `mention_count ≥ SEMANTIC_GRAPH_ENTITY_MIN_MENTIONS` (default 3); gated entities keep all their `semantic.sqlite` rows (queryable, unplotted) and their edges drop via the existing endpoint pre-filter (no dangling edges). **(3) Root granularity — documented de-emphasis, not a re-cluster.** The labels revealed the 1,148-item mega-root is the meeting-transcript mass, honestly named ("Product & Engineering Syncs") — the corpus's true shape, not a clustering bug. Rather than chase cluster params, `item_topic` edges are now **leaf-only**: an item's parent membership is derivable (item → leaf → `topic_parent` → parent), so item→parent edges were pure redundancy — and they're what pinned the mega-root at corpus-scale degree (MAX size, owning every label slot). A parent's degree now reflects its child count (structure), not transitive item mass. Splitting the meetings mass via sidecar params stays open as a calibration exercise (requires repeated re-cluster+relabel runs to evaluate). **(4) Legend toggles + topic-first labels.** The legend is now a control panel: every node type has a persisted show/hide toggle (`filterDecodedByTypes` filters the decoded payload before the renderer — positions preserved, nothing moves; links keep only pairs with both endpoints visible), with an "N hidden" chip on the button. On-canvas label selection reserves **half the top-K slots for named topics** (placeholder-labeled topics earn no priority) so themes own the legible layer instead of mega-hub entities. Also fixed: the legend's Topic/Entity rows were gated on `graphSemanticOverlayEnabled()` — a server-env check that's always false in a client component, so they never rendered; the legend now keys off `meta.semanticBuilt` (data-driven). Tests: `runLabelBatches` unit (batch math, per-batch fail-soft, retry-once), two-phase labeling (parent inputs are child labels, never raw chunks), `relabelTopics` (repairs placeholders in place, leaves real labels + membership untouched, advances the watermark), entity mention-floor gating (no node, no edges, still queryable), leaf-only `item_topic` (a higher-scoring parent membership mints no edge), `filterDecodedByTypes` (remapping, hasZ, no-op identity). Suites: semantic 109, graph 71, all green.

- **Editor's memo — first-class presence + Sunday briefing fold** — (1) The weekly memo now renders to `/api/reports/memo` (same report pipeline as the morning report) and the briefing gather appends the latest memo when ≤7 days old; the briefing skill opens the Library section with the memo's thesis as a one-line headline + `[Read the memo](/api/reports/memo)` link, skipping repeats. (2) In the Library UI the memo stands out: an amber **Sparkles** icon on feed cards (`ChannelIcon` now keys on `source_id: library-memo` — "the library writing to YOU") and an **Editor's Memo** pseudo-source in the sources sidebar (same pattern as Manual; appears once a memo exists). (3) **Recommendations job hardened against transient API failures**: the 07:25 editor pass hit a one-off Claude 401 (OAuth refresh race) and treated it as fatal — dumping a 17KB prompt to stderr and ambering Library Health. It now skips cleanly (`{skipped:"api_error"}`) on `is_error` envelopes in both the error and exit-0 paths — a missed pass is benign by design (≤30h stale-cache fallback, then the deterministic funnel). Stale error log cleared; health back to green.

- **Morning report → daily briefing integration** — The Hermes briefing (06:00 cron) now folds in the library steering report (written 05:10, ~50min margin): the canonical gather script (`<vault>/meta/skills/briefing/scripts/gather.sh`) appends the full `meta/library-reports/<today>.md` to the briefing context with a fallback line when the steering job didn't run, and the briefing skill's "Library & knowledge" section now leads with proposals awaiting Justin's verdict (action items), notes scorecard movement/judge disagreements as headlines, and always links `[Full library report](/api/reports/morning)` — a same-origin URL that resolves in the Hilt Briefing tab locally and over the tailnet. Headlines-plus-click-through, per the stated briefing philosophy.

- **Graph — semantic overlay enabled live (the third flag trap)** — The System → Graph tab now actually shows the semantic layer. The whole integration (topic/entity nodes, five semantic edge kinds, the GraphRunner's watermark-gated `refreshSemanticOverlayIfStale`, legend gating on `topicNodeCount`/`entityNodeCount`) shipped with Phase 2 — but `HILT_GRAPH_SEMANTIC` was never set in the live env, so the graph stayed purely the explicit layer (2.6K nodes / 5.1K edges: directory-derived types + wikilink/connection/meeting edges). Enabled 2026-06-10 (+server restart, full rebuild + relayout): the graph is now **8,048 nodes / 42,649 edges** — 847 topic clusters with `item_topic`/`topic_parent` hierarchy, 4,611 entities with `item_entity` salience edges, 9,344 item↔item `similar` embedding edges (cosine ≥0.78, top-5), 12,355 entity `co_occurrence` edges — all 8,048 placed by the full layout pass (state `frozen`). `similar`/`co_occurrence` stay off-by-default in global scope (on in local/focus, or `&semanticEdges=1`). Freshness is automatic from here: the GraphRunner watermark-checks `semantic.sqlite` each reconcile, so weekly re-fits and incremental semantic updates flow into the graph unattended. This is the **third** silently-off semantic flag (after `HILT_SEMANTIC_ENABLED` in the live server and the launchd env gap) — the lesson stands: a flag-gated feature isn't done until the flag is verified ON in the runtime that matters.

- **Library v2 — steering round 1 (first approved loop cycle)** — The morning report's two proposals went through the full contract: user verdict → implement → free re-score → mark processed → ledger. **(1) `needs_refetch` lifecycle** (user ruling: a failed source fetch is a *pipeline* problem, not a content-quality verdict): items carrying the explicit "No cached source content available" marker route to a new `needs_refetch` lifecycle — never `to_archive`, excluded from the For You pool, surfaced as a "Needs re-fetch" admin filter facet, why-string prefixed "source capture failed — held for re-fetch". A `warm` digestion alone deliberately does NOT trigger (warm items often carry real partial content — inline text, X posts — and stay gradable; the ranking test pins this). Re-score delta: **65 of 820 study items** rerouted out of grading judgment; the motivating McKinsey item shows relevance 0.753 (Product Factory tie) — a high-value item the old logic would have archive-flagged off a stub. **The re-fetch drain is now built and scheduled** (`scripts/library-refetch.ts`, `com.hilt.library.refetch` daily 04:45): bounded (10/run), attempt-capped (2 tries, sidecar in DATA_DIR, fresh-first ordering), zero Claude window — it re-fetches + Gemini-digests via the proven `library-redigest.ts --refetch` path with `LIBRARY_CONNECTIONS_DISABLED=1`, and recovered items get `reweave_pending` so the 03:35 nightly drain weaves them inside its own budget. Honest first-run finding: 0/4 recovered — 29 of the 65 bucket items have fetchable URLs at all, and those are dominated by genuinely hard sources (paywalls, bot-blocked pages, X posts needing the auth path; summarize CLI itself verified healthy against a control URL). **X auth path fixed (same session):** the X-post fetcher (`fetchXPostText`) resolved its `xurl` binary ONLY from the capturing source's `metadata.xurl_path` — so X posts saved via Raindrop reconstructed with Raindrop's config, found no binary, and silently skipped the authenticated API path entirely. Fix: global `XURL_BIN` fallback in `.env` (the existing scoped OAuth app reads individual tweets fine — verified incl. long-form `note_tweet`), documented in `.env.example`. Re-ran the drain with X attempts reset: **19 of 29 fetchable items recovered across two rounds** (bucket 29 → 10; the remainder are genuine paywalls/dead URLs that will exhaust their attempt cap). Recovered items are stamped `reweave_pending` — `library-refetch.ts` now does this on every recovery, because `library-redigest.ts`'s `mergeFrontmatter` preserves the old `reconnected_at`, which would otherwise leave STUB-judged connections in place and hide the item from the nightly weave drain. Today's 18 pre-fix recoveries were retro-stamped; tonight's 03:35 drain weaves them all (28 queued, within the 40 cap). **(2) Clip item removal** — already deleted in the 06-09 validated-junk purge (detector audit: it predated enforcement; no pattern gap). Both feedback comments marked `processed_at`; ledger entries in `docs/eval-labels.md`. `test:library` green (113), tsc/eslint clean.

- **Semantic layer — candidates embedded + steady-state schedule installed (health-survey fixes)** — Two gaps from the 2026-06-10 semantic health survey closed. **(1) Candidates are now first-class semantic items.** `collectItems` folds in `collectCandidateItems()` (new, via the candidate-cache API — the same source and `cand:<id>` id scheme as the graph's candidate nodes), so the ~181 review-queue candidates get real embedding centroids and the library eval's semantic `contextFit` covers them instead of falling back to the saturated token-overlap path (previously 0/181 covered — the weakest remaining link in judge–score agreement). The `SemanticRunner` handles the full candidate lifecycle: `isInScope` admits the candidate cache (the one dotdir we ingest), `itemChunksFor` parses candidate files via `parseCandidateFile`, `diffDirs` diffs candidates alongside `references/` (folding them into `seen` so the removal sweep doesn't falsely sweep every tracked candidate each pass), and a status flip (promoted/expired/skipped) drops the item on the next signal. **Candidates are embedded but NOT entity-extracted** — transient un-vetted discovery content would mint junk entities that outlive the candidate; they DO join topic clustering (~7% of corpus, 30-day expiry, the weekly re-fit self-corrects). **(2) The `com.hilt.semantic.*` launchd family is now actually installed** (refit Sundays 03:30, gc daily 04:30) — the health survey found the scheduler code existed but was never installed, leaving topics frozen at the cold-start fit with 559 unassigned outliers and the refit signal-gate (≥10 new) exceeded 55× over. The run-at-load `cold-start` job was booted out immediately post-install: it fired a duplicate full pass on install (racing the in-flight backfill), the initial backfill is long done, and re-firing a full re-cluster+relabel on every login is waste. **Flag-trap fix:** `scripts/semantic-backfill.ts` + `scripts/semantic-refit.ts` now `loadEnvConfig(process.cwd())` so launchd jobs see `.env.local` — without this every scheduled run would have silently no-op'd on the unset `HILT_SEMANTIC_ENABLED` (the exact trap that left the live eval on token-fallback until 2026-06-10). Tests: candidate collection/id-scheme/status-filter in `chunking.test.ts`; embed-but-don't-extract, status-flip removal, and non-candidate-dotdir exclusion in `runner.test.ts`.

- **Library v2 implemented (Phases A–E)** — The full build of `docs/plans/library-v2.md` in one pass; living detail in `docs/plans/library-v2-implementation-report.md`. **(A) Foundations:** engagement event log (`events.ts`, JSONL in DATA_DIR — served/opened/read/promoted/skipped/rescued/archived/feedback events wired into all library API routes, never breaks a request); every scoring constant extracted to versioned `meta/library-scoring.json` (`scoring-config.ts` pure + `scoring-config-loader.ts` server-only — split after the fs import broke the client bundle and 500'd the library API); `docs/eval-labels.md` calibration ledger created; **judge layer** shipped as pipeline **v2.2** (`attention_judgment` tier+reason in the reweave contract, persisted through both writer paths; v2/v2.1 stay current). **(B) Steering loop:** `library-steering.ts` (daily 05:10 launchd) computes the 7-metric scorecard (`library-metrics.ts`), clusters unprocessed feedback into typed fix proposals (one light Sonnet call), surfaces judge↔formula disagreements, writes the morning report to vault `meta/library-reports/` — propose-only, more/less/rollback contract. **(C) Editor's memo:** `library-memo.ts` (Sundays 05:30) synthesizes the week's intake into project-tied through-lines, written to the vault as a first-class library item. **(D) For You v2 funnel:** worth-ranked pool minus negative signals → daily LLM **editor pass** (`library-editor-pass.ts`, replaces the 07:25 compute-into-a-log job) picks 7 with stated user-facing reasons (cached in DATA_DIR, served by the API, shown on For You cards via `FeedCard reason`) → source-diversity cap, near-dup dedup, one daily-rotating exploration slot. **(E-lite)** mtime parse cache + precomputed signal tokens + semantic-context cache: list 450–700ms → ~250ms, recommendations 1.25s → 0.30s (full SQLite index still specced for ~5k items). **First live scorecard:** judge agreement 54% exact / 100% adjacent (n=24; judge consistently harsher — the calibration backlog now surfaces in every morning report), For You precision@8 **8/8**, first editor pass 7/7 reasons naming specific projects, first morning report generated with 2 clustered proposals. **Verification round** (6-agent adversarial workflow + spec critic): headline catch — `HILT_SEMANTIC_ENABLED` was set nowhere live, so the semantic relevance layer had been dormant since it shipped; enabled (+server restart), judge agreement rose to **63%** and the strict precision count hit **7/8 high / 8/8 not-low on the real served feed, fully judged**. Same-night fixes from the findings: metrics made honest (judge the served feed with dual counts; rescue metric counts only to_archive-confirming archives via a meta stamp; clustered_at stamps separate the loop's latency from the user's; completeness uses the union + version currency), event-log integrity (no_log probe param so the nightly scorecard never writes phantom impressions; feed impressions instrumented page-1/declared-surface only; merge-order fix; mtime-cached reads), steering hardening (LOCAL-date report filenames — the UTC name would have been overwritten by the next morning's run; never re-cluster already-proposed feedback), funnel corrections (full-corpus pool — a silent newest-200 pre-cut was defeating the exploration slot; editor prompt states the source cap), and config safety (per-leaf finite validation in the scoring-config loader; parse cache clones at store time). Full detail + accepted-deviations list in `docs/plans/library-v2-implementation-report.md`.

- **Reference Library v2 spec** (`docs/plans/library-v2.md`) — Documented the June 2026 full-system audit and the second-act build plan: v1 built the pipeline (now stable, backlog 0); v2 builds "the editor." Audit findings recorded so they aren't re-derived: zero learning loops close automatically (all scoring weights hardcoded; behavioral signals — reads, rescues, promotions, feedback — collected but never consumed; the 7:25 recommendations job logs to nowhere; `/process-library-feedback` is manual-only), For You is unvalidated hand-tuned heuristics with a saturated token metric for candidates and no diversity/dedup/exploration, list requests re-parse ~1,090 files per request (450–700ms now, breaks ~5k items), and insight synthesis is absent. Five workstreams: (1) steering loop — scheduled feedback processing + morning report with more/less/rollback verbs, scoring constants extracted to versioned `meta/library-scoring.json`, `docs/eval-labels.md` ledger; (2) engagement/impression event logging (prerequisite for everything); (3) the weekly "editor's memo" — cross-item through-lines tied to active projects, pinned + folded into the Briefing; (4) For You v2 staged funnel — cheap score → LLM editor pass with stated reasons → diversity/dedup/exploration re-rank, negative feedback weighted heavily (the transferable recsys/X-algorithm lessons; no trained rankers at single-user scale); (5) derived SQLite read index (graph/semantic-sqlite precedent). Plus the **judge layer**: an `attention_judgment` field in the reweave output (the agent already reads source + vault; its discarded worthiness judgment becomes a free LLM-judge label; prompt change → standard generation cycle) and a **7-metric minimum viable scorecard** (judge–score agreement, For You precision@8, rescue rate, open rate, feedback latency, weave completeness, p50 latency — with baselines and targets). Phased A–E with hard constraints (no silent learning, no auto-archive, Claude-window budget rules hold).

- **Tailnet-hosted HTML reports** — `scripts/report-html.ts` renders a markdown report (default: the Library v2 implementation report) into a standalone, phone-friendly HTML page (markdown-it, dark-mode aware, scrollable tables) under `~/.hilt/reports/<name>/index.html`; new `GET /api/reports/:name` serves it (allowlist-validated name, no-store). Hosting rides the existing Tailscale Serve mount of the dev server — `tailscale serve` file mounts require root, so the route approach needs zero new serve config and survives reboots with the dev server.

### Changed

- **Library sidebar — "Show muted" nests under Newsletters** — Muting is sender-email-based (newsletters only; `library-mute.ts` skips muted senders at ingestion), but the muted list rendered as a top-level sibling of all sources, implying broader scope. It now lives inside the Newsletters group and appears only when that group is expanded, indented like the newsletter facets. Design principle recorded in DESIGN-PHILOSOPHY ("place a control at the narrowest scope where it's relevant").

### Added

- **Reference Library — YouTube clip suppression ENABLED (consolidated policy)** — The human-review phase concluded: every `label_review` and `suppress` verdict in the admin clip lanes was validated as a genuine clip/short (100% precision across both episode-clips and standalone shorts), so the detector graduated from report-only to enforced. **(1) Policy consolidation** (`youtube-clip-detector.ts`): non-explicit `clip`/`short` forms now suppress at any detected confidence (was ≥ 0.75, with 0.55–0.75 going to review), and confident `standalone_short` (≥ 0.6) suppresses instead of asking for review; `label_review` stays in the taxonomy as a valve for future detector iterations but no current path emits it. Explicit user saves are still NEVER suppressed (`label_only`) — a deliberately bookmarked clip always comes through. **(2) Enforcement** (`runner.ts`): a `suppress` verdict from the metadata preflight now skips the artifact BEFORE digestion — junk clips no longer cost Gemini digests, Claude reweaves, or feed space. The skip follows the muted-sender pattern and is fully audited in the ingestion report (per-artifact `status: skipped` + `reason: youtube_clip_suppressed` + the clip-policy rollup). Kill switch: `LIBRARY_YOUTUBE_CLIP_SUPPRESS=0` reverts to label-only behavior. **(3) Lane cleanup**: the 12 validated junk candidates (11 review + 1 auto-skip) were removed from the vault rather than waiting out their 30-day candidate TTL. Tests updated to pin the consolidated policy plus a new ingestion test asserting the pre-digest skip and its audit trail (and the kill-switch path keeps the metadata-persistence test on the written-candidate flow). Also in this session: the `youtube-liked-videos` source was disabled (`enabled: false` in the vault source config) and its 48 discovery candidates deleted — liked videos no longer ingest.

- **Reference Library — false-positive rate-limit detector fix (the notcrawl poison pill)** — The nightly drain had failed four consecutive nights (06-06 → 06-09), always "rate_limited" on the same first item, and manual backfills "hit limits almost immediately": none of those were real rate limits. `detectRateLimit()` regex-sniffed the **entire** Claude CLI stdout — including the model's digest text inside the success envelope — for `rate.?limit|quota|429|…`. The oldest backlog item (notcrawl, a "**rate-limit-aware**" Notion crawler) deterministically sorted first in every run, its digest necessarily echoes "rate-limit", so each attempt burned a full successful agentic reweave, discarded the result as a `RateLimitError`, exited 75, and halted the drain (`break` on first rate_limited) or looped the backfill (exit-75 requeue had no cap) — wasting real window budget and *causing* the genuine limits it claimed to detect. Fixes: **(1)** New `detectRateLimitInEnvelope()` (`connections.ts`) parses the `--output-format json` envelope first — a successful result (`is_error: false`) is model CONTENT and is **never** sniffed; only `is_error: true` envelopes, non-envelope stdout, stderr, and error messages (all error surfaces) are checked. **(2)** `library-reweave-pending.ts` tracks per-item failure counts in a DATA_DIR sidecar (`library-reweave-attempts/<vault>.json`, operational state like read-state — never the vault); the worklist is ordered fresh-first by attempts **before** the `--limit` slice so a deterministic per-item failure can't hog a bounded run's slots, counts clear on success and are pruned when items leave the backlog, and `rate_limited` (a global window condition) doesn't count against the item. The report now also carries `backlog` (pre-limit total) and per-result `attempts`. **(3)** `library-backfill.ts` gained a circuit breaker: N consecutive rate-limit pauses with zero successes in between (default 4, `--max-rate-limit-pauses`) aborts the run cleanly with exit 75 and an unprocessed count, instead of exponential-backoff-thrashing a closed window forever; any success resets the counter. New tests pin the poison-pill case (a success envelope ABOUT rate limits is not limited; an `is_error` envelope with limit text is, with reset time parsed). An adversarial review pass then hardened the failure path too: **(4)** `runClaude` now attaches the captured stdout/stderr to its rejection and the catch path **never sniffs `error.message`** — execFile builds that message from the full command line, which embeds the `-p` task (KB index + source excerpt), so a *failed* reweave of rate-limit-themed content would have re-created the poison pill on the timeout path (and any "quota"/"429" in the shared KB index would have misclassified *every* per-item failure). **(5)** `detectRateLimitInEnvelope` only trusts `is_error` on objects that look like the result envelope; other JSON on stdout (an API error blob like `rate_limit_error`, an array) falls through to the raw sniff. **(6)** The drain prunes attempt counts against the *widest* backlog scope, so a narrower invocation (`--saved-only`, no `--include-version-behind`) can't wipe counts for items it isn't looking at. **(7)** Numeric CLI flags in both scripts fail closed on garbage (`Number.isFinite` or exit 64) — a typo'd `--max-items`/`--max-rate-limit-pauses`/`--concurrency` previously went `NaN` and silently disabled the safety cap, the circuit breaker, or hung the worker pool. **(8)** `health.ts` `lastRateLimitAt` now tests only the LAST run's chunk of the appended launchd drain log, so the four historical false-positive `rate_limited` lines stop pinning the panel's `last_throttled_at` to the log mtime after drains turn clean. Live validation: the notcrawl smoke test reweaved cleanly on first attempt (v2.1, `reconnected_at`, 3 woven connections) after 4 nights of false failures; a full manual drain then cleared the rest of the backlog — **8 → 0** (5 in the drain + 2 transient `skipped_error` items that succeeded on direct retry, exercising the attempts sidecar exactly as designed). `test:library` green, eslint/tsc clean.

- **Reference Library — rate-limit-aware reweave (Claude Max window contention)** — A 48h forensic pass settled what was driving repeated Claude Max rate limits. The library's *automated* footprint is small: hourly/daily/retry jobs run **sequentially** and produced ~32 reweaves in 48h with **zero** rate-limit messages in their logs; digestion is Gemini (off the Claude window) — only the agentic reweave/connections step (`connections.ts`, a `claude` CLI call that explores the vault with Read/Grep/Glob) hits the shared OAuth. The saturators are **burst backfills** (the v2.1 cold-start stamped 215 items in one hour; a manual run did 49 on 06-08) and **interactive 1M-context Opus sessions** on the same OAuth — it's volume against the 5h rolling window, not a concurrency ceiling. Fixes: **(1)** Pinned the reweave model to Sonnet via `LIBRARY_CONNECTIONS_MODEL=claude-sonnet-4-6` in `.env` (was the CLI default, likely Opus) so library reweaves stop competing with interactive Opus for the same budget; the launchd jobs pick it up (`loadEnvConfig(cwd)`). **(2)** `library-backfill.ts` default concurrency **4 → 1** plus a per-run safety cap `--max-items` (default 50) that logs how many items it deferred — no single run can dump hundreds of calls into one window. **(3) One automated reweave mechanism:** the nightly `reweave-pending` job (03:35) now runs `library:reweave:nightly` = `library-reweave-pending.ts --limit 40 --include-version-behind`, a bounded sequential overnight drain. `findReweavePendingTargets` gained an **opt-in** `includeVersionBehind` (default behavior unchanged — tests pin it) so the migration backlog (`version_behind`) drains alongside `reweave_pending` and `missing_connection_pass`; `library-backfill.ts` stays for explicit manual sweeps but is no longer scheduled. `CURRENT_PIPELINE_VERSIONS` is exported from `pipeline.ts` so the backfill and the backlog metric can't drift. **(4) Observability:** the Library Health panel now shows **reweave backlog** (pending vs version-behind), **last drain** time, and **last throttle** time (a window-pressure proxy parsed from the drain log) — new `countReweaveBacklog()` + `LibraryReweaveBacklogSummary` on `LibraryOperationalHealth`, served via `/api/library/health`. The nightly worklist (6 items) provably equals the panel's backlog (6: 4 missing-connection + 1 reweave_pending + 1 version-behind). `test:library` green.

- **System Sync hardening** — Sync now probes reachable peers even when `/api/system/machine` has stale feature hints, exposes Syncthing last scan/file timestamps plus local disk/ignored-path summaries, adds `npm run test:system:sync-live` for Mercury/Xochipilli smoke checks, and documents a manual conflict drill instead of adding an automated destructive test.

- **Reference Library — semantic topical relevance wired into the L3 eval (roadmap step 6)** — Closed the long-standing gap the worth-model left open: the eval's `relevance` term now derives topical fit from **embedding cosine** (Phase-2 semantic layer) instead of token-overlap, the fix for relevance saturation and the precondition for trusting `to_archive` at scale. New module `src/lib/library/semantic-relevance.ts`: `buildSemanticContext()` loads **precomputed** centroids from `semantic.sqlite` once per eval pass — every saved-ref centroid (the items being scored) plus the active-context centroids (projects, North Star, people, recent saves), one bulk query over the chunk BLOBs grouped to item centroids in JS, with the 1,278 meeting transcripts and generic notes excluded from the SQL. `scoreArtifactSemantic()` scores the nearest active-context anchor's floored, scaled cosine (top-1 dominant, steep diminish on extras). **Both sides of the cosine are precomputed**, so the eval stays cheap-on-read (local sqlite + dot products, never a model call). **REPLACE, not blend** (`recommendations.ts`): the diagnostic (`scripts/library-semantic-headtohead.ts`) showed the old token-overlap fit sums across ~80 active-context signals UNCAPPED — mean **1.37**, 97% of saved refs ≥0.45 — so it saturated the eval's 0.3 relevance cap for ~everyone and differentiated nothing. The cosine fit (mean **0.20**, a real 0→0.45 gradient) is the signal that actually separates on-topic from off, so for embedded items it replaces token; token survives only as the fallback for non-embedded candidates. **Anisotropy calibration:** gemini-embedding-001 cosines are compressed into a high narrow band (measured: any-pair median 0.71, nearest-context median 0.81, p90 0.86), so `LIBRARY_SEMANTIC_FLOOR` is anchored at **0.78** (just above background) and the residual stretched — knobs (`FLOOR/SCALE/CAP/TOPK/TAIL_WEIGHT/RECENT_SAVES`) env-bounded, set by `scripts/library-semantic-calibrate.ts`. **Measured impact on the real vault (633 embedded saved refs):** relevance changed for **47%** of study items (all off the saturated ceiling), and `to_archive` moved **30% → 33%** — +32 qualitatively-correct flags (screen recorders, 3D-mockup tools, type foundries, a jazz school, fidget toys — saves that don't bear on the active work) while genuinely-relevant saves held via the right anchor (Apple Marketing→0.61, Bryan Johnson longevity→Health 0.45, Sequoia deck→AI Consultancy 0.48, PM-interview→Career 0.61). `to_archive` stays a non-destructive review flag; auto-archive remains dormant. **Coverage:** saved refs are embedded; **candidates** under `references/.cache` are deliberately not embedded → no centroid → `scoreArtifactSemantic` returns null → the caller keeps the token fallback. **Gating:** inert unless `HILT_SEMANTIC_ENABLED` is on, the db is built, and the `HILT_LIBRARY_SEMANTIC` kill-switch isn't `false`; any read error degrades to the token path. Self-matches (an artifact vs its own recent-save context entry) are excluded. New read-only diagnostic scripts: `library-semantic-calibrate` (cosine distribution), `library-semantic-headtohead` (token vs cosine fit), `library-semantic-delta` (before/after relevance + lifecycle). `test:library` green (110 pass / 3 skip; 6 new `semantic-relevance` tests seed a temp db with explicit vectors and assert aligned-ref fit, candidate null, self-exclusion, db-absent and kill-switch inertness).

- **Semantic backfill resilience — exponential backoff + bounded concurrency** — Hardened the cold-start against Gemini rate limits after a full-vault run hit a per-minute quota 429 at ~820/2,418 items and crashed (the weak one-retry `withRetry` re-threw, and a `| tail` pipeline masked the failure as exit 0). `gemini.ts` `withRetry` now does up to 5 retries with exponential backoff (2/4/8/16/32s, capped 60s) honoring a `Retry-After` header, so transient per-minute throttling self-heals instead of killing the run (a persistent daily-cap 429 still surfaces after the retries drain). `backfill.ts` embed + extract loops run through a `mapPool` worker pool bounded by `SEMANTIC_CONCURRENCY` (default 8, set to 4 for the resilient full run); the per-item better-sqlite3 writes stay serialized (JS single-threaded) so only network waits overlap. The backfill was already idempotent/resumable (unchanged items skip), so the resumed run picked up cleanly past the prior wall.

- **Reference Library YouTube handle resolution repair** — YouTube channel sources now resolve `@handle` URLs through the official `channels.list?forHandle=...` path when credentials are available, and the unauthenticated HTML fallback prefers the page's canonical channel link before incidental embedded channel IDs. This fixes sources like `@DwarkeshPatel` where the page references `@DwarkeshClips` in embedded metadata and the old regex latched onto the wrong uploads channel.

- **Reference Library report-only YouTube clip detector** — Added a non-mutating clip classification module plus `npm run library:youtube:clips:report`. The report batches current YouTube candidates and optional recent uploads through YouTube `videos.list`, then emits content form, confidence, policy action, and explainable signals without changing ingestion or candidate state. High-confidence proof such as dedicated Clips channels, `#shorts`, or full-episode pointers can recommend `suppress`; very short discovery uploads without stronger evidence land in `label_review`; explicit user-save sources are labeled but not suppressed.

- **Reference Library YouTube clip review filter** — Added YouTube clip policy to the existing Library Admin filters. The filter exposes `Process`, `Needs review`, `Auto-skipped`, and `Explicit save` buckets from the computed detector, includes skipped candidates for the auto-skip review lane, and renders clip evidence on Feed cards, List rows, and the detail metadata panel. This keeps human review inside Hilt before any suppression automation is enabled.

- **Reference Library YouTube metadata preflight** — YouTube source ingestion now batches `videos.list` before digestion so title, description preview, channel ID/title, publish time, duration, tags, privacy status, Shorts markers, full-episode-link evidence, and clip detector output are available before summarize/reweave. Candidate and durable reference frontmatter persist the bounded metadata plus `youtube_clip`, and the Library review filter prefers stored evidence before falling back to recomputation. Source-check ingestion reports now include metadata checked/enriched counts, policy/content-form rollups, per-artifact clip policy fields, and a compact clip-review toast count. This aligns future review/filter counts with API-enriched clip evidence without enabling automatic suppression yet.

- **Reference Library deferred reweave auto-repair** — Added a bounded `library:reweave:pending` repair job for study references/candidates that were hot-captured but left with `reweave_pending: true` after a quick source check or timeout. The new scanner skips keep-mode items, skipped candidates, and archived files, then repairs up to three pending items per run with the existing `library:reweave` path and a longer timeout. `com.hilt.library.reweave-pending` runs daily at 03:35 and appears in Library Health with its own logs.

- **Reference Library Feed scroll anchoring** — Opening or closing a Feed item now captures the active card's position inside the scroll viewport and restores that same relative offset after the split-reader layout reflows. This prevents the feed from jumping to a different apparent position when full-width horizontal cards compress into the reader column's vertical cards.

- **Reference Library eval metrics — progressive disclosure instead of priority buckets** — Removed the artificial `must_read` / `recommended` / `interesting` card labels from the Library UI/API contract. Normal Feed/List cards now show a compact worth score with the shared `Zap` metric icon, styled as neutral inline action metadata instead of a blue pill; clicking the score opens the reference and expands the metadata panel. The backend/API still computes and returns eval metrics as 0–1 decimals, but the Library UI now renders them as integer 0–100 scores (`0.87` → `87`) across cards, list rows, metadata fields, explanations, archive thresholds, and the min-worth filter label. Admin/eval review contexts expand the same action row into component metrics (`Zap` worth, `Network` relevance, `Layers` substance, `Clock` freshness) and show `Archive?` only for the non-destructive `to_archive` lifecycle. Candidate and Updated review controls now use icon + text + chevron dropdown treatment instead of generic buttons; candidate detail actions are consolidated into the top metadata line with a subtle amber pending-review control, and the lower detail action row no longer repeats `Candidate`. The detail version/score metadata toggle no longer renders a visible caret. Feed card tags now sit below the description as quiet body metadata at every width, leaving the source/date row as provenance-only. Cards no longer render raw For You/eval explanation prose; the single-post detail metadata panel owns that explanation and labels it explicitly. `/api/library` now attaches dynamic `eval_attrs` to normal study list items, `/api/library/review` does the same for Updated-lane entries, and `RecommendedArtifact` carries numeric eval fields plus `eval_attrs` rather than priority buckets. The detail metadata panel now uses the same icons with text labels, shows freshness, and makes the archive-review threshold visible.

- **Reference Library — worth-model eval + substance grading (eval plan, steps 3–5)** — Replaced the connection-count tier eval with the two-dimension **worth** model and made `library-eval.ts` compute `worth = relevance × substance × freshness_decay` for study items. **Relevance** = diminishing-returns over first-party connections + a light topical-fit, re-weighted on read; **substance** = how much worthwhile material the source carries (0–1); **freshness** = a gentle decay multiplier (floors at 0.6), not a standalone score. `evaluateArtifact` returns `{ worth, relevance, substance, freshness, lifecycle, why }`; it never assigns `archive` — it only suggests **`to_archive`** (a non-destructive review flag) for genuinely low-worth items it has actually analyzed (the `analyzed`/`reconnected_at` guard carries over). `recommendations.ts` ranks For You by worth, excludes `keep`, and now exposes **`evaluateLibrary(vaultPath)`** (the per-item scorer powering For You, the inspection report, and the forthcoming workbench). `types.ts` gains `LibraryLifecycle = active | to_archive | archived` (replacing the old `LibraryTier`); `RecommendedArtifact` carries `worth`/`relevance`/`substance`/`lifecycle`. **Substance grading** (`scripts/library-grade-substance.ts`): a cheap **Gemini `summarize`** pass over the existing digests (NOT a Claude reweave), version-stamped `substance_version: s1`, with a **granularity gate** (`--sample N` prints the distribution; refuse to ship a saturated backfill). Validated on a 24-item sample — mean 0.38, well-spread, 0% saturation, qualitatively correct (empty template 0.05, dense management curriculum 0.75) — then backfilled the library; `structuralSubstance()` (format/length/duration/findings) is the fallback when a grade is absent. **Manual archive** (`archiveLibraryArtifact`) now stamps `archived_by: user` (sticky; the eval never sets it — auto-archive, when it ships, writes `archived_by: system`). Calibration notes recorded for the morning: the structural substance proxy saturated at 1.0 (why the Gemini grade matters), and `to_archive` flags ~53% on connection-only worth — confirming the flag (like auto-archive) should stay dormant until the topical-relevance (semantic) axis lands, so it isn't surfaced/acted-on yet. `scripts/library-eval-report.ts` writes a read-only inspection snapshot (disposition, distributions, top-worth, the `to_archive` pile) to `projects/hilt/library-eval-report.md`. **Eval workbench (step 2) — integrated, not a separate surface.** Two parts: **(a) per-item metadata in the detail pane** — the top-right pill now reads `version · worth ▾` and toggles a collapsible panel (sticky across item switches via localStorage) showing worth/relevance/substance/lifecycle, disposition, connection state (has/abstained/never), digest method, version, substance-graded, reweave-pending, and the why-breakdown; the detail route (`/api/library/[id]`) attaches computed `eval_attrs` (`evalAttrsForArtifact`). **(b) feed filters** — `GET /api/library` gained pipeline filters in `filterArtifacts` (`pipeline_version`, `digested_with`, `connection_state`, `substance_graded`, `reweave_pending`) plus an eval-filter path (`lifecycle`, `worth_min`/`worth_max`) that scores the source/pipeline-filtered set via the new exported `scoreArtifacts` and paginates — so filters narrow the actual feed, not a parallel table. All verified live (e.g. `connection_state=never` → 5, `worth_min=0.5` → 131, `lifecycle=to_archive` → 266, `digested_with=source-metadata` → 376). `GET /api/library/workbench` + `src/lib/library/workbench.ts` remain as the facet-count source for the sidebar controls. `test:library` 85 pass, tsc + eslint clean. **Remaining:** wire those filter params into the `SourceNav` sidebar UI (filter chips + a worth slider — the design-sensitive layer, deferred for the user's eye); and topical relevance (step 6, semantic layer) — the fix for relevance saturation and the precondition for trusting `to_archive` at scale.

- **Reference Library — disposition (study/keep) now actually fires (eval plan, step 1)** — Until now `library_mode` was `study` for all ~820 items; `keep` never triggered, so products/clothing/talent/art sat in the study feed. **Root cause (precedence bug in `taxonomy.ts`):** `explicitMode = modeFromMetadata(item) || sourceDefaultMode(source)` was evaluated *before* `looksLikeKeep`, so a source's blanket default (`raindrop-bookmarks` = `study`) short-circuited per-item keep classification entirely — a Talent-collection item got `source_collection: Talent` but `library_mode: study`. Fixed the precedence to **explicit per-item mode → per-item content keep → source default → study**, so a clear keep signal (a Talent/Art collection) beats a source's study default. Also: added `KEEP_COLLECTION_TERMS` (talent/art/portfolio/aesthetic/design/…) matched only against curated collection/tag/folder labels, and **removed title-word keep matching** (it silently pulled "Tiny Desk Concert" out of the feed on the furniture word "desk" — keep is now driven only by curated labels + shopping hosts). `scripts/library-repair-source-taxonomy.ts` no longer echoes the already-stamped `library_mode` back in as an explicit mode (which made stale values sticky and blocked re-classification) and re-derives fresh each pass. Applied via the live Raindrop repair: **23 items reclassified to `keep`** (clothing, talent, art, furniture) and correctly hidden from the default feed (`listLibraryArtifactDetails` already excludes keep). 1–2 edge cases remain (an essay the user filed in a "Clothing" collection) for the planned human-review loop. Regression test locks the precedence + no-title-matching behavior. `test:library` 84 pass, tsc clean.

- **Reference Library — L3 structural eval + unified tier model (Phase A)** — Replaced the token-overlap "For You" scorer with a structural relevance eval and collapsed the mode-vs-verdict duality into one field. **The model:** every reference has a single `tier ∈ {study, keep, archive}` (`LibraryTier` in `types.ts`) that is *both* the relevance verdict and (when set provisionally at ingest) the processing decision — `study` = surface/full card, `keep` = reference/compact, `archive` = set aside. `tier` is set coarsely at ingest (the cheap `taxonomy` heuristic, drives reweave-vs-L1) and **refined live** by the eval; "was it reweaved?" becomes derived plumbing (does it have connections?). **The eval** (`src/lib/library/library-eval.ts` `evaluateArtifact()`): deliberately cheap — no model call. It rides the already-LLM-judged woven connections (first-party ties to your own `projects`/`areas`/`thoughts`/`people`/`writing` + library strategy/project notes dominate, classified by connection **target path** since `connection_suggestions` is stored flattened; library cross-refs count lightly) plus a weak token-overlap fit to active context + a recency nudge → `{ tier, relevance, why }`. It's **dynamic** (recomputed each call against current active context, never stamped). Thresholds (diminishing-returns on ties so heavily-connected items don't all pin at the ceiling): study ≥ 0.30 **and** ≥1 first-party tie; keep ≥ 0.13 **or** `library_mode: keep`; else archive. **Saved-floor (false-archive guard):** a deliberately-saved/promoted ref, or any `reweave_pending` (un-analyzed) item, **never auto-archives** — it floors at `keep`. Auto-archive is only for the un-vetted discovery firehose (candidates) and your own manual dismissals; absence of woven ties on something you chose to save means "not yet analyzed / no *current* tie", not "junk". **Analyzed-guard:** archiving also requires POSITIVE evidence the connection judge actually ran (`analyzed` — backed by `reconnected_at`, which the rejudge pass stamps on every item regardless of outcome, or by ties already existing); a zero-tie item with no evidence of analysis floors to `keep`, never archive — so a *process gap* can never read as *irrelevant*. (Audited on the real vault: all 68 archive-tier items carry `reconnected_at`, i.e. were genuinely judged-and-abstained; `connection_reasoning` is NOT a usable "was-judged" marker — it's only written on success. Final mix: 465 study / 290 keep / 68 archive, all archive candidate-only.) **Durable follow-up (deferred to avoid editing `digestion.ts` mid-backfill):** the pipeline should stamp a positive "connections judged at" marker on *every* connection pass including fresh abstentions, so the eval never has to lean on the rejudge-only `reconnected_at`. **For You** (`recommendations.ts`) now ranks by the eval's `relevance`, surfaces the eval's legible `why`, maps `tier`→`priority` (study→must_read/recommended by score, keep→interesting), and **excludes `archive`-tier** items (irrelevant filler is buried, not padded into the feed). `RecommendedArtifact` gained `tier`. The roadmap for Phases B–D (tier rendering in the feed, the three-dot view preference replacing the mode toggle, bidirectional self-healing `.archive/` reconciliation, full ingest unification) is in `docs/plans/reference-library-roadmap.md`. `npm run test:library` green (83 pass / 3 skip; added a direct `library-eval` tier-boundary test + updated the For-You test to assert eval semantics), tsc clean.

- **Reference Library v2.1 "onion" — one shared voice core for both digest layers** — Folded the Library's two digestion paths onto a single voice spec so candidates and saved items finally read the same. Previously only the in-vault L2 reweave carried the good "v2" voice; discovery candidates got a cheap single-shot `summarize --prompt DIGEST_PROMPT` rendered with a rigid `## Summary / ## Key Points / ## Assessment / ## Suggested Connections` template, so they still looked like "v1". **The shared core:** `src/lib/library/capture-voice.ts` exports `CAPTURE_VOICE` (the voice / density / intent spec) and `DIGEST_PROMPT` (= `CAPTURE_VOICE` + "output the body, no connections"). `pipeline.ts` **retired its inline rigid `DIGEST_PROMPT`** (the "2-4 sentence summary + literal `Key takeaways:` + 3-6 bullets" template) and now re-exports `DIGEST_PROMPT` from `capture-voice.ts`; the numbered/listed-findings preservation nuance was folded into `CAPTURE_VOICE` itself so it survived the retirement. `REWEAVE_PROMPT` (L2) now **embeds `CAPTURE_VOICE`** for its digest guidance — keeping its vault intro, its disciplined CONNECTIONS section, the "do NOT write Connections/Raw/Media" note, and the exact JSON contract `parseReweaveOutput` expects — so the voice is no longer duplicated across the two prompts. `PIPELINE_VERSION` stays `"v2.1"`. **Candidates can now be reweaved:** with `LIBRARY_CANDIDATE_REWEAVE=1` (default OFF), `digestArtifact` routes discovery candidates down the SAME single `reweaveArtifact` call saved items use — a free-form `digest_markdown` plus first-party / library connections — with no extra LLM pass; on reweave-null it degrades to the L1 free-form `DIGEST_PROMPT` body, never the old summary/key-points template. **Candidate render mirrors the durable form:** `buildCandidateMarkdown` now renders the free-form `digest_markdown` (or a legacy Summary/Key Points fallback) + an omit-when-empty `## Connections` section, dropping the rigid Summary/Key Points/Assessment/Suggested-Connections scaffold; Media + Raw Content are kept verbatim, and score / recommendation / `description` live in frontmatter (the `description` is now persisted so a free-form body round-trips to a non-empty feed summary via `parseCandidateFile`). **Backfill orchestrator fixes:** `scripts/library-backfill.ts` `TARGET_VERSION` now tracks the live `PIPELINE_VERSION` (it was hardcoded `"v2"`, so every fresh `v2.1` reweave was scored a failure and requeued 3x — phantom failures + quota waste), and gained `--include-candidates` to sweep `references/.cache/library-candidates/` (which also picks up the ~5 unstamped saved refs that never reached the saved backfill); `scripts/library-reweave.ts` now accepts `type: reference-candidate` files and re-stamps them. Documented in `docs/PIPELINE-VERSIONS.md` (v2.1 = the onion). `npm run test:library` green (82 pass / 3 pre-existing skips), tsc + eslint clean.

- **Briefing failure status + manual retry queue** — The Briefing tab now treats a same-day Hermes cron failure as today's briefing instead of silently falling back to yesterday's markdown. `GET /api/bridge/briefings` synthesizes a `status: "failed"` row for today's ET date when `briefings/YYYY-MM-DD.md` is missing and Hermes `~/.hermes/cron/jobs.json` reports the Morning Briefing job failed that day; `GET /api/bridge/briefings/[date]` returns the same failure payload rather than 404. The UI renders a compact amber failure card with the readable Hermes error, run time, next scheduled run, and a Retry action. `POST /api/bridge/briefings/retry` queues the existing Hermes cron job via `hermes cron run --accept-hooks <job-id>` instead of running a separate Hilt generator. Added `src/lib/bridge/briefing-status.ts` plus focused coverage for ET date handling and Hermes failure parsing.

- **Briefing automatic recovery watcher** — Installed a no-agent Hermes cron watchdog for the Morning Briefing. The watcher runs every 30 minutes, exits silently once today's briefing file exists, and only re-queues the canonical Morning Briefing job when today's file is still missing between 6:30 a.m. and 5:00 p.m. ET. The 6:30 start avoids duplicate queues while the normal 6:00 generation may still be running. This fills the reliability gap after the Hilt failure card/manual retry work: Hilt can show and manually queue failures, while Hermes now owns repeated same-day recovery attempts without creating a second briefing generator. Hilt's failure payload now also exposes `autoRetryNextRunAt` separately from the daily job `nextRunAt`, and excludes the retry watcher itself from failed-briefing detection.

- **Semantic Knowledge Layer — Phase 2 spec + foundation (flag-gated, in progress)** — Authored a build-ready spec for the continuous semantic/topic-analysis layer (the "vector analysis" phase that follows the explicit-link graph hitting its ceiling). Rationale/decisions in `docs/plans/semantic-layer-phase2-plan.md`; the full per-subsystem design + phased P2.0→P2.4 task breakdown (8 subsystems, verification-first, reconciled across 10 cross-section conflicts) in `docs/plans/semantic-layer-phase2-spec.md`. Locked decisions: Gemini API (Embedding 001 + Flash, stronger model for the global taxonomy pass), CLI/query backbone first then graph integration, balanced warm-started topic re-fit with lineage, all four entity buckets, scope = main vault + saved Library references, text-only v1, data-driven hierarchical topics, first query = topic exploration. **P2.0 foundation landed (offline, no API key):** new derived cache `DATA_DIR/semantic.sqlite` (`src/lib/semantic/{config,pipeline,db}.ts`) following the graph/calendar derived-cache conventions — WAL + `foreign_keys=ON`, singleton, version-stamped rows (`SEMANTIC_VERSION` mirroring the Library `PIPELINE_VERSION` scheme), the full schema (`semantic_items` keyed on the graph node id, `chunks` with canonical LE-float32 `embedding_blob`, `entities`/`entity_aliases`, hierarchical `topics`, `item_entities`/`item_topics`, `topic_lineage`), and `sqlite-vec` `vec0` KNN tables that are created **only** when the optional extension loads (shipped vec-OFF/BLOB-first per risk #1 — correctness never depends on the native extension). Added the **vector substrate** (`vector.ts`: LE-float32 BLOB encode/decode, `l2normalize`, `cosineSimilarity`, in-process `knnCosine`) and the **injectable model-client seam** (`gemini.ts`: one `SemanticLlmClient` interface — `embed`/`extractEntities`/`labelTopics` — with a real fetch-based Gemini client that resolves the key from `GEMINI_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` → `GOOGLE_API_KEY` → **`~/.summarize/config.json` `env` block** (the same store the library's `summarize` path already uses, so it works with the existing key — no setup), batches `batchEmbedContents`, L2-normalizes + Matryoshka-truncates, and **refuses live calls under test**; `test-helpers.ts` provides a deterministic hash-seeded fake so the pipeline tests offline). Added `chunking.ts` (reuses the graph's `scanVault`/id-helpers + `library/markdown` — vault files → items + text-only embedding chunks, `item_id` = graph node id, scope-correct, `libraries/`/`.cache/` excluded, sentence-boundary splitting that reconstructs), `query.ts` (the single read surface: topic exploration `listTopics`/`recentTopics`/`getTopic`, `relatedToItem` chunk-KNN rolled up to items by max-score, `entityByName`, `status`), and the **`semantic` CLI** (`scripts/semantic.ts`: `status`/`topics`/`topic`/`related`/`entity`/`item`, `--json`, not-built guard). **Live embed smoke confirmed** end-to-end (the key resolves from `~/.summarize/config.json`; a real `batchEmbedContents` call returns 1536-dim L2-normalized vectors). Added the **cold-start backfill** (`backfill.ts` `runColdStart` — scan → chunk → embed via the injected client → upsert, idempotent/resumable on `content_hash` so a re-run is a no-op; `scripts/semantic-backfill.ts` CLI with `--limit`) and an offline **e2e** (`scripts/semantic-e2e.ts` / `test:semantic:e2e` — fixture vault + fake client, asserts coverage + reproducible chunk row-sets across two data dirs). `npm run test:semantic` **24/24** + `test:semantic:e2e` green offline; flag-gated by `HILT_SEMANTIC_ENABLED` (fully inert when unset). **P2.0 complete + validated on real data:** a live cold-start over an 80-item vault slice (127 chunks, 19.7s) produced sensible `related` output with zero wikilinks — e.g. for `project:nightly-health-check` the top hit (0.922) was its own "Vault Health Script — Scope & Design" doc, then the automation/infra projects — the serendipitous connections the explicit-link graph couldn't surface. Next: P2.1 entity extraction + resolution, then P2.2 emergent topic clustering (lights up `semantic topics`).

- **Semantic Knowledge Layer — P2.1 entity extraction & resolution (flag-gated, offline-tested)** — Per-item typed entity extraction + dedupe/resolution + reconciliation to the existing graph nodes, wired into the cold-start backfill so `npm run semantic entity "<name>"` returns a dossier and `entities`/`item_entities` populate. **Extraction** (`extraction-prompt.ts` + `extract.ts`): the practitioner-voice `EXTRACTION_PROMPT` names the four buckets (person/project/concept/source) and an abstention-positive empty answer; `parseExtractionOutput()` **reuses** the proven tolerant-parse helpers from `library/connection-prompt.ts` (now exported: `stripCodeFences`/`extractFirstJsonObject`/`tryParse`), folds `concept`→the established `idea` bucket, maps salience labels→0..1, and **drops** any malformed/ungrounded/unknown-type entity (never throws — a wholly-unparseable response abstains to `[]`). `extractEntities(item, {client})` is idempotent on `(item_id, content_hash, SEMANTIC_VERSION)` (a re-run over an unchanged item is 0 client calls; a content edit or version bump re-extracts only that item) and writes `item_entity_mentions`. The real `SemanticLlmClient.extractEntities()` (`gemini.ts`) is now implemented: a Gemini Flash `generateContent` call (`SEMANTIC_EXTRACT_MODEL` || `gemini-flash-latest`) with provider-enforced `responseMimeType`/`responseSchema`, fail-soft (HTTP/parse error or `SEMANTIC_DISABLED` ⇒ `[]`), still hard-blocked under test. **Resolution** (`resolve.ts` + `resolve-prompt.ts`): two-stage cheap-filter-then-LLM — Stage 1 blocking unions exact normalized-name/alias hits, embedding-ANN (cosine over the name+context vector, `SEMANTIC_BLOCK_SIM` 0.82 / `SEMANTIC_AUTO_MERGE_SIM` 0.95), and a normalized edit-distance fallback into connected components via union-find; Stage 2 a batched Flash merge-judge (`MERGE_PROMPT`, injectable `MergeJudge` seam so tests stay offline) only on the ambiguous band, **fail-soft = no merge** (an abstaining/unparseable verdict keeps every member its own entity). Canonical ids are `hashId(type|norm_name)` at creation, stable across re-fits and rename (rename = alias add); same inputs → same canonical set (delete+rebuild reproducible). **Reconciliation** (`reconcile.ts`): person/project entities **adopt** the existing `person:<slug>`/`project:<slug>` graph node id (matched by slug/label/alias from a read-only `graph.sqlite` handle) so the layer never shadows the graph's roster; idea/source (and name-only person/project with no node) mint fresh; **no-ops gracefully when `graph.sqlite` doesn't exist** (risk #2 — opens its own `fileMustExist` read-only handle rather than creating the file via `getGraphDb()`). Wired extract→resolve→reconcile into `runColdStart` (new `scripts/semantic-resolve.ts` for a standalone global pass; `semantic:resolve` npm script) and extended the offline e2e to assert all four entity types + idea co-occurrence across items. New `semantic.sqlite` tables `item_entity_mentions` + `entity_merges` (audit/rebuild source + reversible-merge log). `npm run test:semantic` **47/47** (incl. `extraction-prompt`/`extract`/`entity-resolution`/`reconcile`) + `test:semantic:e2e` green **offline**; **real Flash spot-check** confirmed the live structured-output path returns all four buckets with alias capture. Next: P2.2 emergent topic clustering.

- **Semantic Knowledge Layer — P2.2 emergent topics (clustering, labeling, hierarchy, lineage; flag-gated, offline-tested)** — The topic layer lights up `npm run semantic topics` / `topics --parent <id>` / `topic <id>`: a global re-fit clusters the embedded chunks into an LLM-labeled, **hierarchical** topic taxonomy, plus pure-TS incremental assignment and a **balanced warm-started re-fit with lineage**. **Clustering sidecar** (`scripts/semantic-cluster.py`): a PEP-723 `uv` script (UMAP → HDBSCAN with `cluster_selection_method="leaf"` for the condensed-tree hierarchy, then agglomerative parent themes for a genuine ≥2-level tree), reads `{vectors, ids, params, warm_start}` on stdin, emits `{assignments, hierarchy, outliers, params_used}`, seeded `random_state` for determinism. Modeled on `scripts/youtube-transcript.py`; never opens SQLite (the TS side owns the db). **Wrapper + seam** (`cluster.ts`, ruling R6): an `execFile` wrapper (`runClusteringSidecar`) around the sidecar with a tolerant `parseClusterOutput` (an `{error}` envelope / malformed body ⇒ abstain `null`; a zero-cluster body is a valid empty result) and an **injectable `RunClustering`** type so tests pass a fake cluster fn (no Python in CI); a missing `uv` (ENOENT) **warns once and abstains** (the re-fit degrades to incremental-only, never crashes), mirroring the missing-`summarize` path. **Labeling** (`topic-label-prompt.ts` + `gemini.ts` `labelTopics()`, ruling R7): `TOPIC_LABEL_PROMPT` + `parseTopicLabels` (reuse the connection-prompt tolerant-parse helpers; unjustified merges dropped via `parseTopicMerges`); `labelTopics()` dispatches to the **Claude CLI** when `SEMANTIC_TAXONOMY_MODEL` starts with `claude:` (reusing the now-exported `runClaude`/`extractModelText`/`resolveClaudeBin` from `library/connections.ts`) else POSTs Gemini Pro — one interface, one seam, fail-soft (`[]` on any failure), hard-blocked under test. **Incremental assignment** (`assign.ts`): pure-TS nearest-leaf-topic cosine (top-k above `SEMANTIC_ASSIGN_COS`); below-floor ⇒ outlier; **never creates a topic** (max-rollup across an item's chunks). **Lineage** (`lineage.ts`): split/merge/carry/birth/death detection from a membership diff (pure set math over a bipartite overlap-link graph, leaf-level), deterministic. **Orchestrator** (`topics.ts`): gather chunk embeddings → `runClustering` → **warm-start** id inheritance (a new cluster whose centroid matches a prior topic's within `SEMANTIC_LINEAGE_COS` adopts that id; ids are otherwise minted from the sorted member-item set, so a stable topic naturally carries its id) → `labelTopics` → persist `topics`/`item_topics` (refit-assigned, with centroids) → `diffLineage` into `topic_lineage`; abstains gracefully (taxonomy unchanged) when clustering returns `null` or the corpus is empty. New `db.ts` topic writers/readers (`upsertTopic`/`upsertItemTopic`/`insertLineage`/`getTopicCentroids`/`getLeafTopicCentroids`/`recomputeTopicItemCounts`/...); `query.ts` `getTopic()` now returns a `lineage` drill-down; the `semantic topic <id>` CLI prints it. Wired the re-fit into `runColdStart` (injectable `runClustering`, default the real sidecar) and added `scripts/semantic-refit.ts` (`semantic:refit`) — the launchd-shaped, **signal-gated** standalone re-fit (`SEMANTIC_REFIT_MIN_NEW` unassigned-item gate; `--force` to override). Extended the offline e2e to assert a ≥2-level hierarchy, a `topic <id>` lineage drill-down, and a warm-started **split** re-fit producing split lineage. `npm run test:semantic` **85/85** (adds `cluster`/`topic-label-prompt`/`assign`/`topic-lineage`/`topics`) + `test:semantic:e2e` green **offline**; **validated against the real stack via scripts**: the `uv` sidecar produced a deterministic 2-level UMAP+HDBSCAN hierarchy, and a live Gemini Pro labeling call returned specific practitioner-voice labels ("Autonomous agent architecture", "Structured hiring loops"). Added the `SEMANTIC_*` topic config block to `.env.example`. Next: P2.3 graph integration (topic/entity nodes + semantic edges).

- **Semantic Knowledge Layer — P2.3 graph integration (topic/entity nodes + semantic edges in System → Graph; flag-gated, offline-tested)** — The serendipitous through-lines that wikilinks + manual connections structurally can't produce finally render in the graph. Layers `topic` + `entity` nodes and five semantic edge kinds (`item_topic`, `topic_parent`, `item_entity`, `co_occurrence`, `similar`) onto the **existing** `graph_nodes`/`graph_edges` tables — the tag-layer pattern applied to an externally-derived source, **not** a parallel table — so the durable read/encode/transport path is untouched. **Types** (`graph/types.ts`): appended the two node types + five edge kinds (append-only) and `topicNodeCount`/`entityNodeCount`/`semanticBuilt` to `GraphMeta`; `encode.ts` `NODE_TYPE_ORDER` gained `topic`(8)/`entity`(9) at the **end only** — back-compatible under the existing `TRANSPORT_FORMAT_VERSION` (no bump). `build.ts` added `topicNodeId`/`entityNodeId` and **exported** the previously-private `nodeIdForResolvedPath` (ruling R9). **Producer** (`graph/semantic-overlay.ts`, modeled on `buildTagLayer`/`removeTagLayer`): `buildSemanticOverlay()` reads `semantic.sqlite` **only through new `query.ts` bulk variants** (ruling R3 — `listAllTopics`/`listAllItemTopics`/`listAllEntities`/`listAllItemEntities`/`listEntityCoOccurrences`/`listAllItemSimilarities`/`listAllLineage`/`listAllItems`/`semanticWatermark`; never hand-rolled SELECTs), pre-filters **every** edge endpoint against the live `graph_nodes` id set so it never mints a dangling-by-construction edge (e.g. a `libraries/` ref the graph excludes), caps each item to its top-K topics/entities above score/salience floors, derives entity↔entity `co_occurrence` (shared-item self-join) and item↔item `similar` (chunk-grain KNN rolled up by max cosine) itself, copies a re-fit topic's persisted position from its `topic_lineage` ancestor (lineage-aware warm-start), and upserts in **one transaction** ending with `recomputeDegrees` + `semantic_built`/watermark markers. `removeSemanticOverlay()` strips every overlay node/edge and clears the marker — **fully reversible** (identical lifecycle to `removeTagLayer`). **Config** (`graph/config.ts`): `graphSemanticOverlayEnabled()` (`HILT_GRAPH_SEMANTIC`, off by default) + bounded `SEMANTIC_GRAPH_*` thresholds (topic min-score 0.5 / top-K 3, entity min-salience 0.3 / top-K 5, co-occur min-items 2, similarity-min 0.78 / top-M 5). **Route + selection** (`graph/route.ts` + `db.ts`): `selectGlobalGraph`/`getAllEdges`/`inducedEdges` gained an `excludeKinds` option; with the flag off all overlay rows are excluded everywhere (defends a stale `semantic_built=1` like `type != 'tag'`), with it on the dense fuzzy web (`similar`/`co_occurrence`) is off in GLOBAL scope unless `&semanticEdges=1` (sparse topic/entity hubs + `item_topic`/`topic_parent` always included) and always on in LOCAL scope (ring/fan-out caps bound it); `/meta` reports the new counts + `semanticBuilt`. **Styling** (`graph-style.ts` + `GraphToolbar.tsx` + `graph-labels.ts`): `topic`→fuchsia / `entity`→cyan from the Tailwind map, a topic size floor (ordinal 8, like the north-star floor), and legend rows for the new node/edge kinds **gated on the flag** (`HILT_GRAPH_SEMANTIC` added to the `next.config.ts` client env passthrough alongside the now-also-passed `HILT_GRAPH_TAGS`). **Lifecycle wiring**: `buildFullGraph`'s tail calls `buildSemanticOverlay()` (flag-gated, **lazily required** so the semantic layer never loads on the flag-off path or in the default bundle, mirroring `tryLoadVec`); the GraphRunner `reconcile()` backstop refreshes the overlay **only when the semantic watermark advanced** (`refreshSemanticOverlayIfStale` — eventual, like candidates), seeding the touched topic/entity node ids dirty + a relax. **HTTP routes** (`/api/system/semantic/{topics,topic/[id],related,entity/[name]}`): thin `query.ts` wrappers with an `isSemanticEnabled()` 404 guard, JSON matching the CLI `--json` shape. Added `src/lib/graph/semantic-overlay.test.ts` (5 cases: edge families + dangling pre-filter, full reversibility, empty-db no-op, watermark skip, lineage warm-start) and **extended** `scripts/graph-e2e.ts` (not forked) to seed `semantic.sqlite` offline over the same fixture vault and assert topic/entity nodes + `item_topic`/`topic_parent` edges in `/api/system/graph?fmt=json`, the default-off then `semanticEdges=1`-on fuzzy web, and the new HTTP routes. `npm run test:graph` **67/67** + `test:semantic` 85/85 + `test:semantic:e2e` green offline; `test:graph:e2e` green (isolated build). Fully inert with `HILT_GRAPH_SEMANTIC` unset.

- **Semantic Knowledge Layer — P2.4 versioned re-analysis + live runner + scheduling (flag-gated, offline-tested)** — The layer now runs automatically in the daily app (behind `HILT_SEMANTIC_ENABLED`) and a model/prompt upgrade is a **backfill, not a migration**. **Versioning** (`pipeline.ts`): added `SEMANTIC_DB_FORMAT_VERSION` — orthogonal to `SEMANTIC_VERSION` exactly as graph's `LAYOUT_VERSION` is orthogonal to `TRANSPORT_FORMAT_VERSION` — so a schema/wire change invalidates the cache file independently of a model upgrade (`getSemanticDb()` drops every derived table + re-stamps when the on-disk `db_format_version` lags; the cache is pure-derived so discarding it is always safe), plus `parseSemanticVersion`/`isPublishedVersion` helpers for the integer(published)/decimal(test-lane) scheme. **Active-version meta** (`db.ts`): `active_version` (+ `active_embedding`/`active_extraction`/`active_taxonomy`/`blessed_at`) is the "of record" baseline queries default to (`getActiveVersion`/`setActiveVersion`); `listDerivedVersions`/`countRowsAtVersion` inspect the coexistence window; `query.status()` now surfaces `activeVersion` + `versions`. **Backfill coexistence + GC** (`backfill.ts` `blessActive` option + `scripts/semantic-backfill.ts` mode dispatcher `cold-start|sample|gc`): a true cold-start blesses its version as the baseline, but a re-analysis pass writes **new-version rows alongside the prior baseline without deleting it** (the sample/decimal lane), and `gcStaleVersions()` (the `semantic:gc` job, analog of `library:candidates:cleanup`) drops `version != active_version` **only after** a bless flip — with explicit `vec0` cleanup since FK cascade can't reach virtual tables. **Review-queue reuse** (`library/review-queue.ts`, ruling R10): parameterized the internal store dir into `reviewQueueDir(kind)` + added `semanticReviewQueueDir()` and an optional `kind` on every public function (defaults to `library` so existing callers are byte-unchanged); the `sample` mode carries the version's `docs/semantic-review-notes/<version>.md` note into the **sibling** `DATA_DIR/semantic-review-queue` so the two queues never collide. **SemanticRunner** (`runner.ts`, structurally a copy of `GraphRunner`): a singleton instantiated **only** by `ws-server.ts` and **only** when `isSemanticEnabled()` (dynamic `import()` so the flag-off path never loads it), keeping a `source_file → content_hash` map; on a change it (re)chunks + embeds the item (**exactly one embed call per changed item**), extracts + resolves its entities against the existing canonical set, and slots it into the nearest **existing** leaf topics by cosine — **never re-clustering** (topic creation is the weekly re-fit's job). Debounce (`SEMANTIC_INCREMENTAL_DEBOUNCE_MS`, default 2000ms) + single-flight + queued-rerun coalesce an edit burst into one pass; a 5-min content-hash reconcile self-heals missed events; the scope guard excludes `libraries/` + dotdirs (`.cache` candidates). `ws-server.ts` boots **fully inert** with the flag off (no db opened, no watchers wired — verified). **Scheduling** (`semantic/scheduler-jobs.ts` + `scripts/semantic-scheduler.ts`): the `com.hilt.semantic.*` family — `cold-start` (RunAtLoad once), `refit` (BALANCED **weekly** Sun 03:30, `SEMANTIC_REFIT_WEEKDAY`-tunable via a `Weekday` calendar-interval key), `gc` (daily 04:30) — with the plist/launchctl install/uninstall/plan logic **extracted into the shared `scripts/launchd-scheduler.ts` helper** that the Library scheduler now also calls (R10; added `runAtLoad`/`weekday` to the shared `SchedulerJobSchedule`). Install/uninstall dry-run by default; the scheduled scripts short-circuit when the flag is off so a stray plist is a no-op. New npm scripts: `semantic:backfill:cold`, `semantic:gc`, `semantic:scheduler:{plan,install,uninstall}`. Added `version.test.ts` (parse/format-version invalidation/coexistence/bless→gc), `review-queue.test.ts` (sibling store + no library collision), `runner.test.ts` (one-embed incremental, unchanged-no-op, removal cleanup, burst coalesce, `libraries/`+dotdir scope guard, flag-off inertness). `npm run test:semantic` **100/100** + `test:semantic:e2e` green **offline**; `semantic:scheduler:plan` lists the three jobs. Docs: new `docs/SEMANTIC-VERSIONS.md` (the non-executable version history, `PIPELINE-VERSIONS.md`-shaped) + `docs/semantic-review-notes/`. Phase 2 (P2.0→P2.4) complete and flag-gated; the layer is ready to enable on the daily app.

- **Reference Library wikilink routing** — Library summary/cache rendering now turns Obsidian wikilinks into real clickable links. A server-side resolver checks the bridge vault and routes resolved references back into the Library reader, people notes into People, and all other markdown into Docs instead of leaving link-colored text inert.

- **Reference Library grouped source rail** — The Library filter rail now groups noisy source families instead of listing every feed flat. YouTube sources collapse under a `YouTube` parent with Bookmarks, Watch Later, liked videos, and channel sources beneath it. Superhuman email ingestion is presented as `Newsletters`, with individual sender facets such as `AI News`, `Lenny`, and `SemiAnalysis` normalized from raw sender metadata. The `Mode` control moved to the bottom and is now a simple `Study` / `Keep` switch; lifecycle `All` remains under `Status`.
- **Reference Library source taxonomy + Study/Keep mode** — Source-native taxonomy is now preserved separately from semantic tags. Raindrop bookmark tags and collection names are written/read as `source_tags` / `source_collection`, X bookmark folders can flow through `source_folder`, and the Library rail exposes those as child facets under the selected source. System labels such as `bookmark`, `raindrop`, `twitter`, and `youtube` are filtered out of card chips. Added `library_mode: study | keep`: Study is the default review/weaving surface, while Keep is a quiet durable archive for products, shopping, recipes, furniture, clothing, restaurants, and similar saved-for-later material. Keep items remain durable/searchable but are hidden from the default Library feed and do not trigger the Library unread dot. Added `npm run library:repair-taxonomy` to backfill existing Raindrop/X references and candidates from live source metadata where available.
- **Reference Library video duration badge** — Video cards now show total duration. Capture is via the locally-installed `yt-dlp` (no API key — none is configured), wrapped in a server-only `src/lib/library/video-duration.ts` (`getVideoDurationSeconds(url)` + `isLikelyVideoUrl()`), and stored as `video_duration_seconds` in reference/candidate frontmatter (threaded through `ProcessedArtifact` → `buildDurableReferenceMarkdown`/`buildCandidateMarkdown`, parsed back onto `LibraryArtifact`). `digestArtifact` fetches it for any `format: video` or video-host URL during ingestion; `scripts/library-video-durations.ts` backfills existing notes (dry-run by default, `--write`, idempotent, `--force`/`--limit`/`--sleep`). The badge renders as a black pill on the thumbnail — bottom-right of the feed card and the list-row thumbnail — formatted `m:ss`/`h:mm:ss` via a pure `formatVideoDuration` helper in `media.ts` (renders nothing when duration is unknown).
- **Reference Library generation-note card + integer/decimal versioning re-base** — The **Updated** lane now renders a collapsible **generation note** at the top of the feed (`src/components/library/GenerationNoteCard.tsx`): an amber-accented card showing the version, the generation's title, the pending count, and a brief "what to review / why" body (rendered via `LibraryMarkdown`). Expanded, it sits in normal flow (a tall pinned card overlapped the feed in a narrow column); collapsed, the one-line header pins to the top of the feed (solid, above the cards). It renders in **both Feed and List views** (above the list as a non-scrolling header). It remembers collapse state per batch in `localStorage`, so a *fresh* generation always appears expanded. Notes are authored as `docs/review-notes/<version>.md` (a `# Title` heading + bulleted body) and carried into the review queue at batch-creation: `scripts/library-reweave.ts` gained `--review-note <path>` (defaulting to `docs/review-notes/<PIPELINE_VERSION>.md`), and `addToReviewQueue` now stores a per-batch `ReviewBatchNote { version, title, markdown, created_at }` under `LibraryReviewQueue.batches`. `getActiveBatchNotes()` surfaces one note per batch that still has pending items (newest first, annotated with `pending_count`); `GET /api/library/review` returns them as `notes`, and `useReviewQueue()` exposes them. **Versioning re-base:** adopted the rule that **integer versions are published-at-scale baselines** (a full library backfill) and **decimals are test iterations** under review (promotion = next integer). Since no reweave generation has shipped at scale, the digest era folds into the published baseline **v1**, and the reweave experiments become **v1.1** (LLM-judgment connections) → **v1.2** (unified reweave) → **v1.3** (intent-aware reweave, current) → **v1.4** (concision, pending); the first full backfill will publish **v2**. `PIPELINE_VERSION` is now `"v1.3"`, the 12 items in the lane were re-stamped `v5` → `v1.3` (frontmatter + manifest), and `docs/PIPELINE-VERSIONS.md` + `CLAUDE.md` document the convention and the per-change **generation cycle** (edit → bump → registry entry → review note → cut batch).
- **Reference Library pipeline as a single versioned skill (provenance + "Updated" review lane + dev scripts)** — Formalized the digest/connection/reweave logic into one versioned skill. New `src/lib/library/pipeline.ts` is the single live entry point: it exports `PIPELINE_VERSION` (currently `"v1.3"`; `v1.4` concision nudge is pending) and re-exports the active `REWEAVE_PROMPT` / `CONNECTION_PROMPT` / `DIGEST_PROMPT`. Old versions are **not** kept as runnable files — they live in git history, and the new `docs/PIPELINE-VERSIONS.md` is the non-executable registry mapping each version (v1 published digest baseline — heuristic origin + summarize-CLI digest + chrome stripping + cached-source reuse + token-overlap connections → v1.1 LLM-judgment connections → v1.2 unified reweave → v1.3 intent-aware reweave; v1.4 concision pending; v2 = future full-backfill publish) to what changed, why, and a git ref where determinable. Added **provenance stamping**: `pipeline_version` is written into durable reference and candidate frontmatter (`references.ts`, `candidate-cache.ts`) and surfaced on `LibraryArtifact`, so every note records which generation of the skill produced it. Added the **"Updated" review lane** (`src/lib/library/review-queue.ts`): a Hilt-local manifest at `${DATA_DIR}/library-review-queue/<vault-hash>.json` (`LibraryReviewQueue` of `ReviewQueueEntry { path, pipeline_version, batch, status, added_at, reviewed_at?, note? }`) that isolates pipeline-version evaluation batches from organic ingestion — re-adding a regenerated item resets it to `pending` (fresh batch/version/timestamp, no status carry-over) and the manifest never touches vault markdown. Added supporting dev scripts: `scripts/library-reweave.ts` (re-weaves `type: reference` files, dry-run by default), `scripts/library-tag-versions.ts` (backfills `pipeline_version` stamps, dry-run by default), and `scripts/library-redigest.ts`, alongside the existing `scripts/library-rejudge-connections.ts`. Documented in `docs/PIPELINE-VERSIONS.md` (new), `docs/ARCHITECTURE.md` (Reference Library digestion data flow), and `docs/DATA-MODELS.md` (`pipeline_version` on `LibraryArtifact`; `ReviewQueueEntry` / `LibraryReviewQueue` shapes).
- **Reference Library book-capture import path** — Added a manual `book-capture` Reference Library source and `npm run library:book:import` for generated Kindle/Apple Books/Kindle Cloud Reader/PDF captures. The importer dry-runs by default, then writes a durable `type: reference` folder note under `references/books/<book>/index.md`, copies generated topic markdown under `topics/`, attaches optional cover media, caches the full generated capture/OCR under `references/.cache/book-captures/`, and runs durable-reference reweave so book saves get Bridge-aware connections. Book capture stays outside scheduler/backfill because it depends on a visible user-controlled reading source and must stop on app/DRM/screenshot blockers.
- **Knowledge Graph backend substrate (System → Graph, Phase 0, flag-gated)** — Began the opt-in knowledge-graph sub-mode behind `HILT_GRAPH_ENABLED` (default off; the tab, routes, DB, and watcher are fully inert when unset). Pinned `@cosmos.gl/graph` + `ngraph.graph`/`ngraph.forcelayout`. The backend (`src/lib/graph/`) parses the vault into an incremental SQLite index (`graph.sqlite` under `DATA_DIR`, derived cache — markdown stays source of truth), reusing existing parsers read-only via a once-per-pass prebuilt wikilink resolver, with a dotdir/library/degree-0 inclusion policy and candidates pulled from the cache API. Force-layout positions are precomputed on the host via a seeded, deterministic ngraph.forcelayout run as a chunked cooperative main-loop (no `worker_threads` in v1) with warm-start and scoped incremental relayout. This stage added the binary transport + four API routes: a versioned binary wire format (`encode.ts`: 32-byte header with magic `0x48474C31`/`TRANSPORT_FORMAT_VERSION`, `Float32` positions, `Uint8` interned color-key enum, `Float32` edge index-pairs for cosmos.gl `setLinks`, JSON sidecar of `ids`/`labels`/interned `types`/`colorKeyTable` with `refPaths` dropped and resolved lazily) plus `decodeGraphBinary` that validates magic/version and throws `GraphFormatError`; `selectGlobalGraph` (degree-0 + tag filtering, highest-degree-core limiting) and `selectLocalGraph` (BFS that keeps all 1-hop neighbors, fills 2-hop by ascending degree, caps per-node hub fan-out so person super-hubs can't swamp the set); and `GET /api/system/graph` (binary; `scope`/`node`/`hops`/`limit`/`includeTags`/`includeIsolated`/`fmt` params, server-enforced device ceilings, mobile-anchor fallback instead of 400), `GET /api/system/graph/meta`, `GET /api/system/graph/node/[id]` (lazy `refPath`), and `POST /api/system/graph/rebuild` (single-flight, 409 when a pass is running). Added `HILT_GRAPH_DEFAULT_HOPS` + `HILT_GRAPH_HUB_FANOUT_CAP` config getters/env and swapped `graphMeta` budgets onto the config getters. All routes 404 `{ error: "Graph disabled" }` when the flag is off. The watcher stage wired incremental index updates server-side: a long-lived `GraphRunner` (`src/lib/graph/runner.ts`, instantiated by `ws-server` only when the flag is on) hooks the existing watchers — BridgeWatcher events trigger a dir-rescan-by-mtime (`onDirChanged`) rather than trusting the single collapsed path (BridgeWatcher debounces by type and watches at `depth:2`), a persistent ScopeWatcher client at the vault root covers `references/`+`docs/` (`onFileChanged`/`onFileRemoved`), candidates refresh on an eventual poll via a new `refreshCandidates` build helper, and a periodic full mtime reconcile backstops any missed drift. The runner coalesces a burst into one debounced scoped relayout of the accumulated dirty seeds plus one notify; `notify.ts touchGraphChanged()` writes a `graph-build-event.json` marker under `DATA_DIR` that `ws-server` watches (mirroring the calendar marker) and broadcasts a `graph` `changed` WS event from. `POST /rebuild` now also touches the marker. `"system"` was added to the `/navigate` valid views.
- **Knowledge Graph desktop renderer (System → Graph, Phase 1, flag-gated)** — Built the client renderer in `src/components/graph/` behind a renderer-agnostic interface (`renderer.ts` `GraphRenderer`), so a WebGPU engine can swap in over the same binary buffers later. `CosmosRenderer.ts` is the only file importing `@cosmos.gl/graph` (pinned 2.6.4): it constructs one `Graph` on a container div, uploads precomputed server coordinates straight into GPU buffers (`setPointPositions(positions, /*dontRescale*/ true)`, `setLinks` with `Float32Array` index pairs, `setPointColors`, `setPointSizes`), and **freezes at rest** via `render()` then `pause()` (`enableSimulation: false`; idle is pure GPU render). `decode.ts` is the client-side `decodeGraphBinary` mirroring the wire contract (throws `GraphFormatError` on magic/version mismatch → `GraphView` hard-refreshes rather than rendering garbage). `device-budget.ts` is a pure device-class → budget map (Electron→desktop GLOBAL default; coarse-pointer small viewport→mobile LOCAL default, DPR clamped to 1.0; never `navigator.deviceMemory`/GPU-string probes). `graph-style.ts` resolves the interned `colorKeyTable` (node type + contextual `area:<slug>`) to RGBA per theme, derives `sqrt(degree)` sizes with a North-Star size floor, and builds the hover adjacency. `GraphView.tsx` runs the first-run state machine off `/api/system/graph/meta` (disabled state with no WebGL context when off, "Building graph index…" progress panel while `builtAt === null`, ready → mount + freeze), defaults to the device scope, hover-highlights neighbors (clears with `unselectPoints()`, never `[]`), click-throughs to Docs/People/Library (resolving `refPath` lazily via `/node/:id`; modifier-click re-roots local scope), focuses a deep-linked node two-phase once data arrives (graceful dismissible banner when the focus id is missing — not-yet-indexed/expired/deleted), re-resolves colors on theme change, and exposes `window.__hiltGraphStats` for e2e. `GraphToolbar.tsx` carries the Global/Local segmented control, a local-scope hop stepper, a flag-gated Show-tags toggle, a legend popover, the read-only refresh button, and a staleness chip. `useGraphMeta`/`useGraphData` are the fetch hooks (WS `graph` channel subscription with a 10s `/meta` polling fallback when the socket is down). The single-source scope grammar lives in `graph-deeplink.ts` (`buildGraphScope`/`parseGraphScope`, path-segment only). Added the "Show in graph" affordance (Lucide `Network`, gated on `isGraphEnabled()`) to Docs (`DocsContentPane` action buttons + mobile overflow, `nodeId` = absolute path), Library (`LibraryArtifactDetailPane` actions, saved refs **and** candidates, `nodeId` = artifact id), and People (`PersonMeetingList` person-header toolbar, `nodeId` = slug); each emits `navigateTo("system", buildGraphScope({ focus: nodeId }))`. Fully inert with the flag off: `GraphView` loads only via the flag-gated `dynamic({ ssr: false })` branch in `SystemView`, so cosmos.gl stays in dynamic chunks the default bundle never fetches, and the "Show in graph" buttons disappear.
- **Knowledge Graph mobile budgets & edge-case UX (System → Graph, Phase 2, flag-gated)** — Made the renderer device-adaptive with hard jetsam guardrails. `device-budget.ts` now carries `allowGlobal` (false on mobile, true on desktop/tablet) and `maxHops` (2 on mobile, 3 on desktop/tablet) alongside the existing default-scope/DPR/`simulate` fields. `GraphView` enforces them: a `coerceScope()` helper coerces any forced or default `"global"` scope to `"local"` on a device that may not hold the whole-vault buffer (protecting both the device default *and* a `/system/graph/global` deep-link tapped on a phone), and the hop count is clamped to `budget.maxHops` so the local payload stays under the server's mobile node cap. `GraphToolbar` hides the Global/Local segmented control entirely on mobile (local-only there) and caps the hop stepper at `maxHops`. Added the decided edge-case UX: an **isolated-focus hint** ("No connections yet") for a focused single node with zero edges (the un-promoted-candidate "Show in graph" path) instead of an empty-feeling canvas; a **truncation chip** ("large neighborhood — some nodes hidden") when the local payload was ring-capped (`decoded.truncated`); and an **offline indicator** (`· offline`) appended to the staleness chip when the WS socket is down and the view is on the 10s `/meta` poll fallback (`useGraphMeta` now returns `socketConnected`). The renderer's `onZoomChange` is wired to record the zoom level for label-LOD thresholds (`labelLODForDevice`); cosmos.gl 2.6.4 draws no native text, so v1 records LOD/zoom into the `__hiltGraphStats` e2e surface (now also exposing `allowGlobal`, `maxHops`, `simulate`, `truncated`, `isolatedFocus`, `labelLOD`, `zoom`, `socketConnected`) for the headless mobile e2e to assert server-side caps — an HTML label overlay is a later add. Still fully inert with the flag off (changes live only in the already-flag-gated graph components).
- **Knowledge Graph test harness (System → Graph, flag-gated)** — Added the two test entry points the plan specifies. `npm run test:graph` (already present) now also covers a deep-link round-trip regression (`src/lib/graph/deeplink.test.ts`): `buildGraphScope({ focus }) → buildViewUrl → parseViewUrl → systemModeFromUrl → isSystemMode` yields `mode === "graph"` and recovers the focus id (including explicit `local`/`global` scopes, scope-only links, the bare `/system/graph`, and percent-encoded absolute-path ids); it is colocated under `src/lib/graph/` because `graph-deeplink.ts` only `import type`s `@/lib/graph/types`, so `tsx --test` reaches it with a relative import and no alias loader. New `npm run test:graph:e2e` (`scripts/graph-e2e.ts`, modeled on `scripts/calendar-e2e.ts`) boots its own `next build` + `next start` with `HILT_GRAPH_ENABLED=true` against a fixture vault (temp `DATA_DIR`/`HILT_GRAPH_DB_PATH`, `HILT_GRAPH_MAX_NODES_MOBILE=200`) — the flag is inlined into the client bundle at *build* time via the `next.config.ts` env passthrough, so the checked-in flag-off build keeps the Graph tab absent and the harness must build with the flag on. After `POST /api/system/graph/rebuild` + polling `/meta` until `builtAt`, it asserts: System → Graph mounts the cosmos.gl canvas with a live WebGL2 context, the graph API returns data, desktop defaults to GLOBAL scope and freezes at rest (`isSimulationRunning === false`), a focus deep-link centers the node, a deleted/expired focus id degrades to the graceful banner with no console error, click-through resolves `refPath` via `/node/:id` and lands on People, and on a mobile viewport the view defaults to LOCAL, never requests the global buffer (a `/system/graph/global` deep-link is coerced to local), caps the node count at `HILT_GRAPH_MAX_NODES_MOBILE`, and clamps DPR to 1.0 — all behavioral assertions read `window.__hiltGraphStats`. Added `data-testid="graph-view"`/`graph-canvas` to `GraphView` for mount detection. **Renderer fix surfaced by the e2e:** the cosmos.gl canvas never mounted because the mount effect keyed only on `[enabled, ready]`, but the canvas container element attaches on a *later* render tick (it lives in the ready body branch and ref population trails the render where `ready` first flips true). Switched the container to a callback-ref-driven state (`containerEl`) and added it to the effect deps so the renderer mounts exactly when the element attaches. Still fully inert with the flag off (flag-off `next build` compiles unchanged; `/api/system/graph/*` 404s, the Graph tab is absent, and no WebGL context is allocated).
- **Knowledge Graph display, declutter & interactivity pass (System → Graph, flag-gated)** — A second pass focused on making the rendered graph *trustworthy and explorable* rather than a faint hairball. **Perf/legibility:** the graph is now **desktop/Electron-only** (`SystemView` gates `graphAvailable = isGraphEnabled() && !isMobile`; the Graph tab is dropped from the mobile switcher and a deep-link to it shows a "Graph is desktop-only" panel — the WebGL canvas never mounts and **no payload ever ships to a phone**, the strongest jetsam guarantee). Fixed the washed-out look: `CosmosRenderer` pins `spaceSize: 4096` and uniformly `scaleToSpace()`s the server coordinates to fill it (no more silent WebGL clamp / corner-clustering), sets `scalePointsOnZoom: false` (constant on-screen node size), and a theme-aware `linkColor`. Replaced the per-frame React label state with an **imperative HTML label overlay** — the top-K hubs by degree render through React once, and their screen positions are written directly to `node.style.transform` on each pan/zoom (rAF-coalesced) via `trackPointPositionsByIndices`/`getTrackedPointPositionsMap`, eliminating the main source of pan jank — with greedy collision-hiding so labels don't overlap. **Declutter:** single-link leaves are shrunk (`LEAF_SIZE`) so the connected structure reads over the halo, and a global-scope **minimum-degree stepper** ("all links / ≥ N", `minDegree` query param → `selectGlobalGraph({ minDegree })`, clamped 1–50 server-side / 1–10 in the UI) dials out the low-degree fringe (data-adaptive — the "leaf" threshold differs per vault). A **Type/Cluster color toggle** (`colorMode`) recolors by node type (default) or by client-side **Louvain community** (`graphology-communities-louvain`, computed from the decoded edges, zero backend work). *Note: layout-based community **separation** was tried and reverted — this vault's edge density is too low for it to read as clusters, so coloring-by-community is offered but spatial separation waits on a richer edge model.* **Interactivity (the trust surface):** a node click now **selects** instead of navigating away, opening a right-docked **`GraphInspector`** that shows the node's real connections **grouped by relationship kind** (wiki links / related / projects / meetings) with each neighbor clickable to re-point the inspector and recenter the canvas; **Open** (secondary) navigates to the node's canonical Docs/People/Library view, **Focus** re-roots the local-scope graph. The selection highlight is **sticky** under hover, and a background click clears it. `GET /api/system/graph/node/[id]` now joins neighbor labels/types into a `connections` array (new `getNodesByIds` batch helper) so the inspector renders without N round-trips. The **Legend** popover gained a "Connections" section explaining each edge kind (`graph-labels.ts` is the shared node/edge label + dot-color source). Tests: `test:graph` 56/56 (added `getNodesByIds` + `minDegree` selection cases), and `test:graph:e2e`'s mobile flow was rewritten to assert the desktop-only panel + zero graph payload requests, plus the new `/node/:id` `connections` contract.
- **Knowledge Graph folder clustering (System → Graph, flag-gated)** — Replaced the data-limited Louvain "Cluster" mode with **folder-based clustering**, which reads far better because it doesn't depend on edge density (Louvain on the sparse vault produced dozens of tiny communities — the "necklace"; folders give ~8 clean groups). The server ships a per-node **folder group** (top-level vault folder; persons → "people") in the JSON sidecar, interned as `folders` + `folderTable` (additive — no transport-version bump; `encode.ts` `folderGroupOf` + `EncodeOptions.vaultRoot`, the route passes `resolveVaultRoot()`). The reverted `separateByCommunity` was generalized into `buildFolderLayout`: it (1) groups the **non-leaf core** nodes by folder and ring-arranges the groups into separated regions (preserving each node's intra-group offset), then (2) **snaps every degree-1 leaf onto its highest-degree neighbor's new position** — so the ~79%-of-the-graph meeting transcripts (each linked to one person) fold into per-person *stars* instead of one giant "meetings" blob, and the leaf spread never inflates the ring scale. The toggle is now **Type/Folder** (`colorMode: "type" | "folder"`, `FolderTree` icon); Folder mode colors by folder group (`buildClusterColorBuffer` reused over the folder indices) **and** swaps in the cluster layout via a new `GraphRenderer.setPositions(positions, refit)` (cached per data-load so toggling is instant; refits since the spatial extent changes). Removed the client Louvain path entirely (`computeCommunities` + the `graphology`/`graphology-communities-louvain` deps, now uninstalled). Verified on-device against the real vault: Type mode is the prior undifferentiated hairball; Folder mode resolves into ~7 cleanly separated color regions (projects/references/areas as distinct clouds, a "people" ring of meeting-stars). `test:graph` 58/58 (added `folderGroupOf` mapping + interned-sidecar cases). *Honest scope: the North-Star `area:` signal is effectively unpopulated (2 nodes), so folders are the practical grouping today; pulling meetings toward projects (not just people) and a denser semantic edge model remain future work.*
- **Knowledge Graph palette + no-grey coloring (System → Graph, flag-gated)** — Reworked graph colors onto **Tailwind's curated palette** (a single `TW` hue map, shade 500 light / 400 dark) so the graph reads as cohesively as the rest of the app, replacing the hand-rolled hex sets. Killed the flat-grey `note` dots: since ~79% of nodes are `note`-typed (meeting transcripts) with no semantic sub-type, **notes are now colored by their folder** (rotating `FOLDER_HUES`) in both modes — typed entities (reference/candidate/person/project/north_star) keep their semantic hue, generic notes gain meaningful folder variety instead of one undifferentiated grey. `buildColorBuffer` takes an optional `folders` arg for this; `resolveColorKey`/`buildClusterColorBuffer` and the legend swatches (`graph-labels.ts` `NODE_TYPE_DOT`, `GraphToolbar` legend with a new "Notes — by folder" entry) all draw from the same Tailwind hues. **Folder mode is now the default** `colorMode`, so the graph opens to the fully-colored, spatially-separated cluster view (vivid Tailwind clouds + the people-ring) rather than the grey type-mode hairball.
- **Knowledge Graph meeting contraction + unified layout (System → Graph, flag-gated)** — Reworked the global view from "every file is a dot, folders forced into separate rings" to **entities interacting in one connected mass**. Meeting transcripts (~1,117 of ~1,414 nodes, and *not* leaves — only 3 are single-link; each links its person plus the projects/topics it covers) are now **contracted out**: `src/lib/graph/contract.ts` `contractMeetings()` removes every `meetings/` node and clique-expands its neighborhood into weighted derived edges, so a meeting linking Person + Project becomes a Person↔Project edge and co-attendees become Person↔Person (a pure view transform — the index is untouched, Critical Constraint #2; fan-out capped at 8 to bound O(k²)). The result is ~297 nodes / ~923 edges (people, projects, references, non-meeting notes), laid out **fresh per request** with a synchronous ngraph solve (`layoutSmallGraph`, deterministic seeded placement + fixed iterations — cheap at this scale) instead of the persisted full-graph positions. The route's global branch now uses this (`minDegree` still drops the low-degree fringe; `fmt=json` unchanged); **local scope is unchanged** (BFS neighborhood from persisted positions). Client-side, the artificial **folder ring-separation layout was removed** (`buildFolderLayout` deleted) — the Type/Folder toggle now only recolors; the layout is always server-owned, so the graph reads as one overlapping connected whole rather than disconnected circles joined by lines. Default `colorMode` is back to `type` (the contracted nodes are real entity categories). `test:graph` 62/62 (added `contractMeetings`/`degreeMap`/`layoutSmallGraph` cases). *Known tradeoff: type/folder colors are intermixed (the force layout groups by connection, not category) — soft color-regions would need a gentle grouping bias, deferred.*
- **Knowledge Graph control simplification + legend fix (System → Graph, flag-gated)** — The control surface had outgrown the feature's value and confused the user, so it was stripped to **one clean, self-explanatory view**. Removed from the toolbar: the **Global/Local** segmented toggle (Local is now only a drill-in reached by focusing a node from the inspector; a contextual **"Whole graph"** button appears to return), the **hop stepper** (local drill-in is a fixed 2-hop neighborhood), the **≥links / min-degree stepper** (low value, confusing), and the **Type/Folder color toggle** (single coloring now). Coloring is **by node type only**: typed entities (reference/candidate/person/project/north_star) get their Tailwind hue and **`note` nodes get a neutral slate** so the entities pop instead of the all-green muddiness folder-coloring produced (`buildColorBuffer` lost its `folders` arg; dead `buildClusterColorBuffer` + `buildFolderLayout` removed; client no longer reads the `folders` sidecar, though the server still ships it). **Fixed the broken legend:** it was an `absolute` dropdown inside the `overflow-hidden` `SecondaryToolbar`, so it was clipped to a ~40px sliver — now portaled to `document.body` with fixed positioning anchored to the button (escapes all overflow clipping; click-away backdrop). Legend copy updated (single "Note" swatch; the "Meetings" connection now reads "People & projects linked via shared meetings", reflecting contraction). `test:graph` 62/62; tsc + eslint clean. *Context: the explicit-link graph has hit its insight ceiling — surfacing serendipitous cross-topic through-lines needs a continuous semantic/vector topic layer (documented as phase 2), not more controls.*
- **Knowledge Graph final gate (System → Graph, flag-gated)** — Verified the full subsystem ships green and inert. Gate: `tsc --noEmit`, `eslint --quiet`, flag-off `next build` (exit 0), `test:graph` (54/54), `test:graph:e2e`, and the regression suites `test:calendar` (16/16) and `test:library` (60 pass / 3 pre-existing skips) all pass. Confirmed flag-off-by-default inertness at the bundle level: with `HILT_GRAPH_ENABLED` unset, `isGraphEnabled()` inlines to `false` in the client bundle, the cosmos.gl library chunk is **not** referenced by `app-build-manifest.json`/`build-manifest.json` (it exists only as a lazy `dynamic({ ssr: false })` import target one chunk away, never fetched on the default path), the Graph tab is absent, the three "Show in graph" buttons disappear, and `/api/system/graph/*` 404. The one residual build warning (Turbopack "Encountered unexpected file in NFT list" on `next.config.ts`) is the documented cost of the `env: { HILT_GRAPH_ENABLED }` passthrough that surfaces the server flag to the client tab — it is a warning only, the build exits 0, and it does not affect inertness. Documented the subsystem in `docs/ARCHITECTURE.md` (System → Graph pipeline data flow, routes, state, file index), `docs/DATA-MODELS.md` (graph domain types + `graph.sqlite` schema), `docs/API.md`, and `docs/COMPONENTS.md`. **Remaining for human verification:** WebGL rendering quality at full vault scale on real hardware, and mobile Safari behavior (the local-only budget, DPR clamp, and gesture handling are asserted headlessly but not visually confirmed on-device).

### Changed

- **Reference Library filter rail polish** — Renamed the Library toolbar toggle from `Sources` to `Filters` to match the pane's broader status/source/mode/admin role. On narrow widths, the floating filter rail no longer dims the feed behind it; it relies on its own border and shadow while retaining click-outside-to-close behavior.

- **Reference Library wide Feed cards** — Feed density now uses a media-right card layout when the reader is closed and there is enough desktop/tablet width, so Feed titles/descriptions keep a consistent left edge across cards with and without thumbnails. Thumbnail-backed items become compact horizontal cards with the full Feed metadata/summary/actions preserved; the media is inset and rendered at its natural aspect ratio instead of being cropped as a cover image. Broken thumbnail URLs are hidden client-side so those cards fall back to full-width text instead of reserving an empty media column. Compressed reader mode and narrow/mobile feeds keep the existing vertical card layout. The open-feed container widened from `max-w-3xl` to `max-w-4xl` so the horizontal cards have room without changing List density.
- **Reference Library Feed card actions** — Feed card overflow menus now render outside the card instead of being clipped by the card frame. Card actions live as a left-aligned cluster in a separated bottom row under the text block: candidate cards expose a compact `Candidate` dropdown for `Save`/`Dismiss`, Updated-lane cards expose a matching `Updated` dropdown for `Approve`/`Reject`, and the general overflow menu contains `Open source` plus saved-reference actions such as mark unread/archive. Cards with no general actions do not render a dead overflow button; the source/date line stays clean, compact filing/source tags sit below the description, and the low-signal `Interesting` recommendation badge is no longer rendered as a visible card pill.
- **Reference Library promoted to v2 (published baseline) + full-library backfill** — Blessed the v1.4 protocol and promoted it to the integer **v2** (the `v1.4` prompt verbatim — promotion = rollout at scale, not a prompt change). `PIPELINE_VERSION → v2`, so all new organic ingestion stamps v2 automatically; the v1.4 review queue was cleared (Updated lane → 0). New `scripts/library-backfill.ts` reanalyzes the whole library to v2: a parallel, **resumable** (worklist = every `type: reference` not yet v2, recomputed from disk), **rate-limit-aware** orchestrator. It builds one shared KB index, re-stamps v1.4 items to v2 without reweaving (identical protocol), and reweaves the rest via the tested `library-reweave.ts` per-file path (now accepting `--kb-index-file`). Rate-limit handling: `reweaveArtifact` gained `rethrowRateLimit` + a `RateLimitError` (detecting usage-limit signatures in the Claude CLI envelope/stderr); a worker that hits a limit exits `75`, and the pool pauses with exponential backoff (honoring a parsed reset time), drops concurrency by one, then climbs back after a clean streak. Backfilled items are marked read at the end so the mass rewrite doesn't flood the New lane. Run: `DATA_DIR=… npx tsx scripts/library-backfill.ts --vault … [--concurrency N] [--dry-run] [--limit N]`.
- **Reference Library pipeline v1.4 — concision & density** — Targeted additions to `REWEAVE_PROMPT` (structure/voice from v1.3 kept), in response to review feedback that v1.3 read substantively well but too prose-heavy: (1) a **DENSITY directive** — write like a daily executive brief, lead with the takeaway, prefer tight bullets and small tables over paragraph walls, reserve prose for where it carries an argument, cut floral runway; length tracks substance. (2) A **newsletter treatment mode** — distinguish a single-story issue (treat as an essay) from an aggregator issue (summarize *more concisely than the original*, never paragraph-per-story or mirror its TOC). (3) **Connections lean first-party** — library cross-refs default to none-or-one, first-party ties always lead, and the Connections list must not repeat a point the digest body already drew. `PIPELINE_VERSION` → `v1.4`; `docs/review-notes/v1.4.md` frames the regen; `docs/PIPELINE-VERSIONS.md` anchors the target to Justin's own manual capture (`references/process/2026-05-22-roadmap-defense-collapsing`). The regeneration was stopped early at **7 of the 12** lane items (Centaurs, Dax Raad, Thariq, Karpathy, iruletheworldmo, AI News, Jasper) — registered as the `v1.4-initial` review batch with a partial-set note; the remaining 5 stay on v1.3 until the next pass. The Jasper image fix (above) shipped with it.
- **Reference Library source display labels** — The synthetic legacy source now appears as `Manual` instead of `Manual captures`, and the `book-capture` source appears as `Books` instead of `Book captures`. Stable source ids are unchanged (`manual`, `book-capture`), and old frontmatter labels are normalized at read time.
- **Library column dividers + middle-column resize** — The Sources↔Feed↔Detail dividers were a 4px in-flow resizer strip *on top of* a 1px column border, reading as a thick seam. They now match the Docs filetree divider: a hairline 1px line (`bg-[var(--border-default)]`, accent on hover/active) with a wider invisible drag handle overlaid on it (`w-px` flex track + absolute `w-2` grab), so the visible divider is 1px while staying easy to grab. The middle (feed) column's max resize width was raised from 560 → 1000px so it can be widened well past the previous cap.
- **Reference Library reweave digestion — one Claude pass, free-form digest, disciplined connections** — Durable saves now go through a single in-vault, read-only Claude **reweave** pass instead of summarize-then-judge. `src/lib/library/reweave-prompt.ts` (new) carries the verbatim `REWEAVE_PROMPT` and `parseReweaveOutput` (tolerant: raw JSON, ` ```json ` fences, or embedded JSON via brace-balanced extraction; drops empty/`references/.cache/` targets, strips trailing `.md`, requires a non-empty relationship, coerces missing fields). New `reweaveArtifact(kbIndex, { title, sourceContent }, { vaultPath })` in `connections.ts` mirrors `judgeConnections`' plumbing but runs the model in the vault (`cwd=vaultPath`, `--allowed-tools Read Grep Glob`, `--add-dir`, `REWEAVE_PROMPT` as `--append-system-prompt-file`, 300s default timeout) so it can Grep/Glob/Read the corpus to ground both the digest and the connection targets; returns `null` on any failure, timeout, `LIBRARY_CONNECTIONS_DISABLED=1`, or no vault path. The summarize CLI is narrowed to **extraction only** (recovering/cleaning source text); the model owns the note's shape. Added `ReweaveResult`/`ReweaveConnection` to `src/lib/library/types.ts`, and `ProcessedArtifact` gained `digest_markdown?`/`description?` (existing `summary`/`key_points` untouched for candidates and the fallback path). In `digestion.ts`, durable saves (`intent === "explicit_save"` OR `saveRecommendation === "file"`) call `reweaveArtifact` and, on success, set `digest_markdown`/`description`, map `connection_suggestions = [...connections_first_party, ...connections_library]` as `{ target, label: title, relationship }` (first-party ordered first), set `connected_projects` from first-party targets under `projects/<slug>/`, and pass through `reweave_candidates`; files are never auto-renamed. On `null` it falls back to the prior `judgeConnections` + `parseDigestOutput` Summary/Key Points path. `references.ts` now renders connections as `- [[target|Title]] - relationship` (human title as wikilink alias; `- Title - relationship` for a null target) and, when `digest_markdown` is present, replaces the fixed `## Summary`/`## Key Points` sections with the free-form digest (Media, Connections, Raw Content, Source Notes layout preserved); the frontmatter `description` uses `processed.description || processed.summary`. `candidate-cache.ts` matches the same connection rendering but is otherwise unchanged — candidates stay lightweight (summarize digest, no reweave LLM spend). New `scripts/library-reweave.ts` backfills `type: reference` files (`--vault`, repeatable `--path`, `--write`, dry-run `--out-dir`, `--sleep`, `--limit`): builds the KB index once, derives `sourceContent` from the Raw Content cache → Summary → frontmatter description, preserves Media/Raw Content blocks verbatim, and updates body + frontmatter (`description`, `connection_reasoning`, `reweave_candidates`, `connection_suggestions`, `reconnected_at`), skipping items where reweave returns null or an empty digest. `scripts/library-rejudge-connections.ts` remains the connections-only pass for the `judgeConnections` fallback. The reweave model came from studying Justin's manual captures: minimum structure, maximum room — depth matches the source, honest about weaknesses, practitioner voice, comprehensive first-party ties but library cross-refs only when they sharpen or surprise.
- **summarize CLI is a referenced external dependency** — Reference Library digestion resolves the summarize binary via `SUMMARIZE_BIN` (default `summarize` on PATH) instead of a hardcoded command, mirroring `XURL_BIN`, and logs install guidance (`npm i -g @steipete/summarize`, https://summarize.sh) when it's missing instead of failing silently. Documented as an optional prerequisite in the README and `.env.example`. Hilt references the tool rather than vendoring it.
- **Reference Library connections are now LLM judgment, not token overlap** — Replaced the deterministic keyword-overlap connection scorer (`suggestArtifactConnections`, `tokenize`, `reasonFor`, `STOPWORDS`, plus per-connection `reason`/`terms`/`score`) with an LLM judgment engine. A new `src/lib/library/kb-index.ts` builds a compact index of the vault's North Stars, projects, areas, people, and recent references (~1.25K tokens), and `src/lib/library/connections.ts#judgeConnections` runs a Claude-CLI judge (verbatim `CONNECTION_PROMPT` in `src/lib/library/connection-prompt.ts`) over that index plus the reference's title/summary/key points/source excerpt. The judge returns a `ConnectionJudgment { connects, reasoning, connections[], reweave_candidates[] }`: connections are directional relationships (including baseline/contrast/foundational ties) written into the note as `- [[target]] — relationship`, while reweave candidates flag neighbor notes that would be materially updated and are surfaced for human review only — never auto-edited. The judge is abstain-biased: a clean `connects: false` with one-line reasoning is a first-class outcome and replaces padded keyword ties. `ConnectionSuggestion` is reshaped to `{ target?, label, relationship, kind? }`, and `connection_reasoning`/`reweave_candidates` are persisted alongside `connection_suggestions`/`connected_projects`. The pipeline abstains and stays offline-safe on any failure, timeout, or when `LIBRARY_CONNECTIONS_DISABLED=1`.
- **Reference Library LLM connection judgment** — The digestion pipeline now wires the Claude-CLI connection engine (`buildKbIndex` + `judgeConnections`) in place of the removed offline token-overlap scorer. Connections are judged only when an artifact will be durably saved (explicit-save sources or discovery items recommended to `file`); plain review candidates get no connections and no LLM spend until promoted or re-judged. `ProcessedArtifact` carries `connection_suggestions`, `connection_reasoning`, `reweave_candidates`, and `connected_projects` (targets that match project folder slugs), and the assessment `why` tail now uses the judge's reasoning. Reference and candidate markdown render `- [[target]] — relationship` (or `- label — relationship` for null-target peer/theme ties); when there are no connections the section body is left empty and `connection_reasoning`/`reweave_candidates` are written to frontmatter instead of a lone `- ` bullet. Honors `LIBRARY_CONNECTIONS_DISABLED=1` (abstains, offline) and the optional `LIBRARY_CONNECTIONS_MODEL` env.
- **Reference Library connection re-judgment script** — Added `scripts/library-rejudge-connections.ts`, a connections-only re-judge that builds the KB index once and runs `judgeConnections` per file. Dry run by default (prints per-file JSON with verdict, connections, reweave candidates, and reasoning; never touches files); `--write` rewrites only the `## Connections` / `## Suggested Connections` section body and the `connection_reasoning`/`reweave_candidates` frontmatter, leaving Summary/Key Points/Raw Content/Media untouched. Works for both reference and candidate files, powering both the review pass and the eventual backfill.
- **Calendar week-view polish** — The Calendar toolbar now keeps the date title and previous/today/next cluster together on the left, styles that temporal navigation as a segmented control, and highlights whether the current range is before, on, or after today while preserving normal button behavior. Calendar source toggles moved into the three-dot actions menu above Sync Now. Week headers now use a compact two-column day/date and temperature/icon grid, with day dividers extending through the date header and all-day row so the full week grid reads as one table.

### Fixed

- **Reference Library: unified candidate/saved processing (the v2.1 onion divergence)** — Live ingestion (`digestArtifact`) branched three ways that shouldn't gate quality (candidate-vs-saved, a `LIBRARY_CANDIDATE_REWEAVE` flag, and `library_mode`), so freshly-fetched ("organic") candidates fell to a cheap path that ran the now-free-form `DIGEST_PROMPT` output through the *old* `parseDigestOutput` → one flattened `## Summary` block + raw-transcript "key points" in the legacy template, yet stamped `v2.1` (so the backfill skipped them). Collapsed to **one path gated only by intent**: `shouldWeaveConnections = library_mode === "study"`. **study** items (candidate or saved) get the full reweave (digest + connections); **keep** items get the clean free-form L1 digest only. The L1 free-form digest is now the default body for everyone (`digestMarkdown = summarized`), so keep/degraded items never hit the legacy summary/key-points scaffold. Added **re-upgradeable degradation**: a study item whose reweave can't run (rate-limited/disabled/no-vault) keeps its L1 digest and is flagged `reweave_pending: true` (`ProcessedArtifact` + frontmatter); `scripts/library-backfill.ts` re-includes any `reweave_pending` item regardless of version, and `library-reweave.ts` clears the flag on a successful reweave. Removed the dead `judgeConnections` fallback + the `LIBRARY_CANDIDATE_REWEAVE` flag. One-time sweep marked the 31 already-broken candidates `reweave_pending` for re-processing.
- **Reference Library archive suppression** — Archiving a saved reference now stamps archive metadata before moving it into the hidden `.archive` folder, and source ingestion treats archived URLs as duplicates with reason `archived_reference_exists`. This keeps explicit-save sources such as X/Raindrop from re-creating a reference the user intentionally archived. The Library reader also clears archived selections into a quiet "No reference selected" state instead of leaving a false loading pane.
- **Reference Library X long-post digestion** — X/Twitter bookmark digestion now verifies the bookmarked post itself through the configured xurl path and prefers full `note_tweet` text before summarizing. This fixes bookmarks where the bookmark-list endpoint returned only the truncated public `text` field, causing numbered/list posts to be summarized from item 1 only. The digest prompt now explicitly preserves concrete numbered findings as takeaways, and `library:redigest` keeps the same free-form reweave body conventions and `pipeline_version` stamping as normal ingestion.
- **Broken hero images fall back to OpenGraph** — `enrichRawArtifactMedia` previously fetched an `og:image` only when an artifact had *no* thumbnail, so a present-but-broken hero (e.g. a Raindrop `rdl.ink` screenshot-render URL that 500s on a 360-viewer product page — the Jasper ottoman) was kept and rendered broken. It now HEAD-validates a remote thumbnail (`isReachableImage`: non-2xx/206 or non-image content-type → broken), drops it, and falls back to the page's OpenGraph image (or to no image, rather than a broken one). `scripts/library-reweave.ts` runs the same repair and rebuilds the Media block when the hero changes, so the fix applies on regeneration.
- **Reference Library Updated note scroll behavior** — In List density, the generation-note card now renders inside the virtualized artifact list instead of above it, so it scrolls away like a normal first item rather than staying pinned while the list moves.
- **Reference Library Sources drawer persistence** — The Library `Sources` rail now remembers its open/collapsed state in localStorage, matching Docs sidebar behavior. Refreshing Hilt preserves the user's workspace shape instead of resetting the rail closed every time.
- **Library Health no longer counts self-healed dead letters as warnings** — The health warning total folded in *every* dead-lettered item from the last 24h (`dead_letters.recent_24h`), so a run of transient `fetch failed` blips that a later run recovered showed as "16 warnings" while every source/job row was green and "now success". Health now distinguishes **unresolved** dead letters — failures whose source has had no successful run *since* (`last_success_at` vs the entry's timestamp) — from transient ones that self-healed. `LibraryDeadLetterSummary` gained `unresolved`; the panel's warning count and the top-level `ok` flag key off it, and the Sources header reads "dead letters N total · M unresolved" (or "· all resolved"). With the current vault all 16 were self-healed → 0 warnings.
- **X bookmark long-form text and partial-thread detection** — X/Twitter bookmark ingestion now requests `note_tweet` and `conversation_id` (`tweet.fields`) and prefers the long-form `note_tweet.text` (up to ~25k chars) over the 280-char `text` truncation, so the digest sees the full post body instead of a clipped excerpt. When a tweet is the root of its own conversation (`conversation_id === id`) with no `note_tweet` body and thread markers in the text (`looksLikeThreadRoot` in `media.ts` — numbered openers, "🧵", "here are N …", "thread below/👇", "1/N"), the adapter flags `metadata.partial_thread` and `digestion.ts` records an extraction note that only the opening post was captured (the current X API plan has no thread/search access to fetch the reply continuation). This keeps thread roots honest about being partial rather than silently digesting a fragment as if it were complete.
- **Calendar overlap and visibility handling** — Timed events now use Schedule-X non-overlap lanes (`eventOverlap: false`, full-width lane sizing) so overlapping meetings sit side-by-side instead of becoming illegible stacks. The e2e fixture asserts those events do not geometrically overlap. Calendar filtering also hides exact EverCommerce `👦🏼 Walt` blocks (and the parenthesized variants) alongside the existing filler/canceled exclusions.

## [7.0.0] - 2026-05-29

### Added

- **Calendar (v1)** — A unified, read-only Calendar view (Cmd+3) backed by local ICS sync. Subscribes to four sources (EverCommerce Outlook, Priceless + Personal Google, public US Holidays), stores events in SQLite, and de-duplicates the same event across feeds by source priority. Renders day/week/month/agenda via Schedule-X with a Sunday-first week, current-time indicator, and per-day weather chips (Open-Meteo, links to weather.gov). Surfaces EverCommerce availability as subtle blocked-time bands and flags non-blocked events during 9–5 ET workdays. Extracts Teams/Meet/Zoom join links, links matched Granola meeting notes, and stays markdown/local-source-of-truth with no event creation or external write-back.
- **Meetings via Granola sync** — Granola meeting notes and transcripts sync into the vault as markdown (fetched through a remote helper over SSH), auto-match to people by filename and to calendar events by iCalUID/title+time, and surface in People as a per-meeting feed with Notes/Transcript tabs. Unmatched meetings collect in an inbox, and recurring unmatched names surface as suggested people. `GranolaSyncControl` exposes compare (dry-run) and incremental sync.

### Changed

- **Calendar default scroll hour** — Day and week views now open scrolled to 9 AM instead of 8 AM (`INITIAL_TIME_GRID_HOUR`). The grid still spans the full 24 hours, so earlier and later hours remain reachable by scrolling.

- **Calendar ↔ meeting link legibility** — The calendar event popover now gathers every action into one row at the top: live join links (Teams/Meet/Zoom, first styled as the primary action), a `Notes` button to the linked Granola meeting note, and an external `Open in Google`/`Open in Outlook` link derived from the provider URL (was an ambiguous bottom-anchored "Open link"). The event body is relabeled `Description` so it no longer collides with linked meeting notes. Reciprocally, Granola meeting notes in People now show a `Calendar` chip in the meeting header when matched to a Hilt calendar event (amber when the match is fuzzy, with method/confidence in the tooltip); clicking it deep-links back via `/calendar/event/<id>/<date>`, which lands on the date, focuses the event, and opens its popover. This makes the calendar↔note link visible and bidirectional.

- **Reference Library X title/digest cleanup** — X/Twitter bookmark ingestion now strips trailing short URLs from titles, uses author-based fallback titles for URL-only bookmark wrappers, and treats URL-only X article wrappers as warm metadata-limited captures rather than hot summaries. Redigestion now preserves existing X raw cache/media context instead of feeding the title back as source text, and digest prose strips collapsed Markdown headings/bold bullets before rendering Summary and Key Points.

- **Reference Library X embed sizing** — X/Twitter embeds now render through the X widgets API at native tweet width without an extra Hilt border/background wrapper, avoiding the clipped/empty right-side pane and fixed-height bottom cropping around embedded X videos. Raw saved iframe fallbacks now use a taller height for non-Hilt renderers.

- **Reference Library media alignment** — Library media embeds now center horizontally whenever they are narrower than the reader. X posts, YouTube embeds with constrained widths, generic iframe embeds, and markdown images all use the same centered media alignment rule while full-width media remains full-width.

- **Reference Library media body cleanup** — Generated `## Media` sections no longer append duplicate `Watch on YouTube` or `Open on X` markdown links below embeds. Source URLs remain available through reference frontmatter, the detail toolbar copy/open actions, and the Source tab instead of being repeated in the body.

- **Reference Library source-metadata digestion quality** — Newsletter and X/Twitter fallback digestion now strips invisible tracking characters, email chrome, subscription/footer text, and engagement metadata before summary generation. Long source-provided text, including Superhuman newsletter bodies and linked X post text, is summarized through the same `summarize` CLI path instead of letting raw metadata become the visible digest.

- **Reference Library X video embeds** — X/Twitter bookmarks now recognize linked `x.com/.../status/.../video/...` media, preserve video preview thumbnails when the X API provides them, store linked video URLs as media, and render the X post embed in the Library media area.

- **Reference Library item URLs** — Opening a Library item now updates the Hilt URL to `/library/item/<id>` while preserving the current Library controls as query state. Browser Back/Forward can return from a detail view to the Library index, direct item URLs hydrate the detail pane, and the reader toolbar includes copy actions for both the Hilt item link and the markdown path.

- **Reference Library same-day Recent ordering** — Recent keeps source publication/capture date as the visible primary date, but now breaks same-day ties with precise capture/digestion metadata such as `captured_at` and `digested_at`. Newly checked X bookmarks no longer sit behind older same-day manual captures just because both display the same date.

- **Reference Library live source check** — Added an explicit `Check sources` action separate from local view/health refresh. The Library toolbar and health popover can now trigger a bounded live hourly-source ingest through `/api/sources/ingest`, then revalidate Library lists, health, and unread state. X/Twitter bookmark checks now use a fetched-window incremental mode so newly bookmarked older tweets are not filtered out by the tweet's original creation date.

- **Docs mobile chrome offset** — The Docs file tree drawer and document reader now use a Docs-specific mobile chrome offset that matches the actual 61px toolbar plus the standard 13px optical gutter, so first folders and first headings start clearly below the visible hideable top toolbar instead of being covered by it.

- **Mobile bottom navigation material** — Reworked the floating mobile tab pill to use light/dark theme variables for background, border, shadow, and compact tab states. Dark mode now uses a stronger translucent material and higher-contrast inactive icons so the nav remains legible over media-heavy Library feeds.

- **Reference Library nav unread dot** — The top-level Library tab now uses the same quiet blue-dot language as Briefing when any saved reference or active candidate is unread. A lightweight `/api/library/unread` endpoint powers the shell without loading the full Library list.

- **Reference Library video pop-out controls** — YouTube videos now only float after they are actively playing and have scrolled past the inline embed. The floating player can be moved, resized, or returned inline from hover controls, and the reader gains bottom scroll clearance while the mini-player is visible.

- **Reference Library candidate dismissal** — Dismiss now marks candidates `skipped`, removes them from the active Feed/List immediately, and shows a short undo toast. Default Library lists now exclude skipped/expired/promoted candidate cache entries unless a specific lifecycle status is requested.

- **Reference Library detail loading** — Opening a Library item now passes the list-known markdown path to the detail API, which validates the path hash and parses that exact reference/candidate file instead of rebuilding and sorting the full Library collection for every click. Detail panes should return to near-instant behavior even with hundreds of saved refs and candidates.

- **Reference Library transcript live-follow** — Timestamped video transcripts now highlight the active playhead row without forcing the reader scroll position. A `Jump to Live` control opt-in scrolls to the current line and follows playback; manual wheel, touch, or keyboard scrolling exits live-follow so the reader stays under user control.

- **Reference Library New ranking** — Added `New` beside `Recent` and `For You` as an unread-only Library ranking. `/api/library?unread=true` now applies Hilt-local read state before filtering, so the view spans saved references and candidates while staying independent of lifecycle/source filters.

- **Reference Library YouTube transcript reader** — YouTube embeds in Library detail now use the YouTube IFrame API with a direct command fallback, request `2x` playback by default, and keep playing in a bottom-right mini-player after the inline video scrolls out of view. Timestamped YouTube cache content now renders as a transcript reader instead of rough raw text, with active-line highlighting from the playhead and click-to-seek transcript rows.

- **Reference Library unread indicators** — Added Hilt-local Library read state under `${DATA_DIR}/library-read-state`, plus quiet blue-dot unread markers on Feed cards and List rows. `/api/library` now returns `unread_total`, `/api/library/sources` returns per-source/per-status unread counts, and `POST /api/library/read` marks artifacts read without mutating reference markdown. Feed and List now mark an item read only after it has been opened and the reader moves away from it.

- **Reference Library legacy body cleanup** — Added `npm run library:repair-body-cruft` for report-first cleanup of old manual captures that embedded `← References` navigation, bold source/author/date metadata clusters, or `## Media` before the title. The Library reader also strips that legacy chrome defensively before rendering summaries, and Library Markdown table styling now matches the Docs read-mode header treatment.

- **Primary navigation order** — Moved Briefing to the first top-level tab while keeping app startup/default routing on Bridge. Keyboard shortcuts now follow the visible order: `⌘1` Briefing, `⌘2` Bridge, `⌘3` People, `⌘4` Library, `⌘5` Docs, and `⌘6` System.

- **Reference Library media enrichment** — New ingestion now fills missing representative media from source-provided media first and Open Graph metadata second, storing `thumbnail:` plus bounded image entries for `## Media`. X bookmark ingestion requests media expansions when available, and `npm run library:repair-media` can add missing article/bookmark images to old saved references without rewriting summaries.

- **Reference Library connection suggestions** — Digestion now performs file-native Bridge context matching against active projects, current tasks, areas, and people notes, storing structured `connection_suggestions` plus readable `## Connections` / `## Suggested Connections` bullets. For You uses those precomputed tie-ins as ranking evidence and richer recommendation explanations.

- **Reference Library review interactions** — Feed cards now open from the whole card surface while keeping Save, Dismiss, Source, and saved-reference menu actions independent. Candidate "Skip" copy is now "Dismiss" in the UI; the underlying candidate status remains `skipped` for API/file compatibility.

- **Reference Library Feed reading context** — Opening a Feed card now keeps the user in Feed instead of switching to Browse. Desktop turns the Feed into a split reader with the selected card highlighted on the left and the rendered reference detail on the right; mobile opens the same detail pane over the Feed with a Back control, preserving the Feed scroll position.

- **Reference Library unified control model** — Replaced the separate Feed/Browse top-level Library mode with one composable Library surface. `Sources` is now an independent sidebar toggle, `Feed/List` controls density, and `Recent/For You` controls ranking. Lifecycle filtering moved into the source rail as a `Status` section so `All`, `Saved`, and `Candidates` behave like filters rather than a second toolbar.

- **Reference Library reader/layout semantics** — Removed the separate reader toggle. Feed stays full-width until an item is selected, then compresses into a split reader and can be closed by selecting the active card again or using mobile Back. List density always reserves the reader slot on desktop, auto-selects a row when possible, and keeps a placeholder when no item is selected. Source/content columns now use persisted drag handles with defaults that keep the detail reader as the widest pane.

- **Reference Library Browse row measurement** — Browse now uses measured row virtualization for the item list instead of a fixed row height, so wrapped source/status chips expand their row instead of overlapping the next item.

- **Reference Library legacy reference repair** — Added a non-destructive `library:repair-legacy` CLI for old saved references that predate the rich media/cache standard. It preserves existing summaries and connections while adding publication dates, thumbnails, YouTube embeds, and full source/transcript cache when available. Hilt now also honors legacy `created:` frontmatter before falling back to filesystem creation time, so repaired notes do not appear newly saved.

- **Reference Library incremental lists** — Browse and Recent now page through `/api/library` with `offset`/`limit` instead of stopping at a fixed client cap. Browse virtualizes its artifact rows and automatically requests older pages near the end of the visible list, so deep historical references remain reachable without rendering the whole library at once.

- **Reference Library manual capture grouping** — Saved references that predate source configs and have no `source_id:` now appear under a synthetic `Manual` source in Browse and `/api/library/sources`, so old hand-filed captures can be isolated without rewriting their frontmatter.

- **Reference Library manual capture repair** — Ran a bounded preservation repair over manual captures, adding meaningful source caches to 11 older references, YouTube metadata/media to recovered videos, and metadata-only improvements where safe. The legacy repair CLI now ignores source-cache snippets below 500 characters by default so source-limited stubs are reported instead of persisted.

- **Reference Library health warning clarity** — Scheduler rows now classify repeated Node/tsx `DEP0205` stderr as successful log notices instead of warnings, keep log excerpts line-aligned, and surface the first actionable stderr line when a job really does need attention.

- **Reference Library health refresh feedback** — The health popover Refresh action now forces a no-cache health fetch, shows an in-flight spinner/label, and displays the exact checked time so manual refreshes have visible confirmation.

- **Reference Library health severity icon** — The Library health control now stays as the neutral pulse icon when sources/schedulers are healthy, even if benign log notices exist. It only turns amber for real warnings and red for blocked/bad states.

- **Reference Library Recent date ordering** — Recent now sorts saved references and candidates by parsed timestamps instead of string comparison, and saved-reference YAML dates normalize to ISO date-only strings. This keeps May 28 candidates above May 27 saved refs and prevents UTC-midnight frontmatter dates from displaying as the prior local evening.

- **Electron mobile-width resizing** — Lowered the Hilt Electron minimum window size from `800x600` to the small iPhone/SE viewport class, `375x667`, so the native app can actually reach the responsive mobile layouts.

- **Responsive mobile-mode trigger** — Hilt's shared mobile layout hook now activates for either coarse-pointer devices or viewports below the `sm` breakpoint. Narrow Electron windows therefore use the same bottom navigation and mobile view structure as phones.

- **README demo screenshot privacy pass** — Reduced the Library README section to one Browse screenshot and replaced the System screenshot with a fake demo Sessions treemap instead of a live Stack view that exposed real machine names. Added `npm run demo:seed-map` and `npm run dev:demo` so the demo System view can be populated with synthetic map data.

- **Reference Library chrome polish** — Consolidated Library Feed/Browse, Recent/For You, Saved/Candidate filtering, item counts, and health into one System-style secondary row. The health control is now a compact icon popover with expandable scheduler rows and log excerpts instead of a static panel.

- **Reference Library Browse ergonomics** — Added persisted desktop pane resizing for source/list/detail columns, narrowed the source column default, widened the reading pane, made source counts respect the active lifecycle/search filters, unified detail actions as Summary / Cache / Source, and moved saved-reference Archive behind a confirmed overflow menu.

- **Reference Library source date and depth repair** — Library list dates now prefer source publication time over file creation time, fixing historical Raindrop/X saves that appeared newly captured. A bounded source-depth pass added older Raindrop and X bookmark pages and left clean cursors for later historical maintenance.

- **Shared secondary toolbar chrome** — Library and System now use the same 44px secondary toolbar primitive for mode switchers, filters, status, health, and refresh controls. Narrow widths keep a single non-wrapping row with horizontal overflow instead of letting Library grow taller or System controls overlap.

### Fixed

- **Reference Library scheduler health noise** — Scheduler health now treats npm update notices as known stderr noise alongside Node/tsx `DEP0205` warnings, so a successful hourly ingest no longer shows an amber warning just because npm printed its upgrade banner.

- **YouTube Bookmarks incremental ingest** — YouTube Bookmarks now use fetched-window duplicate detection instead of filtering by the video's original publish date. Newly bookmarked older videos are therefore eligible for ingestion on the next source check.

- **Manual Library source-check reweave cap** — The Library `Check sources` action now passes a 60s per-item reweave timeout to ingestion. Source checks still fetch, summarize, embed media, cache transcripts, and save durable references, but long vault-weave passes fall back to `reweave_pending` instead of making the toolbar look stuck. The CLI also accepts `--reweave-timeout-ms` for bounded manual runs.

- **Reference Library read-state semantics** — Feed scrolling no longer marks unread Library items as read. Feed and List now share the same rule: an item must be opened first, and it is marked read only when the reader moves away from it or closes. Restored the live `~/.hilt` read-state entries that were marked read on 2026-06-02 back to unread.
- **Electron mobile window drag chrome** — Mobile-width Electron layouts now keep an Electron-only top drag/titlebar reservation so macOS traffic lights no longer overlap view headers, and the floating bottom nav pill exposes draggable empty space while keeping its icon buttons clickable.
- **Library Browse secondary rhythm** — Browse now uses the same 13px body gutter as System under the shared secondary toolbar, and the Library health badge/popover no longer get clipped by the toolbar overflow edge.
- **Library mobile list hit target** — After returning from a mobile List detail with Back, the list pane now keeps its full flex width instead of collapsing virtualized rows to a narrow hit target while their text overflowed visually.

## [6.0.0] - 2026-05-28

### Added

- **System inspection parent view** — Added `/system` as the top-level home for Hilt's machine/system views. System has internal `Sessions`, `Apps`, and `Stack` modes, with legacy `/map`, `/local-apps`, and `/stack` URLs still resolving into the matching System mode. Top-level navigation is now simplified to Bridge, People, Briefing, Library, Docs, and System.

- **Reference Library v0** — Replaced the `/library` placeholder with a file-native Library surface: Feed and Browse views, candidate Save/Skip, source filters, detail panes, For You recommendations, keyword search, and APIs for library items, candidates, sources, ingestion, recommendations, and search. Added source YAML loading, fixture-first ingestion adapters, candidate cache handling, durable reference writing, promotion, retry/dead-letter state, and CLI entrypoints for ingestion, hourly runs, newsletter runs, candidate cleanup, retry replay, and recommendation refresh.

- **Reference Library source verification** — Added `.env.local` loading for Library CLI scripts, masked source auth verification, ingestion dry-run/canary mode, per-artifact ingestion reports, and Superhuman News source configuration. Dry runs use the same adapter and digestion path as live ingestion but do not write references, candidates, source state, or dead letters. Added xurl-backed X bookmark ingestion, support for a scoped xurl binary that requests only bookmark-read OAuth scopes, a YouTube OAuth helper that writes token fields to `.env.local` without printing token values, and Superhuman News ingestion through `mcp-remote` with read-only `list_threads`/`get_thread` tool calls into hidden candidate files.

- **Reference Library cursor backfill** — Added cursor-backed historical ingestion for Raindrop, YouTube liked videos, X bookmarks, and Superhuman News. `npm run library:backfill` uses source-state cursors and reports per-source `cursor`/`next_cursor`, so bounded backfills can resume without `--ignore-state`.

- **Reference Library quality audit and re-digestion** — Added `library:audit-quality` and `library:redigest` utilities to identify warm/cold captures, queue items for `summarize` repair, and mark refreshed notes with `digestion_status`, `digested_with`, and `digested_at`. The ingestion path now lets `summarize` choose its default model unless `LIBRARY_SUMMARIZE_MODEL` is explicitly set.

- **Reference Library rich source cache fallback** — Raindrop ingestion now preserves cover/media/cache metadata, can use Raindrop permanent copies as a bounded article source-cache fallback when `summarize --extract` cannot recover full text, and renders multiple source images in `## Media` for non-video references. X/Twitter links saved in Raindrop still prefer canonical source text instead of Raindrop's rendered permanent copy.

- **Reference Library health dashboard** — Added `/api/library/health` and a compact Library header panel that surfaces launchd scheduler load state, source last-success/blocker state, and dead-letter counts without requiring log inspection.

- **Reference Library scheduler wrappers** — Added launchd dry-run/install/uninstall scripts for hourly ingestion, daily newsletter ingestion, retry replay, candidate cleanup, and recommendation refresh. The scheduler uses the same CLI runner as manual/API ingestion and is dry-run by default unless explicitly installed.

- **System tailnet session aggregation** — Added `/api/system/machine`, `/api/system/machines`, and `/api/system/sessions/*` routes. The Sessions mode now queries local Map indexes from each Hilt-running tailnet peer, namespaces machine/session/tree ids, and presents an all-machines session map while still resolving history previews through the machine that owns the session.

- **System Stack inspection** — Added `/api/system/stack` and `/api/system/stack/file` for machine-aware Claude/Codex configuration inspection. Local Stack editing remains available on the serving machine; remote peer stacks are read-only and file previews must resolve from that peer's discovered stack metadata rather than arbitrary browser-provided paths.

- **System Sync inspection** — Added read-only `/api/system/sync` and `/api/system/sync/conflicts` routes plus a `System > Sync` mode for Syncthing health. Sync snapshots read only each machine's local loopback Syncthing API, cache expensive folder status calls, aggregate through Hilt peers, and surface folder state, needed files, pull errors, versioning, ignore parity, peer connection state, and conflict files without exposing the Syncthing API key.

- **Local Apps monitor view** — Added a gated Apps inspection mode that inspects local TCP listeners on the Hilt-serving machine, groups them by app/worktree, probes health, builds tailnet-friendly open URLs, and shows app-first service cards. APIs live under `/api/local-apps`, use a cached single-flight scanner, redact process args before UI/API exposure, and are disabled unless `HILT_LOCAL_APPS_ENABLED=true`.

- **Local Apps scanner contracts and tests** — Added Local Apps Zod contracts, Hilt-owned settings import/defaults, Port Authority-compatible FNV stable ids, macOS `lsof`/`ps` parsing, service classification/grouping, tailnet helpers, optional preview scaffolding behind `HILT_LOCAL_APPS_PREVIEWS=true`, and `npm run test:local-apps` plus a Port Authority parity script.

- **Local Apps tailnet aggregation** — `/api/local-apps` now keeps the local snapshot contract while adding a `machines` array for other online tailnet devices that are also running Hilt. Peer discovery is Hilt-to-Hilt only: it probes known Tailscale peers for `/api/local-apps?scope=local`, checks Tailscale Serve HTTPS plus common Hilt dev ports `3000`-`3004`, validates the Hilt API contract, and renders the Apps view grouped by machine.

- **Local Apps screenshot previews** — Added Playwright as an explicit runtime dependency for optional Local Apps previews, tightened preview capture to healthy HTTP services only, shortened the default screenshot cache to 2 minutes, and made capture prefer the same tailnet/public URL the user would open before falling back to local probe URLs.

- **Local Apps explicit preview refresh** — Added `POST /api/local-apps/refresh` and wired the Apps toolbar refresh button to force a local scan plus fresh screenshot capture. Preview cards now show capture freshness, so stale screenshots are visible instead of silently looking current.

- **Local Apps remote preview proxy** — Added a safe known-peer preview proxy so HTTPS-served Apps pages can display screenshots captured by remote Hilt machines without embedding insecure HTTP image URLs.

- **Repository agent instructions and historical Map plan** — Added repo-local `AGENTS.md`, Codex documentation reminder hooks, the Hilt control skill, and the superseded Convex Map plan so Xochipilli, Mercury, and origin share the same agent-facing project context.

- **v6 release documentation and demo vault** — Refreshed the README for the current Bridge, People, Briefing, Library, Docs, and System navigation model; added demo Library saved references, candidates, source configs, and rich media assets; and recaptured README screenshots for all top-level views including Library Browse and System.

### Changed

- **Reference Library For You ranking** — For You now caps itself at eight picks, ranks against active projects, current tasks, North Stars, people notes, and recent saves, returns matched terms/reasons, and records `for_you_selected` when a candidate is saved from the For You feed.

- **Primary navigation order** — Reordered the top-level tabs to Bridge, People, Briefing, Library, Docs, and System. Keyboard shortcuts follow the visual order: `⌘1` Bridge, `⌘2` People, `⌘3` Briefing, `⌘4` Library, `⌘5` Docs, and `⌘6` System.

- **Floating primary navigation chrome** — Removed the full-width desktop toolbar strip while preserving its top layout reservation, so primary tabs, search, theme, and source controls float over the canvas without pulling page content upward. Mobile now shows only the section icons in one floating pill, with the mobile search entry point paused for now.

- **Desktop nav centering** — Centered the primary tab group against the viewport instead of the padded statusbar content box, so Electron's macOS traffic-light padding no longer nudges the middle nav to the right.

- **Bridge weekly header spacing** — Matched the Week header-to-first-section spacing to the Briefing tab's header-to-first-card rhythm while preserving the existing spacing between Notes, To Do, and following sections.

- **Bridge notes canvas editing** — Removed the card border, content surface, and internal padding around weekly Notes/Accomplishments editors so they read as editable text directly on the canvas again.

- **Full-bleed workspace top gutter** — Added a desktop-only gutter and body-attached top border below the floating primary nav for Docs, People, and System, with the below-nav space optically balanced against the space above the tab pill and the right/native window controls centered in the same top chrome.

- **System canvas chrome** — Flattened the System mode toolbar rows so the mode switcher and controls sit directly on the canvas, removed the pre-toolbar System border, and moved optional body outlines below the secondary toolbar. Sessions, Apps, Sync, and Stack's all-machines view stay borderless; selected Stack inspectors keep a body-attached top border after the standard toolbar gap.

- **Bridge weekly notes-first section order** — Weekly parsing now tracks `## Notes`, `## Tasks`, and `## Accomplishments` as ordered sections instead of assuming notes are last. Bridge renders weekly notes/tasks in source-file order, rebuilds weekly files without flipping that order, and the weekly template now creates notes before tasks for new weeks. The current week file was moved to the notes-first convention; older weekly files were left untouched.

- **Bridge notes editor trailing space** — Weekly notes/accomplishments now disable TipTap's trailing-node extension, removing the phantom empty cursor line at the bottom of compact notes blocks while leaving task detail editors unchanged.

- **System-first navigation IA** — Replaced the separate system-inspection pill cluster with a single top-level System tab. The System view owns its secondary mode switcher, so Map/Sessions, Apps, and Stack read as related inspection lenses instead of unrelated primary destinations.

- **Sync control plane plan tightened** — Updated the Syncthing pilot plan with explicit `/system/sync` routing, Sync feature flags, tailnet-only Syncthing addresses, conflict retention via `maxConflicts = -1`, shared ignore include naming, conservative REST polling/caching, and versioning test caveats.

- **System stale-while-refresh views** — Sessions and Stack now follow the Apps view's return-to-tab behavior: the last client snapshot, selection, and visible content render immediately when switching back, then refresh in the background. Refresh errors are shown as non-blocking status banners over stale data instead of replacing the view with a blank loader.

- **System single-row mode chrome** — Consolidated the System mode switcher with each mode's own controls. Sessions, Apps, and Stack now use one secondary row with mode tabs on the left and filters/status/refresh or machine selection on the right, avoiding the stacked sub-navigation/toolbars that made System feel heavier than the other tabs.

- **System toolbar height parity** — Tightened the Sessions activity slider and fixed System secondary rows to the same 44px height as the primary Hilt toolbar.

- **Local Apps camera-wall layout** — Flattened machine sections into one app grid where each card is a full-bleed screenshot/fallback tile. App title, path, source machine, service chips, freshness, and open affordance now live as overlays on the visual surface.

- **Local Apps softer camera tiles** — Rounded the Local Apps preview cards and overlay pills/buttons, increased the card radius and shadow, and removed the outer card stroke so the camera-wall layout feels more like lifted preview tiles while keeping compact operational density.

- **Local Apps mobile camera grid** — The Apps camera wall now keeps two preview columns even on mobile-width viewports, with compact port-only chips plus hidden path/fallback text at the smallest sizes to preserve the monitor-wall feel without crowding the overlays.

- **Local Apps hover-only card chrome** — Removed the redundant open icon from Apps camera tiles, made port chips neutral instead of health-colored, and hid the bottom service/freshness row until hover or keyboard focus.

- **Local Apps theme-aware fallback tiles** — Replaced the hardcoded dark fallback surface for `No web UI`, preview failures, and other non-preview states with theme variables so empty/error camera tiles respond to light and dark mode like the rest of Hilt.

- **Local Apps machine grouping and softer cards** — Restored machine sections in the Apps camera wall, reduced the card drop shadow, and cached the last Local Apps snapshot in the client so switching away and back refreshes over existing data instead of flashing the `Scanning local apps` placeholder.

- **Local Apps Homebrew grouping** — Homebrew-managed infrastructure now groups by service command instead of the `/opt/homebrew` git root, so services render as legible `ollama`, `nginx`, and `mysql` app cards rather than vague `homebrew` cards.

- **Local Apps infrastructure evidence** — Non-preview infrastructure cards now surface concise evidence such as Homebrew ownership, service role, loopback-only binding, and data directory hints. This makes cards like `ollama`, `mysql`, and `nginx` explain why they are present without requiring a separate process inspector.

- **Local Apps adaptive preview overlays** — Camera-wall card overlays now use a light-biased treatment in light mode and keep the dark glass treatment in dark mode. Titles, paths, service chips, evidence chips, and hover status text all switch contrast with the active Hilt theme instead of always rendering white text on black gradients.

- **Local Apps material preview overlays** — Preview card overlays now use faded backdrop blur layers behind the tint, so titles and hover metadata sit on a softer glass-like material instead of a flat translucent shadow. The blur fades out with the overlay in both light and dark mode, while text and chips remain crisp.

- **Local Apps tablet-density grid** — Apps machine sections now keep three camera columns from tablet-sized widths upward, reserving the two-column layout for narrower/mobile widths instead of collapsing from three columns too early on desktop resize.

- **Content surface design pass** — Added shared `--content-surface` and content shadow theme tokens, then applied them to the places that represent user/work content rather than app chrome: Briefing bodies, Bridge task rows, writing cards, project cards, Bridge note bodies, Docs document/code/image/PDF bodies, People list/meeting cards, and Local Apps preview/fallback tiles. Light mode now uses white content surfaces over the warm canvas; dark mode keeps the existing subdued dark content surfaces.

- **Local Apps card shadow tuning** — Tightened the elevated content-card shadow so Apps preview tiles have a smaller but more visible shadow against white light-mode cards.

- **Local Apps taller top preview material** — Extended the top preview overlay's blurred material band so app titles and paths stay legible when screenshots have their own headings near the top.

- **Local Apps reduced overlay tint** — Reduced the top preview overlay's light/dark shade opacity and strengthened backdrop blur so card labels read as glass over the screenshot instead of an opaque gradient wash.

- **Local Apps softer preview blur** — Reduced the Apps card material blur slightly while keeping the low tint unchanged, so overlay labels still read clearly without making the screenshot underneath feel overly smeared.

- **Local Apps top-aligned 16:9 previews** — Screenshot capture now uses the same `1280x720` 16:9 frame as the Apps cards, and preview images anchor to the top of the card so older taller screenshots crop from the bottom instead of losing both header and footer context.

- **Grouped global navigation** — Reordered the main tabs into three unlabeled visual clusters: Briefing as the synthesis surface, Bridge/Docs/People as workspace views, and Map/Apps as system inspection views. Keyboard shortcuts and view routing stay unchanged.

- **Grouped navigation pill blocks** — Replaced the initial grouped-tab hairline dividers with separate pill blocks and real gaps, so the global nav reads as three chunks instead of one long noisy segmented control.

### Fixed

- **Tailscale Library blank page after dev process exit** — The existing `com.hilt.dev-server` LaunchAgent was present but inactive, with `RunAtLoad` and `KeepAlive` disabled, so Tailscale continued proxying to `localhost:3000` after the foreground Next process died and returned `502`. Hilt's dev script now binds to `0.0.0.0:3000` by default, and the local LaunchAgent is configured to run at load and restart the dev server if it exits.

- **People tab transcript-only recordings missing** — People matching now includes Granola recordings that only have a transcript file under `meetings/transcripts/YYYY-MM-DD/` and no companion meeting note under `meetings/YYYY-MM-DD/`. These transcript-only records are deduped when the note exists, keep their transcript path, and show in saved-person timelines/counts instead of disappearing.

- **People tab invalid System scope carryover** — Switching from System directly to People no longer carries scopes like `/stack`, `/apps`, or `/sessions` into People as if they were person slugs. People now remembers its own last valid scope, sanitizes known System scopes back to the inbox, and redirects invalid slugs every time they appear instead of only once per mount.

- **Local Apps preview downgrade flicker** — Metadata polls and preview refreshes now merge with the last known screenshot metadata instead of replacing it wholesale. A newer scan that omits a preview path for the same app/service no longer makes a card fall back from a good screenshot to `Preview disabled`.

- **Local Apps light-mode preview loading surface** — Preview-backed cards now use Hilt's theme-aware content surface while screenshot images are loading instead of a hardcoded black surface. Light mode no longer flashes dark rectangles under still-loading screenshots; dark mode still inherits the dark theme surface.

- **Local Apps preview flicker after capture errors** — Forced screenshot refresh now attaches the last good cached preview before capture and preserves that PNG when a later Playwright capture fails. Failed refreshes are exposed as `service.preview.error`/`error_at` and shown as hover status metadata, so camera tiles no longer collapse from a screenshot into an error fallback just because the newest recapture missed.

- **Local Apps screenshot capture running without active viewing intent** — Ordinary `/api/local-apps` metadata reads now attach cached screenshots only and never start Playwright capture. The Apps view requests fresh screenshots on visible page load, manual refresh, visible tab return when stale, and every two minutes while visible; refresh can fan out to peer Hilt machines so remote screenshots stay current only while the view is actually being watched.

- **Local Apps scan too slow for remote peer discovery** — The macOS Local Apps adapter read process metadata sequentially for every listening socket, so `/api/local-apps?scope=local` could take ~15 seconds on a busy machine. Tailnet peer discovery only waits briefly per candidate, making healthy remotes look unavailable. The adapter now reads each unique PID once and does that work with bounded concurrency, keeping local snapshots responsive enough for remote aggregation.

- **Local Apps remote discovery stuck after transient Tailscale CLI miss** — Tailnet identity helpers cached `null` forever when `tailscale status` or `tailscale ip` missed once, leaving the Apps view local-only until the dev server restarted. Hilt now caches successful Tailscale values but retries misses, so remote aggregation can recover without a restart.

- **Local Apps tailnet identity missing in Electron-started dev servers** — The Electron-launched Next process could fail the direct Tailscale CLI helper even while `lsof`/`ps` collection worked, causing the serving machine to report no Tailscale DNS/IP and disabling peer aggregation. Local Apps now resolves machine identity and peer lists through async child-process helpers with a shell fallback, matching the rest of the scanner while tolerating GUI launch environments.

- **Dev app using generic Electron user data instead of Hilt config** — The dev-mode `dist/Hilt.app` launches the generic Electron binary, so Electron defaulted `app.getPath("userData")` to `~/Library/Application Support/Electron`. That made app-open startup read stale `Electron/data/sources.json` instead of Hilt's configured sources, often leaving local sources without a `folder` and skipping the local environment server startup path. Electron now calls `app.setName("Hilt")` before computing `DATA_DIR`, so the dev app consistently uses `~/Library/Application Support/Hilt/data`.

- **`/navigate` silently failing when Hilt window is hidden** — `POST /navigate` only broadcast over the renderer's WebSocket. Backgrounded Electron windows have their `setTimeout` reconnect timers throttled, so a renderer whose WS dropped while hidden would never reconnect, and the broadcast hit zero clients. The skill's main use case ("open this file in Hilt") thus appeared dead any time the user wasn't already focused on Hilt. Added a second path: WS server now also writes `~/.hilt-pending-navigate.json`, the Electron main process watches it (chokidar) and forwards via `webContents.send("navigate:goto", …)`, then focuses the window. Main is never throttled, so this works regardless of renderer state.
  - `server/ws-server.ts` — `POST /navigate` writes the intent file alongside the broadcast
  - `electron/main.ts` — `setupNavigateWatcher()` watches the file and forwards via IPC + focus
  - `electron/preload.ts` / `electron/types.d.ts` — exposes `electronAPI.onNavigate(callback)`
  - `src/components/Board.tsx` — listens to both WS and IPC, with shared handler

- **Hilt skill hardcoded API to `localhost:3000`** — When another Next.js app (Loft) was on 3000, Hilt fell back to 3001+ and every API call from the skill (`/api/bridge/weekly`, briefings, recycle) hit the wrong app. Skill now probes ports 3000–3005 for `/api/ws-port` (Hilt-specific JSON route) to discover Hilt's actual port. Updated `~/.claude/skills/hilt/SKILL.md`.

- **Next.js / WS server port race on launch** — Both the Next.js dev server and the WS server preferred port 3001 when 3000 was occupied (e.g. Loft). Whichever bound first won; the other crashed. When the WS server won, Electron's `loadURL("http://localhost:3001")` hit the WS server's HTTP handler and rendered a 404, masquerading as a "Hilt is broken" state. Electron now passes `WS_PORT = nextPort + 100` when spawning the WS server, so the two never compete. The change is in `startWsServer()` (electron/main.ts).

- **Hilt window showing BrowserSync / EADDRINUSE on relaunch** — `findAvailablePort` bound only the IPv6 wildcard, which silently sidesteps IPv4-only listeners (OrbStack forwarding `127.0.0.1:3000–3005` to Docker containers). Hilt would think a port was free, bind it on IPv6, then Electron's `loadURL("localhost:…")` would resolve to IPv4 first and land on OrbStack — Hilt window showed BrowserSync. Switching the probe to IPv4-only had the inverse problem: a port with another Next.js dual-stack listener (e.g. Loft on `*:3002` IPv6) read as free on IPv4, then Hilt's actual bind crashed with EADDRINUSE. The probe now mirrors what `next dev` actually does — a wildcard `listen(port)` — combined with an IPv4 loopback check, so Hilt walks past every shared port and lands somewhere truly unused. Fix in `findAvailablePort()` (electron/main.ts).

- **Dev app broke when the project folder moved** — `scripts/create-dev-app.sh` baked an absolute `PROJECT_DIR` into `dist/Hilt.app`'s launcher, so moving the repo (e.g. `tools/hilt` → `me/hilt`) left the app `cd`-ing into a dead path. The launcher now self-locates the project from its own position inside the bundle (`dist/Hilt.app/Contents/MacOS/launcher` → 4 levels up), keeps the build-time path as a fallback for when the `.app` is copied out of `dist/`, and shows an alert instead of failing silently if neither resolves.

## [5.0.0] - 2026-05-21

### Added

- **Map local SQLite readiness pass** — The Map view is now local-first and indexed in `${DATA_DIR}/map.sqlite` instead of reading Codex/Claude source stores on every request. Added `better-sqlite3`, incremental source scans keyed by file `mtimeMs + size`, `map_sessions`, `map_source_files`, `map_overrides`, and `map_checkpoints` tables, plus `HILT_MAP_LOCAL_ENABLED` and `HILT_MAP_HISTORY_PREVIEW` gates. Codex ingestion no longer has the prototype `LIMIT 500`; Claude project/app files are scanned incrementally. Graph responses now omit full session arrays and raw history, session lists are paginated, and history preview resolves source paths only from indexed metadata.

- **Map readiness tests and perf gate** — Added Map query/contract tests for status/source/window filtering, override precedence, background inclusion, paginated sessions, pathless graph/session responses, session-detail rejection, and history caps/redaction. Added `npm run test:map:perf`, which seeds a 50k-session/1k-workspace SQLite fixture and asserts warm graph/page payload and latency targets.

- **Map copyable session identifiers** — Session rows and history preview now show a copyable Map session id, so the user can paste a specific id back into chat or search. Map text search now includes Map ids, provider ids, and provider external keys.

### Changed

- **Map UI compact toolbar** — Replaced the prototype title/sidebar controls with a compact control bar: activity slider, status dropdown, source dropdown, refresh action, counts, and collapsed diagnostics. Source filters now collapse to `All`, `Codex`, and `Claude`; advanced provider diagnostics stay behind the database icon. Mobile keeps a staged flow: tree first, filters behind a button, sessions after non-root selection, history after session selection.

- **Map selection chrome cleanup** — Folded the selected tree summary into the filter toolbar, removed the separate treemap header row and `All` reset button, added tick marks to the activity slider, made treemap/session clicks toggle selection, and only renders the history pane after a session is selected. History preview now also has its own close button.

- **Map activity chrome cleanup** — Consolidated the selected work summary and global session/workspace counts on the right side of the toolbar. Removed visible raw `heat` scores from the toolbar and treemap nodes; activity heat remains an internal sizing/sorting signal, while visible labels stick to sessions/workspaces/active counts.

- **Map responsive toolbar ladder** — The selected work/session/workspace summary now hides at a custom intermediate width before the filter controls run out of room, and the filters collapse behind the compact filter button at the next narrower breakpoint. This keeps narrow Map widths from overlapping the filter controls without dropping the summary too early on roomy desktop widths.

- **Map selected-session responsive layout** — The Map now keeps tree, session list, and history preview in a three-column layout down to the mobile breakpoint. When a history preview is open on narrower desktop/tablet widths, the treemap shrinks first instead of wrapping the history panel below the map.

- **Map foreground/background visibility model** — Replaced the prototype `Tracked`/`Unmatched`/`Ignored` status language with `Foreground`/`Background`. Foreground is now reserved for human-legible top-level work; background keeps disposable workers, sidechains, unmapped, stale, suppressed, and automation-like sessions inspectable without letting them dominate the default map. Legacy `tracked`, `unmatched`, and `ignored` rows/query params are migrated to `foreground` and `background`.

- **Map background status icon** — Replaced the amber warning triangle on background sessions with a small amber dot. Background is a lower-salience visibility state, not an error or caution state.

- **Map Codex foreground signal tuning** — Codex Mac app / remote-control rows now treat a stored `first_user_message` as a foreground human signal, since those sessions may not populate `thread_source=user` or `has_user_event`. OpenClaw/Clawd automation workspaces remain background via an explicit automation-like workspace heuristic, which keeps human-titled Codex sessions such as Chief of Staff, Documents planning, and Sonarr/Radarr visible without promoting routine background runs.

- **Map Claude title detection** — Claude project JSONL parsing now recognizes `aiTitle` from `ai-title` rows. These titles count as human-readable session titles, so real Claude sessions with generated titles are not incorrectly backgrounded as `missing human-readable title`.

- **Map foreground signal precedence** — User turns are now sufficient to classify a non-worker, non-automation session as foreground even when no generated title exists. Claude sessions without `aiTitle` fall back to a compact first-user-message title, while explicit cron prompts still remain background.

- **Map OpenClaw source-aware classification** — Claude project sessions now distinguish direct user prompts from OpenClaw-routed background prompts. Slack DMs from Justin and plain user prompts remain foreground; inter-session `isUser=false` messages, heartbeat checks, continued background transcripts, OpenClaw update notices, cron prompts, and probe sessions stay background with explicit reasons.

- **Map Codex subagent lineage classification** — Codex subagent rows now parse structured `source.subagent.thread_spawn` metadata instead of treating it as an opaque harness string. Worker/subagent sessions spawned by foreground human-led parent sessions stay foreground, with `human-led parent` and agent nickname signals; automation workspaces still remain background even when spawned from a foreground parent.

- **Map work-footprint drilldown** — Map indexing now extracts metadata-only path signals from Codex and Claude tool activity so sessions that start in a parent folder can still appear under the nested folder where work happened. Workspaces can now contain folder nodes before branch/work-item nodes, and the treemap conditionally reveals child nodes inside large parent tiles while still supporting drill-in selection with breadcrumb navigation.

- **Source startup and fallback order** — The source list order is now authoritative for default library selection. Electron startup opens the first available configured source by rank, whether local or remote, and renderer fallback uses the same order when an active remote stops responding. Local sources no longer leapfrog higher-ranked remote sources; unavailable remotes are skipped until the next available source.

- **Docs editor: replaced MDXEditor with CodeMirror + ReactMarkdown** — Edit mode now uses a plain markdown source editor (`@codemirror/lang-markdown`) so files round-trip byte-exact: no more escaped `[[wikilinks]]`, no normalized bullet markers, no reformatted line breaks. Read mode unifies on `ReactMarkdown + remarkGfm + rehypeRaw` (previously only used for files containing `<details>` blocks); wikilink + image rewriting and Mermaid block rendering are preserved. Frontmatter editing UI is unchanged. **Tradeoffs:** no WYSIWYG toolbar, no rich image-insert dialog, no syntax-colored code blocks in read mode (added `rehype-highlight` as a dep for a follow-up). `DocsEditor`'s imperative ref API (`getMarkdown`/`setMarkdown`) is dropped — no consumers used it. Deleted orphan `src/components/PlanEditor.tsx`. Removed `@mdxeditor/editor` from dependencies. Simplified the "baseline content" workaround in `useDocs.ts` and `StackContentPane.tsx` since byte-exact edits make the comparison `editedContent !== loadedContent`.

### Fixed

- **Electron chrome and app-wide scrollbars** — Adjusted macOS traffic-light controls to align with Hilt's floating top nav and added a global scrollbar visibility controller so scrollbars stay hidden until active scrolling, then appear as minimal transparent-track thumbs instead of thick persistent rails.

- **Map nested treemap positioning** — Fixed adaptive inline child nodes using their own local origin instead of the parent tile's offset, which caused nested folders/workspaces to pile up in the top-left of the treemap and ghost through unrelated parent tiles.

- **Map nested treemap legibility** — Inline child nodes now reserve a fixed parent header band and only render when the remaining child viewport is large enough, preventing child tiles from overlapping parent labels.

- **Map activity slider alignment** — Moved activity tick marks above the slider track, centered each label/tick/thumb stop on the same horizontal position, and restyled the range thumb with an opaque app-background border so ticks do not show through the selected dot.

- **Tailscale-served dev routes rendering blank** — Added `allowedDevOrigins` in `next.config.ts`, derived from `NEXT_PUBLIC_REMOTE_HOST`, so Next dev allows the Tailscale host to load development assets/endpoints. Without this, `/map/...` over `https://xochipilli...ts.net` could return HTML and API data but never hydrate the client shell.

- **Wikilinks with section anchors rendered as broken** — `resolveWikilink` in `src/lib/docs/wikilink-resolver.ts` did an exact-target lookup against the file map, so `[[file#Heading]]` never matched. Now strips the `#anchor` portion before resolution; the link opens the file at the top, and the alias half (`[[file#Heading|Display]]`) preserves the section label in the rendered text.

- **Week recycle silently failing** — `useBridgeWeekly.recycle()` did not check `response.ok`, so when the recycle endpoint returned HTTP 500 (e.g. from a Turbopack compile failure), the modal closed and the user saw nothing happen. The new week file was never created on disk, leaving gaps in `lists/now/` (weeks 04-13 and 04-27 were missing for one user). `recycle()` now throws on non-OK responses with the server's error detail, and `RecycleModal` catches and displays the error inline so the modal stays open.

- **Turbopack cache corruption breaking dev routes across launches** — When Turbopack's on-disk task database gets corrupt (`TurbopackInternalError: Failed to restore task data`), specific routes return HTTP 500 forever — silently breaking features whose frontends ignore response status (e.g. week recycle). The corruption persists across app launches because the dev server reloads the same bad cache. Hilt now detects recent `next-panic-*.log` files in tmpdir at Electron startup and wipes `.next/dev/cache` so the dev server rebuilds cleanly.

- **Hilt attaching to Loft's dev server on launch** — `findExistingDevServer` probed ports 3000-3004 and accepted any HTTP 200 with HTML content as "the Hilt dev server". When Loft was running on port 3000 and Hilt launched after, Hilt would load Loft's UI into its Electron window. Added `isHiltServer(port)` probe that hits `/api/ws-port` (a Hilt-specific route returning JSON) and requires a JSON response — other Next.js apps return HTML 404 for that path. Applied to both the single-server and multi-source reuse paths in `electron/main.ts`.

- **PersonCard sidebar** — Removed description subtitle ("Product Counterpart", etc.) from sidebar cards to save space. Description is still visible in the detail header.

- **MeetingRow dynamic height** — Replaced fixed `h-13` height with `py-2.5` padding so long titles wrap and matched-people tags flow naturally instead of clipping.

- **Transcript tab stale on meeting switch** — `transcriptFetched` ref was never reset when switching meetings, causing stale transcript content. Added reset effect keyed on meeting identity. Active tab now persists across meeting changes unless the tab doesn't exist on the new meeting.

- **Scrollbars always visible** — Removed custom `::-webkit-scrollbar` styles that overrode macOS native overlay behavior. Scrollbars now auto-hide and appear as thin native overlays during scroll.

### Added

- **People tab visual polish & features** — InboxCard now matches PersonCard size/padding and shows meeting count, relative date, and last meeting title. MeetingRow displays time (from Granola `created` field) formatted as `"Mar 5 · 3:00 PM"` and supports `inboxMode` hierarchy flip (title primary in inbox, date primary in person view). MeetingEntry header shows time when available. TranscriptView uses chat-style layout with left/right alignment ("Them"/"You"), first-label-only speaker tags, and `bg-tertiary` for "You" messages. Config panel simplified: shows filename with copy/reveal icons, aliases, and matching terms list. New "Suggested" section below person cards shows unmatched recurring meetings (3+ occurrences) with dotted-border cards. Backend computes `inboxStats`, `suggestedMeetings`, and `time` fields in a single pass through meeting files.

- **People tab documentation and demo data** — Added People view to README with screenshot. Created demo people data (5 fictional contacts with meeting history) and sample meeting files in `docs/demo/` so People tab works out of the box with `HILT_WORKING_FOLDER=./docs/demo`. Updated folder structure docs with `people/` and `meetings/` directories.

- **Prevent duplicate Electron dock icons** — Single-instance lock prevents a second bouncing icon when relaunching from Raycast. Production server spawns detached with system node to avoid ghost "exec" dock icon on macOS.

- **CLI navigation endpoint** — POST `/navigate` on the WS server (`~/.hilt-ws-port`) broadcasts navigation commands to all connected clients. Any Claude session can `curl` to open a specific view/path in Hilt. Supports all views: `bridge`, `docs`, `stack`, `briefings`, `people`. Window auto-focuses in Electron via new `focusWindow` IPC. Documented as core skill in CLAUDE.md.
  - `server/ws-server.ts` — POST `/navigate` HTTP handler
  - `server/event-server.ts` — `broadcastAll()` method (sends to all clients regardless of subscriptions)
  - `src/components/Board.tsx` — `on("navigate", "goto", ...)` listener calls `navigateTo()`
  - `electron/preload.ts` — exposes `focusWindow()` via contextBridge
  - `electron/main.ts` — `ipcMain.on("window:focus", ...)` handler

- **Auto-create vault directories on first run** — Hilt now ensures `lists/now/`, `briefings/`, `people/`, `projects/`, and `thoughts/` exist when the vault path is resolved. Seeds a starter weekly list if `lists/now/` is empty so Bridge works out of the box.

- **@mention pills in Bridge tasks** — Tasks ending with `@name` (e.g. `Set up repo @justin`) now show the name as a small capitalized pill badge next to the due date. The @mention is stripped from the editable title.

- **Folder-based local sources** — Local sources are now defined by a `folder` path instead of just a URL. The folder serves as both the Docs browsing root and Bridge vault path, eliminating the need for separate `HILT_WORKING_FOLDER` and `BRIDGE_VAULT_PATH` env vars.
  - `Source` type gains `folder?: string` field in `src/lib/types.ts`
  - DB CRUD (`addSource`, `updateSource`) accept `folder` parameter
  - API routes accept `folder` in POST/PATCH
  - `getActiveFolder()` helper reads active source's folder from sources.json
  - `getBridgeVaultPath()` falls back to active source folder before env vars
  - `getVaultPathSync()` in vault.ts reads from active source folder
  - `getBridgeWatcher()` accepts optional vault path override
  - Folders API returns `workingFolder` from active source config
  - Migration: `BRIDGE_VAULT_PATH`/`HILT_WORKING_FOLDER` env vars seed sources.json on first run

- **Electron multi-server orchestration** — Electron spawns one dev server per local source with folder, passing `HILT_WORKING_FOLDER` and `BRIDGE_VAULT_PATH` as env vars. Assigned ports written back to sources.json.
  - `ServerInstance` type tracks per-source server processes
  - `startServerForSource()` handles port allocation and process spawning
  - `readSourcesConfig()`/`writeSourcesConfig()` for Electron-side config access
  - Cleanup kills all source servers on quit

- **Native folder picker** — Electron IPC `dialog:selectFolder` opens macOS native directory dialog. Exposed via `window.electronAPI.selectFolder()`. Falls back to osascript-based picker in browser mode.

- **Type-aware source management UI** — SourceManageModal form shows folder picker for local sources, URL input for remote sources. Source rows show folder path (not URL) for local sources.

- **Enhanced onboarding** — Unconfigured state in SourceToggle shows "Choose folder..." as primary action with folder picker, plus secondary "Add as source" option.

- **Inline URL editing for remote sources** — Remote source URLs in the Manage Sources modal are now click-to-edit, matching the inline name editing pattern. Local sources retain the folder picker instead.

- **Port drift self-healing** — When the dev server starts on a different port (e.g. 3000 is taken), `useSource` detects the mismatch and auto-patches the local source's URL to match the actual origin.

- **Local sources always available** — Local sources skip availability probing (localhost resolves to the physical machine, not the remote context). Fixes false "offline" status when viewing from a remote machine.

- **Local source switching skip probe** — `switchTo()` skips the reachability probe for local sources, navigating directly. Fixes "Local not responding" error when switching to local from a remote machine.

- **Default URL for local sources** — `addSource()` defaults local source URLs to `http://localhost:3000` when no URL is provided (e.g. when created via folder picker). Fixes unclickable local sources with empty URLs.

- **Electron URL allowlist fix** — `getSourceUrls()` merges URLs from all candidate files (Electron DATA_DIR + project-local) using a Set instead of early-returning from first match. Fixes remote source URLs opening in default browser.

- **Multi-source configuration system** — Replace single-remote env var (`NEXT_PUBLIC_REMOTE_HOST`) with a flexible config-file-based system supporting multiple local and remote servers. Sources stored in `DATA_DIR/sources.json` with rank-ordered priority.
  - Types: `Source` interface in `src/lib/types.ts`
  - Persistence: `readSourcesFile`/`writeSourcesFile` + CRUD ops (`getSources`, `addSource`, `updateSource`, `deleteSource`, `reorderSources`) in `src/lib/db.ts`. Includes one-time migration from `NEXT_PUBLIC_REMOTE_HOST` env var.
  - API: `src/app/api/sources/route.ts` — GET (list), POST (add), PATCH (update/reorder), DELETE (remove)
  - Hook: `useSources()` in `src/hooks/useSource.ts` — full rewrite. Fetches sources from API, detects active source by URL match, polls availability of non-active sources, auto-fallback when remote goes down, CRUD wrappers.
  - Management modal: `src/components/SourceManageModal.tsx` — drag-and-drop reordering via @dnd-kit, inline name editing, type toggle, add form, delete
  - SourceToggle rewrite: Unconfigured state shows onboarding with quick-add; configured state shows dropdown with source list, availability dots, active checkmark, and "Manage Sources..." link. Smart hint when running at an unrecognized origin.
  - Electron: `electron/main.ts` — internal URL allowlist now reads from `sources.json` instead of hardcoded `NEXT_PUBLIC_REMOTE_HOST`
  - Default/fallback priority: configured rank order, skipping unavailable remote sources, then `localhost:3000`

- **People tab (Phase 1)** — New primary tab (⌘4) that surfaces people, groups, and meeting history from the bridge vault's `people/` and `meetings/` directories. Features: people list view with search filtering, person detail panel with inline notes and Granola meeting matching, responsive split-panel layout (desktop) and full-screen detail (mobile). Read-only in Phase 1.
  - Types: `BridgePerson`, `PersonMeeting`, `PersonDetail`, `BridgePeopleResponse` in `src/lib/types.ts`
  - Parser: `src/lib/bridge/people-parser.ts` — parses people index, person files, matches meetings by name tokenization
  - API: `GET /api/bridge/people` (list), `GET /api/bridge/people/[slug]` (detail)
  - Hooks: `useBridgePeople`, `usePersonDetail` with SWR + WebSocket live updates
  - Components: `PeopleView`, `PersonCard`, `PersonDetailPanel`, `MeetingEntry`
  - Watcher: Bridge watcher now monitors `people/` and `meetings/` directories
  - Routing: People added to ViewToggle, Board, NavBar, url-utils. Deep link URLs: `/people/amrit` navigates directly to a person's detail view with browser back/forward support.

- **People tab (Phase 2): Meeting card feed with tabbed artifacts** — Meetings now display as a feed of cards, one per entry (not merged by date). Each card shows up to three tabbed views: Written Notes, Summary, and Transcript. Written notes are shown by default when available and are editable in-place using the same tiptap editor as task details. Full Granola summary bodies shown (no truncation). No expand/collapse — cards always show full content.
  - Types: Added `personFilePath` to `PersonDetail` for save-back support
  - Parser: `updatePersonNotes()` in `people-parser.ts` — finds and replaces `### YYYY-MM-DD` sections in person files. Removed 200-char summary truncation.
  - API: New `PUT /api/bridge/people/[slug]/notes` — saves edited inline notes back to the person's `.md` file (atomic write)
  - UI: `MeetingEntry.tsx` redesigned as card with tab bar (Written Notes / Summary / Transcript). Single-source cards show content directly without tabs. Written notes use `BridgeTaskEditor` for rich editing.
  - Wiring: `PersonDetailPanel` passes `slug` and `vaultPath` to each card

- **People tab (Phase 3): Editing + rendering fixes** — Summary and Transcript tabs now render beautifully formatted markup via read-only tiptap instead of raw markdown text. Transcript tab loads content inline (lazy-fetched via `/api/docs/file`) instead of navigating away to the Docs view. Next Up section is now an editable tiptap editor — the primary pre-meeting planning surface.
  - Parser: `updatePersonNext()` in `people-parser.ts` — finds and replaces `## Next` section content
  - API: New `PUT /api/bridge/people/[slug]/next` — saves edited Next Up section back to the person's `.md` file (atomic write)
  - UI: `MeetingEntry.tsx` — Summary/Transcript tabs use `BridgeTaskEditor` with `readOnly={true}`. Transcript content lazy-loaded on tab selection. Removed `onNavigateToTranscript` prop.
  - UI: `PersonDetailPanel.tsx` — Next Up section replaced static bullet list with editable `BridgeTaskEditor`. Always visible (even when empty) to encourage pre-meeting planning.

- **People tab (Phase 4): Three-column email inbox layout** — Redesigned from two-column (list + detail) to three-column email-inbox layout: person list (w-56) | meeting feed (w-80) | meeting content (flex-1). Person list shows compact cards, middle column shows person header + Next editor + filterable meeting rows, right column shows selected meeting at full width. Auto-selects first meeting when a person is chosen. Mobile uses three-level stacked navigation (person list → meeting feed → meeting content) with back buttons.
  - New: `PersonMeetingList.tsx` — middle column component with person header, Next Up editor, filter bar, and scrollable meeting row list
  - New: `MeetingRow.tsx` — compact meeting list item with date, title, and source icon
  - Changed: `PersonCard.tsx` — added `compact` prop to hide next topic and tighten padding for left column
  - Rewritten: `PeopleView.tsx` — three-column flex layout orchestrator, owns all state (person selection, meeting filter, meeting selection)
  - Deleted: `PersonDetailPanel.tsx` — logic split between PersonMeetingList (header, next, filter, list) and PeopleView (state management, right column)

- **People tab (Phase 5): "Next" as meeting entry + date hierarchy flip** — Two changes: (1) Date is now the primary headline in both MeetingRow and MeetingEntry, with title as secondary subtext. (2) "Next" is no longer a separate editor section — it's a synthetic meeting entry pinned at position 0 in the feed. Clicking the calendar icon on Next commits its content as a dated meeting entry (moves to `## Notes ### YYYY-MM-DD`, clears `## Next`). A new empty Next appears when the last meeting is >1 day ago. Filters only affect historical meetings below Next. Auto-focus: clicking a person puts cursor in the topmost editable entry.
  - Types: Added `"next"` to `PersonMeeting.source` union
  - Parser: New `parseNextSection()`, `decayNext()`, `deletePersonNotes()` in `people-parser.ts`. `getPersonDetail()` auto-decays past-date Next entries on read (safety net for manually-added `date:` lines).
  - API: `PUT /api/bridge/people/[slug]/next` — accepts `content` (save) or `commit` (move to dated notes + clear). `PATCH /api/bridge/people/[slug]/notes` — change date of inline notes. `DELETE /api/bridge/people/[slug]/notes` — remove a dated section.
  - UI: `MeetingRow.tsx` — date is primary (`text-sm font-medium`), title is subtext (`text-xs text-tertiary`). Only written entries show NotebookPen icon. Fixed-height rows (`h-13`).
  - UI: `MeetingEntry.tsx` — date is primary (`text-base font-medium`), title is subtext (`text-xs text-secondary`). Next mode: "Next" + calendar icon (commits via hidden date picker), editor, no tabs. Three-dot menu: delete for inline/next, change date for inline. Delete confirmation bar matches task detail pattern. Auto-focus editor via polling for dynamically-loaded tiptap.
  - UI: `PersonMeetingList.tsx` — removed standalone "Next Up" editor section. Receives `displayMeetings` (Next + filtered historical). Fixed-height headers (`h-16`, `h-10`) aligned with detail pane.
  - UI: `PeopleView.tsx` — builds synthetic Next entry when last meeting > 1 day ago or no meetings. Constructs `displayMeetings` array: `[nextEntry, ...filteredMeetings]`. Auto-focuses topmost editable entry on person select.

### Changed

- **Externalize configuration for public sharing** - Moved all hardcoded personal values (working folder, remote hostname) to environment variables loaded from `.env`. Added `.env.example` with documented configuration options. Electron main process now loads `.env` at startup so remote access works correctly in the desktop app. Scrubbed personal paths from source code comments and documentation examples.
  - Files: `src/lib/db.ts`, `src/hooks/useSource.ts`, `electron/main.ts`

### Fixed

- **Bridge→Docs navigation: index.md not selected** — When navigating from a Bridge task's project card to Docs, the target folder expanded correctly but `index.md` was not auto-selected (content pane showed "Select a file to view"). Root cause: useDocs had a "re-initialize selectedPath from URL" effect using a boolean `scopeInitRef` to skip the initial mount. In React Strict Mode's unmount/remount cycle, the ref got flipped to `false` on the first mount and was never reset, causing the second mount to read the URL (which has no `?doc=` param for index files) and set `selectedPath` to `null` — overwriting the focusedPath effect's correct selection. Fix: replaced the boolean flag with a value comparison (`prevScopeRef`) that survives strict mode.
- **Bridge→Docs navigation: nested folder expansion** — When navigating to deeply nested projects (e.g., `libraries/everpro/projects/alamo-custom-reports`), parent folders sometimes didn't expand. Multiple individual `expandPath()` calls could compete with useDocs' scope-sync effect. Fix: added `expandPaths(paths[])` batch function that expands all parent folders in a single atomic state update.
- **Bridge→Docs navigation: folder-as-file error** — Clicking a project link that points to a folder (not a file) caused a "path must be a file, not a directory" error. Fix: added `findNodeByPath` helper to the focusedPath effect that detects directory nodes, expands them, and auto-selects `index.md` if available.

### Removed

- **Scope-switching UI** — Scope now permanently equals the working folder. Removed bottom toolbar (breadcrumbs, browse button, recent scopes, pinned folders popover) and mobile scope header. The URL path after `/docs/` now represents the selected file for deep linking, not the tree root. Deleted 14 dead code files: scope/ components (ScopeBreadcrumbs, SubfolderDropdown, BrowseButton, RecentScopesButton, PinnedFoldersPopover), sidebar/ components (Sidebar, PinnedFolderItem, SortablePinnedFolderItem, SidebarSection, SidebarToggle), recent-scopes.ts, pinned-folders.ts, usePinnedFolders.ts.

### Added

- **MIT LICENSE file** - Added formal license file to match README declaration.
- **`.env.example`** - Template documenting required and optional configuration variables (`HILT_WORKING_FOLDER`, `BRIDGE_VAULT_PATH`, `NEXT_PUBLIC_REMOTE_HOST`).
- **README Configuration section** - Setup instructions for copying `.env.example` and configuring environment variables.
- **README screenshots** - Added Briefing, Bridge, and Docs view screenshots using demo content.
- **README folder structure** - Documented expected folder layout for briefings, weekly lists, projects, thoughts, libraries, and meta.
- **README philosophy** - Updated intro to describe Hilt as a shared human-agent context space. Added note about agent protocols.

## [3.0.0] - 2026-02-17

Adds the Briefing tab as a new primary view, plus collapsible docs sidebar, vault-relative wikilinks, code block copy buttons, and numerous docs/bridge improvements.

### Added

- **Collapsible docs sidebar** - Unified sidebar layout replaces separate mobile/desktop implementations. Desktop: sidebar slides out to the left when collapsed, content expands to fill; state persisted to localStorage. Mobile: sidebar overlays as a drawer from the left with backdrop; selecting a file auto-closes it. Toggle button (PanelLeftOpen/Close icons) in content header works on both form factors. Navigation intent is respected: navigating from bridge/briefings closes sidebar on mobile (shows content immediately); switching to Docs tab opens it.
  - Files: `src/components/DocsView.tsx`, `src/components/docs/DocsContentPane.tsx`

- **Code block copy button** - Markdown code blocks in read mode show a copy-to-clipboard button on hover (top-right corner). Language dropdown and delete button are hidden in read mode. Uses MutationObserver to handle CodeMirror's async rendering.
  - Files: `src/components/docs/DocsEditor.tsx`, `src/app/globals.css`

### Fixed

- **Vault-relative wikilinks not resolving** - Obsidian-style wikilinks like `[[libraries/everpro/...]]` (no `./` or `../` prefix) couldn't resolve when scoped to a subdirectory because the client-side resolver only searched within the current scope's file tree. Added server-side `/api/docs/resolve-links` endpoint that walks up ancestor directories to find matches. DocsEditor now async-resolves unresolved vault-relative links on file load. Cross-scope navigation also handled: clicking a resolved link outside the current scope changes the scope to the file's parent directory.
  - Files: `src/lib/docs/wikilink-resolver.ts`, `src/app/api/docs/resolve-links/route.ts`, `src/components/docs/DocsEditor.tsx`, `src/components/DocsView.tsx`

- **Page refresh resets to bridge folder** - Two issues: (1) Board's initial-load effect unconditionally set the scope to `workingFolder`, ignoring the scope already parsed from the URL — now only applies the default when URL has no scope. (2) ScopeContext's mount-time `replaceState` rebuilt the URL from view+scope, stripping the `?doc=` query param — now preserves existing query params.
  - Files: `src/components/Board.tsx`, `src/contexts/ScopeContext.tsx`

### Changed

- **Updated app icons** - Electron mac app icon now uses latest dagger art (was stale from Jan build). Favicon updated to transparent-background dagger emoji (no dark gradient).
  - Files: `build/icon.icns`, `src/app/favicon.ico`, `public/favicon.ico`

### Fixed

- **Electron app black screen on launch** - Dev server port detection (`checkDevServer`) accepted any HTTP response with status < 500, so it mistakenly connected to the WebSocket server (ports 3001/3002) instead of Next.js. Fixed by requiring a 2xx response with `text/html` content-type.
  - File: `electron/main.ts`

- **Relative images not rendering in markdown** - Standard markdown images with relative paths (e.g., `![alt](file.png)`) were broken because the browser tried to load them from the app root. Read mode rewrites paths during markdown processing; edit mode uses MDXEditor's `imagePreviewHandler` to resolve paths for display without modifying the underlying markdown.
  - File: `src/components/docs/DocsEditor.tsx`

- **Gray rectangles below images in edit mode** - Lexical's decorator `<span>` is `display: inline` with a background color, so its line-height creates a visible strip below inline-block image wrappers. Fixed by making the decorator transparent with zero line-height.
  - File: `src/app/globals.css`

- **Mobile bottom sheet too short** - Increased task detail bottom sheet maxHeight from 70vh to 85vh so "Add details" and delete dropdown are fully reachable.
  - File: `src/components/bridge/BridgeView.tsx`

- **Browser zoom on input focus** - Added viewport meta with `maximum-scale=1, user-scalable=no` to prevent iOS Safari from zooming when tapping text fields.
  - File: `src/app/layout.tsx`

### Added

- **Bridge tab search filtering** - The NavBar search box now filters Bridge content live. Tasks filter by title and detail lines, notes section hides when content doesn't match, projects filter by title, area, tags, and index.md body content. Shows "No matching items" when everything is filtered out.
  - Files: `src/lib/types.ts`, `src/lib/bridge/project-parser.ts`, `src/components/Board.tsx`, `src/components/bridge/BridgeView.tsx`

- **Local/Remote source toggle** - Toolbar dropdown (next to theme toggle) to switch between local and remote Hilt instances. Detects current source via hostname, passes return URL via `?from=` param, persists local URL in localStorage for return navigation.
  - Files: `src/hooks/useSource.ts` (new), `src/components/SourceToggle.tsx` (new), `src/components/NavBar.tsx`

- **Per-folder sort order toggle (A-Z vs Recent)** - Docs file tree folders now have a three-dot menu to toggle between alphabetical (default) and "sort by recent" (descending modTime). Preference persists per scope in localStorage. Menu icon appears on hover (desktop) or always visible (mobile).
  - Files: `src/hooks/useDocs.ts`, `src/components/docs/DocsFileTree.tsx`, `src/components/docs/DocsTreeItem.tsx`, `src/components/DocsView.tsx`

- **Add task button in top toolbar** - "+" button on the right side of the toolbar creates a new Bridge task. If not already on Bridge tab, switches to it first, then adds the task. Auto-focuses title in the detail panel with select-all so typing immediately replaces "New task". Enter/Tab moves focus to the details editor.
  - Files: `src/components/Board.tsx`, `src/components/bridge/BridgeView.tsx`, `src/components/bridge/BridgeTaskPanel.tsx`

### Changed

- **Removed inline Add button from Bridge task list** - The toolbar Add button is now the single entry point for creating tasks. Removed the duplicate Add button next to the "Tasks" heading and the associated `autoFocus` logic from `BridgeTaskItem`.
  - Files: `src/components/bridge/BridgeTaskList.tsx`, `src/components/bridge/BridgeTaskItem.tsx`

### Fixed

- **Bridge notes not saving** - Fixed stale closure bug where the `onChange` callback in `BridgeTaskEditor` was captured in TipTap's initial config and never updated. Added `onChangeRef` to keep the callback current, matching the existing pattern for `vaultPathRef` and `filePathRef`.
  - File: `src/components/bridge/BridgeTaskEditor.tsx`

- **Clickable links in task notes** - Links in Bridge task notes are now clickable. TipTap Link extension changed from `openOnClick: false` to `openOnClick: true` with `target="_blank"`. URLs open in external browser.
  - File: `src/components/bridge/BridgeTaskEditor.tsx`

### Changed

- **Project status "thinking" renamed to "considering"** - Better reflects the deliberative nature of the initial project stage. Updated across all files: project parser, board columns, picker restore options.
  - Files: `src/lib/bridge/project-parser.ts`, `src/components/bridge/ProjectBoard.tsx`, `src/components/bridge/ProjectPicker.tsx`, `src/components/bridge/ProjectCard.tsx`, `src/app/api/bridge/projects/status/route.ts`

- **URL-based view mode routing** - Active view (bridge/docs/stack) is now encoded as the first URL path segment. Browser Back/Forward naturally switches between views. URL structure: `/docs/Users/you/work/project`, `/bridge`, `/stack/Users/you/work/project`. Legacy URLs without prefix are resolved from server prefs via `replaceState`.
  - Files: `src/lib/url-utils.ts` (new), `src/app/[[...path]]/page.tsx`, `src/contexts/ScopeContext.tsx`, `src/components/Board.tsx`, `src/hooks/useDocs.ts`, `src/components/DocsView.tsx`
  - Added `navigateTo(mode, scope)` to ScopeContext for atomic view+scope changes (single history entry)
  - Fixed double-push on Bridge→Docs project navigation: `navigateTo` replaces separate `setScopePath`+`setViewMode` calls
  - Fixed `useDocs` auto-selection pushing extra history entries: `setSelectedPath` now accepts `{ replace: true }` for auto-selections (initial file, root index.md)
  - Removed: `pushViewState`, `onViewRestore`, `HistoryState` type, `viewRestoreListeners` — all replaced by URL-based routing through `viewMode`/`setViewMode`/`replaceViewMode`/`navigateTo` on `ScopeContext`
  - Added Cmd+[/Cmd+] keyboard shortcuts and trackpad swipe gestures for back/forward in Electron (`electron/main.ts`). Uses `executeJavaScript("window.history.back()")` for SPA-style popstate navigation instead of `webContents.goBack()` which would trigger full page loads.

---

## [2.1.0] - 2026-02-05

Remove Sessions tab and all session-related code. Hilt now focuses on three views: Bridge, Docs, and Stack.

### Removed

- **Sessions tab** — Kanban board, tree view, and all session management UI
  - Deleted components: `Column`, `SessionCard`, `InboxCard`, `NewDraftCard`, `QuickAddButton`, `QuickAddModal`, `RalphSetupModal`, `Terminal`, `TerminalDrawer`, `TreeView`, `TreeNodeCard`, `TreeSessionCard`
  - Deleted hooks: `useSessions`, `useTreeSessions`, `useInboxPath`
  - Deleted lib: `claude-sessions`, `session-status`, `session-cache`, `tree-utils`, `treemap-layout`, `heat-score`, `ralph`, `ralph-server`, `pty-manager`
  - Deleted API routes: `/api/sessions`, `/api/ralph`, `/api/suggest-destination`
  - Deleted server watcher: `session-watcher`
  - Deleted tests: `session-status.test.ts`

- **Terminal integration** — PTY management, xterm.js rendering, and Electron IPC PTY handlers
  - Removed `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` dependencies
  - Removed `@electron/rebuild` dev dependency and rebuild scripts
  - Cleaned `electron/main.ts` and `electron/preload.ts` of all PTY code
  - Removed `node-pty` webpack external from `next.config.ts`

- **Ralph Wiggum integration** — Iterative AI development loop feature

### Changed

- **ViewToggle** — Removed "Sessions" option; only Bridge, Docs, Stack remain
- **Board.tsx** — Stripped all session view logic, session state, and session-related imports
- **Sidebar** — Removed `needsAttention` indicators
- **ws-server.ts** — Removed SessionWatcher and PTY WebSocket handlers
- **electron/types.d.ts** — Rewritten to match new preload API (plan events + startup only)
- **`ProjectKanban` renamed to `ProjectBoard`** — Consistent with app's "Board" naming convention
- **Dead code cleanup** — Removed unused `PinnedFolderItem` component
- **Stale references** — Updated "sessions" language in SubfolderDropdown, LiveIndicator, folders API, url-utils, and test files
- All documentation rewritten: README, ARCHITECTURE, API, COMPONENTS, DATA-MODELS, DEVELOPMENT

### Changed (previous)

- **Self-contained one-click dev app** - `Hilt.app` now launches Electron directly, which starts all dev servers (Next.js + WS/event server) as child processes. No more Terminal.app window opening via `osascript`. Electron manages the full lifecycle: startup, port discovery, and cleanup on quit.
  - `electron/main.ts`: Added `startWsServer()` to spawn WS server alongside Next.js in dev mode, with log output to `userData/logs/ws-server.log` and cleanup in `window-all-closed`/`before-quit` handlers
  - `scripts/create-dev-app.sh`: Removed `check_server()`, `find_port()`, port scanning, `osascript` Terminal.app launch, and `HILT_DEV_PORT` env var. Launcher now just sets up nvm PATH and `exec`s Electron directly

### Added

- **Project status management** - Projects can be moved between board columns (considering/refining/doing/done) via a three-dot menu on each project card. Status is persisted to frontmatter in each project's `index.md`. Done projects are hidden from the board. The project picker shows done projects in a separate view with restore-to-column functionality.
  - Files: `src/lib/bridge/project-parser.ts`, `src/app/api/bridge/projects/status/route.ts` (new), `src/hooks/useBridgeProjects.ts`, `src/components/bridge/ProjectCard.tsx`, `src/components/bridge/ProjectBoard.tsx`, `src/components/bridge/ProjectPicker.tsx`

- **Expanded project discovery** - Project parser now scans both `projects/` and `libraries/*/projects/` folders. Projects without `index.md` or frontmatter are included with sensible defaults (folder name as title, "considering" as status). Projects are grouped by source folder in the picker (e.g., "Projects", "EverPro").
  - Files: `src/lib/bridge/project-parser.ts`, `src/lib/types.ts` (`source` and `relativePath` added to `BridgeProject`), `src/components/bridge/ProjectPicker.tsx`

- **Project linking for Bridge tasks** - Tasks can be linked to a project folder. The link is stored as a standard markdown link in the task title: `- [ ] [Task Title](projects/slug)`. The parser extracts display text and project path. A project card is pinned above the editor in the task detail panel showing project title, area badge, and path. A three-dot menu opens a picker popover to attach/change/detach projects. Clicking the card navigates to the project in Docs view.
  - Files: `src/lib/types.ts`, `src/lib/bridge/weekly-parser.ts`, `src/app/api/bridge/tasks/[id]/route.ts`, `src/hooks/useBridgeWeekly.ts`, `src/components/bridge/BridgeTaskPanel.tsx`, `src/components/bridge/ProjectPicker.tsx` (new), `src/components/bridge/BridgeView.tsx`

- **Task panel UI simplification** - Removed edit/preview toggle (editor is always editable). Replaced action buttons with a three-dot menu containing project and delete actions. Close button replaced with an invisible full-height clickable strip on the left border using `cursor-e-resize` to indicate retractability.
  - Files: `src/components/bridge/BridgeTaskPanel.tsx`

- **Drag-and-drop file upload in Bridge editor** - Drop or paste any file into Bridge task/notes editors. Images and videos embed inline (as markdown image syntax); other files (PDFs, zips, etc.) insert as linked filenames. All files upload to `media/` alongside the weekly file and save as relative paths. Image nodes are `atom: true` for proper click-to-select with a focus-only selection ring.
  - Files: `src/app/api/bridge/upload/route.ts` (new), `src/components/bridge/BridgeTaskEditor.tsx`, `src/app/globals.css`

- **`workingFolder` preference** - New user preference that sets the default scope for Docs, Stack, and Sessions views on initial load (when no localStorage scope exists). Set in `data/preferences.json` as `"workingFolder": "/path/to/folder"`. Falls back to home directory when not configured.
  - Files: `src/lib/db.ts`, `src/app/api/folders/route.ts`, `src/components/Board.tsx`

- **Bridge view** - Weekly task management and project board integrated as a new view mode
  - Weekly tasks with drag-and-drop reordering, inline title editing, checkbox toggling
  - Side panel for task details with full markdown editing
  - Inline editable notes section (zero-padding, borderless — just text on the page)
  - Project board with four columns: considering, refining, doing
  - Clicking a project card opens its folder in the docs viewer with bridge as scope, project folder expanded, and index.md selected
  - Real-time updates via WebSocket events
  - Files: `src/components/bridge/*`, `src/hooks/useBridgeWeekly.ts`, `src/hooks/useBridgeProjects.ts`, `src/lib/bridge/*`, `src/app/api/bridge/*`

- **DocsView initial file navigation** - New `initialFilePath` prop allows programmatic navigation to a specific file on view switch, expanding all parent folders in the tree
  - Files: `src/components/DocsView.tsx`

- **Bridge rich media & Notion-like editing** - Extended BridgeTaskEditor with inline images, tables, task lists, and more
  - Image/video rendering: wikilinks (`![[file]]`) and relative paths converted to API URLs on read, normalized to standard markdown on save
  - Video observer: `<img>` with `.mp4/.webm/.mov/.ogg` src auto-replaced with `<video controls>`
  - New extensions: Image, Table, TaskList/TaskItem, Placeholder, Typography
  - MutationObserver video replacement restricted to read-only mode to prevent ProseMirror DOM corruption
  - `vaultPath`/`filePath` props threaded from BridgeView → BridgeTaskPanel/BridgeNotes → BridgeTaskEditor
  - CSS for task list checkboxes, tables, and placeholder text
  - Files: `BridgeTaskEditor.tsx`, `BridgeView.tsx`, `BridgeTaskPanel.tsx`, `BridgeNotes.tsx`, `globals.css`

### Fixed

- **Enter key in tiptap editors** - Pressing Enter at the end of a bullet list now immediately creates a new list item
  - Removed trailing empty list item stripping from `cleanOutput` and `normalizeMd` — was silently reverting the user's new lines
  - Removed trailing blank line stripping from `rebuildContent` — was discarding new content when writing task details to disk
  - Added focus guard to sync `useEffect` — prevents SWR re-fetch from overwriting editor while user is actively editing
  - Files: `BridgeTaskEditor.tsx`, `weekly-parser.ts`

### Changed

- **Bridge editors: MDXEditor → Tiptap** - Replaced MDXEditor with Tiptap for task detail and notes editing in Bridge view
  - New `BridgeTaskEditor` component using StarterKit + Link + tiptap-markdown extensions
  - Wikilink escaping fix: `unescapeWikilinks()` restores `![[file]]` syntax that tiptap-markdown escapes
  - Round-trip stability: normalized comparison prevents spurious saves from tiptap-markdown whitespace differences
  - Trailing node fix: CSS hides ProseMirror's trailing `<p>` and empty `<li>` artifacts to prevent layout shift
  - Weekly parser: `rebuildContent` preserves trailing lines in task rawLines (stripping was preventing Enter key from working)
  - Files: `src/components/bridge/BridgeTaskEditor.tsx` (new), `BridgeTaskPanel.tsx`, `BridgeNotes.tsx`, `src/lib/bridge/weekly-parser.ts`, `src/app/globals.css`

- **Task card click-to-open** - Clicking anywhere on a task card opens the detail panel; text input click still edits title
  - Auto-sizing title input uses inline-grid trick to match text width
  - File: `src/components/bridge/BridgeTaskItem.tsx`

- **Docs editor line height** - Reduced from `1.75` (prose default) to `1.5` (`leading-normal`) to match Obsidian's tighter spacing
  - File: `src/components/docs/DocsEditor.tsx`

- **Compact editor padding** - `.docs-editor-compact` wrapper now strips all padding from both MDXEditor wrapper and contenteditable elements
  - File: `src/app/globals.css`

### Changed

- **Hilt-only session tracking** - Replaced bulk JSONL scanning (3,789 files / 1.4GB) with a Hilt-owned session registry
  - New `data/sessions.json` as single source of truth — replaces both `claude-sessions.ts` scanning and `session-status.json`
  - Sessions registered at creation time via `POST /api/sessions`
  - Startup is now a single JSON file read instead of scanning all JSONL files
  - Running/active sessions still read individual JSONL for derived state (targeted reads, not bulk scan)
  - Temp→real session ID resolution via `PATCH /api/sessions { sessionId, realId }`
  - Session watcher narrowed to only watch registered session files
  - Removed `getSessions()`, `parseSessionFile()`, `getRunningSessionIds()`, `watchSessions()`, `isSessionRunning()`, `getSessionMtime()`, `getSessionById()` from `claude-sessions.ts`
  - Stripped `session-cache.ts` to only planned slugs caching
  - Removed legacy status storage functions from `db.ts`
  - Stale temp sessions (`new-*` entries > 5 min old) purged on startup

- **Electron dev launcher redesign** - Server management now handled entirely by Electron main process
  - **No more Terminal.app** - Dev server runs as background child process instead of opening a visible Terminal window
  - **Single app experience** - Only the Electron app appears in dock/cmd-tab, no separate Terminal
  - **Auto-cleanup** - Server automatically terminates when app quits (child process dies with parent)
  - **Warm start support** - Detects existing dev server on ports 3000-3004 and connects to it instead of starting a new one
  - **Logs available** - Server output written to `~/Library/Application Support/Electron/logs/dev-server.log`
  - Files modified: `electron/main.ts`, `scripts/create-dev-app.sh`, `dist/Hilt.app/Contents/MacOS/launcher`

### Fixed

- **Wikilinks broken in markdown tables** - Fixed escaped pipe characters causing link resolution failures
  - Root cause: Wikilinks in markdown tables use `\|` to escape the pipe separator, but the regex captured the trailing backslash as part of the target path (e.g., `index\` instead of `index`)
  - Fix: Strip trailing backslash from captured target in `parseWikilinks()` before resolution
  - File modified: `src/lib/docs/wikilink-resolver.ts`

- **Terminal not loading in Electron app** - Fixed race condition where React component remounting caused double PTY spawns
  - Root cause: Terminal component unmount/remount triggered two rapid spawn calls; second spawn killed the first before initialization
  - Added 500ms debounce window for spawn requests with same terminalId - returns existing terminal instead of killing/re-creating
  - Fix applied to both development (`src/lib/pty-manager.ts`) and production (`electron/main.ts`) PtyManager implementations
  - Files modified: `src/lib/pty-manager.ts`, `electron/main.ts`

- **Port conflicts in Electron dev mode** - Added dynamic port detection script
  - New `scripts/electron-dev.sh` finds an available port before starting Next.js and Electron
  - Eliminates conflicts when running both browser and Electron dev modes simultaneously
  - Environment variable `CLAUDE_KANBAN_DEV_PORT` communicates port to Electron main process
  - Files added: `scripts/electron-dev.sh`
  - Files modified: `package.json` (`electron:dev` script)

### Added

- **Startup Loading Screen** - Technical progress display during app initialization
  - **Progress bar** with overall percentage
  - **Activity list** with circular progress rings for each task:
    - Green checkmark ring when complete
    - Spinning blue ring when active/loading
    - Faded gray ring outline when pending
  - **Verbose details** - Shows specifics like "(viewMode: board)" for preferences, session counts when loaded
  - **Smooth transition** - 300ms fade-out when loading completes
  - **Error handling** - Fatal errors block the app with retry button
  - **Electron integration** - Shows server startup activities (checking for dev server, starting server, loading modules, creating window)
  - **Web mode** - Skips server phase, shows only data loading activities; instant if server is warm
  - **State machine architecture** - StartupContext manages phases: server → bootstrap → data → complete
  - Files: `src/contexts/StartupContext.tsx` (new), `src/components/StartupScreen.tsx` (new)
  - Modified: `src/app/layout.tsx`, `src/components/Board.tsx`, `electron/main.ts`, `electron/preload.ts`

- **Global Inbox System** - Quick capture workflow with two-step modal for tasks from anywhere in the app
  - **Quick Add button** in sidebar footer opens capture modal
  - **Keyboard shortcut**: `Cmd/Ctrl+I` opens Quick Add from anywhere
  - **Two-step flow**: First capture your idea, then choose destination
  - **Smart suggestions**: Matches task text against pinned folder names and CLAUDE.md content
  - **Inbox folder**: Set a default destination for quick captures (persists in preferences)
  - **Destination options**: Inbox (default), Suggested matches, Pinned folders, or Browse for any folder
  - **Draft persistence**: Auto-saves to localStorage while typing, survives modal dismiss
  - **Action buttons**: Save (to Todo.md), Run, Refine, or Process Reference
  - **Navigation**: After action, navigates to destination folder to see task in context
  - Files: `src/components/QuickAddButton.tsx`, `src/components/QuickAddModal.tsx`, `src/hooks/useInboxPath.ts`, `src/app/api/suggest-destination/route.ts`
  - Modified: `src/lib/db.ts`, `src/app/api/preferences/route.ts`, `src/components/sidebar/Sidebar.tsx`, `src/components/Board.tsx`

- **MCP Server Display in Stack View** - Full visibility and control of MCP servers
  - MCP servers now appear in StackFileTree grouped by layer (user/project)
  - New `MCPServerDetail` panel shows complete server info: description, connection type, command/URL, env vars
  - Plugin metadata displayed: author, version, license, homepage, repository, keywords
  - Enable/disable toggle for plugin-based MCP servers (updates `~/.claude/settings.json`)
  - Edit JSON config for user-defined servers (non-plugin) with Save/Cancel UI
  - Enabled/disabled status shown as colored dot indicator in tree view
  - Filter by MCP type to see only MCP servers
  - Discovers servers from: `~/.claude/.mcp.json`, project `.mcp.json`, and plugin system
  - Fixed duplication bug when scope is home directory (both user and project discovery read same file)
  - Files: `src/lib/claude-config/mcp-discovery.ts` (new), `src/components/stack/MCPServerDetail.tsx` (new), `src/app/api/claude-stack/mcp/route.ts` (new)
  - Modified: `types.ts`, `discovery.ts`, `StackFileTree.tsx`, `StackView.tsx`

- **Plugin Display in Stack View** - First-class plugin support in Stack view
  - Plugins appear nested within their scope layer (user/project), not in a separate section
  - **Collapsible plugin containers** - Plugins with children (MCP servers, skills, agents) are collapsible
    - Expanded by default for browsing, can collapse to reduce visual clutter
    - Chevron indicator shows expand/collapse state
  - **Nested MCP servers** - MCP servers from plugins appear nested under their parent plugin
    - Plugin-origin servers no longer appear at the top level with standalone servers
    - Clicking a nested MCP server still opens the full MCPServerDetail panel
  - **Nested skills and agents** - Skills and agents from plugins appear nested under their parent plugin
    - Skills show with rose Sparkles icon
    - Agents show with orange Bot icon and category:name format (e.g., `review:dhh-rails-reviewer`)
  - **Filter counts include plugin children** - Skills and Agents filter counts now include items from plugins
  - New `PluginDetail` panel shows complete plugin info: description, version, author, install path
  - Lists MCP servers, skills, and agents provided by plugin (also visible in tree view nested under plugin)
  - Enable/disable toggle updates `~/.claude/settings.json` enabledPlugins
  - Shows installation metadata: installedAt, lastUpdated, gitCommitSha
  - Links to homepage and repository
  - Filter by plugins type to see only plugins (across all layers)
  - Search filters plugins by name
  - Files: `src/lib/claude-config/plugin-discovery.ts` (new), `src/components/stack/PluginDetail.tsx` (new)
  - Modified: `types.ts`, `discovery.ts`, `StackFileTree.tsx`, `StackSummary.tsx`, `StackView.tsx`

- **MCP Auth Status Display** - OAuth authentication status visibility
  - Auth status indicator (colored dot) shown next to MCP servers in tree view
  - Blue dot = authenticated, yellow = token expired (will auto-refresh), red = needs re-auth, gray = not configured
  - Servers that don't require auth show no indicator
  - New "Authentication" section in MCPServerDetail with detailed status
  - Shows token expiration time for authenticated servers
  - Helpful guidance messages for each auth state
  - Reads OAuth credentials from `~/.claude/.credentials.json`
  - Credential matching supports various formats: plugin:server:name|hash, server|hash, etc.
  - Modified: `mcp-discovery.ts` (enrichWithAuthStatus), `StackFileTree.tsx` (getAuthIndicator), `MCPServerDetail.tsx`, `types.ts` (AuthStatus type)

- **Ralph Wiggum Integration** - New run method for inbox items enabling iterative AI development loops
  - New button on inbox cards (RefreshCw icon) opens Ralph setup wizard
  - Multi-step modal guides users through PRD creation or direct configuration
  - Plugin detection API (`/api/ralph`) checks if Ralph Wiggum plugin is installed
  - Configuration UI for max iterations and completion promise
  - PRD refinement flow helps create structured requirements with testable success criteria
  - Session cards show Ralph emoji with iteration progress (e.g., "3/10") during active loops
  - Terminal output parsing detects iteration changes and loop completion
  - WebSocket events broadcast Ralph progress to all connected clients
  - Files: `src/lib/ralph.ts`, `src/components/RalphSetupModal.tsx`, `src/app/api/ralph/route.ts`, `src/lib/types.ts`
  - Modified: `Board.tsx`, `Column.tsx`, `InboxCard.tsx`, `SessionCard.tsx`, `Terminal.tsx`, `server/ws-server.ts`

- **Custom emoji for pinned folders** - Click the folder icon to set a custom emoji
  - Emoji replaces the folder icon in the sidebar
  - Use native OS emoji picker (⌘⌃Space on macOS) or type/paste directly
  - Emoji persists across unpin/re-pin (stored separately by path in `folderEmojis`)
  - Files: `src/components/sidebar/SortablePinnedFolderItem.tsx`, `src/lib/db.ts`, `src/hooks/usePinnedFolders.ts`

- **One-command install script** - `./install.sh` handles full setup
  - Checks Node.js ≥18.18 and build tools (Xcode CLI / build-essential)
  - Installs dependencies with proper env vars for node-pty compilation
  - Creates `~/.hilt/data` directory
  - Optionally adds `hilt` shell alias to .zshrc/.bashrc
  - Files: `install.sh`, `.nvmrc`, `README.md` (Quick Install + Troubleshooting sections)

- **Hidden macOS system folders in file browser** - Prevent file descriptor exhaustion and reduce clutter
  - macOS home folders completely hidden: Applications, Library, Movies, Music, Pictures, Downloads, Documents, Desktop, Public
  - Cloud sync folders use **partial matching** (case-insensitive) to catch variations:
    - OneDrive, Google Drive, My Drive, Creative Cloud, Dropbox, iCloud Drive, Box Sync
    - Examples: "My Drive (user@email.com)", "Priceless Misc Dropbox", "Creative Cloud Files Company Account"
  - Both docs tree API and scope watcher skip these entirely (prevents EMFILE errors, faster tree loading)
  - Files: `src/app/api/docs/tree/route.ts`, `server/watchers/scope-watcher.ts`

### Changed

- **Wider resizable Stack sidebar** - Better readability for long plugin/skill names
  - Default width increased from 280px to 360px
  - Max width increased from 500px to 600px
  - Files: `src/components/stack/StackView.tsx`

- **Ralph setup skips plugin check** - Modal now goes directly to configuration step
  - Removed the initial plugin detection check that blocked users
  - The Claude CLI handles plugin installation prompts if needed
  - Simplified modal flow: opens straight to "config" step instead of "check" step
  - Files: `src/components/RalphSetupModal.tsx`

- **App Rename: Claude Kanban → Hilt** - Complete rebrand of the application
  - Package name: `claude-kanban` → `hilt`
  - App ID: `com.claude-kanban.app` → `com.hilt.app`
  - Product name: `Claude Kanban` → `Hilt`
  - Infrastructure files: `.claude-kanban-ws-port` → `.hilt-ws-port`, `.claude-kanban-server.lock` → `.hilt-server.lock`
  - localStorage keys: `claude-kanban-*` → `hilt-*`
  - Favicon/icon: 🧱 (brick) → 🗡️ (dagger)
  - All documentation updated with new branding
  - **Note**: Existing localStorage preferences will reset after this update

- **README updated for public audience** - Restructured to explain core concepts (Tasks/Docs/Stack views)
  - Added "Core Concepts" section explaining the three primary views
  - Reorganized features by view type for better discoverability
  - Updated from outdated "Three-Column Board" to current "Four Columns"
  - Documented Docs View and Stack View features
  - File: `README.md`

- **TaskViewModeToggle simplified** - Changed from toggle UI to single button
  - Icon shows target mode (what you'll switch TO), not current mode
  - Uses `Columns3` for board icon, `Network` for tree icon
  - More compact inline with search/filter controls
  - File: `src/components/ViewToggle.tsx`

- **Stack content viewers simplified** - Removed Parsed Metadata section from JSON files
  - JSON files now show only CodeViewer (no redundant parsed view)
  - Shell files (.sh) and other non-markdown files use CodeViewer
  - Only markdown files use DocsEditor
  - File: `src/components/stack/StackContentPane.tsx`

- **View toggle restructured** - Simplified from 4 equal views to hierarchical structure
  - **Primary toggle**: Tasks | Docs | Stack (conceptual categories)
  - **Secondary toggle**: Board | Tree (task view modes, only shown in Tasks)
  - Filter dropdown only shown in Tasks mode
  - Secondary toggle is compact (icon-only) to fit inline with search/filter
  - Switching to Tasks preserves last used view mode (board/tree)
  - Files: `src/components/ViewToggle.tsx`, `src/components/Board.tsx`

- **Development startup simplified** - `npm run dev:all` now starts all three servers (Next.js, WebSocket, Event)
  - Added `event-server` npm script for the real-time event server
  - Updated `dev:all` to run all servers concurrently
  - Updated README.md, DEVELOPMENT.md, ARCHITECTURE.md to reflect this as the standard dev workflow
  - File: `package.json`

- **Stack View search** - Search box now filters files in Stack sidebar
  - Filters file names across all layers (like Docs mode)
  - Summary/filter-by-type section remains unaffected by search
  - Filter button hidden in Stack mode (like Docs mode)
  - Files: `src/components/Board.tsx`, `src/components/stack/StackView.tsx`, `src/components/stack/StackFileTree.tsx`

### Fixed

- **Search visible in all modes** - Search box now appears in Tasks, Docs, and Stack views
  - Previously was hidden in Docs and Stack modes
  - Filters sessions in Tasks, files/folders in Docs, config files in Stack
  - Live filtering as you type
  - File: `src/components/Board.tsx`

- **Stack viewer error message** - Improved messaging when no configuration is available
  - Shows "Select a project folder to view configuration" when no scope is selected
  - Shows "No configuration available" for empty stacks (e.g., system level)
  - Only shows "Failed to load configuration" for actual API errors
  - File: `src/components/stack/StackView.tsx`

- **Default scope at root URL** - App now defaults to home folder instead of system/root
  - When visiting root URL (`localhost:3000`), automatically redirects to home folder
  - Invalid scope paths also redirect to home folder instead of root
  - File: `src/components/Board.tsx`

- **Sidebar pin icon behavior** - Pin icon now properly spaced and clickable when collapsed
  - Spacing from top matches bottom icons (consistent padding)
  - Clicking pin icon when collapsed now expands the sidebar
  - Added `onExpandSidebar` callback to `SidebarSection` component
  - Files: `src/components/sidebar/SidebarSection.tsx`, `src/components/sidebar/Sidebar.tsx`

- **WebSocket error noise reduced** - `useEventSocket` no longer spams console when event server isn't running
  - Changed from `console.error` with empty object to single `console.warn` on first failure
  - Removed verbose connection/reconnection logging
  - Silently retries in background with exponential backoff
  - File: `src/hooks/useEventSocket.ts`

- **Session status detection bug** - Sessions waiting for tool approval now correctly appear in "Needs Attention" column
  - Bug: `turn_duration` JSONL entries were incorrectly clearing `pendingToolUses` array
  - This caused `waiting_for_approval` status to never be detected (always showed as `waiting_for_input`)
  - Fix: Removed premature clearing in `deriveSessionState()` - only `tool_result` entries should clear pending tools
  - File: `src/lib/session-status.ts`

- **Card styling priority** - Sessions needing attention now always show amber styling
  - Bug: `isNewlyAdded` check took precedence over `needsAttention`, so new sessions waiting for approval showed green instead of amber
  - Fix: Reordered conditions so `sessionNeedsAttention` is checked first
  - File: `src/components/SessionCard.tsx`

- **Card glow color** - "Newly added" glow effect now uses amber for cards needing attention
  - Bug: Glow was always green (emerald) regardless of card state
  - Fix: Glow color now matches card palette - amber for attention, green for normal active
  - File: `src/components/SessionCard.tsx`

- **Action toolbar color** - Hover toolbar now uses amber for cards needing attention
  - Bug: Toolbar was green when card was newly added, even if it needed attention
  - Fix: Reordered styling priority so `sessionNeedsAttention` takes precedence over `isNewlyAdded`
  - File: `src/components/SessionCard.tsx`

- **Event propagation delay** - Reduced delay for session status updates appearing in UI
  - Reduced SessionWatcher debounce from 200ms to 50ms
  - Reduced Chokidar stability threshold from 100ms to 50ms, poll interval from 50ms to 25ms
  - Added fallback refetch when session:updated event references unknown session
  - File: `server/watchers/session-watcher.ts`, `src/hooks/useSessions.ts`

### Changed

- **Stack View redesigned** - Now matches Docs Viewer polish and layout
  - Two-panel layout: resizable sidebar (180-500px) + content pane
  - Unified view showing all layers (Local, Project, User, System) with dividers
  - Collapsible layer sections with file counts
  - Breadcrumb navigation showing Layer → Type → File
  - Proper content viewers: CodeViewer for JSON, DocsEditor for markdown
  - Fixed CSS variables (`--border-primary` → `--border-default`)
  - Sidebar width persists to localStorage
  - Files: `src/components/stack/StackView.tsx`, `StackFileTree.tsx`, `StackContentPane.tsx`

- **Needs Attention column simplified** - Removed WAITING/IDLE section separators
  - Sessions are now just sorted by recency (most recent first)
  - Cleaner UI without unnecessary grouping dividers
  - File: `src/components/Column.tsx`

### Added

- **Stack View** - New view mode for visualizing and editing Claude Code configuration layers
  - Four-layer hierarchy: System (enterprise), User (~/.claude/), Project (.claude/), Local (gitignored)
  - Discovers all config file types: memory (CLAUDE.md), settings, commands, skills, agents, hooks, MCP servers
  - Three-panel UI: layer navigation, file browser grouped by type, file preview/editor
  - Create missing local files (CLAUDE.local.md, settings.local.json) with templates
  - Parse YAML frontmatter from commands/skills, JSON settings
  - Security: prevents writing to system layer, validates paths
  - Files: `src/lib/claude-config/`, `src/components/stack/`, `src/app/api/claude-stack/`, `src/hooks/useClaudeStack.ts`

- **Elapsed timer on status badges** - Ticking timer shows time since last activity
  - Displays next to Working, Needs Approval, and Waiting status badges
  - Format progresses: seconds (5s) → minutes (5m) → hours (2h 15m) → days (3d 5h)
  - Updates every second for accurate real-time tracking
  - File: `src/components/SessionCard.tsx`

- **Event-Driven Architecture (Phase 1)** - WebSocket infrastructure for real-time updates
  - New EventServer class for channel-based subscriptions and event broadcasting
  - `useEventSocket` hook for client-side WebSocket connection with auto-reconnect
  - `EventSocketProvider` context for app-wide WebSocket access
  - Path-based WebSocket routing: `/terminal` for PTY, `/events` for real-time events
  - Manual upgrade handling for multiple WebSocket servers on same HTTP server
  - Unit test scaffolding for EventServer and useEventSocket
  - Files: `server/event-server.ts`, `src/hooks/useEventSocket.ts`, `src/contexts/EventSocketContext.tsx`, `server/ws-server.ts`

- **Event-Driven Architecture (Phase 2)** - Session file watching and status derivation
  - SessionWatcher class using Chokidar to watch `~/.claude/projects` for JSONL changes
  - Real-time status derivation from JSONL entries: `working`, `waiting_for_approval`, `waiting_for_input`, `idle`
  - Detects pending tool uses by tracking `tool_use` and `tool_result` blocks
  - 5-minute idle threshold for marking inactive sessions
  - Broadcasts `session:created`, `session:updated`, `session:deleted` events via EventServer
  - `useSessions` hook subscribes to session events for real-time UI updates
  - Optimistic updates when session status changes
  - Reduced polling interval (30s) when WebSocket connected, fallback to 5s otherwise
  - Unit test coverage for status derivation logic
  - Files: `server/watchers/session-watcher.ts`, `src/lib/session-status.ts`, `src/lib/types.ts`, `src/hooks/useSessions.ts`

- **Event-Driven Architecture (Phase 3)** - Needs Attention column and status badges
  - New "Needs Attention" column for sessions awaiting tool approval or user input
  - Column auto-populates based on `derivedState.status` (waiting_for_approval, waiting_for_input)
  - Virtual column - sessions aren't persisted with "attention" status, just filtered there
  - Locked column - prevents drag-and-drop in/out (uses `useDroppable({ disabled })`)
  - "All clear" empty state when no sessions need attention
  - Renamed "In Progress" column to "Active"
  - Added `ColumnId` type as union of `SessionStatus | "attention"`
  - Added `needsAttention()` helper function for status checking
  - **Amber card styling** - Cards needing attention have amber border/background to match column icon
  - **Unified CardBadge component** - All status badges (New, Working, Needs Approval, Waiting) use same component
  - Badge colors match card state (amber for attention, emerald for active)
  - Pulsing "running" dot color changes to amber when card needs attention
  - **isIdle separation** - `DerivedSessionState.isIdle` is now separate from status
    - Sessions waiting for input/approval remain in attention column even when idle (5+ min inactive)
    - Allows proper grouping: actively waiting vs abandoned/idle waiting
  - **Waiting/Idle dividers** - Attention column groups sessions with collapsible headers
    - "Waiting" section: Sessions actively awaiting response (not idle)
    - "Idle" section: Sessions needing attention but idle for 5+ minutes
  - **derivedState API integration** - Sessions API now populates derivedState
    - New `getSessionDerivedState()` in claude-sessions.ts reads and parses JSONL
    - Only computed for running/active sessions to minimize overhead
  - Files: `src/lib/types.ts`, `src/lib/session-status.ts`, `src/lib/claude-sessions.ts`, `src/app/api/sessions/route.ts`, `src/components/Board.tsx`, `src/components/Column.tsx`, `src/components/SessionCard.tsx`

- **Event-Driven Architecture (Phase 4)** - Docs and Inbox real-time updates
  - ScopeWatcher class using Chokidar to watch scope directories for file changes
    - Emits `tree:changed` events when files/directories are added/removed
    - Emits `file:changed` events when file content changes
    - Per-client subscription with ref counting (shared watchers between clients)
    - Ignores common non-content paths: node_modules, .git, .DS_Store, etc.
  - InboxWatcher class to watch Todo.md files for inbox changes
    - Watches `{scopePath}/docs/Todo.md` for each subscribed scope
    - Emits `inbox:changed` events on file modifications
    - Same ref counting pattern as ScopeWatcher
  - Updated `useDocs` hook to use WebSocket events instead of polling
    - Subscribes to `tree` and `file` channels on connection
    - Triggers SWR mutate on events for instant UI updates
    - Skips file refresh when in edit mode to prevent losing changes
    - Removed 5s/30s polling interval (now event-driven)
  - Updated `useInboxItems` hook to use WebSocket events
    - Subscribes to `inbox` channel on connection
    - Reduced polling to 30s fallback when connected
  - Wired subscription handlers in ws-server.ts
    - Starts/stops watchers based on client subscriptions
    - Cleans up watchers on client disconnect
  - Files: `server/watchers/scope-watcher.ts`, `server/watchers/inbox-watcher.ts`, `server/watchers/index.ts`, `server/ws-server.ts`, `src/hooks/useDocs.ts`, `src/hooks/useSessions.ts`

- **Event-Driven Architecture (Phase 5)** - Remove polling, rely on WebSocket events
  - Polling completely disabled when WebSocket is connected
    - `useSessions`: No polling when connected, 5s/30s fallback when disconnected
    - `useInboxItems`: No polling when connected, 5s/30s fallback when disconnected
    - `useTreeSessions`: No polling when connected, 5s/30s fallback when disconnected
    - `useDocs`: No polling at all, fully event-driven
  - Reconnection re-fetch logic for all hooks
    - Tracks previous connection state with `useRef`
    - When WebSocket reconnects (false → true), triggers SWR mutate
    - Ensures data is fresh after network interruptions
  - Visibility-aware polling intervals for disconnected state
    - 5 seconds when tab is visible
    - 30 seconds when tab is hidden
    - Reduces resource usage when not actively viewing
  - Files: `src/hooks/useSessions.ts`, `src/hooks/useTreeSessions.ts`, `src/hooks/useDocs.ts`

- **Code File Viewer/Editor** - Code files now render with syntax highlighting in docs panel
  - Uses CodeMirror 6 for viewing and editing code files
  - Supports 30+ file extensions: JS/TS/JSX/TSX, Python, HTML/CSS, JSON/YAML/XML, Rust, Go, Java, C/C++, SQL, PHP, shell scripts, and config files
  - Full edit mode with Save button and unsaved changes detection
  - Dark/light theme support matching app theme
  - Line numbers, code folding, bracket matching, search
  - Files: `src/components/docs/CodeViewer.tsx`, `src/components/docs/DocsContentPane.tsx`

### Fixed

- **Root Folder Auto-Select index.md** - Opening docs panel now auto-selects root index.md
  - Previously, opening docs for a scope showed "select a file to view" even if root had index.md
  - Added useEffect to auto-select root's index.md when tree loads and no file is selected
  - Respects URL params - if `?doc=` is present, uses that instead
  - Files: `src/components/DocsView.tsx`

- **Folder Click Auto-Select index.md** - Clicking on a folder in the docs tree now auto-selects index.md
  - When clicking on a folder row (not the chevron), the folder expands AND its index.md is auto-selected
  - Also works for breadcrumb navigation - clicking a folder navigates and selects index.md
  - Files: `src/components/docs/DocsTreeItem.tsx`, `src/components/DocsView.tsx`

- **Wikilinks Render After Mode Switch** - Wikilinks now render correctly after switching from edit to read mode
  - Previously, wikilinks would show as raw `[[syntax]]` after returning from edit mode
  - Fixed by resetting `editedContent` to `null` when switching to read mode
  - Ensures wikilinks are processed fresh from the original content
  - Files: `src/components/docs/DocsContentPane.tsx`

- **Docs Viewer Scroll Position** - Following wikilinks now loads target file scrolled to top
  - Added `scrollContainerRef` to reset scroll position when `filePath` changes
  - Files: `src/components/docs/DocsContentPane.tsx`

- **Wikilink Path Resolution** - Wikilinks with folder paths now resolve correctly
  - `[[Knowledge/AI Analysis|AI Analysis]]` was marked as broken because resolver only looked up full path
  - Added fallback to extract and lookup just the filename when full path doesn't match
  - Files: `src/lib/docs/wikilink-resolver.ts`

- **Wikilink Implicit Relative Resolution** - Links like `[[subfolder/file]]` now resolve relative to current file
  - Previously, all wikilinks were resolved from scope root, so `[[Knowledge/index]]` in `Engineering/index.md` would fail to find `Engineering/Knowledge/index.md`
  - Added implicit relative path resolution (step 3) before global file tree lookup (step 4)
  - Resolution order: 1) explicit relative (`./`, `../`), 2) absolute (`/`), 3) implicit relative, 4) global filename match
  - Also improved file map to store files by relative path from scope (e.g., `roadmap/index`) not just filename
  - Files: `src/lib/docs/wikilink-resolver.ts`

- **Docs Editor Toolbar in Edit Mode** - MDXEditor toolbar now appears when switching to edit mode
  - Added `key` prop to force remount when `readOnly` changes, ensuring toolbar plugin initializes
  - Files: `src/components/docs/DocsEditor.tsx`

- **Spurious Save Button in Edit Mode** - Save button no longer appears when simply switching to edit mode
  - Root cause: MDXEditor normalizes markdown on init, causing content to differ from original file
  - Added `baselineContent` tracking to capture MDXEditor's normalized output as comparison baseline
  - `hasUnsavedChanges` now compares against baseline (editor's init state) instead of original file
  - Also removed redundant "(unsaved)" text indicator - Save button alone is sufficient
  - Files: `src/hooks/useDocs.ts`, `src/components/docs/DocsContentPane.tsx`

- **Wikilink Syntax Visible in Edit Mode** - Raw `[[wikilink]]` syntax now editable in edit mode
  - Wikilinks are only converted to clickable links in read mode
  - In edit mode, users see and can modify the raw syntax
  - Files: `src/components/docs/DocsEditor.tsx`

### Changed

- **Docs Viewer Typography** - Beautiful document-style rendering using Tailwind Typography defaults
  - Removed `prose-sm` and tight spacing overrides to let Typography defaults shine
  - Proper heading hierarchy: H1 (2.25em), H2 (1.5em), H3 (1.25em), body (1em)
  - 48px horizontal padding for comfortable reading margins
  - Theme-aware code blocks and table borders
  - Override MDXEditor's default 12px padding via CSS
  - Files: `src/components/docs/DocsEditor.tsx`, `src/app/globals.css`

### Added

- **Mode-Aware Search Filtering** - Search now filters content across all view modes
  - Board mode: Filters session cards (existing behavior)
  - Tree mode: Filters sessions in tree hierarchy
  - Docs mode: Filters files/folders in file tree
  - Search query persists when switching between modes
  - Files: `src/components/Board.tsx`, `src/components/TreeView.tsx`, `src/components/docs/DocsFileTree.tsx`

- **Extended File Type Rendering** - Docs viewer now renders images, PDFs, and CSVs
  - ImageViewer: Displays images with zoom controls (100%, zoom in/out, reset)
  - PDFViewer: Embeds PDFs with "Open in Finder" and "New Tab" buttons
  - CSVTableViewer: Parses CSV and displays as HTML table with sticky headers
  - Files: `src/components/docs/ImageViewer.tsx`, `src/components/docs/PDFViewer.tsx`, `src/components/docs/CSVTableViewer.tsx`, `src/components/docs/DocsContentPane.tsx`, `src/app/api/docs/raw/route.ts`

- **File Viewability Styling** - Non-viewable files are now visually distinguished
  - Viewable files (md, ts, js, json, images, etc.) shown in normal color
  - Non-viewable files (mjs, etc.) shown greyed out with 50% opacity
  - Files: `src/components/docs/DocsTreeItem.tsx`

- **URL Document Selection** - Document selection persists in URL for browser navigation
  - URL format: `/path/to/scope?doc=relative/path/to/file.md`
  - Browser back/forward navigation works with file selections
  - Direct linking to specific files supported
  - Files: `src/hooks/useDocs.ts`

### Changed

- **DocsBreadcrumbs Styling** - Now matches ScopeBreadcrumbs visual style
  - Uses monospace font (`font-mono`)
  - Arrow separators (`→`) instead of chevrons
  - Consistent button styling with hover background
  - Files: `src/components/docs/DocsBreadcrumbs.tsx`

- **DocsFileTree Simplified** - Removed redundant header bar
  - Scope name and refresh button removed (redundant with main breadcrumbs)
  - Cleaner interface with just the file tree
  - Files: `src/components/docs/DocsFileTree.tsx`, `src/components/DocsView.tsx`

- **Filter Button in Docs Mode** - Hidden when in docs view (no filter equivalent)
  - Files: `src/components/Board.tsx`

- **Turbopack by Default** - Switched from Webpack to Turbopack for faster dev experience
  - Initial compile: 585ms (was ~1000ms with Webpack)
  - HMR updates: ~50ms (was ~500ms)
  - Added `dev:webpack` script as fallback if needed
  - Files: `package.json`

- **Server Process Lock** - Prevents multiple WebSocket server instances
  - Lock file at `~/.hilt-server.lock` with PID
  - Detects and cleans up stale locks from crashed processes
  - Clear error message when attempting to start duplicate server
  - Files: `server/ws-server.ts`

- **WebSocket Auto-Reconnection** - Terminals auto-reconnect when server restarts
  - Exponential backoff: 1s, 2s, 4s, 8s, 10s delays
  - Max 5 attempts before giving up with helpful error
  - Shows reconnection status in terminal
  - Files: `src/components/Terminal.tsx`

### Changed

- **Removed Plan Polling** - Plan files no longer poll every 3 seconds
  - Initial fetch on session open only
  - Real-time updates via WebSocket events (already implemented)
  - Reduces network requests significantly with multiple open sessions
  - Files: `src/components/TerminalDrawer.tsx`

- **Server-Side Preferences Persistence** - User preferences now persist across Electron rebuilds
  - Pinned folders, sidebar state, theme, view mode, and recent scopes stored in `data/preferences.json`
  - New `/api/preferences` route for CRUD operations
  - Updated hooks (`usePinnedFolders`, `useSidebarState`, `useTheme`) to use server-side storage
  - Previous localStorage-based storage would be lost when Electron app cache was cleared
  - Files: `src/lib/db.ts`, `src/app/api/preferences/route.ts`, `src/hooks/usePinnedFolders.ts`, `src/hooks/useSidebarState.ts`, `src/hooks/useTheme.ts`, `src/lib/recent-scopes.ts`

- **Electron IPC Transport** - Native desktop app with IPC-based terminal communication
  - Replaces WebSocket with Electron IPC for PTY communication when running as native app
  - `electron/main.ts` - Main process with IPC handlers, embedded Next.js server, PTY manager
  - `electron/preload.ts` - contextBridge API for secure renderer-to-main communication
  - `electron/launcher.cjs` - tsx loader for TypeScript execution in development
  - Dual-mode transport in `Terminal.tsx` - auto-detects Electron vs browser environment
  - macOS hardened runtime with code signing entitlements
  - electron-builder configuration for DMG distribution
  - App icon using 🧱 (bricks) emoji
  - `did-fail-load` error logging for debugging renderer load failures

- **Tree View Action Buttons** - Session cards in Tree View now show action toolbar on hover
  - Select, Open, and Mark as Done buttons appear on larger cards (render levels 1-2)
  - Matches floating toolbar pattern from Kanban SessionCard
  - Smaller cards (levels 3-4) omit buttons due to space constraints
  - Files: `src/components/TreeSessionCard.tsx`, `src/components/TreeView.tsx`

### Fixed

- **Drawer Dismissal on Terminal Start** - Fix drawer closing when terminal session kicks off
  - Root cause: WebSocket `onclose` handler was triggering reconnection attempts during React cleanup
  - When component unmounts/remounts (e.g., during HMR or React StrictMode), the WebSocket close triggered reconnect, which caused race conditions with terminal spawn
  - Solution: Added `intentionalCloseRef` flag to track cleanup closes vs unexpected disconnects
  - Only attempt reconnection when close is unexpected (server disconnect, network error)
  - Files: `src/components/Terminal.tsx`

- **Terminal Not Loading in Electron** - Fix terminals not rendering in Electron app
  - Root cause: `isElectronEnv()` was called directly in render, returning `false` during SSR
  - After hydration, no re-render was triggered because there was no state change
  - Solution: Added `useIsElectron()` hook that detects Electron via useEffect/useState
  - This ensures a re-render occurs after hydration when Electron is detected
  - Files: `src/components/TerminalDrawer.tsx`

- **Sidebar Hydration Mismatch** - Fix SSR/client hydration error in Sidebar component
  - Removed early-return placeholder that had different DOM structure than full render
  - Use `effectiveCollapsed` pattern to ensure consistent initial render
  - Server and client now render identical structure, just with loading state styling
  - Files: `src/components/sidebar/Sidebar.tsx`

- **Tree View Title Priority** - Session cards now always show title first, not last message
  - Level 1: Title, optional slug, lastPrompt preview (only if different from title)
  - Level 2: Title only (removed lastPrompt to focus on what matters)
  - Level 3-4: Truncated title or status dot
  - Previously could show lastPrompt when title should be primary

- **Design Philosophy Document** - Living document capturing UI/UX preferences for AI assistants
  - `docs/DESIGN-PHILOSOPHY.md` - Core principles, specific patterns, interaction preferences
  - Evolution Log section for tracking design decisions over time
  - Integrated into commit hooks, `/commit`, `/docs-check` workflows
  - Added to CLAUDE.md as required reading before UI work

- **Documentation System** - Comprehensive docs for AI agents and developers
  - `docs/ARCHITECTURE.md` - System design, data flow, constraints (556 lines)
  - `docs/API.md` - All API routes and WebSocket protocol (509 lines)
  - `docs/DATA-MODELS.md` - TypeScript types and schemas (438 lines)
  - `docs/COMPONENTS.md` - React component hierarchy (626 lines)
  - `docs/DEVELOPMENT.md` - Setup, debugging, patterns (350 lines)
  - `docs/CHANGELOG.md` - Version history with technical notes

- **Documentation Enforcement** - Hooks and commands to ensure docs stay updated
  - PostToolUse hook reminds agents to update docs after code changes
  - `/commit` command checks documentation before committing
  - `/docs-check` command verifies docs are in sync with code
  - Files: `.claude/settings.json`, `.claude/hooks/docs-reminder.sh`, `.claude/commands/commit.md`, `.claude/commands/docs-check.md`

### Changed

- **CLAUDE.md** - Added documentation protocol instructions for AI agents
- **README.md** - Reorganized with documentation index, relative links to docs/, contributing section

---

## [0.2.0] - 2025-01-06

Major release introducing Tree View visualization, collapsible sidebar, and significant UI polish.

### Added

- **Tree View** - Fractal workspace visualization using squarified treemap layout
  - Heat-score based sizing (recency + volume + running status)
  - Four render levels adapting to rectangle size
  - Click folders to navigate, click sessions to open terminal
  - Files: `src/components/TreeView.tsx`, `src/components/TreeNodeCard.tsx`, `src/components/TreeSessionCard.tsx`, `src/lib/tree-utils.ts`, `src/lib/treemap-layout.ts`, `src/lib/heat-score.ts`

- **View Toggle** - Switch between Tree, Board, and Docs views
  - Centered in status bar with absolute positioning
  - Persists preference in localStorage
  - Files: `src/components/ViewToggle.tsx`, `src/components/Board.tsx`

- **Docs Tab** - Placeholder for future documentation view
  - Shows "Coming Soon" message when selected

- **Collapsible Sidebar** - Left sidebar with pinned folders
  - Pin/unpin folders from breadcrumb navigation
  - Drag-and-drop reordering of pinned folders (dnd-kit)
  - Session count badges (blue: To Do, green: In Progress, pulsing: running)
  - 256px expanded, 48px collapsed
  - Files: `src/components/sidebar/*`, `src/lib/pinned-folders.ts`, `src/hooks/usePinnedFolders.ts`, `src/hooks/useSidebarState.ts`

- **Reference Processing** - Process URLs as reference material
  - Bookmark icon action on inbox cards
  - YouTube transcript extraction via API
  - Firecrawl/WebFetch fallback for other URLs
  - Files: `src/app/api/firecrawl/route.ts`, `src/app/api/youtube-transcript/route.ts`

- **Todo Refinement Mode** - Refine drafts with AI assistance
  - Brain icon action on inbox cards
  - Routes to Claude with refinement instructions
  - File: `src/components/InboxCard.tsx`

- **Floating Action Toolbar** - Notion-style toolbar for card actions
  - Replaces gradient background approach
  - Contextual colors (blue for To Do, emerald for active)
  - Files: `src/components/SessionCard.tsx`, `src/components/InboxCard.tsx`

### Changed

- **Renamed "Kanban" to "Board"** in UI for cleaner naming
  - Migration for users with 'kanban' stored in localStorage

- **Scope Navigation** - URL path-based routing instead of query params
  - URL now reflects scope directly: `/Users/you/Work/Code/project`
  - Root "/" shows all projects
  - Files: `src/app/[[...path]]/page.tsx`, `src/components/scope/*`

- **Scope Filtering** - Exact match for Board, prefix match for Tree
  - Board: `projectPath === scopePath`
  - Tree: `projectPath.startsWith(scopePath)` for hierarchy rollup

- **Terminal Stability** - Added `terminalId` field to sessions
  - Stable ID that doesn't change when temp session matches real UUID
  - Prevents terminal reload/continue issues
  - Files: `src/lib/types.ts`, `src/components/Terminal.tsx`, `src/components/TerminalDrawer.tsx`

- **Color Palette** - Replaced all `green-*` with `emerald-*` throughout app

- **Status Bar** - Reduced height from 56px to 44px for compactness

### Fixed

- Terminal reload when session ID changes from temp to real
- Breadcrumb navigation glitch and state sync issues
- Root navigation clicking "/" now goes directly to all projects
- Todos appearing in All Projects view (was showing kanban's own Todo.md)
- Scope navigation page reloads (now instant with SWR `keepPreviousData`)
- Breadcrumb flash during navigation (cache homeDir in localStorage)
- Duplicate React key errors in Tree View
- All ESLint errors (14 → 0)
- Tree View height bug (container was 56px instead of full height)

### Technical Notes

- New squarified treemap algorithm in `src/lib/treemap-layout.ts` (no D3 dependency)
- Heat score formula: `0.6*recency + 0.3*volume + runningBonus`
- Tree building uses prefix filtering and metrics aggregation in `src/lib/tree-utils.ts`
- Client-side page component with React `use()` hook for instant navigation

---

## [0.1.1] - 2024-12-20

UI polish and live session detection.

### Added

- **Running Session Detection** - Pulsing green dot for active sessions
  - Auto-detection based on 30-second file modification threshold
  - Automatically promotes running sessions to In Progress
  - Files: `src/lib/claude-sessions.ts`, `src/components/SessionCard.tsx`

- **New Session Glow** - Green highlight effect for newly discovered sessions
  - 60-second fade animation with "NEW" label
  - Files: `src/components/Board.tsx`, `src/components/SessionCard.tsx`

- **Time-Based Dividers** - Group Recent column by time period
  - Starred, Today, Yesterday, This Week, Last Week, This Month, Older
  - Collapsible headers with session counts
  - File: `src/components/Column.tsx`

- **Custom Session Titles** - Support for `/rename` command titles
  - Uses most recent summary for session title
  - File: `src/lib/claude-sessions.ts`

- **Plan Filter** - Show only sessions with associated plan files
  - Plan-only viewing mode (view plans without starting terminal)
  - Files: `src/components/Board.tsx`, `src/components/SessionCard.tsx`

- **MDXEditor Dark Theme** - Comprehensive styling for plan editor
  - Tables, tooltips, CodeMirror syntax highlighting
  - File: `src/app/globals.css`

### Changed

- Session action icon from trash to checkmark (reflects "Mark as done" action)
- Drawer resize handle lightens border on hover (not thickens)
- Moved drawer toggle to In Progress column header
- Moved search to right side of toolbar

### Fixed

- Board scroll when drawer is resized wide (dynamic padding)
- Plan view layout shift and false unsaved indicator
- Running session bounce-back issues
- Subfolder dropdown alignment
- Recent column spacing to match To Do column

---

## [0.1.0] - 2024-12-15

Initial release of Hilt.

### Added

- **Three-Column Kanban Board** - To Do, In Progress, Recent
  - Drag-and-drop session management with dnd-kit
  - Multi-select for batch operations
  - Session starring to pin to top of Recent

- **Session Discovery** - Reads Claude's JSONL files from `~/.claude/projects/`
  - Parses session metadata (title, branch, messages, slugs)
  - Merges with persistent kanban status
  - Real-time updates via 5-second SWR polling

- **Terminal Integration** - Embedded xterm.js terminal
  - Resizable drawer (400-1200px)
  - Multiple tabs for concurrent sessions
  - OSC sequence parsing for dynamic titles
  - Context progress extraction

- **Plan Mode** - MDXEditor for plan markdown files
  - Full markdown support (tables, code blocks, syntax highlighting)
  - Detects plans created during sessions
  - Unsaved changes indicator

- **Scope Navigation** - Browse projects by folder
  - Breadcrumb navigation
  - All Projects view
  - Recent scopes dropdown
  - Subfolder browser

- **Draft Prompts (Inbox)** - Queue prompts before starting sessions
  - In-card editing
  - Section organization via markdown headers in Todo.md
  - Quick start sessions from drafts

- **Electron Wrapper** - Native macOS app
  - Custom kanban-style icon
  - Server lifecycle management
  - DMG distribution via electron-builder

- **Session Metadata Display**
  - Current task from terminal title
  - Last prompt preview
  - Project path (clickable)
  - Git branch
  - Message count
  - Relative timestamps

### Technical Notes

- Next.js 16 + React 19 frontend
- Separate WebSocket server for PTY management (port 3001)
- Status persisted in `data/session-status.json`
- Inbox persisted in `data/inbox.json` or project's `Todo.md`
- Electron main process in `electron/main.js`
