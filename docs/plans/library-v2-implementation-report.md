# Library v2 — Implementation Report

Living report for the build of [`library-v2.md`](library-v2.md). Updated at each phase boundary.
Records: what was implemented, what differed from the spec and why, scorecard results, dead ends.

**Status: Phases A–E built, adversarially verified (6-agent workflow), iterated (2026-06-09/10).**

## Scorecard (after verification + iteration, 2026-06-10 ~00:20)

| # | Metric | Baseline | Current | Target |
|---|--------|----------|---------|--------|
| 1 | Judge–score agreement | never captured | **63% exact / 100% adjacent** (n=32; was 54% pre-semantic) | ≥80% |
| 2 | For You precision@8 | unknown | **8/8 not-low · 7/8 high** (the real served feed, fully judged) | ≥6/8 |
| 3 | Rescue rate | unknown | — (events now wired correctly; awaits a rescue affordance + review session) | <10% |
| 4 | For You open rate | not logged | 0.1 early signal; feed baseline instrumented tonight | baseline → 2× feed |
| 5 | Feedback latency / unprocessed | ∞ / 2 | clustered_at stamps live; the 2 comments are proposed, awaiting verdict | <24h / 0 |
| 6 | Weave completeness | ~90% | 90% (union-correct; 27 degraded + ~63 no-source of 811) | >97% |
| 7 | p50 list latency | ~450–700ms | **~285ms** (recommendations 1.25s → **~0.3s**) | <50ms (deferred to full index) |

**Reading metric 1 honestly:** the disagreement is one-directional — the judge is consistently
*harsher* (3× top→medium, 8× middle→low, zero upgrades; never off by two tiers). Two causes
intertwine: (a) the formula over-ranks mid-tier content (newsletter roundups at worth 0.85), and
(b) the metric maps *relative* terciles to *absolute* tiers — if the corpus genuinely skews low-value
(the judge thinks so; "most saves are honestly low"), the middle tercile *should* be judged low. The
calibration backlog now surfaces in every morning report; fixing the mapping vs. fixing the formula is
a steering-loop decision, not a tonight decision.

## What was implemented

### Phase A — foundations
- **Event log** (`src/lib/library/events.ts`): append-only JSONL in `DATA_DIR/library-events/`;
  `served` (For You impressions with rank + serve-time score snapshot), `opened`, `read`, `promoted`,
  `skipped`, `rescued`, `archived_confirmed`, `feedback_left` — wired into the recommendations, detail,
  read, candidate-status, promote, archive, and feedback API routes. Logging never breaks a request.
- **Versioned scoring config**: `meta/library-scoring.json` (vault, version `s1`) ← every eval/ranking
  constant extracted from code (`scoring-config.ts` pure defaults/types + `scoring-config-loader.ts`
  server-only mtime-cached loader — split required by the Next client bundle). `evaluateArtifact`,
  signal weights, For You sizing all read config.
- **`docs/eval-labels.md`** created with the protocol header and the two pre-existing feedback verdicts
  as first labels (clip complaint → resolved systemically same-day; McKinsey capture gap → open,
  awaits extraction-failed flag).
- **Judge layer**: `attention_judgment` (tier + reason) added to the reweave JSON contract
  (`reweave-prompt.ts`), parsed/normalized, persisted through both writer paths (script reweave +
  inline digestion). Pipeline bumped **v2.2** (decimal; v2/v2.1 remain current — no version-behind
  stampede), registry + `docs/review-notes/v2.2.md` written per protocol.
- **Judge bootstrap** (`scripts/library-judge-sample.ts`): 24 items stratified across worth terciles +
  all 8 For You picks, one light non-agentic Sonnet call each, rate-limit-aware; judgments stored in
  `DATA_DIR/library-judgments/`. Ran clean: 24/24, zero failures.

### Phase B — steering loop
- **`scripts/library-steering.ts`**: computes the scorecard (via the metrics harness), clusters
  unprocessed feedback into root-cause patterns with typed fix proposals (one light Claude call,
  skipped cleanly on closed window), surfaces judge↔formula disagreements, writes the **morning
  report** to `meta/library-reports/YYYY-MM-DD.md` (vault — agent-readable, briefing can fold it in).
  **Never applies changes** — proposals carry the more/less/rollback contract.
- **Scheduled**: `com.hilt.library.steering` daily 05:10 (after drain + cleanup, before the briefing).

### Metrics harness
- **`scripts/library-metrics.ts`**: all 7 metrics from live data, JSON + markdown table
  (`npm run library:metrics`).

### Phase C — editor's memo
- **`scripts/library-memo.ts`**: weekly synthesis of the week's study intake (63 items this week) into
  2–4 through-lines tied to active projects + a worth-your-time shortlist; one non-agentic call;
  memo written to the vault as a first-class library item (`references/process/memos/`, full
  frontmatter incl. `reconnected_at` so the drain never targets it, connections to referenced items).
- **Scheduled**: `com.hilt.library.weekly-memo` Sundays 05:30.

### Phase D — For You v2 funnel
- **Stage 1** (`buildForYouPool`): worth-ranked pool (30) minus negatively-signaled items
  (skip/archive-confirm within `negative_suppress_days`).
- **Stage 2** (`scripts/library-editor-pass.ts`, daily 07:25 job — replaces the old
  compute-into-a-log-nobody-reads run): LLM editor picks 7 with stated reasons written TO the user;
  cache in `DATA_DIR/library-for-you/` consumed by the API; stale-cache fallback ≤30h, then pure
  deterministic funnel. First live run: 7 picks, every reason names a specific project.
