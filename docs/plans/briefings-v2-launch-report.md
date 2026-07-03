# Briefings v2 — Launch Report (SKELETON — becomes the ship-gate document)

> Pre-registered 2026-07-02 so every claim slot + evidence source is fixed BEFORE the evidence
> lands (no post-hoc goal-shifting). Filled progressively; delivered to Justin when §5's checklist
> is green. Normative bars: implementation plan §4. Rubric: briefings-v2-grading-rubric.md.

## 1 · Retro sweep evidence (Phase 4)

| Metric | Bar | Round 1 (confounded) | **Round 2 (fixed harness — LAUNCH NUMBERS)** | Evidence |
|---|---|---|---|---|
| First-pass validity | tracked | 8/9 (89%) | **7/9 (78%)** — 05-26 under floor by 36B (Memorial-Day-thin), 06-10 memo-line rule | `launchpad-r2/*/result.json` |
| Citation integrity (mean) | ~1.0 | 0.783 | **0.836** | `launchpad-r2/grades.json` |
| Fabrication count | **0 (blocker)** | 1 (Emory parking) | **1** ("yesterday's 90-minute session", 05-05 — invented duration, low-materiality; GRANULARITY rule added, see below) | grades |
| Selection score (mean) | judged | 0.769 | **0.811** | grades |
| Escalation sanity (mean) | ≥ 0.8 | 0.939 ✓ | **0.922 ✓** | grades |
| Win/loss vs shipped | favor v2 | 7W–1L–1T | **8W–1L–0T ✓** (several wins freshness-confounded in v2's favor — graders flagged each) | grades |

**Round-1 confounds (the launchpad grading caught its own harness bugs):** (a) same-day meeting
transcripts leaked into "6AM" retro traces (model cited afternoon meetings as done — counted
against citation integrity on most days); (b) the weekly-list file leaks FUTURE checkbox state
into retro traces (05-12's "critical selection miss" was actually this). Both FIXED in gather
(d=0 exclusion + git-reconstructed task list in as-of mode; verified on the regenerated 06-23
trace). Also fixed from evidence: fabrication + count-discipline rules added to CALIBRATION.

**Round-2 read (2026-07-02 night, workflow `wf_1934c41c-dcd`, 9/9 graded):** every mean moved the
right way on the fixed harness. The single fabrication is a NEW instance of a finer class than
Emory parking: a decorative invented specific ("90-minute session" from a start-timestamp-only
filename). Two recurring non-fabrication citation classes: (a) schedule-overlap asserted as fact
from start-times-only (05-19, 06-23 — calendar feed has no durations); (b) weekday arithmetic
slips on derived dates (06-16). ALL THREE now have CALIBRATION rules (GRANULARITY + DERIVED
DATES, added post-round-2); 05-05 re-run verification below. Residual known limits, graded as
input gaps not model error: live-only sources (reminders, live task-state, calendar labels) are
honestly absent from as-of traces — several graders noted the live briefing saw things no retro
can reconstruct, and vice versa (freshness confound flagged per-day in grades).
**Post-rule verification (05-05 regenerated + strict fabrication-only re-check):** the caught
classes did NOT recur — no invented duration, no commit miscounts, no status inversion. Strict
reading still found residual decorative specifics (a vendor attribution invented from a save
filename — "Anthropic Agents SDK", likely wrong; one derived end-time "1:45–3:00 PM"; one
ambiguous sprint-anchor parse). GRANULARITY extended again (entity attributions + end times).
**Honest gate state: fabrication=0 is NOT green tonight.** Prompt rules demonstrably reduce each
caught class but don't reach zero by prompt alone; the blocker bar is measured where it counts —
the graded shadow week with the tightened prompt, before cutover. Residual class observed so far
is decorative-minor (durations/attributions), never invented events, tasks, or meetings.

## 2 · Extractor evidence (Phase 5 gate)

| Metric | Bar | Round 1 (prompt v1) | **Round 2 (prompt v2 — GATE)** | Evidence |
|---|---|---|---|---|
| Precision (core∪gray) | ≥ 0.85 | 0.993 (152TP/1FP) | **0.957 ✓** (200TP/9FP) | `extractor-eval-v2` report |
| Recall (core) | ≥ 0.75 | 0.628 ✗ | **0.792 ✓** (179/226) | same |
| Identity: duplicate suspects | ~0 | 3 pairs (one triplet) | **2 pairs**; 9 sightings | same |
| Catch-phrase recall | ≥ 0.95 | — | **unmeasurable on this gold set**: zero phrase-positive commitments among the 293 (nobody said "action item:" in the 36 sampled meetings). Deferred to production telemetry — spans are logged per meeting; measure when ≥10 phrase-positive cases accumulate. | gold set |

**GATE MET (2026-07-02 night).** Prompt v2 (two-pass note+transcript sweep, uncertainty→lower-
confidence-not-omission, other-attendee commitments) bought **+0.164 recall for −0.036 precision**
— both comfortably above bars. The 9 FPs and 47 remaining misses skew toward dialogue-implied
next-cycle work (the gray zone the verdict gate absorbs by design).

If bars miss → prompt iteration (documented here per attempt) → re-eval.
**Iteration 1 (2026-07-02):** diagnosis = note-anchoring + conservatism suppressing uncertain-but-real
extractions. Prompt v2: mandatory two-pass (note, then full-transcript sweep), conservatism reframed
(uncertainty → lower confidence, not omission), other-attendee commitments explicit. Re-eval queued
(fresh eval home; judge is resumable; crash-safe extraction now persists per meeting).

## 3 · Flywheel round-trip evidence (§6)

- [x] Verdict round-trip: verdicts applied to ledger at run start (code path; exercised in smoke)
- [x] Feedback capture → consumption → stamp (v1 read-adjust-stamp wired 2026-07-02)
- [x] **End-to-end sim VERIFIED (2026-07-02 night)**: claude-sim verdict posted via the real API →
  next production run applied it (entry `dropped`, note recorded); unknown-id verdict absorbed
  without crash; claude-sim feedback consumed into every extraction call that run + stamped
  `processed`. Store records re-authored claude-sim post-API (the HTTP surface stays justin-only).
- [~] Justin's first real FEEDBACK flowed 2026-07-02 night (`fb-...7l4t`, the surface critique,
  recorded to the briefing loop). First real VERDICTS: shadow week.

## 4 · Ops evidence (shadow period)

- [ ] Loops complete before gather ≥95% of shadow days (runtime artifacts are the receipts)
- [ ] Every failure surfaced same-morning by the runtime loop (zero silent failures)
- [ ] First-pass briefing validity through the shadow week
- [ ] Couldn't-fetch / couldn't-parse inventory (accumulated from loop health notes + this session:
  reminders under launchd TCC; session/area mtimes historically unreconstructable; named-speaker
  diarization absent from transcripts — owner attribution leans on note parentheses)

## 5 · Cutover checklist (nothing left behind — every remaining scope item, explicitly gated)

**Gated on evidence (auto-accumulating):**
- [~] §1 grading complete (rounds 1+2 done; 8W–1L–0T, means all improved); fabrication = 0 NOT yet
  green — residual decorative-minor class after three rule iterations; measured on the graded
  shadow week before cutover
- [x] §2 extractor bars met — **precision 0.957 / recall 0.792** (2026-07-02 night, prompt v2)
- [x] Goals-loop retro spot-verify (4 as-of weeks + refuter pass) — **DONE 2026-07-02 night.**
  4 as-of weeks (06-09/16/23/30, fixed as-of ledger filter, per-week evidence dumps), adversarial
  refuter per week (`wf_a3cb5862-188`): **53 claims → 46 supported / 6 overstated (count-rounding
  class) / 0 unsupported / 1 fabricated**; escalation sanity 4/4 weeks. The fabrication (06-30:
  commit message embellished with invented touched-file paths) → granularity rule added to
  GOALS_SYSTEM (cite exactly what the evidence line contains); **06-30 re-run + spot-refute:
  12 claims → 11 supported / 1 overstated / 0 fabricated — fix verified.** Goals loop stays
  `shadow`; its artifacts don't feed the briefing until live.
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
