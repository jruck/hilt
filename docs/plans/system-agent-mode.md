# Hilt System Agent — Implementation Plan (v1)

## Context

Observer machines such as **Hestia** should appear in another machine's (**Mercury**) Hilt
System views — reporting Sync, Apps, Sessions, and Stack — **without** running the full Hilt
stack (Next.js UI, `ws-server`, Bridge/Library write routes, Granola/calendar daemons, graph/
semantic runners). Today the only way to be a discoverable Hilt System peer is to run the whole
app. This plan adds a **lightweight, read-only Node HTTP runtime** (`server/system-agent.ts`)
that exposes a tiny allowlist of local-snapshot routes, binds `127.0.0.1:3200`, and is reached
over Tailscale Serve. Outcome: Hestia is a first-class System machine on Mercury at a fraction
of the footprint.

The technical design is settled (validated against the code). The investigation confirmed the
integration surface is **smaller than first assumed** — see "Settled design facts."

## Goal (Definition of Done)

**The whole v1 scope is built AND every capability is 100% confirmed working end-to-end —
including live cross-machine discovery (Hestia↔Mercury), which is a hard gate, not a handoff.**

"Done" = every box in [§7 Definition of Done](#7-definition-of-done) is green: the full automated
suite (`npm run test:system-agent:all` + `npm run test:system` + `tsc`), the explicit negative
guarantees, **and** the live cross-machine validation run from Mercury against Hestia.

## 1. Scope

**In (v1 capabilities):** machine identity + `role`, Sync, Sync conflicts, Apps, Apps refresh,
preview serving, Stack, Stack file (read-only), Map work-graph / sessions / session-detail / refresh.

**Out:** Docs, Bridge, Library, Briefings, Calendar, report serving, preference/source editing,
app-mode switching, navigation, raw vault browsing, `/events`, any non-allowlisted route, and
**all** peer fan-out (aggregate reads stay on full Hilt; the agent answers only local snapshots).

### Route → lib map (the entire handler surface; all lib fns are already Next-free)

| Route | Method | Lib call |
|---|---|---|
| `/api/system/machine` | GET | `localSystemMachineResponse({role:"agent", includeAppServer:false})` |
| `/api/system/sync` | GET | `readLocalSystemSync({force})` |
| `/api/system/sync/conflicts` | GET | `readLocalSystemSyncConflicts(folder,{force})` |
| `/api/local-apps` | GET | `getLocalAppsResponse({includePeers:false})` |
| `/api/local-apps/refresh` | POST | `refreshLocalApps({includePeers:false, forcePreviews, waitForPreviews})` |
| `/api/local-apps/previews/:filename` | GET | `isSafePreviewFilename` + `fs.readFile(previewDir()/…)` → `image/png` |
| `/api/system/stack` | GET | `readLocalSystemStack(project)` |
| `/api/system/stack/file` | GET | `readLocalSystemStackFile(path,project,/*readOnly*/true)` → `isEditable:false` |
| `/api/map/local/work-graph` | GET | `ensureMapIndexFresh` + `buildIndexedWorkGraph` |
| `/api/map/local/sessions` | GET | `ensureMapIndexFresh` + `queryIndexedSessionPage` |
| `/api/map/local/session-detail` | GET | `ensureMapIndexFresh` + `readLocalSessionDetail` |
| `/api/map/local/refresh` | POST | `refreshMapIndex()` |

All other paths → compact **JSON 404**, never HTML, never proxied. Each route mirrors the full
app's feature gate (`isLocalMapEnabled()`, `isMapHistoryPreviewEnabled()`, `isLocalAppsEnabled()`,
`isPreviewCaptureEnabled()`, sync settings) so a disabled capability returns the identical disabled
shape — which is also what makes parity exact.

## 2. Settled design facts (do not re-litigate)

- **`tsx server/system-agent.ts` resolves the `@/` alias** with no `tsconfig-paths` install
  (verified live), so the entrypoint imports `src/lib` functions directly.
