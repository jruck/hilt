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
3. **keeps its memory** in a `state/` drawer, and **receives your judgment** in a `verdicts/`
   drawer plus your written **feedback**, which it reads at its next run. Feedback lives as
   comment THREADS in `$DATA/threads/` (one JSON per conversation, shared by every node and
   the library) — the old per-node `feedback/records.jsonl` drawers are frozen history.
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

### 🤝 Meetings node — shadow · runs minutes after each meeting + 7:30 PM sweep · home physically in $DATA

Reads each meeting's note **and full transcript**; extracts commitments, a 1–2 sentence meeting
summary, and closure evidence. Parses only meetings ≤30 days old; escalates only **your** (or
unclear-owner) commitments from the last 3 days as asks.

**When it runs (two paths, same loop):**
- **Minutes after a meeting ends** — the Granola sync daemon watches every meeting it syncs;
  once the meeting's enhanced notes have landed AND the transcript has stopped growing (no
  growth across 3 sync polls spanning at least 2 minutes — quality over speed: the extraction
  reads the enhanced note), it runs the loop for just that meeting. Each meeting fires at most
  once (tracked in `$DATA/loops/meeting-trigger-state.json`, which survives restarts), runs are
  strictly one-at-a-time, and anything the nightly already read never re-fires. Kill switch:
  `HILT_MEETING_TRIGGER=0`.
- **7:30 PM nightly sweep** — unchanged, the safety net: it catches meetings the trigger missed
  (no transcript, trigger disabled, run failure) and skips everything the trigger already
  processed (they share the same read-tracking and ledger).

- [$VAULT/meta/loops-shadow/meta/loops/meetings/reports/]($VAULT/meta/loops-shadow/meta/loops/meetings/reports)
  — daily artifact: meeting summaries, ledger deltas, escalated asks
- [$VAULT/meta/loops-shadow/meta/loops/meetings/state/ledger.json]($VAULT/meta/loops-shadow/meta/loops/meetings/state/ledger.json)
  — every open commitment: ID, owner, verbatim quote, status history
- [$VAULT/meta/loops-shadow/meta/loops/meetings/state/meeting-summaries.json]($VAULT/meta/loops-shadow/meta/loops/meetings/state/meeting-summaries.json)
  — the per-meeting context sentences the briefing leads with
- [$VAULT/meta/loops-shadow/meta/loops/meetings/state/processed-meetings.json]($VAULT/meta/loops-shadow/meta/loops/meetings/state/processed-meetings.json)
  — read-tracking so no meeting is parsed twice (shared by the post-meeting trigger and the
  nightly — whichever reads a meeting first stamps it here)
- `$DATA/loops/meeting-trigger-state.json` — the post-meeting trigger's own memory: per meeting,
  the transcript-stability countdown and the fired-at stamp that guarantees at-most-once firing
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
  — your written feedback on its items **before the threads cutover** (frozen history; new
  feedback lands as threads in `$DATA/threads/` and the node reads it from there)
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
   latest artifact** (trimmed; escalations and health always whole). Since B3, a meeting ask
   that minted a proposal shows its task id in the artifact (`` `ma-…` → task `t-…` ``), so the
   editor can place the task itself.
2. **Write**: one AI pass, newspaper-editor style — day-thesis lede, sections, and light prose
   over object IDs (**the briefing is a canvas**: the editor summarizes and places ids; the app
   renders the live objects where the ids sit). Daily sections since B3: 🧠 *Don't drop this* is
   pure forward-looking (deadlines, commitments coming due — never a pile of meeting asks), and
   a new **⏭ Next steps** section owns looking backward: one entry per recent meeting with
   pending proposals — a substance lead, the meeting citation, then that meeting's pending
   proposal task ids, one per line. 📅 *Today* is the day's **shape**, not its inventory (gate-B
   feedback): the editor groups blocks into arcs, names the day's pivot, flags conflicts and
   prep needs, and compresses routine events into a clause — the calendar and HUD already list
   every event, so a flat enumeration is a regression. The writing pass has **no file access**;
   it can only hand text back.
3. **Validate**: length floors, required links, structure (the spine now accepts ⏭ between 🧠
   and 💼; older briefings without it validate unchanged). Rejects are kept as `.invalid-draft`.
