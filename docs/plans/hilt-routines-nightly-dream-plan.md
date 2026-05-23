# Hilt Routines + Nightly Dream Master Plan

## Summary

Make Routines a first-party Hilt subsystem in the canonical repo at:

```text
/Users/jruck/work/engineering/me/hilt
```

Bridge remains the planning and knowledge surface only.

Core flow:

```text
launchd StartCalendarInterval
  -> routines-run.ts <routine-id>
  -> Hilt routine registry
  -> NightlyDreamRoutine
  -> deltas/logs
  -> Bridge briefing markdown
  -> Hilt readout + routine control UI
```

No OpenClaw cron dependency in v1. No long-lived Hilt routines daemon in v1.

## Phasing

**Phase 1 — Plumbing.** Registry, one-shot runner, launchd installer, Routines tab, a no-op heartbeat routine. Proves end-to-end that scheduled supervision works on this machine before any LLM cost is involved.

**Phase 2 — NightlyDream.** `ModelExecutor`, `NightlyDreamRoutine`, `DreamDelta` pipeline, briefing generation. All the agentic / cost / safety risk lives here. The prompt and LLM output schema are specified in a follow-up doc: [`hilt-nightly-dream-prompt-plan.md`](./hilt-nightly-dream-prompt-plan.md).

Phase 2 must not ship until Phase 1 has been on the box, run on its schedule overnight, and recovered from at least one wake-from-sleep correctly.

## Module Layout

```text
src/lib/routines/
  types.ts            # Routine, RegistryEntry, Run, Event, DreamDelta, ModelExecutor, RoutineContext
  paths.ts            # ~/.hilt/data/routines/* path helpers
  registry.ts         # atomic read/write of registry.json
  runner.ts           # core orchestration; used by both routines-run.ts and Run Now API
  lock.ts             # single-flight file lock (O_EXCL + PID liveness check)
  install.ts          # plist generation + launchctl wrappers
  events.ts           # append-only events.jsonl
  runs.ts             # append-only runs.jsonl
  deltas.ts           # append-only deltas.jsonl
  executor/
    claude-cli.ts     # ClaudeCliExecutor (Phase 2)
  routines/
    index.ts          # static id->Routine map
    heartbeat.ts      # Phase 1 no-op routine
    nightly-dream.ts  # Phase 2 routine

scripts/
  routines-run.ts     # one-shot CLI entrypoint; launchd + API both invoke this

src/app/api/routines/
  route.ts                          # GET list
  [id]/route.ts                     # PATCH
  [id]/run/route.ts                 # POST
  [id]/runs/route.ts                # GET
  [id]/events/route.ts              # GET
  launchd/install/route.ts          # POST
  launchd/start/route.ts            # POST
  launchd/stop/route.ts             # POST
  launchd/status/route.ts           # GET

src/components/routines/
  RoutinesView.tsx
  RoutineRow.tsx
```

## Key Changes

- Add a Hilt-owned Routines subsystem (see Module Layout).
- Add per-routine macOS LaunchAgents:

```text
~/Library/LaunchAgents/com.justinruckman.hilt.routines.<routine-id>.plist
```

  Each plist uses `StartCalendarInterval` so launchd owns scheduling and missed-run-on-wake coalescing natively. If the Mac is asleep when a routine is due, launchd fires it exactly once on wake.

- Store routine state in Hilt's data directory:

```text
~/.hilt/data/routines/registry.json
~/.hilt/data/routines/runs.jsonl
~/.hilt/data/routines/events.jsonl
~/.hilt/data/routines/deltas.jsonl
~/.hilt/data/routines/locks/
~/.hilt/data/routines/logs/<routine-id>.{out,err}.log    # launchd-redirected stdio
```

- Keep Bridge outputs to the human-readable briefing only:

```text
/Users/jruck/work/bridge/briefings/YYYY-MM-DD.md
```

  All operational JSON (runs, events, deltas) stays under `~/.hilt/data/routines/` and does not enter the synced Bridge vault.

## Routine System

### Types