- **Discovery needs NO change to `src/lib/system/peers.ts` logic.** `fetchPeerSystemMachine`
  (`peers.ts:104`) accepts any responder with `app==="hilt-system" && enabled===true && machine`
  and never inspects `role`. The agent satisfies this as-is.
- **The only additive contract change is `role: "full" | "agent"`** on `SystemMachineResponse`
  (`src/lib/system/types.ts`), emitted `"agent"` by the agent's machine route. It belongs on the
  response (app property), **not** on `MachineIdentity` (network identity). `localSystemMachineResponse`
  defaults to `"full"` everywhere; only the agent's dedicated `/api/system/machine` route overrides
  to `"agent"` — that route is the sole endpoint discovery reads, so embedded machines in
  stack/sync snapshots stay `"full"` and parity stays exact. `fetchPeerSystemMachine` reads
  `data.role` onto the discovered `SystemMachine` so Mercury can badge the agent.
- **Do NOT add port 3200 to `candidateBaseUrls`.** The agent binds `127.0.0.1` only and is reached
  via the existing `https://<dns>` root probe through Serve. A `:3200` tailnet probe always fails
  and just burns a 1.5s `REMOTE_TIMEOUT_MS` per peer.
- **Serve at root, not under `/hilt`.** Discovery probes the bare origin
  (`https://<peer-dns>/api/system/machine`); Serve must map origin root → `127.0.0.1:3200`.
- **"Read-only" is scoped to the vault/markdown and provider session stores** (never mutated).
  The agent still maintains its own `DATA_DIR` caches: the Map SQLite index
  (`ensureMapIndexFresh`/`refreshMapIndex`) and preview PNGs from `apps/refresh`. The two
  `POST .../refresh` routes are non-destructive rescans and are intentionally allowlisted.
- **Runtime hygiene:** `.env` via `loadEnvConfig(process.cwd())` from `@next/env`; `DATA_DIR` via
  `defaultDataDir()` (`server/server-mode.ts`, → `~/.hilt/data`); dedicated lock
  (`~/.hilt/system-agent.lock`) and a **dedicated heartbeat `DATA_DIR/system-agent.json`** — must
  not touch `ws-server`'s `~/.hilt-server.lock` / `~/.hilt-ws-port` or the supervisor's
  `app-supervisor.json`.

## 3. Required first step

Before implementing: `git status --short --branch` (clean) → `git fetch --prune` →
`git pull --ff-only origin main` → Node 22 (`.nvmrc`) → install deps. If `better-sqlite3` falls
back to node-gyp, fix the local Python/prebuild issue first (the Map index needs it natively).

## 4. Milestones (each exit criterion is a runnable check)

**M0 — Additive `role` contract.** Add `role: "full"|"agent"` to `SystemMachineResponse`
(`src/lib/system/types.ts`) + optional `role` on `SystemMachine`; `localSystemMachineResponse`
takes `{role?, includeAppServer?}` (default `"full"`/included); `fetchPeerSystemMachine` reads
`data.role` onto the discovered machine. Extend `src/lib/system/system.test.ts`: response carries
`role`; `fetchPeerSystemMachine` still resolves a responder that **omits** `role`.
**Exit:** `npm run test:system && npx tsc --noEmit` green.

**M1 — Allowlist router + JSON-404/no-HTML core.** Build `server/system-agent.ts` as a pure
`http.createServer` with the 12-route match table + JSON-404 default; stub handlers first. New
`server/system-agent.test.ts` (node:test + `node:assert/strict`, modeled on `system.test.ts:130`
in-process server + `server-mode.test.ts` fixtures): all 12 paths match; disallowed paths (`/`,
`/index.html`, `/api/system/machines`, `/api/system/graph`, random) → JSON 404 with no HTML;
wrong-method → 404/405. New script `test:system-agent`.
**Exit:** `npm run test:system-agent` green.

**M2 — Wire real lib handlers + role emission.** Replace stubs with the §1 lib calls. `.env`/
`DATA_DIR` hygiene per §2; bind `127.0.0.1:${HILT_SYSTEM_AGENT_PORT:-3200}`; `/api/system/machine`
emits `role:"agent"`, `app_server:null`; previews stream PNG bytes with the Next route's headers;
stack file forces `isEditable:false`; map routes replicate the zod gate + disabled shapes. Extend
the unit test against a `mkdtempSync` DATA_DIR.
**Exit:** `npm run test:system-agent` green (now exercising real libs).

