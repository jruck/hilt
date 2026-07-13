# Briefings v2 — Implementation Plan

> **Current remaining work:** this is the original 2026-07-02 execution contract. The authoritative
> cleanup-first roadmap for the current production system is
> [Briefings v2 — Completion Roadmap](./briefings-v2-completion-roadmap.md).
>
> **Status:** Ready to execute — written 2026-07-02, after the scope was finalized and all open
> questions closed by interview.
> **Canonical design scope (read first, it is normative):** `docs/plans/briefings-v2-loop-of-loops.html`
> (rendered at `https://mercury-v.tailc0acaa.ts.net/plans/briefings-v2.html`). This plan does not
> restate the design; it operationalizes it. Where this plan and the scope disagree, the scope wins
> and this plan gets fixed.
> **Executor:** a Claude Fable session in this repo, with the `codex@openai-codex` plugin
> (`/codex:*` commands) and the Workflow tool available. Vault at `/Users/jruck/work/bridge`.

---

## 0 · The Goal

> **Build the multi-loop briefing system described in the scope, prove it works against history
> and against live reality, and hand it to Justin for daily use — with a written launch report
> demonstrating that its outputs are accurate within the quality bars below, its loops are
> self-reporting, its feedback/verdict flywheel round-trips end to end, and the shadow comparison
> consistently favors v2 over the current briefing.**

Done means all of:

1. Every **initial loop** (library, runtime, meeting-actions, goals/areas, calendar/tasks,
   briefing-renderer) runs on schedule, writes contract-conforming artifacts, self-reports health,
   and appears in the registry.
2. The **launchpad evidence** exists: retro sweep graded three ways, gold-set extraction metrics at
   or above the provisional bars (§4), identity + reconciliation tests passing, flywheel round-trip
   proven with `claude-sim` engagement through the real capture paths.
3. The **shadow period** ran with the side-by-side UI, and the v2 briefing won the comparison on the
   grading rubric — not by assertion, by recorded daily grades.
4. The **launch report** is written and delivered: coverage, metrics, couldn't-fetch/couldn't-parse
   inventory, interface walkthrough, and the builder's explicit verdict ("here's why I believe in
   it" — or what's still blocking, honestly).
5. Justin flips the cutover after reading it. Handoff = Justin uses it daily and fine-tunes through
   the feedback system; the builder's job shifts from construction to responding to tuning
   proposals.

**This goal is the root of every session.** A fresh session starts by reading the scope, this plan,
and the phase state (§7), then continues from the first unmet gate.

---

## 1 · Operating model

### 1.1 Roles

| Actor | Owns |
|---|---|
| **Fable (this session)** | Orchestration, scoping, sequencing; all **judgment artifacts** — schemas/contracts, prompts (extractor, synthesis, health passes), grading rubrics, escalation semantics, SKILL.md prose; all **evaluation** (grading retro output, reviewing Codex diffs, the launch report); anything that **touches the live vault, the live briefing, or SKILL.md**; final call on every commit. |
| **Codex** (`/codex:*`) | Deterministic, well-specified implementation once Fable has pinned the interface: parsers, IO libs, migration scripts, schedulers-from-existing-patterns, UI components from a written spec, test scaffolding, plumbing (`--as-of` threading). Plus **independent review** of Fable-authored risky diffs. |
| **Workflows** (dynamic) | Fan-out and adversarial verification: parallel labeling, retro-sweep generation + grading pipelines, multi-lens verification of launch-report claims. |
| **Justin** | Verdicts on anything escalated during the build; the shadow-period comparison; reads the launch report; flips cutover. Per the interview: not involved in launchpad calibration — the builder optimizes on general quality principles, not Justin's nuance. |

### 1.2 Codex delegation rules

The dividing line: **if the task's correctness can be verified mechanically (types, tests, a
written spec), delegate it. If correctness requires judgment about meaning, keep it.**

**Delegate to `/codex:rescue --background` (default for multi-file):**
- Registry parser + validator; artifact reader/writer; surfacing-state store; verdict/feedback log
  IO — after Fable writes the schema and the test cases.
- Migration scripts (`meta/library-reports/` → `meta/loops/references/reports/`, memo move,
  `/api/reports/*` re-point) — mechanical moves with parity checks.
- `--as-of` + sandbox-write plumbing threaded through loop runners.
- Launchd scheduler wiring for new loops (the pattern exists: `scripts/briefing-scheduler.ts`,
  `launchd-scheduler.ts`).
