# Supervisor v1 — Implementation Report

**Spec:** `docs/plans/supervisor-v1.md` · **Implemented + verified:** 2026-06-11 (overnight session)
**Verdict: shipped, cut over, and live.** The Mini (Xochipilli) now runs its Hilt serving
stack as a launchd-supervised appliance in prod mode, remotely dev/prod-switchable from
Mercury. Both spec phases implemented; verified by a 6-agent workflow on scratch instances
plus live T3 (Mercury/Electron) and T6 (Mini cutover + cross-machine switch) tests.

**Commits:** `62f1aea` (phases 1+2) · `ac5b854` (children knob) · `068bbb2` (workflow
findings: stamp absorb, wedge detection, docs) · `f377bd5` + `56f01f4` (portFree, found
live) · `0506aa5` (event-server is a library).

## End state (as of this report)

- **Xochipilli:** `com.hilt.supervisor` running (KeepAlive); daemon heartbeat FRESH;
  children appServer (:3000, prod) + wsServer (:3100). Old `com.hilt.dev-server` agent
  booted out; its plist preserved at `~/Library/LaunchAgents/com.hilt.dev-server.plist.disabled`
  for rollback. The broken terminal-era dev server is gone.
- **Mercury:** Electron app running, supervising its local fallback server (:3002, prod),
  same protocol (`kind: "electron"`).
- Both repos at `0506aa5`; `npm test` green on both machines.

## Test results

| Plan test | Where | Result |
|---|---|---|
| T1 unit gate | X (workflow) + Mercury (live) | **PASS** — npm test green both machines (113 node:test + 34 vitest + tsc 0); server-mode 7/7 on both; electron compile clean; eslint 0 errors |
| T2 API semantics | X scratch :3211 (workflow) | **PASS** — all 8 checks: 409-unsupervised (no intent written), heartbeat→202+intent, 90s staleness→409, 400s on bad input |
| T3 Electron-supervised switch over HTTP | Mercury live :3002 | **PASS** — POST dev: 202 → mode dev in <10s, persisted; POST prod: 202 → `rebuilding` detail streamed ~44s **with the server answering every poll** → `prod idle` at t+48s; heartbeat intact throughout |
| T4 auto-revert fault injection | X scratch :3213 (workflow) | **PASS** — broken dev spawn → revert to prod, failed target never persisted, no spurious rebuild, final state idle |
| T5 daemon lifecycle | X scratch :3212 (workflow) | **PASS** — boot/heartbeat; intent switch both directions; dev TTL (0.03h) auto-returned to prod via rebuild-first; child kill-9 → respawn; supervisor kill-9 → relaunch **re-adopted** the live child (one listener, no duplicate); SIGTERM cleaned port + protocol files |
| T6 cutover + cross-machine switch | X + Mercury live | **PASS** — install-beside-running (standby loop logged twice) → claim within 30s of the old stack's removal → prod/supervised/daemon on :3000 and via the tailnet origin; **from Mercury:** POST dev → Mini in dev in 6s; POST prod → `rebuilding` streamed 36s, one ~3s blip at swap, `prod idle` at t+42s; switch UI verified rendering on the daemon-supervised origin (badge `PROD · just now` + Server Mode Dev/Prod section, screenshot taken); supervisor kill-9 under launchd → restarted + re-adopted same children pids, zero interruption |

## Acceptance criteria — final scorecard

- ✅ **AC1 remote one-click switch** — verified at the wire level from Mercury (6s to dev,
  42s back to prod with progress streaming) and at the UI level against the
  daemon-supervised origin (same component + same `supervised` payload Mercury's window
  reads). Caveat: the literal click was Playwright-on-X + curl-from-Mercury, not
  Playwright-on-Mercury.
- ✅ **AC2 stack survives** — child crash (scratch), supervisor SIGKILL under launchd with
  re-adoption (live, twice counting the scratch run). **Reboot: not executed** — I don't
  reboot the user's Mini unprompted; RunAtLoad + standby logic + the disabled old plist
  make it low-risk. Worth a deliberate test at the next natural reboot.
- ✅ **AC3 supervised is honest** — fresh-heartbeat (≤90s + live pid) gating verified by
  unit tests, T2 staleness flow, and the UI gate. Switch UI absent when unsupervised.
- ✅ **AC4 failed switch auto-reverts** — fault injection (T4) + the live portFree incident
  (crash-looping child never took the port from a serving owner; backoff held).
- ✅ **AC5 dev TTL** — scratch-verified end-to-end (0.03h → auto return to prod). Live
  default 12h.