```ts
// src/lib/routines/types.ts

export type RegistryEntry = {
  id: string;
  title: string;
  enabled: boolean;
  schedule: { type: "daily"; time: string; timezone: string };
  config: {
    bridgeVaultPath: string;
    autoApplyRisk: Array<"low" | "medium" | "high">;
    executor?: ExecutorConfig;
  };
};

export type ExecutorConfig = {
  kind: "claude-cli";
  model: string;
  binaryPath: string;        // resolved at install time
  timeoutSeconds: number;
  structuredOutput: true;
};

export type Routine = {
  id: string;
  title: string;
  run(ctx: RoutineContext): Promise<RoutineResult>;
};

export type RoutineContext = {
  runId: string;
  entry: RegistryEntry;
  executor: ModelExecutor;     // resolved per executor config; ignored by routines that don't need an LLM
  paths: {
    dataDir: string;           // ~/.hilt/data/routines
    vaultDir: string;          // BRIDGE_VAULT_PATH
  };
  signal: AbortSignal;         // fires at executor timeout
  emitEvent(kind: EventKind, detail?: Record<string, unknown>): void;
};

export type RoutineResult = {
  status: "completed" | "errored";
  deltas?: DreamDelta[];
  briefing?: { frontmatter: Record<string, unknown>; markdown: string };
  message?: string;
};

export type Run = {
  id: string;
  routineId: string;
  startedAt: string;
  endedAt: string | null;
  status: "running" | "completed" | "timed_out" | "errored";
  executor: { kind: string; model: string };
  exitCode: number | null;
  errorMessage: string | null;
  tokenUsage?: { input: number; output: number };
};

export type EventKind =
  | "install"
  | "uninstall"
  | "enable"
  | "disable"
  | "run_requested"
  | "run_started"
  | "run_finished"
  | "lock_acquired"
  | "lock_released"
  | "lock_stale_cleared"
  | "preflight_failed";

export type Event = {
  id: string;
  routineId: string;
  ts: string;
  kind: EventKind;
  detail?: Record<string, unknown>;
};

export type ModelExecutor = {
  id: string;
  runJson<T>(input: {
    system: string;
    prompt: string;
    schema: unknown;
    timeoutSeconds: number;
    signal?: AbortSignal;
  }): Promise<T>;
};

// DreamDelta defined under "Dream Delta Contract" below.
```

The runner converts an aborted run (signal fired due to timeout) into `Run.status = "timed_out"`. Routines themselves only emit `completed` or `errored`.

### Scripts

```json
{
  "routines:run": "tsx scripts/routines-run.ts"
}
```

`routines-run.ts <routine-id>` is a one-shot. Invoked by launchd on schedule **and** by the Next.js API for `Run Now` — both paths share the same lock. No `routines:daemon` script in v1.

### Routine discovery

Static import map keyed by id; no dynamic imports.

```ts
// src/lib/routines/routines/index.ts
import { heartbeatRoutine } from "./heartbeat";
import { nightlyDreamRoutine } from "./nightly-dream";

export const ROUTINES: Record<string, Routine> = {
  "heartbeat": heartbeatRoutine,
  "nightly-dream": nightlyDreamRoutine,
};
```

Adding a routine = a new file in `routines/` + a line in `index.ts` + a registry entry.

### Default registry

```json
{
  "id": "nightly-dream",
  "title": "Nightly Dream",
  "enabled": true,
  "schedule": {
    "type": "daily",
    "time": "06:00",
    "timezone": "America/New_York"
  },
  "config": {
    "bridgeVaultPath": "/Users/jruck/work/bridge",
    "autoApplyRisk": []
  }
}
```

`autoApplyRisk` is intentionally empty for v1: every delta is proposed, nothing is auto-applied. Auto-apply target paths and an undo journal will be defined when the delta-review UI ships.

There is no `runMissedOnWake` field — `StartCalendarInterval` coalesces missed runs into a single fire on wake at the OS level.

`registry.json` is read/written atomically via `src/lib/db.ts`'s existing atomic-write helper. The API process and the runner process read the same file; conflicting writes are prevented by atomic rename, and the runner snapshots the entry into `RoutineContext.entry` at start so mid-run edits don't take effect until the next run.

### Inputs

`NightlyDreamRoutine` (and any future routine) runs in a plain Node process triggered by launchd, **not** inside Electron or the Next.js server. Inputs must therefore come from direct file reads, not API calls.

Routines read inputs via shared `lib/` modules:

- `src/lib/map/local-session-detail.ts` — canonical session signal. (Original plan referenced `src/lib/claude-sessions.ts`; in the current code session parsing lives under `src/lib/map/`.)
- `src/lib/bridge/*` — tasks, projects, weekly, briefings, notes parsers.

Refactor rule: where today an API route handler contains parsing logic, that logic must be extracted into a `lib/` module the route handler and the routine runner both import. API routes become thin wrappers around the shared parsers; parsers are the source of truth.

