# Briefings v2 — Launch Report (SKELETON — becomes the ship-gate document)

> Pre-registered 2026-07-02 so every claim slot + evidence source is fixed BEFORE the evidence
> lands (no post-hoc goal-shifting). Filled progressively; delivered to Justin when §5's checklist
> is green. Normative bars: implementation plan §4. Rubric: briefings-v2-grading-rubric.md.

## 1 · Retro sweep evidence (Phase 4)

| Metric | Bar | Result | Evidence |
|---|---|---|---|
| First-pass validity | tracked | **8/9 (89%)** vs 33% pre-fix live | `$DATA_DIR/launchpad/*/result.json` |
| Citation integrity (mean) | ~1.0 | **0.783 (round 1 — CONFOUNDED, see below)** | `$DATA_DIR/launchpad/grades.json` |
| Fabrication count | **0 (blocker)** | **1** ("Emory parking eats 20 minutes", 06-23 — real; prompt rule added, re-sweep pending) | grades |
| Selection score (mean) | judged | 0.769 (round 1, confounded) | grades |
| Escalation sanity (mean) | ≥ 0.8 | **0.939 ✓** | grades |
| Win/loss vs shipped | favor v2 | **7W–1L–1T ✓** | grades |

**Round-1 confounds (the launchpad grading caught its own harness bugs):** (a) same-day meeting
transcripts leaked into "6AM" retro traces (model cited afternoon meetings as done — counted
against citation integrity on most days); (b) the weekly-list file leaks FUTURE checkbox state
into retro traces (05-12's "critical selection miss" was actually this). Both FIXED in gather
(d=0 exclusion + git-reconstructed task list in as-of mode; verified on the regenerated 06-23
trace). Also fixed from evidence: fabrication + count-discipline rules added to CALIBRATION.
**Re-sweep + regrade queued behind the extractor eval** — round-2 numbers are the launch numbers.

## 2 · Extractor evidence (Phase 5 gate)

| Metric | Bar | Result | Evidence |
|---|---|---|---|
| Precision (core∪gray) | ≥ 0.85 | **0.993 ✓** (152 TP / 1 FP) — round 1 | `$DATA_DIR/launchpad/extractor-eval/report.json` |
| Recall (core) | ≥ 0.75 | **0.628 ✗** round 1 → segmented: next-steps 0.789 / note-body 0.467 / **transcript-only 0.377**; justin-owned 0.721 | same |
| Identity: duplicate suspects | ~0 | 3 pairs, all one 06-30 triplet; 10 sightings recorded | same |
| Catch-phrase recall | ≥ 0.95 | ⏳ needs phrase-positive subset analysis | gold set spans |

If bars miss → prompt iteration (documented here per attempt) → re-eval.
**Iteration 1 (2026-07-02):** diagnosis = note-anchoring + conservatism suppressing uncertain-but-real
extractions. Prompt v2: mandatory two-pass (note, then full-transcript sweep), conservatism reframed
(uncertainty → lower confidence, not omission), other-attendee commitments explicit. Re-eval queued
(fresh eval home; judge is resumable; crash-safe extraction now persists per meeting).

## 3 · Flywheel round-trip evidence (§6)

- [x] Verdict round-trip: verdicts applied to ledger at run start (code path; exercised in smoke)
- [x] Feedback capture → consumption → stamp (v1 read-adjust-stamp wired 2026-07-02)
- [ ] End-to-end sim: claude-sim feedback via the REAL API → next extractor run consumes → health
  notes it ← run during shadow week
- [ ] Justin's first real verdicts flow through (shadow week)

## 4 · Ops evidence (shadow period)

- [ ] Loops complete before gather ≥95% of shadow days (runtime artifacts are the receipts)
- [ ] Every failure surfaced same-morning by the runtime loop (zero silent failures)
- [ ] First-pass briefing validity through the shadow week
- [ ] Couldn't-fetch / couldn't-parse inventory (accumulated from loop health notes + this session:
  reminders under launchd TCC; session/area mtimes historically unreconstructable; named-speaker
  diarization absent from transcripts — owner attribution leans on note parentheses)

## 5 · Cutover checklist (nothing left behind — every remaining scope item, explicitly gated)

**Gated on evidence (auto-accumulating):**
- [ ] §1 grading complete, fabrication = 0
- [ ] §2 extractor bars met (or explicitly re-argued with data)
- [ ] Goals-loop retro spot-verify (4 as-of weeks + refuter pass) — queued behind extractor eval
- [ ] ≥5 shadow-v2 mornings generated + compared

**Gated on Justin using it (the shadow review):**
- [ ] Justin reads Compare view across several mornings; heavy feedback via the panel (80→98)
- [ ] Justin's verdicts flowing (approve/dismiss hit-rate starts accumulating)
- [ ] The shadow comparison "consistently favors v2" by his read + the grades

**Executed AT cutover (the flip itself — one session, ~an hour):**
- [ ] Registry: briefing loop enabled; meeting-actions/goals-areas → phase live (artifacts+state
  migrate sandbox→vault via a copy script, same pattern as the library migration)
- [ ] Live briefing gains `--loops` (scheduler arg change) + shadow-v2 job retired
- [ ] gather.sh: remove now-redundant legacy sections that loop artifacts replace (library report
  cat → covered by the LOOP ARTIFACTS section; meetings excerpts → ledger/artifact)
- [ ] SKILL.md: thin per-domain prose to the bounded per-loop lines (interview decision)
- [ ] `/api/reports/morning` re-point to `meta/loops/references/reports/` + legacy
  `meta/library-reports/` writer retired from steering (single-write)
- [ ] Old-path retirement: gather's legacy library lines, `references/process/memos/` writer
  re-pointed (memo files to the loop home), MIGRATED.md pointers verified
- [ ] Hermes jobs: decide remove vs keep-paused (D-004 revisit)
- [ ] Update scope HTML + implementation plan status; final phase-log entry

**Justin-only (independent of cutover):**
- [ ] P0-g: remove fossil `/usr/local/bin/claude` (+ its npm root) — his call
- [ ] Disk: Mercury-V at 5.8% free (verified real; hunt running) — clear space
- [ ] Series workstream commit (carries two one-line riders)

## 6 · Builder's verdict

⏳ — written last, against everything above: "here's why I believe in it" or what's still blocking.
