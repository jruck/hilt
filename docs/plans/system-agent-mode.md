# Hilt System Agent Mode Plan

## Summary

Build a separate, read-only Hilt runtime for observer machines such as Hestia. The agent should let full Hilt servers discover machine-local System status without requiring the machine to run the full Next.js UI, WebSocket server, Library/Bridge surfaces, or product daemons.

This is an implementation plan only. The next agent should implement it after first updating the checkout and verifying the local runtime.

## Goals

- Hestia can appear in Mercury-served System views as a Hilt machine.
- Hestia reports System Sync, Apps, Sessions, and Stack data.
- Hestia does not run the Hilt frontend, full app server, `ws-server`, Bridge/Library write routes, Granola daemon, calendar daemon, Library schedulers, GraphRunner, or SemanticRunner.
- The agent is reachable through Tailscale Serve while binding only to localhost.
- The implementation preserves the current Hilt-to-Hilt discovery model and does not expose Syncthing keys, arbitrary Syncthing API proxying, arbitrary file reads, or destructive controls.

## V1 Capability Scope

The v1 agent should support the same observer use cases the full System tab expects:

- **Machine identity**: report a Hilt-compatible machine manifest with a new role field.
- **Sync**: report local Syncthing health through Hilt's existing sanitized adapter.
- **Apps**: report local app/service health and support full screenshot previews.
- **Sessions**: report local Map/session graph data and allow local map refresh.
- **Stack**: report local Claude/Codex stack inventory and support validated read-only file previews.

The v1 agent should not support Docs, Bridge, Library, Briefings, Calendar UI/API surfaces, report serving, preference editing, source management, app-mode switching, navigation, raw vault file browsing, or any route not explicitly allowlisted below.

## Required Update Step

Before implementation, bring the target checkout up to date:

1. Confirm the worktree is clean with `git status --short --branch`.
2. Run `git fetch --prune`.
3. Run `git pull --ff-only origin main`.
4. Use Node 22 from `.nvmrc`.
5. Install dependencies so repo scripts are available.
6. If native dependency installation fails because `better-sqlite3` falls back to node-gyp, fix the local Python/prebuild issue before runtime testing. A docs-only install can use `npm ci --ignore-scripts`, but implementation/testing needs native modules working.

## Runtime Design

Create a new runtime entrypoint, tentatively `server/system-agent.ts`.

- Implement it as a small Node HTTP server, not a Next.js app.
- Default bind: `127.0.0.1:${HILT_SYSTEM_AGENT_PORT:-3200}`.
- Load `.env` using the same environment convention as the existing server entrypoints.
- Return JSON only, except safe PNG preview files.
- Do not serve HTML, static Next assets, React bundles, or fallback routes.
- Do not start `ws-server`, `EventServer`, file watchers, Bridge watchers, graph/semantic runners, or product daemons.
- Use existing library functions for local System data where possible, but keep aggregate peer fan-out in the full Hilt server. Agent routes should answer only local snapshots.

Expose Hestia by configuring Tailscale Serve from the machine's authenticated tailnet URL to `http://127.0.0.1:3200`. The agent itself should not listen directly on a tailnet interface in v1.

## API Contract Changes

Extend the System machine identity response with:

```ts
role: "full" | "agent";
```

- Full Hilt servers return `role: "full"`.
- System agents return `role: "agent"`.
- Peer discovery accepts both roles when `app === "hilt-system"` and `enabled === true`.
- Existing clients that do not know `role` should continue working.

Agent `/api/system/machine?scope=local` should advertise:

```ts
{
  app: "hilt-system",
  enabled: true,
  role: "agent",
  machine: MachineIdentity,
  features: {
    map: true,
    apps: true,
    stack: true,
    sync: true
  },
  app_server: null
}
```

If a capability is disabled by local env, report that feature as `false` and let the corresponding route return the same disabled shape the full app uses today.

## Agent Route Allowlist

Implement only these routes:

- `GET /api/system/machine`
- `GET /api/system/sync`
- `GET /api/system/sync/conflicts`
- `GET /api/local-apps`
- `POST /api/local-apps/refresh`
- `GET /api/local-apps/previews/:filename`
- `GET /api/system/stack`
- `GET /api/system/stack/file`
- `GET /api/map/local/work-graph`
- `GET /api/map/local/sessions`
- `GET /api/map/local/session-detail`
- `POST /api/map/local/refresh`

All other paths should return `404` with a compact JSON error. Do not proxy unmatched paths to another local service.

Route behavior should match current full-Hilt local behavior with these constraints:

- Sync reads only the configured loopback Syncthing API and never returns the API key.
- Apps refresh may capture screenshots when `HILT_LOCAL_APPS_PREVIEWS=true`; preview files are served only by safe filename.
- Stack file reads must validate the requested path against the discovered stack before reading and must always return `isEditable: false`.
- Sessions history preview should continue respecting `HILT_MAP_HISTORY_PREVIEW`.
- Aggregate/network reads happen from full Hilt servers, not from the agent.

## Scripts And LaunchAgent

Add package scripts:

```json
"system-agent:run": "tsx server/system-agent.ts",
"system-agent:install": "tsx scripts/system-agent-launchd.ts --install",
"system-agent:uninstall": "tsx scripts/system-agent-launchd.ts --uninstall",
"system-agent:status": "tsx scripts/system-agent-launchd.ts --status"
```

Add `scripts/system-agent-launchd.ts` modeled after `scripts/supervisor-launchd.ts`, but for a single `com.hilt.system-agent` process.

