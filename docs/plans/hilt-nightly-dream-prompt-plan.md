# Hilt NightlyDream Prompt + Output Schema

Companion to [`hilt-routines-nightly-dream-plan.md`](./hilt-routines-nightly-dream-plan.md). The master plan owns the infrastructure (registry, runner, launchd, deltas storage, briefings file lifecycle). This doc owns the **product behavior** of `NightlyDreamRoutine` — the prompt the executor sends, the schema it gets back, and the rules the model is held to.

**Status:** draft v1, ready to implement.

## Executor configuration

Confirmed defaults (no overrides for v1):

```json
{
  "executor": {
    "kind": "claude-cli",
    "model": "sonnet",
    "binaryPath": "<resolved-at-install>",
    "timeoutSeconds": 600,
    "structuredOutput": true
  }
}
```

Single-shot run via `claude -p` — not an agentic loop. Revisit only if quality consistently suffers.

## Pipeline

```text
NightlyDreamRoutine.run(ctx)
  -> gatherInputs()                  # direct file reads, no API calls
  -> buildPrompt({system, user})
  -> ctx.executor.runJson({ schema: NightlyDreamOutput })
  -> validate + normalize            # DraftDelta -> DreamDelta (runner adds id/createdAt/routineId/status)
  -> persistDeltas(deltas.jsonl)
  -> renderBriefing(sections, deltas, derived) -> bridge/briefings/YYYY-MM-DD.md
  -> return RoutineResult { status: "completed", deltas, briefing }
```

The runner — not the model — owns ids, timestamps, `routineId`, `status`, and any derived data (last-24h routine health table, session metrics). The model produces structured opinion; the runner produces facts and persistence.

## Inputs sent to the model

Gathered by `NightlyDreamRoutine` from local files via shared `lib/` parsers. Each input becomes a labeled JSON blob in the user prompt.

| Input | Source | Window | Shape passed to prompt |
|---|---|---|---|
| Today's date / TZ | system clock | — | `{ date, timezone }` |
| Weekly tasks | `src/lib/bridge/weekly-parser.ts` (`parseWeeklyFile`) | This week + last week | `{ week, tasks: [{id, title, status, projectPath?, group?}] }[]` |
| Projects | `src/lib/bridge/project-parser.ts` | All projects | `[{path, name, status, lastTouched, openTaskCount}]` |
| Recent briefings | `bridge/briefings/*.md` via `gray-matter` (extract from current `briefings/route.ts` into shared lib) | Last 7 days | `[{date, title, summary}]` |
| Vault changes | `bridge/**/*.md` mtime walk, excluding `briefings/` | Last 24h | `[{path, mtime, snippet}]` — snippet = first 300 chars of body |
| Session signals | `src/lib/map/local-session-detail.ts` (or its shared equivalent) | Sessions touched in last 24h | `[{project, branch?, lastActivity, messageCount, status}]` |
| Routine health | `runs.jsonl` last 24h | All routines | `[{routineId, status, startedAt, durationMs, exitCode?}]` |

Each section is wrapped in a labeled fence in the user prompt (see User prompt template). If a parser fails or a source is missing, the runner passes the section header with an empty array and adds a corresponding note to `inputErrors[]` in the user prompt — the model is then expected to acknowledge it under `notes`.

## Output schema (Zod)

The model returns `NightlyDreamOutput`. The runner converts each `DraftDelta` into a full `DreamDelta` (adding `id`, `routineId: "nightly-dream"`, `status: "proposed"`, `createdAt`).

