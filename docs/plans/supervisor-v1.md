# Hilt Supervisor v1 — headless server lifecycle + remote dev/prod switch

**Status:** Phases 1+2 implemented (62f1aea, ac5b854 + post-verification fixes) and
workflow-verified on scratch (T1/T2/T4/T5); Mini cutover + live T3/T6 in progress.
See `docs/plans/supervisor-v1-implementation-report.md` for results and deviations.
**Decided direction (2026-06-10):** the long-term path only. No interim Electron-as-supervisor
investment on the Mini beyond what already shipped.

## Context

The daily topology is: **Electron app on Mercury (viewer) → Hilt server on Xochipilli (the
Mini)**. Mercury's local server is a fallback the user expects to largely retire. Today the
Mini's server is a terminal `dev:all` — it dies with its terminal, doesn't survive reboots,
and nothing supervises it, so the shipped dev/prod mode switch (Electron-IPC, gated on
"my Electron spawned this server") can never apply to the server that actually matters.

Three facts learned shipping the first switch (see CHANGELOG 2026-06-10):

1. **Only a server's supervisor can swap it.** The switch must be actuated on the serving
   machine by the process that owns the child — never by the viewer.
2. **Supervision must be reported by the server, not inferred by the window.**
   `GET /api/system/app-server` is the right channel: same-origin from any viewer.
3. **A dev↔prod swap changes the client bundle**, so every viewer window must reload itself
   after a switch; the supervisor can only reload windows it owns.

## Goals

- The Mini's Hilt serving stack (app-server + ws-server + event-server) runs as a
  launchd-supervised appliance: survives terminal close, crashes, and reboots.
- Dev/prod mode is switchable **from any Hilt window on any machine** pointed at a
  supervised server — specifically: Mercury window on the Xochipilli source flips the
  Mini between prod (daily) and dev (rapid iteration on the Mini's working tree).
- One switch mechanism (file-intent protocol over HTTP), shared by the headless daemon
  and Electron-supervised laptops. The Electron-IPC switch path retires.
- A forgotten dev-mode switch cannot leave the server machine degraded forever.

## Non-goals (v1)

- Multi-user auth on the switch endpoint (single-user tailnet; see Security).
- Supervising the gateway instance (`com.hilt.gateway`, `/hilt`-prefixed) — it stays a
  separate LaunchAgent.
- Replacing Mercury's Electron-spawned fallback server with a daemon (Electron keeps
  supervising laptops; it adopts the same protocol).
- Windows/Linux.

---

## Design

### Protocol files (all under `${DATA_DIR}`, default `~/.hilt/data`)

| File | Writer | Reader | Shape |
|---|---|---|---|
| `app-mode.json` | supervisor (on successful switch) | supervisor (at boot) | `{ mode: "dev"\|"prod", updated_at }` (exists today) |
| `app-mode-intent.json` | Next API route (`POST /api/system/app-mode`) | supervisor (chokidar watch, ts-deduped like the navigate watcher) | `{ mode, ts, requested_by? }` |
| `app-supervisor.json` | supervisor heartbeat (every 30s + on every state change) | `getAppServerInfo()` | `{ kind: "daemon"\|"electron", pid, started_at, beat_at, state: "idle"\|"rebuilding"\|"switching"\|"reverting", detail?, children: { appServer?, wsServer?, eventServer? } }` |
| `app-supervisor-children.json` | supervisor | supervisor (re-adoption after a supervisor crash) | `{ appServer: {pid, port}, wsServer: {pid, port}, eventServer: {pid} }` |

Heartbeat freshness window: **90s** (3 missed beats ⇒ `supervised: false`). A stale
heartbeat must never leave the switch UI enabled.

### Shared module — `server/server-mode.ts`

Extracted from `electron/main.ts` so the daemon and Electron share ONE implementation:

- `readAppMode()` / `persistAppMode()` (state-file > `HILT_APP_MODE` env > dev)
- `resolveServerMode(projectDir)` (prod requires `.next-prod/BUILD_ID`)
- `nextSpawnSpec(projectDir, port)` (dev vs prod args + env)
- intent read/dedupe, heartbeat write/read+freshness, children pid-file helpers

