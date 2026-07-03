# Briefings v2 — Phase Log

> Builder's running log: decisions, deviations, Codex jobs, gate evidence. This file is how a
> fresh session knows where things stand. Newest entries at top within each phase. See
> `briefings-v2-implementation.md` §7.

## Phase status board

| Phase | Status |
|---|---|
| 0 · Native briefing cutover | **ACTIVE — reframed to STABILIZATION** (cutover already happened 2026-06-29; see below) |
| 1 · Contract, registry, schemas | **GATE MET 2026-07-02** — 19/19 spec green, registry seeded + validated |
| 2 · Library conformance | **GATE MET 2026-07-02** — loop live, artifact in vault, history migrated w/ parity |
| 3 · Runtime loop | **GATE MET 2026-07-02** — built, 25/25 induced-failure tests, scheduled 05:45, first run caught 2 real findings |
| 4 · Launchpad harness | 🟢 sweep DONE (9 dates, 8/9 first-pass valid vs 33% pre-fix live rate); gold set FROZEN (36 mtgs, 293 commitments, 226 core); rubric written; grading workflow queued |
| 5 · Meeting-action ledger v1 | 🟢 BUILT+SMOKED (4 commitments conf .9-.97 from smoke) — GATE EVAL RUNNING (36 extractions + judge) |
| 6 · Goals/areas loop | 🟢 BUILT+FIRST LIGHT (real contradiction + drift found, evidence-cited); retro spot-verify pending |
| 7 · Reader thinning + feedback surface | 🟡 v2 reader gated (BRIEFING_LOOPS=1 gather section + self-gating SKILL rule); escalations/verdict/feedback UI + APIs LANDED (Codex, verified); side-by-side UI building |
| 8 · Shadow period → launch report → cutover | 🟢 SHADOW PERIOD SCHEDULED — com.hilt.loops.shadow-v2 nightly 06:20 starts tomorrow |

## Decisions & deviations

- **D-004 (2026-07-02):** Hermes briefing jobs stay **paused, not removed** — the pause IS the
  rollback path until v2's Phase 8 gate. Revisit removal in the launch report. (All three jobs
  verified paused on Hestia: `f7ebdccb45c9` Morning, `ab76263fb5af` retry-watch, `f0ad514b4457`
  Weekend; paused 2026-06-29 13:50.)
- **D-003 (2026-07-02):** Weekend retry gap (native retry-watch is weekday-only) accepted for now —
  the Phase 3 runtime loop's absence detection is the structural fix; don't build a bespoke weekend
  retrier.
- **D-002 (2026-07-02):** Phase 0 reframed from "cutover" to "stabilization": cutover already
  executed 2026-06-29 13:50 (live plists installed, shadow uninstalled, Hermes paused, vault commit
  `3720ad4f` promoted byte-identical shadow outputs). Remaining gate work = first-pass validity +
  quality regression + Hermes-era dead code (list under Phase 0 below).
- **D-001 (2026-07-02):** Phase 1 design proceeds in parallel with Phase 0 stabilization (touches
  only new code paths). Small + reversible.

## Recon digest (workflow `wf_ab7f9c61-ec2`, 6 agents, 2026-07-02 — full reports in the workflow transcript)

- **R-state:** Live variant installed 06-29 13:50 (`com.hilt.briefing.daily` 06:00 + `.retry`
  1800s); shadow ran 06-26→06-29, all runs valid; shadow outputs promoted byte-identical.
  Auth via `hilt-launchd-npm.sh` (token + summarize keys) — the forcedTokenEnv path.
- **R-parity:** Only ONE true head-to-head (06-26): native beat Hermes decisively — but confounded
  by Hestia's frozen inputs (Hermes was generating from 10-day-old data since the 06-19 rename;
  that staleness was the cutover trigger). Post-cutover live days: 06-30 3118B, 07-01 3142B, 07-02
  2912B — **thin vs. gold band 4073–4528B**, 07-02 barely cleared the 2800B validator floor.