```ts
import { z } from "zod";

export const DraftDeltaSchema = z.object({
  type: z.enum([
    "memory_update",
    "project_note_update",
    "briefing_item",
    "health_finding",
    "task_suggestion",
    "index_update",
  ]),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(800),
  risk: z.enum(["low", "medium", "high"]),
  applyMode: z.enum(["auto", "review", "manual"]),
  confidence: z.number().min(0).max(1),
  evidence: z
    .array(z.object({ source: z.string(), note: z.string() }))
    .min(1),
  proposedChange: z
    .object({
      targetPath: z.string().optional(),
      markdown: z.string().optional(),
    })
    .optional(),
});

export const NightlyDreamOutputSchema = z.object({
  title: z.string().min(1).max(120),     // briefing frontmatter title
  summary: z.string().min(1).max(400),   // briefing frontmatter summary
  sections: z.object({
    todaysFocus: z.string(),             // markdown body
    needsReview: z.string(),
    filedConnected: z.string(),
    routineHealth: z.string(),
    memoryDreamLearnings: z.string(),
    systemUsage: z.string(),
  }),
  deltas: z.array(DraftDeltaSchema),
  notes: z.array(z.string()),            // skipped inputs, ambiguities, model-flagged caveats
});

export type NightlyDreamOutput = z.infer<typeof NightlyDreamOutputSchema>;
```

Validation rules enforced after parse:

- `evidence[*].source` must reference a path or label that appeared in the inputs. The runner cross-checks; unknown sources downgrade `confidence` to ≤ 0.5 and append a runner-side note.
- Every delta whose `risk = "high"` or `risk = "medium"` must have `applyMode = "review"` regardless of what the model returns. The runner overrides on conflict.
- `applyMode = "auto"` is only legal on `risk = "low"`. With v1 `autoApplyRisk: []`, all deltas still land as `status: "proposed"` — `applyMode = "auto"` is allowed to be recorded but the apply path is gated off.

## System prompt

```text
You are Nightly Dream, the overnight digest agent for Hilt.

Your job: read a snapshot of yesterday's activity across the user's Bridge vault,
Claude sessions, and routine health logs, then produce two things in a single
JSON response:

1. A set of concrete, evidence-backed deltas the user (or a future apply step)
   could act on tomorrow.
2. Markdown for six briefing sections that summarize what mattered.

Output rules — non-negotiable:

- Return a single JSON object that matches the schema described in the user
  message. No prose outside the JSON. No code fences. No leading or trailing
  characters.
- Do not invent project names, task titles, file paths, or events. Every claim
  must be grounded in the inputs the user message provides.
- Every delta must include at least one `evidence` row whose `source` references
  a path or label that appeared in the inputs.
- Classify `risk` honestly. When uncertain, escalate (medium > low; high > medium).
- Set `applyMode` to `review` for anything that could change project direction,
  edit canonical user preferences, alter deadlines, or write to a file the user
  treats as authoritative. Use `auto` only for derived, reversible, additive
  changes (typo corrections, index entries, briefing items). Use `manual` for
  changes that require the user to do something the system cannot.
- If an input section is missing, empty, or malformed, mention it in `notes`
  and continue. Do not fabricate to fill a section.

Voice rules for the briefing sections:

- Write like a senior teammate who read everything overnight: concise,
  evidence-cited, no marketing tone, no filler.
- State observations. Do not hedge in prose ("I think", "perhaps", "maybe");
  use the `confidence` field on deltas to signal uncertainty.
- No emoji except ⚠️ for explicit warnings.
- Prefer short paragraphs and tight bullets. Two sentences beats five.

Section purposes:

- `todaysFocus`: 1–5 items the user should look at first today. Drawn from
  high-impact `task_suggestion` and high-risk `health_finding` deltas.
- `needsReview`: proposed changes to memory or project notes that need a human
  call before they're applied. Mirror the deltas of type
  `memory_update` / `project_note_update`.
- `filedConnected`: low-risk linkages, index updates, and small derived
  briefing items the system would have applied on its own under a permissive
  policy. Mirror `index_update` / `briefing_item` deltas.
- `routineHealth`: prose summary of how the routines themselves did over the
  last 24h. The runner appends a derived table; your prose should set context,
  not duplicate numbers.
- `memoryDreamLearnings`: what the dream itself learned — patterns,
  recurrences, shifts in the user's focus. Distinct from `needsReview`: that's
  proposed changes; this is observation.
- `systemUsage`: prose summary of session and system activity. The runner
  appends derived metrics; your prose should highlight what's interesting.

If you cannot produce a section confidently from the inputs, return a single
short sentence explaining what was missing, and add a corresponding entry to
`notes`. Do not pad.
```

