# Briefings v2 — Completion Roadmap

> **Status:** canonical roadmap for remaining Briefings v2 work, based on a live source audit on
> 2026-07-10.
>
> **Decision:** clean up and make the current production path honest first; finish the original
> Briefings v2 contract second; only then add briefing intelligence and autonomous behavior.
>
> The original [implementation plan](./briefings-v2-implementation.md),
> [phase log](./briefings-v2-phase-log.md), and
> [launch report](./briefings-v2-launch-report.md) remain historical design and evidence records.
> This file is authoritative for **what remains and in what order**.

## 1. The distinction that controls this roadmap

Being registered does not automatically make something unfinished cleanup. The useful test is what
kind of obligation the work closes:

| Class | Test | Examples |
|---|---|---|
| **P0 — Cleanup and production honesty** | Does current production behavior disagree with itself, hide failure, misreport health, risk durability, or contradict its documented contract? | Retry disagreement, silent loop errors, misleading counters, untracked live artifacts |
| **P1 — Finish the promised v2 contract** | Was this behavior explicitly designed, scaffolded, or partially shipped as part of Briefings v2, but never closed end to end? | Permanent Meeting/Goals state, Briefing as a real node, surfacing memory, Calendar/Tasks conformance |
| **P2 — Meaningful enhancement** | Would this make an already-correct briefing materially more useful without repairing current correctness? | Folder-native workstream intelligence, People projections, richer calendar reasoning |
| **P3 — New capability or autonomy** | Does this expand the action/risk envelope or create a new operating model? | Actual agent execution, auto-accept, direct self-tuning |

The hard sequencing rule is:

1. **No new domain loop work until P0 is green.**
2. **Do not call Briefings v2 complete until P1 is green.**
3. **Start P2 with folder-native workstream discovery, not cosmetic UI expansion.**
4. **Do not start P3 until decision-quality metrics exist.**

## 2. What is and is not a mess

This is a closeout and hardening roadmap, not a rescue plan. The production briefing works. The
four enabled nodes were producing healthy artifacts at the audit, the installed jobs had successful
last exits, and the targeted loop/briefing/trigger suites passed.

The mess is narrower and more concrete:

- Some paths that claim to be equivalent are not equivalent.
- Some failures are collected by the backend but hidden by the reader.
- Some health receipts overstate what actually ran or learned.
- Two production inputs still depend on sandbox continuity.
- The system contains contract scaffolding that production does not use.
- Several canonical documents describe an older topology.

The following are **not** cleanup:

- A folder-native workstream layer that understands actual plans and roadmaps without a registry.
- People relationship projections.
- Richer meeting preparation or calendar reasoning beyond source normalization.
- Executing “Assign to agent” work.
- Auto-accepting loop proposals.

Shadow isolation was also not a mistake. It was the correct safe-launch mechanism. It becomes debt
only because Meeting Actions and Goals now influence production while their continuity state remains
outside the permanent vault.

## 3. Current-state matrix

The live registry is `/Users/jruck/work/bridge/meta/loops/registry.yml`.

| Node/domain | Registry state | Production reality | Remaining-work class |
|---|---|---|---|
| **Library / references** | enabled, live | Real vault artifact; read by the production briefing | P0 provenance and contract-truth cleanup; optional later card enhancement |
| **Runtime / system** | enabled, live | Real vault artifact; monitors the tree before the briefing | P0 timing, failure-visibility, feedback, and provenance cleanup |
| **Meeting Actions / meetings** | enabled, shadow; `proposal_sink: vault` | Production briefing reads it; real task proposals and verdict effects enter the vault; ledger/history remain under `$DATA/loops-shadow` | P0 backup/accounting, then P1 safe graduation |
| **Goals/Areas / areas** | enabled, shadow | Production briefing reads it; reports remain under `$DATA/loops-shadow` | P0 schedule/evidence cleanup, then P1 graduation |
| **Calendar/Tasks / calendar** | disabled, shadow | No runner; Today still comes from raw calendar, reminders, and weekly-task gather | P1 base conformance; P2 richer calendar intelligence |
| **People Projections / people** | disabled, shadow; writer is Meeting Actions | No writer, artifacts, or production surface | P2 enhancement after Meeting state is permanent |
| **Briefing / briefings** | disabled, shadow | The real loops-fed generator is live, but it emits no normal loop artifact and has no surfacing state or health pass | P1 unfinished top-node contract |
| **Workstream intelligence** | not registered | Work & Product broadly infers activity from git, sessions, tasks, meetings, and available Bridge evidence; it does not yet traverse folder-native project/roadmap state deeply | P2 highest-value enhancement |

### 3.1 Audit snapshot — 2026-07-10

These numbers establish the closeout baseline; they are a dated snapshot and will naturally drift:

- The vault contained **116 briefings**.
- The escalation API saw **4 enabled loops**, no read errors, and **18 escalated items**:
  17 pending asks and 1 insight.
