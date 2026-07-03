# How Hilt's Briefing System Works

> **This is a living, canonical reference — rendered inside Hilt** (the ⓘ icon in the top bar).
> **If you change anything it documents** — a loop, a schedule, a file location, the briefing
> pipeline, the verdict/feedback flow — **update this document in the same change.**
> It lives at `docs/HOW-IT-WORKS.md` in the hilt repo.

Hilt and the briefing sit on top of your knowledge repo (the **vault** — [open in Docs](open://$VAULT)).
Small scheduled workers called **loops** each study one domain overnight and write their findings
to files. One editorial AI pass then reads everything and writes the morning briefing. Your
verdicts and feedback flow back into the loops. That's the whole shape:

**loops read the world → artifacts → editor writes one briefing → you decide → decisions feed the loops**

Two storage zones matter throughout:

- **The vault** ([open](open://$VAULT)) — your permanent, git-tracked knowledge base. Trusted
  ("live") loops write here.
- **The sandbox** ([open](open://$VAULT/meta/loops-shadow)) — where on-probation ("shadow") loops write
  until they earn vault access. Same folder structure, safer address. (It physically lives at
  `~/.hilt/data/loops-shadow`; `meta/loops-shadow` and `meta/briefing-shadow` in the vault are
  git-ignored symlinks so everything stays inspectable here in Hilt.)

The roster of all loops — which exist, which are on, which are trusted — is the registry:
[registry.yml](open://$VAULT/meta/loops/registry.yml).

---

## The overnight timeline

| Time | What runs |
|---|---|
| 7:30 PM | Meeting loop reads the day's meetings |
| 3:35 AM | Library reweave digests saved reading |
| 5:10 AM | Library steering writes the morning report |
| 5:40 AM | Goals loop compares priorities vs attention |
| 5:45 AM | Runtime loop checks all the machinery |
| 6:00 AM | v1 briefing (old pipeline — the Compare baseline) |
| 6:20 AM | v2 briefing (the loops-fed editor) |

---

## The loops, one by one

### 📚 Library loop — live, writes to the vault

Watches your reading. Really a family of jobs sharing one domain, and the one loop whose real
output is continuous enrichment of the knowledge files themselves — the daily artifact is just
the tip.

**The knowledge itself:**
- [references/](open://$VAULT/references) — one file per saved reference. The overnight reweave
  edits these in place: real digest, key points, connections to the rest of your vault.
- [Candidate pile](open://$VAULT/references/.cache/library-candidates) — discovered-not-yet-saved
  items from the hourly ingest and newsletter jobs, awaiting review.
- [kb-index.md](open://$VAULT/references/.cache/kb-index.md) — a compact map of the whole library
  that other AI passes read for orientation.

**The reports family:**
- [Daily loop artifact](open://$VAULT/meta/loops/references/reports) — contract format (findings +
  escalations + loop health).
- [Legacy morning report](open://$VAULT/meta/library-reports) — what the briefing's "Full library
  report" link opens today; retires at cutover when the link re-points to the loop artifact.
- [Editor's memos](open://$VAULT/references/process/memos) — the weekly essay synthesis behind
  "Read the memo".

**Bookkeeping:**
- [Source health](open://$VAULT/meta/sources/.source-state.json) — per-source fetch state and
  failures.

### 📈 Runtime loop — live, writes to the vault

The watchdog: did every scheduled job run and exit clean, disk space, stale CLIs, missing
artifacts. Its escalations are the 🔴 items in the briefing's System section.

- [Daily artifact](open://$VAULT/meta/loops/system/reports)

### 🤝 Meeting-actions loop — shadow, writes to the sandbox

Reads each meeting's note **and full transcript**; extracts commitments, a 1–2 sentence meeting
summary, and evidence that old commitments closed. Only meetings from the last 30 days are
parsed; only commitments **you** own (or unclear ones) from the last 3 days escalate for verdicts.

- [Daily artifact](open://$VAULT/meta/loops-shadow/meta/loops/meetings/reports) — meeting summaries,
  ledger deltas, escalated asks
- [ledger.json](open://$VAULT/meta/loops-shadow/meta/loops/meetings/state/ledger.json) — the master list
  of every open commitment: ID, owner, verbatim quote, status history
- [meeting-summaries.json](open://$VAULT/meta/loops-shadow/meta/loops/meetings/state/meeting-summaries.json)
  — the per-meeting context sentences the briefing leads with
- [processed-meetings.json](open://$VAULT/meta/loops-shadow/meta/loops/meetings/state/processed-meetings.json)
  — read-tracking so no meeting is parsed twice
- [verdicts/records.jsonl](open://$VAULT/meta/loops-shadow/meta/loops/meetings/verdicts/records.jsonl) —
  every Approve / Dismiss / Revise you click, one line each
- [feedback/records.jsonl](open://$VAULT/meta/loops-shadow/meta/loops/meetings/feedback/records.jsonl) —
  your written feedback on its items

### 🎯 Goals-areas loop — shadow, writes to the sandbox

Compares your stated priorities ([areas/index.md](open://$VAULT/areas/index.md)) against where
attention actually went (commits, meeting titles, the action ledger, library saves). Contradictions
escalate with evidence. A "derived" loop — it reads other loops' state, so it keeps no state of
its own.

- [Daily artifact](open://$VAULT/meta/loops-shadow/meta/loops/areas/reports)

### 📰 Briefing loop — registered, collector only (for now)

Will eventually own briefing generation under the same contract. Today it only collects your
critique of the briefing itself — every per-item comment and whole-briefing note:

- [feedback/records.jsonl](open://$VAULT/meta/loops-shadow/meta/loops/briefings/feedback/records.jsonl)

### 💤 Dormant: people-projections & calendar-tasks

Registry entries with no runner yet ("you've been waiting on Trudy for 3 weeks" belongs to the
first of these).

---

## The editor — how the briefing gets written (6:20 AM)

1. **Gather**: one script assembles the evidence bundle — calendar, task lists, git activity,
   prior briefings, plus **every enabled loop's latest artifact** (trimmed; escalations and health
   always included whole).
2. **Write**: a single AI pass reads the bundle and writes the briefing like a newspaper editor —
   day-thesis lede, sections, one entry per noteworthy meeting that leads with the meeting's
   substance and nests its asks, each stamped with the ledger's item ID. The writing pass has
   **no file access** — it can only hand text back.
3. **Validate**: length, required links, structure. Accepted output is saved to
   [briefing-shadow/](open://$VAULT/meta/briefing-shadow) (rejected drafts kept beside it as
   `.invalid-draft`). The old v1 briefing still writes to [briefings/](open://$VAULT/briefings)
   at 6:00 as the Compare baseline.
4. **Render**: the Briefings view reads the file, asks the loops API for currently-escalated
   items, and matches them to the editor's lines by those invisible IDs — that's how verdict
   buttons attach to exactly the right sentences, with the amber marker for urgency.

## Your part — verdicts and feedback

- **Approve** — "this is mine, hold me to it." Stays tracked; re-escalates if still open 7+ days
  after you accepted it.
- **Dismiss** — permanently out of your queue.
- **Assign to me** — same as approve today (wiring it to create a real task is a queued proposal).
- **Revise** — a correction, not a decision: the text updates and the item comes back revised for
  a real verdict.
- **Feedback (💬 on any bullet)** — free-form; rides into the owning loop's next run as
  calibration guidance.

Nothing executes when you click — a verdict is a recorded decision, applied by the loop's next
run (nightly, 7:30 PM for meetings).

## Graduation (what "shadow → live" means)

A shadow loop earns vault access by passing its evaluation gates (extraction accuracy bars,
adversarial fact-checking of its claims, and your lived experience with it). Graduating = copying
its sandbox folder into the vault and flipping its registry line to `live`. Same files, promoted
address — and its artifact then feeds the live briefing rather than the shadow one.