## User prompt template

The runner serializes inputs into this exact shape every run. Replace placeholders with JSON-encoded values.

```text
DATE: {{date}}
TIMEZONE: {{timezone}}

== WEEKLY TASKS ==
{{weeklyTasksJson}}

== PROJECTS ==
{{projectsJson}}

== RECENT BRIEFINGS ==
{{recentBriefingsJson}}

== VAULT CHANGES (last 24h, excluding briefings/) ==
{{vaultChangesJson}}

== SESSION SIGNALS (last 24h) ==
{{sessionSignalsJson}}

== ROUTINE HEALTH (last 24h) ==
{{routineHealthJson}}

== INPUT ERRORS ==
{{inputErrorsJson}}

Produce a single JSON object matching the NightlyDreamOutput schema in your
system prompt. Begin with `{` and end with `}`. Do not include any other text.
```

Each JSON blob is pretty-printed with 2-space indent for readability inside the prompt. The runner sets a soft cap of ~20 entries per array section and truncates the rest with a single trailing note in `inputErrors` describing what was dropped — this keeps inputs bounded without falling into model-side guessing.

## Risk-tagging guidance

The model classifies each delta. The runner validates and may downgrade `applyMode` (never upgrade).

**`low`** — derived, reversible, additive, non-authoritative. Examples:
- A new index entry pointing a project name to its canonical file.
- A briefing item summarizing yesterday's activity.
- A note that two sessions referenced the same task id.

**`medium`** — changes to project notes, memory items the user actively maintains, suggestions about task priority or sequencing. Examples:
- "Project X note should mention the new dependency on Y."
- "The user keeps deferring task Z; consider asking whether to drop it."
- "Memory file mentions a deadline that has passed."

**`high`** — anything touching:
- project direction or scope,
- canonical user preferences,
- deadlines or commitments,
- deletions or destructive edits,
- files the user treats as authoritative (CLAUDE.md, top-level READMEs, weekly tasks file).

When in doubt, the model escalates one tier. The runner enforces: `risk ∈ {medium, high}` ⇒ `applyMode = "review"`.

## Briefing rendering rules

The runner writes `bridge/briefings/YYYY-MM-DD.md` by composing:

- **Frontmatter:** `title`, `summary`, `partial`, `generatedAt`, `routineRunId`. `title` and `summary` from the model output; rest from the runner.
- **Body sections, in the order given in the master plan:** `## Today's Focus`, `## Needs Review`, `## Filed & Connected`, `## Routine Health`, `## Memory / Dream Learnings`, `## System & Usage`.
- Each section's prose is the model's `sections.<key>` string, rendered verbatim.
- Below each section's prose, the runner appends a checklist of deltas routed to that section per the master plan's Delta → briefing-section mapping, formatted:

  ```markdown
  - [ ] **<title>** — <summary> _(risk: <risk>, confidence: <confidence>)_ <sub>`<delta-id>`</sub>
  ```

- `## Routine Health` gets a runner-appended table of last-24h runs after the model's prose:

  ```markdown
  | routine | status | started | duration |
  | --- | --- | --- | --- |
  ```
- `## System & Usage` gets a runner-appended summary of session counts, project activity rollup, and Hilt local-apps health (if available).
- If `Run.status` is `timed_out` or `errored`, the runner prepends the partial-run blockquote per the master plan before the first section.

## Few-shot example (abbreviated)

**Inputs (truncated):**

```text
DATE: 2026-05-23
TIMEZONE: America/New_York

== WEEKLY TASKS ==
[
  { "id": "t-1", "title": "Ship routines Phase 1 burn-in", "status": "done", "projectPath": "projects/hilt" },
  { "id": "t-2", "title": "Draft NightlyDream prompt plan", "status": "in_progress" }
]

== RECENT BRIEFINGS ==
[
  { "date": "2026-05-22", "title": "Sync control plane lands", "summary": "Syncthing GA on the tailnet." }
]

== ROUTINE HEALTH ==
[
  { "routineId": "heartbeat", "status": "completed", "startedAt": "2026-05-23T05:00:00-04:00", "durationMs": 412 }
]
```