- Hilt UI components built to a Fable-written spec (verdict buttons, feedback affordance,
  side-by-side view) — Fable specs the interaction + data contract, Codex builds, Fable reviews
  against the design system (`docs/DESIGN-PHILOSOPHY.md`).
- Test scaffolding and fixture generation.
- `--model spark` for mechanical fixes, small refactors, lint-level cleanups.

**Never delegate:**
- Prompt text of any loop (extraction, synthesis, health passes) — this is the product.
- Grading rubrics and eval judgment; anything in the launch report.
- SKILL.md changes; escalation/urgency semantics; ledger reconciliation *logic design*
  (Codex may implement the designed algorithm).
- Anything writing to the **live** vault paths before Phase 8 cutover.

**Review discipline:**
- Every multi-file diff (Fable- or Codex-authored) gets `/codex:review --background` before commit.
- **Mandatory adversarial gate** — `/codex:adversarial-review --background "<named risk>"` must
  clear before committing: ledger reconciliation code (risk: silently closing live commitments),
  anything with vault write paths (risk: writing outside sandbox/meta), the cutover diff
  (risk: breaking the daily briefing), migration scripts (risk: data loss).
- Fable reads every Codex diff before commit. Codex writes; Fable judges. No auto-merge.
- Background by default; never stall the main thread on a Codex job — poll `/codex:status`.

### 1.3 Dynamic workflows — where to use them

- **Gold-set labeling (Phase 4):** fan out one agent per historical meeting (~30) to extract
  candidate commitments; Fable adjudicates the labels. Do not label serially.
- **Retro sweep (Phase 4):** pipeline per representative day — generate-as-of → grade vs. source →
  grade vs. shipped briefing → grade vs. subsequent reality. Days run concurrently.
