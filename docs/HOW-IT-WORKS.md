# How Hilt's Briefing System Works

> **This is a living, canonical reference — rendered inside Hilt** (the ⓘ icon in the top bar).
> **If you change anything it documents** — a node, a schedule, a file location, the briefing
> pipeline, the verdict/feedback flow — **update this document in the same change.**
> It lives at `docs/HOW-IT-WORKS.md` in the hilt repo. Every link below shows the full real
> path it opens.

## The one pattern (read this, and the rest is inventory)

The whole system is **one node design, repeated**. A node ("loop"):

1. **has a scope** — either it does the work itself (reads meetings, digests articles), or it
   reads the syntheses of nodes below it and rolls them up. Same shape either way — that's the
   fractal.
2. **produces one dated synthesis of its scope per run** — the *artifact*, in its `reports/`
   drawer.
3. **keeps its memory** in a `state/` drawer, and **receives your judgment** in `verdicts/` and
   `feedback/` drawers, which it reads at its next run.
4. **escalates upward** only what deserves your attention, in two flavors: **know this** (an
   urgent insight — disk full) and **decide this** (an *ask* — a commitment awaiting your
   verdict). Everything else stays in the artifact for whoever reads it.

So every fact in a briefing is traceable: briefing line → node artifact → that node's state or
its source (a transcript, a job exit code, a saved article).

## Where things physically live (exactly two places + one symlink)

**1. The vault — `$VAULT`** ([open]($VAULT)). Your permanent, git-tracked knowledge base.
Everything trusted lives here: your notes, references, the briefings, and the homes of the
two *live* nodes (library, system) under `$VAULT/meta/loops/`.

**2. Hilt's private data directory — `$DATA`.** The app's own working folder: **outside the
vault, not in git, not knowledge** — working machinery. This is where the **sandbox** lives:

- `$DATA/loops-shadow/` — the homes of the on-probation ("shadow") nodes: meetings, goals,
  and the briefing node's feedback drawer. Identical drawer structure to the vault homes,
  safer address: a misbehaving probation node can't touch anything permanent.
- `$DATA/briefing-shadow/` — the v2 shadow briefings from the trial period (2026-06-26 →
  2026-07-06), kept as read-only history. Retired at the cutover: the loops-fed briefing now
  IS the vault briefing; nothing writes or reads here anymore.

**The one symlink (why some links land on "vault" addresses for sandbox data):** Hilt's Docs
tab can only browse the vault. So a git-ignored symlink inside the vault points into the data
directory, purely for inspectability:

- `$VAULT/meta/loops-shadow` → `$DATA/loops-shadow`

Same files, two paths. Links below use the vault symlink address (so they open in Docs), but
anything under `meta/loops-shadow` **physically lives in `$DATA`**.

**Graduation** = copying a probation node's home from `$DATA/loops-shadow/meta/loops/<domain>/`
to `$VAULT/meta/loops/<domain>/` and flipping one line in the roster:
[$VAULT/meta/loops/registry.yml]($VAULT/meta/loops/registry.yml). After every node graduates,
the symlinks retire and *one* answer covers everything: `$VAULT/meta/loops/<domain>/<drawer>`.

## The tree as it stands today

```
YOU — verdicts & feedback flow down; escalations flow up
 └─ 📰 BRIEFING (top node — synthesis of everything below)
     ├─ 🤝 MEETINGS node          7:30 PM · shadow
     ├─ 📚 LIBRARY node           (a sub-team of jobs — see below) · live
     ├─ 🎯 GOALS node             5:40 AM · shadow — itself a roll-up:
     │                            reads the meeting node's ledger + raw evidence
     ├─ 📈 SYSTEM node            5:45 AM · live — watches every job in this tree
     └─ ── raw feeds (no node yet): calendar · task lists · reminders · git activity
```

One gap worth naming: the "Work & product" section is an *activity* digest (git commit subjects,
sessions, tasks, meetings) — your projects folder
([$VAULT/projects]($VAULT/projects)) and roadmap documents are currently **not read by the
briefing pipeline at all**. A future work/projects node is the natural fix: per-project status
synthesis (docs + their diffs + mapped commits + ledger decisions), with goals then reading it
instead of raw git.

Not a strict hierarchy: the goals node reads the meetings node's state sideways; the system node
watches everything including the briefing itself. And the "raw feeds" line is the honest gap —
part of the briefing's scope still arrives unsynthesized. That's where future nodes slot in
(two are already registered but dormant: **people-projections** — "you've been waiting on Trudy
for 3 weeks", a projection of the meeting ledger — and **calendar-tasks**, which would turn the
calendar/task feeds into a real node with overdue/deadline escalations).

