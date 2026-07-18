# Eval Labels — the calibration ledger

Every human verdict on the library's judgment becomes a labeled example here: feedback comments,
to_archive rescues/confirmations, spot-checks of the judge layer, and the resolution each one got.
This is the system's training set and the audit trail for every scoring-constant change
(`meta/library-scoring.json` — see `docs/plans/library-v2.md`, Workstream 1). Maintained by the
steering loop; append-only; newest first.

Format: `date · item · user verdict · root cause · resolution · round`

## Labels

### 2026-07-18 · Current-fit scoring s3 — replace the semantic graph
- **User verdict:** Preserve the semantic/visual graph as a recoverable time capsule, but remove it
  from live Hilt and stop the Gemini cost. Keep For You, Library, and Briefing behavior without an
  ongoing comparison program or user-run training loop.
- **Root cause:** semantic embedding similarity added cost and operational complexity without a
  demonstrated user-visible advantage large enough to justify it. The one-time July 10–17 bake-off
  found the explicit-context hybrid to be the best deterministic replacement.
- **Resolution:** scoring config `s3` keeps Worth, substance, freshness, lifecycle, suppression, and
  cooldown behavior, while Current fit now combines BM25F matches to active work, readable explicit
  Connections, and attention judgment. New recommendation episodes record
  `explicit_context_hybrid` / `s3`; historical episode score snapshots remain unchanged.
- **Round:** one-time historical bake-off and retirement cutover.

### 2026-07-10 · For You/briefing attention model — replace evergreen score resurfacing
- **User verdict:** For You and the Library briefing should be the same personal attention feed: rank
  what is newly worth seeing in light of recent saves, conversations, meetings, and project movement;
  retain prior recommendations below; resurface an older item only when something materially new
  makes it timely, with an updated explanation. Do not repeatedly float high-score evergreen items.
- **Root cause:** scoring config `s1` treated For You as a temporary eight-item ranking with an
  exploration slot and source caps. It had no durable recommendation episodes, evidence novelty,
  exposure history, or separation between source summary and recommendation pitch.
- **Resolution:** scoring config `s2` uses an editorial 0–12 batch over a larger pool, seven-day fresh
  intake plus 72-hour novel context evidence, one latest episode per artifact, and 7/14/30-day
  exposure/read/dismissal cooldowns. Repeated trigger fingerprints and materially unchanged pitches
  are rejected. Briefing cards consume the same frozen episodes; numeric eval remains diagnostic.
- **Round:** direct product steering, implemented and isolated-E2E verified.

### 2026-06-10 · Steering round 1 — both proposals approved and applied
- **User ruling on fetch failures (verbatim spirit):** "when source fetch fails, that suggests an issue
  with our summarize pipeline, not an issue with the quality of the content" — route to a needs-re-fetch
  bucket; never grade/archive-flag on stub content.
- **Change (logic):** new `needs_refetch` lifecycle. Trigger = the explicit "No cached source content
  available" marker (positive evidence the capture failed). A `warm` digestion alone does NOT trigger —
  warm items often carry real partial content (inline text, X posts) and stay gradable; revisit if a
  warm-with-stub case surfaces. needs_refetch items are excluded from the For You pool and can never be
  `to_archive`. Surfaced as a "Needs re-fetch" lifecycle facet in admin filters.
- **Re-score delta (free):** 65 of 820 study items rerouted to needs_refetch; to_archive 256. The
  motivating McKinsey item (`8ac367e73505647e`) routed correctly — and shows relevance 0.753 (Product
  Factory tie), i.e. a HIGH-value item the old logic would have archive-flagged off a stub. Validates
  the user's ruling.
- **Re-fetch drain built same day** (`library:refetch`, daily 04:45, capped 10/run × 2 attempts,
  zero Claude window). First runs recovered 0/4 — diagnosis: the X auth path only existed for the
  twitter-bookmarks source (`metadata.xurl_path`); Raindrop-saved X posts silently skipped the API.
  **Fixed with a global `XURL_BIN` fallback → 19 of 29 fetchable items recovered same session**
  (bucket 29 → 10; the rest are genuine paywalls/dead URLs that exhaust their cap and stay visibly
  held). Recovered items get `reweave_pending` so their stub-judged connections rerun against real
  source overnight. Unfetchable ≠ low-quality, per the user's ruling.

### 2026-06-09 · "this was a clip, not wanted" (YouTube candidate `06dc883689d36ff0`)
- **User verdict:** junk — short-form clip should never have entered the feed.
- **Root cause:** disposition/routing — clip detector was report-only; suppression not enforced.
- **Resolution:** SYSTEMIC, same day — consolidated clip policy + enforced pre-digest suppression
  (CHANGELOG "YouTube clip suppression ENABLED"). User validated the detector at 100% precision across
  ~58 graded items before enforcement. Class of error closed, not just the instance.
  **2026-06-10 (round 1):** user approved the item's removal — it was already deleted in the 06-09
  validated-junk purge (id no longer resolves). Detector audit: it slipped because it predated
  enforcement, not a pattern gap. Comment marked processed.
- **Round:** pre-steering-loop (manual session) + steering round 1 close-out.

### 2026-06-04 · McKinsey article capture (`8ac367e73505647e`)
- **User verdict:** the eval graded an item whose full source was never captured ("it even says it in
  the summary the full McKinsey article couldn't be pulled in").
- **Root cause:** data gap — extraction failed silently; eval scored metadata as if it were the source.
- **Resolution:** CLOSED 2026-06-10 (steering round 1) — `needs_refetch` gate implemented per the
  user's ruling above. Comment marked processed.
- **Round:** pre-steering-loop (manual session) → steering round 1.
