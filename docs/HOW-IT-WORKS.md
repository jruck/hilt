# How Hilt's Briefing System Works

> **This is a living, canonical reference — rendered inside Hilt** (the ⓘ icon in the top bar).
> **If you change anything it documents** — a node, a schedule, a file location, the briefing
> pipeline, the verdict/feedback flow — **update this document in the same change.**
> It lives at `docs/HOW-IT-WORKS.md` in the hilt repo. Every link below shows the full real
> path it opens.
>
> Remaining cleanup, unfinished v2 contract work, enhancements, and future autonomy are separated
> and prioritized in the
> [Briefings v2 Completion Roadmap](./plans/briefings-v2-completion-roadmap.md).

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
     │                            reads broad git + meeting/ledger/library evidence
     ├─ 📈 SYSTEM node            5:45 AM · live — watches every job in this tree
     └─ ── raw feeds (no node yet): code/session activity · calendar · task lists · reminders
```

`Work & product` is currently editorial synthesis over the broad evidence gathered for the briefing,
not a separate registered node. Code and agent activity, Bridge structure, loop artifacts, and
consequential meeting/delivery evidence can all contribute. There is no project allowlist: Bridge's
hierarchy and observed activity decide what is eligible. A deeper folder-native workstream discovery
layer remains a future enhancement, not a prerequisite for today's briefing.

Not a strict hierarchy: the goals node reads the meetings node's state sideways; the system node
watches everything including the briefing itself. And the "raw feeds" line is the honest gap —
part of the briefing's scope still arrives unsynthesized. That's where future nodes slot in
(two are already registered but dormant: **people-projections** — "you've been waiting on Trudy
for 3 weeks", a projection of the meeting ledger — and **calendar-tasks**, which would turn the
calendar/task feeds into a real node with overdue/deadline escalations).

---

## The nodes, with their full inventories

### 🤝 Meetings node — shadow · runs minutes after each meeting + 7:30 PM sweep · home physically in $DATA

Reads each meeting's note **and full transcript** in two stages. First, a ledger-blind pass extracts
the meeting summary plus raw commitment and closure observations. Second, identity resolution
compares those observations with the canonical SQLite ledger. The resolver always sees the complete
trailing 30-day active window, every older pending proposal and accepted-open commitment, recent
dismissals, and older exact/FTS candidates. If that required packet exceeds 40,000 ledger tokens it
is processed in exhaustive chunks and the candidate union is adjudicated; recent history is never
silently truncated. The loop escalates only **your** (or unclear-owner) recent/first-touch
commitments as asks.

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
  processed (they share the same SQLite processed set and writer lock).

- [$VAULT/meta/loops-shadow/meta/loops/meetings/reports/]($VAULT/meta/loops-shadow/meta/loops/meetings/reports)
  — daily artifact: meeting summaries, ledger deltas, escalated asks
- `$DATA/meeting-ledgers/<vault-key>/meeting-ledger.sqlite` — canonical operational memory for every
  observed commitment, citation, sighting, state transition, meeting summary, processed stamp,
  extraction run, and immutable event. It is evidence and deduplication memory, not a second task
  database. Only recent or first-touch observations owned by Justin (or with unclear ownership)
  cross the escalation gate and receive a proposal file; older backfill observations remain
  ledger-only so initial indexing cannot flood Priorities.
- `$DATA/meeting-ledgers/<vault-key>/exports/` — nightly readable JSON for inspection and compatibility.
  The original pre-migration `ledger.json`, `meeting-summaries.json`, and `processed-meetings.json`
  remain immutable recovery artifacts and are no longer runtime inputs.
- `$DATA/meeting-ledgers/<vault-key>/backups/` — a verified atomic `latest.sqlite`, 14 daily snapshots,
  and 12 monthly snapshots. A failed integrity check or backup latches writes off rather than opening
  or creating an empty database. Migration, audit, restore, and rollback commands are documented in
  [Meeting Ledger Operations and Recovery](MEETING-LEDGER-RECOVERY.md).
- `$DATA/loops/meeting-trigger-state.json` — the post-meeting trigger's own memory: per meeting,
  the transcript-stability countdown and the fired-at stamp that guarantees at-most-once firing
- [$VAULT/meta/loops-shadow/meta/loops/meetings/proposals/]($VAULT/meta/loops-shadow/meta/loops/meetings/proposals)
  — the proposals drawer: every ask that escalates to you ALSO becomes a task proposal file
  here (full task-file format, status `proposed`). While the node is in shadow this drawer is
  its sink; when the registry's `proposal_sink: vault` flips at the gate, new proposals land in
  `$VAULT/tasks/.proposals/` instead — where the Priorities view's Proposals section and the
  verdict buttons' instant file effects pick them up. A ledger entry mints its proposal exactly
  once (`task_id` stamp), so re-runs never duplicate and a dismissed proposal can't come back.
- `$VAULT/tasks/.id-sequences.json` — permanent per-date task-ID reservations. Proposal dismissal
  removes its Markdown file, but its number remains consumed; creation is lock-serialized and
  atomic so two writers cannot assign one identity to different work.
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

**Intake workers** (collect, don't report): live explicit-save intake (immediate/60 sec while Library
is open, five minutes otherwise, with hourly fallback) · newsletters (7:10 AM)
**Synthesis workers**: reweave — digests + cross-connections written into the reference files
(3:35 AM) · morning report (5:10 AM) · For You editorial batch (5:20 AM) · editor's memo
(Saturday 5:30 AM, before the weekend edition)
**Upkeep workers**: cleanup (4:15) · refetch (4:45) · retry (hourly) · semantic index refit/gc
(3:30 weekdays / 4:30)

The knowledge itself:
- [$VAULT/references/]($VAULT/references) — one file per saved reference; reweave edits these
  in place
- [$VAULT/references/.cache/library-candidates/]($VAULT/references/.cache/library-candidates)
  — discovered-not-yet-saved items awaiting review
- [$VAULT/references/.cache/kb-index.md]($VAULT/references/.cache/kb-index.md) — compact map of
  the library that other AI passes read for orientation

Its reports (one home since the 2026-07-07 cutover):
- [$VAULT/meta/loops/references/reports/]($VAULT/meta/loops/references/reports) — the daily
  synthesis; what "Daily library report" opens
- [$VAULT/meta/loops/references/memos/]($VAULT/meta/loops/references/memos) — the weekly
  editor's essay behind "Read the memo" (older memos remain readable from the pre-cutover homes
  `meta/library-reports/` and `references/process/memos/`; nothing new lands there)

Bookkeeping:
- [$VAULT/meta/sources/.source-state.json]($VAULT/meta/sources/.source-state.json) — per-source
  fetch state
- `$DATA/library-recommendations/<vault-key>/` — immutable For You batches, the latest-episode feed
  projection, recommendation-only dismissals, and refresh/backoff state. Recommending an old item
  again writes a new episode and moves the same Library card to the top with a new contextual pitch.

### 🎯 Goals node — shadow · runs 5:40 AM · home physically in $DATA · a roll-up node

Compares your stated priorities ([$VAULT/areas/index.md]($VAULT/areas/index.md)) against where
attention actually went. A "manager" node: it reads broad observed git activity alongside meeting
titles, the open ledger, and Library saves. It does not gate evidence through a project registry.
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

1. **Gather** (per run): calendar, tasks, prior briefings, broad git/session activity, **plus every
   enabled node's latest artifact** (trimmed; escalations and health always whole). Library contributes
   up to three new unread recommendation episode IDs in current For You order, never padding with stale
   material. Canonical pending meeting decisions are supplied separately with meeting summaries,
   citations, and allowed task IDs; task titles are intentionally omitted.
2. **Write**: one AI pass, newspaper-editor style — day-thesis lede, sections, and light prose
   over object IDs (**the briefing is a canvas**: the editor summarizes and places ids; the app
   renders the live objects where the ids sit). For **⏭ Decisions awaiting you**, the editor chooses
   and orders featured meetings, writes substantive meeting context, and places only supplied IDs
   beneath exact meeting citations. The harness then preserves that prose/order, corrects canonical
   source-meeting membership, and appends omissions. `Work & product` selects consequential movement
   across all observed local evidence without a configured project roster or item quota. Library recommendation IDs use the canvas pattern inside
   three explicit modules: `Recommended for you` holds a 40–90 word editorial set lead, frozen
   `rec:<episode-id>` rows, and attached `View all`; the Saturday-anchored weekend edition may add a
   full-width `Editor's memo`; and `Library health` closes quietly with the exact day's deterministic
   health summary and report link. Weekdays omit the memo, missing daily reports never fall back to
   an older link, and historical flat Library sections still render generically. Opening a
   recommendation row is the first real Library open. 📅 *Today* is the day's **shape**, not its inventory (gate-B
   feedback): the editor groups blocks into arcs, names the day's pivot, flags conflicts and
   prep needs, and compresses routine events into a clause — the calendar and HUD already list
   every event, so a flat enumeration is a regression. The writing pass has **no file access**;
   it can only hand text back.
