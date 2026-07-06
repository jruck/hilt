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

## Where things physically live (exactly two places + two symlinks)

**1. The vault — `$VAULT`** ([open]($VAULT)). Your permanent, git-tracked knowledge base.
Everything trusted lives here: your notes, references, the v1 briefings, and the homes of the
two *live* nodes (library, system) under `$VAULT/meta/loops/`.

**2. Hilt's private data directory — `$DATA`.** The app's own working folder: **outside the
vault, not in git, not knowledge** — working machinery. This is where the **sandbox** lives:

- `$DATA/loops-shadow/` — the homes of the on-probation ("shadow") nodes: meetings, goals,
  and the briefing node's feedback drawer. Identical drawer structure to the vault homes,
  safer address: a misbehaving probation node can't touch anything permanent.
- `$DATA/briefing-shadow/` — every v2 briefing.

**The two symlinks (why some links land on "vault" addresses for sandbox data):** Hilt's Docs
tab can only browse the vault. So two git-ignored symlinks inside the vault point into the data
directory, purely for inspectability:

- `$VAULT/meta/loops-shadow` → `$DATA/loops-shadow`
- `$VAULT/meta/briefing-shadow` → `$DATA/briefing-shadow`

Same files, two paths. Links below use the vault symlink address (so they open in Docs), but
anything under `meta/loops-shadow` or `meta/briefing-shadow` **physically lives in `$DATA`**.

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

Its reports (three surfaces today — transition debt, collapsing to one at cutover):
- [$VAULT/meta/loops/references/reports/]($VAULT/meta/loops/references/reports) — the contract
  synthesis
- [$VAULT/meta/library-reports/]($VAULT/meta/library-reports) — legacy morning report; what
  "Full library report" opens today
- [$VAULT/references/process/memos/]($VAULT/references/process/memos) — the weekly essay behind
  "Read the memo"

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
escalations are the 🔴 items in the briefing. Known gap: it runs *before* the 6:00/6:20
briefings, so a briefing failure isn't caught until the next morning.

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
- [$VAULT/meta/briefing-shadow/]($VAULT/meta/briefing-shadow) — v2 briefings, 6:20 AM daily
  (weekends under `weekend/`; physically `$DATA/briefing-shadow/`)
- [$VAULT/briefings/]($VAULT/briefings) — v1 briefings, 6:00 AM, same editor **without** the
  node artifacts; the ablation baseline for judging what the nodes add (weekdays a retry watcher
  re-attempts failures of BOTH briefings every 30 min; weekend failures wait for you or me)
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

Nothing executes on click — a verdict is a recorded decision, applied at the owning node's next
run (7:30 PM for meeting asks).

## The daily rhythm

| Time | Node / worker |
|---|---|
| hourly | library intake (ingest, retry) |
| 7:30 PM | meetings node |
| 3:30–4:45 AM | library synthesis + upkeep (reweave, cleanup, refetch, semantic) |
| 5:10–5:30 AM | library morning report + memo |
| 5:40 AM | goals node |
| 5:45 AM | system node |
| 6:00 AM | v1 briefing (ablation baseline) |
| 6:20 AM | v2 briefing (the tree's synthesis) |
| 7:10–7:25 AM | library newsletters + recommendations |
