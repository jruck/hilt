# Plan 005: Make the event WebSocket connect to the source host, not hardcoded `localhost`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b0a724f..HEAD -- src/hooks/useEventSocket.ts`
> If the file changed, compare the "Current state" excerpt against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (Step 1) + a bounded spike (Step 3)
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b0a724f`, 2026-06-10

## Why this matters

When Hilt's renderer is loaded from a **remote source** (e.g. the Electron app on a laptop pointed at a Mac Mini, or the iPhone PWA served over Tailscale), the "open in Hilt" navigate feature silently fails. Root cause: the renderer's event WebSocket URL is hardcoded to `localhost`. The renderer correctly fetches the *source's* ws-server port via `/api/ws-port`, then throws it away and connects to `ws://localhost:<port>` **on the viewer's own machine** — where nothing relevant is listening. So a navigate intent broadcast by an agent on the Mac Mini's ws-server never reaches the laptop/phone renderer. (The file-watch fallback in `electron/main.ts` is inherently local-only and cannot cross machines, so the WebSocket is the only cross-machine channel — which is exactly the one that's broken.) Step 1 fixes the host. Step 3 is a bounded spike for the Tailscale-Serve/phone case, where the ws-server port may not be proxied.

## Current state

- `src/hooks/useEventSocket.ts` — `fetchPort()` requests the port from the source it's loaded from (relative URL, resolves to the source's Next server):

```ts
  const fetchPort = useCallback(async (): Promise<number | null> => {
    if (wsPortRef.current) return wsPortRef.current;
    if (typeof window === "undefined") return null;
    try {
      const res = await fetch("/api/ws-port");                 // ← resolves to the SOURCE's Next server
      if (res.ok) { const data = await res.json(); wsPortRef.current = data.port; return data.port; }
    } catch (err) { console.error("[useEventSocket] Failed to fetch WS port:", err); }
    return null;
  }, []);
```

- The bug — the `connect()` callback then hardcodes `localhost` (around line 83–84):

```ts
    const port = await fetchPort();
    if (!port || !mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//localhost:${port}/events`;       // ← BUG: should follow window.location.hostname
    const ws = new WebSocket(url);
```

- For confirmation that the renderer really is loaded from the remote host in the broken scenario: `electron/main.ts` `resolveStartupUrl` returns the remote source URL when a remote source is selected (`electron/main.ts:255` → `return source.url;`), and `mainWindow.loadURL(startupUrl)` loads it. So `window.location.hostname` in the broken case is the Mac Mini's tailnet host, while the code dials `localhost`.
- The producing side, for reference (do NOT modify in this plan): `server/ws-server.ts:130` `POST /navigate` → `eventServer.broadcastAll("navigate", "goto", { view, path })` and a fallback file write. The broadcast reaches only clients connected to *that* ws-server — which, after this fix, the remote renderer will be.

There is an existing test: `src/hooks/__tests__/useEventSocket.test.ts` (vitest, jsdom) — extend it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Existing socket test | `npx vitest run src/hooks/__tests__/useEventSocket.test.ts` | all pass |
| Full gate (if 001 done) | `npm test` | all pass |
| Confirm no `localhost` literal remains in the WS URL | `grep -n "localhost" src/hooks/useEventSocket.ts` | no match on the `/events` URL line |

## Scope

**In scope**:
- `src/hooks/useEventSocket.ts` (the WS URL construction only)
- `src/hooks/__tests__/useEventSocket.test.ts` (extend with a host-derivation case)

**Out of scope** (do NOT touch):
- `server/ws-server.ts` and the `POST /navigate` handler — the producer is correct; do not change the navigate protocol or its file fallback.
- `electron/main.ts` — startup URL resolution and the local navigate-file watcher are not the bug.
- Any change to *which* port `/api/ws-port` returns. The port is correct; only the host is wrong.
- Proxying the WebSocket through the Next origin — that is the **possible** outcome of the Step 3 spike and, if needed, becomes its own plan. Do not build it speculatively here.

## Git workflow

- Branch: `advisor/005-navigate-websocket-source-aware`
- Commit style: conventional commits. Example: `fix(events): connect event socket to source host instead of localhost`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Derive the WebSocket host from `window.location`

Replace the hardcoded `localhost` with the host the renderer was actually loaded from:

```ts
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "localhost";
    const url = `${protocol}//${host}:${port}/events`;