Implementation note: `electron/tsconfig.json` must include this file (or it moves to a
path both tsconfigs already cover). tsx at runtime doesn't care; `electron:compile` does.

### API surface

- `GET /api/system/app-server` (exists) gains:
  `supervised: boolean`, `supervisor?: { kind, state, detail }` — read from the heartbeat
  file with the freshness check. Still flows into `SystemMachine.app_server`.
- `POST /api/system/app-mode` `{ mode: "dev"|"prod" }` (new) →
  - `202 { ok: true, accepted: mode }` after writing the intent file, **only if** a fresh
    heartbeat exists; `409 { error }` when unsupervised; `400` on invalid mode.
  - The route never touches processes — it only writes the intent. The supervisor on that
    machine does the rest.

### The daemon — `server/supervisor.ts` + `com.hilt.supervisor`

A ~200-line tsx process, launchd-supervised (RunAtLoad + KeepAlive, user LaunchAgent via
the shared `scripts/launchd-scheduler.ts` plist helper — same pattern as the library/
semantic/gateway agents):

1. **Boot:** read mode → adopt healthy children from the pid file (probe `/api/ws-port` +
   pid liveness) or clean the port and spawn fresh: app-server (port 3000, fixed),
   ws-server (`WS_PORT=3100`), event-server. Logs to `${DATA_DIR}/logs/supervisor/*.log`.
2. **Health loop:** probe children every 15s; restart a dead child with exponential
   backoff (cap 60s); record state in the heartbeat.
3. **Intent watcher:** on `app-mode-intent.json` change → `switchMode(target)`:
   - target == current → no-op.
   - → prod: run `npm run rebuild` first (old server keeps serving; state `rebuilding`),
     then swap on the same port (state `switching`). Build failure ⇒ stay on current
     mode, record `detail: "build failed"`.
   - → dev: kill app-server child, respawn dev spec, wait ready (90s; first compile).
   - New server not ready ⇒ **auto-revert** to the previous mode (state `reverting`),
     persist nothing on failure.
   - Success ⇒ persist `app-mode.json`, state `idle`.
   - Single-flight; a rebuild-stamp event during a switch is ignored.
4. **Rebuild stamp watcher:** in prod mode, `.next-prod/.hilt-rebuild-stamp` change →
   restart app-server child (the headless `npm run rebuild` loop). Ignored in dev mode.
5. **Dev TTL:** `HILT_SUPERVISOR_DEV_TTL_HOURS` (default **12**, `0` disables): after N
   hours in dev mode, self-switch to prod (rebuild-first). Worst case for a forgotten
   switch is one window reload into a fast server.
6. **Shutdown (SIGTERM from launchd):** kill child process groups, clear heartbeat.

npm scripts: `supervisor:run` (foreground), `supervisor:install`, `supervisor:uninstall`,
`supervisor:status` (reads heartbeat + launchctl print).

### Electron integration (shrinks, doesn't grow)

- Electron main consumes `server-mode.ts`, writes the heartbeat (`kind: "electron"`) while
  it owns children, and watches the same intent file. The `app-mode:*` IPC handlers and
  the preload `appMode` API are **removed** — one mechanism.
- Startup already attaches to an existing healthy server (`isHiltServer` probe); with the
  daemon owning :3000 on the Mini, the Mini's Electron app (if ever opened) is a pure
  viewer there. Mercury's Electron keeps spawning/supervising its fallback server.

### UI (SourceToggle)

- Badge: unchanged (`dev` / `prod · age`), still from same-origin `/api/system/app-server`.
- Switch section renders when `appServer.supervised` is true — **for local and remote
  sources alike**. Buttons POST same-origin `/api/system/app-mode`.
- Progress: poll `/api/system/app-server` every 2s (up to 150s); render
  `supervisor.state`/`detail` ("Building production bundle…", "Restarting server…").
  When `mode === target` → `window.location.reload()`. On 409/timeout → inline error.

### Security note (records a deliberate line-cross)

`POST /api/system/app-mode` is reachable by anything that can reach the Hilt origin
(loopback + tailnet via Serve), unlike `/navigate` (loopback-only). Accepted because:
single-user tailnet, non-destructive, auto-reverting, and the supervisor is the only
actor. Documented in ARCHITECTURE §7 + API.md. Revisit if Hilt ever gets multi-user.