- Library, Runtime, Meeting Actions, and Goals all had healthy artifacts for the day.
- The six installed loop/briefing/library jobs inspected had last exit status `0`.
- **130 targeted tests** across loops, briefing behavior, and the post-meeting trigger passed.
- The thread store had 9 threads, 2 open; one open item was a briefing-anchor critique.
- The Meeting shadow home contained approximately 400 ledger entries, 77 processed meetings,
  49 verdict records, and 46 task-id stamps; 14 verdicts were not yet acted on.
- The original Meeting extractor gate passed at precision **0.957** and recall **0.792**.
  Catch-phrase recall remained unmeasurable because the gold set had no positive examples.
- Goals failed on July 8 and 9; July 10 was the first healthy scheduled artifact after the repair.
- Live Library and Runtime reports dated July 3–10, plus Runtime feedback data, were present in the
  vault but untracked by Bridge git.

## 4. Ordered roadmap

| Order | Workstream | Class | Depends on | Completion checkpoint |
|---:|---|---|---|---|
| 1 | Back up production-significant shadow state | P0 | — | Hash-verified snapshot exists outside the active home |
| 2 | Separate run/watch from publication | P0 | — | A loop can run in unpublished shadow |
| 3 | Unify generation/retry paths and same-morning failure coverage | P0 | — | Weekday/weekend induced failures are visible and recoverable |
| 4 | Make health, feedback, verdicts, and UI errors truthful | P0 | — | No false success/consumption and no silent partial state |
| 5 | Close live-artifact provenance and migration tooling | P0 | — | Permanent files have documented recoverable history; migration dry-run verifies |
| 6 | Graduate Meeting Actions | P1 | P0 | Permanent state; no duplicate/lost proposals or verdicts |
| 7 | Graduate Goals/Areas | P1 | Meeting graduation | Same-day permanent artifact completes before Runtime |
| 8 | Make Briefing a full node; wire surfacing and feedback | P1 | P0; preferably permanent inputs | Every attempt emits health; surfacing is deterministic |
| 9 | Conform Calendar/Tasks and retire duplicate raw inputs | P1 | Run/publish split; full Briefing node | Parity-proven loop owns Today inputs |
| 10 | Produce current launch evidence and close v2 | P1 | All prior P1 work | Current launch report proves the operating claims |
| 11 | Add folder-native workstream intelligence | P2 | v2 closeout | Work & Product evaluates emergent workstreams against plans without an allowlist |
| 12 | Add advanced Calendar intelligence | P2 | Calendar conformance | Preparation/conflict/risk reasoning is source-linked |
| 13 | Add People projections | P2 | Stable permanent Meeting ledger | Reviewable waiting-on/aging projections without editing notes |
| 14 | Add richer object hydration and decision analytics | P2 | Durable domain contracts | Better drill-down without changing core semantics |
| 15 | Add agent execution and measured autonomy | P3 | Decision metrics and explicit product design | Draft-and-present first; auto-action only after evidence |

---

## P0 — Cleanup and production honesty

P0 changes should add little or no new briefing intelligence. Their purpose is to make the system
we already rely on consistent, observable, truthful, and recoverable.

### P0.1 Back up production-significant shadow state immediately

Meeting state is no longer disposable evaluation state. It drives proposals and verdict effects in
the real vault.

Work:

- Snapshot the complete Meeting and Goals shadow homes before structural changes.
- Include reports, ledger, processed-meeting history, summaries, verdict history, task-id stamps,
  and frozen feedback history.
- Write a file-count and SHA-256 manifest.
- Store the snapshot outside the active loop homes and record its source paths and creation time.
- Do not treat the current vault proposal files as a substitute for the Meeting ledger: they do not
  preserve extraction identity, dismissal history, or processed-meeting continuity.

Done when:

- The snapshot can be independently verified from its manifest.
- Restoring it to a temporary home reproduces the same counts and joins.

### P0.2 Separate runner state from publication state

Current `enabled` semantics conflate:

1. a runner exists and is expected to emit artifacts;
2. Runtime should watch it;
3. APIs should expose it;
4. gather should publish it into the production briefing.

`phase` controls the write destination, not publication. That is why enabled shadow loops already
shape the production briefing.

Work:

- Add an explicit publication control such as `publish_to_briefing`, or model execution,
  monitoring, and publication as separate fields.
- Update registry validation, gather, Runtime, escalation APIs, and tests around the new semantics.
- Preserve current production behavior for the four currently enabled loops during migration.
- Define whether an unpublished loop's escalations are visible only on a review surface or nowhere.

Done when:

- A loop can run under production conditions, be monitored, and accumulate evaluation evidence
  without influencing the production briefing.
- A disabled/unbuilt loop remains absent without false Runtime alarms.
- Published loops remain phase-aware for storage.

### P0.3 Make every briefing generation path equivalent

Current disagreement:

- Scheduled production generation carries `--loops`.
- Automatic retry regenerates with loop inputs.
- The manual UI retry invokes `briefing-generate.ts` without `--loops`, so it can regenerate a
  pre-loop-style briefing.
- The manual endpoint runs synchronously while the UI describes the result as queued.
- A successful retry refreshes the list but can leave the selected failure detail stale.

Work:

- Route scheduled, automatic-retry, and manual-retry generation through one shared invocation
  builder.
- Make loop-fed input the non-optional production default; reserve any legacy mode behind an
  explicit development flag.
- Make the UI describe synchronous vs. queued behavior accurately.
- Refresh both the briefing list and selected detail after recovery.
- Remove or quarantine accidental reinstall paths for the retired shadow generator. Historical
  `$DATA/briefing-shadow` data may remain read-only, but a default scheduler install must not put
  the old parallel system back into service.

Done when:

- The same date regenerated through all three paths has the same input contract and validator.
- The UI immediately displays the recovered briefing or the new failure state.
- The retired shadow period cannot be restarted accidentally through a default command.

### P0.4 Close the same-morning failure blind spots

Current gaps:

- The automatic retry watcher is weekday-only.
- Runtime runs at 05:45, before the 06:00 briefing.
- Its briefing-presence check is intentionally inactive before 07:00, so that run cannot catch the
  current morning's failure.
- Daily absence grace can tolerate more than the stated same-morning operating bar.
- Briefing list/detail request errors can degrade into empty selection states instead of explicit
  load failures.

Work:

- Extend recovery coverage to weekend generation.
- Add a post-06:00 check, make the retry watcher emit health, or give the Briefing node its own
  failure artifact immediately after every attempt.
- Distinguish missing output, invalid output, rate limiting, generator crash, push failure, and API
  read failure.
- Preserve the last good briefing while showing a stale/error state; do not blank the reader.

Done when:

- Induced weekday and weekend failures become visible the same morning.
- Missing, invalid, and rate-limited outputs are each recoverable and visibly distinct.
- A network/API error cannot look like a legitimately empty briefing or escalation set.

### P0.5 Surface partial loop-read failures

`GET /api/loops/escalations` correctly collects missing, malformed, and unreadable loop errors while
returning healthy loop items. `useEscalations()` currently exposes only `items` and discards the
`errors` array.

Work:

- Carry per-loop errors into the Briefing surface.
- Use a compact degraded-state treatment rather than replacing healthy content.
- Preserve the last good SWR data during transient fetch failure, but show that it is stale.
- Add explicit error states for briefing list and content fetches as well.

Done when:

- “No escalations” and “loop could not be read” are never visually indistinguishable.
- One malformed loop cannot hide healthy loops or blank a section.

### P0.6 Correct Meeting health and feedback accounting

Current problems:

- When rate limiting stops Meeting extraction mid-queue, the artifact reports the full queue as
  processed/attempted and can overstate succeeded/coverage.
- The feedback health pass resolves a thread before the extraction queue proves that any successful
  call actually incorporated it.
- An empty queue or first-call rate limit can therefore produce a “calibrated” receipt without a
  calibrated extraction.

Work:

- Track selected, started, succeeded, failed, rate-limited, and remaining meetings separately.
- Calculate coverage from actual attempts and completions.
- Mark feedback consumed only after a successful extraction call includes the feedback payload.
- If no work used the guidance, leave the thread open or record “noticed; not yet applied” without
  claiming calibration.
- Add rate-limit and empty-queue fixtures that assert the exact receipt and counters.

Done when:

- Health never reports unattempted work as processed.
- Every calibration receipt can identify a successful run that actually received the guidance.

### P0.7 Enforce verdict policy on the server

Current behavior:

- The UI filters actions by an item's `allowed_verdicts`.
- The API mainly validates against the global verdict vocabulary.
- It does not reliably prove that the item exists, is an action/proposal, or permits the submitted
  verdict.
- Unknown/stale item IDs are deliberately accepted fail-soft today.
- Visible controls have retired `assign_to_me` and the separate Revise action, while types, API
  compatibility, tests, and some documentation still retain them.

Work:

- Resolve a durable item or ledger record before accepting a verdict.
- Require actionable kind and enforce per-item `allowed_verdicts`.
- Define a deliberate stale-item compatibility policy rather than accepting arbitrary IDs.
- Decide whether `assign_to_me` and `revise` remain compatibility-only verbs or are removed through
  a migration.
- Preserve note-riding verdict feedback while separating a comment from a state-changing verdict.

Done when:

- Direct API calls cannot approve an insight or submit a disallowed assignment.
- Stale legitimate submissions have an explicit tested outcome.
- UI, API, types, and documentation describe one verdict vocabulary.

### P0.8 Remove the Goals/Runtime schedule race

Goals begins at 05:40 and its current model call can take five to eight minutes. Runtime begins at
05:45 and can inspect yesterday's artifact while today's run is still in progress. The 06:00
briefing may then receive a Goals artifact Runtime never evaluated.