4. **Render** (the canvas): the Briefings view hydrates the ids in the editor's lines —
   - a **task id** (`t-…`) becomes the live task card: title, verbatim quote, due date, and the
     same Approve / Assign to agent / Dismiss / Revise buttons as everywhere else while it's a
     proposal; once accepted it shows read-only with its status badge (approve something at
     8 AM and the 6 AM briefing already reflects it).
   - a **⏭ meeting entry** becomes an expandable meeting card showing that meeting's live
     pending cards — the same join the meeting view's "Next steps" accordion uses, so deciding
     in either place updates both. The card's header IS the meeting reference (title + date),
     so the editor's own-meeting citation line is suppressed inside the expansion as redundant;
     citations pointing at any *other* source still render. Since B5 the header lead also
     carries the meeting's chip — click it to preview the meeting or jump to it in People.
   - a **ledger item id** with no task file (older asks, signals, insights) keeps the original
     treatment: verdict buttons attach to exactly the editor's sentence (amber marker =
     escalated). Old briefings carry no task ids and render exactly as they always did.
   - **library items** stay prose + the report link — deliberately not hydrated into cards yet
     (the by-id fetch records an "opened" event, which passive rendering would pollute).
   - **object pills** (new at B5): when the editor cites an object as a `hilt:` link
     (`[OC planning](hilt:meeting/meetings/…/OC planning.md)`), it renders as a small inline
     chip with the object's icon. Click the chip to preview the object's card in a popover —
     meeting title, time, attendees, Granola link — and click the card's title to jump to the
     object itself (a meeting opens in People, a task in Bridge). On a phone, tapping the chip
     jumps straight there. The same chips appear outside the briefing too: a task card's
     "which meeting did this come from" line, and the meeting citation inside an expanded ask
     row. A meeting chip carries its **date inside the chip** ("Standup · Jul 7"; the year is
     added when it isn't this year) — that's how you tell which instance of a recurring
     meeting it points at. A chip without a date refers to the meeting series as a whole. The
     editor is told never to write a date after a meeting chip (the chip already carries it —
     and if one slips through, the reader strips it), and to keep sub-bullets for *evidence* —
     a sub-bullet that is nothing but a citation now draws a soft validator warning (never a
     failure, so old briefings are untouched).

Its files:
- [$VAULT/briefings/]($VAULT/briefings) — THE briefing, 6:00 AM daily (weekends under
  `weekend/`), loops-fed since the 2026-07-07 cutover. Weekdays a retry watcher re-attempts
  failures every 30 min; weekend failures wait for you or me. The v1/v2 A-B trial ended
  2026-07-06 (8 wins, 1 loss); the shadow copies from that period sit read-only in
  `$DATA/briefing-shadow/`.
- [$VAULT/meta/loops-shadow/meta/loops/briefings/feedback/records.jsonl]($VAULT/meta/loops-shadow/meta/loops/briefings/feedback/records.jsonl)
  — your per-item and whole-briefing critique **before the threads cutover** (frozen history;
  new critique lands as threads in `$DATA/threads/`, awaiting the node's future health pass)

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
- **A note with your verdict (💬 in the verdict-button row)** — the same comment gesture, next to
  the buttons: type a note and click ANY verdict and the note travels with the decision (the
  node's ledger keeps it). Notes on a **Dismiss** matter most: the reason rides the node's
  "recently dismissed" memory, so the extractor learns WHY you declined — not just that you did.
  Send the note WITHOUT clicking a verdict and it's a pure comment on the item (feedback, no
  decision) — Revise stays for now, but this is where it's headed (Phase C threads).

A verdict is a recorded decision first — the owning node applies it to its ledger at its next
run (for meeting asks: the next post-meeting trigger run or the 7:30 PM sweep, whichever
comes first). Since A6 there is ALSO an instant file effect: when the ask has
a proposal file in `$VAULT/tasks/.proposals/`, Approve/Assign moves it into `$VAULT/tasks/` as a
real task right away, Dismiss deletes the file (the ledger still remembers), and Revise appends
your note to it. And since the gate-B round, a verdict whose file effect lands ALSO adds the
task's line to this week's list — **both kinds now**: Approve / Assign to me splice at the top
of Tasks (same spot the + button puts a new task), and Assign to agent joins a
**"Ready for agents"** section toward the bottom of the week (scoped and ready for an agent to
process, just not run yet — created automatically the first time it's needed), so no accepted
task is ever invisible. Every promoted task arrives with the **🆕 marker** in its title — the
same amber left-accent convention new tasks have always used — and viewing the task strips it
(the read receipt), so you can see at a glance what the loops added since you last looked.
(Only when the current list is the new v2 format; if the list write ever fails, the task file
still exists and the verdict still counts.) Today the
meetings node still mints proposals into its shadow drawer (see its inventory above), so the
instant effect starts mattering when its `proposal_sink` graduates to the vault; pre-A6 asks
never had files, and that's fine — the response just says so.

Every verdict button explains itself on hover: Approve = "take this on — becomes your task and
joins this week's list"; Assign to agent = "mark as agent work — joins this week's Ready for
agents section (agent execution arrives in Phase C)"; Dismiss = "decline — removed; the loop
remembers and won't re-propose it"; Revise = "send a correction — returns for a fresh verdict".

## The feedback flywheel — what happens to a comment you leave

A comment is never a dead end. Leave one on any object (a briefing bullet, a task, a meeting, a
library item) and it becomes a **thread** in `$DATA/threads/`, open and waiting. From there it
travels one of two roads:

- **Calibration (the passive road).** Every node, on its next run, sweeps up the open comment
  threads that belong to it and rides them into its work as *calibration guidance* — the same
  "here's what Justin told you last time" nudge nodes have always used. What's new: instead of
  silently marking the thread "handled," the node now **replies in the thread** ("Consumed as
  calibration guidance for the `<node>` run `<date>`.") and resolves it. You can see it was read.
  This is automatic — the meetings, goals, system, and library nodes all do it at their scheduled
  runs; the library node's version says "Clustered into the steering report `<date>`."
- **Processing (the active road).** Sometimes a comment is a *request*, not just calibration —
  "fix the owner on this," "this summary is wrong." Hit **Process** on the thread (or **Process
  all** to drain the queue, up to 10 at a time) and a Claude turn opens the object, reads your
  thread, and acts within its tools (Read/Edit/Write — no shell). Three outcomes:
  - **Small enough to do now** → it makes the surgical edit and replies with what it changed.
  - **Bigger than a local edit** → it does NOT attempt it; instead it **mints a proposal task**
    into `$VAULT/tasks/.proposals/` (carrying a link back to the thread) and replies telling you
    it filed one. That proposal then flows through the normal Approve / Dismiss verdict path like
    any other.
  - **About Hilt itself** (a bug or feature request about the app, not your content) → it
    investigates the code read-only, replies with a diagnosis, and the thread stays open — dev
    items wait for Justin's dev pass instead of being auto-fixed.

  Edits and proposals resolve the thread with the reply; dev items stay open with a diagnosis.
  The whole exchange is saved as an ordinary chat you can reopen later. If the Claude turn fails,
  the thread stays open — nothing is lost, just try again.

The point: a comment is a lever, not a note. It either steers a node's next run (with a receipt)
or gets acted on directly (with an edit or a proposal). Nothing you write just sits there unseen.

Every thread is also visible in one place: **System → Threads** lists every feedback thread across
the system (filterable Open / Resolved / All). Resolved rows say *how* they resolved — "Calibrated · meeting-actions", "Clustered", "Proposal minted" — and anything resolved in the last day carries a small blue dot, so a node quietly consuming your comments overnight is visible at a glance. Click any row and it opens as a conversation drawer:
the original thread, the saved chat transcript of what the processor did, and the tool/trace evidence
for that run. If the processor is working, the drawer streams the chat live and the row carries a
small emerald "Processing" pulse. **Process all** drains the open queue with live `n/total` progress
and can be canceled; anything already processed stays resolved. The **Process** affordance also
still sits under each object's own thread, so you can act on a comment from wherever you find it.

Chats have the same kind of home: **System → Chats** is the log of every Claude chat Hilt has
started — from a Library reference, a doc, wherever — as a split workspace: the list of chats on
the left (filterable by what each chat is about — Library, Docs, People, …), the open conversation
on the right, drag the divider to resize (it remembers). Chats needing your attention sort to the
top: a running chat shows the emerald "Running" pulse, one with replies you haven't read shows a
blue "Unread" badge with the count. Click a chat to reopen it with its full history and just keep
talking — it resumes the same Claude session, even after an app restart. Each row's ⋮ menu can
archive/unarchive a chat, rename it, or mark it read/unread — and a chat you deliberately mark
unread *stays* unread until you actually open it, so you can flag one for later without the app
"helpfully" clearing it. Archived chats live in a collapsed group at the bottom, out of the way
but never deleted.

Proposals also have their own surface now: the **Proposals** section in the Priorities view
(collapsed behind a count; only appears when something is waiting) shows each proposal as a card
— title, the verbatim quote it came from, the meeting, the due date — with the same
Approve / Assign to agent / Dismiss / Revise buttons as the briefing. New proposals also carry a
short paragraph of the discussion the commitment arose from — open one and it's the first thing
in the body (older proposals predate this and simply don't have it). Dismissed proposals are
never gone from the UI: a quiet "Dismissed · N" divider at the tail of the section expands into
the record of what you declined in the last 30 days (title + when) — read from the meetings
node's ledger, so a fresh dismiss shows up there after the node's next run. It's a record, not
cards: the files are deleted, the ledger remembers.

## The daily rhythm

| Time | Node / worker |
|---|---|
| hourly | library intake (ingest, retry) |
| minutes after each meeting | meetings node (post-meeting trigger, just that meeting) |
| 7:30 PM | meetings node (nightly sweep — the safety net) |
| 3:30–4:45 AM | library synthesis + upkeep (reweave, cleanup, refetch, semantic) |
| 5:10–5:30 AM | library morning report + memo |
| 5:40 AM | goals node |
| 5:45 AM | system node |
| 6:00 AM | the briefing (the tree's synthesis) |
| 7:10–7:25 AM | library newsletters + recommendations |