### Mini migration (the cutover)

1. Install + start `com.hilt.supervisor` on Xochipilli **while dev:all still runs** —
   supervisor boots, finds :3000 occupied by a healthy Hilt it doesn't own, and waits
   (logs "port owned externally, standing by", retry every 30s). No port fight.
2. Stop the terminal `dev:all` (user-ack moment or agreed maintenance window — it is the
   live server). Supervisor claims :3000 within one retry, in prod mode.
3. Verify (test plan below), then the terminal habit is retired. Rollback at any point:
   `npm run supervisor:uninstall` + restart `dev:all`.

---

## Work plan

**Phase 1 — protocol (no daemon yet):**
`server/server-mode.ts` extraction · heartbeat in Electron main · intent watcher in
Electron main · IPC switch removal (main/preload/types) · `/api/system/app-mode` route ·
`getAppServerInfo()` supervised fields · SourceToggle HTTP switch + poll/self-reload ·
unit tests · docs (API.md, DATA-MODELS.md, ARCHITECTURE §7, CHANGELOG).

**Phase 2 — daemon + cutover:**
`server/supervisor.ts` · LaunchAgent + npm scripts · adoption/standby logic · dev TTL ·
Mini migration + verification · docs (ARCHITECTURE supervisor section, CHANGELOG).

Phase 1 alone already makes Mercury's local server switchable over HTTP and proves the
protocol end-to-end under the Electron supervisor.

---

## Test plan (agent-executed, both machines)

Conventions: X = Xochipilli (local shell), M = Mercury (via
`ssh mercury-v.tailc0acaa.ts.net`). All curl checks assert status + body. Tests that
disturb a live server are marked **[disruptive]** and run on a scratch port or with the
user's ack.

### T1 — unit (X)

- `npm test` green, including new `server/server-mode` tests:
  mode precedence (state file > env > dev) · prod resolution requires BUILD_ID · intent
  ts-dedupe (same ts consumed once) · heartbeat freshness (fresh ⇒ supervised, >90s ⇒ not)
  · spawn spec args/env per mode.

### T2 — API semantics (X, scratch server on :3211)

1. Start a prod app-server on :3211 with a scratch `DATA_DIR=/tmp/hilt-sup-test`.
2. `GET /api/system/app-server` → `supervised: false`, no `supervisor` block.
3. `POST /api/system/app-mode {"mode":"dev"}` → **409**; no intent file created.
4. Write a fresh fake heartbeat into the scratch DATA_DIR → GET → `supervised: true`,
   `supervisor.kind` echoed.
5. POST again → **202**; `app-mode-intent.json` exists with the requested mode + ts.
6. Backdate the heartbeat `beat_at` by 5 min → GET → `supervised: false`; POST → 409.
7. `POST {"mode":"nope"}` → 400.

### T3 — Electron-supervised switch over HTTP (M) **[disruptive: Mercury fallback only]**

1. Quit Hilt on M; relaunch `dist/Hilt.app`; wait for its owned prod server (port from
   `~/.hilt/data/sources.json`).
2. GET app-server on that port → `mode: "prod"`, `supervised: true`, `kind: "electron"`.
3. POST `{"mode":"dev"}` from the M shell → 202. Poll GET: state passes through
   `switching`; within 90s `mode: "dev"`, state `idle`.
4. `app-mode.json` on M now says dev; **relaunch the app** → it boots straight into dev
   (durability).
5. POST `{"mode":"prod"}` → 202; observe `rebuilding` (server still answering during the
   build — assert a 200 on `/library` mid-build), then `switching`, then `mode: "prod"`.
6. Playwright against M's local origin: source dropdown shows the switch section for the
   local source; clicking Dev shows progress text and ends in a reloaded page with a
   `DEV` badge. (This is the UI path; 3–5 proved the wire path.)

### T4 — auto-revert fault injection (X, scratch supervisor) **[disruptive: scratch only]**