Work:

- Move Goals earlier, shorten/bound it, or add dependency-aware scheduling.
- Record start, end, duration, artifact timestamp, and whether Runtime evaluated the same date.
- Treat a loop still running at its deadline as degraded health rather than silently reusing stale
  output.

Done when:

- Source loops finish or explicitly degrade before Runtime.
- Runtime evaluates the same artifact date the briefing will consume.

### P0.9 Make live artifact durability and provenance true

The contract and comments promise permanent, git-tracked loop artifacts. In the audited tree,
Library and Runtime reports from July 3–10 and Runtime feedback data were untracked. The shared
loop emitter writes files but does not commit or push; only the final briefing has a targeted vault
commit path.

Decision required:

- **Preferred:** implement safe, targeted per-loop commit/push behavior with serialization around
  concurrent vault git writes; or
- explicitly revise the contract and designate another permanent synchronization/provenance
  mechanism.

Constraints:

- Never stage unrelated dirty vault files.
- Commit only the artifact and intentional state/receipt files for that run.
- Record commit and push outcomes in loop health.
- Make retry idempotent and tolerate “nothing changed.”
- Define conflict behavior instead of silently leaving an untracked artifact behind.

Done when:

- A clean machine can recover the intended permanent loop history from the designated source of
  truth.
- Failed commit/push is visible health, not a successful green artifact.

### P0.10 Build one safe loop-home migration command

The phase flip must not be the migration mechanism.

Required behavior:

- Dry-run by default.
- Copy-only; never delete the source.
- Complete file-count and SHA-256 manifest.
- Refuse conflicting destination files unless they are byte-identical or an explicit merge rule
  exists.
- `--write` and independent `--verify` modes.
- Backup/rollback manifest.
- Domain-specific join audits, especially Meeting ledger ↔ task/proposal/verdict identity.
- Preserve existing permanent files such as the Meeting gold set.

Use the Library migration's copy-and-parity discipline as the precedent. A disposable Goals copy
can rehearse the generic command, but Meeting should be the first real phase cutover because Goals
depends on its ledger.

Done when:

- A migration dry-run is reproducible and complete.
- Re-running write/verify is idempotent.
- Any conflict stops before the registry changes.

### P0.11 Make feedback behavior truthful per node

The current generic wording implies every node consumes feedback on its next run. The code
deliberately allows automatic calibration only for Meeting Actions; Runtime and Goals keep feedback
open for substantive manual processing, Library uses its own pipeline, and Briefing has no consuming
runner.

Cleanup work:

- Remove hollow shared health-pass calls or label them accurately.
- Document each current node's actual feedback path.
- Do not auto-resolve a Runtime question such as “what broke and how do we fix it?” with a generic
  calibration stamp.
- Keep unprocessed feedback open and visible.

The missing automatic behavior itself is P1. This P0 item is about not claiming it already exists.

### P0.12 Reconcile documentation and launch evidence with production

Known drift includes:

- `docs/ARCHITECTURE.md` and API descriptions retain Hermes-era failure/retry wording.
- `docs/HOW-IT-WORKS.md` overstates universal next-run feedback consumption.
- It describes an older Meeting proposal sink even though the registry now has
  `proposal_sink: vault`.
- Old visible Revise/Assign-to-me controls remain in prose or compatibility contracts.
- Gather and scheduler comments describe the pre-cutover shadow/live relationship.
- The phase board and launch report still show pre-cutover gates as pending.
- The strong “missing loop is never reconstructed from raw data” claim is only true for conformed
  domains.

Work:

- Correct those documents after the P0 runtime decisions land.
- Preserve historical evidence; label it historical rather than rewriting old results.
- Add a daily receipt table: scheduled time, start/end, artifact date/time, health, publication,
  gather inclusion, retries, commit, and push.
- Refresh the operating SLO evidence: at least 95% completion before gather and zero silent
  failures.

Done when:

- A new session can derive the current topology and remaining work without reconciling
  contradictory files.

### P0 exit gate — “cleanup complete”

All must be true:

- [ ] Shadow state has a verified backup.
- [ ] Run/watch and publish are separate controls.
- [ ] Scheduled, automatic-retry, and manual-retry paths use the same loops-fed contract.
- [ ] Weekday and weekend failures surface and recover the same morning.
- [ ] Partial loop/API failures remain visible while healthy content stays usable.
- [ ] Meeting counters and feedback receipts report only actual work.
- [ ] Verdict policy is server-enforced and vocabulary is reconciled.
- [ ] Goals completes before Runtime or explicitly reports degraded state.
- [ ] Permanent loop artifacts have a real, documented provenance/sync mechanism.
- [ ] The migration command passes dry-run, write, repeat, and verify tests.
- [ ] Current documentation matches current behavior.

---

## P1 — Finish the promised Briefings v2 contract