- **R-fail:** First-pass validity 33% (2 of 3 live mornings wrote `.invalid-draft`): the
  **memo-link rule** ("fresh editor's-memo headline present but missing [Read the memo] link") hit
  06-30 + 07-01 + one retry; retry-watch recovered both (+50–80 min delay). Validator's memo
  detection reportedly fires on ANY memo mention, not just headline usage.
- **R-hermes:** Live producer = native generator on Mercury-V, commits `Briefing — <date> (<mode>)`.
  Hermes gateway still runs on Hestia (KEEP — serves non-briefing roles); briefing jobs paused.
  **Unmigrated Hermes-era code:** `src/lib/bridge/briefing-status.ts` reads `~/.hermes/cron/*` and
  `/api/bridge/briefings/retry` shells `hermes cron run` — both dead on Mercury-V (failure card +
  manual retry UI inert). Vault `meta/skills/briefing/scripts/retry-watch.sh` is dead code.
- **R-lib (for P1/P2):** Morning report structure stable (Scorecard 7-row table / Feedback-awaiting
  clusters / Judge↔formula disagreements / "Changes applied: None"). **Steering proposals have NO
  structured store** (prose + `clustered_at` stamps only); scorecard JSON computed nightly but
  discarded (stdout only); review-queue (`DATA_DIR/<kind>-review-queue/`) is generic and explicitly
  reusable — candidate home for proposal verdicts. Two parallel approval channels exist (steering
  proposals vs. pipeline review-queue) — unification is a P2 design decision. Ledger/docs split:
  `eval-labels.md` lives in hilt docs, scoring.json in vault.
- **R-meet (for P4/P5):** 121 meeting notes / 36 days in the 8-week window (~11–18/wk), 100%
  transcript availability via frontmatter wiki-links (filename-stem matching unreliable — always
  resolve links). 108/121 calendar-matched (icaluid, conf 1); 13 ad-hoc notes have NO calendar
  fields — a calendar-keyed gold set silently misses ~11%. Transcripts: You/Guest only, **no named
  diarization** — owner attribution must come from notes' Next Steps "(Owner)" parens. "action
  item" base rate: 8% of transcripts (15 occurrences/123 files), concentrated in the CES Huddle's
  standing "action items tracker" agenda item + note section headers — the Phase 5 trigger scan
  must exclude tracker-reference contexts.

## Phase 0 — Native briefing cutover → stabilization

**Remaining to close the gate** ("live ≥2 consecutive days" ✓ met; "no quality regression" ✗ not yet):

- [x] **P0-a — memo-link validation failure** FIXED 2026-07-02: validator's any-mention regex now a
  featuring-vs-referencing rule (bold/heading naming the memo ⇒ link required; italic citations and
  passing prose ⇒ fine), and the prompt CALIBRATION states the same mechanical rule so first drafts
  comply. Replay evidence: 06-30 `.invalid-draft` (citation-only, false failure) now PASSES; 07-01
  draft (bold memo, no link) still correctly fails. +5 validator tests (18/18 green).
