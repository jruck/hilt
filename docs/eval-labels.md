# Eval Labels — the calibration ledger

Every human verdict on the library's judgment becomes a labeled example here: feedback comments,
to_archive rescues/confirmations, spot-checks of the judge layer, and the resolution each one got.
This is the system's training set and the audit trail for every scoring-constant change
(`meta/library-scoring.json` — see `docs/plans/library-v2.md`, Workstream 1). Maintained by the
steering loop; append-only; newest first.

Format: `date · item · user verdict · root cause · resolution · round`

## Labels

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
- **Still open from this ruling:** the bounded re-extraction pass that empties the bucket (data work,
  scheduled separately).

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