P1 closes architecture that was explicitly part of Briefings v2. These items are not optional
product expansion.

### P1.1 Graduate Meeting Actions safely

Why first:

- It has the largest and most consequential state.
- Its proposals and verdicts already have real vault effects.
- Goals resolves the Meeting ledger according to the Meeting node's phase.
- People Projections will depend on the same ledger later.

Cutover sequence:

1. Pause the 19:30 sweep and the Granola post-meeting trigger.
2. Run a controlled zero-new-meeting shadow pass to apply pending known-item verdicts.
3. Require zero unacted known-item verdicts, or explicitly preserve and test a pending queue.
4. Snapshot and hash reports, ledger, processed meetings, summaries, verdict history, task stamps,
   and frozen feedback history.
5. Build a temporary destination containing the migrated state plus existing permanent assets such
   as `meta/loops/meetings/state/gold-set.json`; never overwrite them blindly.
6. Verify counts, hashes, ledger ↔ task/proposal joins, proposal origins, processed-meeting identity,
   terminal dismiss explanations, and duplicate suspects.
7. Atomically install the destination and change `phase` to `live`; retain
   `proposal_sink: vault`.
8. Run an idempotent zero-meeting live smoke; verify APIs resolve the permanent home.
9. Restore the post-meeting trigger and nightly schedule.
10. Preserve the sandbox copy for a defined rollback window.

Gate:

- [ ] Counts and hashes match the migration manifest.
- [ ] No duplicate or orphan task/proposal origins exist.
- [ ] Every missing stamped proposal file has an understood terminal explanation.
- [ ] Verdict, dismissed, and escalation APIs read the permanent store.
- [ ] One organic post-meeting run writes only to the vault and creates no duplicate extraction or
  proposal.
- [ ] Runtime sees the live artifact.
- [ ] Seven consecutive scheduled/triggered runs show no continuity regression.

### P1.2 Graduate Goals/Areas after Meeting

Minimum stabilization before the flip:

- Resolve the 05:40/05:45 schedule race.
- Require at least three consecutive healthy scheduled runs after the JSON/timeout repair; use a
  longer seven-run observation window for the final confidence gate.
- Make citations reflect the evidence actually supporting each finding. Current output can cite
  `areas/index.md` broadly even when a claim depends on commits or meetings.
- Decide whether calendar attention is part of the base Goals contract; it was promised in design
  language but is absent from the current runner.
- Add focused behavioral tests beyond generic JSON extraction and artifact validation.
- Run a source-grounding/refuter spot check with zero unsupported or fabricated claims.

Cutover:

1. Confirm it resolves the permanent Meeting ledger.
2. Copy historical reports with byte parity.
3. Flip `phase` to `live`.
4. Verify same-day Runtime and briefing consumption.

Gate:

- [ ] Seven consecutive same-day healthy artifacts complete before Runtime.
- [ ] No shadow-ledger fallback remains.
- [ ] Copied history matches byte-for-byte.
- [ ] Findings cite the actual supporting sources.

### P1.3 Turn Briefing into a real registered node

The top-level product is live, but the registry node is disabled and has no contract artifact.
`$DATA/briefing-runs` is useful operational state, but it is not a normal loop artifact that the
tree can inspect.

Add `meta/loops/briefings/{reports,state}` and emit health for every attempt:

- Gather success and duration.
- Enabled/published loop inventory and artifact freshness.
- Missing, stale, malformed, or unhealthy input loops.
- First-pass validity, retry count, and validator failures.
- Citation integrity and unresolved citation IDs.
- Output mode, byte count, section inventory, and target path.
- Commit and push result.
- Rate limit, generation failure, invalid draft, and publication failure.
- A failure artifact even when no briefing markdown publishes.

Then:

- Remove the feedback-route special case that exists only because Briefing is disabled.
- Enable the registry entry.
- Have Runtime monitor the node through the normal contract.

Gate:

- [ ] Every scheduled attempt emits machine-readable health, including failed attempts.
- [ ] Runtime distinguishes absent, failed, degraded, and successful Briefing runs.
- [ ] The published markdown and node artifact link to the same run identity.

### P1.4 Wire deterministic surfacing memory

The `SurfacingState` type and atomic read/write functions already exist, but production has no
caller. Today repetition, escalation aging, and suppression remain a mixture of prompt judgment,
prior-briefing comparison, Meeting ledger identity, and task-file state.

Implement:

- `first_surfaced`.
- `last_surfaced`.
- `times_surfaced`.
- Verdict state and default suppression.
- Aging/compression/intensification policy for unresolved repeated items.
- Visible, recorded editorial override when a decided item is deliberately resurfaced.
- State updates only after successful publication, not merely generation.
- Stable-anchor hashing for content without a loop item ID.

Gate:

- [ ] Repeated unresolved items age or compress deterministically.
- [ ] Decided items suppress or transform according to an explicit policy.
- [ ] Editorial overrides are visible and testable.
- [ ] Failed/invalid drafts do not advance surfacing counts.