- ✅ **AC6 exactly one switch mechanism** — IPC path removed (grep-verified to zero hits
  including compiled JS); intent-file-over-HTTP is the only actuator.
- ◐ **AC7 rollback** — mechanism documented and preserved (disabled plist + uninstall
  script); bootout/bootstrap exercised on the old agent and on supervisor kickstarts, but
  a full uninstall→dev:all→reinstall round trip was not drilled live (double disruption
  for no new information). Scratch SIGTERM teardown verified clean state removal.
- ✅ **AC8 tests + docs** — npm test green on both machines; CHANGELOG (3 entries),
  ARCHITECTURE §7, API.md, DATA-MODELS.md, CLAUDE.md, plan-doc status all updated.

## Deviations from spec (all documented in code/docs)

1. **Daemon intent watcher polls (2s)** instead of chokidar — fewer moving parts in the
   process whose job is staying alive; 2s is invisible next to a 30s rebuild.
2. **Failed switch persists the previous mode** rather than "persist nothing" —
   behaviorally identical (previous == what was already persisted), keeps `updated_at`
   honest about the revert.
3. **Own plist renderer** (`scripts/supervisor-launchd.ts`) instead of the shared
   launchd-scheduler helper — that helper renders calendar-job plists, not KeepAlive
   daemons; forcing it would have meant rewriting it.
4. **Heartbeat `children` is a flat name→pid map** (Electron uses
   `appServer:<source>` keys for multi-source) vs the spec's typed sketch — informational
   field, consumers don't depend on the shape.
5. **Intent ts-dedupe state lives in each consumer** (daemon + Electron), not the shared
   module — the read/validate logic is shared; the watermark is inherently per-process.
6. **MANAGED_CHILDREN default is appServer + wsServer**, not the spec's "trio" —
   `server/event-server.ts` turned out to be a library ws-server imports, not a process
   (`npm run event-server` exits immediately; `dev:all` has been running a no-op third
   process all along).
7. **Mini cutover differed from the spec's mental model**: the "terminal dev:all" was
   actually a `com.hilt.dev-server` LaunchAgent (KeepAlive) plus an orphaned manual dev
   server — cutover = bootout + plist-disable + kill-by-port, not closing a terminal.

## Bugs found by verification (fixed before/during cutover)

1. **Stamp-watcher deferred its own switch's rebuild stamp** (workflow spec-review) — the
   fresh server would have been restarted a second time post-switch. Fixed: absorb
   in-transition stamps + sync the watermark when the switch's build completes.
2. **No wedged-server detection** (workflow review) — alive-but-hung app-server would
   never self-recover headless. Fixed: HTTP probe per tick, 90s spawn grace, 4-failure
   streak → restart.
3. **`portFree` bind-probes missed IPv4-wildcard owners** (live, during cutover — the
   supervisor claimed :3000 over the running server instead of standing by; its child
   crash-looped harmlessly on EADDRINUSE while the real server kept serving). Fixed
   twice: dual bind probe was still insufficient → loopback **connect**-probe + explicit
   0.0.0.0 bind. The same class of bug as Electron's documented `findAvailablePort`
   traps; bind-probing cannot detect this owner class at all.
4. **Root cause of the recurring :3000 breakage** (three workflow agents independently):
   `next build` with `HILT_DIST_DIR=.next-prod` still rewrites/deletes parts of
   `.next/dev`, killing any RUNNING `next dev` on the checkout. Documented as an accepted
   same-checkout constraint (ARCHITECTURE §7 + CLAUDE.md warning); the supervised
   topology is immune, which is itself an argument for the cutover.
5. **event-server respawn loop** (live) — see deviation 6.

## Open items

- **Reboot survival test** on the Mini at the next natural restart (expected: launchd
  brings the supervisor up, supervisor claims :3000 in prod).
- **`dev:all` still spawns the no-op event-server process** — harmless, one-line cleanup.
- The old `com.hilt.dev-server.plist.disabled` can be deleted once the supervisor has a
  few days of trust.
- Mercury can adopt the daemon too if its fallback server should become an appliance —
  the launcher-style nvm PATH discipline is already in the wrapper.

## Operations crib

```bash
npm run supervisor:status      # launchctl state + heartbeat + children
tail -f ~/.hilt/logs/supervisor.log              # daemon decisions
ls ~/.hilt/data/logs/supervisor/                 # child logs (app-server, ws-server, rebuild)
launchctl kickstart -k gui/$UID/com.hilt.supervisor   # restart daemon (children re-adopted)
npm run supervisor:uninstall   # rollback step 1; then restore the .disabled plist + bootstrap
```