- **Launch-report verification (Phase 8):** adversarial panel per major claim ("extraction P/R is
  X", "no fabrication in N briefings") — verifiers attempt to refute from the traces.
- Rule: workflows for **fan-out and verification**; inline Fable work for sequential judgment.
  Don't spawn a workflow for what one careful pass does better.

### 1.4 Global gates & ground rules

- **Shadow-first, always:** until the Phase 8 gate, nothing writes to live vault content paths or
  the live briefing. Loops under development write to the sandbox (generalized `--shadow`).
  `meta/loops/**` is the loops' own space and is writable once Phase 1 lands.
- Two repos: **hilt** (runtime code: `scripts/`, `src/lib/`, UI, schedulers) and **bridge**
  (registry, prompts/skill prose, artifacts, ledgers). Per-loop commits in bridge (per interview);
  normal commit discipline in hilt. Provider session stores stay read-only.
- Every phase ends: `npx tsc --noEmit` clean, relevant suites green (`test:briefing`,
  `test:library`, new `test:loops`), CHANGELOG entry, `npm run rebuild` if app code changed.
- Budget (per interview): **adaptive** — Opus-class for judgment-heavy loop prompts during the
  launchpad; measure quality-per-token; tune each loop down to the cheapest tier that holds its
  grades; record the envelope in the registry.
- When a scope question emerges that the scope doesn't answer: small + reversible → decide, note in
  the phase log; material → escalate to Justin (that's what he's for).

---

## 2 · Repo & runtime map

| Thing | Lives | Notes |
|---|---|---|
| Loop runner lib (contract, registry, items, artifacts IO) | hilt `src/lib/loops/` | new; sibling of `src/lib/briefing/` |
| Loop runner scripts + schedulers | hilt `scripts/loop-*.ts` | mirror `briefing-generate.ts` / `briefing-scheduler.ts` patterns |
| Registry | bridge `meta/loops/registry.yml` | scope §5 |
| Loop artifacts / state / feedback / verdicts | bridge `meta/loops/<domain>/…` | scope §5 uniform inner shape |
| Loop prompts | bridge `meta/loops/<domain>/prompt.md` (or skill-style dir) | judgment in prose, Fable-authored |
| Briefing skill | bridge `meta/skills/briefing/` | thinned in Phase 7; per-loop prose stays bounded |
| Launchpad harness + grading | hilt `scripts/launchpad-*.ts` + workflows | sandbox under `$DATA_DIR/loops-shadow/` |
| UI (verdict/feedback/side-by-side) | hilt `src/components/briefings/`, API routes | spec'd by Fable, built by Codex |

Existing infra to reuse, not rebuild: `briefing-generate.ts` (gather→skill→claude -p→validate→
commit), `--shadow`, `briefing-scheduler.ts`/`launchd-scheduler.ts`, `hilt-launchd-npm.sh` (auth +
keys — note `forcedTokenEnv` lesson), Granola transcript ingestion, library steering/report/memo,
library-feedback + review-queue (the verdict-system migration source), `SendUserFile`/tailnet
serving for reports.

---

## 3 · Phases

Sequential gates; work within a phase parallelizes freely. Each phase logs to
`docs/plans/briefings-v2-phase-log.md` (running builder's log: decisions, deviations, Codex jobs,
gate evidence) — that file is how a fresh session knows where things stand.

### Phase 0 — Native briefing cutover (prerequisite)
Land the in-flight migration so v2 has one home. Verify shadow parity for 2–3 days
(`briefing:shadow` output vs. Hermes daily), then `briefing:scheduler:install -- --variant live`,
retire the Hermes cron, keep retry-watch equivalent.
**Gate:** live briefing generated natively ≥2 consecutive days, no quality regression (Fable
side-by-side read), Hermes job disabled.
*Codex: none (operational). Risk gate: cutover diff → adversarial review.*

### Phase 1 — Contract, registry, schemas (the shared primitives)
Item schema (insight/action/proposal + properties), escalation view, health section, citation,
feedback + verdict records (with `author`), surfacing state, registry format. A validating
reader/writer in `src/lib/loops/` with round-trip tests. `--as-of` + sandbox semantics defined in
the contract. Registry seeded with the loops from the scope inventory.
**Gate:** `test:loops` green; a hand-written fixture artifact validates; an invalid one fails
loudly; registry parses; contract spec section added to the scope doc if anything was refined.
*Codex: IO/parser/validator implementation from Fable's schema + test cases. Fable: the schemas.*

### Phase 2 — Library conformance (loop #1, proves the shape)
Wrap the existing steering/report/memo into one contract-conforming artifact at
`meta/loops/references/reports/`; migrate history + memos; re-point `/api/reports/*`; steering
proposals emitted as `proposal` items (the verdict-system prototype).
**Gate:** morning report renders in briefing + Library UI exactly as before (parity check);
old paths gone; library loop registered; its health section populated from real steering data.
*Codex: migration script + API re-point (parity-checked). Fable: artifact mapping decisions.*

### Phase 3 — Runtime loop
Registry-driven absence detection, substrate checks (supervisor, launchd job outcomes, sync, disk,
credentials incl. token/key expiry probes, TCC), cross-loop health digest. First **new** loop —
exercises contract, scheduler, per-loop commits end to end.
**Gate:** kill a test loop's schedule → next runtime artifact flags it; substrate checks verified
against known-good and one induced failure; artifact renders as a briefing section in shadow.
*Codex: checks implementation from Fable's checklist. Fable: what constitutes "unhealthy".*

### Phase 4 — Launchpad harness (before the meeting loop)
`--as-of` + sandbox generation for the full stack; retro sweep (1 day/week × ~8 weeks); three-way
grading rubrics + runners; gold-set labeling workflow (~30 meetings, Fable-adjudicated); the
identity + reconciliation test cases extracted from history.
**Gate:** one full retro day runs end to end and produces a graded report; gold set labeled and
frozen; grading rubric documented (it becomes the shadow-week rubric).
*Codex: harness plumbing. Fable: rubrics, adjudication. Workflows: labeling + sweep fan-out.*

### Phase 5 — Meeting-action ledger v1 (the centerpiece)
Extractor loop on new transcripts (sibling of briefing-generate); append-only ledger with item
identity; reconciliation pass; "Action item:" scan (validated against real transcripts);
escalations as the "awaiting your verdict" block; **minimal verdict capture** (approve / dismiss /
assign / revise on escalated asks in the Hilt briefing view + verdict log round-trip); injection
discipline in the extractor prompt.
Develop **against the gold set from day one**; iterate prompt + reconciliation until bars (§4) are
met on held-out meetings.
**Gate:** §4 extraction bars on held-out gold data; identity test (restated commitment → one
entry); reconciliation test (provably-completed → closed); verdict round-trip proven (sim verdict
→ next run acts); catch-phrase detection verified on real transcripts.
*Codex: ledger IO, scan, scheduler, verdict UI from spec. Fable: extractor + reconciliation
prompts/design. Adversarial gate: reconciliation logic.*

### Phase 6 — Goals/areas loop
Derived loop: stated North Stars/goals vs. observed attention (ledger, commits, meetings, library,
calendar). Escalates contradictions with evidence; never enumerates every goal.
**Gate:** retro-run over the last 4 weeks produces alignment reads Fable judges defensible from the
cited evidence (spot-verified via workflow refuters); renders in shadow briefing.
*Codex: attention-aggregation plumbing. Fable: the judgment prompt.*

### Phase 7 — Reader thinning + full feedback surface
SKILL.md → generic per-loop rule + bounded per-loop prose (per interview); top fold = escalated
items union with computed aging + visible model overrides; calendar/tasks conformance; **feedback
affordance on every rendered item** (citation anchoring), routed to owning loops; briefing
registers as a loop (surfacing state, render-quality health); **side-by-side v1/v2 toggle UI**.
**Gate:** shadow briefing built purely from loop artifacts (zero raw-domain judgment in gather for
conformed loops); feedback round-trip: sim feedback on a content bullet → owning loop's next health
pass ingests it → proposal emitted; side-by-side UI usable (Fable walkthrough, screenshots in
phase log).
*Codex: UI + gather rewiring from spec. Fable: SKILL.md prose, anchoring validation.*

### Phase 8 — Shadow period → launch report → cutover
Full system runs nightly in shadow alongside live v1. Builder grades daily with the Phase 4 rubric
+ files sim feedback/verdicts (`claude-sim`). When grades are stable and the goal's conditions are
met: write the **launch report** (contents per scope §10), verify its claims via adversarial
workflow panel, deliver to Justin (tailnet-served, like the scope). Justin reads → shadow-review
period with the side-by-side UI begins (his heavy-feedback week, 80→98) → he flips cutover.
**Gate = the Goal (§0).** Post-cutover: v1 path retired, runtime loop watches everything, builder
moves to responding to tuning proposals.

---

## 4 · Provisional quality bars

Set now to make "accurate within reasonable bounds" concrete; **revisable with evidence** — the
launch report may argue for different bars, but must do so explicitly against these:

- **Extraction (gold set, held-out):** precision ≥ 0.85 (a surfaced commitment is real),
  recall ≥ 0.75 (real commitments get caught). Catch-phrase captures: recall ≥ 0.95.
- **Identity:** restated commitments collapse to one entry in ≥ 0.9 of gold cases.
- **Citation integrity (any briefing):** 100% of items carry a resolvable citation; **zero
  fabricated items** across the retro sweep + shadow period (fabrication = launch blocker, full stop).
- **Escalation sanity (retro, judged):** ≥ 0.8 of escalated items defensibly warranted attention;
  no known-critical misses in graded days.
- **Ops:** loops complete before gather ≥ 95% of shadow days; every failure surfaced by the runtime
  loop the same morning (silent failure = launch blocker).

## 5 · Top risks

1. **Extraction/reconciliation quality plateaus below bars** → the gold set exists precisely to
   discover this early (Phase 5, not Phase 8); mitigation: confidence tiering — ship v1 surfacing
   only high-confidence + phrase-triggered items, widen as measured quality allows.
2. **Rate limits / overnight contention** (proven: reweave outage) → stagger schedule, degradation
   policy, runtime-loop absence detection; `forcedTokenEnv` pattern for all headless `claude` calls.
3. **Sandbox leaks** — a developing loop writing live paths → contract-level write guard (loop
   runner refuses non-sandbox writes unless registered + phase-flagged live), adversarial review on
   write-path code.
4. **Scope creep** — the scope's "not building" list is binding (§6 below); new ideas go to the
   phase log as post-launch candidates.

## 6 · What NOT to build (binding negative space, from the scope)

No separate weekly edition. No standalone escalation-queue system. No drift loop (absorbed:
ledger aging + goals). No people loop (projection of meetings; People view composes at render
time). No dated person snapshots; person notes never machine-churned. No realtime meeting
processing. No auto-accept — not until measured hit rates earn it, post-launch. No flattening of
the library's item-level feedback machinery. No new UI surfaces beyond: verdict buttons, feedback
affordance, side-by-side toggle.

## 7 · Session bootstrap & state

Fresh session: read (1) the scope HTML, (2) this plan, (3) `docs/plans/briefings-v2-phase-log.md`
(create on first session), (4) skim `scripts/briefing-generate.ts` + `meta/skills/briefing/`.
Then: state which phase/gate is active, and continue. Keep the phase log current — it is the
project's memory across sessions. Use `/codex:status` to re-attach to any background jobs.