**M3 — Single-host live e2e.** New `scripts/system-agent-e2e.ts` (model: `scripts/graph-e2e.ts`):
`findFreePort` → `spawn tsx server/system-agent.ts` → `waitForServer` polling `/api/system/machine`
→ curl all 12 routes (2xx + JSON shape + `app`/`role`) → assert disallowed routes 404 + no HTML +
preview PNG bytes + both refresh POSTs → snapshot DATA_DIR file list before/after (diff must be
exactly the heartbeat + map-index cache, proving no stray daemon writes) → teardown in `finally`.
**Exit:** `npm run test:system-agent:e2e` exits 0.

**M4 — Agent-vs-full parity (strongest correctness proof).** Add `normalizeForParity` helpers for
map + sync (mirroring `src/lib/local-apps/parity.ts` — strip `*_at`/`start_time`/`checked_at` →
`<timestamp>`, `latency_ms` → 0, preview path → `<preview>/$1`). New `scripts/system-agent-parity.ts`
(model: `scripts/local-apps-parity.ts`): boot the agent, fetch each route, and in the same process
call the equivalent full-Hilt local lib fn against the same DATA_DIR; normalize; `assert.deepEqual`.
local-apps reuses the existing `normalizeForParity`. The machine route is compared with `role`/
`app_server` excluded (the one intentional agent-vs-full difference).
**Exit:** `npm run test:system-agent:parity` exits 0 for every capability.

**M5 — LaunchAgent + Serve artifacts.** `scripts/system-agent-launchd.ts` (clone of
`scripts/supervisor-launchd.ts`): label `com.hilt.system-agent`; `renderPlist/install/uninstall/
status`; `RunAtLoad+KeepAlive+ThrottleInterval`; env sets `HOME`, `DATA_DIR`,
`HILT_SYSTEM_AGENT_PORT`, and a PATH that **includes the `tailscale` binary dir**; **does NOT set
`HILT_GRANOLA_SYNC_DAEMON`**; logs under `~/.hilt/logs/system-agent/`. Wrapper
`scripts/hilt-system-agent.sh` cloned from `hilt-supervisor.sh` with `exec ./node_modules/.bin/tsx
server/system-agent.ts` and **no Granola export**. `server/system-agent.ts` writes
`DATA_DIR/system-agent.json` heartbeat (~30s) to a distinct path. `status` reports launchctl state +
pid + port + whether `/api/system/machine?scope=local` responds. Add a heartbeat-round-trip +
distinct-filename assert.
**Exit:** `npm run system-agent:status` prints plan + heartbeat path; `tsc --noEmit` green.