**Expected output (excerpt):**

```json
{
  "title": "May 23 — Phase 1 lands, prompt plan up next",
  "summary": "Routines Phase 1 finished burn-in with 139 clean runs. NightlyDream prompt plan is the remaining blocker before Phase 2 implementation.",
  "sections": {
    "todaysFocus": "Phase 1 burn-in is complete (task t-1). The remaining blocker is the NightlyDream prompt plan, currently in progress.",
    "needsReview": "No memory or project-note changes proposed today.",
    "filedConnected": "Heartbeat run history filed under routines.",
    "routineHealth": "Heartbeat ran cleanly through the burn-in window. No failures detected in the last 24h.",
    "memoryDreamLearnings": "The user is in a steady shipping cadence on the Routines subsystem; the work is converging rather than expanding.",
    "systemUsage": "Activity concentrated in the hilt project."
  },
  "deltas": [
    {
      "type": "briefing_item",
      "title": "Heartbeat burn-in complete",
      "summary": "Heartbeat ran 139 times without failure during the 11.5h window.",
      "risk": "low",
      "applyMode": "auto",
      "confidence": 0.95,
      "evidence": [
        { "source": "ROUTINE HEALTH", "note": "All entries status=completed, no exitCode != 0." }
      ]
    }
  ],
  "notes": []
}
```

## Cost & observability

No hard token cap in v1 — we want to observe behavior before optimizing.

Per run, the runner captures and persists in `runs.jsonl`:

- `tokenUsage.input`, `tokenUsage.output` (from claude CLI's response envelope when present).
- `estimatedCostUsd` (computed from model rate card; fine to leave undefined if the rate isn't wired up day one).
- `deltasByType`, `deltasByRisk` (counts).
- `wallClockMs`, plus a `cutoff: boolean` flag if the run hit the 600 s timeout.

These flow into `## Routine Health` and the Routines tab so the user can decide later whether to cap, compact inputs, or split into multiple smaller routines.

Soft signal (not enforced, just logged as an `event` of kind `cost_spike` for visibility): a single run whose `tokenUsage.input > 200k` or `estimatedCostUsd > $0.50`. Threshold is a starting placeholder — tune from observed values.

## Iteration log

Format for entries (newest first):

```markdown
### YYYY-MM-DD — short reason
- Triggered by run `<run-id>`
- Change: <what changed in this doc>
- Rationale: <why>
```

_(no entries yet — first entry lands the day Phase 2 ships and the first real run completes.)_

## Open questions

- **Section structure may need to flex.** The six-section briefing structure comes from the master plan and may not survive contact with real outputs. If the model consistently leaves a section nearly empty, collapse it. Log the change here.
- **Evidence-source validation strictness.** The runner cross-checks `evidence[*].source` against input labels. If real outputs reference legitimate sources we didn't pre-label (e.g. "yesterday's briefing for 2026-05-22"), loosen the matcher rather than penalize confidence.
- **Notes vs. Routine Health overlap.** Model-side `notes` (skipped inputs, caveats) vs. runner-side `## Routine Health` (run metrics). For v1, render `notes` as bullets at the top of `## Routine Health` above the runner's metrics table. Revisit if it gets noisy.
- **Re-runs the same day.** If `Run Now` is invoked after a scheduled run already wrote today's briefing, the file is overwritten and the previous version is lost. The deltas.jsonl history is preserved. Acceptable for v1; consider an `--append` mode later if it matters.

## References

- Master plan: [`hilt-routines-nightly-dream-plan.md`](./hilt-routines-nightly-dream-plan.md)
- Anthropic: New in Claude Managed Agents — https://claude.com/blog/new-in-claude-managed-agents
- Anthropic: Claude Managed Agents Memory — https://claude.com/blog/claude-managed-agents-memory