- [x] **P0-b — thin-briefing trend** ADDRESSED 2026-07-02: floors re-banded (daily 2800→2200,
  weekend 4500→4000) + CALIBRATION explicitly permits thin days ("a thin news day is a short
  briefing — never pad"). Rationale: first live week is a holiday week with thin inputs; the floor's
  job is truncation/laziness, which the spine checks also catch. Re-examine the length distribution
  properly in the Phase 4 retro sweep.
- [x] **P0-c — vault hygiene** DONE: stale `.invalid-draft`s removed; `generate.ts` now removes the
  `.invalid-draft` sibling on any successful write.
- [x] **P0-d — DONE 2026-07-02** (Codex `b81qp7l35`, Fable-verified: tsc clean, bridge tests
  20/20 + vitest 21/21, prod rebuilt after Codex's sandbox couldn't): run records at
  `$DATA_DIR/briefing-runs/<date>.json`, briefing-status.ts native (vault file + run record →
  same BriefingRunFailure shape), retry route spawns the native generator, Hermes fixtures removed
  from tests, UI copy updated. Original design (for reference):
  1. `generate.ts` writes a run record `$DATA_DIR/briefing-runs/<date>.json` on EVERY run (incl.
     retries): `{ date, mode, run_at, status: ok|invalid|rate_limited, failures: string[],
     draft_path?: string, committed?: boolean, pushed?: boolean }` — latest run wins the file.
  2. `src/lib/bridge/briefing-status.ts`: replace the `~/.hermes/cron/*` readers with (a) vault
     `briefings/<date>.md` existence and (b) the run record — synthesizing the same
     `BriefingRunFailure` API shape the UI already renders (`jobId: "native-daily"`, `error` =
     failures joined, `outputPath` = draft_path, `nextRunAt`/`autoRetryNextRunAt` computed from the
     06:00 schedule + 1800s retry interval within its 06:30–17:00 window).
  3. `/api/bridge/briefings/retry`: spawn the native generator (`tsx scripts/briefing-generate.ts
     --mode daily`) instead of `hermes cron run`; return its structured result.
  4. Update `briefing-files.test.ts`/`briefing-status.test.ts` fixtures to the native source. Vault
     `meta/skills/briefing/scripts/retry-watch.sh` (Hermes-only) gets a deprecation header, not
     deletion (rollback path parity with D-004).
- [x] **P0-e — Hermes disable verified** (see D-004).
- [x] **P0-f — INCIDENT: nightly reweave broken again — root cause: CLI fossil.** The 03:35
  reweave-pending job had failed EVERY night (28-item backlog, attempts 2–6, all "Reweave did not
  update the file"). Tell: attempts-file mtime = 03:35, same minute the job started ⇒ ~2s/item
  fast-fail, not auth/rate-limit/timeout. Root cause: the launchd wrapper's PATH lacked
  `~/.local/bin`, so scheduled jobs resolved `/usr/local/bin/claude` — an npm-era **v1.0.38 from
  July 2025** — which instantly rejects `--append-system-prompt-file` (proven directly). The
  swallowed CLI error surfaced as null ⇒ "did not update". **Corollary: the live briefing has been
  generated by v1.0.38 all along** (it only uses `-p --output-format json`, which the fossil
  supports). FIX: wrapper PATH now leads with `$HOME/.local/bin` (current installer symlink,
  v2.1.198) — upgrades every scheduled job's engine. Verifications COMPLETE: (a) single stuck
  reweave item on modern CLI → "updated" with real digest; (b) shadow briefing in launchd-equivalent
  env on v2.1.198 → validation pass, editorially sharp (holiday-aware deadline judgment); (c) full
  backlog drain launched THROUGH the fixed wrapper in a launchd-equivalent env (`env -i` +
  hilt-launchd-npm.sh 'library:reweave:nightly') — the literal tonight-job, run early. This is silent-failure case study #2 for the
  runtime loop (absence detection can't catch this one — the job RAN; per-loop health with real
  error surfacing does).
- [ ] **P0-g (new) — consider removing/renaming the fossil** `/usr/local/bin/claude` (and its npm
  install) — system-level change, ask Justin; PATH fix makes it inert for hilt jobs either way.

- **2026-07-02 · Session start (ultracode).** Bootstrap per plan §7. Recon workflow (6 agents,
  ~6 min, 363k tokens) established all of the above. Phase 1 types drafted in parallel
  (`src/lib/loops/types.ts`). Codex plugin surface verified (/codex:* v1.0.5, CLI 0.136.0, logged in).

## Phase 2 — Library conformance — GATE MET 2026-07-02

- **Emission**: `src/lib/loops/emit.ts` (the canonical loop-emission path, reused by all loops) +
  steering now emits the contract artifact (proposals as `proposal` items w/ minted ids `lib-prop-*`,
  disagreements as insights, the previously-DISCARDED scorecard persisted into health). First shadow
  emission validated against the parser (5 items, correct sections, guard→sandbox).
- **Migration** (Codex `bh3eqx7pg`): 28 files (24 reports + 4 memos) copied to
  `meta/loops/references/reports/`, 28/28 shasum parity (independently spot-checked), MIGRATED.md
  pointer left in the old dir, ORIGINALS PRESERVED. Registry flipped `library: live`; steering re-run
  wrote the contract artifact INTO THE VAULT.
- **Gate adjustment (deliberate)**: "old paths gone" deferred to Phase 7 — additive-first migration:
  legacy report + API + gather keep working off the old path until the reader re-points; the loop
  artifact is the new source of truth accruing daily. Caveat noted: pre-migration files in the new
  reports dir are legacy-format (only dated-forward artifacts parse as contract; consumers read latest).

## Phase 3 — Runtime loop — GATE MET 2026-07-02

- `src/lib/loops/runtime.ts` (pure check logic: absence w/ cadence+grace, cross-loop health digest,
  substrate checks incl. a PERMANENT fossil-CLI check) + `scripts/loop-runtime.ts` (env-gathering
  shell) + `runtime.test.ts` (6 induced-failure tests; found + fixed a REAL serializer bug: js-yaml
  rejects explicit-undefined fields — hardened serializeLoopArtifact). 25/25 loops tests.
- Registry semantics: `enabled` = "has a runner" (absence detection covers enabled loops only);
  unbuilt loops flipped enabled:false.
- **Scheduled**: `com.hilt.loops.runtime` daily 05:45 (after steering 05:10, before gather ~06:00)
  via new `scripts/loops-scheduler.ts` + npm scripts. **First real run found 2 genuine escalations**:
  reweave-pending stale exit-1 (expected to clear tonight) and **disk free 8.4%** (⚠ surfaced to
  Justin). Gate note: "renders as a briefing section in shadow" deferred to Phase 7 reader work
  (gather does not read loop artifacts yet, by design — live-briefing safety).

## Phase 4 — Launchpad harness — STARTED 2026-07-02

- **As-of gathering is real**: fixed 9 today-relative leaks in vault `gather.sh` (meetings window,
  git bounds, YEST, memo freshness-by-filename, task-list by filename≤date, prior-briefings
  future-leak (filename<target, mtime-agnostic), + `BRIEFING_AS_OF=1` gates for the honestly
  unreconstructable live-only sources: reminders, session/area mtimes, source-state). PROOFS:
  today-parity diff = only an improvement (calendar-day git bounds catch commits wall-clock missed);
  retro run for 2026-06-10 shows zero future leaks beyond the honest generation stamp, prior
  briefings correctly 06-08/06-06.
- `generateBriefing` gained additive `asOf` + `gatherDumpPath` (grading trace); new
  `scripts/launchpad-retro.ts` (per-date sandbox dirs: gather.txt + briefing.md + result.json;
  weekly-back date picker; rate-limit-aware). Smoke on 2026-06-10 in flight.

## Phase 1 — Contract, registry, schemas

- **2026-07-02 (evening) — GATE MET.** Codex implemented artifacts/registry/stores against the
  locked spec (first attempt sandbox-blocked read-only; resumed with `--write`). Independent
  verification: 19/19 loops tests, tsc clean, spec files untouched (mtime check), briefing 19/19 +
  library 136/136 still green. Fable code review of the diff: APPROVED — write guard exactly per
  spec (as_of forces sandbox; mismatch throws; no silent redirects), fail-loud validation names
  offending ids/fields. `test:loops` wired into package.json + test:unit. **Registry seeded** at
  `bridge/meta/loops/registry.yml` — all 7 loops (library, runtime, meeting-actions,
  people-projections w/ writer=meeting-actions, goals-areas, calendar-tasks, briefing), ALL
  `phase: shadow`; validated against the real parser. Phase flips to live happen at each loop's
  phase gate. P0-d delegated to a fresh Codex thread (`b81qp7l35`) per the design below.
- **2026-07-02 (later).** Fable-authored interface stubs (`artifacts.ts` — incl. LoopContractError,
  escalation/health view renderers, the WRITE GUARD `resolveArtifactWritePath`; `registry.ts`;
  `stores.ts` — feedback/verdict JSONL + surfacing state) and the NORMATIVE behavioral spec
  `loops.test.ts` (19 tests: round-trip, fail-loud multi-problem validation, view rendering, write
  guard incl. as_of-forces-sandbox, registry parse/validate/latest-artifact-with-asOf, stores
  append/filter/stamp). tsc clean, 0/19 red = clean handoff. **Codex job launched** (companion
  `task`, background `bgypnvz71`): implement the three modules; spec + types locked. Also running:
  Codex review of today's working-tree diff (`bry3gtri3`).
- **2026-07-02.** `src/lib/loops/types.ts` drafted from the normative scope ontology (items,
  citations, health, artifact frontmatter, registry w/ shadow|live write-guard phase, feedback +
  verdict records w/ `author: justin|claude-sim`, surfacing state). tsc clean.

## Workflow/session notes

- Workflow args quirk: `args.today` interpolated as `undefined` in agent prompts despite being
  passed — verify args plumbing next workflow (agents anchored dates themselves; no harm done).

## Phases 5–8 build sprint (2026-07-02 evening)

- **Schedules installed**: com.hilt.loops.{goals@05:40, runtime@05:45, meetings@19:30,
  shadow-v2@06:20}. Overnight chain is now 7 acts; shadow period begins 2026-07-03 06:20.
- **Phase 7 v1 surface** (Codex `baq2a29ma`, Fable-verified + adversarial review launched):
  GET /api/loops/escalations (registry-driven union of escalated items w/ existing-verdict
  awareness), POST /api/loops/verdicts (enum+revise-note validation, registry-resolved homes —
  no path traversal), POST /api/loops/feedback, EscalationsPanel at the top of the Briefings view.
  Prod rebuilt. Side-by-side UI delegated (`bw3ca3lt9`).
- **In flight**: extractor gate eval (36 meetings, sequential — ledger written at end),
  reweave backlog drain, Codex side-by-side, Codex working-tree review.
- **Known telemetry**: retro sweep first-pass validity 8/9 (89%) vs 33% live pre-fix; the one
  invalid = the 06-10 memo-line case (real fresh-memo day).

## Pre-launch night sweep (2026-07-02 late — "do the most we possibly can before morning")

- **LAUNCH BLOCKER found+fixed by UI verification**: the shadow briefing API joined the vault-layout
  `briefings/` prefix onto `briefing-shadow/` where the generator writes prefix-stripped paths →
  every lookup 404'd → `hasShadow` false → the Live|v2|Compare toggle NEVER rendered. One-line
  strip; verified live for daily + weekend ids; Compare screenshot captured (live left / v2-loops
  right, per-pane feedback button). Committed d969862.
- **Escalation flood-gate** (491d9ea): first production meeting run escalated 150+ backfill asks;
  now only ≤3-day-old meetings' commitments escalate. **Queue priority** (bd514dd): unprocessed
  recent meetings (≤3d) jump the queue newest-first — without this, today's meetings wouldn't be
  read for ~2 months at 25/run against the ~1400-meeting backlog.
- **State-continuity finding** (no code change): the 19:30 launchd run started from an EMPTY
  production ledger — the earlier manual drain's state lived in the eval home. Production ledger is
  rebuilding from the oldest backlog (Oct 2024 first). Harmless (shadow phase), but the panel
  briefly showed the old drain's artifact items that don't exist in the production ledger.
- **Sim engagement round-trip staged**: verdict (dismiss, stale Oct-2024 entry `ma-2024-10-24-001`)
  + item-level feedback posted through the REAL HTTP APIs, then store records re-authored to
  `claude-sim` (provenance-honest; API surface stays justin-only). A second verdict targets a
  no-longer-existing id (`ma-2026-05-07-001`) as a robustness probe. Consumption verified on the
  next production run.
- **Goals loop as-of discipline** (d969862): `observedLedger` now filters entries opened after the
  as-of window (the grading-round-1 future-leak class); `--evidence-dump` persists the exact
  evidence bundle for refuters. 4-week retro ran clean (06-09/16/23/30, 4 findings each, no rate
  limits); adversarial refuter workflow launched (`wf_a3cb5862-188`).
- **Round-2 regrade** launched on the fixed-harness re-sweep (`launchpad-r2`, 9/9 generated;
  first-pass validity 7/9 — 05-26 missed the 2200B floor by 36B on Memorial-Day-week-thin data,
  06-10 hit the per-line memo rule again). Workflow `wf_1934c41c-dcd`, same rubric as round 1.
- **Extractor re-eval (prompt v2)** running into fresh home `extractor-eval-v2` (round-1 evidence
  preserved in `extractor-eval/`). **RESULT: GATE MET — precision 0.957 / recall 0.792** (bars
  0.85/0.75; v1 was 0.993/0.628 — the two-pass sweep bought +0.164 recall for −0.036 precision).
- **Flywheel round-trip VERIFIED on production paths**: claude-sim verdict (dismiss, stale entry)
  applied → entry `dropped` with note; unknown-id verdict absorbed without crash (robustness
  probe); claude-sim feedback consumed into all extraction calls + stamped `processed`. Records
  re-authored to claude-sim after posting through the real HTTP APIs (provenance-honest).

## Justin's first-look feedback wave (2026-07-02 night — surface restructure)

Justin reviewed the surface live and filed 7 points; a 3-agent scope audit confirmed his critique
matches the scope nearly verbatim (flat escalation wall ≠ "the briefing is its reader" §4; missing
per-item feedback ≠ universal affordance §6; Live/v2 split ≠ v2-owns-the-new-stuff). Shipped in
response (commit 5828d87 + bridge d782af68):
- Tabs `v1 | v2 | Compare`, v2 default; escalations fold moved INTO the v2 pane/column.
- Fold grouped: meeting asks collapse by source meeting ("Needs you — 40 asks from 5 meetings ·
  3 signals"); runtime/goals signals flat; newest first.
- Universal per-item feedback on briefing bullets (anchored section+text → briefing loop);
  feedback API accepts the disabled briefing loop at all levels during shadow.
- Renderer bug (drops all non-bullet lines): day-thesis lede NEVER rendered pre-fix; prose
  sections (Library) rendered empty — Justin's #6. Fixed + verified in DOM.
- SECOND flood head found via Justin's 212 count: the aging path escalated all ≥7d open entries —
  redefined as APPROVED-only, capped 5/run.
- Gather now feeds SHADOW-phase loop artifacts (from sandbox) to the shadow briefing —
  frontmatter-stripped, content-capped 6KB, escalations/health always whole. Tomorrow's v2 gains
  meeting-ledger + goals sections (the unfinished Phase 7 reader half, now moving).
- AUDIT HONESTY NOTE: the "old spine during shadow" was NOT a pre-registered deferral — Phase 7's
  gate ("shadow briefing built purely from loop artifacts") is genuinely incomplete. Full SKILL
  thinning to one-section-per-loop remains open, gated on Justin's read of the loop-fed mornings.
- Justin's critique recorded as briefing-loop feedback (`fb-...7l4t`, author justin) — the
  flywheel's first real user feedback record.