---

## The nodes, with their full inventories

### 🤝 Meetings node — shadow · runs 7:30 PM · home physically in $DATA

Reads each meeting's note **and full transcript**; extracts commitments, a 1–2 sentence meeting
summary, and closure evidence. Parses only meetings ≤30 days old; escalates only **your** (or
unclear-owner) commitments from the last 3 days as asks.

- [$VAULT/meta/loops-shadow/meta/loops/meetings/reports/]($VAULT/meta/loops-shadow/meta/loops/meetings/reports)
  — daily artifact: meeting summaries, ledger deltas, escalated asks
- [$VAULT/meta/loops-shadow/meta/loops/meetings/state/ledger.json]($VAULT/meta/loops-shadow/meta/loops/meetings/state/ledger.json)
  — every open commitment: ID, owner, verbatim quote, status history
- [$VAULT/meta/loops-shadow/meta/loops/meetings/state/meeting-summaries.json]($VAULT/meta/loops-shadow/meta/loops/meetings/state/meeting-summaries.json)
  — the per-meeting context sentences the briefing leads with
- [$VAULT/meta/loops-shadow/meta/loops/meetings/state/processed-meetings.json]($VAULT/meta/loops-shadow/meta/loops/meetings/state/processed-meetings.json)
  — read-tracking so no meeting is parsed twice
- [$VAULT/meta/loops-shadow/meta/loops/meetings/proposals/]($VAULT/meta/loops-shadow/meta/loops/meetings/proposals)
  — the proposals drawer: every ask that escalates to you ALSO becomes a task proposal file
  here (full task-file format, status `proposed`). While the node is in shadow this drawer is
  its sink; when the registry's `proposal_sink: vault` flips at the gate, new proposals land in
  `$VAULT/tasks/.proposals/` instead — where the Priorities view's Proposals section and the
  verdict buttons' instant file effects pick them up. A ledger entry mints its proposal exactly
  once (`task_id` stamp), so re-runs never duplicate and a dismissed proposal can't come back.
- [$VAULT/meta/loops-shadow/meta/loops/meetings/verdicts/records.jsonl]($VAULT/meta/loops-shadow/meta/loops/meetings/verdicts/records.jsonl)
  — every Approve / Dismiss / Revise you click
- [$VAULT/meta/loops-shadow/meta/loops/meetings/feedback/records.jsonl]($VAULT/meta/loops-shadow/meta/loops/meetings/feedback/records.jsonl)
  — your written feedback on its items
- One vault outpost:
  [$VAULT/meta/loops/meetings/state/gold-set.json]($VAULT/meta/loops/meetings/state/gold-set.json)
  — the frozen 36-meeting evaluation truth-set (deliberately vault-proper; it's evidence, not
  working state)

### 📚 Library node — live · home in the vault · a sub-team, the fractal's clearest example

The one node whose scope is big enough to have its own workers underneath — eleven scheduled
jobs in three roles. Its real output is continuous enrichment of the knowledge files; the daily
artifact is the synthesis on top.

**Intake workers** (collect, don't report): hourly ingest (every 60 min) · newsletters (7:10 AM)
**Synthesis workers**: reweave — digests + cross-connections written into the reference files
(3:35 AM) · morning report (5:10 AM) · editor's memo (5:30 AM weekdays)
**Upkeep workers**: cleanup (4:15) · refetch (4:45) · retry (hourly) · recommendations (7:25) ·
semantic index refit/gc (3:30 weekdays / 4:30)

The knowledge itself:
- [$VAULT/references/]($VAULT/references) — one file per saved reference; reweave edits these
  in place
- [$VAULT/references/.cache/library-candidates/]($VAULT/references/.cache/library-candidates)
  — discovered-not-yet-saved items awaiting review
- [$VAULT/references/.cache/kb-index.md]($VAULT/references/.cache/kb-index.md) — compact map of
  the library that other AI passes read for orientation

Its reports (one home since the 2026-07-07 cutover):
- [$VAULT/meta/loops/references/reports/]($VAULT/meta/loops/references/reports) — the daily
  synthesis; what "Full library report" opens
- [$VAULT/meta/loops/references/memos/]($VAULT/meta/loops/references/memos) — the weekly
  editor's essay behind "Read the memo" (older memos remain readable from the pre-cutover homes
  `meta/library-reports/` and `references/process/memos/`; nothing new lands there)

Bookkeeping:
- [$VAULT/meta/sources/.source-state.json]($VAULT/meta/sources/.source-state.json) — per-source
  fetch state

### 🎯 Goals node — shadow · runs 5:40 AM · home physically in $DATA · a roll-up node