LaunchAgent requirements:

- Use the same Node 22 PATH discipline as the supervisor wrapper.
- Set `HOME`, `DATA_DIR`, `PATH`, and `HILT_SYSTEM_AGENT_PORT`.
- Do not set `HILT_GRANOLA_SYNC_DAEMON`.
- Write logs under `${DATA_DIR}/logs/system-agent/` or `~/.hilt/logs/system-agent/`.
- Status should report launchctl state, pid, configured port, and whether `GET /api/system/machine?scope=local` responds.

## Full Hilt Integration

Update discovery in `src/lib/system/peers.ts` so full Hilt recognizes both full servers and agents:

- Keep probing `https://<peer-dns>` first, followed by common local dev ports.
- Add the agent port to candidate probes: `HILT_SYSTEM_AGENT_PORT` default `3200`.
- Accept `role: "agent"` as a valid Hilt peer.
- Preserve the existing `machineId` and `machineLabel` behavior.
- Do not assume feature flags are authoritative; continue probing capability endpoints and rendering disabled cards when a route reports disabled/unavailable.

Update System types/docs so the role is visible to future implementers. UI changes should be minimal: existing cards can keep their current machine titles, with optional quiet `agent` labeling only where useful for diagnosis.

## Hestia Deployment Steps

On Hestia:

1. Pull the latest Hilt checkout and install dependencies with Node 22.
2. Ensure `.env` has the desired observer flags:
   - `HILT_SYNC_ENABLED=true`
   - `HILT_SYNC_PROVIDER=syncthing`
   - `HILT_SYNC_FOLDER_ID=work-meta`
   - `HILT_SYNC_SYNCTHING_URL=http://127.0.0.1:8384`
   - `HILT_SYNC_SYNCTHING_API_KEY_FILE=/Users/jruck/.hilt/sync/syncthing-api-key`
   - `HILT_LOCAL_APPS_ENABLED=true`
   - `HILT_LOCAL_APPS_PREVIEWS=true`
   - `HILT_MAP_LOCAL_ENABLED=true`
3. Run `npm run system-agent:run`.
4. Verify local responses:
   - `curl http://127.0.0.1:3200/api/system/machine?scope=local`
   - `curl http://127.0.0.1:3200/api/system/sync?scope=local`
   - `curl http://127.0.0.1:3200/api/local-apps?scope=local`
   - `curl http://127.0.0.1:3200/api/system/stack?scope=local`
   - `curl http://127.0.0.1:3200/api/map/local/work-graph`
5. Install the LaunchAgent with `npm run system-agent:install`.
6. Configure Tailscale Serve to forward Hestia's tailnet HTTPS origin to `127.0.0.1:3200`.
7. Confirm `https://hestia.../api/system/machine?scope=local` reports `role: "agent"`.

## Mercury Validation Steps

From the Mercury-served full Hilt instance:

1. Force-refresh System machines.
2. Confirm Hestia appears in `/api/system/machines`.
3. Confirm System -> Sync shows Hestia's Syncthing status.
4. Confirm System -> Apps shows Hestia services and screenshots.
5. Confirm System -> Sessions includes Hestia map/session data.
6. Confirm System -> Stack lists Hestia stack data and validated read-only previews work.
7. Confirm Hestia does not expose:
   - `/`
   - `/_next/*`
   - `/api/bridge/*`
   - `/api/library/*`
   - `/api/docs/*`
   - `/api/calendar/*`
   - `/api/granola-sync/*`
   - `/api/system/app-mode`
   - `/events`
   - `/navigate`

## Test Plan

Add focused tests for the implementation:

- System machine schema accepts `role: "full" | "agent"`.
- Peer discovery accepts agent peers and still rejects non-Hilt peers.
- Agent route allowlist returns `404` for disallowed routes.
- Agent machine route returns no `app_server` mode-switch surface.
- Agent Sync route returns the same enabled/disabled shapes as full Hilt local Sync.
- Agent Apps route supports refresh and safe preview serving.
- Agent Stack file route returns only files discovered in the stack and marks them non-editable.
- Agent Sessions routes respect existing Map flags and history-preview controls.
- LaunchAgent renderer includes the expected env and does not set Granola/calendar daemon flags.

Run at minimum:

```bash
npm run test:system
npm run test:local-apps
npm run test:map
npm run test:server-mode
npx tsc --noEmit
```

For final app delivery, run `npm run rebuild` after user-visible source changes. This plan document itself is docs-only and does not require a rebuild.

## Documentation Updates For Implementation

When the feature is implemented, update:

- `docs/CHANGELOG.md` with the shipped runtime.
- `docs/ARCHITECTURE.md` System section with full-vs-agent roles and data flow.
- `docs/API.md` for the `role` field, agent route surface, and Tailscale Serve deployment.
- `docs/DATA-MODELS.md` for the `SystemMachineResponse` role field.
- `.env.example` for `HILT_SYSTEM_AGENT_PORT` and any agent-specific flags.
- `AGENTS.md` only if future agents need a durable operational rule for system-agent deployments.

## Acceptance Criteria

- Hestia can run `system-agent` without a Hilt UI or full Hilt supervisor.
- Mercury discovers Hestia as a Hilt System machine through Tailscale Serve.
- System Sync, Apps, Sessions, and Stack work for Hestia from Mercury.
- Disallowed Hestia routes return JSON `404` and no frontend is served.
- No Bridge/Library/Granola/calendar/scheduler/graph/semantic background work starts on Hestia.
- Implementation tests and live Hestia/Mercury validation pass.