```

Notes:
- Use `window.location.hostname` (no port) and append `:${port}` from `/api/ws-port` — the ws-server listens on its own port, distinct from the page's port.
- Keep the existing `wss:`-when-`https:` logic. Keep everything else in `connect()` (reconnect/backoff/onmessage routing) unchanged.

**Verify**:
- `grep -n "window.location.hostname" src/hooks/useEventSocket.ts` → present on the URL line.
- `grep -n "//localhost:" src/hooks/useEventSocket.ts` → no match.
- `npx tsc --noEmit` → exit 0.

### Step 2: Extend the unit test

In `src/hooks/__tests__/useEventSocket.test.ts`, add a case that sets `window.location` (jsdom lets you stub `hostname`/`protocol`) to a non-localhost host (e.g. `mac-mini.tailnet.ts.net`, `http:`) and a mocked `/api/ws-port` returning a port, then asserts the constructed `WebSocket` was called with `ws://mac-mini.tailnet.ts.net:<port>/events` — **not** `localhost`. Add a second case for `https:` → `wss://`. Follow the existing test's mocking style for `fetch` and `WebSocket`.

**Verify**: `npx vitest run src/hooks/__tests__/useEventSocket.test.ts` → all pass, including the new host cases.

### Step 3 (bounded spike): Verify reachability for each real topology; write findings to the plan index

Do **not** change code in this step. Determine and record (in your status update / a short note appended to `plans/README.md` under this plan) whether, after Step 1, navigate works for each topology:

1. **Laptop Electron → Mac Mini source over raw tailnet** (no Tailscale Serve): the ws-server port is directly reachable at `mac-mini-host:<wsPort>`. Expected: now works. Confirm by reasoning from `server/ws-server.ts` binding (it listens on all interfaces) — note the conclusion.
2. **iPhone PWA → Mac Mini over Tailscale Serve (https)**: Tailscale Serve typically proxies a single origin (443 → the Next app on 3000). The separate ws-server port may **not** be exposed, so `wss://<serve-host>:<wsPort>` could fail even with the correct hostname. Determine whether the deployment exposes the ws port. If it does not, the remaining fix is to proxy the `/events` WebSocket through the Next origin (same host/port as the page) — record this as a recommended follow-up plan, with the specific obstacle, rather than implementing it here.

**Verify**: a written conclusion exists for both topologies (works / needs-follow-up + why). No code changed in this step.

## Test plan

- Extend `src/hooks/__tests__/useEventSocket.test.ts`: WS URL uses `window.location.hostname` for both `ws:` and `wss:`; never `localhost` when the page host differs.
- Verification: `npx vitest run src/hooks/__tests__/useEventSocket.test.ts` → all pass.

## Done criteria

ALL must hold:

- [ ] WS URL is built from `window.location.hostname`; no `//localhost:` literal remains on the `/events` line
- [ ] `npx vitest run src/hooks/__tests__/useEventSocket.test.ts` passes with new host-derivation cases
- [ ] `npx tsc --noEmit` exits 0; `npm test` (if 001 done) passes
- [ ] Step 3 conclusions for both topologies are written into `plans/README.md` (works vs. needs-follow-up + reason)
- [ ] `git status` shows only `useEventSocket.ts` + its test
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpt doesn't match — drift (the hardcode may have already been changed).
- After Step 1, a same-machine (localhost) setup regresses — e.g. `window.location.hostname` is empty in the Electron `file://` case. If the renderer is ever loaded via `file://` rather than `http(s)://`, `hostname` is empty; the `|| "localhost"` fallback should cover it, but if you observe a regression in the purely-local Electron path, report it.
- Step 3 reveals the phone path needs WS-over-Next-origin proxying — do **not** build it in this plan; record it as a follow-up.

## Maintenance notes

- The real fix for the phone/Serve case (if Step 3 shows the ws port isn't proxied) is to serve the `/events` WebSocket from the same origin/port as the Next app (e.g. upgrade-handling on the Next server, or a path Serve already proxies), removing the dependency on a separately-exposed ws port. That is the natural next plan if the spike calls for it.
- The navigate file-watch fallback in `electron/main.ts` remains local-only by design; it helps the same-machine backgrounded-window case, not cross-machine. Don't expect it to cover remote navigate.
- Reviewer should check that same-machine localhost usage is unaffected (the common case must not regress while fixing the remote case).