- **Stage 3** (in `getRecommendations`): source-diversity cap (2/source), near-duplicate title dedup
  (Jaccard >0.6), **one exploration slot** rotating daily through the tail (how miscalibration gets
  discovered), reasons surfaced on For You feed cards (`FeedCard` `reason` prop).

### Phase E-lite — read path
- mtime-keyed parse cache in `parseMarkdownFile` (immutable strings shared, `data` cloned per return),
  signal tokens precomputed once per eval pass (was O(signals × artifacts)), semantic context cached
  per process keyed by db mtime + recent-save ids. **450–700ms → ~250ms** list, **1.25s → 0.30s**
  recommendations.

## Deviations from spec

- **Phase E**: in-process caches instead of the full SQLite/FTS5 read index. Hits ~250ms, not the
  <50ms target — the remaining cost is artifact tokenization + eval per request + Next/JSON overhead.
  The full index remains specced and becomes necessary at ~5k items; <50ms is deferred with it.
- **Negative-feedback suppression** (Workstream 4) is event-based (skip/archive within window), not
  semantic-neighborhood-based — the simpler rule ships tonight; neighborhood suppression noted as a
  follow-up once event volume exists.
- **Steering-loop "pre-authorized actions"** (auto-applied free re-scores): not enabled — the
  pre-authorization list is empty until the user grants standing approvals. Loop is propose-only.
- **Morning report surfacing**: RESOLVED 2026-06-10 — the Hermes briefing gather
  (`<vault>/meta/skills/briefing/scripts/gather.sh`) now feeds the full morning report into the 06:00
  briefing context (steering writes it by ~05:15), and the briefing skill's Library section leads with
  proposals awaiting verdict + links `[Full library report](/api/reports/morning)` (same-origin, works
  in Hilt and over the tailnet). A pinned Library-top card remains optional polish. The WEEKLY memo is
  not yet folded into the briefing — it surfaces as a library item; fold it in if Sunday briefings feel
  incomplete.

## Verification round (6-agent adversarial workflow + spec critic, 2026-06-09 ~23:45)

The workflow's headline catch: **`HILT_SEMANTIC_ENABLED` was set nowhere in the live environment** —
the semantic relevance layer (the d5b7837 headline) had been dormant in the live server since it
shipped; every eval before tonight ran on the saturated token fallback. Enabled in `.env.local` +
server restart; judge agreement immediately rose 54% → 63% and the served feed reranked.

Fixed from the verification findings (all same-night):
- **Honest metrics**: metric 2 now judges the *served* feed (was the formula's top-8 — only 3/8
  overlap) with dual not-low/high counts; metric 3 counts only archives confirming a `to_archive`
  flag (meta stamped at archive time) and candidate events log *after* a successful real transition;
  metric 5 reads new `clustered_at` stamps (the loop's job) instead of `processed_at` (the user's);
  metric 6 uses the union of failure modes + version currency.
- **Event-log integrity**: the nightly metrics probe no longer writes phantom For You impressions
  (`no_log=1`); feed impressions are now logged (surface declared by the Feed view only, page 1, so
  machine GETs stay out); merge-order bug fixed (`at` can't be clobbered); reads are mtime-cached off
  the hot path.
- **Steering loop**: report filename uses LOCAL date (the inaugural report was renamed 2026-06-09 —
  tomorrow's 05:10 run would have silently overwritten it under the UTC name); already-clustered
  feedback is never re-clustered (one Claude call saved per night, Principle 4).
- **Funnel**: pool now drawn from the full study corpus (a silent newest-200 pre-cut was defeating
  the exploration slot's purpose); the editor prompt states the 2-per-source hard rule (it wasted 2
  of its first 7 picks on a capped source).
- **Config safety**: per-leaf finite-number validation in the scoring-config loader (a typo'd value
  silently NaN-poisons every worth score otherwise); parse cache clones at store time too
  (gray-matter shares `.data` across its internal cache).

Known-and-accepted (noted, not fixed tonight): no rescue affordance in the UI yet (metric 3 stays
empty until one exists); semantic floor/scale/cap remain env-only (not in scoring-config) — a real
spec deviation now recorded; no v2.2 review batch cut yet (next fresh ingests will carry the
judgment field; cut a small batch then); event-log rotation deferred until volume warrants;
memo→Briefing folding still pending (report + memo live in the vault where the briefing agent can
read them); open-rate temporal pairing deferred until metric 4 has real volume.

## Dead ends

- **`scoring-config.ts` with `fs` broke the client bundle** (LibraryArtifactDetailPane imports
  `TO_ARCHIVE_WORTH` → library-eval → scoring-config): Next module-not-found, library API 500s.
  Resolved by splitting pure defaults/types from the server-only loader. Lesson: any lib module a
  client component can transitively reach must stay node-free.
- **Long markdown inside JSON strings** (memo v1 contract): the model's first compliant response
  failed JSON.parse at an unescaped char. Resolved with a sentinel contract (one-line JSON header +
  body between `<memo>` tags). Lesson: never ship a paid call whose output contract requires a model
  to JSON-escape a multi-paragraph document.
- **Memo connections to candidates**: the first memo stamped 14 of 15 `connection_suggestions` into
  `references/.cache/` (TTL'd, non-durable). Filtered to durable targets only — same rule as the
  reweave prompt.
