# Briefings v2 — Grading Rubric (launchpad + shadow week)

> Fable-authored, normative for Phase 4 retro grading and the Phase 8 shadow-week comparison.
> Grades are written to `$DATA_DIR/launchpad/<date>/grade.json`. The launch report aggregates them
> against the quality bars (implementation plan §4).

## The three-way grade, per day

### A · Integrity vs. source data (the gather trace)
Graded against `gather.txt` — exactly what the model saw.

- **A1 Citation integrity** (0..1): every headline bullet carries a citation, and the cited
  source/claim is actually present in the gather data (or is a well-known standing fact from prior
  briefings included in the trace). Violations listed verbatim.
- **A2 Fabrication** (bool): ANY material claim not traceable to the trace = `true` = automatic
  day-fail and a launch blocker (plan §4). Distinguish fabrication (invented fact) from
  *interpretation* (defensible synthesis of present facts) — interpretation is the model's job.
- **A3 Selection** (0..1 + lists): the grader independently lists the ~10 most significant items in
  the trace, then scores what fraction surfaced in the briefing. Judged misses listed with severity
  (critical / notable / minor). Omitting the insignificant is CORRECT behavior — only judged-
  significant items count as misses.
- **A4 Structural validity** (mechanical, from `result.json`): pass/fail + failures. First-pass
  validity is a tracked metric — an invalid draft is still graded on A1–A3 (it's the model's real
  first-pass product).

### B · Comparative vs. the briefing that actually shipped that morning
`briefings/<date>.md` in the vault (Hermes-era for retro dates).

- **B1 Coverage deltas**: items each surfaced that the other missed (list, with significance).
- **B2 Verdict**: win / loss / tie for the retro briefing, with a 2–3 sentence justification
  focused on decision-usefulness for that specific morning.
- **Caveat to apply**: shipped briefings from 2026-06-20 onward (Hermes on frozen Hestia inputs)
  were generated from stale data — note when a "win" is explained by input freshness rather than
  synthesis quality.

### C · Foresight vs. subsequent reality
Read the NEXT 7 days after the date: `lists/now/*` (the following week's list), `meetings/<d>/*`
titles + Next Steps, git log of the repos, the following briefings.

- **C1 Escalation sanity** (0..1): fraction of the briefing's urgent items ("Don't drop this",
  deadline flags) that subsequent reality shows genuinely warranted attention (acted on, slipped
  with consequences, or repeatedly resurfaced).
- **C2 Critical misses** (list): things the subsequent week shows SHOULD have been flagged that
  day (a deadline that slipped painfully, a commitment that aged) but weren't in the briefing —
  only when the evidence was present in the trace (A-scope): a miss the data couldn't support is
  an input gap, recorded separately as `input_gaps`.

## Grade record schema

```json
{
  "date": "YYYY-MM-DD",
  "validity": { "pass": true, "failures": [] },
  "citation_integrity": { "score": 0.95, "violations": [] },
  "fabrication": false,
  "selection": { "score": 0.8, "misses": [{ "item": "…", "severity": "notable" }] },
  "vs_shipped": { "verdict": "win|loss|tie", "notes": "…", "freshness_confound": false },
  "vs_reality": { "escalation_sanity": 0.85, "critical_misses": [], "input_gaps": [] },
  "overall_notes": "…"
}
```

## Grading discipline

- The grader reads the FULL trace before the briefing (blind-first: list significant items BEFORE
  reading the briefing, to keep A3 honest).
- Quote evidence for every violation/miss — no unquoted judgments.
- Calibration boundary (per Justin, scope §10): grade on general quality principles — accuracy,
  citation integrity, no fabrication, sane escalation — NOT on guessing Justin's personal taste.
  Taste calibration happens live, through the feedback system.
- Aggregation for the launch report: per-dimension means + worst-day, first-pass validity rate,
  fabrication count (must be 0), win/loss record vs. shipped.