### P1.5 Complete the feedback flywheel for current nodes

Current paths:

| Node | Current behavior | Required closeout |
|---|---|---|
| Meeting Actions | Feedback is inserted into extraction prompts; accounting needs P0 repair | Receipt only after successful incorporation |
| Library | Separate mature clustering/evaluation workflow; the shared loop verdict log is not consumed by the steering runner | Decide deliberately whether Library stays on its separate application path or conforms to the shared verdict contract; normalize health/receipt semantics either way |
| Runtime | Threads remain open for manual Process | A substantive diagnosis/fix/proposal path, not a hollow calibration stamp |
| Goals | Threads remain open for manual Process | Feed relevant guidance into analysis or produce a reviewed tuning proposal |
| Briefing | Feedback can be captured; no consuming runner | Next-run guidance plus visible tuning proposal/receipt |

Rules:

- A node may auto-consume feedback only if its next run genuinely receives and uses it.
- Deterministic/monitor nodes should answer, diagnose, or propose a change; they should not pretend a
  free-form comment calibrated an extractor they do not have.
- Failed incorporation leaves the thread open.
- Feedback may produce a visible prompt/policy/budget proposal; it must not silently rewrite those
  controls.

Gate:

- [ ] Every current node documents one real feedback path.
- [ ] Successful incorporation produces a traceable receipt.
- [ ] Unsuccessful/unprocessed feedback remains open.
- [ ] Briefing critique affects a later run or creates a decision-ready tuning proposal.

### P1.6 Conform Calendar/Tasks to the loop architecture

Base Calendar/Tasks conformance was in the original v2 definition of done. It is not the same as
adding sophisticated calendar intelligence.

Build a deterministic runner that reads:

- Calendar SQLite/current normalized event source.
- The newest v2 weekly list and task files.
- Due and overdue state.
- Reminders, including timeout/TCC/permission health.

Emit:

- Stable IDs for deadline-today, overdue, and source-health items.
- Basic conflicts and preparation requirements only where deterministically supported.
- Explicit attempted/succeeded/coverage health for each source.
- A dated artifact before briefing gather.

Rollout:

1. Run it with publication disabled.
2. Compare at least 14 days against the existing raw Today inputs.
3. Prove stable IDs across identical reruns.
4. Induce calendar and reminder failures and verify same-morning health.
5. Enable/publish the node and remove the duplicate raw calendar/reminder/task gather blocks in the
   same release.

Gate:

- [ ] No event, deadline, or overdue item is lost during parity.
- [ ] Reminder unavailability is visible as health, not buried prose.
- [ ] The production briefing contains no duplicate Today content after cutover.
- [ ] Raw gather is no longer the semantic owner of Calendar/Tasks.

### P1.7 Inventory and retire raw-domain bypasses

After Calendar/Tasks, classify every direct gather input as one of:

- **Substrate:** appropriate low-level input to the top-level writer.
- **Transitional compatibility:** must be removed when its loop graduates.
- **Owned by a loop:** gather must read the artifact, not reconstruct the domain.
- **Deferred enhancement:** intentionally raw until a future node exists.

Known remaining raw inputs include code activity, personal-area modification times, and general
counts. Work/project inputs may remain explicitly transitional until the P2 Projects node. General
substrate counts may remain raw if they do not claim to be semantic domain synthesis.

Gate:

- [ ] No semantic domain has an undocumented raw bypass.
- [ ] A missing conformed loop cannot be silently reconstructed from its raw evidence.

### P1.8 Produce current launch evidence and decision metrics

The original launch report contains valuable retro/extractor evidence but predates the current
single loops-fed production topology.

Refresh it with:

- Artifact-before-gather rate.
- First-pass validity and retry frequency.
- Silent-failure count and same-morning detection.
- Citation integrity and fabrication checks.
- Couldn't-fetch/couldn't-parse inventory.
- Feedback and verdict round trips on current paths.
- Identity/reconciliation outcomes after Meeting migration.
- Approval, dismissal, assignment, and compatibility-revision rates.
- False-positive rate and time-to-decision.
- Repeated resurfacing and suppression outcomes.
- Model/budget usage per loop.
- Catch-phrase recall once at least 10 positive production examples exist.

The minimum metrics may be generated as Markdown/JSON receipts. A polished analytics UI belongs in
P2.

### P1 exit gate — “Briefings v2 complete”

All must be true:

- [ ] Every enabled production input uses permanent, recoverable state.
- [ ] Meeting Actions and Goals no longer read or write their sandbox homes.
- [ ] Briefing is an enabled, monitored node with honest success and failure artifacts.
- [ ] Surfacing memory controls repetition and verdict suppression deterministically.
- [ ] Every current node has a truthful feedback path and traceable receipts.
- [ ] Calendar/Tasks owns its domain and duplicate raw inputs are retired.
- [ ] Raw inputs have an explicit substrate/transitional/deferred classification.
- [ ] Current launch evidence demonstrates the SLO, quality, identity, and flywheel claims.
- [ ] Historical shadow homes remain only for the defined rollback window and are then retired or
  archived explicitly.

