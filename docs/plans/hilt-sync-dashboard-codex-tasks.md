# Hilt Sync Dashboard Codex Tasks

Created: 2026-06-09

## Current State

The Hilt Sync dashboard/API is already implemented and serving real Syncthing health.

- Mercury Hilt repo: `/Users/jruck/work/engineering/me/hilt`
- Xochipilli Hilt repo: `/Users/jruck/work/engineering/me/hilt`
- Live Mercury API: `http://mercury-v.tailc0acaa.ts.net:3000/api/system/sync?force=true`
- Live Xochipilli API: `http://xochipilli.tailc0acaa.ts.net:3000/api/system/sync?force=true`
- Current healthy response: 2 machines, 2 healthy, 0 conflicts, 0 needed files, 0 pull errors.
- Xochipilli `npm run test:system` passes.
- Mercury `npm run test:system` passes after replacing the fragile glob with the explicit system test file.

Relevant files:

- `src/lib/system/sync.ts`
- `src/lib/system/sync-settings.ts`
- `src/app/api/system/sync/route.ts`
- `src/app/api/system/sync/conflicts/route.ts`
- `src/components/system/SystemSyncView.tsx`
- `src/lib/system/system.test.ts`
- `scripts/system-sync-smoke.ts`
- `docs/plans/hilt-sync-control-plane.md`
- `docs/plans/hilt-sync-conflict-drill.md`

## Tasks

- [x] **Task 1: Make `npm run test:system` portable on Mercury and Xochipilli.**
  - Replace the fragile `src/lib/system/**/*.test.ts` glob with a command that works under both machines' npm shells.
  - Current acceptable minimal fix: `tsx --test src/lib/system/system.test.ts`.
  - Acceptance: `npm run test:system` passes on Mercury and Xochipilli.

- [x] **Task 2: Add a live sync smoke test command.**
  - Add a script that fetches both tailnet Hilt endpoints and asserts:
    - response app is `hilt-system-sync`
    - `summary.machine_count >= 2`
    - `summary.healthy_count === summary.machine_count`
    - `summary.conflict_count === 0`
    - `summary.needed_files === 0`
    - `summary.pull_errors === 0`
    - every enabled machine has `daemon.reachable === true`
  - Suggested script name: `scripts/system-sync-smoke.ts`.
  - Suggested package script: `test:system:sync-live`.
  - Acceptance: the command passes from either machine while both Hilt instances are running.

- [x] **Task 3: Harden peer aggregation against stale feature flags.**
  - Today, Mercury briefly reported Xochipilli as `Sync not available on this Hilt peer`, then corrected after refresh.
  - Treat `features.sync` as a hint, not the only gate. If a peer is reachable but `sync` is missing/false, try `/api/system/sync?scope=local` once and fall back only when the endpoint returns a real disabled/404/error response.
  - Add a unit test where peer discovery reports `features.sync=false` but the remote sync endpoint returns a valid local snapshot.
  - Acceptance: aggregate `/api/system/sync?force=true` does not hide healthy sync peers due only to stale feature flags.

- [x] **Task 4: Add a conflict drill runbook or guarded script.**
  - Do not run destructive conflict simulations automatically.
  - Add a documented manual drill, or a script that requires an explicit `--write` flag, to:
    - pause one side or disconnect one peer
    - edit the same probe file differently on both machines
    - resume sync
    - verify Hilt reports the resulting `*.sync-conflict-*` file
    - clean up the probe and confirm status returns to healthy
  - Acceptance: we have a repeatable way to prove the dashboard reports real conflicts.
  - Completed with `docs/plans/hilt-sync-conflict-drill.md`.

- [x] **Task 5: Improve Sync UI freshness and bloat visibility.**
  - Show `refreshedAt`, Syncthing `lastScan`, and folder `stateChanged` as distinct rows or tooltip details.
  - Make the refresh button visibly indicate when a forced refresh completed.
  - Surface local ignored/generated bloat separately from Syncthing's synced byte count. Today Mercury's `/Users/jruck/work/meta` is about 2.7 GB while Xochipilli is about 172 MB, but the synced file counts match; this should appear as local ignored data, not sync drift.
  - Acceptance: the UI makes it obvious whether a machine is stale, actively syncing, or merely carrying ignored local weight.

- [x] **Task 6: Update docs after hardening.**
  - Update `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODELS.md`, and `docs/CHANGELOG.md` only for behavior that changes during these tasks.
  - Note that the Sync dashboard is read-only and never proxies the Syncthing API key over the tailnet.
  - Acceptance: docs match the final API/UI behavior and the task list can be marked complete.

## Verification Checklist

Run these before closing the work:

```bash
npm run test:system
npm run test:system:sync-live
curl -fsS 'http://mercury-v.tailc0acaa.ts.net:3000/api/system/sync?force=true'
curl -fsS 'http://xochipilli.tailc0acaa.ts.net:3000/api/system/sync?force=true'
```

Expected live summary from either machine:

```json
{
  "machine_count": 2,
  "healthy_count": 2,
  "conflict_count": 0,
  "needed_files": 0,
  "pull_errors": 0
}
```
