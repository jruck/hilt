# Eval Labels — the calibration ledger

Every human verdict on the library's judgment becomes a labeled example here: feedback comments,
to_archive rescues/confirmations, spot-checks of the judge layer, and the resolution each one got.
This is the system's training set and the audit trail for every scoring-constant change
(`meta/library-scoring.json` — see `docs/plans/library-v2.md`, Workstream 1). Maintained by the
steering loop; append-only; newest first.

Format: `date · item · user verdict · root cause · resolution · round`

## Labels

### 2026-06-09 · "this was a clip, not wanted" (YouTube candidate `06dc883689d36ff0`)
- **User verdict:** junk — short-form clip should never have entered the feed.
- **Root cause:** disposition/routing — clip detector was report-only; suppression not enforced.
- **Resolution:** SYSTEMIC, same day — consolidated clip policy + enforced pre-digest suppression
  (CHANGELOG "YouTube clip suppression ENABLED"). User validated the detector at 100% precision across
  ~58 graded items before enforcement. Class of error closed, not just the instance.
- **Round:** pre-steering-loop (manual session).

### 2026-06-04 · McKinsey article capture (`8ac367e73505647e`)
- **User verdict:** the eval graded an item whose full source was never captured ("it even says it in
  the summary the full McKinsey article couldn't be pulled in").
- **Root cause:** data gap — extraction failed silently; eval scored metadata as if it were the source.
- **Resolution:** OPEN — awaits the extraction-failed low-trust flag (Library v2 carry-over item:
  flag at ingest, exclude from archive judgment + substance grading, one bounded re-extraction).
- **Round:** pre-steering-loop (manual session).