---

## P2 — Meaningful enhancements

P2 improves what the briefing knows and how usefully it presents it. It should not be mixed into
P0/P1 closeout, even when an enhancement is high-value.

### P2.1 Folder-native workstream intelligence — first enhancement

This is the largest content gap. Work & Product currently sees broad activity signals, but it does
not yet traverse the Bridge hierarchy deeply enough to understand every emergent project or roadmap.
An attempted six-project allowlist was removed on 2026-07-12 because registration duplicated the
vault, hid unconfigured work, and could not follow projects splitting, merging, or changing shape.

Build source-linked discovery over:

- The actual folder hierarchy under Bridge projects, roadmaps, areas, and adjacent work records.
- Recent document changes and source-linked project/index/planning content.
- Repository and agent activity associated from observed paths and evidence, not manual mappings.
- Meeting decisions and commitment ledger state.
- Weekly tasks, milestones, blockers, and stated next steps.

The system may maintain derived continuity state, but project eligibility and identity must emerge
from the vault and current activity. A central allowlist, fixed six-project roster, or mandatory
one-record-per-configured-project contract is explicitly out of scope.

Outputs should answer:

- Did the project advance against its plan?
- Did a milestone, decision, scope, or next step change?
- Is code activity aligned with the stated direction?
- Is a quiet project appropriately waiting or genuinely stalled?

Goals may eventually consume this evidence as an additional source, but must retain broad observed
activity so the derived layer cannot become a gate.

Gate:

- [ ] Every status claim links to project/roadmap evidence.
- [ ] Newly created, renamed, nested, split, or merged workstreams are discoverable without config edits.
- [ ] Quiet days preserve meaningful state instead of fabricating activity.
- [ ] A graded comparison shows Work & Product is more accurate and decision-useful.
- [ ] Workstream status is stable across reruns and does not devolve into commit-count theater.

Product-definition note: infrastructure-level Briefings v2 can close before this node. If “the
briefing is complete” means it genuinely understands the state of Justin's work, this enhancement is
required before making that broader product claim.

### P2.2 Advanced Calendar/Tasks intelligence

Keep this separate from P1 source conformance. Possible enhancements:

- Anticipatory meeting preparation.
- Cross-source schedule conflicts.
- Deadline-risk prioritization.
- Aging, recurrence, and repeated-deferral analysis.
- Travel/buffer/day-shape recommendations.
- Connections between scheduled time and stated project priorities.

Each judgment must retain source links and abstain when duration, ownership, or due-date evidence is
missing.

### P2.3 People projections

Treat the dormant registry entry as reserved product capability, not cleanup merely because it
exists.

Meeting Actions should deterministically project:

- Waiting on me.
- Waiting on them.
- Open promises and age.
- Last substantive contact.
- Direction/evidence for each relationship state.
- Reviewable unmatched/ambiguous identity cases.

Constraints:

- Never machine-edit human-authored `people/*.md` notes.
- Compose projections with those notes at render time.
- Abstain on unresolved identities.
- Escalate only noteworthy relationship state through Meeting Actions.
- Decide whether People is a subordinate Meeting output or an enabled node that also emits a dated
  daily health artifact; Runtime currently expects enabled nodes to have dated reports.

Dependency: Meeting Actions must first prove stable in its permanent home.

Gate:

- [ ] Waiting-on direction is correct on a labeled sample.
- [ ] Identity mapping is inspectable and ambiguous matches abstain.
- [ ] No human person-note bytes change.
- [ ] Missing/stale projections disappear or degrade cleanly.

### P2.4 Improve Goals with richer domain artifacts

After Projects and Calendar exist:

- Replace raw-git inference with the Projects artifact.
- Incorporate actual planned calendar attention where relevant.
- Track alignment/drift over time rather than only today's activity.
- Cite the exact underlying domain evidence.

This is enhancement after the P1 Goals node is trustworthy and permanent.

### P2.5 Richer object hydration and drill-down

Examples:

- Richer Library cards inside briefing sections.
- Project/People object cards backed by their durable projections.
- Read-only Library lookup that does not record an “open” merely because the briefing hydrated a
  card.
- Better source-to-artifact-to-state drill-down.

These improve comprehension but are not prerequisites for loop correctness.

### P2.6 Decision and operating analytics

P1 requires the underlying metrics. P2 may add a polished scorecard for:

- Approval/dismissal/assignment trends by loop.
- Time-to-decision and resurfacing.
- Extraction false positives and identity corrections.
- Completion-before-gather and retry behavior.
- Model cost/latency against decision value.

The dashboard must read durable receipts; it should not become a parallel truth store.

---

## P3 — New capability and autonomy