Default input windows for `NightlyDreamRoutine`:

| Input | Source | Window |
|---|---|---|
| Weekly tasks | `bridge/weekly-parser.ts` | This week + last week |
| Task transitions | runner diff over weekly files | Last 7 days |
| Projects | `bridge/project-parser.ts` | All |
| Recent briefings | `bridge/briefings/*.md` | Last 7 days |
| Vault changes | `bridge/**/*.md` mtime | Last 24h, excluding `briefings/` |
| Session signals | `src/lib/map/local-session-detail.ts` | Sessions touched in last 24h |
| Session errors | filtered from session signals (error/stuck) | Last 24h |
| Routine health | `runs.jsonl` | Last 24h, all routines |
| Prior dream outcomes | `deltas.jsonl` filtered to `routineId: "nightly-dream"` | Last 7 days, all `status` |
| Current memory surface | `## Memory / Dream Learnings` sections extracted from recent briefings | Last 30 days |

### Scheduling — launchd `StartCalendarInterval`

One plist per enabled routine. Example for `nightly-dream` at 06:00 local:

```xml
<plist version="1.0">
<dict>
  <key>Label</key><string>com.justinruckman.hilt.routines.nightly-dream</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/jruck/work/engineering/me/hilt/node_modules/.bin/tsx</string>
    <string>/Users/jruck/work/engineering/me/hilt/scripts/routines-run.ts</string>
    <string>nightly-dream</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/jruck/.nvm/versions/node/v22.22.0/bin:/Users/jruck/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>DATA_DIR</key>
    <string>/Users/jruck/.hilt/data</string>
    <key>BRIDGE_VAULT_PATH</key>
    <string>/Users/jruck/work/bridge</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>6</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/Users/jruck/.hilt/data/routines/logs/nightly-dream.out.log</string>
  <key>StandardErrorPath</key><string>/Users/jruck/.hilt/data/routines/logs/nightly-dream.err.log</string>
</dict>
</plist>
```

All paths are absolute and resolved at install time.

### Installer behavior

`src/lib/routines/install.ts` exposes `installRoutine(id)`, `uninstallRoutine(id)`, `startRoutine(id)`, `stopRoutine(id)`, `getLaunchdStatus(id)`. The API routes are thin wrappers.

On `installRoutine(id)`:

1. Resolve absolute paths from the live process:
   - `tsxPath` = `<repo>/node_modules/.bin/tsx` (`process.cwd()` + relative).
   - `scriptPath` = `<repo>/scripts/routines-run.ts`.
   - `nodeBinDir` = `path.dirname(process.execPath)` (captures the current nvm bin).
   - `claudeBinaryPath` = `which claude` from the current PATH; write into `registry.entry.config.executor.binaryPath`.
   - `vaultDir` = `await getVaultPath()` (Bridge's resolver — snapshots the running app's current setting, not the hardcoded default).
   - `dataDir` = `process.env.DATA_DIR ?? path.join(os.homedir(), ".hilt/data")`.
   - `uid` = `process.getuid()`.
2. Render the plist template with those values; `PATH` env is `${nodeBinDir}:${path.dirname(claudeBinaryPath)}:/usr/local/bin:/usr/bin:/bin`.
3. Write to `~/Library/LaunchAgents/com.justinruckman.hilt.routines.<id>.plist`, `chmod 0o644`, owner = current user.
4. `launchctl bootstrap gui/${uid} <plist-path>`.
5. Emit `install` event.

Enable / disable = `launchctl bootstrap` / `bootout` of the existing plist (no regen). Re-install (after a Node upgrade or moved binary) = uninstall + install (template re-rendered with new resolved paths).

### Preflight

Runs at top of `installRoutine` *and* at the top of `routines-run.ts` so a stale plist after a Node upgrade fails loud:

- `claude` resolves to an absolute path on the current PATH.
- `claude -p "ping" --output-format json` exits 0 within 30 s (executor authed).
- `node` and `tsx` resolve and execute under the captured PATH.
- `~/.hilt/data/routines/` exists and is writable.
- `BRIDGE_VAULT_PATH` exists and is writable.

Any failure emits `preflight_failed` to `events.jsonl` and aborts (install: error response; run: `Run.status = "errored"` with diagnostic `errorMessage`).

### Run records & lock

Each invocation of `routines-run.ts`:

1. Acquires `~/.hilt/data/routines/locks/<id>.lock` via `O_EXCL` create with payload `{pid, startedAt, runId}`.
2. If lock exists, parses payload and probes `process.kill(holderPid, 0)`. If it throws `ESRCH`, emit `lock_stale_cleared`, remove the file, retry. Otherwise emit `run_requested` outcome `conflict` and exit non-zero with diagnostic `Lock held by run <runId> (pid <pid>)`. The Run Now API surfaces this as HTTP 409.
3. Appends a `Run` row with `status: "running"` to `runs.jsonl`.
4. Runs the routine within an `AbortController` set to `executor.timeoutSeconds`.
5. On finish, updates the row in place (atomic rewrite of the file is fine for now; runs.jsonl is append-mostly but the in-progress row is overwritten in `endedAt`/`status`). Removes the lock. Emits `run_finished`.

`events.jsonl` is append-only and never rewritten.

## LLM Strategy (Phase 2)

`ModelExecutor` (defined in Types). Recommended v1 default:

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

No token cap in v1. We want to observe what NightlyDream actually does before optimizing for spend. The 600-second wall-clock cap stays; the runner converts a timeout into a visible signal rather than a silent partial output.

### ClaudeCliExecutor implementation contract

```text
spawn(binaryPath, [
  "-p", prompt,
  "--system", system,
  "--model", model,
  "--output-format", "json",
])
```

- Timeout: caller's `AbortSignal`. On abort, send `SIGTERM`; if still alive 5 s later, `SIGKILL`.
- Output parsing: stdout is a single JSON object per `--output-format json`. Parse, validate against `schema` (Zod), return.
- Exit semantics:
  - exit 0 + valid JSON matching schema → resolve.
  - signal abort → throw `ExecutorTimeoutError`.
  - any other failure → throw `ExecutorError` with stderr captured.
- Token usage: when `claude` includes usage in its JSON envelope, populate `Run.tokenUsage`. If absent, leave undefined.

Why claude-cli as v1 default: local, present, supports non-interactive structured output; Anthropic's public dreaming/memory/outcomes guidance is the strongest direct reference. The executor is replaceable with OpenAI Responses, Codex, a local model, or a future Hilt-managed gateway.

Routine behavior, risk policy, persistence, logs, and review state must not depend on which model provider produced the deltas.

The prompt + JSON output schema lives in [`hilt-nightly-dream-prompt-plan.md`](./hilt-nightly-dream-prompt-plan.md).

## Dream Delta Contract (Phase 2)

```ts
export type DreamDelta = {
  id: string;
  routineId: "nightly-dream";
  type:
    | "memory_update"
    | "project_note_update"
    | "briefing_item"
    | "health_finding"
    | "task_suggestion"
    | "index_update";
  // What the dream wants to do with this entry. Default "add" for net-new
  // proposals; "update" / "demote" / "remove" target an existing memory entry
  // and require proposedChange.targetPath. Maps directly to Anthropic's
  // "condense what is stale, promote what is load-bearing" framing — without
  // this field, memory grows monotonically.
  operation: "add" | "update" | "demote" | "remove";
  // Why the dream surfaced this. Mirrors Anthropic's three explicit pattern
  // categories plus a catch-all. Used for observation/measurement so we can
  // later tune which categories produce the most user-applied deltas.
  patternKind: "recurring_quirk" | "convergent_workflow" | "evolving_preference" | "ad_hoc";
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  applyMode: "auto" | "review" | "manual";
  status: "proposed" | "auto_applied" | "rejected" | "applied" | "failed";
  confidence: number;
  evidence: Array<{ source: string; note: string }>;
  proposedChange?: { targetPath?: string; markdown?: string };
  createdAt: string;
};
```

V1 behavior:

- Every delta lands as `status: "proposed"`. `autoApplyRisk: []` blocks the auto-apply path entirely.
- All proposed deltas are appended to `~/.hilt/data/routines/deltas.jsonl` and summarized in the day's briefing.
- `operation ∈ {update, demote, remove}` is always forced to `applyMode: "review"` by the runner regardless of `risk` classification. Destructive or revising operations on memory are never auto-applyable, even at low risk.
- For types `briefing_item`, `health_finding`, `task_suggestion`, the runner forces `operation = "add"` regardless of what the model returns — these types are inherently new, not revisions to existing memory.
- The runner cross-references each new delta against deltas of `status: "rejected"` from the last 7 days. Close title+targetPath collisions downgrade `confidence` and append a note. This is a backstop for the model's own "don't re-propose rejected" instruction.
- `patternKind` is observational: it records *why* the dream surfaced something so we can later measure which pattern categories produce the most user-applied deltas.
- The auto-apply pathway — write-target allowlists, undo journaling, reversibility guarantees — will be specified when the delta-review UI is built. Until then, no routine ever writes outside `~/.hilt/data/routines/` and `bridge/briefings/YYYY-MM-DD.md`.