3. **Validate**: length floors, required links, section order, exact decision membership and
   source-meeting grouping. Pending proposal IDs outside Decisions, queue prose repeated in Work/Closed loops,
   duplicate or unsupported queue IDs, and invented citations reject publication. Rejects are
   kept as `.invalid-draft`; older briefings without the new contract still render unchanged.
4. **Render** (the canvas): the Briefings view hydrates the ids in the editor's lines —
   - a **task id** (`t-…`) becomes the live task card: title, verbatim quote, due date, and the
     same Approve / Assign to agent / Dismiss / Revise buttons as everywhere else while it's a
     proposal; once accepted it shows read-only with its status badge (approve something at
     8 AM and the 6 AM briefing already reflects it).
   - a **Decisions meeting entry** is collapsed by default and hydrates exactly its stamped proposal
     IDs. The active daily/weekend briefing may append new canonical proposals; history cannot.
     The header shows meeting/date, editorial or stored meeting context, and live pending count. When
     context is unavailable it shows identity and count only, never synthesized task-title prose. Accepted/dismissed items
     leave the count and move behind `Resolved · N`; urgent groups alone receive amber treatment.
   - a **ledger item id** with no task file (older asks, signals, insights) keeps the original
     treatment: verdict buttons attach to exactly the editor's sentence (amber marker =
     escalated). Old briefings carry no task ids and render exactly as they always did.
   - **library recommendations** passively hydrate frozen episode IDs into compact cards without
     recording an open; clicking one is the first real Library open.
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
library item) and it becomes a **pending message** in that object's conversation in
`$DATA/threads/`. Sending from the small comment box is intentionally asynchronous: it records the
thought and gets you back to reading without starting Claude. From there it can travel one of two
roads:

- **Scheduled use (the passive road).** A node that genuinely consumes this feedback marks the
  exact messages it used and records a visible outcome without closing the conversation. Today the
  meetings node consumes its pending comments as calibration on its next extraction run. Library
  comments enter the daily steering pass and receive an `Added to steering` outcome. Goals and
  System comments remain pending until a substantive processor can answer them; Hilt does not hide
  them behind a hollow automatic receipt. A comment already handled on demand is not consumed a
  second time by the scheduled pass.
- **Processing now (the active road).** Sometimes a comment is a request, or you simply want to
  explore it immediately. Hit **Process now** and Hilt opens that conversation in the full Chats
  pane before starting Claude, so the response, typing state, tool calls, and touched files appear
  live. **Process all** still drains up to 10 pending conversations serially. A turn uses the
  anchored object and only the pending messages as its next volley. There are four outcomes:
  - **Answer only** → it answers the question and explicitly says no durable action was taken.
  - **Small enough to do now** → it makes the surgical edit and replies with what it changed.
  - **Bigger than a local edit** → it does NOT attempt it; instead it **mints a proposal task**
    into `$VAULT/tasks/.proposals/` (carrying a link back to the thread) and replies telling you
    it filed one. That proposal then flows through the normal Approve / Dismiss verdict path like
    any other.
  - **About Hilt itself** (a bug or feature request about the app, not your content) → it
    investigates the code read-only, replies with a diagnosis, and the thread stays open — dev
    items wait for Justin's dev pass instead of being auto-fixed.

  The outcome label says what actually happened: `Answered`, `Changed files`, `Proposal created`,
  or `Dev item`. A successful turn handles that volley but does not close the conversation. Later
  comments reuse the same thread, saved chat, and Claude session. Comments posted while a turn is
  running wait as the next volley and run afterward. **Close conversation** is the only boundary;
  the next comment after closing starts a new conversation. If a Claude turn fails, its messages
  remain pending for retry.

