# Hilt Routines + Nightly Dream Master Plan

## Summary

Make Routines a first-party Hilt subsystem, implemented in the canonical Hilt repo at:

```text
/Users/jruck/work/engineering/me/hilt
```

Initial setup should move the current visible Hilt checkout from `/Users/jruck/work/engineering/hilt` to `/Users/jruck/work/engineering/me/hilt` so the repo lives under the `engineering/me` namespace consistently. Bridge remains the planning and knowledge surface only.

Core flow:

```text
launchd
  -> Hilt routines daemon
  -> Hilt routine registry
  -> NightlyDreamRoutine
  -> deltas/logs
  -> Bridge briefing markdown
  -> Hilt readout + routine control UI
```

No OpenClaw cron dependency in v1.

## Key Changes

- Move Hilt repo to `/Users/jruck/work/engineering/me/hilt`; update local dev scripts, docs, and hardcoded paths.
- Add a Hilt-owned Routines subsystem:
  - routine registry
  - routine daemon
  - routine runner
  - run/event logs
  - launchd installer/status adapter
  - `NightlyDreamRoutine`
- Add one macOS LaunchAgent:

```text
~/Library/LaunchAgents/com.justinruckman.hilt.routines.plist
```

It keeps the Hilt routines daemon alive. It does not own individual routine schedules.

- Store routine state in Hilt's data directory:

```text
~/.hilt/data/routines/registry.json
~/.hilt/data/routines/runs.jsonl
~/.hilt/data/routines/events.jsonl
~/.hilt/data/routines/locks/
```

- Keep Bridge outputs as durable artifacts:

```text
/Users/jruck/work/bridge/briefings/YYYY-MM-DD.md
/Users/jruck/work/bridge/briefings/deltas/YYYY-MM-DD.jsonl
/Users/jruck/work/bridge/briefings/runs/YYYY-MM-DD-nightly-dream.json
```

## Routine System

Add Hilt scripts:

```json
{
  "routines:daemon": "tsx server/routines-daemon.ts",
  "routines:run": "tsx scripts/routines-run.ts"
}
```

Default routine registry includes:

```json
{
  "id": "nightly-dream",
  "title": "Nightly Dream",
  "enabled": true,
  "schedule": {
    "type": "daily",
    "time": "06:00",
    "timezone": "America/New_York",
    "runMissedOnWake": true
  },
  "config": {
    "bridgeVaultPath": "/Users/jruck/work/bridge",
    "autoApplyRisk": ["low"]
  }
}
```

`NightlyDreamRoutine` collects Bridge tasks/projects, recent briefings, recent vault changes, session/memory signals where available, and system health checks. It emits structured deltas, auto-applies only low-risk derived changes, and queues medium/high-risk deltas for review through the briefing and routine UI.

Briefing sections:

- `## Today's Focus`
- `## Needs Review`
- `## Filed & Connected`
- `## Routine Health`
- `## Memory / Dream Learnings`
- `## System & Usage`

## LLM Strategy

The routine system should not be coupled to a single model provider. Routines use a `ModelExecutor` interface so Hilt owns routine governance while model choice remains configurable.

Recommended v1 default:

```json
{
  "executor": {
    "kind": "claude-cli",
    "model": "sonnet",
    "timeoutSeconds": 600,
    "structuredOutput": true
  }
}
```

Why this default:

- Claude CLI is present locally and supports non-interactive structured output.
- Anthropic's public dreaming/memory/outcomes guidance is the strongest direct reference for this feature.
- The executor remains replaceable with OpenAI Responses, Codex, a local model, or a future Hilt-managed model gateway.

The `ModelExecutor` boundary should expose:

```ts
type ModelExecutor = {
  id: string;
  runJson<T>(input: {
    system: string;
    prompt: string;
    schema: unknown;
    timeoutSeconds: number;
  }): Promise<T>;
};
```

Routine behavior, risk policy, persistence, logs, and review state must not depend on which model provider produced the deltas.

## Dream Delta Contract

```ts
type DreamDelta = {
  id: string;
  routineId: "nightly-dream";
  type:
    | "memory_update"
    | "project_note_update"
    | "briefing_item"
    | "health_finding"
    | "task_suggestion"
    | "index_update";
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  applyMode: "auto" | "review" | "manual";
  status: "proposed" | "auto_applied" | "rejected" | "applied";
  confidence: number;
  evidence: Array<{ source: string; note: string }>;
  proposedChange?: { targetPath?: string; markdown?: string };
  createdAt: string;
};
```

Low-risk deltas may auto-apply only when derived, reversible, and non-authoritative. Durable user preferences, project-direction changes, task creation, deadlines, and canonical project edits require review.

## Hilt UI + APIs

Add a `Routines` tab after `Apps`.

V1 UI supports:

- routine list
- enabled/disabled state
- last run, next run, last status
- run now
- launchd install/start/stop/status
- recent logs and failures
- reviewable delta count
- link to latest generated briefing

Add APIs:

```text
GET    /api/routines
PATCH  /api/routines/:id
POST   /api/routines/:id/run
GET    /api/routines/:id/runs
GET    /api/routines/:id/events
POST   /api/routines/launchd/install
POST   /api/routines/launchd/start
POST   /api/routines/launchd/stop
GET    /api/routines/launchd/status
```

The existing Briefings tab remains the primary morning readout. The Routines tab is the control surface.

## Test Plan

- Verify repo relocation to `/Users/jruck/work/engineering/me/hilt` and Hilt still runs locally.
- Unit test registry read/write, schedule due calculation, missed-run behavior, and single-flight locking.
- Unit test dream delta validation and risk routing.
- Fixture test `NightlyDreamRoutine` against sample Bridge inputs.
- Dry-run test writes outputs to a temp Bridge vault.
- API tests for routine list, enable/disable, run-now, run logs, and launchd status.
- UI smoke test that Routines appears in nav and existing Briefings still renders.
- Manual macOS test: install LaunchAgent, start daemon, confirm heartbeat/logs, run `nightly-dream`, confirm briefing appears in Hilt.

## Assumptions

- `/Users/jruck/work/engineering/me/hilt` is the canonical Hilt repo path going forward.
- Bridge stores project docs and outputs, not routine implementation code.
- Hilt owns routine governance; `launchd` is only the local macOS supervisor.
- V1 does not use OpenClaw cron.
- V1 reviewable deltas appear in the briefing and logs before a richer approval UI is built.
- Search embeddings/database work remains deferred.

## References

- Anthropic: New in Claude Managed Agents - https://claude.com/blog/new-in-claude-managed-agents
- Anthropic: Claude Managed Agents Memory - https://claude.com/blog/claude-managed-agents-memory