Compares your stated priorities ([$VAULT/areas/index.md]($VAULT/areas/index.md)) against where
attention actually went. A "manager" node: it does no primary reading of its own — its evidence
is the meeting node's ledger plus raw signals (commits, meeting titles, library saves).
Contradictions escalate with evidence; keeps no state of its own.

- [$VAULT/meta/loops-shadow/meta/loops/areas/reports/]($VAULT/meta/loops-shadow/meta/loops/areas/reports)
  — its only drawer

### 📈 System node — live · runs 5:45 AM · home in the vault

The watchdog: every scheduled job's exit code, disk space, stale CLIs, missing artifacts. Its
escalations are the 🔴 items in the briefing. Known gap: it runs *before* the 6:00 briefing,
so a briefing failure isn't caught until the next morning.

- [$VAULT/meta/loops/system/reports/]($VAULT/meta/loops/system/reports)

### 📰 Briefing node — the top of the tree (and honestly, only half a node today)

Its scope is *reading the other nodes* and rendering one morning synthesis — a loop whose domain
is the loops. Today it runs as two jobs rather than a full node (it has a `feedback/` drawer but
no artifact/health drawers of its own — a known gap in the pattern):

1. **Gather** (per run): calendar, tasks, git, prior briefings, **plus every enabled node's
   latest artifact** (trimmed; escalations and health always whole).
2. **Write**: one AI pass, newspaper-editor style — day-thesis lede, sections, one entry per
   noteworthy meeting leading with its substance, asks nested and stamped with ledger IDs. The
   writing pass has **no file access**; it can only hand text back.
3. **Validate**: length floors, required links, structure. Rejects are kept as `.invalid-draft`.
4. **Render**: the Briefings view matches currently-escalated items to the editor's lines by
   those IDs — that's how verdict buttons attach to exactly the right sentences (amber marker =
   escalated).

Its files:
- [$VAULT/briefings/]($VAULT/briefings) — THE briefing, 6:00 AM daily (weekends under
  `weekend/`), loops-fed since the 2026-07-07 cutover. Weekdays a retry watcher re-attempts
  failures every 30 min; weekend failures wait for you or me. The v1/v2 A-B trial ended
  2026-07-06 (8 wins, 1 loss); the shadow copies from that period sit read-only in
  `$DATA/briefing-shadow/`.
- [$VAULT/meta/loops-shadow/meta/loops/briefings/feedback/records.jsonl]($VAULT/meta/loops-shadow/meta/loops/briefings/feedback/records.jsonl)
  — your per-item and whole-briefing critique, awaiting the node's future health pass

## Your part — what the buttons do

- **Approve** — "this is mine, hold me to it." Tracked; re-escalates if still open 7+ days after
  you accepted it.
- **Deciding is the only exit**: once an ask enters your queue it stays there until you rule on
  it — recency admits new asks, but a pending decision never expires by aging out (a holiday
  weekend proved the old behavior wrong, 2026-07-06).
- **Dismiss** — permanently out of your queue.
- **Assign to me** — same as approve today (wiring it to create a real task is a queued proposal).
- **Revise** — a correction, not a decision: text updates, item returns revised for a real verdict.
- **Feedback (💬 on any bullet)** — free-form; rides into the owning node's next run.

A verdict is a recorded decision first — the owning node applies it to its ledger at its next
run (7:30 PM for meeting asks). Since A6 there is ALSO an instant file effect: when the ask has
a proposal file in `$VAULT/tasks/.proposals/`, Approve/Assign moves it into `$VAULT/tasks/` as a
real task right away, Dismiss deletes the file (the ledger still remembers), and Revise appends
your note to it. Today the meetings node still mints proposals into its shadow drawer (see its
inventory above), so the instant effect starts mattering when its `proposal_sink` graduates to
the vault; pre-A6 asks never had files, and that's fine — the response just says so.

Proposals also have their own surface now: the **Proposals** section in the Priorities view
(collapsed behind a count; only appears when something is waiting) shows each proposal as a card
— title, the verbatim quote it came from, the meeting, the due date — with the same
Approve / Assign to agent / Dismiss / Revise buttons as the briefing.

## The daily rhythm

| Time | Node / worker |
|---|---|
| hourly | library intake (ingest, retry) |
| 7:30 PM | meetings node |
| 3:30–4:45 AM | library synthesis + upkeep (reweave, cleanup, refetch, semantic) |
| 5:10–5:30 AM | library morning report + memo |
| 5:40 AM | goals node |
| 5:45 AM | system node |
| 6:00 AM | the briefing (the tree's synthesis) |
| 7:10–7:25 AM | library newsletters + recommendations |