The point: comment and chat are one model with two tempos. The small surface captures work for
later; processing opens the full conversation and acts now. Outcomes make the handoff explicit
without pretending every answer changed the product.

Every one of these conversations is also visible in one place: the top-level **Chats** tab
(described below) lists every feedback thread across the system alongside every free-standing chat.

Proposals also have their own surface now: the **Proposals** section in the Priorities view
(collapsed behind a count; only appears when something is waiting) shows each proposal as a card
— title, the verbatim quote it came from, the meeting, the due date — with the same
Approve / Assign to agent / Dismiss / Revise buttons as the briefing. New proposals also carry a
short paragraph of the discussion the commitment arose from — open one and it's the first thing
in the body (older proposals predate this and simply don't have it). Dismissed proposals are
never gone from the UI: a quiet "Dismissed · N" divider expands into the meeting-ledger record
of what you declined in the last 30 days, including the original title, time, optional reason,
and a restore control. Restore recreates the same proposal identity immediately and records a
ledger reopen for the next meetings-node run; it never mints a duplicate task.

## Chats — every conversation, one tab

A conversation in Hilt is one concept with two shapes. Some are **anchored to an object** — the
feedback conversations from the flywheel above: your comments, the agent's replies, and the saved
tool activity, attached to a task, meeting, briefing line, or library item. Others are
**free-standing** — chats started without an object behind them. They used to live in two System
sub-tabs (Threads and Chats); now they share one
top-level **Chats** view in the main nav, between Docs and System — they were too buried in the
System tab, and System is back to pure monitoring.

The view is a split workspace: the merged conversation list on the left, the open conversation on
the right (drag the divider to resize — it remembers). A chat that belongs to a thread — one the
processor minted while working that thread — never appears twice: it renders inside its thread's
conversation, not as a row of its own.

Three lenses across the toolbar pick what the list shows: **Needs you** (conversations with pending
comments, dev items, active runs, or unread attached/free-chat replies), **All**, and **Done**
(explicitly closed conversations and archived chats). An open conversation with no pending or
unread work is quiet rather than permanently demanding attention. The tab opens on Needs you
whenever something actually needs you, otherwise All. Under the toolbar, kind tabs (Library, Docs,
Tasks, Meetings, Loops, Briefings, …) narrow the list to what a conversation is about.

**Conversation rows** show their pending-message count or latest explicit outcome — `Answered`,
`Changed files`, `Proposal created`, `Dev item`, `Used as calibration`, or `Added to steering`.
Click a row and the conversation opens on the right with the comments, replies, and tool/trace
evidence. If the processor is working, the drawer streams it live and the row carries a small
emerald `Processing` pulse. **Process all** drains the pending queue with live `n/total` progress
and can be canceled. **Process now** also sits under each object's comments and always switches to
this full view before the run starts.

**Chat rows** keep their chat-client behaviors. A running chat shows the emerald "Running" pulse;
one with replies you haven't read shows a blue "Unread" badge with the count. Click a chat to
reopen it with its full history and just keep talking — it resumes the same Claude session, even
after an app restart. Each row's ⋮ menu can archive/unarchive a chat, rename it, or mark it
read/unread — and a chat you deliberately mark unread *stays* unread until you actually open it,
so you can flag one for later without the app "helpfully" clearing it. Archived chats live under
the Done lens, out of the way but never deleted.

Old `System → Threads` / `System → Chats` links still work — they redirect to the Chats tab.

## The daily rhythm

| Time | Node / worker |
|---|---|
| hourly | library intake (ingest, retry) |
| minutes after each meeting | meetings node (post-meeting trigger, just that meeting) |
| 7:30 PM | meetings node (nightly sweep — the safety net) |
| 3:30–4:45 AM | library synthesis + upkeep (reweave, cleanup, refetch, semantic) |
| 5:10–5:20 AM daily; 5:30 AM Saturday | daily library report → For You editorial batch; weekly memo before the weekend edition |
| 5:40 AM | goals node |
| 5:45 AM | system node |
| 6:00 AM | the briefing (the tree's synthesis) |
| 7:10 AM | library newsletters |
