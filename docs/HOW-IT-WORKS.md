# How Hilt's Briefing System Works

> **This is a living, canonical reference — rendered inside Hilt** (the ⓘ icon in the top bar).
> **If you change anything it documents** — a node, a schedule, a file location, the briefing
> pipeline, the verdict/feedback flow — **update this document in the same change.**
> It lives at `docs/HOW-IT-WORKS.md` in the hilt repo.

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
its source (a transcript, a job exit code, a saved article). One home folder per node, same
drawers inside: `meta/loops/<domain>/{reports,state,verdicts,feedback}/`.

**The sandbox wrinkle (temporary):** trusted nodes' homes live in the vault
([open](open://$VAULT/meta/loops)); on-probation nodes' homes live in the sandbox
([open](open://$VAULT/meta/loops-shadow)) — same drawers, safer address. Graduation = copy the
home into the vault, flip one line in the roster:
[registry.yml](open://$VAULT/meta/loops/registry.yml). (The sandbox physically lives at
`~/.hilt/data/loops-shadow`; `meta/loops-shadow` and `meta/briefing-shadow` are git-ignored vault
symlinks so everything stays inspectable here.)

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

Not a strict hierarchy: the goals node reads the meetings node's state sideways; the system node
watches everything including the briefing itself. And the "raw feeds" line is the honest gap —
part of the briefing's scope still arrives unsynthesized. That's where future nodes slot in
(two are already registered but dormant: **people-projections** — "you've been waiting on Trudy
for 3 weeks", a projection of the meeting ledger — and **calendar-tasks**, which would turn the
calendar/task feeds into a real node with overdue/deadline escalations).

---

## The nodes, with their full inventories

### 🤝 Meetings node — shadow · runs 7:30 PM

Reads each meeting's note **and full transcript**; extracts commitments, a 1–2 sentence meeting
summary, and closure evidence. Parses only meetings ≤30 days old; escalates only **your** (or
unclear-owner) commitments from the last 3 days as asks.

Home: [SANDBOX/meetings/](open://$VAULT/meta/loops-shadow/meta/loops/meetings)
- [reports/](open://$VAULT/meta/loops-shadow/meta/loops/meetings/reports) — daily artifact:
  meeting summaries, ledger deltas, escalated asks
- [state/ledger.json](open://$VAULT/meta/loops-shadow/meta/loops/meetings/state/ledger.json) —
  every open commitment: ID, owner, verbatim quote, status history
- [state/meeting-summaries.json](open://$VAULT/meta/loops-shadow/meta/loops/meetings/state/meeting-summaries.json)
  — the per-meeting context sentences the briefing leads with
- [state/processed-meetings.json](open://$VAULT/meta/loops-shadow/meta/loops/meetings/state/processed-meetings.json)
  — read-tracking so no meeting is parsed twice
- [verdicts/records.jsonl](open://$VAULT/meta/loops-shadow/meta/loops/meetings/verdicts/records.jsonl)
  — every Approve / Dismiss / Revise you click
- [feedback/records.jsonl](open://$VAULT/meta/loops-shadow/meta/loops/meetings/feedback/records.jsonl)
  — your written feedback on its items
- One vault outpost: [state/gold-set.json](open://$VAULT/meta/loops/meetings/state/gold-set.json)
  — the frozen 36-meeting evaluation truth-set (deliberately in the vault; it's evidence, not
  working state)

### 📚 Library node — live · a sub-team, the fractal's clearest example

The one node whose scope is big enough to have its own workers underneath — eleven scheduled
jobs in three roles. Its real output is continuous enrichment of the knowledge files; the daily
artifact is the synthesis on top.

**Intake workers** (collect, don't report): hourly ingest (every 60 min) · newsletters (7:10 AM)
**Synthesis workers**: reweave — digests + cross-connections written into the reference files
(3:35 AM) · morning report (5:10 AM) · editor's memo (5:30 AM weekdays)
**Upkeep workers**: cleanup (4:15) · refetch (4:45) · retry (hourly) · recommendations (7:25) ·
semantic index refit/gc (3:30 weekdays / 4:30)

The knowledge itself:
- [references/](open://$VAULT/references) — one file per saved reference; reweave edits these
  in place
- [Candidate pile](open://$VAULT/references/.cache/library-candidates) — discovered-not-yet-saved
  items awaiting review
- [kb-index.md](open://$VAULT/references/.cache/kb-index.md) — compact map of the library that
  other AI passes read for orientation

Its reports (three surfaces today — transition debt, collapsing to one at cutover):
- [Daily artifact](open://$VAULT/meta/loops/references/reports) — the contract synthesis
- [Legacy morning report](open://$VAULT/meta/library-reports) — what "Full library report" opens
  today
- [Editor's memos](open://$VAULT/references/process/memos) — the weekly essay behind "Read the
  memo"

Bookkeeping:
- [Source health](open://$VAULT/meta/sources/.source-state.json) — per-source fetch state

### 🎯 Goals node — shadow · runs 5:40 AM · a roll-up node

Compares your stated priorities ([areas/index.md](open://$VAULT/areas/index.md)) against where
attention actually went. A "manager" node: it does no primary reading of its own — its evidence
is the meeting node's ledger plus raw signals (commits, meeting titles, library saves).
Contradictions escalate with evidence; keeps no state of its own.

- Home: [SANDBOX/areas/](open://$VAULT/meta/loops-shadow/meta/loops/areas) — just
  [reports/](open://$VAULT/meta/loops-shadow/meta/loops/areas/reports)

### 📈 System node — live · runs 5:45 AM

The watchdog: every scheduled job's exit code, disk space, stale CLIs, missing artifacts. Its
escalations are the 🔴 items in the briefing. Known gap: it runs *before* the 6:00/6:20
briefings, so a briefing failure isn't caught until the next morning.

- Home: [VAULT/system/](open://$VAULT/meta/loops/system) —
  [reports/](open://$VAULT/meta/loops/system/reports)

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
- [v2 briefings](open://$VAULT/meta/briefing-shadow) — 6:20 AM daily, weekends under `weekend/`
- [v1 briefings](open://$VAULT/briefings) — 6:00 AM, same editor **without** the node artifacts;
  the ablation baseline for judging what the nodes add (weekdays a retry watcher re-attempts
  failures every 30 min; weekend failures wait for you or me)
- [Your briefing critique](open://$VAULT/meta/loops-shadow/meta/loops/briefings/feedback/records.jsonl)
  — per-item and whole-briefing feedback, awaiting the node's future health pass

## Your part — what the buttons do

- **Approve** — "this is mine, hold me to it." Tracked; re-escalates if still open 7+ days after
  you accepted it.
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
