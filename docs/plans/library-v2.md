# Reference Library v2 — From Pipeline to Editor

> **2026-07-18 current-state note:** The editor/episode architecture remains current, but the former
> semantic/vector assumptions in the June design were retired. Production candidate scoring is the
> deterministic `s3` explicit-context hybrid described in
> [`reference-library-roadmap.md`](reference-library-roadmap.md); the old implementation is preserved
> through the [semantic graph v1 tombstone](../retired/semantic-graph-v1.md).

## What this is

The build plan for the Library's second act. v1 built the **pipeline**: ingest → digest → reweave →
worth-ranked feed, with human review gates (June 2026 status: stable, validated, backlog zero). v2 builds
the **editor**: the system reads everything, learns from how the user responds, surfaces *insights* (not
just items), and reports its own learning back for steering.

The user's framing: *"a reader at a publishing house / a food taster."* Three jobs:
1. **Pre-reader** — triage the inflow, promote what deserves attention (v1 has the plumbing; the ranking
   is unvalidated).
2. **Research assistant** — retrieve and synthesize on demand (v1 has search-and-browse only).
3. **Editor** *(new in v2)* — cross-item synthesis tied to active work ("three things you saved this week
   bear on X — here's the through-line"), delivered proactively; and a self-improvement loop that reports
   "here's what we learned, here's what changed" for the user to steer with *more / less / rollback*.

Companion docs: `reference-library-roadmap.md` (the eval model — disposition/worth/lifecycle — remains
canonical), `PIPELINE-VERSIONS.md` (prompt versioning protocol), CHANGELOG "rate-limit-aware reweave" +
"false-positive rate-limit detector fix" (operational ground rules).

## Current state (June 2026 audit)

What the audit established, so future sessions don't re-derive it:

- **Pipeline: sound.** Markdown-canonical, policy-routed, versioned prompts, clip suppression enforced,
  nightly drain functional, backlog 0, all 919 items at current pipeline version.
- **Learning: none.** Every weight in scoring is a hardcoded constant. Behavioral signals that exist but
  are never consumed: `read_at`, unread state, promotions (incl. `for_you_selected`), archive rescues,
  feedback comments. The 7:25 recommendations job computes a daily ranking and writes it to a log nothing
  reads. `/process-library-feedback` is fully manual and effective when run — but never runs on its own.
  The `docs/eval-labels.md` calibration ledger specified by that skill has never been created.
- **For You (historical June audit): hand-tuned heuristics.** `worth = relevance × substance × freshness`;
  relevance = `0.32·√fp + 0.08·other + contextFit(≤0.3)`. Constants are folklore (unvalidated). Saved
  refs and candidates once used unequal context paths. This was later replaced by one full-corpus
  deterministic hybrid for both lifecycles. No diversity, dedup, or exploration. Top-8 by score.
- **Performance: fine at ~1k items, breaks ~5k.** Every list request re-walks and re-parses ~1,090
  markdown files: 450–700ms warm; recommendations 1.25s. BrowseView fires 3 sidebar-count fetches at
  `limit=10,000`. Search is an O(n) full-content scan. No read index.
- **Insight synthesis: absent.** Per-item vault connections exist (reweave); shared themes exist across
  the week's intake but nothing synthesizes them. Briefing integration is
  one unused enum value (`briefing_selected`).

## Design principles

1. **Markdown stays canonical.** Every v2 store is derived/operational state (SQLite or DATA_DIR JSON),
   rebuildable from the vault. No migration can trap content.
2. **Learning = logged evidence + approved change, never silent drift.** Weights and thresholds change
   only through the steering loop (proposal → user approval → CHANGELOG + ledger entry). The system may
   *propose* continuously; it *applies* only what's approved or pre-authorized.
3. **The eval flags; the human moves.** Carried from v1: no auto-archive until the ranking earns trust
   through the loop — and "earns trust" is now measurable (rescue rate, see Success criteria).
4. **Claude-window budget is a hard constraint.** New agent passes (editor memo, LLM ranking pass,
   feedback processing) ride the established pattern: bounded, sequential, scheduled against idle windows
   (night/early morning), Sonnet-pinned, circuit-breakered. No new burst consumers.
5. **Steer with three verbs.** Every automated change surfaces in a report the user can answer with
   *more of this / less of this / roll it back*. Rollback must always be one action (version registry
   semantics extend to scoring config).

## Workstream 1 — The steering loop (highest leverage; build first)

Close the loop that already has both endpoints built (feedback store + processed flags on one end,
free eval re-scoring + version registry on the other).

- **Scheduled run** (launchd, nightly ~4:30 after the reweave drain; skip when nothing to do): an agent
  pass that (a) reads unprocessed feedback comments, (b) clusters them by root cause per the
  `/process-library-feedback` protocol, (c) drafts fix proposals classified logic-vs-data with blast
  radius, (d) runs anything **pre-authorized** (free re-scores, data repairs the user has standing-okayed),
  and (e) writes the **morning report**.
- **The morning report** is the product: a short markdown note — what feedback arrived, what patterns it
  formed, what was changed (with before/after worth deltas), what awaits approval, rescue-rate trend.
  Surfaces in the Briefing tab and/or pinned to the Library top. Each item carries the three verbs.
- **Scoring config becomes versioned data, not code constants.** Extract eval/ranking constants
  (`TO_ARCHIVE_WORTH`, signal weights, hybrid field/threshold/normalization constants, relevance coefficients) into a
  `meta/library-scoring.json` (vault) with a version stamp and a registry entry per change — same
  decimal/integer protocol as pipeline versions. This is what makes *rollback* one action and lets
  proposals be applied/reverted without code deploys.
- **Create `docs/eval-labels.md`** on first run and maintain it: every user verdict (rescue, confirm,
  feedback) becomes a labeled example with the reason. This is the system's training set and the audit
  trail for every constant change.

## Workstream 2 — Engagement logging (build immediately; everything depends on it)

Can't learn from data that was never logged. Add an append-only event log (SQLite table in a new
`library-events.sqlite` or a DATA_DIR JSONL): `served` (For You impressions, with rank + score
breakdown), `opened`, `read` (already tracked — mirror into events), `promoted`, `skipped`, `rescued`,
`archived_confirmed`, `feedback_left`. Each event: artifact id, timestamp, surface (feed/for-you/search/
briefing), and the scoring snapshot at serve time (so later analysis can ask "what did we believe when we
showed this?"). Cheap, invisible, and the prerequisite for Workstreams 1's trend metrics and 4's ranking
improvements.

## Workstream 3 — The editor's memo (insight synthesis)

The publishing-house deliverable. A weekly (initially) agent pass over the period's intake:

- **Inputs:** the week's new study items with their digests + woven connections; active projects/areas
  (the same context signals the eval reads); recurring themes across the new items.
- **Output:** one markdown note in the vault (`references/process/memos/` or similar — it should itself
  be a first-class library item): 2–4 through-lines, each tying ≥2 items to a specific active project
  with a concrete "consider this" — plus a "worth your time this week" shortlist with one-line reasons.
  Not a list of links: an argument about what the reading *means* for current work.
- **Delivery:** pinned card at the Library top; folded into the Briefing (the `briefing_selected`
  plumbing finally earns its keep). The memo itself is feedback-able — comments on it flow into the
  steering loop like any item.
- **Budget:** one bounded agentic run per week against an idle window; inputs are already-digested
  material (no re-reading sources), so it's one synthesis call, not N.

## Workstream 4 — For You v2 (staged funnel)

Restructure ranking from score-and-sort into the standard funnel, sized for a one-user ~1–5k corpus
(the transferable lesson from Twitter's open-sourced the-algorithm and the recsys literature — the
*architecture* and the *feedback-label discipline* transfer; trained engagement models do not, at this
scale):

1. **Candidate generation (cheap, existing):** current worth scoring trims the complete eligible study
   corpus. Saved references and candidates use the same hybrid score map and normalization.
2. **Heavy ranker = the LLM (new):** a scheduled editor pass (can share the Workstream 3 run; daily-lite/
   weekly-full) reads the ~30 and makes the final picks **with stated reasons** — the reason strings
   surface in the UI and double as audit data.
3. **Re-rank rules (new, deterministic):** source/author diversity cap, same-story dedup (stable
   source identity and bounded text similarity), date spread, and **one exploration slot** reserved for an uncertainty-sampled
   item (how miscalibration gets discovered).
4. **Negative feedback is weighted heavily** (the strongest recsys lesson): a skip/rescue/"not this"
   suppresses that item through deterministic event windows and cooldowns, pending the next steering-loop review.
- Engagement data (Workstream 2) feeds offline analysis in the steering loop — adjust stage-1 constants
  from evidence, by proposal. No online learning; no silent weight changes (Principle 2).

## Workstream 5 — Read index (scale + speed)

A future derived SQLite read index can store one table of
artifact frontmatter + eval inputs, mtime-incremental sync from the vault (watcher + periodic reconcile),
FTS5 for search. List requests go ~600ms → ~10ms; search becomes indexed; BrowseView's triple
`limit=10,000` fetches become trivial; corpus headroom moves from ~5k to ~100k. Markdown remains the
source of truth; the index is disposable cache (Principle 1). Do this before the corpus doubles twice;
it is also what makes per-keystroke search and future retrieval (research-assistant job) feel instant.

## Carry-over items folded into v2

- **Extraction-failed low-trust flag** (~30 refs + ~36 candidates with no cached source, 27 with
  degraded digests): flag at ingest, exclude from archive judgment and substance grading, one bounded
  re-extraction attempt via the steering loop; closes the standing McKinsey feedback comment.
- **Shared candidate scoring** (Workstream 4 stage 1) — resolved by the `s3` full-corpus hybrid.
- **Two unprocessed feedback comments** in the live store — first fodder for Workstream 1's initial run
  (one, the clip complaint, was already solved systemically by enforced clip suppression; record it in
  the ledger as such).

## The judge layer (cheap, unlocks the metrics)

The reweave agent already reads the source *and* explores the vault — it is in the perfect position to
judge attention-worthiness directly, and today that judgment is discarded. Add one field to the reweave
JSON: `attention_judgment: { tier: "high" | "medium" | "low", reason: <one line> }`, stamped to
frontmatter. This is an LLM-judge label on every item at zero marginal cost (no extra calls).
**Protocol note:** it's a prompt change, so it runs the standard generation cycle — decimal
`PIPELINE_VERSION`, review-notes card, Updated-lane batch — per `PIPELINE-VERSIONS.md`.

For the existing corpus, don't re-reweave: a one-off **sampled judge pass** (~60 items stratified across
worth terciles, reading existing digests only — one light call each, inside the nightly window budget)
bootstraps the agreement metric below in a single night.