**M6 — Cross-machine live (HARD GATE).** Install on Hestia, enable Serve, confirm Mercury
discovers it. Run the [§8 checklist](#8-cross-machine-validation-m6-hard-gate) from both hosts.
**Exit:** every §8 step passes — Hestia appears in Mercury's System view with `role:"agent"`, all
capabilities serve through Serve, disallowed paths 404 over HTTPS, Syncthing key never leaks.

## 5. Verification matrix

| Capability | Proof mechanism | PASS |
|---|---|---|
| machine identity / `role` | unit (M0/M2) + parity (M4) + live (M6) | `app:"hilt-system"`, `enabled:true`, `role:"agent"`, `machine` present; discovered as peer |
| sync | parity (M4) + smoke (M3) | `/api/system/sync` deepEqual `readLocalSystemSync` after normalize |
| sync conflicts | parity (M4) | deepEqual `readLocalSystemSyncConflicts` |
| apps | parity (M4, reuses existing `normalizeForParity`) | normalized agent JSON == `getLocalAppsResponse` |
| apps refresh (POST) | e2e (M3) + parity (M4) | refreshed snapshot; deepEqual `refreshLocalApps` |
| preview serving | e2e (M3) | `image/png` non-empty bytes; 400 unsafe name; 403 when disabled |
| stack | parity (M4) | deepEqual `readLocalSystemStack` |
| stack file (read-only) | unit (M2) + e2e (M3) + static (DoD) | returns `{file:{…, isEditable:false}}`; mutating verbs 404; no fs-write symbols |
| map work-graph / sessions / session-detail | parity (M4) | deepEqual `buildIndexedWorkGraph` / `queryIndexedSessionPage` / `readLocalSessionDetail` |
| map refresh (POST) | e2e (M3) | returns `{diagnostics}` from `refreshMapIndex()` |
| negative routes 404 | unit (M1) + e2e (M3) + live (M6) | every non-allowlisted path → JSON 404 |
| no-HTML | unit (M1) + e2e (M3) | 404 body JSON; `content-type` never `text/html`; no `<html>` anywhere |
| no-daemons-started | DATA_DIR diff + log assert (M2/M3) | only `system-agent.json` + map cache written; no Granola/calendar/scheduler/graph/semantic boot lines |
| discovery from peer | unit (M0) + live (M6) | `fetchPeerSystemMachine` accepts agent; Mercury `/api/system/machines` lists Hestia |

## 6. Layered test strategy (new files + npm scripts)

- **(a) Unit / in-process (CI, no network):** new `server/system-agent.test.ts`; extend
  `src/lib/system/system.test.ts`. Add `test:system-agent` to the `test:unit` chain (beside
  `test:server-mode`).
- **(b) Single-host e2e + parity (boots the real agent):** `scripts/system-agent-e2e.ts` →
  `npm run test:system-agent:e2e`; `scripts/system-agent-parity.ts` (+ map/sync normalizers) →
  `npm run test:system-agent:parity`; URL-parameterizable `scripts/system-agent-smoke.ts` (model:
  `scripts/system-sync-smoke.ts`) → `npm run test:system-agent:smoke` (reused over the wire in M6).
- **(c) Cross-machine live (M6):** the §8 checklist; `test:system-agent:smoke` re-pointed at
  `https://hestia.<tailnet>` from Mercury.
- **Aggregate:** `npm run test:system-agent:all` = `test:system-agent && test:system-agent:e2e &&
  test:system-agent:parity` (live smoke stays out of the default — needs a running peer).
- **Operate:** `system-agent:run` (`tsx server/system-agent.ts`), `:install` / `:uninstall` /
  `:status` (`tsx scripts/system-agent-launchd.ts --…`).

## 7. Definition of Done

**Automated (all green):**
- [ ] `npm run test:system-agent` — 12-route allowlist; JSON-404 default; no `text/html`;
      `role:"agent"`; heartbeat round-trips to a distinct `system-agent.json`
- [ ] `npm run test:system` — `role` additive + discovery back-compat
- [ ] `npm run test:system-agent:e2e` — real agent on ephemeral port; all routes 2xx; 404 negatives;
      preview PNG; both refresh POSTs; DATA_DIR write-diff clean
- [ ] `npm run test:system-agent:parity` — every capability deepEqual to full-Hilt local lib output
- [ ] `npx tsc --noEmit` and `npm run lint`

**Negative guarantees (each an explicit assertion, not an absence):**
- [ ] Disallowed routes (`/`, `/index.html`, `/api/system/machines`, `/api/system/graph`,
      `/api/bridge/*`, `/api/library/*`, `/api/calendar/*`, `/events`, `/navigate`, random) → JSON 404
- [ ] No frontend: no HTML ever served; no static/asset routes registered
- [ ] No background work: agent boot logs contain no Bridge/Library/Granola/calendar/scheduler/
      graph/semantic init lines; wrapper does not export `HILT_GRANOLA_SYNC_DAEMON`; DATA_DIR
      write-diff during e2e is exactly `{system-agent.json}` + the map-index cache
- [ ] Syncthing key never leaked: `/api/system/sync` and `/conflicts` JSON contain no `apiKey`/
      key-file contents (asserted by grep in e2e + parity)
- [ ] Stack files non-editable: only GET stack routes; mutating verbs 404; `server/system-agent.ts`
      contains no `writeFile/unlink/rm/mkdir`; lib stack layer is read-only

**Cross-machine live (M6 — hard gate, run from both hosts):**
- [ ] LaunchAgent installs on Hestia; `system-agent:status` shows loaded + FRESH heartbeat
- [ ] `tailscale serve status` shows `https://hestia.<tailnet>/ → 127.0.0.1:3200`
- [ ] Mercury `/api/system/machines` lists Hestia with `role:"agent"`; Hestia renders in System →
      Sync / Apps (+ screenshots) / Sessions / Stack (+ validated read-only previews)
- [ ] Disallowed paths 404 over the public Serve origin; `/` serves no HTML; Syncthing key absent

**Final:** `npm run rebuild` after user-visible source changes. Update `docs/CHANGELOG.md`,
`docs/ARCHITECTURE.md` (System full-vs-agent roles), `docs/API.md` (`role` + agent route surface +
Serve deployment), `docs/DATA-MODELS.md` (`SystemMachineResponse.role`), `.env.example`
(`HILT_SYSTEM_AGENT_PORT`), and `AGENTS.md` only if a durable ops rule is warranted.

## 8. Cross-machine validation (M6, hard gate)

Hestia deploy: pull + Node-22 install; ensure `.env` has `HILT_SYNC_ENABLED=true`,
`HILT_SYNC_PROVIDER=syncthing`, `HILT_SYNC_FOLDER_ID=work-meta`,
`HILT_SYNC_SYNCTHING_URL=http://127.0.0.1:8384`, `HILT_SYNC_SYNCTHING_API_KEY_FILE=…`,
`HILT_LOCAL_APPS_ENABLED=true`, `HILT_LOCAL_APPS_PREVIEWS=true`, `HILT_MAP_LOCAL_ENABLED=true`;
`npm run system-agent:install`; configure Serve (root → `127.0.0.1:3200`). Then:

1. Hestia: `npm run system-agent:status` → `state = running` + heartbeat FRESH from `system-agent.json`.
2. Hestia: `tailscale serve status` → `https://hestia.<tailnet>/ → 127.0.0.1:3200`.
3. Mercury: `curl -s https://hestia.<tailnet>/api/system/machine | jq '{app,enabled,role}'` →
   `{"app":"hilt-system","enabled":true,"role":"agent"}`.
4. Mercury: force-refresh System machines; `curl -s https://mercury…/api/system/machines | jq` →
   Hestia present + reachable. Confirm Sync / Apps (+screenshots) / Sessions / Stack (+previews) render.
5. Mercury: `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://hestia.<tailnet>/api/system/graph`
   → `404 application/json`; `curl -s https://hestia.<tailnet>/` → JSON 404, no HTML.
6. Mercury: `curl -s https://hestia.<tailnet>/api/system/sync | grep -i -E 'apikey|api-key'` → no output.

## 9. Critical files

- `server/system-agent.ts` — **new**, the build target (allowlist router + lib wrappers + heartbeat)
- `src/lib/system/types.ts` — additive `role` field (M0)
- `src/lib/system/peers.ts` — `localSystemMachineResponse` role option; `fetchPeerSystemMachine` reads `data.role`
- `server/system-agent.test.ts` — **new** unit/in-process (model: `system.test.ts:130`, `server-mode.test.ts`)
- `scripts/system-agent-e2e.ts` — **new** (model: `scripts/graph-e2e.ts`)
- `scripts/system-agent-parity.ts` + map/sync `normalizeForParity` — **new** (model: `scripts/local-apps-parity.ts`, `src/lib/local-apps/parity.ts`)
- `scripts/system-agent-smoke.ts` — **new** (model: `scripts/system-sync-smoke.ts`)
- `scripts/system-agent-launchd.ts` + `scripts/hilt-system-agent.sh` — **new** (models: `scripts/supervisor-launchd.ts`, `scripts/hilt-supervisor.sh`)
- `package.json` — new `system-agent:*` and `test:system-agent*` scripts; add `test:system-agent` to `test:unit`