### Delta → briefing-section mapping

| Section | Delta types |
|---|---|
| `## Today's Focus` | `task_suggestion`, `health_finding` (where `risk = high`) |
| `## Needs Review` | `memory_update`, `project_note_update` |
| `## Filed & Connected` | `index_update`, `briefing_item` |
| `## Routine Health` | derived from `runs.jsonl` last 24h (not delta-driven) |
| `## Memory / Dream Learnings` | `memory_update` *(summary view of what the dream learned, distinct from Needs Review which lists proposed changes)* |
| `## System & Usage` | derived from sessions + system metrics (not delta-driven) |

With `autoApplyRisk: []` in v1, every routed delta is `status: "proposed"`. The briefing renders them as a checklist with the delta id linked to the deltas log.

## Briefings

### Ownership

NightlyDream becomes the sole writer of `bridge/briefings/YYYY-MM-DD.md` once the existing briefing-writing agent is retired. If a file for today exists when NightlyDream runs, it is overwritten.

### Sections

- `## Today's Focus`
- `## Needs Review`
- `## Filed & Connected`
- `## Routine Health`
- `## Memory / Dream Learnings`
- `## System & Usage`

### Frontmatter

```yaml
title: <generated>
summary: <generated>
partial: <true if last run was timed_out or errored, else false>
generatedAt: <iso>
routineRunId: <run id>
```

### Partial-run visibility

If the routine exits with `timed_out` or `errored`:

- Briefing body opens with a blockquote:
  `> ⚠️ This briefing was cut off at the 600-second mark. Sections below may be incomplete.`
- Frontmatter `partial: true`, so the Briefings UI can badge it.
- `## Routine Health` includes a line:
  `Nightly Dream: timed_out at <time>. Run id: <id>. See /api/routines/nightly-dream/runs.`

Quality regressions caused by an early termination must be diagnosable from the briefing itself, not require log spelunking.

## Hilt UI + APIs

### Routines tab

Routines is a **top-level view** (sibling of System), not a System sub-mode. The view list becomes:

```text
Briefing / Bridge / Docs / People / System / Routines
```

`src/components/routines/RoutinesView.tsx` surfaces:

- routine list (id, title, enabled, last run, next scheduled run, last status)
- `Run Now` button
- launchd install / start / stop / status per routine
- recent runs and failures (last 10)
- proposed delta count for the latest run
- link to the latest generated briefing

Use SWR for data fetching, matching the rest of Hilt's client conventions.

### APIs

All under `/api/routines/*`.

Read endpoints — tailnet-reachable, so the Routines tab works from any device:

```text
GET    /api/routines
GET    /api/routines/:id/runs
GET    /api/routines/:id/events
GET    /api/routines/launchd/status
```

Mutating endpoints — loopback only. Reject requests whose remote address is not `127.0.0.1` / `::1` with `403`:

```text
PATCH  /api/routines/:id
POST   /api/routines/:id/run
POST   /api/routines/launchd/install
POST   /api/routines/launchd/start
POST   /api/routines/launchd/stop
```

The loopback guard is a small helper applied per-route (`if (!isLoopback(req)) return 403`).

#### Request / response shapes

```ts
// GET /api/routines
type Response = Array<{
  id: string;
  title: string;
  enabled: boolean;
  schedule: RegistryEntry["schedule"];
  lastRun: Run | null;
  nextRunAt: string | null;   // computed from schedule + tz
  launchd: { installed: boolean; loaded: boolean; lastExitCode: number | null };
  proposedDeltaCountLatest: number;
  latestBriefingDate: string | null;
}>;

// PATCH /api/routines/:id
type Body = Partial<Pick<RegistryEntry, "enabled" | "schedule" | "config">>;
type Response = RegistryEntry;

// POST /api/routines/:id/run
type Body = {};
type Response = { runId: string } | { error: "conflict"; holdingRunId: string };  // 409 on conflict

// GET /api/routines/:id/runs?limit=20
type Response = Run[];   // newest first

// GET /api/routines/:id/events?limit=50
type Response = Event[]; // newest first

// POST /api/routines/launchd/install
type Body = { id: string };
type Response = { ok: true; plistPath: string } | { ok: false; error: string };

// POST /api/routines/launchd/start
type Body = { id: string };
type Response = { ok: true } | { ok: false; error: string };

// POST /api/routines/launchd/stop
type Body = { id: string };
type Response = { ok: true } | { ok: false; error: string };

// GET /api/routines/launchd/status?id=<id>
type Response = {
  id: string;
  installed: boolean;
  loaded: boolean;
  lastExitCode: number | null;
  pid: number | null;
};
```