These items change the system from decision support toward autonomous action. They require separate
product decisions and evidence.

### P3.1 Actual agent execution

“Assign to agent” currently places a task in Ready for Agents. It does not execute it.

A real execution lifecycle needs:

- Claiming and ownership.
- Permission boundaries.
- Execution state and cancellation.
- Evidence, files touched, and result presentation.
- Failure, retry, and rollback behavior.

Start with **draft-and-present**, where the agent prepares a result and Justin decides whether to
apply it. Do not silently reinterpret today's assignment verdict as execution authorization.

### P3.2 Auto-accept and auto-action

No loop earns autonomy merely by running for a while. Candidates require:

- Sustained per-loop verdict hit rates.
- Low false-positive and correction rates.
- Bounded, reversible effects.
- Clear rollback and exception handling.
- Narrow action-specific thresholds, not one global trust score.

Auto-accept begins only after the P1 metrics have enough volume to justify it.

### P3.3 Direct self-tuning

It is safe for feedback to create a visible proposal to alter a prompt, model, budget, cadence, or
policy. Directly rewriting those controls without a verdict is a separate future capability.

### P3.4 Broader autonomous proposal loops

Additional proposal-producing or action-taking domains wait until verdict enforcement, surfacing
memory, feedback receipts, operating metrics, and rollback are all proven.

## 5. Explicit non-goals during closeout

- Rewriting healthy Library or Runtime loops merely to make them newer.
- Building an independent People agent before a projection proves insufficient.
- Real-time in-meeting processing; the settled post-meeting trigger remains the intended model.
- Cosmetic briefing UI work unrelated to failure visibility or contract truth.
- Silent prompt/policy self-editing.
- Auto-accept before measured evidence.
- Removing rollback data before the permanent homes prove stable.

## 6. Dependency rationale

- **P0 precedes all migration:** otherwise a phase flip can hide incorrect health, lose provenance,
  or publish an unreviewed shadow loop.
- **Meeting precedes Goals:** Goals resolves and reads the Meeting ledger according to its phase.
- **Permanent Meeting precedes People:** relationship projections depend on trustworthy identity and
  commitment history.
- **Run/publish separation precedes Calendar development:** otherwise enabling Calendar for shadow
  evidence changes production immediately.
- **Briefing node precedes autonomy:** surfacing, feedback, and failure health are the evidence base
  for any future trust expansion.
- **Projects precedes richer Goals:** Goals should reason over project status, not continue deepening
  inference from raw git.

## 7. Roadmap maintenance protocol

For each completed item:

1. Check its gate here and attach the verification evidence or command/result.
2. Update `docs/CHANGELOG.md` in the same change.
3. Update `docs/ARCHITECTURE.md`, `docs/API.md`, or `docs/DATA-MODELS.md` when their contracts change.
4. Update `docs/HOW-IT-WORKS.md` whenever the live topology, cadence, storage, or feedback/verdict
   flow changes.
5. Preserve the old phase log and launch evidence as history; add current results rather than
   rewriting prior measurements.
6. Do not advance to P2 while a P0/P1 gate is waived silently. Record any conscious deferral here
   with owner, reason, risk, and revisit condition.

## 8. Evidence index

Primary current sources used for this audit:

- Registry: `/Users/jruck/work/bridge/meta/loops/registry.yml`
- Briefing gather: `/Users/jruck/work/bridge/meta/skills/briefing/scripts/gather.sh`
- Loop contract/types/stores: `src/lib/loops/{artifacts,emit,registry,stores,types}.ts`
- Runtime checks: `src/lib/loops/runtime.ts`, `scripts/loop-runtime.ts`
- Feedback health pass: `src/lib/loops/health-pass.ts`
- Meeting runner and ledger: `scripts/loop-meeting-actions.ts`, `src/lib/loops/meeting-ledger.ts`
- Goals runner: `scripts/loop-goals-areas.ts`
- Loop APIs: `src/app/api/loops/{escalations,verdicts,feedback}/route.ts`
- Briefing generation/retry: `src/lib/briefing/{generate,scheduler-jobs,vault-commit}.ts`,
  `scripts/{briefing-generate,briefing-retry}.ts`,
  `src/app/api/bridge/briefings/retry/route.ts`
- Briefing reader: `src/components/briefings/{BriefingContent,EscalationsPanel}.tsx`
- Surfacing schema: `src/lib/loops/types.ts`, `src/lib/loops/stores.ts`
- Living walkthrough: [HOW-IT-WORKS.md](../HOW-IT-WORKS.md)
- Historical design: [briefings-v2-loop-of-loops.html](./briefings-v2-loop-of-loops.html)
- Historical implementation/evidence:
  [implementation plan](./briefings-v2-implementation.md),
  [phase log](./briefings-v2-phase-log.md),
  [launch report](./briefings-v2-launch-report.md), and
  [grading rubric](./briefings-v2-grading-rubric.md)