## Metrics — the minimum viable scorecard

Seven metrics, one per question that matters. Resist adding more until one of these saturates.

| # | Metric | Question it answers | Baseline (2026-06) | Target | Available |
|---|--------|--------------------:|--------------------|--------|-----------|
| 1 | **Judge–score agreement** — % of items where Claude's attention tier matches the arithmetic worth tercile | Is the formula valid? | unknown (never captured) | ≥80%; top disagreements reviewed weekly | Night 1 (sampled judge pass) |
| 2 | **For You precision@8** — of the 8 picks, how many are worth-your-time (weekly Claude judge + occasional user spot-check) | Is the feed good? | unknown | ≥6/8 | Night 1 (judge today's picks) |
| 3 | **Rescue rate** — % of `to_archive` flags the user rescues on review | Can the ranking be trusted with archive power? | unknown | <10% sustained | next review session |
| 4 | **For You open rate** vs. feed baseline | Does surfacing change behavior? | not logged | establish baseline, then 2× feed | Phase A (event log) |
| 5 | **Feedback latency** — comment → clustered/proposed; unprocessed count at each morning report | Is the loop closed? | ∞ (manual; 2 unprocessed, oldest 5 days) | <24h, count 0 | Phase B (steering loop) |
| 6 | **Weave completeness** — % of study items at current version with non-degraded capture | Is the corpus fully processed? | 100% version-current; ~90% non-degraded (27 warm/blocked, ~66 no-source) | >97% | tonight (extend health panel) |
| 7 | **p50 list latency** (and recommendations latency) | Will it scale? | ~450–700ms (recs 1.25s) | <50ms (<300ms) at 5k items | measure tonight; improve Phase E |

Metrics 1–2 are the "you could judge that for yourself" principle made operational: Claude grades fit
using what it knows of the user and the vault, the user spot-checks the judge occasionally (graded in the
ledger), and the arithmetic score is calibrated against both. Human verdicts always outrank the judge;
the judge always outranks the formula.

## Sequencing

1. **Phase A (foundations, immediate):** Workstream 2 (event logging) + scoring-config extraction +
   `eval-labels.md` creation + the judge layer (reweave field + sampled bootstrap pass). All cheap, all
   prerequisites.
2. **Phase B (the loop):** Workstream 1 scheduled run + morning report. The system starts talking back.
3. **Phase C (the editor):** Workstream 3 weekly memo; briefing integration.
4. **Phase D (the feed):** Workstream 4 funnel — after a few weeks of Phase A/B data exist to rank
   against and measure with.
5. **Phase E (scale):** Workstream 5 read index — schedulable any time; required before ~5k items.

## Success criteria

The scorecard above is the measurement system; success is its trajectory plus three qualitative gates:

- **Steering:** every constant change has a ledger entry and a one-action rollback; zero "why am I
  seeing this" — every For You pick carries a reason string.
- **Editor value:** the user acts on (saves, comments on, or references) at least one memo through-line
  per week — tracked via the event log, reported by the loop itself.
- **Scale:** search indexed; no request re-parses the corpus.

## Constraints

- All v1 constraints hold: provider session files read-only; markdown source of truth; policy-driven
  routing; monitor-first System surface.
- Claude-window rules of engagement hold: bounded scheduled drains, no daytime burst backfills, Sonnet
  for library work, circuit breakers on. New v2 agent passes must fit inside the existing nightly/early-
  morning idle envelope.
- No auto-archive, no novelty/social scoring (explicitly out of scope in the eval model — unchanged).
- No online/silent learning. Evidence → proposal → approval → versioned change. Always reversible.