The existing Briefings tab remains the primary morning readout. The Routines tab is the control surface, mirroring the System / Sync split that just landed.

## Test Plan

- **Unit:**
  - registry atomic read/write
  - single-flight lock: acquire, conflict, stale-clear via dead-pid probe
  - plist generation: absolute paths resolved, PATH includes the active Node bin and `~/.local/bin`, no env leakage from the calling shell
  - loopback origin guard on mutating routes
  - `Run` status transitions, including `running` → `timed_out` on AbortSignal
  - delta validation; confirm `autoApplyRisk: []` blocks all auto-apply paths
- **Refactor sanity:**
  - parsers extracted from API handlers into shared `lib/` modules — confirm API responses are unchanged
- **Fixture (Phase 2):**
  - `NightlyDreamRoutine` against sample Bridge inputs; dry-run writes outputs to a temp Bridge vault and temp `~/.hilt/data/routines/`
- **API tests:**
  - routine list, enable/disable, run-now (success + 409 conflict), run logs, launchd status
  - mutating routes reject non-loopback origins
- **UI smoke:**
  - Routines appears as a top-level view; existing views still render
- **Manual macOS (Phase 1):**
  - Install LaunchAgent for the no-op heartbeat routine
  - `launchctl print gui/$UID/com.justinruckman.hilt.routines.heartbeat` shows resolved program paths and environment
  - Sleep the Mac through the scheduled time; on wake, verify exactly one run in `runs.jsonl`
  - Rename `claude` temporarily; confirm install aborts with a specific error and an `events.jsonl` row of `kind: "preflight_failed"`
- **Manual macOS (Phase 2):**
  - `Run Now` on `nightly-dream`; confirm briefing appears in the Briefings tab
  - Force a timeout (low `timeoutSeconds`); confirm cutoff blockquote, `partial: true` frontmatter, and Routine Health entry

## Docs to update on landing

Per CLAUDE.md, every commit must keep these in sync. For this work specifically:

- `docs/CHANGELOG.md` — entry per phase landing.
- `docs/ARCHITECTURE.md` — add the Routines subsystem to the System Overview diagram (long-running launchd jobs flowing into Bridge briefings and `.hilt/data`); add `~/.hilt/data/routines/` to the data-directory section.
- `docs/DATA-MODELS.md` — `RegistryEntry`, `Run`, `Event`, `DreamDelta`, `Routine`, `RoutineContext`, `RoutineResult`, `ModelExecutor`, `ExecutorConfig`.
- `docs/API.md` — every route under `/api/routines/*` with its request/response shape and loopback rule.

## Assumptions

- `/Users/jruck/work/engineering/me/hilt` is the canonical Hilt repo path; no repo move required.
- Bridge stores docs and the day's briefing markdown; not routine logs.
- All routine operational state lives under `~/.hilt/data/routines/`.
- launchd owns scheduling; there is no long-lived Hilt routines daemon in v1.
- `StartCalendarInterval` coalesces missed runs into a single fire on wake — we rely on this rather than implementing missed-run logic in-process.
- The existing briefing-writing agent will be retired before NightlyDream is enabled, so NightlyDream can safely overwrite `briefings/YYYY-MM-DD.md`.
- Bridge / sessions parsers will be extracted from API route handlers into shared `lib/` modules so the runner can read inputs without Next.js running.
- V1 reviewable deltas appear in the briefing and logs only; a richer approval UI and the auto-apply pathway are deferred.
- Search embeddings / database work is deferred.
- V1 does not use OpenClaw cron.

## References

- Anthropic: New in Claude Managed Agents — https://claude.com/blog/new-in-claude-managed-agents
- Anthropic: Claude Managed Agents Memory — https://claude.com/blog/claude-managed-agents-memory
- launchd.plist(5): `StartCalendarInterval` semantics, including missed-run coalescing on wake — https://www.manpagez.com/man/5/launchd.plist/
- Companion prompt/schema doc: [`hilt-nightly-dream-prompt-plan.md`](./hilt-nightly-dream-prompt-plan.md)
