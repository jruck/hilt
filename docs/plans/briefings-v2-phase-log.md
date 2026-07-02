# Briefings v2 — Phase Log

> Builder's running log: decisions, deviations, Codex jobs, gate evidence. This file is how a
> fresh session knows where things stand. Newest entries at top within each phase. See
> `briefings-v2-implementation.md` §7.

## Phase status board

| Phase | Status |
|---|---|
| 0 · Native briefing cutover | **ACTIVE — reframed to STABILIZATION** (cutover already happened 2026-06-29; see below) |
| 1 · Contract, registry, schemas | **GATE MET 2026-07-02** — 19/19 spec green, registry seeded + validated |
| 2 · Library conformance | pending (recon done — see R-lib below) |
| 3 · Runtime loop | pending |
| 4 · Launchpad harness | pending (recon done — see R-meet below) |
| 5 · Meeting-action ledger v1 | pending |
| 6 · Goals/areas loop | pending |
| 7 · Reader thinning + feedback surface | pending |
| 8 · Shadow period → launch report → cutover | pending |

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
- [ ] **P0-d — migrate failure/retry surface off Hermes** — DESIGN READY (Fable), queued for Codex
  after the loops-IO job frees the thread:
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