1. Run `supervisor:run` foregrounded with scratch DATA_DIR + port :3211, prod mode.
2. Sabotage dev: temporarily set the spawn spec's dev command to a false binary via test
   hook (`HILT_SUPERVISOR_TEST_BREAK_DEV=1`).
3. POST dev intent → supervisor tries dev, fails readiness, state `reverting`, ends
   `idle` with `mode: "prod"`, server answering. `app-mode.json` still prod.

### T5 — daemon lifecycle (X, scratch first, then live)

Scratch (:3211): boot-spawns trio · heartbeat fresh · `kill -9` app-server child →
respawned within backoff window · `kill -9` supervisor → (launchd KeepAlive in live
install) restarts it and it **re-adopts** the still-healthy children from the pid file —
no port conflict, no duplicate servers · rebuild stamp touch in prod → child restarts ·
stamp touch in dev → ignored (log line asserts it).

Live (after install on X): `launchctl print gui/$UID/com.hilt.supervisor` shows running;
`npm run supervisor:status` agrees with the heartbeat.

### T6 — Mini cutover + the actual user story (X + M) **[disruptive: user-ack]**

1. Install supervisor on X while `dev:all` runs → standby behavior verified in its log.
2. With the user's go-ahead: stop `dev:all`. Within 60s the supervisor owns :3000 in
   prod mode; `https://xochipilli.tailc0acaa.ts.net/api/system/app-server` reports
   `supervised: true`, `kind: "daemon"`, `mode: "prod"`.
3. **From M's window on the Xochipilli source** (Playwright on M against the X origin):
   badge `PROD · age`; switch section present; click **Dev** → progress → page reloads →
   `DEV` badge. Touch a trivial file in X's tree → hot reload visible from M.
4. Click **Prod** → `rebuilding` while the page stays usable → reload → `PROD · just now`.
5. `npm run rebuild` on X while prod → server self-restarts (headless rebuild loop);
   viewer recovers on next interaction.
6. Dev TTL: with `HILT_SUPERVISOR_DEV_TTL_HOURS=0.05` (3 min) on the scratch instance,
   dev mode self-returns to prod.
7. Reboot resilience: simulate via `launchctl bootout` + `bootstrap` of the agent (full
   Mini reboot only if the user wants the real thing): stack comes back in prod,
   no terminal involved.
8. Rollback drill: `supervisor:uninstall`, restart `dev:all`, everything as before.

---

## Acceptance criteria

- [ ] From Mercury's window on the **Xochipilli source**, the user can switch the Mini
      dev↔prod with one click; dev gives hot reload against the Mini's tree from the
      laptop; prod return rebuilds first with the page usable throughout.
- [ ] The Mini's serving stack survives: terminal closes (N/A — no terminal), supervisor
      crash (children re-adopted, no duplicate servers), child crash (respawn ≤ backoff
      cap), reboot (launchd brings the stack back in its persisted mode).
- [ ] `supervised` is honest everywhere: stale heartbeat ⇒ switch UI absent within 90s;
      unsupervised POST ⇒ 409; viewer never sees a switch it can't actuate.
- [ ] A failed switch auto-reverts; the server is never left dead; the failure reason is
      visible via `supervisor.detail` (and therefore the UI).
- [ ] Dev TTL returns a forgotten dev switch to prod automatically.
- [ ] Exactly one switch mechanism remains in the codebase (intent file over HTTP); the
      IPC switch path is fully removed.
- [ ] Rollback to `dev:all` works and is documented.
- [ ] `npm test` green on both machines; CHANGELOG/ARCHITECTURE/API/DATA-MODELS updated.

## Risks

- **Shared-worktree races (X):** parallel sessions commit/edit concurrently — re-read
  files before editing, commit in feature-scoped chunks, never `pkill` by name.
- **Node landscape (M):** children must inherit the launcher-curated PATH (fixed
  2026-06-10); the daemon's plist must set an explicit PATH the same way — launchd
  agents get a minimal environment, which is exactly the trap that bit Electron.
- **Turbopack memory in unattended dev mode:** mitigated by the TTL; watch
  supervisor logs during T6.3 for memory pressure.
- **Port adoption bugs** are the riskiest logic (duplicate servers / orphan kills):
  covered explicitly by T5; keep adoption conservative (probe + pid match, else clean).
